import type { Forecast } from "@domino/contracts";
import { describe, expect, it } from "vitest";
import { cashYieldChanges } from "./cash-yield";
import { forecastFromSchedule } from "./forecast";

const WEEKS = ["2023-09-04", "2023-09-11", "2023-09-18"];

/** A flat forecast whose closing balance is `closing` every week. */
function flat(closing: number): Forecast {
  return {
    weeks: WEEKS.map((weekStart) => ({
      weekStart,
      opening: closing,
      inflow: 0,
      outflow: 0,
      closing,
      usable: closing,
    })),
    lowPoint: { weekStart: WEEKS[0] ?? "", usable: closing },
  };
}

describe("cashYieldChanges", () => {
  it("gives nothing when the scenario keeps the same cash as its parent", () => {
    expect(cashYieldChanges(flat(10_000_000_00), flat(10_000_000_00), 450)).toEqual([]);
  });

  it("charges the interest a $50M lower balance no longer earns, compounding", () => {
    const changes = cashYieldChanges(flat(100_000_000_00), flat(50_000_000_00), 450);
    // Week 1 by hand: 5,000,000,000 cents x 4.5% x 7/365 = 4,315,068.49 -> 4,315,068 cents.
    expect(changes[0]).toEqual({
      kind: "remove_cash",
      date: "2023-09-10",
      amount: 4_315_068,
      label: "Interest not earned on lower cash, week of 2023-09-04",
    });
    // Week 2 accrues on the larger gap (50M plus week 1's lost interest).
    // 5,004,315,068 x 0.045 x 7/365 = 4,318,792.39 -> 4,318,792.
    expect(changes[1]?.kind === "remove_cash" && changes[1].amount).toBe(4_318_792);
    expect(changes).toHaveLength(3);
  });

  it("credits extra interest when the scenario holds more cash", () => {
    const [first] = cashYieldChanges(flat(0), flat(1_000_000_00), 365);
    // 100,000,000 cents x 3.65% x 7/365 = 70,000 cents exactly.
    expect(first).toEqual({
      kind: "add_cash",
      date: "2023-09-10",
      amount: 70_000,
      label: "Extra interest on higher cash, week of 2023-09-04",
    });
  });

  it("rounds a gain and a loss of the same size to the same cents", () => {
    const loss = cashYieldChanges(flat(1_000_00), flat(0), 450)[0];
    const gain = cashYieldChanges(flat(0), flat(1_000_00), 450)[0];
    expect(loss?.kind === "remove_cash" && loss.amount).toBe(
      gain?.kind === "add_cash" && gain.amount,
    );
  });

  it("turns the parallel offset into a widening gap once applied", () => {
    const parent = flat(100_000_000_00);
    const scenario = flat(50_000_000_00);
    const changes = cashYieldChanges(parent, scenario, 450);
    const items = changes.map((c) => ({
      kind: "change" as const,
      id: c.kind === "add_cash" || c.kind === "remove_cash" ? c.label : "",
      date: c.kind === "add_cash" || c.kind === "remove_cash" ? c.date : "",
      amount: c.kind === "remove_cash" ? -c.amount : c.kind === "add_cash" ? c.amount : 0,
    }));
    const adjusted = forecastFromSchedule(
      {
        companyId: "c",
        asOf: "2023-09-01",
        cashOnHand: 50_000_000_00,
        restrictedCash: 0,
        customers: [],
        invoices: [],
        bankTxns: [],
        bills: [],
        cardTxns: [],
        payroll: [],
        deals: [],
      },
      { weeks: WEEKS, items },
    );
    const gaps = adjusted.weeks.map((w, i) => (parent.weeks[i]?.closing ?? 0) - w.closing);
    expect(gaps[0]).toBeGreaterThan(50_000_000_00);
    expect(gaps[2]).toBeGreaterThan(gaps[1] ?? 0);
    expect(gaps[1]).toBeGreaterThan(gaps[0] ?? 0);
  });

  it("rejects forecasts with different weeks", () => {
    const other = { ...flat(0), weeks: flat(0).weeks.slice(1) };
    expect(() => cashYieldChanges(flat(0), other, 450)).toThrow(/same weeks/);
  });

  it("rejects a negative or fractional rate", () => {
    expect(() => cashYieldChanges(flat(0), flat(1), -1)).toThrow(/rate/);
    expect(() => cashYieldChanges(flat(0), flat(1), 4.5)).toThrow(/rate/);
  });
});
