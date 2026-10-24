import {
  type CompanyModel,
  type Constraint,
  type FixCandidate,
  ResilienceReportSchema,
  type RiskEvent,
  type Snapshot,
} from "@domino/contracts";
import { fixtures } from "@domino/contracts/fixtures";
import { describe, expect, it } from "vitest";
import { dominoes } from "./dominoes";
import { cashSchedule, forecast } from "./forecast";
import { scanRisks } from "./risks";
import { delayFails, lossFails, smallestFailing, stressTest } from "./stress-test";

// asOf Friday 2026-10-30: weeks 2026-11-02 .. 2027-01-25; last forecast Sunday 2027-01-31.
const tiny: Snapshot = {
  companyId: "tiny",
  asOf: "2026-10-30",
  cashOnHand: 1_000_000,
  restrictedCash: 0,
  customers: [{ id: "c1", name: "One Co", paymentTermsDays: 30 }],
  invoices: [
    { id: "i1", customerId: "c1", amount: 300_000, issued: "2026-10-01", due: "2026-11-20" },
    { id: "i2", customerId: "c1", amount: 100_000, issued: "2026-10-01", due: "2026-11-25" },
  ],
  bankTxns: [],
  bills: [{ id: "b1", vendor: "Agency", amount: 700_000, due: "2026-12-10", critical: false }],
  cardTxns: [],
  payroll: [],
  deals: [],
};
const noModel: CompanyModel = { version: 0, customerDelayDays: {}, recurringSpend: [], rules: [] };
const ev = { source: "document" as const, ref: "doc#1", note: "rule" };
const minCash = (limit: number): Constraint => ({
  id: "con_min",
  label: "Lender's minimum",
  kind: "min_cash",
  limit,
  evidence: ev,
});
const risk = (id: string, probability: number, changes: RiskEvent["changes"]): RiskEvent => ({
  id,
  label: `Risk ${id}`,
  probability,
  impactLowPoint: 0, // deliberately wrong: stressTest recomputes impact through forecast
  changes,
  evidence: [ev],
});
const fix = (id: string, targetRiskIds: string[] | undefined, amount = 1): FixCandidate => ({
  id,
  label: id,
  changes: [{ kind: "add_cash", date: "2026-11-04", amount, label: id }],
  costNote: "cost",
  risk: "low",
  evidence: [ev],
  ...(targetRiskIds ? { targetRiskIds } : {}),
});

// Base low 700,000. rA: i1 leaves the horizon (impact 300,000); rB: i2 lost (100,000);
// rG: a supported positive scenario, +200,000 (impact -200,000).
const rA = risk("rA", 0.5, [{ kind: "delay_invoice", invoiceId: "i1", days: 90 }]);
const rB = risk("rB", 0.2, [{ kind: "lose_invoice", invoiceId: "i2" }]);
const rG = risk("rG", 0.4, [
  { kind: "add_cash", date: "2026-11-03", amount: 200_000, label: "Signed upsell" },
]);

describe("stressTest universes", () => {
  it("builds base, singles, top-four pairs and all-adverse, deduplicated, with hand-computed scores", () => {
    const report = stressTest(tiny, noModel, [minCash(500_000)], [rG, rB, rA], []);
    expect(ResilienceReportSchema.parse(report)).toEqual(report);
    expect(report.universes.map((u) => [u.id, u.survives, u.probability])).toEqual([
      ["u_[]", true, 1],
      ['u_["rA"]', false, 0.5], // 1,000,000 + 100,000 - 700,000 = 400,000 < 500,000
      ['u_["rB"]', true, 0.2],
      ['u_["rG"]', true, 0.4],
      ['u_["rA","rB"]', false, 0.1], // 300,000; also the all-adverse set, kept once
      ['u_["rA","rG"]', true, 0.2], // exactly 500,000 is not below
      ['u_["rB","rG"]', true, 0.4 * 0.2],
    ]);
    const rA_ = report.universes[1];
    expect(rA_).toMatchObject({
      breaksAt: "2026-12-07",
      brokenConstraintId: "con_min",
      fixIds: [],
    });
    expect(report.survivedCount).toBe(5);
    expect(report.survivalRate).toBeCloseTo((1 + 0.2 + 0.4 + 0.2 + 0.08) / 2.48, 12);
    expect(report.appliedFixIds).toEqual([]);
  });

  it("handles zero, one and five risks", () => {
    const c = [minCash(0)];
    expect(stressTest(tiny, noModel, c, [], []).universes.map((u) => u.id)).toEqual(["u_[]"]);
    expect(stressTest(tiny, noModel, c, [rA], []).universes.map((u) => u.id)).toEqual([
      "u_[]",
      'u_["rA"]',
    ]);
    const five = [1, 2, 3, 4, 5].map((n) =>
      risk(`r${n}`, 0.5, [
        { kind: "remove_cash", date: "2026-11-03", amount: n * 1000, label: `r${n}` },
      ]),
    );
    const report = stressTest(tiny, noModel, c, five, []);
    // base + 5 singles + C(4,2)=6 pairs of the top four (r5..r2) + all five adverse = 13
    expect(report.universes).toHaveLength(13);
    expect(report.universes.map((u) => u.id)).toContain('u_["r2","r5"]');
    expect(report.universes.map((u) => u.id)).not.toContain('u_["r1","r5"]');
    expect(report.universes.at(-1)?.id).toBe('u_["r1","r2","r3","r4","r5"]');
    expect(report.survivedCount).toBe(13);
    expect(report.survivalRate).toBe(1);
  });

  it("applies global and targeted fixes in caller order, once, with stable universe IDs", () => {
    const fixes = [fix("fix_global", []), fix("fix_a", ["rA"], 150_000)];
    const without = stressTest(tiny, noModel, [minCash(500_000)], [rA, rB], []);
    const report = stressTest(tiny, noModel, [minCash(500_000)], [rA, rB], fixes);
    expect(report.universes.map((u) => u.id)).toEqual(without.universes.map((u) => u.id));
    expect(report.universes.map((u) => [u.id, u.fixIds, u.survives])).toEqual([
      ["u_[]", ["fix_global"], true],
      ['u_["rA"]', ["fix_global", "fix_a"], true], // 400,001 + 150,000
      ['u_["rB"]', ["fix_global"], true],
      ['u_["rA","rB"]', ["fix_global", "fix_a"], false], // 300,001 + 150,000 = 450,001
    ]);
    expect(report.universes[1]?.forecast.lowPoint.usable).toBe(550_001);
    expect(report.appliedFixIds).toEqual(["fix_global", "fix_a"]);
    const reversed = stressTest(tiny, noModel, [minCash(0)], [rA, rB], [...fixes].reverse());
    expect(reversed.universes[1]?.fixIds).toEqual(["fix_a", "fix_global"]);
  });

  it("gives every canonical risk set a distinct, stable ID, even for IDs like base and a+b (E4-r1)", () => {
    // Review E4-2340ff8 #2: [] vs [base] and [a+b] vs [a, b] used to collide.
    const odd = ["a", "b", "a+b", "base"].map((id, n) =>
      risk(id, 0.5, [
        { kind: "remove_cash", date: "2026-11-03", amount: (n + 1) * 1000, label: id },
      ]),
    );
    const c = [minCash(0)];
    const report = stressTest(tiny, noModel, c, odd, []);
    const ids = report.universes.map((u) => u.id);
    // base + 4 singles + 6 pairs + the all-adverse set
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12);
    expect(ids).toEqual(expect.arrayContaining(["u_[]", 'u_["base"]', 'u_["a+b"]', 'u_["a","b"]']));
    const byId = (r: typeof report) => r.universes.map((u) => [u.id, u.riskIds]);
    const reordered = stressTest(tiny, noModel, c, [...odd].reverse(), []);
    const withFix = stressTest(tiny, noModel, c, odd, [fix("f", ["a"])]);
    expect(byId(reordered)).toEqual(byId(report));
    expect(byId(withFix)).toEqual(byId(report));
  });

  it("rejects missing or unknown targets and duplicate IDs", () => {
    const c = [minCash(0)];
    expect(() => stressTest(tiny, noModel, c, [rA], [fix("f", undefined)])).toThrow(
      /targetRiskIds/,
    );
    expect(() => stressTest(tiny, noModel, c, [rA], [fix("f", ["nope"])])).toThrow(/unknown risk/);
    expect(() => stressTest(tiny, noModel, c, [rA, rA], [])).toThrow(/duplicate risk/);
    expect(() => stressTest(tiny, noModel, c, [rA], [fix("f", []), fix("f", [])])).toThrow(
      /duplicate fix/,
    );
  });

  it("fails the same midweek deadline rule as dominoes while weekly closes look healthy", () => {
    const s: Snapshot = {
      ...tiny,
      cashOnHand: 400,
      invoices: [
        { id: "i1", customerId: "c1", amount: 300, issued: "2026-10-01", due: "2026-11-06" },
      ],
      bills: [{ id: "b1", vendor: "Agency", amount: 600, due: "2026-11-04", critical: false }],
    };
    const c: Constraint[] = [
      minCash(0),
      {
        id: "con_pay",
        label: "Pay agency",
        kind: "pay_by_date",
        limit: 0,
        billId: "b1",
        evidence: ev,
      },
    ];
    const f = forecast(s, noModel, []);
    expect(f.weeks[0]?.usable).toBe(100); // week close is fine
    const ds = dominoes(f, c, s, { model: noModel, changes: [] });
    expect(ds.map((d) => d.constraintId).filter(Boolean)).toEqual(["con_pay"]);
    const [base] = stressTest(s, noModel, c, [], []).universes;
    expect(base).toMatchObject({
      survives: false,
      brokenConstraintId: "con_pay",
      breaksAt: "2026-11-02",
    });
  });

  it("does not let runway decide survival", () => {
    const runway: Constraint = {
      id: "con_run",
      label: "Runway",
      kind: "min_runway_months",
      limit: 100,
      evidence: ev,
    };
    const [base] = stressTest(tiny, noModel, [runway], [], []).universes;
    expect(base?.survives).toBe(true);
  });
});

describe("stressTest breaking points", () => {
  // 1,000,000 cash, a 600,000 bill on 2027-01-20 and a 500,000 minimum: i1 (300,000) must land by
  // Sunday 2027-01-24. Mean delay 3 days puts it on 11-23; 63 extra days moves it to Monday 01-25.
  const delayCo: Snapshot = {
    ...tiny,
    invoices: [
      { id: "i1", customerId: "c1", amount: 300_000, issued: "2026-10-01", due: "2026-11-20" },
      { id: "i2", customerId: "c1", amount: 50_000, issued: "2026-10-01", due: "2026-12-01" },
    ],
    bills: [{ id: "b1", vendor: "Agency", amount: 600_000, due: "2027-01-20", critical: false }],
  };
  const m: CompanyModel = {
    ...noModel,
    customerDelayDays: { c1: { mean: 3.2, p90: 9, samples: 4 } },
  };
  const lateI1 = (p: number) =>
    risk("r_i1", p, [{ kind: "delay_invoice", invoiceId: "i1", days: 90 }]);
  const lateI2 = (p: number) =>
    risk("r_i2", p, [{ kind: "delay_invoice", invoiceId: "i2", days: 90 }]);

  it("finds the smallest total lateness that breaks, verified against brute force", () => {
    const c = [minCash(500_000)];
    const report = stressTest(delayCo, m, c, [lateI2(0.1), lateI1(0.5)], []);
    expect(report.breakingPoints).toEqual([
      { label: "One Co paying 66 or more days late", threshold: 66, unit: "days_late" },
    ]);
    const fails = Array.from({ length: 71 }, (_, d) => delayFails(delayCo, m, c, "i1", d));
    expect(fails.indexOf(true)).toBe(63);
    expect(fails.slice(63).every(Boolean)).toBe(true);
  });

  it("uses the highest-ranked eligible risk only", () => {
    // The i2 delay now ranks first (1 × 50,000 > 0.1 × 300,000) and never breaks the rule.
    const report = stressTest(delayCo, m, [minCash(500_000)], [lateI2(1), lateI1(0.1)], []);
    expect(report.breakingPoints).toEqual([]);
  });

  it("treats the last forecast Sunday as inside and the next Monday as outside", () => {
    const s: Snapshot = { ...delayCo, bills: [{ ...delayCo.bills[0]!, due: "2027-01-31" }] };
    const c = [minCash(500_000)];
    // Receipt 11-23 + 69 = Sunday 01-31 still counts; + 70 = Monday 02-01 is outside.
    expect(delayFails(s, m, c, "i1", 69)).toBe(false);
    expect(delayFails(s, m, c, "i1", 70)).toBe(true);
    expect(stressTest(s, m, c, [lateI1(0.5)], []).breakingPoints[0]?.threshold).toBe(73);
  });

  it("omits the point when no bounded shock breaks or the base already fails", () => {
    expect(stressTest(delayCo, m, [minCash(0)], [lateI1(0.5)], []).breakingPoints).toEqual([]);
    expect(stressTest(delayCo, m, [minCash(2_000_000)], [lateI1(0.5)], []).breakingPoints).toEqual(
      [],
    );
  });

  it("finds the smallest renewal loss, allocated by expected date then invoice ID", () => {
    // 400 cash; a 600 bill payable on 11-20 (limit 0). The 300 renewal arrives the same day, so the
    // bill is funded unless more than 100 is lost. The later 50 renewal is cut only after the first.
    const s: Snapshot = {
      ...tiny,
      cashOnHand: 400,
      invoices: [
        { id: "inv_z", customerId: "c1", amount: 300, issued: "2026-10-01", due: "2026-11-20" },
        { id: "inv_a", customerId: "c1", amount: 50, issued: "2026-10-01", due: "2026-11-25" },
      ],
      bills: [{ id: "b1", vendor: "Agency", amount: 600, due: "2026-11-20", critical: false }],
      deals: [
        {
          id: "d1",
          customerId: "c1",
          amount: 300,
          stage: "won",
          expectedClose: "2026-10-01",
          signed: true,
          invoiceId: "inv_z",
          kind: "renewal",
        },
        {
          id: "d2",
          customerId: "c1",
          amount: 50,
          stage: "won",
          expectedClose: "2026-10-01",
          signed: true,
          invoiceId: "inv_a",
          kind: "renewal",
        },
      ],
    };
    const c: Constraint[] = [
      {
        id: "con_pay",
        label: "Pay agency",
        kind: "pay_by_date",
        limit: 0,
        billId: "b1",
        evidence: ev,
      },
    ];
    const report = stressTest(s, noModel, c, [], []);
    expect(report.breakingPoints).toEqual([
      { label: "Losing $1.01 or more of renewal receipts", threshold: 101, unit: "cents_lost" },
    ]);
    const base = cashSchedule(s, noModel, []);
    const brute = Array.from({ length: 351 }, (_, l) => lossFails(s, c, base, l));
    expect(brute.indexOf(true)).toBe(101);
    expect(brute.slice(101).every(Boolean)).toBe(true);
  });

  it("binary search matches brute force on a monotone predicate", () => {
    for (let t = 0; t <= 9; t++) expect(smallestFailing(9, (x) => x >= t)).toBe(t);
    expect(smallestFailing(9, () => false)).toBeUndefined();
  });
});

describe("stressTest on Kestrel", () => {
  const { snapshot, model, constraints, fixes } = fixtures;
  const risks = [...fixtures.risks, ...fixtures.moreRisks];

  it("runs through real forecast and stays well under the regression ceiling", () => {
    const scanned = scanRisks(snapshot, model, constraints);
    stressTest(snapshot, model, constraints, scanned, []); // warm-up
    stressTest(snapshot, model, constraints, risks, fixes);
    const runs = 20;
    const t0 = performance.now();
    let report = stressTest(snapshot, model, constraints, risks, fixes);
    for (let i = 1; i < runs; i++) report = stressTest(snapshot, model, constraints, risks, fixes);
    const ms = (performance.now() - t0) / runs;
    const scannedReport = stressTest(snapshot, model, constraints, scanned, []);
    console.log(
      `Kestrel stressTest warm mean ${ms.toFixed(2)} ms over ${runs} runs (${report.universes.length} universes, node ${process.version}, ${process.platform}/${process.arch}); scanned risks: ${scanned.map((r) => r.id).join(", ")}`,
    );
    expect(ms).toBeLessThan(1000);
    expect(ResilienceReportSchema.parse(report)).toEqual(report);
    expect(ResilienceReportSchema.parse(scannedReport)).toEqual(scannedReport);
    expect(report.appliedFixIds).toEqual(["fix_early_pay", "fix_delay_hire"]);
    const ids = report.universes.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
    // The positive scenario is a universe but never part of the all-adverse set.
    expect(ids).toContain('u_["risk_big_deal_early"]');
    expect(report.universes.at(-1)?.riskIds).not.toContain("risk_big_deal_early");
  });
});
