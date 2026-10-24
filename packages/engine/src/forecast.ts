import type { Change, CompanyModel, Forecast, ForecastWeek, Snapshot } from "@domino/contracts";
import { applyChanges } from "./changes";
import { weekStarts } from "./dates";
import { baseSchedule, bucketOf } from "./schedule";

const WEEKS = 13;

/** Build-spec §6.1: 13 weekly buckets of the dated cash schedule after `changes`. */
export function forecast(snapshot: Snapshot, model: CompanyModel, changes: Change[]): Forecast {
  const starts = weekStarts(snapshot.asOf, WEEKS);
  const items = applyChanges(baseSchedule(snapshot, model, starts), changes, snapshot, starts);
  const inflow = new Array<number>(WEEKS).fill(0);
  const outflow = new Array<number>(WEEKS).fill(0);
  for (const item of items) {
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
