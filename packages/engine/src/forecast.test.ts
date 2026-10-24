import { type CompanyModel, ForecastSchema, type Snapshot } from "@domino/contracts";
import { WEEK_STARTS, fixtures } from "@domino/contracts/fixtures";
import { describe, expect, it } from "vitest";
import { addDays, weekStarts } from "./dates";
import { forecast } from "./forecast";

// Minimal hand-checkable company. Every expected number below is computed by hand.
const tiny: Snapshot = {
  companyId: "tiny",
  asOf: "2026-10-30", // Friday, so week 0 starts Monday 2026-11-02
  cashOnHand: 1_000_000,
  restrictedCash: 100_000,
  customers: [{ id: "c1", name: "C1", paymentTermsDays: 30 }],
  invoices: [],
  bankTxns: [],
  bills: [],
  cardTxns: [],
  payroll: [],
  deals: [],
};
const noModel: CompanyModel = { version: 0, customerDelayDays: {}, recurringSpend: [], rules: [] };

const withInvoice = (due: string, amount = 1000, paid?: string): Snapshot => ({
  ...tiny,
  invoices: [
    { id: "i1", customerId: "c1", amount, issued: "2026-10-01", due, ...(paid ? { paid } : {}) },
  ],
});
const withBill = (due: string, critical = false): Snapshot => ({
  ...tiny,
  bills: [{ id: "b1", vendor: "V", amount: 500, due, critical }],
});
const inflows = (s: Snapshot, m = noModel, c: Parameters<typeof forecast>[2] = []) =>
  forecast(s, m, c).weeks.map((w) => w.inflow);
const outflows = (s: Snapshot, m = noModel, c: Parameters<typeof forecast>[2] = []) =>
  forecast(s, m, c).weeks.map((w) => w.outflow);
const at = (i: number, amount: number) =>
  Array.from({ length: 13 }, (_, j) => (j === i ? amount : 0));

// The fixture's signed Acme renewal has a same-amount invoice and no link, so it is ambiguous.
// Tests that use the fixture remove that deal.
const kestrel: Snapshot = {
  ...fixtures.snapshot,
  deals: fixtures.snapshot.deals.filter((d) => d.id !== "deal_acme_renewal"),
};

describe("dates", () => {
  it("starts on the Monday after asOf", () => {
    expect(weekStarts("2026-10-30", 13)).toEqual([...WEEK_STARTS]);
    expect(weekStarts("2026-11-02", 1)).toEqual(["2026-11-09"]); // Monday asOf: next Monday
    expect(weekStarts("2026-11-01", 1)).toEqual(["2026-11-02"]); // Sunday asOf
  });
  it("adds days across month and year ends in UTC", () => {
    expect(addDays("2026-12-16", 45)).toBe("2027-01-30");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
  });
  it("rejects impossible dates", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow(/date/);
  });
});

describe("forecast balances", () => {
  it("empty schedule keeps cash flat", () => {
    const f = forecast(tiny, noModel, []);
    for (const w of f.weeks)
      expect(w).toMatchObject({
        opening: 1_000_000,
        inflow: 0,
        outflow: 0,
        closing: 1_000_000,
        usable: 900_000,
      });
    expect(f.lowPoint).toEqual({ weekStart: "2026-11-02", usable: 900_000 });
  });
  it("every week balances and usable = closing - restrictedCash", () => {
    const f = forecast(kestrel, fixtures.model, []);
    expect(ForecastSchema.parse(f)).toEqual(f);
    let opening = kestrel.cashOnHand;
    for (const w of f.weeks) {
      expect(w.opening).toBe(opening);
      expect(w.closing).toBe(w.opening + w.inflow - w.outflow);
      expect(w.usable).toBe(w.closing - kestrel.restrictedCash);
      expect(Number.isInteger(w.closing)).toBe(true);
      opening = w.closing;
    }
    const min = Math.min(...f.weeks.map((w) => w.usable));
    expect(f.lowPoint.usable).toBe(min);
    expect(f.lowPoint.weekStart).toBe(f.weeks.find((w) => w.usable === min)?.weekStart);
  });
});

describe("cash in", () => {
  it("Acme's invoice lands 21 days after its due date, in the week of 2026-12-16", () => {
    const lost = forecast(kestrel, fixtures.model, [
      { kind: "lose_invoice", invoiceId: "inv_acme_2027" },
    ]);
    const kept = forecast(kestrel, fixtures.model, []);
    const diff = kept.weeks.map((w, i) => w.inflow - (lost.weeks[i]?.inflow ?? 0));
    expect(diff).toEqual(at(WEEK_STARTS.indexOf("2026-12-14"), 24_000_000));
  });
  it("rounds the mean delay to whole days", () => {
    const m = { ...noModel, customerDelayDays: { c1: { mean: 2.5, p90: 5, samples: 2 } } };
    // due Sat 2026-11-07 + 3 days = Tue 2026-11-10 -> week 1 (2.5 rounds up)
    expect(inflows(withInvoice("2026-11-07"), m)).toEqual(at(1, 1000));
  });
  it("paid invoices and paid bills add nothing", () => {
    expect(inflows(withInvoice("2026-11-10", 1000, "2026-10-20"))).toEqual(at(0, 0));
    const paidBill = {
      ...tiny,
      bills: [
        {
          id: "b1",
          vendor: "V",
          amount: 500,
          due: "2026-11-10",
          paid: "2026-10-01",
          critical: false,
        },
      ],
    };
    expect(outflows(paidBill)).toEqual(at(0, 0));
  });
  it("the unsigned Northwind deal adds no cash", () => {
    const without = {
      ...kestrel,
      deals: kestrel.deals.filter((d) => d.id !== "deal_nw_expansion"),
    };
    expect(forecast(kestrel, fixtures.model, [])).toEqual(forecast(without, fixtures.model, []));
  });
  it("a signed won deal pays at close + terms + mean delay; open and lost deals add nothing", () => {
    const m = { ...noModel, customerDelayDays: { c1: { mean: 5, p90: 9, samples: 3 } } };
    const deal = (stage: "open" | "won" | "lost") => ({
      id: `d_${stage}`,
      customerId: "c1",
      amount: 7000,
      stage,
      expectedClose: "2026-11-01",
      signed: true,
    });
    const s = { ...tiny, deals: [deal("won"), deal("open"), deal("lost")] };
    // 2026-11-01 + 30 + 5 = Sun 2026-12-06 -> week of 2026-11-30 (index 4)
    expect(inflows(s, m)).toEqual(at(4, 7000));
  });
  it("rejects a signed won deal that may already be invoiced (original fixture)", () => {
    expect(() => forecast(fixtures.snapshot, fixtures.model, [])).toThrow(
      /ambiguous.*deal_acme_renewal.*inv_acme_2027/,
    );
  });
});

describe("cash out and horizon edges", () => {
  it("payroll on its date, unpaid bills on due date, recurring spend from asOf + everyDays", () => {
    const s = {
      ...withBill("2026-11-15"),
      payroll: [
        { id: "p1", date: "2026-11-20", amount: 300 },
        { id: "p0", date: "2026-10-30", amount: 999 },
      ],
    };
    const m = { ...noModel, recurringSpend: [{ label: "SaaS", amount: 40, everyDays: 30 }] };
    // bill Sun 11-15 -> wk1; payroll 11-20 -> wk2; payroll on asOf is past; SaaS 11-29 wk3, 12-29 wk8, 01-28 wk12
    const expected = at(1, 500);
    expected[2] = 300;
    expected[3] = 40;
    expected[8] = 40;
    expected[12] = 40;
    expect(outflows(s, m)).toEqual(expected);
  });
  it("Monday belongs to its own week, Sunday to the previous one", () => {
    expect(inflows(withInvoice("2026-11-09"))).toEqual(at(1, 1000));
    expect(inflows(withInvoice("2026-11-08"))).toEqual(at(0, 1000));
  });
  it("overdue and pre-week-0 flows land in week 0; flows after the horizon are dropped", () => {
    expect(inflows(withInvoice("2026-09-01"))).toEqual(at(0, 1000));
    expect(inflows(withInvoice("2026-10-31"))).toEqual(at(0, 1000));
    expect(inflows(withInvoice("2027-01-31"))).toEqual(at(12, 1000));
    expect(inflows(withInvoice("2027-02-01"))).toEqual(at(0, 0));
  });
});

describe("changes", () => {
  const inv = withInvoice("2026-11-10"); // week 1
  it("delay_invoice: 45 days on Acme lands 2027-01-30 (last week); 60 days leaves the window", () => {
    const base = forecast(kestrel, fixtures.model, []);
    const d45 = forecast(kestrel, fixtures.model, [
      { kind: "delay_invoice", invoiceId: "inv_acme_2027", days: 45 },
    ]);
    const diff = d45.weeks.map((w, i) => w.inflow - (base.weeks[i]?.inflow ?? 0));
    const expected = at(WEEK_STARTS.indexOf("2027-01-25"), 24_000_000);
    expected[WEEK_STARTS.indexOf("2026-12-14")] = -24_000_000;
    expect(diff).toEqual(expected);
    const d60 = forecast(kestrel, fixtures.model, [
      { kind: "delay_invoice", invoiceId: "inv_acme_2027", days: 60 },
    ]);
    expect(d60.weeks[12]?.closing).toBe((base.weeks[12]?.closing ?? 0) - 24_000_000);
  });
  it("delays stack and a negative delay reverses one", () => {
    const d = (days: number) => ({ kind: "delay_invoice" as const, invoiceId: "i1", days });
    expect(inflows(inv, noModel, [d(7), d(7)])).toEqual(at(3, 1000));
    expect(forecast(inv, noModel, [d(30), d(-30)])).toEqual(forecast(inv, noModel, []));
  });
  it("lose_invoice removes cash; later changes to it do nothing", () => {
    expect(
      inflows(inv, noModel, [
        { kind: "lose_invoice", invoiceId: "i1" },
        { kind: "delay_invoice", invoiceId: "i1", days: 7 },
      ]),
    ).toEqual(at(0, 0));
  });
  it("rejects changes to unknown records", () => {
    expect(() => forecast(inv, noModel, [{ kind: "lose_invoice", invoiceId: "nope" }])).toThrow(
      /nope/,
    );
    expect(() => forecast(inv, noModel, [{ kind: "delay_bill", billId: "nope", days: 1 }])).toThrow(
      /nope/,
    );
    expect(() =>
      forecast(inv, noModel, [{ kind: "churn", customerId: "nope", fromDate: "2026-11-01" }]),
    ).toThrow(/nope/);
  });
  it("churn removes the customer's cash dated on or after fromDate", () => {
    const s = {
      ...tiny,
      invoices: [
        ...withInvoice("2026-11-03").invoices,
        { id: "i2", customerId: "c1", amount: 2000, issued: "2026-10-01", due: "2026-11-24" },
      ],
    };
    expect(
      inflows(s, noModel, [{ kind: "churn", customerId: "c1", fromDate: "2026-11-24" }]),
    ).toEqual(at(0, 1000));
  });
  it("add_cash and remove_cash add one-time items; negative amounts are rejected", () => {
    const changes = [
      { kind: "add_cash" as const, date: "2026-11-16", amount: 150, label: "Deal" },
      { kind: "remove_cash" as const, date: "2027-01-01", amount: 63, label: "Overage" },
    ];
    expect(inflows(tiny, noModel, changes)).toEqual(at(2, 150));
    expect(outflows(tiny, noModel, changes)).toEqual(at(8, 63));
    expect(() =>
      forecast(tiny, noModel, [{ kind: "add_cash", date: "2026-11-16", amount: -1, label: "x" }]),
    ).toThrow(/negative/);
  });
  it("delay_bill moves the bill and refuses critical bills", () => {
    expect(
      outflows(withBill("2026-11-03"), noModel, [{ kind: "delay_bill", billId: "b1", days: 14 }]),
    ).toEqual(at(2, 500));
    expect(() =>
      forecast(withBill("2026-11-03", true), noModel, [
        { kind: "delay_bill", billId: "b1", days: 14 },
      ]),
    ).toThrow(/critical/);
  });
  it("discount_early_pay pays on payOn at a discount rounded to whole cents", () => {
    const early = (percent: number) => ({
      kind: "discount_early_pay" as const,
      invoiceId: "i1",
      percent,
      payOn: "2026-11-03",
    });
    expect(inflows(withInvoice("2026-12-01", 333), noModel, [early(2)])).toEqual(at(0, 326)); // 326.34
    expect(inflows(withInvoice("2026-12-01", 50), noModel, [early(1)])).toEqual(at(0, 50)); // 49.5 rounds up
  });
  it("applies changes in the given order", () => {
    const early = {
      kind: "discount_early_pay" as const,
      invoiceId: "i1",
      percent: 0,
      payOn: "2026-11-03",
    };
    const delay = { kind: "delay_invoice" as const, invoiceId: "i1", days: 14 };
    expect(inflows(inv, noModel, [delay, early])).toEqual(at(0, 1000));
    expect(inflows(inv, noModel, [early, delay])).toEqual(at(2, 1000));
  });
  it("shift_hire saves monthlyCost per day of each month over [fromDate, toDate), rounded once per week", () => {
    const hire = (monthlyCost: number, fromDate: string, toDate: string) => ({
      kind: "shift_hire" as const,
      label: "Eng",
      monthlyCost,
      fromDate,
      toDate,
    });
    // November has 30 days: 3000 / 30 = 100 per day, 7 days per week
    const twoWeeks = at(0, 700);
    twoWeeks[1] = 700;
    expect(inflows(tiny, noModel, [hire(3000, "2026-11-02", "2026-11-16")])).toEqual(twoWeeks);
    // Nov 30 (1000/30) + Dec 1-6 (6 * 1000/31) = 226.88 -> 227 (per-day rounding would give 225)
    expect(inflows(tiny, noModel, [hire(1000, "2026-11-30", "2026-12-07")])).toEqual(at(4, 227));
    expect(() => forecast(tiny, noModel, [hire(1000, "2026-12-07", "2026-11-30")])).toThrow(
      /toDate/,
    );
  });
  it("shift_hire counts only days after asOf (regression: review E3a-f9b5ad2 P1)", () => {
    const hire = (fromDate: string, toDate: string) => ({
      kind: "shift_hire" as const,
      label: "Eng",
      monthlyCost: 300_000,
      fromDate,
      toDate,
    });
    // Entirely before asOf 2026-10-30: opening cash already reflects it
    expect(inflows(tiny, noModel, [hire("2026-10-01", "2026-10-02")])).toEqual(at(0, 0));
    // [10-29, 11-03): 10-29 and asOf itself excluded; 10-31 (1/31 of Oct), 11-01 and 11-02
    // (2/30 of Nov) all land in week 0: 300000/31 + 20000 = 29677.42 -> 29677
    expect(inflows(tiny, noModel, [hire("2026-10-29", "2026-11-03")])).toEqual(at(0, 29_677));
  });
  it("rounds exact values half up, once (regression: review E3a-f9b5ad2 P2)", () => {
    // asOf Fri 2027-01-29, week 0 = Feb 1-7: 100018 * 7 / 28 = 25004.5 -> 25005
    const feb = { ...tiny, asOf: "2027-01-29" };
    const hire = {
      kind: "shift_hire" as const,
      label: "Eng",
      monthlyCost: 100_018,
      fromDate: "2027-02-01",
      toDate: "2027-02-08",
    };
    expect(inflows(feb, noModel, [hire])).toEqual(at(0, 25_005));
    // 125 * (100 - 64.4) / 100 = 44.5 -> 45
    const early = {
      kind: "discount_early_pay" as const,
      invoiceId: "i1",
      percent: 64.4,
      payOn: "2026-11-03",
    };
    expect(inflows(withInvoice("2026-12-01", 125), noModel, [early])).toEqual(at(0, 45));
  });
});

describe("purity", () => {
  const all: Parameters<typeof forecast>[2] = [
    { kind: "delay_invoice", invoiceId: "inv_acme_2027", days: 45 },
    { kind: "discount_early_pay", invoiceId: "inv_cobalt_2027", percent: 2, payOn: "2026-11-20" },
    {
      kind: "shift_hire",
      label: "Eng",
      monthlyCost: 2_200_000,
      fromDate: "2026-11-16",
      toDate: "2026-12-16",
    },
    { kind: "delay_bill", billId: "bill_agency_nov", days: 30 },
  ];
  it("does not mutate its inputs", () => {
    const s = structuredClone(kestrel);
    const m = structuredClone(fixtures.model);
    const c = structuredClone(all);
    forecast(s, m, c);
    expect([s, m, c]).toEqual([kestrel, fixtures.model, all]);
  });
  it("same inputs give identical outputs", () => {
    expect(forecast(kestrel, fixtures.model, all)).toEqual(forecast(kestrel, fixtures.model, all));
  });
});
