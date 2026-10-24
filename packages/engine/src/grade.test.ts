import type { BankTxn, Forecast, ForecastWeek, GradeContext } from "@domino/contracts";
import { describe, expect, it } from "vitest";
import { weekStarts } from "./dates";
import { grade } from "./grade";
import { engine } from "./index";

/** A consistent 13-week forecast. flows[i] = [inflow, outflow] for week i; the rest are 0. */
function makeForecast(asOf: string, opening: number, flows: [number, number][] = []): Forecast {
  let cash = opening;
  const weeks: ForecastWeek[] = weekStarts(asOf, 13).map((weekStart, i) => {
    const [inflow, outflow] = flows[i] ?? [0, 0];
    const week = { weekStart, opening: cash, inflow, outflow, closing: cash + inflow - outflow };
    cash = week.closing;
    return { ...week, usable: week.closing };
  });
  const low = weeks.reduce((a, b) => (b.usable < a.usable ? b : a));
  return { weeks, lowPoint: { weekStart: low.weekStart, usable: low.usable } };
}

const txn = (id: string, date: string, amount: number): BankTxn => ({
  id,
  date,
  amount,
  description: `txn ${id}`,
});
const ctx = (forecastAsOf: string, asOf: string): GradeContext => ({
  forecastAsOf,
  asOf,
  bankWindowComplete: true,
});

// Origin Friday 2026-10-30. Week 0 = 11-02..11-08 (plus the 10-31/11-01 weekend gap), week 1 = 11-09..11-15.
const friday = makeForecast("2026-10-30", 1_000_000, [[50_000, 0]]);
const fridayBank = [
  txn("t_origin", "2026-10-30", 999), // already in opening cash
  txn("t_sat", "2026-10-31", 50_000), // pre-Monday gap counts in week 0
  txn("t_w0", "2026-11-04", -10_000),
  txn("t_w1", "2026-11-10", -40_000),
  txn("t_late", "2026-11-16", 7), // after the last completed Sunday
];

describe("grade", () => {
  it("grades completed weeks from a Friday origin, counting the weekend deposit", () => {
    // Week 0: actual 1,040,000 vs forecast 1,050,000 -> 1/104. Week 1: actual 1,000,000 vs
    // 1,050,000 -> 1/20. Mean (1/104 + 1/20) / 2 = 31/1040 -> 3100/1040 percent.
    const result = grade(friday, fridayBank, ctx("2026-10-30", "2026-11-15"));
    expect(result.errorPct).toBeCloseTo(3100 / 1040, 10);
    // Only week 1 (5%) is over 3%. It cites its week and the observed transaction, not a cause.
    expect(result.misses.map((m) => m.ref)).toEqual(["week:2026-11-09", "t_w1"]);
    expect(result.misses[0]?.source).toBe("nessie");
    expect(result.misses[0]?.note).toMatch(/\$10,500.*\$10,000/);
    expect(result.misses[1]?.note).toMatch(/not proven/i);
  });

  it("ignores an unfinished week", () => {
    // Saturday 11-14: week 1 has not closed, so only week 0 (1/104) counts.
    const result = grade(friday, fridayBank, ctx("2026-10-30", "2026-11-14"));
    expect(result.errorPct).toBeCloseTo(100 / 104, 10);
    expect(result.misses).toEqual([]);
  });

  it("from a Monday origin, the first week starts the next Monday and the origin day is excluded", () => {
    const monday = makeForecast("2026-11-02", 100_000);
    expect(monday.weeks[0]?.weekStart).toBe("2026-11-09");
    const bank = [txn("t_origin", "2026-11-02", 5_000), txn("t_gap", "2026-11-04", 1_000)];
    // Actual 101,000 vs forecast 100,000 -> 1/101.
    const result = grade(monday, bank, ctx("2026-11-02", "2026-11-15"));
    expect(result.errorPct).toBeCloseTo(100 / 101, 10);
  });

  it("an error of exactly 3% is not a miss; just over is, even with no transaction to cite", () => {
    const exact = grade(
      makeForecast("2026-10-30", 100_000, [[3_000, 0]]),
      [],
      ctx("2026-10-30", "2026-11-08"),
    );
    expect(exact).toEqual({ errorPct: 3, misses: [] });
    const over = grade(
      makeForecast("2026-10-30", 100_000, [[3_001, 0]]),
      [],
      ctx("2026-10-30", "2026-11-08"),
    );
    expect(over.errorPct).toBeCloseTo(3.001, 10);
    expect(over.misses.map((m) => m.ref)).toEqual(["week:2026-11-02"]);
  });

  it("uses max(|actual|, 1 cent) as the denominator for zero and negative cash", () => {
    const zero = grade(
      makeForecast("2026-10-30", 0, [[500, 0]]),
      [],
      ctx("2026-10-30", "2026-11-08"),
    );
    expect(zero.errorPct).toBe(50_000);
    expect(zero.misses[0]?.note).toMatch(/1 cent/);
    const negative = grade(
      makeForecast("2026-10-30", 0),
      [txn("t_out", "2026-11-03", -200)],
      ctx("2026-10-30", "2026-11-08"),
    );
    expect(negative.errorPct).toBe(100);
  });

  it("refuses to grade without a context or a finished week", () => {
    expect(() => grade(friday, fridayBank)).toThrow(/GradeContext/);
    expect(() => engine.grade(friday, fridayBank)).toThrow(/GradeContext/);
    expect(() => grade(friday, fridayBank, ctx("2026-10-30", "2026-11-07"))).toThrow(
      /no forecast week has finished/,
    );
  });

  it("rejects duplicate bank ids, misaligned weeks and inconsistent forecasts", () => {
    const window = ctx("2026-10-30", "2026-11-15");
    expect(() =>
      grade(friday, [txn("a", "2026-11-03", 1), txn("a", "2026-11-04", 1)], window),
    ).toThrow(/duplicate bank transaction/);
    // Thursday 10-29 shares the 11-02 week start, but a Monday 11-02 origin starts 11-09.
    expect(grade(friday, [], ctx("2026-10-29", "2026-11-08")).errorPct).toBeCloseTo(5, 10);
    expect(() => grade(friday, fridayBank, ctx("2026-11-02", "2026-11-15"))).toThrow(/week/);
    const shifted = makeForecast("2026-10-30", 1_000_000);
    shifted.weeks[3] = { ...shifted.weeks[3]!, weekStart: "2026-11-24" };
    expect(() => grade(shifted, [], window)).toThrow(/week/);
    const broken = makeForecast("2026-10-30", 1_000_000);
    broken.weeks[1] = { ...broken.weeks[1]!, closing: 1 };
    expect(() => grade(broken, [], window)).toThrow(/inconsistent/);
    expect(() => grade(friday, [txn("bad", "2026-02-30", 1)], window)).toThrow(/invalid date/);
    expect(() => grade(friday, [], { ...window, bankWindowComplete: false as true })).toThrow();
  });

  it("does not mutate its inputs", () => {
    const before = JSON.stringify([friday, fridayBank]);
    grade(friday, fridayBank, ctx("2026-10-30", "2026-11-15"));
    expect(JSON.stringify([friday, fridayBank])).toBe(before);
  });
});
