import { type Change, type CompanyModel, type Snapshot, SnapshotSchema } from "@domino/contracts";
import { describe, expect, it } from "vitest";
import { type CashResponsePolicy, cashResponseChanges } from "./cash-response";
import { forecast } from "./forecast";

// Weeks run 2026-11-02 .. 2027-01-31 (asOf is a Friday). Monthly campaign bills, biweekly
// payroll, monthly recurring billing and two signed deals, so every part of a response shows.
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
  cashOnHand: 30_000_000,
  restrictedCash: 0,
  customers: [
    { id: "big", name: "Northwind", paymentTermsDays: 0 },
    { id: "small", name: "Tailspin", paymentTermsDays: 0 },
    { id: "newco", name: "Contoso", paymentTermsDays: 0 },
  ],
  invoices: [],
  bankTxns: [],
  bills: ["2026-11-10", "2026-12-10", "2027-01-10"].flatMap((due, i) => [
    { id: `ads_${i}`, vendor: "Campaign services", amount: 1_000_000, due, critical: false },
    { id: `rent_${i}`, vendor: "Facilities", amount: 500_000, due, critical: false },
  ]),
  cardTxns: [],
  payroll: ["2026-11-06", "2026-11-20", "2026-12-04", "2026-12-18", "2027-01-01", "2027-01-15"].map(
    (date, i) => ({ id: `pr_${i}`, date, amount: 2_000_000 }),
  ),
  deals: [
    {
      id: "d_jan",
      customerId: "newco",
      amount: 4_000_000,
      stage: "won",
      expectedClose: "2027-01-12",
      signed: true,
      invoiceId: null,
    },
  ],
  billingPlans: [plan("p_big", "big", 2_000_000), plan("p_small", "small", 1_000_000)],
});
const model: CompanyModel = { version: 0, customerDelayDays: {}, recurringSpend: [], rules: [] };
const payment: Change = {
  kind: "remove_cash",
  date: "2026-11-09",
  amount: 25_000_000,
  label: "Lawsuit",
};
const policy = (over: Partial<CashResponsePolicy> = {}): CashResponsePolicy => ({
  respondFrom: "breach",
  floor: 5_000_000,
  notBefore: "2026-11-09",
  growthSpend: ["Campaign services"],
  spendCutPercent: 50,
  payrollCutPercent: 0,
  reactionDays: 7,
  growthSensitivity: 0.2,
  revenueLagDays: 28,
  ...over,
});
const changesOf = (out: ReturnType<typeof cashResponseChanges>) =>
  out.parts.flatMap((p) => p.changes);
const usable = (changes: Change[]) => forecast(snapshot, model, changes).weeks.map((w) => w.usable);

describe("cashResponseChanges", () => {
  it("does nothing while cash stays above the floor", () => {
    expect(cashResponseChanges(snapshot, model, [], policy())).toEqual({
      trigger: null,
      parts: [],
    });
  });

  it("cuts growth spending after a breach, then slows billing and new deals after the lag", () => {
    const out = cashResponseChanges(snapshot, model, [payment], policy());
    expect(out.trigger?.date).toBe("2026-11-09");
    expect(out.parts.map((p) => p.part)).toEqual(["spend", "billing", "deals"]);
    expect(out.parts[0]?.changes).toEqual([
      {
        kind: "scale_recurring",
        label: "Response: growth spending cut 50%",
        flows: "spend",
        names: ["Campaign services"],
        percent: -50,
        fromDate: "2026-11-16",
      },
    ]);
    expect(out.parts[1]?.changes[0]).toMatchObject({
      flows: "billing",
      percent: -10,
      fromDate: "2026-12-14",
    });
    // The Jan 12 deal (4,000,000 cents) closes 10% smaller: 400,000 cents in its week.
    expect(out.parts[2]?.changes).toEqual([
      {
        kind: "remove_cash",
        date: "2027-01-11",
        amount: 400_000,
        label: "Response: new deals 10% smaller, week of 2027-01-11",
      },
    ]);
  });

  it("saves a share of every later payroll run on its own date", () => {
    const out = cashResponseChanges(
      snapshot,
      model,
      [payment],
      policy({ payrollCutPercent: 10, growthSensitivity: 0 }),
    );
    const payroll = out.parts.find((p) => p.part === "payroll");
    // Runs on or after the Nov 16 cut: Nov 20, Dec 4, Dec 18, Jan 1, Jan 15; 10% of 2,000,000.
    expect(
      payroll?.changes.map((c) => (c.kind === "add_cash" ? [c.date, c.amount] : null)),
    ).toEqual([
      ["2026-11-20", 200_000],
      ["2026-12-04", 200_000],
      ["2026-12-18", 200_000],
      ["2027-01-01", 200_000],
      ["2027-01-15", 200_000],
    ]);
  });

  it("slows revenue in proportion to the total investment cut", () => {
    const out = cashResponseChanges(
      snapshot,
      model,
      [payment],
      policy({ spendCutPercent: 20, payrollCutPercent: 10, growthSensitivity: 0.5 }),
    );
    expect(out.parts.find((p) => p.part === "billing")?.changes[0]).toMatchObject({ percent: -15 });
  });

  it("turns a parallel offset into a different shape", () => {
    const plain = usable([payment]);
    const response = changesOf(
      cashResponseChanges(snapshot, model, [payment], policy({ payrollCutPercent: 10 })),
    );
    const responded = usable([payment, ...response]);
    const gap = plain.map((u, i) => (responded[i] ?? 0) - u);
    expect(new Set(gap).size).toBeGreaterThan(4);
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
    expect(out.parts[0]?.changes[0]).toMatchObject({ fromDate: "2026-11-27" });
  });

  it("does not slow revenue without a cut, and stops at the horizon", () => {
    expect(
      cashResponseChanges(snapshot, model, [payment], policy({ growthSpend: [" ", ""] })).parts,
    ).toEqual([]);
    expect(
      cashResponseChanges(snapshot, model, [payment], policy({ growthSensitivity: 0 })).parts.map(
        (p) => p.part,
      ),
    ).toEqual(["spend"]);
    expect(
      cashResponseChanges(
        snapshot,
        model,
        [],
        policy({ respondFrom: "event", notBefore: "2027-01-30", reactionDays: 7 }),
      ).parts,
    ).toEqual([]);
  });

  it("rejects out-of-range assumptions", () => {
    expect(() => cashResponseChanges(snapshot, model, [], policy({ spendCutPercent: 80 }))).toThrow(
      /spendCutPercent/,
    );
    expect(() =>
      cashResponseChanges(snapshot, model, [], policy({ payrollCutPercent: 40 })),
    ).toThrow(/payrollCutPercent/);
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
    const p = policy({ payrollCutPercent: 12.5 });
    expect(cashResponseChanges(snapshot, model, [payment], p)).toEqual(
      cashResponseChanges(snapshot, model, [payment], p),
    );
  });
});
