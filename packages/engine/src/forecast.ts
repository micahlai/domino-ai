import type {
  Change,
  CompanyModel,
  Forecast,
  ForecastWeek,
  ISODate,
  Snapshot,
} from "@domino/contracts";
import { applyChanges } from "./changes";
import { weekStarts } from "./dates";
import { type CashItem, baseSchedule, bucketOf } from "./schedule";

const WEEKS = 13;

/** The dated cash schedule after `changes`. forecast and the rule evaluator both read this. */
export type CashSchedule = { weeks: ISODate[]; items: CashItem[] };

export function cashSchedule(
  snapshot: Snapshot,
  model: CompanyModel,
  changes: Change[],
): CashSchedule {
  const weeks = weekStarts(snapshot.asOf, WEEKS);
  const items = applyChanges(baseSchedule(snapshot, model, weeks), changes, snapshot, weeks);
  return { weeks, items };
}

/** Build-spec §6.1: 13 weekly buckets of the dated cash schedule after `changes`. */
export function forecast(snapshot: Snapshot, model: CompanyModel, changes: Change[]): Forecast {
  return forecastFromSchedule(snapshot, cashSchedule(snapshot, model, changes));
}

/** Refuses a total that would silently lose cents beyond the safe integer range. */
function safeSum(a: number, b: number): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) throw new Error(`unsafe cash total: ${a} + ${b}`);
  return sum;
}

export function forecastFromSchedule(snapshot: Snapshot, schedule: CashSchedule): Forecast {
  const starts = schedule.weeks;
  const inflow = new Array<number>(starts.length).fill(0);
  const outflow = new Array<number>(starts.length).fill(0);
  for (const item of schedule.items) {
    const i = bucketOf(item.date, starts);
    if (i === null) continue;
    if (item.amount >= 0) inflow[i] = safeSum(inflow[i] ?? 0, item.amount);
    else outflow[i] = safeSum(outflow[i] ?? 0, -item.amount);
  }
  let opening = snapshot.cashOnHand;
  const weeks: ForecastWeek[] = starts.map((weekStart, i) => {
    // Balances inside the week lie between opening - outflow and opening + inflow.
    safeSum(opening, -(outflow[i] ?? 0));
    const closing = safeSum(safeSum(opening, inflow[i] ?? 0), -(outflow[i] ?? 0));
    const week = {
      weekStart,
      opening,
      inflow: inflow[i] ?? 0,
      outflow: outflow[i] ?? 0,
      closing,
      usable: safeSum(closing, -snapshot.restrictedCash),
    };
    opening = closing;
    return week;
  });
  // Ties go to the earliest week.
  const low = weeks.reduce((a, b) => (b.usable < a.usable ? b : a));
  return { weeks, lowPoint: { weekStart: low.weekStart, usable: low.usable } };
}
