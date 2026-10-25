import { type CompanyModel, type Snapshot, SnapshotSchema } from "@domino/contracts";
import { describe, expect, it } from "vitest";
import { weekStarts } from "./dates";
import { cashSchedule, forecast } from "./forecast";
import { recurringAssumptions, recurringBillingItems } from "./recurring-revenue";

// Hand-checkable subscription company. Every expected number is computed by hand below.
const snapshot: Snapshot = SnapshotSchema.parse({
  companyId: "subs",
  asOf: "2026-10-30", // Friday: weeks run 2026-11-02 .. 2027-01-31
  cashOnHand: 1_000_000,
  restrictedCash: 0,
  customers: [
    { id: "c1", name: "Monthly net 30", paymentTermsDays: 30 },
    { id: "c2", name: "Card monthly", paymentTermsDays: 0 },
    { id: "c3", name: "Churned", paymentTermsDays: 30 },
    { id: "c4", name: "Annual", paymentTermsDays: 30 },
  ],
  invoices: [
    // c1 paid 7 and 5 days late: mean 6. c4 has no history, so it uses the net-30 mean, 6.
    {
      id: "i1",
      customerId: "c1",
      amount: 100_000,
      issued: "2026-08-15",
      due: "2026-09-14",
      paid: "2026-09-21",
    },
    {
      id: "i2",
      customerId: "c1",
      amount: 100_000,
      issued: "2026-09-15",
      due: "2026-10-15",
      paid: "2026-10-20",
    },
  ],
  bankTxns: [],
  bills: [],
  cardTxns: [],
  payroll: [],
  deals: [],
  billingPlans: [
    {
      id: "p1",
      customerId: "c1",
      amount: 100_000,
      anchorDate: "2026-01-15",
      nextInvoiceDate: "2026-11-15",
      everyMonths: 1,
      paymentTermsDays: 30,
    },
    {
      id: "p2",
      customerId: "c2",
      amount: 50_000,
      anchorDate: "2026-03-31",
      nextInvoiceDate: "2026-10-31",
      everyMonths: 1,
      paymentTermsDays: 0,
      endDate: "2026-12-15",
    },
    {
      id: "p3",
      customerId: "c3",
      amount: 25_000,
      anchorDate: "2026-01-10",
      nextInvoiceDate: "2026-11-10",
      everyMonths: 1,
      paymentTermsDays: 30,
      endDate: "2026-09-09",
    },
    {
      id: "p4",
      customerId: "c4",
      amount: 1_200_000,
      anchorDate: "2025-12-01",
      nextInvoiceDate: "2026-12-01",
      everyMonths: 12,
      paymentTermsDays: 30,
    },
  ],
});
const noModel: CompanyModel = { version: 0, customerDelayDays: {}, recurringSpend: [], rules: [] };
const weeks = weekStarts(snapshot.asOf, 13);

describe("recurring billing projection", () => {
  it("derives payment delays from history and churn from ended plans", () => {
    const a = recurringAssumptions(snapshot, noModel);
    expect(a.delayDays).toEqual({ c1: 6, c2: 0, c3: 6, c4: 6 });
    // Monthly revenue 100,000 + 50,000 + 25,000 + 100,000 = 275,000; c3's 25,000 ended in
    // the last 182 days: 25,000 / 275,000 / 6 = 1/66 a month.
    expect(Number(a.monthlyChurn.num) / Number(a.monthlyChurn.den)).toBeCloseTo(1 / 66, 12);
  });

  it("projects each unissued occurrence at terms + delay, haircut by expected churn", () => {
    // keep 65/66 per calendar month after October: (65/66)^1 and (65/66)^2 = 4225/4356.
    expect(recurringBillingItems(snapshot, noModel, weeks)).toEqual([
      { kind: "plan", id: "p1@2026-11-15", customerId: "c1", date: "2026-12-21", amount: 98_485 },
      { kind: "plan", id: "p1@2026-12-15", customerId: "c1", date: "2027-01-20", amount: 96_993 },
      // Card plan: due on issue; the Dec 31 occurrence is after its endDate.
      { kind: "plan", id: "p2@2026-10-31", customerId: "c2", date: "2026-10-31", amount: 50_000 },
      { kind: "plan", id: "p2@2026-11-30", customerId: "c2", date: "2026-11-30", amount: 49_242 },
      {
        kind: "plan",
        id: "p4@2026-12-01",
        customerId: "c4",
        date: "2027-01-06",
        amount: 1_163_912,
      },
    ]);
  });

  it("prefers the learned model's delay", () => {
    const model = { ...noModel, customerDelayDays: { c1: { mean: 10, p90: 20, samples: 4 } } };
    const items = recurringBillingItems(snapshot, model, weeks);
    expect(items.find((i) => i.id === "p1@2026-11-15")?.date).toBe("2026-12-25");
  });

  it("feeds the forecast, and a churn change removes the customer's projected cash", () => {
    const total = 98_485 + 96_993 + 50_000 + 49_242 + 1_163_912;
    const inflow = forecast(snapshot, noModel, []).weeks.reduce((s, w) => s + w.inflow, 0);
    expect(inflow).toBe(total);
    const churned = cashSchedule(snapshot, noModel, [
      { kind: "churn", customerId: "c4", fromDate: "2026-11-01" },
    ]);
    expect(churned.items.some((i) => i.customerId === "c4")).toBe(false);
  });

  it("adds nothing to a snapshot without billing plans", () => {
    const { billingPlans: _, ...plain } = snapshot;
    expect(recurringBillingItems(plain, noModel, weeks)).toEqual([]);
  });
});
