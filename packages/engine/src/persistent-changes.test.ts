import { type Change, type CompanyModel, type Snapshot, SnapshotSchema } from "@domino/contracts";
import { describe, expect, it } from "vitest";
import { cashSchedule, forecast } from "./forecast";

// Weekly-billing company with a monthly vendor, rent and biweekly payroll, so persistent
// changes touch many weeks. Weeks run 2026-11-02 .. 2027-01-31 (asOf is a Friday).
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
  companyId: "dyn",
  asOf: "2026-10-30",
  cashOnHand: 10_000_000,
  restrictedCash: 0,
  customers: [
    { id: "big", name: "Northwind", paymentTermsDays: 0 },
    { id: "small", name: "Tailspin", paymentTermsDays: 0 },
  ],
  invoices: [
    { id: "inv_big", customerId: "big", amount: 500_000, issued: "2026-10-01", due: "2026-11-04" },
  ],
  bankTxns: [],
  bills: ["2026-11-10", "2026-12-10", "2027-01-10"].map((due, i) => ({
    id: `aws_${i}`,
    vendor: "AWS",
    amount: 200_000,
    due,
    critical: false,
  })),
  cardTxns: [],
  payroll: ["2026-11-06", "2026-11-20", "2026-12-04", "2026-12-18", "2027-01-01"].map(
    (date, i) => ({ id: `pr_${i}`, date, amount: 1_000_000 }),
  ),
  deals: [],
  billingPlans: [plan("p_big", "big", 400_000), plan("p_small", "small", 100_000)],
});
const model: CompanyModel = {
  version: 0,
  customerDelayDays: {},
  recurringSpend: [{ label: "Rent", amount: 300_000, everyDays: 30 }],
  rules: [],
};

const usable = (changes: Change[]) => forecast(snapshot, model, changes).weeks.map((w) => w.usable);
/** Week-by-week difference from the base forecast. */
const deltas = (changes: Change[]) => {
  const base = usable([]);
  return usable(changes).map((u, i) => u - (base[i] ?? 0));
};
/** A pure offset is one step then flat: the weekly change in the delta is non-zero once. */
const steps = (d: number[]) => d.filter((v, i) => v !== (i === 0 ? 0 : d[i - 1])).length;

describe("persistent changes bend the line", () => {
  it("churn removes every future receipt from that customer, not one invoice", () => {
    const churn: Change = { kind: "churn", customerId: "big", fromDate: "2026-11-01" };
    const after = cashSchedule(snapshot, model, [churn]).items;
    expect(after.filter((i) => i.customerId === "big")).toEqual([]);
    const before = cashSchedule(snapshot, model, []).items.filter((i) => i.customerId === "big");
    expect(before.length).toBeGreaterThan(2);
    expect(steps(deltas([churn]))).toBeGreaterThan(2);
  });

  it("a hire adds payroll every pay period from the start date", () => {
    const hire: Change = {
      kind: "recurring_cash",
      label: "2 engineers",
      direction: "out",
      amount: 115_068,
      fromDate: "2026-11-20",
      everyDays: 14,
    };
    const added = cashSchedule(snapshot, model, [hire]).items.filter((i) => i.id === "2 engineers");
    expect(added.map((i) => i.date)).toEqual([
      "2026-11-20",
      "2026-12-04",
      "2026-12-18",
      "2027-01-01",
      "2027-01-15",
      "2027-01-29",
    ]);
    expect(added.every((i) => i.amount === -115_068)).toBe(true);
    const d = deltas([hire]);
    expect(d[0]).toBe(0);
    expect(d.at(-1)).toBe(-6 * 115_068);
    expect(steps(d)).toBe(6);
  });

  it("a percentage cut scales every later bill from that vendor", () => {
    const cut: Change = {
      kind: "scale_recurring",
      label: "AWS spend cut 25%",
      flows: "spend",
      names: ["aws", "Rent"],
      percent: -25,
      fromDate: "2026-12-01",
    };
    const items = cashSchedule(snapshot, model, [cut]).items;
    const aws = items.filter((i) => i.kind === "bill").map((i) => [i.date, i.amount]);
    expect(aws).toEqual([
      ["2026-11-10", -200_000],
      ["2026-12-10", -150_000],
      ["2027-01-10", -150_000],
    ]);
    const rent = items.filter((i) => i.kind === "recurring").map((i) => i.amount);
    expect(rent).toEqual([-300_000, -225_000, -225_000]);
    expect(steps(deltas([cut]))).toBe(4);
  });

  it("a price rise scales projected recurring billing, not issued invoices", () => {
    const up: Change = {
      kind: "scale_recurring",
      label: "Prices up 10%",
      flows: "billing",
      names: [],
      percent: 10,
      fromDate: "2026-10-31",
    };
    const before = cashSchedule(snapshot, model, []).items;
    const after = cashSchedule(snapshot, model, [up]).items;
    expect(after.find((i) => i.id === "inv_big")?.amount).toBe(500_000);
    const plans = (xs: typeof before) => xs.filter((i) => i.kind === "plan").map((i) => i.amount);
    expect(plans(after)).toEqual(plans(before).map((a) => Math.round(a * 1.1)));
    expect(steps(deltas([up]))).toBeGreaterThan(2);
  });

  it("contagion: the late invoice and that customer's later receipts all slip", () => {
    const late: Change[] = [
      {
        kind: "delay_customer",
        customerId: "big",
        days: 15,
        fromDate: "2026-11-05",
        basis: "Assumption: later invoices slip half as long",
      },
      { kind: "delay_invoice", invoiceId: "inv_big", days: 30 },
    ];
    const base = cashSchedule(snapshot, model, []).items;
    const after = cashSchedule(snapshot, model, late).items;
    expect(after.find((i) => i.id === "inv_big")?.date).toBe("2026-12-04");
    for (const b of base.filter((i) => i.kind === "plan" && i.customerId === "big")) {
      const a = after.find((i) => i.id === b.id);
      expect(a?.date).toBe(
        new Date(Date.parse(b.date) + 15 * 86_400_000).toISOString().slice(0, 10),
      );
    }
    for (const b of base.filter((i) => i.customerId === "small"))
      expect(after.find((i) => i.id === b.id)?.date).toBe(b.date);
    // A lone delay_invoice opens a gap and closes it; contagion keeps moving later weeks too.
    const lone = deltas([{ kind: "delay_invoice", invoiceId: "inv_big", days: 30 }]);
    expect(steps(deltas(late))).toBeGreaterThan(steps(lone));
  });

  it("no persistent change is a pure offset: weekly deltas are not constant", () => {
    const all: Change[][] = [
      [{ kind: "churn", customerId: "big", fromDate: "2026-11-01" }],
      [
        {
          kind: "recurring_cash",
          label: "hire",
          direction: "out",
          amount: 100_000,
          fromDate: "2026-11-06",
          everyDays: 14,
        },
      ],
      [
        {
          kind: "scale_recurring",
          label: "cut",
          flows: "spend",
          names: ["AWS"],
          percent: -50,
          fromDate: "2026-11-01",
        },
      ],
    ];
    // A pure offset is one step then flat (steps === 1).
    for (const changes of all) expect(steps(deltas(changes))).toBeGreaterThan(1);
  });
});
