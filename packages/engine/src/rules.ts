import type {
  Bill,
  Cents,
  Change,
  CompanyModel,
  Constraint,
  Evidence,
  Forecast,
  ISODate,
  Snapshot,
} from "@domino/contracts";
import { addDays, horizonEnd } from "./dates";
import { type CashSchedule, cashSchedule, forecastFromSchedule } from "./forecast";
import { compareIds, fundingDays } from "./funding";
import { decimalRatio } from "./money";
import { bucketOf } from "./schedule";

/** C1 calculation context: the complete ordered scenario, each change exactly once. */
export type RuleContext = { model: CompanyModel; changes: Change[] };

type BreachBase = {
  constraintId: string;
  /** The day the rule is first observed broken (a weekly close for weekly rules) */
  date: ISODate;
  /** Forecast week index; overdue deadlines land in week 0 */
  week: number;
  weekStart: ISODate;
  evidence: Evidence[];
};
export type RuleBreach =
  | (BreachBase & { kind: "min_cash" | "min_runway_months"; usable: Cents })
  | (BreachBase & { kind: "pay_by_date"; bill: Bill; deadline: ISODate; fundedOn?: ISODate });

/**
 * clear = no breach observed within the 13 weeks (not proof of later compliance);
 * beyond_horizon = a pay_by_date deadline after the last forecast Sunday, so not evaluated.
 */
export type RuleResult = {
  constraint: Constraint;
  status: "breached" | "clear" | "beyond_horizon";
  breach?: RuleBreach;
};

/**
 * Shared rule evaluator for dominoes and stressTest. Without context only weekly min_cash
 * can be evaluated; any other requested rule throws rather than being reported as passing.
 * With context, the forecast must be the one the context's schedule produces.
 */
export function evaluateRules(
  snapshot: Snapshot,
  forecast: Forecast,
  constraints: Constraint[],
  context?: RuleContext,
): RuleResult[] {
  const schedule = context ? verifiedSchedule(snapshot, forecast, context) : null;
  return evaluateOnSchedule(snapshot, forecast, constraints, schedule);
}

/** The context's cash schedule, after checking it yields exactly `forecast`. */
export function verifiedSchedule(
  snapshot: Snapshot,
  forecast: Forecast,
  context: RuleContext,
): CashSchedule {
  const schedule = cashSchedule(snapshot, context.model, context.changes);
  if (!sameForecast(forecastFromSchedule(snapshot, schedule), forecast)) {
    throw new Error("forecast does not match the snapshot, model and changes in the context");
  }
  return schedule;
}

/** Evaluate against an already built schedule (null = no context: weekly min_cash only). */
export function evaluateOnSchedule(
  snapshot: Snapshot,
  forecast: Forecast,
  constraints: Constraint[],
  schedule: CashSchedule | null,
): RuleResult[] {
  checkConstraints(snapshot, constraints, schedule !== null);
  let funded: Map<string, ISODate> | undefined;
  return constraints.map((constraint) => {
    if (constraint.kind === "pay_by_date" && schedule) {
      funded ??= fundingDays(snapshot, schedule);
      return payByDate(constraint, snapshot, schedule, funded);
    }
    const breach = weeklyBreach(constraint, snapshot, forecast);
    return { constraint, status: breach ? "breached" : "clear", ...(breach ? { breach } : {}) };
  });
}

/** Earliest breach first; ties go to the lower constraint ID. */
export function compareBreaches(a: RuleBreach, b: RuleBreach): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return compareIds(a.constraintId, b.constraintId);
}

function checkConstraints(snapshot: Snapshot, constraints: Constraint[], hasContext: boolean) {
  const ids = new Set<string>();
  for (const c of constraints) {
    if (ids.has(c.id)) throw new Error(`duplicate constraint id ${c.id}`);
    ids.add(c.id);
    if (c.kind !== "min_cash" && !hasContext) {
      throw new Error(
        `constraint ${c.id} (${c.kind}) needs calculation context (model and changes); only min_cash can be checked without it`,
      );
    }
    if (c.kind === "pay_by_date") targetBill(snapshot, c);
  }
}

function targetBill(snapshot: Snapshot, c: Constraint): Bill {
  if (c.billId === undefined) {
    throw new Error(`constraint ${c.id}: pay_by_date has no billId, so it cannot be evaluated`);
  }
  const bill = snapshot.bills.find((b) => b.id === c.billId);
  if (!bill) throw new Error(`constraint ${c.id}: unknown bill ${c.billId}`);
  return bill;
}

/** min_cash and min_runway_months read only weekly closes, so they work on any forecast. */
export function weeklyBreach(
  c: Constraint,
  snapshot: Snapshot,
  forecast: Forecast,
): RuleBreach | undefined {
  if (c.kind === "pay_by_date") throw new Error(`constraint ${c.id}: pay_by_date is not weekly`);
  const below = c.kind === "min_cash" ? belowMinCash(c.limit) : belowRunway(c.limit, forecast);
  const week = below ? forecast.weeks.findIndex((w) => below(w.usable)) : -1;
  const w = forecast.weeks[week];
  if (!w) return undefined;
  return {
    kind: c.kind,
    constraintId: c.id,
    date: addDays(w.weekStart, 6),
    week,
    weekStart: w.weekStart,
    evidence: [c.evidence],
    usable: w.usable,
  };
}

/** Strictly below the limit at a weekly close. Not proof of continuous daily compliance. */
const belowMinCash = (limit: number) => (usable: Cents) => usable < limit;

/**
 * Runway = usable / (13-week net outflow / 3 months). Compared exactly:
 * usable / (burn / 3) < num / den  <=>  3 * usable * den < num * burn, with burn, den > 0.
 * Nonpositive burn never breaks the rule.
 */
function belowRunway(limit: number, forecast: Forecast) {
  const burn = forecast.weeks.reduce((sum, w) => sum + BigInt(w.outflow) - BigInt(w.inflow), 0n);
  if (burn <= 0n) return undefined;
  const { num, den } = decimalRatio(limit);
  return (usable: Cents) => 3n * BigInt(usable) * den < num * burn;
}

/**
 * Target = original bill due date + allowed late days, even when a change delays payment.
 * The bill fails if it is not funded by the end of that day; later funding cannot cure it.
 */
function payByDate(
  constraint: Constraint,
  snapshot: Snapshot,
  schedule: CashSchedule,
  funded: Map<string, ISODate>,
): RuleResult {
  const bill = targetBill(snapshot, constraint);
  if (bill.paid) return { constraint, status: "clear" };
  const deadline = addDays(bill.due, constraint.limit);
  if (deadline > horizonEnd(schedule.weeks)) return { constraint, status: "beyond_horizon" };
  const fundedOn = funded.get(bill.id);
  // A deadline on or before asOf can never be met: replay starts at asOf + 1.
  if (fundedOn !== undefined && fundedOn <= deadline) return { constraint, status: "clear" };
  const week = bucketOf(deadline, schedule.weeks) ?? 0;
  const breach: RuleBreach = {
    kind: "pay_by_date",
    constraintId: constraint.id,
    date: deadline,
    week,
    weekStart: schedule.weeks[week] ?? deadline,
    evidence: [constraint.evidence, billEvidence(bill, deadline, snapshot.asOf, fundedOn)],
    bill,
    deadline,
    ...(fundedOn ? { fundedOn } : {}),
  };
  return { constraint, status: "breached", breach };
}

function billEvidence(bill: Bill, deadline: ISODate, asOf: ISODate, fundedOn?: ISODate): Evidence {
  const note =
    deadline <= asOf
      ? `Unpaid and already past its ${deadline} deadline`
      : fundedOn
        ? `Projected to be funded on ${fundedOn}, after its ${deadline} deadline`
        : `Not projected to be funded by its ${deadline} deadline`;
  return { source: "books", ref: bill.id, note };
}

function sameForecast(a: Forecast, b: Forecast): boolean {
  const keys = ["weekStart", "opening", "inflow", "outflow", "closing", "usable"] as const;
  return (
    a.weeks.length === b.weeks.length &&
    a.weeks.every((w, i) => keys.every((k) => w[k] === b.weeks[i]?.[k])) &&
    a.lowPoint.weekStart === b.lowPoint.weekStart &&
    a.lowPoint.usable === b.lowPoint.usable
  );
}
