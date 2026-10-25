import type {
  CardTxn,
  Change,
  CompanyModel,
  Constraint,
  Evidence,
  Forecast,
  Invoice,
  RiskEvent,
  Snapshot,
} from "@domino/contracts";
import { addDays, daysBetween, toMs, weekStarts } from "./dates";
import { money } from "./dominoes";
import { type CashSchedule, cashSchedule, forecastFromSchedule } from "./forecast";
import { compareIds } from "./funding";
import { decimalRatio } from "./money";
import {
  type Candidate,
  concentration,
  customerName,
  day,
  earlyCollection,
  overdueUncollected,
  payoutLate,
  payrollGrowth,
  pipelineClose,
  riskKind,
  scheduledPayments,
  short,
  vendorPriceRises,
} from "./risk-kinds";
import { evaluateOnSchedule } from "./rules";
import { isOpenInvoice } from "./schedule";

const MAX_RISKS = 5;
/** Diversity cap: at most this many risks of one kind in the returned set. */
const MAX_PER_KIND = 2;
const LATE_DAYS = 14;
const MIN_SAMPLES = 3;
/** Build-spec §6.3 default when fewer than three paid invoices are observable. */
const DEFAULT_LATE_CHANCE = 0.1;
const RENEWAL_CHANCE = 0.25;
const UNSIGNED_RENEWAL_CHANCE = 0.5;
/** Demo assumption, not an estimated incidence rate: the spec gives no chance rule for spikes. */
const SPIKE_CHANCE = 0.3;

/**
 * Build-spec §6.3 from real snapshot records and the learned model (never an answer key).
 * Impact runs through forecast. A candidate is omitted only when it changes neither the weekly
 * totals nor any rule outcome: equal weeks can still move a bill past its daily deadline.
 * Constraints decide that check only; they do not change the chances.
 */
export function scanRisks(
  snapshot: Snapshot,
  model: CompanyModel,
  constraints: Constraint[],
): RiskEvent[] {
  const outcomes = (changes: Change[]) => {
    const schedule = cashSchedule(snapshot, model, changes);
    const f = forecastFromSchedule(snapshot, schedule);
    return { forecast: f, rules: ruleOutcomes(snapshot, f, constraints, schedule) };
  };
  const base = outcomes([]);
  const candidates = [
    ...latePayments(snapshot, model),
    ...nonRenewals(snapshot),
    ...spendSpike(snapshot),
    ...vendorPriceRises(snapshot),
    ...payrollGrowth(snapshot),
    ...scheduledPayments(snapshot),
    ...concentration(snapshot, model),
    ...overdueUncollected(snapshot),
    ...payoutLate(snapshot),
    ...earlyCollection(snapshot, model),
    ...pipelineClose(snapshot, model),
  ];
  const scored = candidates.flatMap((c) => {
    const scenario = outcomes(c.changes);
    const same = sameWeeks(base.forecast, scenario.forecast) && base.rules === scenario.rules;
    if (same) return [];
    const impact = base.forecast.lowPoint.usable - scenario.forecast.lowPoint.usable;
    return [{ ...c, impactLowPoint: impact }];
  });
  return pickDiverse(scored);
}

/**
 * Downside risks: the top risk of each kind first (in score order), then fill by score with
 * at most two of one kind, so one large kind (renewals) cannot crowd out the rest. The best
 * upside event, if any, takes the last slot so the list is not all bad news; it stays last
 * because callers that show only the first few risks expect downside first.
 */
export function pickDiverse(risks: RiskEvent[]): RiskEvent[] {
  // A zero chance is not a scenario worth showing.
  const sorted = risks.filter((r) => r.probability > 0).sort(compareRisks);
  const downside = sorted.filter((r) => riskKind(r.id) !== "upside" && r.impactLowPoint >= 0);
  const upside = sorted
    .filter((r) => riskKind(r.id) === "upside")
    .sort((a, b) =>
      compareRisks(
        { ...a, impactLowPoint: -a.impactLowPoint },
        { ...b, impactLowPoint: -b.impactLowPoint },
      ),
    );
  const picked: RiskEvent[] = [];
  const count = (kind: string) => picked.filter((r) => riskKind(r.id) === kind).length;
  const room = MAX_RISKS - (upside.length ? 1 : 0);
  for (const r of downside) if (picked.length < room && count(riskKind(r.id)) === 0) picked.push(r);
  for (const r of downside)
    if (picked.length < room && !picked.includes(r) && count(riskKind(r.id)) < MAX_PER_KIND)
      picked.push(r);
  picked.sort(compareRisks);
  if (upside[0]) picked.push(upside[0]);
  return picked;
}

/** Highest probability × impact first, compared as exact decimals; ties by risk ID. */
export function compareRisks(a: RiskEvent, b: RiskEvent): number {
  const pa = decimalRatio(a.probability);
  const pb = decimalRatio(b.probability);
  const left = pa.num * BigInt(a.impactLowPoint) * pb.den;
  const right = pb.num * BigInt(b.impactLowPoint) * pa.den;
  if (left !== right) return left > right ? -1 : 1;
  return compareIds(a.id, b.id);
}

function sameWeeks(a: Forecast, b: Forecast): boolean {
  return a.weeks.every(
    (w, i) => w.inflow === b.weeks[i]?.inflow && w.outflow === b.weeks[i]?.outflow,
  );
}

/** Each rule's status and first breach day from the shared evaluator, as one comparable key. */
function ruleOutcomes(
  snapshot: Snapshot,
  f: Forecast,
  constraints: Constraint[],
  schedule: CashSchedule,
): string {
  const results = evaluateOnSchedule(snapshot, f, constraints, schedule);
  return JSON.stringify(results.map((r) => [r.constraint.id, r.status, r.breach?.date ?? null]));
}

// ---------- Late payment ----------

const observablePaid = (snapshot: Snapshot, customerId: string) =>
  snapshot.invoices
    .filter((i) => i.customerId === customerId && i.paid !== undefined && i.paid <= snapshot.asOf)
    .sort((a, b) => compareIds(a.id, b.id));

const daysLate = (i: Invoice) => daysBetween(i.due, i.paid ?? i.due);

/**
 * Chance = paid invoices more than 14 days late / all observable paid invoices (paid by asOf).
 * The p90 is total lateness while the forecast already adds the rounded mean, so the extra
 * delay is max(0, round(p90) - round(mean)).
 */
function latePayments(snapshot: Snapshot, model: CompanyModel): Candidate[] {
  return snapshot.invoices
    .filter((i) => isOpenInvoice(i))
    .flatMap((inv) => {
      const delay = model.customerDelayDays[inv.customerId];
      if (!delay) return [];
      const days = Math.max(0, Math.round(delay.p90) - Math.round(delay.mean));
      if (days === 0) return [];
      const history = observablePaid(snapshot, inv.customerId);
      const late = history.filter((i) => daysLate(i) > LATE_DAYS).length;
      const enough = history.length >= MIN_SAMPLES;
      const probability = enough ? late / history.length : DEFAULT_LATE_CHANCE;
      const name = customerName(snapshot, inv.customerId);
      const chanceNote = enough
        ? `${late} of ${history.length} paid invoices observable by ${snapshot.asOf} were more than ${LATE_DAYS} days late`
        : `Assumption: only ${history.length} paid invoices observable by ${snapshot.asOf}, fewer than ${MIN_SAMPLES}, so the chance uses the documented ${DEFAULT_LATE_CHANCE} default`;
      const evidence: Evidence[] = [
        {
          source: "stripe",
          ref: inv.id,
          note: `Open ${money(inv.amount)} invoice due ${inv.due}. ${chanceNote}`,
        },
        {
          source: "learned",
          ref: `customerDelayDays.${inv.customerId}`,
          note: `Learned delay: mean ${delay.mean} days, p90 ${delay.p90} days; ${days} days beyond the rounded mean already forecast`,
        },
        ...history.map((i) => ({
          source: "stripe" as const,
          ref: i.id,
          note: `Due ${i.due}, paid ${i.paid}: ${daysLate(i)} days late`,
        })),
      ];
      const changes: Change[] = [{ kind: "delay_invoice", invoiceId: inv.id, days }];
      return [
        {
          id: `risk_late_${inv.id}`,
          label: `${name} pays its ${short(inv.amount)} invoice due ${day(inv.due, snapshot.asOf)} ${days} days later than usual`,
          probability,
          changes,
          evidence,
        },
      ];
    });
}

// ---------- Non-renewal ----------

/**
 * Only deals explicitly marked renewal with a linked open invoice. Missing kind or link is not
 * evidence; expansions and new business are never treated as renewals.
 */
function nonRenewals(snapshot: Snapshot): Candidate[] {
  return snapshot.deals.flatMap((deal) => {
    if (deal.kind !== "renewal" || typeof deal.invoiceId !== "string" || deal.stage === "lost")
      return [];
    const inv = snapshot.invoices.find((i) => i.id === deal.invoiceId);
    if (!inv || !isOpenInvoice(inv)) return [];
    const unsigned = deal.stage === "won" && !deal.signed;
    const probability = unsigned ? UNSIGNED_RENEWAL_CHANCE : RENEWAL_CHANCE;
    const why = unsigned
      ? `Assumption: documented ${UNSIGNED_RENEWAL_CHANCE} chance because the renewal is marked won but not signed`
      : `Assumption: documented ${RENEWAL_CHANCE} base chance for a renewal; not an observed churn signal`;
    return [
      {
        id: `risk_nonrenewal_${deal.id}`,
        label: `${customerName(snapshot, deal.customerId)} does not renew (${short(inv.amount)} due ${day(inv.due, snapshot.asOf)} lost)`,
        probability,
        changes: [{ kind: "lose_invoice", invoiceId: inv.id }],
        evidence: [
          { source: "crm", ref: deal.id, note: `Renewal deal, stage ${deal.stage}. ${why}` },
          { source: "stripe", ref: inv.id, note: `Linked open invoice due ${inv.due}` },
        ],
      },
    ];
  });
}

// ---------- Spend spike ----------

/** The latest four complete Monday-Sunday weeks on or before asOf, and the four before them. */
export function spendWindows(snapshot: Snapshot): {
  recent: CardTxn[];
  earlier: CardTxn[];
  end: string;
} {
  const nextMonday = weekStarts(snapshot.asOf, 1)[0] ?? snapshot.asOf;
  const end =
    daysBetween(snapshot.asOf, nextMonday) === 1 ? snapshot.asOf : addDays(nextMonday, -8);
  const recentStart = addDays(end, -27);
  const earlierStart = addDays(end, -55);
  const inRange = (from: string, to: string) =>
    snapshot.cardTxns
      .filter((t) => toMs(t.date) >= toMs(from) && toMs(t.date) <= toMs(to))
      .sort((a, b) => (a.date === b.date ? compareIds(a.id, b.id) : a.date < b.date ? -1 : 1));
  return {
    recent: inRange(recentStart, end),
    earlier: inRange(earlierStart, addDays(recentStart, -1)),
    end,
  };
}

/** Growth strictly over 20% of a positive earlier total, compared in integers. */
export function spikeExtra(
  snapshot: Snapshot,
): { extra: number; records: CardTxn[]; end: string } | null {
  const { recent, earlier, end } = spendWindows(snapshot);
  const sum = (t: CardTxn[]) => t.reduce((s, x) => s + x.amount, 0);
  const before = sum(earlier);
  const after = sum(recent);
  if (before <= 0 || 5 * (after - before) <= before) return null;
  return { extra: after - before, records: [...earlier, ...recent], end };
}

/** Card records only, so spending that also appears in bank exports is never counted twice. */
function spendSpike(snapshot: Snapshot): Candidate[] {
  const spike = spikeExtra(snapshot);
  const weekZero = weekStarts(snapshot.asOf, 1)[0];
  if (!spike || !weekZero) return [];
  return [
    {
      id: "risk_spend_spike",
      label: `Card spend keeps running ${short(spike.extra)} above the prior four weeks`,
      probability: SPIKE_CHANCE,
      changes: [
        { kind: "remove_cash", date: weekZero, amount: spike.extra, label: "Card spend spike" },
      ],
      evidence: [
        ...spike.records.map((t) => ({
          source: "ramp" as const,
          ref: t.id,
          note: `${t.merchant} ${money(t.amount)} on ${t.date}`,
        })),
        {
          source: "learned",
          ref: "assumption:spend-spike-chance",
          note: `Assumption: ${SPIKE_CHANCE} is a demo chance, not an estimated rate; the extra is the latest four complete weeks to ${spike.end} minus the four before`,
        },
      ],
    },
  ];
}
