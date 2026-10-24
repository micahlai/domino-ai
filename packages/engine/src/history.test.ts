import {
  type CompanyModel,
  HistoryWeekSchema,
  PastEventSchema,
  type Snapshot,
} from "@domino/contracts";
import { fixtures } from "@domino/contracts/fixtures";
import { describe, expect, it } from "vitest";
import { history, pastEvents } from "./history";

const tiny: Snapshot = {
  companyId: "tiny",
  asOf: "2026-10-30", // Friday; its Monday bucket is 2026-10-26
  cashOnHand: 1_000_000,
  restrictedCash: 100_000,
  customers: [{ id: "c1", name: "One Co", paymentTermsDays: 30 }],
  invoices: [],
  bankTxns: [
    { id: "t_future", date: "2026-11-02", amount: 999, description: "after asOf" },
    { id: "t1", date: "2026-10-27", amount: 100, description: "in the partial week" },
    { id: "t2", date: "2026-10-20", amount: -50, description: "week of 10-19" },
    { id: "t3", date: "2026-10-18", amount: 30, description: "Sunday closing week 10-12" },
    { id: "t4", date: "2026-10-05", amount: 7, description: "before the range" },
  ],
  bills: [],
  cardTxns: [],
  payroll: [],
  deals: [],
};
const noModel: CompanyModel = { version: 0, customerDelayDays: {}, recurringSpend: [], rules: [] };

describe("history", () => {
  it("rebuilds Monday buckets backward from asOf cash, ending with a partial week", () => {
    const h = history(tiny, 3);
    // 10-26 bucket closes at asOf (partial) = cashOnHand; 10-19 closes 10-25 = 1,000,000 - 100;
    // 10-12 closes 10-18 = 999,900 + 50 (undo the 10-20 outflow). The future txn is ignored.
    expect(h).toEqual([
      { weekStart: "2026-10-12", closing: 999_950, usable: 899_950 },
      { weekStart: "2026-10-19", closing: 999_900, usable: 899_900 },
      { weekStart: "2026-10-26", closing: 1_000_000, usable: 900_000 },
    ]);
    for (const w of h) expect(HistoryWeekSchema.parse(w)).toEqual(w);
  });

  it("returns exactly the requested number of weeks and rejects bad counts", () => {
    expect(history(tiny, 1)).toHaveLength(1);
    expect(history(tiny, 26)).toHaveLength(26);
    expect(history(tiny, 0)).toEqual([]);
    expect(() => history(tiny, -1)).toThrow(/weeks/);
    expect(() => history(tiny, 1.5)).toThrow(/weeks/);
  });

  it("does not mutate the snapshot", () => {
    const copy = structuredClone(tiny);
    history(tiny, 4);
    expect(tiny).toEqual(copy);
  });

  it("runs on Kestrel", () => {
    const h = history(fixtures.snapshot, 26);
    expect(h.at(-1)).toEqual({
      weekStart: "2026-10-26",
      closing: fixtures.snapshot.cashOnHand,
      usable: fixtures.snapshot.cashOnHand - fixtures.snapshot.restrictedCash,
    });
  });
});

describe("pastEvents", () => {
  const s: Snapshot = {
    ...tiny,
    invoices: [
      {
        id: "late",
        customerId: "c1",
        amount: 5_000,
        issued: "2026-08-01",
        due: "2026-09-01",
        paid: "2026-09-16",
      },
      {
        id: "on14",
        customerId: "c1",
        amount: 5_000,
        issued: "2026-08-01",
        due: "2026-09-01",
        paid: "2026-09-15",
      },
      {
        id: "future",
        customerId: "c1",
        amount: 5_000,
        issued: "2026-08-01",
        due: "2026-09-01",
        paid: "2026-11-20",
      },
    ],
    deals: [
      {
        id: "big",
        customerId: "c1",
        amount: 5_000_001,
        stage: "won",
        expectedClose: "2026-09-01",
        signed: true,
        invoiceId: null,
      },
      {
        id: "exact",
        customerId: "c1",
        amount: 5_000_000,
        stage: "won",
        expectedClose: "2026-09-01",
        signed: true,
        invoiceId: null,
      },
      {
        id: "unsigned",
        customerId: "c1",
        amount: 9_000_000,
        stage: "won",
        expectedClose: "2026-09-01",
        signed: false,
        invoiceId: null,
      },
      {
        id: "later",
        customerId: "c1",
        amount: 9_000_000,
        stage: "won",
        expectedClose: "2026-11-05",
        signed: true,
        invoiceId: null,
      },
    ],
    payroll: [
      { id: "p1", date: "2026-09-04", amount: 500_000 },
      { id: "p2", date: "2026-09-18", amount: 560_000 },
      { id: "p3", date: "2026-10-02", amount: 540_000 },
      { id: "p4", date: "2026-11-06", amount: 900_000 },
    ],
  };

  it("reports only observable, dated evidence", () => {
    const events = pastEvents(s, noModel);
    expect(events.map((e) => [e.id, e.kind, e.date, e.amount])).toEqual([
      ["past_deal_big", "big_deal", "2026-09-01", 5_000_001],
      ["past_late_late", "late_payment", "2026-09-16", 5_000],
      ["past_payroll_p2", "other", "2026-09-18", -60_000],
    ]);
    for (const e of events) expect(PastEventSchema.parse(e)).toEqual(e);
  });

  it("labels a payroll increase as a payroll change, not a hire", () => {
    const step = pastEvents(s, noModel).find((e) => e.id === "past_payroll_p2");
    expect(step?.label).toMatch(/payroll/i);
    expect(step?.label).not.toMatch(/hire|joined/i);
    expect(pastEvents(s, noModel).some((e) => e.kind === "hire" || e.kind === "churn")).toBe(false);
  });

  it("marks a card spend spike from the latest complete four weeks", () => {
    const spiky: Snapshot = {
      ...tiny,
      cardTxns: [
        { id: "e1", date: "2026-09-01", amount: 1_000, merchant: "M", category: "Software" },
        { id: "r1", date: "2026-10-20", amount: 1_500, merchant: "M", category: "Software" },
      ],
    };
    const [spike] = pastEvents(spiky, noModel);
    expect(spike).toMatchObject({ kind: "spend_spike", date: "2026-10-25", amount: -500 });
    expect(spike?.evidence.map((e) => e.ref)).toEqual(["e1", "r1"]);
  });
});
