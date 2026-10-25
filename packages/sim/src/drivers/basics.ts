import { addDays, addMonthsAnchored } from "../create.ts";

/**
 * Calendar, seeded randomness and exact money helpers for the driver-based generator.
 * Money is integer cents; rates are integer basis points applied with BigInt and rounded
 * half up once, so no float ever touches a stored amount. Floats appear only as PRNG draws.
 */
export { addDays, addMonthsAnchored };

/** Monday the observed history starts; the first bank transaction is on or after it. */
export const WINDOW_START = "2026-05-04";
/** Six months of warm-up before the window, so opening receivables and payables are real. */
export const SIM_START = "2025-11-03";
/** Creation date (a Friday) and its simulated week number, matching the legacy Kestrel. */
export const TODAY0 = "2026-10-30";
export const WEEK0 = 25;

const DAY_MS = 86_400_000;
const ms = (date: string) => Date.parse(`${date}T00:00:00Z`);

export const daysBetween = (from: string, to: string) => Math.round((ms(to) - ms(from)) / DAY_MS);
export const weekday = (date: string) => new Date(ms(date)).getUTCDay();
export const monthOf = (date: string) => date.slice(0, 7);
export const dayOfMonth = (date: string) => Number(date.slice(8, 10));
export const firstOfMonth = (month: string) => `${month}-01`;
export const nextMonth = (month: string) => addMonthsAnchored(`${month}-01`, 1).slice(0, 7);
export const lastOfMonth = (month: string) => addDays(firstOfMonth(nextMonth(month)), -1);
/** The day-th day of month, clamped to the month's last day. */
export const dayIn = (month: string, day: number) => {
  const last = lastOfMonth(month);
  return day >= dayOfMonth(last) ? last : `${month}-${String(day).padStart(2, "0")}`;
};
export const todayOf = (week: number) => addDays(TODAY0, 7 * (week - WEEK0));
export const minDate = (a: string, b: string) => (a < b ? a : b);
export const maxDate = (a: string, b: string) => (a > b ? a : b);

/** Federal Reserve bank holidays in the simulated span (no ACH settlement on these days). */
const HOLIDAYS = new Set([
  "2025-11-11",
  "2025-11-27",
  "2025-12-25",
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-05-25",
  "2026-06-19",
  "2026-09-07",
  "2026-10-12",
  "2026-11-11",
  "2026-11-26",
  "2026-12-25",
  "2027-01-01",
  "2027-01-18",
  "2027-02-15",
  "2027-05-31",
  "2027-06-18",
  "2027-07-05",
  "2027-09-06",
  "2027-10-11",
  "2027-11-11",
  "2027-11-25",
  "2027-12-24",
]);

export const isBusinessDay = (date: string) => {
  const dow = weekday(date);
  return dow !== 0 && dow !== 6 && !HOLIDAYS.has(date);
};
/** Same day if it is a business day, else the next one. */
export function onOrAfterBusinessDay(date: string): string {
  let day = date;
  while (!isBusinessDay(day)) day = addDays(day, 1);
  return day;
}
/** Same day if it is a business day, else the previous one. */
export function onOrBeforeBusinessDay(date: string): string {
  let day = date;
  while (!isBusinessDay(day)) day = addDays(day, -1);
  return day;
}
export function addBusinessDays(date: string, count: number): string {
  let day = date;
  for (let left = count; left > 0; ) {
    day = addDays(day, 1);
    if (isBusinessDay(day)) left--;
  }
  return day;
}

export function* days(from: string, to: string): Generator<string> {
  for (let day = from; day <= to; day = addDays(day, 1)) yield day;
}
export function* months(from: string, to: string): Generator<string> {
  for (let month = monthOf(from); month <= monthOf(to); month = nextMonth(month)) yield month;
}

// ---------- seeded randomness ----------

export type Random = () => number;

function mulberry32(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * A stream owned by one record identity. Draws never depend on how many other records were
 * generated first, so profiles that share an identity share its draws and a later cut date
 * never changes an earlier record.
 */
export function keyed(seed: number, key: string): Random {
  let hash = 0x811c9dc5 ^ (seed | 0);
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193);
  return mulberry32(hash);
}
export const int = (random: Random, low: number, high: number) =>
  low + Math.floor(random() * (high - low + 1));
export const chance = (random: Random, probability: number) => random() < probability;
export const pick = <T>(random: Random, items: readonly T[]): T =>
  items[int(random, 0, items.length - 1)] as T;
/** Whole dollars drawn uniformly, returned as cents. */
export const dollarsBetween = (random: Random, low: number, high: number) =>
  int(random, low, high) * 100;

// ---------- exact money ----------

/** a * numerator / denominator, rounded half up, exact for any safe integer inputs (a >= 0). */
export function mulDiv(
  a: number,
  numerator: number | bigint,
  denominator: number | bigint,
): number {
  const n = BigInt(a) * BigInt(numerator);
  const d = BigInt(denominator);
  const sign = n < 0n ? -1n : 1n;
  const abs = n < 0n ? -n : n;
  const value = sign * ((2n * abs + d) / (2n * d));
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error("money left the safe integer range");
  return result;
}
/** amount * bps / 10_000, rounded half up. */
export const bps = (amount: number, basisPoints: number) => mulDiv(amount, basisPoints, 10_000);
export const sum = (values: Iterable<number>) => {
  let total = 0;
  for (const value of values) total += value;
  if (!Number.isSafeInteger(total)) throw new Error("money left the safe integer range");
  return total;
};
