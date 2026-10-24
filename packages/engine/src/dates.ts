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
