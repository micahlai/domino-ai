import type {
  BankTxn,
  CardTxn,
  CompanyModel,
  Invoice,
  LearnContext,
  LearningExample,
  Snapshot,
} from "@domino/contracts";
import { describe, expect, it } from "vitest";
import { forecast } from "./forecast";
import { engine } from "./index";
import { candidate, learn } from "./learn";

const base = (asOf: string, extra: Partial<Snapshot> = {}): Snapshot => ({
  companyId: "acme",
  asOf,
  cashOnHand: 1_000_000,
  restrictedCash: 0,
  customers: [{ id: "c1", name: "One Co", paymentTermsDays: 30 }],
  invoices: [],
  bankTxns: [],
  bills: [],
  cardTxns: [],
  payroll: [],
  deals: [],
  ...extra,
});
const paid = (id: string, due: string, paidOn: string, customerId = "c1"): Invoice => ({
  id,
  customerId,
  amount: 10_000,
  issued: "2026-06-01",
  due,
  paid: paidOn,
});
const card = (id: string, date: string, amount = 5_000, merchant = "Figma"): CardTxn => ({
  id,
  date,
  amount,
  merchant,
  category: "Software",
});
const txn = (id: string, date: string, amount: number): BankTxn => ({
  id,
  date,
  amount,
  description: id,
});
const empty: CompanyModel = { version: 0, customerDelayDays: {}, recurringSpend: [], rules: [] };

// Current snapshot: three paid c1 invoices, 8, 10 and 12 days late.
const current = base("2026-10-30", {
  invoices: [
    paid("i1", "2026-08-01", "2026-08-09"),
    paid("i2", "2026-08-15", "2026-08-25"),
    paid("i3", "2026-09-01", "2026-09-13"),
  ],
});

// Origin Friday 2026-09-04: inv_x is due Wed 09-09 (week 0). It really landed Sat 09-19 (week 1).
const origin = base("2026-09-04", {
  invoices: [
    { id: "inv_x", customerId: "c1", amount: 100_000, issued: "2026-08-10", due: "2026-09-09" },
  ],
});
const example = (
  snapshot: Snapshot,
  actualBank: BankTxn[],
  asOf = "2026-09-27",
): LearningExample => ({ snapshot, actualBank, asOf, bankWindowComplete: true });
const late = example(origin, [txn("b_x", "2026-09-19", 100_000)]);
const ctx = (...examples: LearningExample[]): LearnContext => ({ examples });

describe("learn: customer delay", () => {
  it("accepts a delay that improves replay on the same origin, once", () => {
    // Before: weeks [100k/1M, 0, 0] -> mean 1/30 = 3.333%. After (due + 10 = 09-19): all 0.
    const learned = learn(current, empty, [], ctx(late));
    expect(learned.version).toBe(1);
    expect(learned.customerDelayDays).toEqual({ c1: { mean: 10, p90: 12, samples: 3 } });
    expect(learned.rules).toHaveLength(1);
    const rule = learned.rules[0]!;
    expect(rule.errorBefore).toBeCloseTo(100 / 30, 10);
    expect(rule.errorAfter).toBe(0);
    expect(rule.evidence.map((e) => e.ref)).toEqual(["i1", "i2", "i3"]);
    expect(rule.text).toMatch(/retrospective fit/i);
    expect(rule.text).toMatch(/not a test on unseen weeks/i);

    // Same inputs again: nothing new, so the same object comes back and version stays 1.
    expect(learn(current, learned, [], ctx(late))).toBe(learned);
  });

  it("uses the nearest-rank p90 and keeps early payments negative", () => {
    // Delays -3, 1..9 (n = 10): sorted, rank ceil(0.9 * 10) = 9 -> 8. Mean 42/10.
    const days = [5, -3, 9, 1, 7, 2, 8, 3, 6, 4];
    const invoices = days.map((d, i) => {
      const due = "2026-09-10";
      const p = new Date(Date.UTC(2026, 8, 10 + d)).toISOString().slice(0, 10);
      return { ...paid(`p${i}`, due, p), issued: "2026-08-01" };
    });
    const next = candidate(base("2026-10-30", { invoices }), empty);
    expect(next?.model.customerDelayDays.c1).toEqual({ mean: 4.2, p90: 8, samples: 10 });
  });

  it("needs three observed paid invoices; future and malformed ones do not count", () => {
    const two = base("2026-10-30", { invoices: current.invoices.slice(0, 2) });
    expect(candidate(two, empty)).toBeNull();
    const future = base("2026-10-30", {
      invoices: [...current.invoices.slice(0, 2), paid("i_future", "2026-10-20", "2026-11-05")],
    });
    expect(candidate(future, empty)).toBeNull();
    const issuedAfterPaid = base("2026-10-30", {
      invoices: [
        ...current.invoices.slice(0, 2),
        { ...paid("i_bad", "2026-09-01", "2026-09-03"), issued: "2026-09-05" },
      ],
    });
    expect(candidate(issuedAfterPaid, empty)).toBeNull();
    expect(learn(two, empty, [], ctx(late))).toBe(empty);
  });

  it("keeps an unsupported existing estimate unchanged", () => {
    const model: CompanyModel = {
      ...empty,
      customerDelayDays: { c9: { mean: 3, p90: 5, samples: 2 } },
    };
    expect(candidate(current, model)?.model.customerDelayDays).toEqual({
      c9: { mean: 3, p90: 5, samples: 2 },
      c1: { mean: 10, p90: 12, samples: 3 },
    });
  });

  it("rejects duplicate invoice ids", () => {
    const dup = base("2026-10-30", {
      invoices: [...current.invoices, paid("i1", "2026-09-20", "2026-09-22")],
    });
    expect(() => learn(dup, empty, [], ctx(late))).toThrow(/duplicate invoice/);
  });
});

describe("learn: replay acceptance", () => {
  it("returns the model unchanged without context or evidence", () => {
    expect(learn(current, empty, [])).toBe(empty);
    expect(engine.learn(current, empty, [])).toBe(empty);
    expect(learn(current, empty, [], ctx())).toBe(empty);
    // Origin whose first week has not closed by its asOf: no completed evidence.
    expect(learn(current, empty, [], ctx(example(origin, [], "2026-09-12")))).toBe(empty);
  });

  it("returns the original model on a tie or a regression", () => {
    const quiet = example(base("2026-09-04"), []);
    expect(learn(current, empty, [], ctx(quiet))).toBe(empty);
    const onTime = example(origin, [txn("b_x", "2026-09-09", 100_000)]);
    expect(learn(current, empty, [], ctx(onTime))).toBe(empty);
  });

  it("ignores stored history forecasts, even ones that flatter the current model", () => {
    const flattering = forecast(base("2026-09-04", { cashOnHand: 1 }), empty, []);
    expect(learn(current, empty, [flattering], ctx(late))).toEqual(
      learn(current, empty, [], ctx(late)),
    );
  });

  it("weights every completed example-week equally", () => {
    // late: 3 weeks [1/10, 0, 0]; quiet origin 09-11 graded through 09-20: 1 week [0].
    // Per-week mean 1/40 = 2.5% (a per-example mean would give 1.667%).
    const quiet = example(base("2026-09-11"), [], "2026-09-20");
    const learned = learn(current, empty, [], ctx(late, quiet));
    expect(learned.rules[0]?.errorBefore).toBeCloseTo(2.5, 10);
  });

  it("rejects other companies, future cutoffs, contaminated and duplicate origins", () => {
    const other = example({ ...origin, companyId: "other" }, []);
    expect(() => learn(current, empty, [], ctx(other))).toThrow(/company/);
    const futureCutoff = example(base("2026-11-06"), [], "2026-11-29");
    expect(() => learn(current, empty, [], ctx(futureCutoff))).toThrow(
      /after the current snapshot/,
    );
    const futureWindow = example(origin, [], "2026-11-29");
    expect(() => learn(current, empty, [], ctx(futureWindow))).toThrow(
      /after the current snapshot/,
    );
    const contaminated = example(
      base("2026-09-04", { invoices: [{ ...origin.invoices[0]!, paid: "2026-09-19" }] }),
      [],
    );
    expect(() => learn(current, empty, [], ctx(contaminated))).toThrow();
    expect(() => learn(current, empty, [], ctx(late, late))).toThrow();
  });

  it("does not mutate its inputs", () => {
    const context = ctx(late);
    const before = JSON.stringify([current, empty, context]);
    learn(current, empty, [], context);
    expect(JSON.stringify([current, empty, context])).toBe(before);
  });
});

describe("learn: recurring card spend", () => {
  const weekly = [card("k1", "2026-10-09"), card("k2", "2026-10-16"), card("k3", "2026-10-23")];

  it("learns an exact repeat and accepts it when replay improves", () => {
    const now = base("2026-10-30", { cardTxns: weekly });
    expect(candidate(now, empty)?.model.recurringSpend).toEqual([
      { label: "Figma", amount: 5_000, everyDays: 7 },
    ]);
    // Origin 09-04: the forecast places charges at 09-11, 09-18, 09-25, matching the bank.
    const replay = example(base("2026-09-04"), [
      txn("b1", "2026-09-11", -5_000),
      txn("b2", "2026-09-18", -5_000),
      txn("b3", "2026-09-25", -5_000),
    ]);
    const learned = learn(now, empty, [], ctx(replay));
    expect(learned.version).toBe(1);
    expect(learned.rules[0]?.evidence.map((e) => e.ref)).toEqual(["k1", "k2", "k3"]);
    expect(learned.rules[0]?.text).toMatch(/after the snapshot date, not after the last charge/);
  });

  it("skips variable, duplicated, too-short, future or bill-overlapping patterns", () => {
    const cases: CardTxn[][] = [
      [...weekly.slice(0, 2), card("k3", "2026-10-23", 5_001)],
      [...weekly.slice(0, 2), card("k3", "2026-10-24")],
      [...weekly, card("k4", "2026-10-23")],
      weekly.slice(0, 2),
      [...weekly.slice(0, 2), card("k3", "2026-11-06")],
      weekly.map((c) => ({ ...c, merchant: " " })),
    ];
    for (const cardTxns of cases) {
      expect(candidate(base("2026-10-30", { cardTxns }), empty)).toBeNull();
    }
    const bill = {
      id: "bl1",
      vendor: "  FIGMA ",
      amount: 5_000,
      due: "2026-11-06",
      critical: false,
    };
    expect(candidate(base("2026-10-30", { cardTxns: weekly, bills: [bill] }), empty)).toBeNull();
    const dup = base("2026-10-30", { cardTxns: [...weekly, card("k1", "2026-10-30")] });
    expect(() => candidate(dup, empty)).toThrow(/duplicate card transaction/);
  });

  it("replaces a unique label, skips ambiguous labels, and appends new merchants in order", () => {
    const cardTxns = [
      ...weekly,
      ...["2026-10-02", "2026-10-16", "2026-10-30"].map((d, i) => card(`z${i}`, d, 900, "Zoom")),
      ...["2026-10-02", "2026-10-16", "2026-10-30"].map((d, i) => card(`a${i}`, d, 700, "Asana")),
      ...["2026-10-02", "2026-10-16", "2026-10-30"].map((d, i) => card(`s${i}`, d, 300, "Slack")),
    ];
    const model: CompanyModel = {
      ...empty,
      recurringSpend: [
        { label: "Rent", amount: 1, everyDays: 30 },
        { label: "Figma", amount: 4_000, everyDays: 30 },
        { label: "Slack", amount: 1, everyDays: 1 },
        { label: "Slack", amount: 2, everyDays: 2 },
      ],
    };
    expect(candidate(base("2026-10-30", { cardTxns }), model)?.model.recurringSpend).toEqual([
      { label: "Rent", amount: 1, everyDays: 30 },
      { label: "Figma", amount: 5_000, everyDays: 7 },
      { label: "Slack", amount: 1, everyDays: 1 },
      { label: "Slack", amount: 2, everyDays: 2 },
      { label: "Asana", amount: 700, everyDays: 14 },
      { label: "Zoom", amount: 900, everyDays: 14 },
    ]);
  });
});
