import type { BillingPlan, CompanyModel, Constraint, Invoice, Snapshot } from "@domino/contracts";
import { SnapshotSchema } from "@domino/contracts";
import { describe, expect, it } from "vitest";
import { addMonthsClamped } from "./dates";
import { dominoes } from "./dominoes";
import { cashSchedule, forecast } from "./forecast";
import { pastEvents } from "./history";
import { candidate, learn } from "./learn";
import { scanRisks } from "./risks";
import { evaluateRules } from "./rules";
import { stressTest } from "./stress-test";

// C3 forward fields. asOf Friday 2026-10-30: week i starts 2026-11-02 + 7i; the horizon ends
// Sunday 2027-01-31. Every expected number is derived by hand in the comment beside it.
const tiny = (extra: Partial<Snapshot> = {}): Snapshot =>
  SnapshotSchema.parse({
    companyId: "tiny",
    asOf: "2026-10-30",
    cashOnHand: 1_000_000,
    restrictedCash: 0,
    customers: [
      { id: "c1", name: "One Co", paymentTermsDays: 30 },
      { id: "c2", name: "Two Co", paymentTermsDays: 30 },
    ],
    invoices: [],
    bankTxns: [],
    bills: [],
    cardTxns: [],
    payroll: [],
    deals: [],
    ...extra,
  });
const minCashRule: Constraint = {
  id: "m1",
  label: "Lender's minimum",
  kind: "min_cash",
  limit: 400,
  evidence: { source: "document", ref: "loan.pdf#1", note: "Keep $4 usable" },
};
const noModel: CompanyModel = { version: 0, customerDelayDays: {}, recurringSpend: [], rules: [] };
const delayed = (mean: number, p90 = mean): CompanyModel => ({
  ...noModel,
  customerDelayDays: { c1: { mean, p90, samples: 3 } },
});
const inflows = (s: Snapshot, m = noModel, c: Parameters<typeof forecast>[2] = []) =>
  forecast(s, m, c).weeks.map((w) => w.inflow);
const at = (...pairs: [number, number][]) =>
  Array.from({ length: 13 }, (_, j) =>
    pairs.filter(([i]) => i === j).reduce((s, [, a]) => s + a, 0),
  );
const plan = (extra: Partial<BillingPlan> = {}): BillingPlan => ({
  id: "p1",
  customerId: "c1",
  amount: 1000,
  anchorDate: "2026-09-15",
  nextInvoiceDate: "2026-11-15",
  everyMonths: 1,
  paymentTermsDays: 30,
  ...extra,
});
const open = (extra: Partial<Invoice> = {}): Invoice => ({
  id: "i1",
  customerId: "c1",
  amount: 1000,
  issued: "2026-10-15",
  due: "2026-11-14",
  ...extra,
});
const planDates = (s: Snapshot, m = noModel) =>
  cashSchedule(s, m, [])
    .items.filter((i) => i.kind === "plan")
    .map((i) => [i.id, i.date]);

describe("dates: anchored month cadence", () => {
  it("clamps to short months without moving the anchor day", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonthsClamped("2024-02-29", 12)).toBe("2025-02-28");
    expect(addMonthsClamped("2024-02-29", 48)).toBe("2028-02-29");
    expect(addMonthsClamped("2026-10-31", 3)).toBe("2027-01-31");
  });
});

describe("forecast: billing plans", () => {
  it("expands Jan 31, Feb 28, Mar 31 from the cursor through the issuance horizon", () => {
    // asOf Fri 2027-01-15: weeks start 01-18, horizon ends Sun 04-18. Terms 0, no delay.
    const s = tiny({
      asOf: "2027-01-15",
      billingPlans: [
        plan({ anchorDate: "2026-10-31", nextInvoiceDate: "2027-01-31", paymentTermsDays: 0 }),
      ],
    });
    expect(planDates(s)).toEqual([
      ['["p1","2027-01-31"]', "2027-01-31"],
      ['["p1","2027-02-28"]', "2027-02-28"],
      ['["p1","2027-03-31"]', "2027-03-31"],
    ]);
  });

  it("keeps a leap-day yearly anchor on Feb 28 in common years", () => {
    const s = tiny({
      asOf: "2027-01-15",
      billingPlans: [
        plan({
          anchorDate: "2024-02-29",
          nextInvoiceDate: "2027-02-28",
          everyMonths: 12,
          paymentTermsDays: 0,
        }),
      ],
    });
    expect(planDates(s)).toEqual([['["p1","2027-02-28"]', "2027-02-28"]]);
  });

  it("counts the linked issued invoice and each future occurrence once", () => {
    // i1 due 11-14 (week 1). Occurrences 11-15, 12-15, 01-15 + 30 days terms:
    // 12-15 (week 6), 01-14 (week 10), 02-14 (after the horizon).
    const s = tiny({
      billingPlans: [plan()],
      invoices: [open({ billingPlanId: "p1" })],
    });
    expect(inflows(s)).toEqual(at([1, 1000], [6, 1000], [10, 1000]));
  });

  it("endDate limits issuance, not collection; a canceled plan keeps its open invoice", () => {
    // endDate 12-15: occurrences 11-15 and 12-15 only; the 12-15 receipt 01-14 is still counted.
    const ended = tiny({ billingPlans: [plan({ endDate: "2026-12-15" })] });
    expect(inflows(ended)).toEqual(at([6, 1000], [10, 1000]));
    // endDate before the cursor: no occurrences, but the issued invoice is still collected.
    const canceled = tiny({
      billingPlans: [plan({ endDate: "2026-10-20" })],
      invoices: [open({ billingPlanId: "p1" })],
    });
    expect(inflows(canceled)).toEqual(at([1, 1000]));
  });

  it("adds the rounded learned delay, and a late delay can push receipts past the horizon", () => {
    // Mean 19.6 rounds to 20: 11-15 + 50 = 01-04 (week 9); 12-15 + 50 = 02-03 (outside).
    expect(inflows(tiny({ billingPlans: [plan()] }), delayed(19.6))).toEqual(at([9, 1000]));
  });

  it("never receives before issuance under a negative delay", () => {
    // -40: 11-15 + 30 - 40 = 11-05, clamped to 11-15 (week 1); likewise 12-15 (week 6), 01-15 (week 10).
    expect(inflows(tiny({ billingPlans: [plan()] }), delayed(-40))).toEqual(
      at([1, 1000], [6, 1000], [10, 1000]),
    );
    // Ordinary invoice issued 11-20, due 11-25: 11-25 - 40 = 10-16 would be week 0; clamped to 11-20 (week 2).
    const s = tiny({ invoices: [open({ issued: "2026-11-20", due: "2026-11-25" })] });
    expect(inflows(s, delayed(-40))).toEqual(at([2, 1000]));
  });

  it("stops plan receipts at a churn fromDate, like invoices and deals", () => {
    // Without churn: weeks 6 and 10 (see above). Churn from 01-01 drops only the 01-14 receipt.
    const s = tiny({ billingPlans: [plan()] });
    expect(
      inflows(s, noModel, [{ kind: "churn", customerId: "c1", fromDate: "2027-01-01" }]),
    ).toEqual(at([6, 1000]));
    // A different customer's churn changes nothing.
    expect(
      inflows(s, noModel, [{ kind: "churn", customerId: "c2", fromDate: "2026-11-01" }]),
    ).toEqual(at([6, 1000], [10, 1000]));
  });

  it("applies changes in order across invoices and plans", () => {
    // i1 due 11-14. Churn from 12-01 first keeps i1, then a 30-day delay moves it to 12-14 (week 6).
    // Delay first moves i1 to 12-14, then the churn drops it. The plan's 12-15 receipt is churned both ways.
    const s = tiny({ billingPlans: [plan()], invoices: [open({ billingPlanId: "p1" })] });
    const churn = { kind: "churn", customerId: "c1", fromDate: "2026-12-01" } as const;
    const delay = { kind: "delay_invoice", invoiceId: "i1", days: 30 } as const;
    expect(inflows(s, noModel, [churn, delay])).toEqual(at([6, 1000]));
    expect(inflows(s, noModel, [delay, churn])).toEqual(at());
  });
});

describe("forecast: settlement fields", () => {
  it("uses an agreed collection date and amount over the learned delay and original amount", () => {
    // Delay +10 would give 11-24; the agreed 12-01 (week 4) for 900 wins.
    const s = tiny({ invoices: [open({ collection: { payOn: "2026-12-01", amount: 900 } })] });
    expect(inflows(s, delayed(10))).toEqual(at([4, 900]));
  });

  it("forecasts a paid-but-unbanked payout once at its net amount, immune to invoice changes", () => {
    // i1 paid 10-28 (gross 1000) is skipped; its payout of 970 lands 11-03 (week 0).
    const s = tiny({
      invoices: [open({ paid: "2026-10-28", paidAmount: 1000 })],
      pendingPayouts: [
        { id: "po1", amount: 970, expectedArrival: "2026-11-03", invoiceIds: ["i1"] },
      ],
    });
    expect(inflows(s)).toEqual(at([0, 970]));
    const changes = [
      { kind: "churn", customerId: "c1", fromDate: "2026-10-01" },
      { kind: "delay_invoice", invoiceId: "i1", days: 30 },
      { kind: "lose_invoice", invoiceId: "i1" },
      { kind: "discount_early_pay", invoiceId: "i1", percent: 5, payOn: "2026-11-20" },
    ] as const;
    expect(inflows(s, noModel, [...changes])).toEqual(at([0, 970]));
    // An overdue estimate still has to arrive: week 0.
    const overdue = tiny({
      ...s,
      pendingPayouts: [
        { id: "po1", amount: 970, expectedArrival: "2026-10-29", invoiceIds: ["i1"] },
      ],
    });
    expect(inflows(overdue)).toEqual(at([0, 970]));
  });

  it("gives a written-off invoice no cash and no risk", () => {
    const s = tiny({
      invoices: [open({ writtenOff: "2026-10-20" })],
      deals: [
        {
          id: "d1",
          customerId: "c1",
          amount: 1000,
          stage: "won",
          expectedClose: "2026-10-01",
          signed: true,
          invoiceId: "i1",
          kind: "renewal",
        },
      ],
    });
    expect(inflows(s, delayed(5, 30))).toEqual(at());
    expect(scanRisks(s, delayed(5, 30), [])).toEqual([]);
  });

  it("pays a bill on its agreed date while its deadline keeps the original due date", () => {
    // Due 11-05, agreed 11-20 (week 2). Deadline 11-05 + 5 = 11-10: funded 11-20 is too late.
    const s = tiny({
      bills: [
        {
          id: "b1",
          vendor: "V",
          amount: 500,
          due: "2026-11-05",
          agreedPayOn: "2026-11-20",
          critical: false,
        },
      ],
    });
    expect(forecast(s, noModel, []).weeks.map((w) => w.outflow)).toEqual(at([2, 500]));
    const rule: Constraint = {
      id: "r1",
      label: "Pay V on time",
      kind: "pay_by_date",
      limit: 5,
      billId: "b1",
      evidence: { source: "document", ref: "v.pdf#1", note: "Pay within 5 days" },
    };
    const [result] = evaluateRules(s, forecast(s, noModel, []), [rule], {
      model: noModel,
      changes: [],
    });
    expect(result?.status).toBe("breached");
    expect(result?.breach?.date).toBe("2026-11-10");
  });
});

describe("risks and learning with settlement fields", () => {
  it("raises no automatic late risk on a collection agreement, and none on a zero receipt", () => {
    const renewal = {
      id: "d1",
      customerId: "c1",
      amount: 1000,
      stage: "won",
      expectedClose: "2026-10-01",
      signed: true,
      invoiceId: "i1",
      kind: "renewal",
    } as const;
    // Control: the same open invoice without an agreement gets a 10-day late risk.
    const plain = tiny({ invoices: [open()] });
    expect(scanRisks(plain, delayed(0, 10), []).map((r) => r.id)).toEqual(["risk_late_i1"]);
    // Agreed 900 on 12-01: no late risk; the renewal can still lose the agreed 900.
    const agreed = tiny({
      invoices: [open({ collection: { payOn: "2026-12-01", amount: 900 } })],
      deals: [renewal],
    });
    expect(scanRisks(agreed, delayed(0, 10), []).map((r) => r.label)).toEqual([
      "One Co does not renew ($9 invoice lost)",
    ]);
    const zero = tiny({
      invoices: [open({ collection: { payOn: "2026-12-01", amount: 0 } })],
      deals: [renewal],
    });
    expect(scanRisks(zero, delayed(0, 10), [])).toEqual([]);
  });

  it("labels a past late payment with the gross collected, not an agreed amount", () => {
    // Due 09-01, paid 10-01: 30 days late. paidAmount 950 is the proof; collection 900 is not.
    const s = tiny({
      invoices: [
        open({
          issued: "2026-08-01",
          due: "2026-09-01",
          paid: "2026-10-01",
          paidAmount: 950,
          collection: { payOn: "2026-09-20", amount: 900 },
        }),
      ],
    });
    const [event] = pastEvents(s, noModel);
    expect(event?.label).toBe("One Co paid $9.50 30 days late");
    expect(event?.amount).toBe(950);
  });

  it("does not learn organic delay from agreed or discounted settlements", () => {
    const paid = (id: string, extra: Partial<Invoice> = {}): Invoice =>
      open({ id, issued: "2026-08-01", due: "2026-09-01", paid: "2026-09-11", ...extra });
    const three = [paid("a"), paid("b"), paid("c")];
    expect(candidate(tiny({ invoices: three }), noModel)?.model.customerDelayDays.c1?.samples).toBe(
      3,
    );
    const agreed = [
      paid("a"),
      paid("b"),
      paid("c", { collection: { payOn: "2026-09-11", amount: 1000 } }),
    ];
    expect(candidate(tiny({ invoices: agreed }), noModel)).toBeNull();
    const discounted = [paid("a"), paid("b"), paid("c", { paidAmount: 950 })];
    expect(candidate(tiny({ invoices: discounted }), noModel)).toBeNull();
    // A full paidAmount is still ordinary evidence.
    const full = [paid("a"), paid("b"), paid("c", { paidAmount: 1000 })];
    expect(candidate(tiny({ invoices: full }), noModel)?.model.customerDelayDays.c1?.samples).toBe(
      3,
    );
  });

  it("replays an authentic origin with a plan and a pending payout exactly", () => {
    // Current: three c1 invoices paid 10 days late -> mean 10.
    const paid = (id: string, due: string, on: string): Invoice =>
      open({ id, issued: "2026-06-01", due, paid: on });
    const current = tiny({
      invoices: [
        paid("i1", "2026-08-01", "2026-08-11"),
        paid("i2", "2026-08-15", "2026-08-25"),
        paid("i3", "2026-09-01", "2026-09-11"),
      ],
    });
    // Origin Fri 09-04: inv_x due 09-09 lands 09-19 (10 days late). po1 arrives 09-09 and the c2
    // plan bills 09-10 with 0 terms; both land as forecast, so after learning every week matches.
    const origin = tiny({
      asOf: "2026-09-04",
      invoices: [
        open({ id: "inv_x", amount: 100_000, issued: "2026-08-10", due: "2026-09-09" }),
        open({
          id: "inv_p",
          customerId: "c2",
          issued: "2026-08-01",
          due: "2026-08-31",
          paid: "2026-09-02",
        }),
      ],
      billingPlans: [
        plan({
          customerId: "c2",
          amount: 20_000,
          anchorDate: "2026-08-10",
          nextInvoiceDate: "2026-09-10",
          paymentTermsDays: 0,
        }),
      ],
      pendingPayouts: [
        { id: "po1", amount: 970, expectedArrival: "2026-09-09", invoiceIds: ["inv_p"] },
      ],
    });
    const txn = (id: string, date: string, amount: number) => ({
      id,
      date,
      amount,
      description: id,
    });
    const learned = learn(current, noModel, [], {
      examples: [
        {
          snapshot: origin,
          actualBank: [
            txn("b_po", "2026-09-09", 970),
            txn("b_plan", "2026-09-10", 20_000),
            txn("b_x", "2026-09-19", 100_000),
          ],
          asOf: "2026-09-27",
          bankWindowComplete: true,
        },
      ],
    });
    expect(learned.version).toBe(1);
    expect(learned.rules[0]?.errorAfter).toBe(0);
  });
});

describe("dominoes with forward records", () => {
  const chain = (s: Snapshot) => {
    const changes = [{ kind: "churn", customerId: "c1", fromDate: "2026-11-01" }] as const;
    const f = forecast(s, noModel, [...changes]);
    return dominoes(f, [minCashRule], s, {
      model: noModel,
      changes: [...changes],
      baseline: forecast(s, noModel, []),
    });
  };

  it("does not pin a customer-wide churn on one invoice when plan receipts also move", () => {
    // Cash 1000; i1 1000 due 11-14 (week 1); bill 1500 due 11-18 (week 2). Churn drops i1, so
    // week 2 ends at -500, under 400. Invoice only: removing the churn moves only i1, so it is proven.
    const base = tiny({
      cashOnHand: 1000,
      invoices: [open()],
      bills: [{ id: "b1", vendor: "V", amount: 1500, due: "2026-11-18", critical: false }],
    });
    const alone = chain(base);
    expect(alone.find((d) => d.constraintId === "m1")?.causedBy).toBe(1);
    // With a c1 plan, removing the churn also restores plan receipts: no single-record proof.
    const withPlan = chain({ ...base, billingPlans: [plan()] });
    expect(withPlan.map((d) => d.label)).toEqual(alone.map((d) => d.label));
    expect(withPlan.some((d) => d.causedBy !== undefined)).toBe(false);
  });
});

describe("identities and boundaries", () => {
  it("keeps plan, payout and invoice identities apart even when IDs collide", () => {
    // Plan p1 (c1): 12-15 (week 6), 01-14 (week 10). c2 invoices: one named like the 11-15
    // occurrence, 500 due 11-20 (week 2); one named po1, 300 due 11-27 (week 3). Payout po1 970 (week 0).
    const s = tiny({
      billingPlans: [plan()],
      invoices: [
        open({ id: '["p1","2026-11-15"]', customerId: "c2", amount: 500, due: "2026-11-20" }),
        open({ id: "po1", customerId: "c2", amount: 300, due: "2026-11-27" }),
        open({ id: "i9", customerId: "c2", paid: "2026-10-28" }),
      ],
      pendingPayouts: [
        { id: "po1", amount: 970, expectedArrival: "2026-11-03", invoiceIds: ["i9"] },
      ],
    });
    expect(inflows(s)).toEqual(at([0, 970], [2, 500], [3, 300], [6, 1000], [10, 1000]));
    const moved = inflows(s, noModel, [
      { kind: "delay_invoice", invoiceId: '["p1","2026-11-15"]', days: 7 },
      { kind: "lose_invoice", invoiceId: "po1" },
    ]);
    expect(moved).toEqual(at([0, 970], [3, 500], [6, 1000], [10, 1000]));
    const churned = inflows(s, noModel, [
      { kind: "churn", customerId: "c2", fromDate: "2026-11-01" },
    ]);
    expect(churned).toEqual(at([0, 970], [6, 1000], [10, 1000]));
  });

  it("puts pre-Monday receipts in week 0 and includes issuance on the final Sunday", () => {
    // Cursor Sat 10-31, terms 0: 10-31 (week 0), 11-30 (week 4), 12-31 (week 8), Sun 01-31 (week 12).
    const s = tiny({
      billingPlans: [
        plan({ anchorDate: "2026-10-31", nextInvoiceDate: "2026-10-31", paymentTermsDays: 0 }),
      ],
    });
    expect(inflows(s)).toEqual(at([0, 1000], [4, 1000], [8, 1000], [12, 1000]));
  });

  it("measures the stress-test delay threshold from the original due date to the clamped receipt", () => {
    // Issued 11-20, due 11-25, mean -40: receipt clamped to 11-20 (week 2). Cash 1000, bill 1500
    // on 12-07 (week 5). The receipt must leave week 5: 12-14 is 24 extra days. Total from due:
    // 11-25 -> 11-20 is -5, so -5 + 24 = 19 (the old mean-based sum would claim -16).
    const s = tiny({
      cashOnHand: 1000,
      invoices: [open({ issued: "2026-11-20", due: "2026-11-25" })],
      bills: [{ id: "b1", vendor: "V", amount: 1500, due: "2026-12-07", critical: false }],
    });
    const m = delayed(-40, -10);
    const floor: Constraint = { ...minCashRule, limit: 0 };
    const report = stressTest(s, m, [floor], scanRisks(s, m, [floor]), []);
    expect(report.breakingPoints.find((b) => b.unit === "days_late")).toEqual({
      label: "One Co paying 19 or more days late",
      threshold: 19,
      unit: "days_late",
    });
  });

  it("refuses weekly totals beyond the safe integer range", () => {
    const s = tiny({
      invoices: [open({ id: "a", amount: 2 ** 52 }), open({ id: "b", amount: 2 ** 52 })],
    });
    expect(() => forecast(s, noModel, [])).toThrow(/unsafe cash total/);
  });
});
