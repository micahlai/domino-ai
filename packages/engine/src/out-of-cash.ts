import type { Cents, Forecast, ISODate } from "@domino/contracts";
import { money } from "./dominoes";

/**
 * Terminal outcome: the first week the company has no money left to pay with. Available cash
 * is usable cash plus any undrawn credit the branch may still draw (draws already taken are in
 * usable cash as dated changes). Plain wording only: this is not a legal insolvency finding,
 * and the forecast after this week assumes nothing else changes.
 */
export type OutOfCash = {
  week: number;
  weekStart: ISODate;
  /** Available cash that week (negative) */
  available: Cents;
  label: string;
};

export function outOfCash(forecast: Forecast, undrawnCredit: Cents = 0): OutOfCash | null {
  const week = forecast.weeks.findIndex((w) => w.usable + undrawnCredit < 0);
  const w = forecast.weeks[week];
  if (!w) return null;
  const available = w.usable + undrawnCredit;
  return {
    week,
    weekStart: w.weekStart,
    available,
    label: `Out of cash in the week of ${w.weekStart} (short ${money(-available)})`,
  };
}
