import { z } from "zod";
/**
 * Shared refinement helpers. Not re-exported from index: contract internals, not public API.
 * Imports nothing from core so core can use it without a module cycle.
 */

const ISO_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parts(date: string): [number, number, number] {
  return date.split("-").map(Number) as [number, number, number];
}

export function isCalendarDate(date: string): boolean {
  if (!ISO_SHAPE.test(date)) return false;
  const [year, month, day] = parts(date);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** Same as ISODateSchema plus a real-date check; ISODateSchema stays shape-only for legacy records. */
export const CalendarDateSchema = z
  .string()
  .regex(ISO_SHAPE, "expected YYYY-MM-DD")
  .refine(isCalendarDate, "expected a real calendar date");

/**
 * True when date is an occurrence of a schedule anchored on anchor: on or after it, a
 * whole number of cadences later, on the anchor day clamped to the month's last day.
 * Clamping never moves the anchor, so January 31 gives February 28 and then March 31.
 */
export function isOnCadence(anchor: string, date: string, everyMonths: number): boolean {
  if (!isCalendarDate(anchor) || !isCalendarDate(date)) return false;
  const [anchorYear, anchorMonth, anchorDay] = parts(anchor);
  const [year, month, day] = parts(date);
  const months = (year - anchorYear) * 12 + (month - anchorMonth);
  return (
    months >= 0 &&
    months % everyMonths === 0 &&
    day === Math.min(anchorDay, daysInMonth(year, month))
  );
}

/** Safe integer cents: exact arithmetic and comparison without precision loss. */
export const SafeCentsSchema = z.number().int().safe();

export function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(key(item)) ?? [];
    group.push(item);
    groups.set(key(item), group);
  }
  return groups;
}

/** Flags every repeat after the first, at path(index). */
export function flagRepeats<T>(
  ctx: z.RefinementCtx,
  items: readonly T[],
  key: (item: T) => string,
  path: (index: number) => (string | number)[],
  message: string,
): void {
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (seen.has(key(item)))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: path(index), message });
    seen.add(key(item));
  }
}
