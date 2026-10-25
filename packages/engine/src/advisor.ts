import type {
  Change,
  CompanyModel,
  Constraint,
  FixCandidate,
  Invoice,
  Snapshot,
} from "@domino/contracts";
import { addDays, horizonEnd } from "./dates";
import { cashSchedule, forecastFromSchedule } from "./forecast";
import { survivalBreach } from "./stress-test";

/**
 * Advisor swarm (pure). When a stress scenario takes usable cash below the lender's minimum, the
 * analyst compares several candidate fixes, one advisor per candidate: draw on a credit line,
 * delay non-critical bills, accelerate collections, defer planned hires. Candidates come from the
 * snapshot's own records; adviseFix computes each one's engine effect under the scenario (cash at
 * the low point, survives or not). Integer cents only, no clock, no randomness, no network.
 * Nothing here decides or moves money: a person accepts or declines a suggestion.
 */

export const ADVISOR_FIXES = [
  "credit_line_draw",
  "delay_bill",
  "accelerate_collections",
  "defer_hires",
] as const;
export type AdvisorFixKind = (typeof ADVISOR_FIXES)[number];

export interface AdvisorInput {
  snapshot: Snapshot;
  model: CompanyModel;
  constraints: Constraint[];
  scenario: { id: string; label: string; changes: Change[] };
}

export type AdvisorCandidate = { kind: AdvisorFixKind; fix: FixCandidate };

export type ScenarioLow = {
  /** Usable cash at the scenario's low point, cents. */
  low: number;
  lowWeekStart: string;
  /** The lender's minimum (min_cash limit), cents; undefined when the company has none. */
  floor: number | undefined;
  /** True when the low point is below the lender's minimum. */
  belowMinimum: boolean;
  breaksAt?: string;
  brokenConstraintId?: string;
};

export type AdvisorEffect = {
  kind: AdvisorFixKind;
  fixId: string;
  /** Usable cash at the low point with the fix applied, cents. */
  lowPoint: number;
  lowWeekStart: string;
  /** No min_cash or pay_by_date breach in the 13 weeks with the fix. */
  survives: boolean;
  /** lowPoint minus the scenario's own low point, cents. */
  gain: number;
  breaksAt?: string;
  brokenConstraintId?: string;
};

const MAX_ITEMS = 40;
const ROUND_DRAW = 5_000_000;
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const sum = (rows: { amount: number }[]) => rows.reduce((n, r) => n + r.amount, 0);

/** "$1.25M", "$340K", "$85": labels only; values stay integer cents. */
function short(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const c = cents < 0 ? -cents : cents;
  if (c >= 100_000_000) {
    const hundredths = Math.round(c / 1_000_000);
    return `${sign}$${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, "0")}M`;
  }
  if (c >= 100_000) return `${sign}$${Math.round(c / 100_000)}K`;
  return `${sign}$${Math.round(c / 100)}`;
}

export const lenderMinimum = (constraints: Constraint[]) =>
  constraints
    .filter((c) => c.kind === "min_cash")
    .reduce<number | undefined>(
      (m, c) => (m === undefined || c.limit > m ? c.limit : m),
      undefined,
    );

function run(input: AdvisorInput, extra: Change[]) {
  const { snapshot, model, constraints, scenario } = input;
  const schedule = cashSchedule(snapshot, model, [...scenario.changes, ...extra]);
  const forecast = forecastFromSchedule(snapshot, schedule);
  const breach = survivalBreach(snapshot, constraints, schedule);
  return { forecast, breach, weeks: schedule.weeks };
}

/** The scenario on its own: its low point and whether it is below the lender's minimum. */
export function scenarioLow(input: AdvisorInput): ScenarioLow {
  const { forecast, breach } = run(input, []);
  const floor = lenderMinimum(input.constraints);
  const low = forecast.lowPoint.usable;
  return {
    low,
    lowWeekStart: forecast.lowPoint.weekStart,
    floor,
    belowMinimum: floor !== undefined && low < floor,
    ...(breach && { breaksAt: breach.weekStart, brokenConstraintId: breach.constraintId }),
  };
}

/** Invoices and customers the scenario already changes; a fix leaves them alone. */
function touched(changes: Change[]) {
  const invoices = new Set<string>();
  const customers = new Set<string>();
  const bills = new Set<string>();
  for (const c of changes) {
    if (c.kind === "lose_invoice" || c.kind === "delay_invoice" || c.kind === "discount_early_pay")
      invoices.add(c.invoiceId);
    else if (c.kind === "churn") customers.add(c.customerId);
    else if (c.kind === "delay_bill") bills.add(c.billId);
  }
  return { invoices, customers, bills };
}

/**
 * Candidate fixes for a scenario below the lender's minimum, in ADVISOR_FIXES order. A kind the
 * records cannot support is left out (no holdable bills, no open invoices to collect early, no
 * planned hires in the scenario). Returns [] when the scenario stays above the minimum.
 */
export function advisorCandidates(input: AdvisorInput): AdvisorCandidate[] {
  const { snapshot: s, scenario } = input;
  const low = scenarioLow(input);
  if (!low.belowMinimum || low.floor === undefined) return [];
  const { weeks } = run(input, []);
  const end = horizonEnd(weeks);
  const target = [scenario.id];
  const skip = touched(scenario.changes);
  const out: AdvisorCandidate[] = [];
  const add = (
    kind: AdvisorFixKind,
    fix: Omit<FixCandidate, "id" | "evidence" | "targetRiskIds">,
  ) =>
    out.push({ kind, fix: { id: `advise_${kind}`, evidence: [], targetRiskIds: target, ...fix } });

  const weekOf = (date: string) => {
    const i = weeks.indexOf(date);
    return i >= 0 ? i + 1 : 1;
  };
  const breakWeek = low.breaksAt ?? low.lowWeekStart;
  const need = Math.ceil((low.floor - low.low) / ROUND_DRAW) * ROUND_DRAW;
  const drawOn = addDays(breakWeek, -7) > s.asOf ? addDays(breakWeek, -7) : addDays(s.asOf, 1);
  add("credit_line_draw", {
    label: `Draw ${short(need)} on a credit line before week ${weekOf(breakWeek)}`,
    changes: [{ kind: "add_cash", date: drawOn, amount: need, label: "Credit line draw" }],
    costNote: `Covers the ${short(low.floor - low.low)} gap to the lender's minimum; assumes a credit line is available (none is in the books) and costs interest until repaid`,
    risk: "medium",
  });

  const bills = s.bills
    .filter(
      (b) => !b.paid && !b.critical && b.due > s.asOf && b.due <= end && !skip.bills.has(b.id),
    )
    .sort((a, b) => (a.due === b.due ? byId(a, b) : a.due < b.due ? -1 : 1))
    .slice(0, MAX_ITEMS);
  if (bills.length > 0)
    add("delay_bill", {
      label: `Delay ${bills.length} non-critical vendor bill${bills.length === 1 ? "" : "s"} 30 days`,
      changes: bills.map((b) => ({ kind: "delay_bill" as const, billId: b.id, days: 30 })),
      costNote: `Moves ${short(sum(bills))} of bills out 30 days; vendors may charge late fees`,
      risk: "medium",
    });

  const payOn = addDays(s.asOf, 7);
  const early = s.invoices
    .filter(
      (i: Invoice) =>
        i.paid === undefined &&
        i.writtenOff === undefined &&
        !i.collection &&
        i.due > payOn &&
        i.due <= end &&
        !skip.invoices.has(i.id) &&
        !skip.customers.has(i.customerId),
    )
    .sort((a, b) => b.amount - a.amount || byId(a, b))
    .slice(0, 3);
  if (early.length > 0)
    add("accelerate_collections", {
      label: `Offer 2% to collect ${early.length} invoice${early.length === 1 ? "" : "s"} (${short(sum(early))}) next week`,
      changes: early.map((i) => ({
        kind: "discount_early_pay" as const,
        invoiceId: i.id,
        percent: 2,
        payOn,
      })),
      costNote: `Gives up about ${short(Math.floor((sum(early) * 2) / 100))} in early-payment discounts`,
      risk: "low",
    });

  const hires = scenario.changes.filter(
    (c): c is Extract<Change, { kind: "remove_cash" }> =>
      c.kind === "remove_cash" && /hire/i.test(c.label),
  );
  const perRun = hires[0]?.amount ?? 0;
  if (perRun > 0)
    add("defer_hires", {
      label: "Defer the planned hires to next quarter",
      changes: [
        {
          kind: "shift_hire",
          label: "Deferred hires",
          monthlyCost: perRun * 2,
          fromDate: addDays(s.asOf, 1),
          toDate: end,
        },
      ],
      costNote: "Slower growth: the planned hires start next quarter",
      risk: "low",
    });
  return out;
}

/** One advisor's engine work: the scenario with this fix applied. */
export function adviseFix(input: AdvisorInput, candidate: AdvisorCandidate): AdvisorEffect {
  const base = run(input, []).forecast.lowPoint.usable;
  const { forecast, breach } = run(input, candidate.fix.changes);
  return {
    kind: candidate.kind,
    fixId: candidate.fix.id,
    lowPoint: forecast.lowPoint.usable,
    lowWeekStart: forecast.lowPoint.weekStart,
    survives: !breach,
    gain: forecast.lowPoint.usable - base,
    ...(breach && { breaksAt: breach.weekStart, brokenConstraintId: breach.constraintId }),
  };
}

/**
 * Engine order of advisor results: surviving fixes first, lower risk first, then the larger gain,
 * then ADVISOR_FIXES order. Used to order suggestions; CREAO picks the recommendation.
 */
export function rankAdvice(
  results: { candidate: AdvisorCandidate; effect: AdvisorEffect }[],
): { candidate: AdvisorCandidate; effect: AdvisorEffect }[] {
  const RISK = { low: 0, medium: 1, high: 2 } as const;
  return [...results].sort(
    (a, b) =>
      Number(b.effect.survives) - Number(a.effect.survives) ||
      RISK[a.candidate.fix.risk] - RISK[b.candidate.fix.risk] ||
      b.effect.gain - a.effect.gain ||
      ADVISOR_FIXES.indexOf(a.candidate.kind) - ADVISOR_FIXES.indexOf(b.candidate.kind),
  );
}
