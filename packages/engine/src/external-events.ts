import type { Cents, Change, CompanyModel, ISODate, Snapshot } from "@domino/contracts";
import { DRAW_LABEL, REVOLVER_RATE_BPS, interest, unique } from "./cascade";
import { addDays, daysBetween, horizonEnd } from "./dates";
import { type CashSchedule, cashSchedule } from "./forecast";
import type { CashItem } from "./schedule";

/**
 * Outside events (a Fed rate hike, bad press, a downturn, good press, a regulatory fine, a key
 * vendor outage) turned into ordinary persistent Changes, pure and deterministic. The caller
 * supplies bounded parameters (the person's numbers, an AI estimate or the stated defaults);
 * this module clamps them, picks the affected records from the engine's own cash schedule and
 * keeps only changes that move expected cash inside the forecast. It never computes a forecast:
 * the engine does that when the scenario is saved, like any other change list.
 */
export const EXTERNAL_EVENTS_VERSION = "external-events@1.0.0";

export type ExternalEventKind =
  | "rate_hike"
  | "bad_press"
  | "downturn"
  | "good_press"
  | "regulatory_fine"
  | "vendor_outage";

export type ExternalParamName =
  | "rateBps"
  | "slowdownDays"
  | "churnPercent"
  | "billingPercent"
  | "pipelineDays"
  | "prepayDays"
  | "outageDays";

export type ExternalParamBound = {
  min: number;
  max: number;
  default: number;
  /** Plain meaning, for prompts and answers: "days customers pay slower" */
  meaning: string;
};

/** Numbers only. A fine's amount comes from the person, never from an estimate. */
export type ExternalEventParams = Partial<Record<ExternalParamName, number>> & { amount?: Cents };

export type ExternalEventOptions = {
  /** Scenario changes already in place (ancestors), so records are picked where cash now lands */
  priorChanges?: Change[];
  /** Short source tag per parameter ("AI estimate", "Your number"); default "Assumption" */
  sources?: Partial<Record<ExternalParamName, string>>;
};

export type ExternalEventResult = {
  version: typeof EXTERNAL_EVENTS_VERSION;
  kind: ExternalEventKind;
  title: string;
  startDate: ISODate;
  /** Clamped values actually used, one per parameter of this kind */
  params: Partial<Record<ExternalParamName, number>>;
  changes: Change[];
  /** One plain line per modeled effect, with its source tag */
  effects: string[];
  /** What was not modeled and why ("No variable-rate debt is in the books...") */
  notes: string[];
};

export const EXTERNAL_EVENT_PARAMS: Record<
  ExternalEventKind,
  Partial<Record<ExternalParamName, ExternalParamBound>>
> = {
  rate_hike: {
    rateBps: { min: 25, max: 300, default: 25, meaning: "rate increase in basis points" },
    slowdownDays: { min: 5, max: 45, default: 5, meaning: "days customers pay slower" },
    pipelineDays: { min: 0, max: 45, default: 14, meaning: "days new-deal closings slip" },
  },
  bad_press: {
    churnPercent: {
      min: 0,
      max: 25,
      default: 5,
      meaning: "percent of recurring revenue that cancels, most at-risk customers first",
    },
    pipelineDays: { min: 0, max: 45, default: 21, meaning: "days new-deal closings slip" },
    prepayDays: {
      min: 0,
      max: 30,
      default: 14,
      meaning: "days earlier vendors want to be paid (tighter terms)",
    },
  },
  downturn: {
    slowdownDays: { min: 5, max: 45, default: 14, meaning: "days customers pay slower" },
    billingPercent: {
      min: -30,
      max: 0,
      default: -10,
      meaning: "percent change in recurring billing as renewals shrink (negative)",
    },
  },
  good_press: {
    billingPercent: {
      min: 0,
      max: 30,
      default: 5,
      meaning: "percent growth in recurring billing",
    },
    pipelineDays: {
      min: -30,
      max: 0,
      default: -7,
      meaning: "days new-deal payments arrive earlier (negative)",
    },
  },
  regulatory_fine: {},
  vendor_outage: {
    outageDays: { min: 1, max: 30, default: 7, meaning: "days the vendor outage holds receipts" },
  },
};

const TITLES: Record<ExternalEventKind, string> = {
  rate_hike: "Fed rate hike",
  bad_press: "Bad press",
  downturn: "Market downturn",
  good_press: "Positive press",
  regulatory_fine: "Regulatory fine",
  vendor_outage: "Key vendor outage",
};

const MAX_CHANGES = 16; // a chat proposal holds at most 16 changes
const MAX_PAYERS = 8;
const MAX_PIPELINE = 4;
const MAX_CHURN = 5;
const MAX_PREPAY = 3;
/** Interest, loan or credit line payments: treated as floating-rate debt service. */
const DEBT_SERVICE =
  /\binterest\b|\bloan\b|credit line|line of credit|revolver|\bsofr\b|\bprime\b|floating|variable rate|term debt/i;

/** Clamp to the kind's bounds, whole numbers; parameters a kind does not use are dropped. */
export function clampExternalParams(
  kind: ExternalEventKind,
  params: ExternalEventParams,
): Partial<Record<ExternalParamName, number>> {
  const out: Partial<Record<ExternalParamName, number>> = {};
  for (const [name, bound] of Object.entries(EXTERNAL_EVENT_PARAMS[kind]) as [
    ExternalParamName,
    ExternalParamBound,
  ][]) {
    const raw = params[name];
    const value = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : bound.default;
    out[name] = Math.min(bound.max, Math.max(bound.min, value));
  }
  return out;
}

export function externalEventChanges(
  snapshot: Snapshot,
  model: CompanyModel,
  kind: ExternalEventKind,
  params: ExternalEventParams,
  startDate: ISODate,
  options: ExternalEventOptions = {},
): ExternalEventResult {
  const prior = options.priorChanges ?? [];
  const p = clampExternalParams(kind, params);
  const tag = (name: ExternalParamName) => options.sources?.[name] ?? "Assumption";
  const schedule = cashSchedule(snapshot, model, prior);
  const end = horizonEnd(schedule.weeks);
  const start = startDate > snapshot.asOf ? startDate : addDays(snapshot.asOf, 1);
  const title = TITLES[kind];
  const effects: string[] = [];
  const notes: string[] = [];
  const candidates: Change[] = [];
  const taken = [...prior];
  const label = (text: string) => unique(taken, text.slice(0, 200));
  const add = (change: Change) => {
    candidates.push(change);
    taken.push(change);
  };
  const receipts = schedule.items.filter(
    (i) => isReceipt(i) && i.amount > 0 && i.date >= start && i.date <= end,
  );
  const name = (id: string) => snapshot.customers.find((c) => c.id === id)?.name ?? id;

  const slowdown = (days: number, why: string) => {
    if (days <= 0) return;
    const payers = topCustomers(receipts, MAX_PAYERS);
    for (const customerId of payers)
      add({
        kind: "delay_customer",
        customerId,
        days,
        fromDate: start,
        basis: `${tag("slowdownDays")}: ${why}, so customers pay ${days} days slower`,
      });
    if (payers.length)
      effects.push(
        `${tag("slowdownDays")}: the ${payers.length} largest payers pay ${days} days slower`,
      );
  };
  const pipeline = (days: number, why: string) => {
    if (days === 0) return;
    const deals = receipts.filter((i) => i.kind === "deal");
    const ids = topCustomers(deals, MAX_PIPELINE);
    let moved = 0;
    for (const customerId of ids) {
      // Earlier payments never move before the event starts.
      const first =
        receipts
          .filter((i) => i.customerId === customerId)
          .map((i) => i.date)
          .sort()[0] ?? start;
      const shift = days > 0 ? days : -Math.min(-days, daysBetween(start, first));
      if (shift === 0) continue;
      moved++;
      add({
        kind: "delay_customer",
        customerId,
        days: shift,
        fromDate: start,
        basis: `${tag("pipelineDays")}: ${why}, so ${name(customerId)}'s new-deal payments arrive ${Math.abs(shift)} days ${shift > 0 ? "later" : "sooner"}`,
      });
    }
    if (moved)
      effects.push(
        `${tag("pipelineDays")}: ${moved} new ${moved === 1 ? "deal closes" : "deals close"} ${Math.abs(days)} days ${days > 0 ? "later" : "sooner"}`,
      );
    else
      notes.push("No signed new deals are expected in these weeks, so the pipeline is unchanged.");
  };
  const billing = (percent: number, why: string) => {
    if (percent === 0) return;
    if (!receipts.some((i) => i.kind === "plan")) {
      notes.push("No recurring billing is scheduled in these weeks, so billing is unchanged.");
      return;
    }
    add({
      kind: "scale_recurring",
      label: label(`${title}: ${why} (${tag("billingPercent")})`),
      flows: "billing",
      names: [],
      percent,
      fromDate: start,
    });
    effects.push(
      `${tag("billingPercent")}: recurring billing ${percent < 0 ? "down" : "up"} ${Math.abs(percent)}%`,
    );
  };

  switch (kind) {
    case "rate_hike": {
      const bps = p.rateBps ?? 0;
      const draws = prior.filter(
        (c): c is Extract<Change, { kind: "add_cash" }> =>
          c.kind === "add_cash" && DRAW_LABEL.test(c.label) && c.date <= end,
      );
      const drawn = draws.reduce((s, c) => s + c.amount, 0);
      const firstDraw = draws.map((c) => c.date).sort()[0];
      const monthly = interest(drawn, BigInt(bps), 30);
      const interestFrom = firstDraw ? addDays(firstDraw > start ? firstDraw : start, 30) : null;
      if (monthly > 0 && interestFrom && interestFrom <= end) {
        add({
          kind: "recurring_cash",
          label: label(`Higher credit line interest after a ${bps} bp rate hike`),
          direction: "out",
          amount: monthly,
          fromDate: interestFrom,
          everyDays: 30,
        });
        effects.push(
          `${tag("rateBps")}: ${bps} bp more interest on the drawn credit line, paid monthly`,
        );
      }
      const debtNames = [
        ...new Set([
          ...snapshot.bills
            .filter((b) => b.paid === undefined && DEBT_SERVICE.test(b.vendor))
            .map((b) => b.vendor),
          ...model.recurringSpend.filter((r) => DEBT_SERVICE.test(r.label)).map((r) => r.label),
        ]),
      ];
      if (debtNames.length) {
        // Floating interest moves in proportion: +bps on an assumed ~8% current rate.
        const percent = Math.round((bps * 10_000) / Number(REVOLVER_RATE_BPS)) / 100;
        add({
          kind: "scale_recurring",
          label: label(`Floating-rate interest after a ${bps} bp hike (assumes ~8% today)`),
          flows: "spend",
          names: debtNames,
          percent,
          fromDate: start,
        });
        effects.push(
          `${tag("rateBps")}: interest payments (${debtNames.slice(0, 3).join(", ")}) up ${percent}%, assuming they float at about 8% today`,
        );
      }
      slowdown(p.slowdownDays ?? 0, `a ${bps} bp rate hike tightens customers' cash`);
      pipeline(p.pipelineDays ?? 0, "higher borrowing costs slow buying decisions");
      break;
    }
    case "bad_press": {
      const churned = atRiskCustomers(snapshot, model, schedule, start, end, p.churnPercent ?? 0);
      for (const c of churned) add({ kind: "churn", customerId: c.customerId, fromDate: c.from });
      if (churned.length)
        effects.push(
          `${tag("churnPercent")}: ${churned.map((c) => name(c.customerId)).join(", ")} (the latest payers and smallest renewals, about ${p.churnPercent}% of recurring revenue) cancel at their next renewal`,
        );
      else if ((p.churnPercent ?? 0) > 0)
        notes.push(
          `No at-risk customer is small enough to fit ${p.churnPercent}% of recurring revenue, so nobody cancels.`,
        );
      pipeline(p.pipelineDays ?? 0, "prospects hesitate after the bad press");
      const prepay = p.prepayDays ?? 0;
      if (prepay > 0) {
        const bills = schedule.items
          .filter((i) => {
            if (i.kind !== "bill" || i.amount >= 0 || i.date > end) return false;
            const bill = snapshot.bills.find((b) => b.id === i.id);
            return (
              bill && !bill.critical && bill.paid === undefined && addDays(i.date, -prepay) >= start
            );
          })
          .sort((a, b) => a.amount - b.amount || cmp(a.id, b.id))
          .slice(0, MAX_PREPAY);
        for (const b of bills) add({ kind: "delay_bill", billId: b.id, days: -prepay });
        if (bills.length)
          effects.push(
            `${tag("prepayDays")}: ${bills.length} larger vendors want payment ${prepay} days sooner`,
          );
      }
      break;
    }
    case "downturn":
      slowdown(p.slowdownDays ?? 0, "in a downturn customers stretch their own payables");
      billing(p.billingPercent ?? 0, "renewals shrink in the downturn");
      break;
    case "good_press":
      billing(p.billingPercent ?? 0, "new business grows after the coverage");
      pipeline(p.pipelineDays ?? 0, "the coverage speeds up open deals");
      break;
    case "regulatory_fine": {
      const amount = params.amount;
      if (amount !== undefined && Number.isSafeInteger(amount) && amount > 0 && start <= end) {
        add({ kind: "remove_cash", date: start, amount, label: label("Regulatory fine") });
        effects.push("Your number: a one-time fine is paid when the event starts");
      } else notes.push("A fine needs an amount, like $250,000.");
      break;
    }
    case "vendor_outage": {
      const days = p.outageDays ?? 0;
      const until = addDays(start, days);
      const held = receipts.filter((i) => i.kind === "invoice" && i.date < until);
      for (const i of held.slice(0, MAX_CHANGES))
        add({ kind: "delay_invoice", invoiceId: i.id, days: daysBetween(i.date, until) });
      if (held.length)
        effects.push(
          `${tag("outageDays")}: ${held.length} invoice ${held.length === 1 ? "payment is" : "payments are"} held until the ${days}-day outage ends`,
        );
      notes.push(
        "Projected recurring bills and payouts are not delayed; only issued invoices are.",
      );
      break;
    }
  }
  const changes = effective(snapshot, model, prior, candidates, end).slice(0, MAX_CHANGES);
  if (changes.length < candidates.length)
    notes.push("Changes that would not move cash inside these 13 weeks were left out.");
  return {
    version: EXTERNAL_EVENTS_VERSION,
    kind,
    title,
    startDate: start,
    params: p,
    changes,
    effects,
    notes,
  };
}

const isReceipt = (i: CashItem) => i.kind === "invoice" || i.kind === "deal" || i.kind === "plan";
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Customers by expected receipts in these items, largest first. */
function topCustomers(items: CashItem[], n: number): string[] {
  const by = new Map<string, number>();
  for (const i of items)
    if (i.customerId) by.set(i.customerId, (by.get(i.customerId) ?? 0) + i.amount);
  return [...by.entries()]
    .sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))
    .slice(0, n)
    .map(([id]) => id);
}

/**
 * Most at-risk recurring customers first (slowest learned payers, then smallest), added while
 * their share of recurring revenue stays near the target. Each cancels from its next recurring
 * bill (renewal) in the horizon. Without billing plans, all expected receipts count.
 */
function atRiskCustomers(
  snapshot: Snapshot,
  model: CompanyModel,
  schedule: CashSchedule,
  start: ISODate,
  end: ISODate,
  percent: number,
): { customerId: string; from: ISODate }[] {
  if (percent <= 0) return [];
  const items = schedule.items.filter((i) => isReceipt(i) && i.amount > 0 && i.date >= start);
  const plans = items.filter((i) => i.kind === "plan");
  const base = plans.length ? plans : items.filter((i) => i.date <= end);
  const revenue = new Map<string, number>();
  for (const i of base)
    if (i.customerId) revenue.set(i.customerId, (revenue.get(i.customerId) ?? 0) + i.amount);
  const total = [...revenue.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  const lateness = (id: string) => model.customerDelayDays[id]?.mean ?? 0;
  const ranked = [...revenue.entries()].sort(
    (a, b) => lateness(b[0]) - lateness(a[0]) || a[1] - b[1] || cmp(a[0], b[0]),
  );
  const target = (total * percent) / 100;
  const out: { customerId: string; from: ISODate }[] = [];
  let sum = 0;
  for (const [customerId, amount] of ranked) {
    if (out.length >= MAX_CHURN) break;
    // Round to the nearest customer: include one if it brings the share closer to the target.
    if (sum + amount / 2 > target) continue;
    const from = base
      .filter((i) => i.customerId === customerId && i.date <= end)
      .map((i) => i.date)
      .sort()[0];
    if (!from) continue;
    if (!snapshot.customers.some((c) => c.id === customerId)) continue;
    out.push({ customerId, from });
    sum += amount;
  }
  return out;
}

/**
 * Keep, in order, only changes that move expected cash dated inside the forecast and never move
 * cash onto or before the books' date, the same effect rules a saved scenario must pass.
 */
function effective(
  snapshot: Snapshot,
  model: CompanyModel,
  prior: Change[],
  candidates: Change[],
  end: ISODate,
): Change[] {
  const key = (i: CashItem) => `${i.kind}:${i.id}:${i.date}:${i.amount}`;
  const kept: Change[] = [];
  let before = cashSchedule(snapshot, model, prior).items;
  for (const change of candidates) {
    let after: CashItem[];
    try {
      after = cashSchedule(snapshot, model, [...prior, ...kept, change]).items;
    } catch {
      continue;
    }
    const was = new Set(before.map(key));
    const now = new Set(after.map(key));
    const inside = (i: CashItem) => i.date <= end;
    const changed =
      after.some((i) => inside(i) && !was.has(key(i))) ||
      before.some((i) => inside(i) && !now.has(key(i)));
    const intoHistory = after.some((i) => i.date <= snapshot.asOf && !was.has(key(i)));
    if (!changed || intoHistory) continue;
    kept.push(change);
    before = after;
  }
  return kept;
}
