import type { ISODate } from "@domino/contracts";

const DAY_MS = 86_400_000;

/** UTC milliseconds for an ISO date. Rejects impossible dates like 2026-02-30. */
export function toMs(date: ISODate): number {
  const [y, m, d] = date.split("-").map(Number);
  const ms = Date.UTC(y ?? Number.NaN, (m ?? Number.NaN) - 1, d ?? Number.NaN);
  if (Number.isNaN(ms) || fromMs(ms) !== date) throw new Error(`invalid date: ${date}`);
  return ms;
}

function fromMs(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromMs(toMs(date) + days * DAY_MS);
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((toMs(to) - toMs(from)) / DAY_MS);
}

export function daysInMonth(date: ISODate): number {
  const d = new Date(toMs(date));
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * `months` calendar months after `anchor`, on the anchor's day clamped to the month's last day.
 * Always count from the original anchor: Jan 31 + 1 = Feb 28, Jan 31 + 2 = Mar 31.
 */
export function addMonthsClamped(anchor: ISODate, months: number): ISODate {
  const d = new Date(toMs(anchor));
  const first = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1);
  const day = Math.min(d.getUTCDate(), daysInMonth(fromMs(first)));
  return addDays(fromMs(first), day - 1);
}

/** Whole calendar months from `from` to `to`, ignoring days. */
export function monthsBetween(from: ISODate, to: ISODate): number {
  const a = new Date(toMs(from));
  const b = new Date(toMs(to));
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
}

/** n Monday week starts, beginning the first Monday strictly after asOf. */
export function weekStarts(asOf: ISODate, n: number): ISODate[] {
  const dow = new Date(toMs(asOf)).getUTCDay();
  const first = addDays(asOf, (8 - dow) % 7 || 7);
  return Array.from({ length: n }, (_, i) => addDays(first, 7 * i));
}

/** Raw week index; negative before the first week, >= weeks.length after the last. */
export function weekIndexOf(date: ISODate, weeks: ISODate[]): number {
  const first = weeks[0];
  if (!first) throw new Error("no weeks");
  return Math.floor(daysBetween(first, date) / 7);
}

/** The last forecast day: the Sunday that closes the final week. */
export function horizonEnd(weeks: ISODate[]): ISODate {
  const last = weeks[weeks.length - 1];
  if (!last) throw new Error("no weeks");
  return addDays(last, 6);
}
