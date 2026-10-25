import { type Change, type CompanyModel, type Snapshot, SnapshotSchema } from "@domino/contracts";
import { describe, expect, it } from "vitest";
import { type CashResponsePolicy, cashResponseChanges } from "./cash-response";
import { forecast } from "./forecast";

// Weeks run 2026-11-02 .. 2027-01-31 (asOf is a Friday). Monthly campaign bills and monthly
// recurring billing, so a cut and a slowdown each touch several weeks.
const plan = (id: string, customerId: string, amount: number) => ({
  id,
  customerId,
  amount,
  anchorDate: "2026-01-05",
  nextInvoiceDate: "2026-11-05",
  everyMonths: 1,
  paymentTermsDays: 0,
});
const snapshot: Snapshot = SnapshotSchema.parse({
  companyId: "resp",
  asOf: "2026-10-30",
  cashOnHand: 10_000_000,
  restrictedCash: 0,
  customers: [
    { id: "big", name: "Northwind", paymentTermsDays: 0 },
    { id: "small", name: "Tailspin", paymentTermsDays: 0 },
  ],
  invoices: [],
  bankTxns: [],
  bills: ["2026-11-10", "2026-12-10", "2027-01-10"].flatMap((due, i) => [
    { id: `ads_${i}`, vendor: "Campaign services", amount: 1_000_000, due, critical: false },
    { id: `rent_${i}`, vendor: "Facilities", amount: 500_000, due, critical: false },
  ]),
  cardTxns: [],
  payroll: [],
  deals: [],
  billingPlans: [plan("p_big", "big", 2_000_000), plan("p_small", "small", 1_000_000)],
});
const model: CompanyModel = { version: 0, customerDelayDays: {}, recurringSpend: [], rules: [] };
const payment: Change = {
  kind: "remove_cash",
  date: "2026-11-09",
  amount: 8_000_000,
  label: "Lawsuit",
};
const policy = (over: Partial<CashResponsePolicy> = {}): CashResponsePolicy => ({
  respondFrom: "breach",
  floor: 5_000_000,
  notBefore: "2026-11-09",
  growthSpend: ["Campaign services"],
  spendCutPercent: 50,
  reactionDays: 7,
  growthSensitivity: 0.2,
  revenueLagDays: 28,
  ...over,
});
const usable = (changes: Change[]) => forecast(snapshot, model, changes).weeks.map((w) => w.usable);

describe("cashResponseChanges", () => {
  it("does nothing while cash stays above the floor", () => {
    expect(cashResponseChanges(snapshot, model, [], policy())).toEqual({
      trigger: null,
      changes: [],
      notes: [],
    });
  });

  it("cuts growth spending after a breach, then slows billing after the lag", () => {
    const out = cashResponseChanges(snapshot, model, [payment], policy());
    // Week of 2026-11-09 closes at 10M - 8M - 1M - 0.5M + billing; below the 5M floor.
    expect(out.trigger?.date).toBe("2026-11-09");
    expect(out.changes).toEqual([
      {
        kind: "scale_recurring",
        label: "Response: growth spending cut 50%",
        flows: "spend",
        names: ["Campaign services"],
        percent: -50,
        fromDate: "2026-11-16",
      },
      {
        kind: "scale_recurring",
        label: "Response: slower growth after the spending cut, billing 10% lower",
        flows: "billing",
        names: [],
        percent: -10,
        fromDate: "2026-12-14",
      },
    ]);
    expect(out.notes).toHaveLength(2);
  });

  it("turns a parallel offset into a different shape", () => {
    const plain = usable([payment]);
    const response = cashResponseChanges(snapshot, model, [payment], policy()).changes;
    const responded = usable([payment, ...response]);
    const gap = plain.map((u, i) => (responded[i] ?? 0) - u);
    // Saved spend shows up from December, lost billing from mid-December: the gap moves.
    expect(new Set(gap).size).toBeGreaterThan(2);
    expect(gap[0]).toBe(0);
  });

  it("can respond at the event even when no floor is crossed", () => {
    const out = cashResponseChanges(
      snapshot,
      model,
      [],
      policy({ respondFrom: "event", floor: null, notBefore: "2026-11-20" }),
    );
    expect(out.trigger).toEqual({ date: "2026-11-20", usable: null });
    expect(out.changes[0]?.kind === "scale_recurring" && out.changes[0].fromDate).toBe(
      "2026-11-27",
    );
  });

  it("skips the slowdown with no sensitivity and everything past the horizon", () => {
    expect(
      cashResponseChanges(snapshot, model, [payment], policy({ growthSensitivity: 0 })).changes,
    ).toHaveLength(1);
    expect(
      cashResponseChanges(
        snapshot,
        model,
        [payment],
        policy({ reactionDays: 60, revenueLagDays: 180 }),
      ).changes,
    ).toHaveLength(1);
    expect(
      cashResponseChanges(
        snapshot,
        model,
        [],
        policy({ respondFrom: "event", notBefore: "2027-01-30", reactionDays: 7 }),
      ).changes,
    ).toEqual([]);
  });

  it("needs growth spend names to cut anything", () => {
    expect(
      cashResponseChanges(snapshot, model, [payment], policy({ growthSpend: [" ", ""] })).changes,
    ).toEqual([]);
  });

  it("rejects out-of-range assumptions", () => {
    expect(() => cashResponseChanges(snapshot, model, [], policy({ spendCutPercent: 80 }))).toThrow(
      /spendCutPercent/,
    );
    expect(() =>
      cashResponseChanges(snapshot, model, [], policy({ growthSensitivity: 2 })),
    ).toThrow(/growthSensitivity/);
    expect(() => cashResponseChanges(snapshot, model, [], policy({ reactionDays: 1.5 }))).toThrow(
      /whole days/,
    );
    expect(() => cashResponseChanges(snapshot, model, [], policy({ floor: null }))).toThrow(
      /floor/,
    );
  });

  it("is deterministic", () => {
    expect(cashResponseChanges(snapshot, model, [payment], policy())).toEqual(
      cashResponseChanges(snapshot, model, [payment], policy()),
    );
  });
});
