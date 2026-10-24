import {
  type BankTxn,
  BankTxnSchema,
  type Evidence,
  type Forecast,
  ForecastSchema,
  type GradeContext,
  GradeContextSchema,
  type ISODate,
} from "@domino/contracts";
import { addDays, toMs, weekStarts } from "./dates";
import { money } from "./dominoes";
import type { Ratio } from "./money";

/** One completed forecast week against the bank. error = |forecast - actual| / max(|actual|, 1). */
export type ScoredWeek = {
  weekStart: ISODate;
  forecastClosing: bigint;
  actualClosing: bigint;
  error: Ratio;
  txns: BankTxn[];
};

const MISS: Ratio = { num: 3n, den: 100n };

/**
 * Completed weeks of `previous`, scored against the bank. Actual cash starts at the first
 * week's opening (end of day on forecastAsOf) and adds bank transactions strictly after
 * forecastAsOf; the weekend before the first Monday counts in week 0, matching forecast
 * bucketing. Returns [] when no week has closed by context.asOf.
 */
export function scoreWeeks(
  previous: Forecast,
  actualBank: BankTxn[],
  context: GradeContext,
): ScoredWeek[] {
  const forecast = ForecastSchema.parse(previous);
  const bank = actualBank.map((t) => BankTxnSchema.parse(t));
  const window = GradeContextSchema.parse(context);
  assertForecast(forecast, window.forecastAsOf);
  assertBank(bank);
  let actual = BigInt(forecast.weeks[0]?.opening ?? 0);
  const scored: ScoredWeek[] = [];
  for (const [i, week] of forecast.weeks.entries()) {
    const end = addDays(week.weekStart, 6);
    if (end > window.asOf) break;
    const from = i === 0 ? window.forecastAsOf : addDays(week.weekStart, -1);
    const txns = bank.filter((t) => t.date > from && t.date <= end);
    for (const t of txns) actual += BigInt(t.amount);
    const closing = BigInt(week.closing);
    const error = reduce({ num: abs(closing - actual), den: abs(actual) || 1n });
    scored.push({
      weekStart: week.weekStart,
      forecastClosing: closing,
      actualClosing: actual,
      error,
      txns,
    });
  }
  return scored;
}

/** Engine.grade. Context-free calls stay type-compatible but cannot be graded. */
export function grade(
  previous: Forecast,
  actualBank: BankTxn[],
  context?: GradeContext,
): { errorPct: number; misses: Evidence[] } {
  if (!context) {
    throw new Error(
      "engine.grade needs a GradeContext: without a known bank window there is nothing to grade, and a 0% error would be made up",
    );
  }
  const scored = scoreWeeks(previous, actualBank, context);
  if (scored.length === 0) {
    throw new Error(`insufficient observation: no forecast week has finished by ${context.asOf}`);
  }
  return {
    errorPct: toPct(mean(scored.map((w) => w.error))),
    misses: scored.filter((w) => compare(w.error, MISS) > 0).flatMap(missEvidence),
  };
}

/** The week itself, then each bank record seen in it. Observations only, never a cause. */
function missEvidence(week: ScoredWeek): Evidence[] {
  const pct = toPct(week.error).toFixed(1);
  const denominator =
    week.actualClosing <= 0n
      ? " Percent uses max(|actual|, 1 cent) because actual cash was not positive."
      : "";
  return [
    {
      source: "nessie",
      ref: `week:${week.weekStart}`,
      note: `Week of ${week.weekStart}: forecast closing ${money(safeCents(week.forecastClosing, week.weekStart))}, bank shows ${money(safeCents(week.actualClosing, week.weekStart))} (${pct}% off).${denominator}`,
    },
    ...week.txns.map((t) => ({
      source: "nessie" as const,
      ref: t.id,
      note: `Bank shows ${money(t.amount)} on ${t.date} ("${t.description}") in this week. Observed only, not proven to cause the miss.`,
    })),
  ];
}

/** A forecast is evidence: contiguous Mondays from forecastAsOf and balances that add up. */
function assertForecast(forecast: Forecast, forecastAsOf: ISODate): void {
  const expected = weekStarts(forecastAsOf, forecast.weeks.length);
  let previousClosing: number | undefined;
  for (const [i, w] of forecast.weeks.entries()) {
    if (w.weekStart !== expected[i]) {
      throw new Error(
        `forecast week ${i} starts ${w.weekStart}, expected ${expected[i]} for an origin of ${forecastAsOf}`,
      );
    }
    const amounts = [w.opening, w.inflow, w.outflow, w.closing];
    if (
      !amounts.every(Number.isSafeInteger) ||
      w.inflow < 0 ||
      w.outflow < 0 ||
      // BigInt: safe operands can still have an inexact Number sum.
      BigInt(w.closing) !== BigInt(w.opening) + BigInt(w.inflow) - BigInt(w.outflow) ||
      (previousClosing !== undefined && w.opening !== previousClosing)
    ) {
      throw new Error(
        `forecast week ${w.weekStart} is inconsistent: opening + inflow - outflow must equal closing`,
      );
    }
    previousClosing = w.closing;
  }
}

/** Cents is a safe Number; refuse rather than round an aggregate outside that range. */
function safeCents(cents: bigint, weekStart: ISODate): number {
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(
      `${cents} cents for the week of ${weekStart} is outside the safe cents range and cannot be shown exactly`,
    );
  }
  return Number(cents);
}

export function assertBank(bank: BankTxn[]): void {
  const seen = new Set<string>();
  for (const t of bank) {
    toMs(t.date);
    if (!Number.isSafeInteger(t.amount))
      throw new Error(`bank transaction ${t.id}: amount is not safe integer cents`);
    if (seen.has(t.id))
      throw new Error(`duplicate bank transaction id ${t.id}: refusing to count it twice`);
    seen.add(t.id);
  }
}

// ---------- Exact ratios. Error percentages are not money, but stay exact until display. ----------

const abs = (n: bigint) => (n < 0n ? -n : n);
const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? abs(a) : gcd(b, a % b));

function reduce(r: Ratio): Ratio {
  const g = gcd(r.num, r.den) || 1n;
  return { num: r.num / g, den: r.den / g };
}

/** Sign of a - b. Denominators are positive. */
export const compare = (a: Ratio, b: Ratio): number => {
  const d = a.num * b.den - b.num * a.den;
  return d > 0n ? 1 : d < 0n ? -1 : 0;
};

/** Equal-weight mean of nonempty ratios. */
export function mean(ratios: Ratio[]): Ratio {
  const sum = ratios.reduce(
    (a, b) => reduce({ num: a.num * b.den + b.num * a.den, den: a.den * b.den }),
    { num: 0n, den: 1n },
  );
  return reduce({ num: sum.num, den: sum.den * BigInt(ratios.length) });
}

/** The single conversion to a float, with 12 exact decimal places before it. */
export function toPct(r: Ratio): number {
  const scale = 10n ** 12n;
  return Number((r.num * 100n * scale) / r.den) / 1e12;
}
