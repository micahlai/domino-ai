import { type Change, type CompanyModel, type Snapshot, SnapshotSchema } from "@domino/contracts";
import { fixtures } from "@domino/contracts/fixtures";
import { describe, expect, it } from "vitest";
import kestrelSeed from "../../contracts/src/fixtures/weekly-boundary/kestrel-weekly-seed.json";
import {
  CFS_LINES,
  type CashFlowStatement,
  type CfsLineId,
  type CfsWeek,
  actualCashFlow,
  cashFlowStatement,
  cashFlowSummary,
  projectedCashFlow,
} from "./cash-flow-statement";
import { forecast } from "./forecast";
import { history } from "./history";

// Every expected cent below is computed by hand in the comments.
const synthetic: Snapshot = SnapshotSchema.parse({
  companyId: "synth",
  asOf: "2026-10-28", // Wednesday: actual weeks 10-19..10-25 and 10-26..10-28; projection 11-02
  cashOnHand: 5_000_000,
  restrictedCash: 100_000,
  customers: [{ id: "c1", name: "Acme Co", paymentTermsDays: 30 }],
  invoices: [
    {
      id: "inv_1",
      customerId: "c1",
      amount: 500_000,
      issued: "2026-09-17",
      due: "2026-10-17",
      paid: "2026-10-17",
    },
    { id: "inv_2", customerId: "c1", amount: 300_000, issued: "2026-10-10", due: "2026-11-10" },
  ],
  bankTxns: [
    // Week 2026-10-19
    {
      id: "t1",
      date: "2026-10-19",
      amount: 500_000,
      description: "STRIPE PAYOUT inv_1",
      counterparty: "Stripe",
    },
    {
      id: "t2",
      date: "2026-10-20",
      amount: -200_000,
      description: "GUSTO PAYROLL pay_1",
      counterparty: "Gusto",
    },
    {
      id: "t3",
      date: "2026-10-20",
      amount: -15_000,
      description: "PAYROLL TAX DEPOSIT",
      counterparty: "IRS",
    },
    {
      id: "t4",
      date: "2026-10-21",
      amount: -40_000,
      description: "BILL bill_sup",
      counterparty: "Cloud provider",
    },
    {
      id: "t5",
      date: "2026-10-21",
      amount: -60_000,
      description: "BILL bill_rent",
      counterparty: "Office landlord",
    },
    {
      id: "t6",
      date: "2026-10-22",
      amount: -25_000,
      description: "CARD SETTLEMENT card_1",
      counterparty: "Card issuer",
    },
    { id: "t7", date: "2026-10-22", amount: -30_000, description: "IRS ESTIMATED TAX" },
    {
      id: "t8",
      date: "2026-10-23",
      amount: -5_000,
      description: "LOAN INTEREST OCT",
      counterparty: "Bank",
    },
    {
      id: "t9",
      date: "2026-10-23",
      amount: -12_345,
      description: "WIRE MISC",
      counterparty: "Unknown Co",
    },
    // Week 2026-10-26 (partial, through asOf)
    { id: "t10", date: "2026-10-26", amount: -80_000, description: "EQUIPMENT PURCHASE LAPTOPS" },
    {
      id: "t11",
      date: "2026-10-26",
      amount: -20_000,
      description: "CAPITALIZED SOFTWARE CONTRACTOR",
    },
    { id: "t12", date: "2026-10-27", amount: -7_000, description: "ACQUISITION DEPOSIT" },
    { id: "t13", date: "2026-10-27", amount: 1_000_000, description: "TERM LOAN DRAWDOWN" },
    { id: "t14", date: "2026-10-27", amount: -100_000, description: "LOAN PRINCIPAL PAYMENT" },
    { id: "t15", date: "2026-10-28", amount: 2_000_000, description: "SERIES A EQUITY WIRE" },
    { id: "t16", date: "2026-10-28", amount: -3_000, description: "EQUITY REPURCHASE" },
    { id: "t17", date: "2026-10-28", amount: 9_999, description: "INTEREST INCOME" },
    // After asOf: not in cashOnHand
    { id: "t18", date: "2026-10-29", amount: -1, description: "PENDING DEBIT" },
  ],
  bills: [
    {
      id: "bill_sup",
      vendor: "Cloud provider",
      amount: 40_000,
      due: "2026-10-21",
      paid: "2026-10-21",
      critical: true,
    },
    {
      id: "bill_rent",
      vendor: "Office landlord",
      amount: 60_000,
      due: "2026-10-21",
      paid: "2026-10-21",
      critical: true,
    },
    {
      id: "bill_tax",
      vendor: "State franchise tax board",
      amount: 20_000,
      due: "2026-10-20",
      critical: true,
    },
    {
      id: "bill_sup2",
      vendor: "Cloud provider",
      amount: 40_000,
      due: "2026-11-03",
      critical: true,
    },
    {
      id: "bill_rent_dec",
      vendor: "Office landlord",
      amount: 60_000,
      due: "2026-12-01",
      critical: true,
    },
  ],
  cardTxns: [
    { id: "card_1", date: "2026-10-15", amount: 25_000, merchant: "Figma", category: "Software" },
  ],
  payroll: [
    { id: "pay_1", date: "2026-10-20", amount: 200_000 },
    { id: "pay_2", date: "2026-11-06", amount: 200_000 },
  ],
  deals: [
    {
      id: "d1",
      customerId: "c1",
      amount: 400_000,
      stage: "won",
      expectedClose: "2026-11-01",
      signed: true,
      invoiceId: null,
    },
  ],
});
const model: CompanyModel = {
  version: 1,
  customerDelayDays: {},
  recurringSpend: [{ label: "Software subscriptions", amount: 10_000, everyDays: 30 }],
  rules: [],
};
const changes: Change[] = [
  { kind: "add_cash", label: "Bridge loan drawdown", amount: 500_000, date: "2026-11-16" },
  { kind: "remove_cash", label: "Office furniture", amount: 50_000, date: "2026-11-18" },
  { kind: "remove_cash", label: "Mystery fee", amount: 1_000, date: "2026-11-18" },
];

const nonZero = (w: CfsWeek) =>
  Object.fromEntries(Object.entries(w.lines).filter(([, v]) => v !== 0)) as Partial<
    Record<CfsLineId, number>
  >;

function expectTies(s: CashFlowStatement) {
  let previous: number | undefined;
  for (const w of s.weeks) {
    for (const section of ["operating", "investing", "financing"] as const) {
      const sum = CFS_LINES.filter((l) => l.section === section).reduce(
        (a, l) => a + w.lines[l.id],
        0,
      );
      expect(w[section]).toBe(sum);
    }
    expect(w.beginningCash + w.operating + w.investing + w.financing).toBe(w.endingCash);
    expect(w.netChange).toBe(w.endingCash - w.beginningCash);
    if (previous !== undefined) expect(w.beginningCash).toBe(previous);
    previous = w.endingCash;
    for (const v of Object.values(w.lines)) expect(Number.isSafeInteger(v)).toBe(true);
  }
}

function unwrap(r: ReturnType<typeof cashFlowStatement>): CashFlowStatement {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

describe("actual weeks", () => {
  const s = unwrap(actualCashFlow(synthetic));

  it("classifies every bank line by hand", () => {
    expect(s.weeks.map((w) => [w.weekStart, w.weekEnd, w.kind])).toEqual([
      ["2026-10-19", "2026-10-25", "actual"],
      ["2026-10-26", "2026-10-28", "actual"],
    ]);
    const [w1, w2] = s.weeks as [CfsWeek, CfsWeek];
    expect(nonZero(w1)).toEqual({
      customer_collections: 500_000,
      payroll: -215_000, // run -200,000 + payroll tax -15,000
      supplier_payments: -40_000,
      rent_facilities: -60_000,
      card_spend: -25_000,
      taxes_paid: -30_000,
      interest_paid: -5_000,
      other_operating: -12_345, // unclassified wire
    });
    // 500,000 - 215,000 - 40,000 - 60,000 - 25,000 - 30,000 - 5,000 - 12,345 = 112,655
    expect([w1.operating, w1.investing, w1.financing, w1.netChange]).toEqual([
      112_655, 0, 0, 112_655,
    ]);
    expect(nonZero(w2)).toEqual({
      other_operating: 9_999, // interest received
      capex: -80_000,
      capitalized_software: -20_000,
      other_investing: -7_000,
      debt_drawdown: 1_000_000,
      debt_repayment: -100_000,
      equity_raised: 2_000_000,
      other_financing: -3_000,
    });
    // CFI -107,000; CFF 1,000,000 - 100,000 + 2,000,000 - 3,000 = 2,897,000; net 2,799,999
    expect([w2.operating, w2.investing, w2.financing, w2.netChange]).toEqual([
      9_999, -107_000, 2_897_000, 2_799_999,
    ]);
    // Ending = cashOnHand 5,000,000; 5,000,000 - 2,799,999 = 2,200,001; - 112,655 = 2,087,346
    expect([w1.beginningCash, w1.endingCash, w2.endingCash]).toEqual([
      2_087_346, 2_200_001, 5_000_000,
    ]);
    expectTies(s);
  });

  it("reports unclassified and future-dated bank records instead of dropping them", () => {
    expect(s.unclassified).toEqual([
      {
        source: "bank",
        id: "t9",
        date: "2026-10-23",
        weekStart: "2026-10-19",
        amount: -12_345,
        text: "WIRE MISC / Unknown Co",
      },
    ]);
    expect(s.futureDated).toEqual(["t18"]);
  });

  it("limits to the last N weeks, rolling earlier cash into the beginning balance", () => {
    const one = unwrap(actualCashFlow(synthetic, { weeks: 1 }));
    expect(one.weeks.map((w) => [w.weekStart, w.beginningCash, w.endingCash])).toEqual([
      ["2026-10-26", 2_200_001, 5_000_000],
    ]);
  });

  it("returns the week and difference when a known opening balance does not tie", () => {
    const r = actualCashFlow(synthetic, { openingCash: 2_000_000 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // 2,000,000 + 112,655 = 2,112,655 vs bank-implied 2,200,001
    expect(r.error).toMatchObject({
      weekStart: "2026-10-19",
      kind: "actual",
      expected: 2_200_001,
      actual: 2_112_655,
      difference: -87_346,
    });
    expect(unwrap(actualCashFlow(synthetic, { openingCash: 2_087_346 })).weeks).toHaveLength(2);
  });
});

describe("projected weeks", () => {
  const s = unwrap(projectedCashFlow(synthetic, model, changes));
  const line = (i: number) => nonZero(s.weeks[i] as CfsWeek);

  it("classifies the forecast's own items by hand", () => {
    expect(s.weeks).toHaveLength(13);
    expect(s.weeks.every((w) => w.kind === "projected")).toBe(true);
    expect(s.weeks[0]?.weekStart).toBe("2026-11-02");
    // Week 0: overdue franchise tax bill, cloud bill 11-03, payroll 11-06
    expect(line(0)).toEqual({ taxes_paid: -20_000, supplier_payments: -40_000, payroll: -200_000 });
    expect(line(1)).toEqual({ customer_collections: 300_000 }); // inv_2 due 11-10
    expect(line(2)).toEqual({ debt_drawdown: 500_000, capex: -50_000, other_operating: -1_000 });
    expect(line(3)).toEqual({ card_spend: -10_000 }); // recurring asOf + 30 = 11-27
    // Deal closes 11-01 + 30 terms = 12-01; rent bill 12-01
    expect(line(4)).toEqual({ customer_collections: 400_000, rent_facilities: -60_000 });
    expect(line(7)).toEqual({ card_spend: -10_000 }); // 12-27
    expect(line(12)).toEqual({ card_spend: -10_000 }); // 2027-01-26
    for (const i of [5, 6, 8, 9, 10, 11]) expect(line(i)).toEqual({});
    // 5,000,000 -260,000 +300,000 +449,000 -10,000 +340,000 -10,000 -10,000 = 5,799,000
    expect(s.weeks.map((w) => w.endingCash)).toEqual([
      4_740_000, 5_040_000, 5_489_000, 5_479_000, 5_819_000, 5_819_000, 5_819_000, 5_809_000,
      5_809_000, 5_809_000, 5_809_000, 5_809_000, 5_799_000,
    ]);
    expect(s.weeks.map((w) => w.endingCash)).toEqual(
      forecast(synthetic, model, changes).weeks.map((w) => w.closing),
    );
    expectTies(s);
  });

  it("reports unclassified scenario cash", () => {
    expect(s.unclassified).toEqual([
      {
        source: "forecast",
        id: "change:Mystery fee",
        date: "2026-11-18",
        weekStart: "2026-11-16",
        amount: -1_000,
        text: "Mystery fee",
      },
    ]);
  });

  it("classifies shift_hire savings as payroll", () => {
    const hire: Change[] = [
      {
        kind: "shift_hire",
        label: "Engineer",
        monthlyCost: 30_000,
        fromDate: "2026-11-02",
        toDate: "2026-11-09",
      },
    ];
    const w0 = unwrap(projectedCashFlow(synthetic, model, hire)).weeks[0] as CfsWeek;
    // 7 November days at 30,000 / 30 = 1,000 per day = 7,000 saved
    expect(w0.lines.payroll).toBe(-200_000 + 7_000);
  });
});

describe("full statement and summary", () => {
  const s = unwrap(cashFlowStatement(synthetic, model, changes));

  it("joins actual and projected weeks in one tied shape", () => {
    expect(s.weeks.map((w) => w.kind)).toEqual([
      "actual",
      "actual",
      ...Array.from({ length: 13 }, () => "projected"),
    ]);
    expectTies(s);
    expect(s.unclassified.map((u) => u.id)).toEqual(["t9", "change:Mystery fee"]);
  });

  it("summarizes the low point, runway and 13-week totals", () => {
    const sum = cashFlowSummary(s);
    expect(sum.lowestProjected).toEqual({
      weekStart: "2026-11-02",
      endingCash: 4_740_000,
      usable: 4_640_000,
    });
    // CFO -260,000 +300,000 -1,000 -10,000 +340,000 -10,000 -10,000 = 349,000
    expect(sum.projectedTotals).toEqual({
      operating: 349_000,
      investing: -50_000,
      financing: 500_000,
      netChange: 799_000,
    });
    // Projected burn: 13 weeks net +799,000, so -799,000 / 13 rounds to -61,462: not burning
    expect(sum.runway).toEqual({
      weeklyBurn: -61_462,
      weeks: null,
      basis: s.weeks.filter((w) => w.kind === "projected").map((w) => w.weekStart),
    });
  });

  it("computes runway from complete weeks at current burn", () => {
    const burner: Snapshot = {
      ...synthetic,
      asOf: "2026-10-25", // Sunday: both weeks complete
      cashOnHand: 1_050_000,
      restrictedCash: 50_000,
      bankTxns: [
        { id: "b1", date: "2026-10-13", amount: -100_000, description: "BILL bill_sup" },
        { id: "b2", date: "2026-10-20", amount: -100_001, description: "BILL bill_sup" },
      ],
    };
    const st = unwrap(actualCashFlow(burner));
    // burn (100,000 + 100,001) / 2 = 100,000.5 rounds to 100,001; usable 1,000,000;
    // runway floor(1,000,000 * 2 / 200,001) = 9 weeks
    expect(cashFlowSummary(st).runway).toEqual({
      weeklyBurn: 100_001,
      weeks: 9,
      basis: ["2026-10-12", "2026-10-19"],
    });
    expect(cashFlowSummary(st, 1).runway.weeks).toBe(9); // floor(1,000,000 / 100,001)
  });
});

describe("sim kestrel snapshot (seed 42)", () => {
  const snapshot = SnapshotSchema.parse(kestrelSeed.snapshot);
  const s = unwrap(cashFlowStatement(snapshot, fixtures.model, []));

  it("ties out every week and matches history and forecast balances", () => {
    expectTies(s);
    const actual = s.weeks.filter((w) => w.kind === "actual");
    const projected = s.weeks.filter((w) => w.kind === "projected");
    expect(actual.at(-1)?.endingCash).toBe(snapshot.cashOnHand);
    expect(actual.map((w) => w.endingCash)).toEqual(
      history(snapshot, actual.length).map((h) => h.closing),
    );
    expect(projected.map((w) => w.endingCash)).toEqual(
      forecast(snapshot, fixtures.model, []).weeks.map((w) => w.closing),
    );
    expect(s.unclassified).toEqual([]);
    expect(s.futureDated).toEqual([]);
  });

  it("puts every sim bank transaction on an operating line", () => {
    for (const w of s.weeks) {
      expect(w.investing).toBe(0);
      expect(w.financing).toBe(0);
    }
    const total = (id: CfsLineId) =>
      s.weeks.filter((w) => w.kind === "actual").reduce((a, w) => a + w.lines[id], 0);
    const bank = snapshot.bankTxns.reduce((a, t) => a + t.amount, 0);
    const lines = CFS_LINES.reduce((a, l) => a + total(l.id), 0);
    expect(lines).toBe(bank);
    expect(total("rent_facilities")).toBe(-6 * 6_200_000);
    expect(total("payroll")).toBe(-13 * 60_000_000);
    expect(total("card_spend")).toBe(-6 * 3_800_000);
  });
});
