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
import { recurringBillingItems } from "./recurring-revenue";
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
  // Additive hook: unbilled plan occurrences (none when a snapshot has no billing plans).
  const base = [
    ...baseSchedule(snapshot, model, weeks),
    ...recurringBillingItems(snapshot, model, weeks),
  ];
  const items = applyChanges(base, changes, snapshot, weeks);
  return { weeks, items };
}

/** Build-spec §6.1: 13 weekly buckets of the dated cash schedule after `changes`. */
export function forecast(snapshot: Snapshot, model: CompanyModel, changes: Change[]): Forecast {
  return forecastFromSchedule(snapshot, cashSchedule(snapshot, model, changes));
}

export function forecastFromSchedule(snapshot: Snapshot, schedule: CashSchedule): Forecast {
  const starts = schedule.weeks;
  const inflow = new Array<number>(starts.length).fill(0);
  const outflow = new Array<number>(starts.length).fill(0);
  for (const item of schedule.items) {
    const i = bucketOf(item.date, starts);
    if (i === null) continue;
    if (item.amount >= 0) inflow[i] = (inflow[i] ?? 0) + item.amount;
    else outflow[i] = (outflow[i] ?? 0) - item.amount;
  }
  let opening = snapshot.cashOnHand;
  const weeks: ForecastWeek[] = starts.map((weekStart, i) => {
    const closing = opening + (inflow[i] ?? 0) - (outflow[i] ?? 0);
    const week = {
      weekStart,
      opening,
      inflow: inflow[i] ?? 0,
      outflow: outflow[i] ?? 0,
      closing,
      usable: closing - snapshot.restrictedCash,
    };
    opening = closing;
    return week;
  });
  // Ties go to the earliest week.
  const low = weeks.reduce((a, b) => (b.usable < a.usable ? b : a));
  return { weeks, lowPoint: { weekStart: low.weekStart, usable: low.usable } };
}
