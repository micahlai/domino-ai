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
  firstReceipt,
  overdueUncollected,
  payoutLate,
  payrollGrowth,
  pipelineClose,
  receiptDate,
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
 * Assumption: after a spike, weekly card spend stays this share of the spike's weekly excess
 * above the old level, since a spike usually reflects a new spend level.
 */
const SPIKE_RUN_RATE_PCT = 50;

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
    return { schedule, forecast: f, rules: ruleOutcomes(snapshot, f, constraints, schedule) };
  };
  const base = outcomes([]);
  const candidates = [
    ...latePayments(snapshot, model, base.schedule),
    ...nonRenewals(snapshot, base.schedule),
    ...spendSpike(snapshot),
    ...vendorPriceRises(snapshot),
    ...payrollGrowth(snapshot),
    ...scheduledPayments(snapshot),
    ...concentration(snapshot, model, base.schedule),
    ...overdueUncollected(snapshot, base.schedule),
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
  // The customer a risk is about, so one large customer cannot fill the list on its own.
  const customerOf = new Map(snapshot.invoices.map((i) => [i.id, i.customerId]));
  const subject = (r: RiskEvent) => {
    for (const c of r.changes) {
      if ("invoiceId" in c) return customerOf.get(c.invoiceId) ?? r.id;
      if ("customerId" in c) return c.customerId;
    }
    return r.id;
  };
  return pickDiverse(scored, subject);
}

/**
 * Downside risks: the top risk of each kind first (in score order), then fill by score with
 * at most two of one kind, so one large kind (renewals) cannot crowd out the rest. The best
 * upside event, if any, takes the last slot so the list is not all bad news; it stays last
 * because callers that show only the first few risks expect downside first. A customer
 * (subject) appears at most twice while other risks remain; repeats only fill leftover slots.
 */
export function pickDiverse(
  risks: RiskEvent[],
  subject: (r: RiskEvent) => string = (r) => r.id,
): RiskEvent[] {
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
  const seen = (r: RiskEvent) =>
    picked.filter((p) => subject(p) === subject(r)).length >= MAX_PER_KIND;
  for (const r of downside)
    if (picked.length < room && count(riskKind(r.id)) === 0 && !seen(r)) picked.push(r);
  for (const unique of [true, false])
    for (const r of downside)
      if (
        picked.length < room &&
        !picked.includes(r) &&
        count(riskKind(r.id)) < MAX_PER_KIND &&
        !(unique && seen(r))
      )
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
 * delay is max(0, round(p90) - round(mean)). A customer that starts paying late keeps doing it,
 * so the slip also reaches every later receipt from that customer (delay_customer); the invoice
 * itself keeps its own delay_invoice so single-invoice tools still find it.
 */
function latePayments(snapshot: Snapshot, model: CompanyModel, base: CashSchedule): Candidate[] {
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
      // Later receipts only: the invoice's own slip is its delay_invoice, applied after.
      const after = addDays(receiptDate(base, inv.id) ?? inv.due, 1);
      const changes: Change[] = [
        {
          kind: "delay_customer",
          customerId: inv.customerId,
          days,
          fromDate: after,
          basis: `Learned p90 lateness ${delay.p90} days minus the ${Math.round(delay.mean)} already forecast`,
        },
        { kind: "delay_invoice", invoiceId: inv.id, days },
      ];
      return [
        {
          id: `risk_late_${inv.id}`,
          label: `${name} starts paying ${days} days later than usual with its ${short(inv.amount)} invoice due ${day(inv.due, snapshot.asOf)}, and keeps paying late after`,
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
 * evidence; expansions and new business are never treated as renewals. A customer that does not
 * renew leaves: from the renewal invoice's expected payment on, all its billing stops (churn).
 */
function nonRenewals(snapshot: Snapshot, base: CashSchedule): Candidate[] {
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
    const expected = receiptDate(base, inv.id) ?? inv.due;
    // Churn acts on cash dates from here on; an overdue renewal still expected before it is
    // lost on its own so it is not left in the forecast.
    const leaves = expected > snapshot.asOf ? expected : addDays(snapshot.asOf, 1);
    const changes: Change[] = [
      ...(expected < leaves ? [{ kind: "lose_invoice" as const, invoiceId: inv.id }] : []),
      { kind: "churn", customerId: deal.customerId, fromDate: leaves },
    ];
    const name = customerName(snapshot, deal.customerId);
    const later = firstReceipt(base, deal.customerId, inv.id);
    return [
      {
        id: `risk_nonrenewal_${deal.id}`,
        label: `${name} does not renew and leaves on ${day(leaves, snapshot.asOf)}: its ${short(inv.amount)} renewal and all later billing stop`,
        probability,
        changes,
        evidence: [
          { source: "crm", ref: deal.id, note: `Renewal deal, stage ${deal.stage}. ${why}` },
          {
            source: "stripe",
            ref: inv.id,
            note: `Linked open invoice due ${inv.due}. Every ${name} payment expected from ${leaves} on stops${later !== undefined && later < leaves ? "; earlier payments still arrive" : ""}.`,
          },
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
  // The spike repeats once now, then spend settles at a new, smaller elevated weekly level.
  const weekly = Math.floor((spike.extra * SPIKE_RUN_RATE_PCT) / 100 / 4);
  const changes: Change[] = [
    { kind: "remove_cash", date: weekZero, amount: spike.extra, label: "Card spend spike" },
  ];
  if (weekly > 0)
    changes.push({
      kind: "recurring_cash",
      label: "Card spend new level",
      direction: "out",
      amount: weekly,
      fromDate: addDays(weekZero, 7),
      everyDays: 7,
    });
  return [
    {
      id: "risk_spend_spike",
      label: `Card spend spikes ${short(spike.extra)} again${weekly > 0 ? `, then stays about ${short(weekly)} a week above its old level (assumption)` : ""}`,
      probability: SPIKE_CHANCE,
      changes,
      evidence: [
        ...spike.records.map((t) => ({
          source: "ramp" as const,
          ref: t.id,
          note: `${t.merchant} ${money(t.amount)} on ${t.date}`,
        })),
        {
          source: "learned",
          ref: "assumption:spend-spike-chance",
          note: `Assumption: ${SPIKE_CHANCE} is a demo chance, not an estimated rate; the extra is the latest four complete weeks to ${spike.end} minus the four before. Assumption: afterwards weekly spend stays ${SPIKE_RUN_RATE_PCT}% of the spike's weekly excess above the old level`,
        },
      ],
    },
  ];
}
