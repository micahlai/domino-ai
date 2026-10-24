import {
  type Branch,
  BranchSchema,
  type CompanyModel,
  type Constraint,
  type FixCandidate,
  type Snapshot,
} from "@domino/contracts";
import { fixtures } from "@domino/contracts/fixtures";
import { describe, expect, it } from "vitest";
import { forecast } from "./forecast";
import { rankFixes, scoreFix } from "./score-fix";

// asOf Friday 2026-10-30; week 0 starts 2026-11-02.
const tiny: Snapshot = {
  companyId: "tiny",
  asOf: "2026-10-30",
  cashOnHand: 1_000_000,
  restrictedCash: 0,
  customers: [{ id: "c1", name: "One Co", paymentTermsDays: 30 }],
  invoices: [
    { id: "i1", customerId: "c1", amount: 200_000, issued: "2026-10-01", due: "2026-12-01" },
  ],
  bankTxns: [],
  bills: [
    { id: "b1", vendor: "Agency", amount: 700_000, due: "2026-11-10", critical: false },
    { id: "b_crit", vendor: "Cloud", amount: 1, due: "2027-01-20", critical: true },
  ],
  cardTxns: [],
  payroll: [],
  deals: [],
};
const noModel: CompanyModel = { version: 0, customerDelayDays: {}, recurringSpend: [], rules: [] };
const ev = { source: "document" as const, ref: "doc#1", note: "rule" };
const minCash: Constraint = {
  id: "con_min",
  label: "Lender's minimum",
  kind: "min_cash",
  limit: 500_000,
  evidence: ev,
};
const payB1: Constraint = {
  id: "con_pay_b1",
  label: "Pay agency",
  kind: "pay_by_date",
  limit: 0,
  billId: "b1",
  evidence: ev,
};

// Fixture cash path: illustrative only, never matched by computed results.
const illustrative = fixtures.branches[0]?.forecast ?? forecast(tiny, noModel, []);
const branch = (over: Partial<Branch> & Pick<Branch, "id" | "parentId">): Branch => ({
  kind: "event",
  label: over.id,
  changes: [],
  forecast: illustrative,
  dominoes: [],
  status: "draft",
  ...over,
});
const fix = (
  id: string,
  changes: FixCandidate["changes"],
  risk: FixCandidate["risk"] = "low",
): FixCandidate => ({
  id,
  label: id,
  changes,
  costNote: "cost",
  risk,
  evidence: [ev],
  targetRiskIds: [],
});
const addCash = (amount: number, date = "2026-11-03") => ({
  kind: "add_cash" as const,
  date,
  amount,
  label: "cash",
});
const removeCash = (amount: number, date = "2026-11-03") => ({
  kind: "remove_cash" as const,
  date,
  amount,
  label: "spend",
});

describe("scoreFix", () => {
  it("scores a root parent: forecast with parent + fix changes, relative output", () => {
    const parent = branch({
      id: "ev",
      parentId: null,
      changes: [removeCash(100_000)],
      riskIds: ["r1"],
    });
    const f = fix("fix_cash", [addCash(250_000)]);
    const b = scoreFix(parent, f, tiny, noModel, [minCash]);
    expect(BranchSchema.parse(b)).toEqual(b);
    expect(b).toMatchObject({ kind: "fix", parentId: "ev", status: "proposed", riskIds: ["r1"] });
    expect(b.changes).toEqual(f.changes);
    // 1,000,000 - 100,000 (once) + 250,000 - 700,000 = 450,000 low in week 1
    expect(b.forecast.lowPoint.usable).toBe(450_000);
    expect(b.forecast).toEqual(forecast(tiny, noModel, [removeCash(100_000), addCash(250_000)]));
    expect(b.dominoes.some((d) => d.constraintId === "con_min")).toBe(true);
    expect(b.probability).toBeUndefined();
  });

  it("requires explicit ancestry for a non-root parent, and accepts []", () => {
    const parent = branch({ id: "ev", parentId: "base", riskIds: [] });
    const f = fix("fix_cash", [addCash(1)]);
    expect(() => scoreFix(parent, f, tiny, noModel, [])).toThrow(/ancestor/);
    expect(
      scoreFix(parent, f, tiny, noModel, [], { ancestorChanges: [] }).forecast.lowPoint.usable,
    ).toBe(300_001);
  });

  it("applies ancestors, then parent, then fix, each once and in order", () => {
    const parent = branch({
      id: "ev",
      parentId: "base",
      changes: [{ kind: "delay_invoice", invoiceId: "i1", days: 60 }],
    });
    // The fix's early-pay date overrides the parent's delay because it applies later.
    const f = fix("fix_early", [
      { kind: "discount_early_pay", invoiceId: "i1", percent: 0, payOn: "2026-11-05" },
    ]);
    const b = scoreFix(parent, f, tiny, noModel, [], { ancestorChanges: [removeCash(50_000)] });
    // 1,000,000 - 50,000 + 200,000 (11-05) - 700,000 (11-10) - 1 (01-20) = 449,999.
    // Applying the delay after the early pay would push the receipt to 2027-01-04 instead.
    expect(b.forecast.lowPoint.usable).toBe(449_999);
    expect(b.changes).toEqual(f.changes);
    expect("riskIds" in b).toBe(false); // unknown parent context stays unknown
  });

  it("keeps a non-improving branch representable and preserves critical-bill rejection", () => {
    const parent = branch({ id: "base", parentId: null, kind: "base", riskIds: [] });
    const worse = scoreFix(parent, fix("fix_worse", [removeCash(1)]), tiny, noModel, []);
    expect(worse.status).toBe("proposed");
    expect(worse.forecast.lowPoint.usable).toBe(299_999);
    expect(() =>
      scoreFix(
        parent,
        fix("fix_crit", [{ kind: "delay_bill", billId: "b_crit", days: 5 }]),
        tiny,
        noModel,
        [],
      ),
    ).toThrow(/critical/);
  });

  it("does not mutate inputs", () => {
    const parent = branch({ id: "ev", parentId: null, changes: [removeCash(5)] });
    const f = fix("fix_cash", [addCash(5)]);
    const copies = structuredClone({ parent, f, tiny });
    scoreFix(parent, f, tiny, noModel, [minCash]);
    expect({ parent, f, tiny }).toEqual(copies);
  });
});

describe("rankFixes", () => {
  const parent = branch({ id: "base", parentId: null, kind: "base", riskIds: [] });
  const constraints = [minCash, payB1];
  const score = (f: FixCandidate) => ({
    fix: f,
    branch: scoreFix(parent, f, tiny, noModel, constraints),
  });

  it("keeps positive gain, prefers clearing every rule, then gain, then lower risk, then ID", () => {
    // Base low 300,000 breaks con_min.
    const clearsMedium = fix("fix_a", [addCash(250_000)], "medium"); // low 550,000, all clear
    const clearsLow = fix("fix_z", [addCash(250_000)], "low"); // same gain, lower risk
    const clearsLowB = fix("fix_y", [addCash(250_000)], "low"); // ties fix_z, lower ID
    // Delaying b1 past the horizon raises the low point to 1,000,000 but misses b1's deadline.
    const bigGain = fix("fix_delay", [{ kind: "delay_bill", billId: "b1", days: 90 }]);
    const worse = fix("fix_worse", [removeCash(1)]);
    const flat = fix("fix_flat", [addCash(1, "2027-03-01")]); // after the horizon: no gain
    const ranked = rankFixes(
      parent,
      [worse, bigGain, clearsMedium, clearsLow, flat, clearsLowB].map(score),
      tiny,
      noModel,
      constraints,
    );
    expect(ranked.map((r) => [r.fix.id, r.gain, r.clearsAllRules])).toEqual([
      ["fix_y", 250_000, true],
      ["fix_z", 250_000, true],
      ["fix_a", 250_000, true],
      ["fix_delay", 700_000, false],
    ]);
  });

  it("rejects branches scored against another parent or a stale forecast", () => {
    const other = { ...score(fix("fix_a", [addCash(1)])) };
    expect(() =>
      rankFixes(branch({ id: "x", parentId: null }), [other], tiny, noModel, constraints),
    ).toThrow(/parent/);
    const stale = { ...other, branch: { ...other.branch, forecast: illustrative } };
    expect(() => rankFixes(parent, [stale], tiny, noModel, constraints)).toThrow(/forecast/);
  });
});
