import {
  type HistoricalCase,
  type HistoricalPrediction,
  type HistoricalRun,
  HistoricalRunContextSchema,
} from "@domino/contracts";
import { historicalFixtures as fx } from "@domino/contracts/fixtures";
import { describe, expect, it } from "vitest";
import { type QuarterBridgeInput, compareRun, quarterAlternative, quarterBridge } from "./period";

/**
 * SYNTHETIC ONLY. Extends the contracts fixture (fictional 2031 company). Hand math, M = $1m:
 * origin 9/30 total 75M = usable 70M + restricted 5M. YTD Jan-Sep (3 quarters):
 * OCF -27M -> -9M/qtr, ICF -3M -> -1M/qtr. Financing -2M..0 (mid -1M), FX 0.
 * Quarter flow -11M (range -12M..-10M). Q4 = 92 days; cutoff 11/10 is day 41.
 */
const M = (m: number) => m * 100_000_000;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const q3 = fx.historicalCase.sources[0]!.publishedAt;

function synthCase(): HistoricalCase {
  const c = clone(fx.historicalCase);
  const ytd = { kind: "duration", start: "2031-01-01", end: "2031-09-30" } as const;
  const flow = { kind: "reported", currency: "USD", availableAt: q3, sourceId: "src_q3" } as const;
  c.facts.push(
    {
      ...flow,
      id: "f_ocf_ytd",
      metric: "operating_cash_flow",
      period: ytd,
      cents: M(-27),
      locator: "Cash flow statement, operating",
      reportedScale: "thousands",
    },
    {
      ...flow,
      id: "f_icf_ytd",
      metric: "investing_cash_flow",
      period: ytd,
      cents: M(-3),
      locator: "Cash flow statement, investing",
      reportedScale: "thousands",
    },
  );
  const common = {
    basisFactIds: [] as string[],
    dependsOn: [] as string[],
    effectiveFrom: "2031-10-01",
    feasibleAtCutoff: "yes" as const,
    selectedAfterReveal: false,
  };
  c.assumptions.push(
    {
      ...common,
      id: "a_fin",
      label: "synthetic",
      description: "Financing per quarter, unknown",
      value: { unit: "cents", low: M(-2), high: 0 },
    },
    {
      ...common,
      id: "a_fx",
      label: "synthetic",
      description: "FX per quarter, none expected",
      value: { unit: "cents", low: 0, high: 0 },
    },
  );
  return c;
}

const input = (c: HistoricalCase = synthCase()): QuarterBridgeInput => ({
  case: c,
  knowledgeCutoff: fx.cutoff,
  originBalanceDate: "2031-09-30",
  usableCashFactId: "f_cash_q3",
  totalCashFactId: "f_total_q3",
  operatingYtdFactId: "f_ocf_ytd",
  investingYtdFactId: "f_icf_ytd",
  financingAssumptionId: "a_fin",
  fxAssumptionId: "a_fx",
});

const byId = (ps: HistoricalPrediction[], id: string) => ps.find((p) => p.id === id)!;

function asRun(
  id: string,
  inputs: HistoricalRun["inputs"],
  predictions: HistoricalPrediction[],
  branch: HistoricalRun["branch"],
): HistoricalRun {
  return {
    ...fx.baselineRun,
    id,
    inputs,
    predictions,
    branch,
    riskRules: [
      { ...fx.baselineRun.riskRules[0]! },
      { ...fx.baselineRun.riskRules[0]!, id: "r_55", thresholdCents: M(55) },
    ],
  };
}

describe("quarterBridge baseline", () => {
  it("bridges origin cash through the target quarter by hand", () => {
    const b = quarterBridge(input());
    expect([b.targetDate, b.quarterDays, b.elapsedQuarters]).toEqual(["2031-12-31", 92, 3]);
    // 75M - 11M*41/92 = 7_009_782_608.696 cents; range uses -12M and -10M.
    expect(byId(b.nowcast, "nowcast_total")).toMatchObject({
      kind: "nowcast",
      period: { kind: "instant", date: "2031-11-10" },
      cents: 7_009_782_609,
      range: { low: 6_965_217_391, high: 7_054_347_826 },
    });
    expect(byId(b.nowcast, "nowcast_usable")).toMatchObject({
      metric: "cash_and_equivalents",
      cents: 6_509_782_609,
      range: { low: 6_465_217_391, high: 6_554_347_826 },
    });
    expect(byId(b.forecast, "target_total")).toMatchObject({
      cents: M(64),
      range: { low: M(63), high: M(65) },
    });
    // Restricted stays apart: usable is total minus the 5M origin restricted cash.
    expect(byId(b.forecast, "target_usable")).toMatchObject({
      cents: M(59),
      range: { low: M(58), high: M(60) },
    });
    expect(b.inputs).toEqual({
      sourceIds: ["src_q3"],
      factIds: ["f_cash_q3", "f_icf_ytd", "f_ocf_ytd", "f_restricted_q3", "f_total_q3"],
      assumptionIds: ["a_fin", "a_fx"],
    });
  });

  it("produces a run the frozen contract accepts", () => {
    const b = quarterBridge(input());
    const run = asRun("run_b", b.inputs, [...b.nowcast, ...b.forecast], { kind: "baseline" });
    expect(HistoricalRunContextSchema.safeParse({ case: synthCase(), run }).success).toBe(true);
  });

  it("never infers financing or FX as zero", () => {
    const c = synthCase();
    c.assumptions = c.assumptions.filter((a) => a.id !== "a_fin");
    expect(() => quarterBridge(input(c))).toThrow("assumption a_fin not found");
  });

  it("rejects evidence published after the cutoff", () => {
    const c = synthCase();
    c.facts.find((f) => f.id === "f_ocf_ytd")!.availableAt =
      fx.historicalCase.sources[1]!.publishedAt;
    (c.facts.find((f) => f.id === "f_ocf_ytd") as { sourceId: string }).sourceId = "src_fy";
    expect(() => quarterBridge(input(c))).toThrow("not available at the cutoff");
  });

  it("rejects hindsight in the baseline", () => {
    const c = synthCase();
    c.assumptions.find((a) => a.id === "a_fin")!.label = "hindsight";
    expect(() => quarterBridge(input(c))).toThrow("baseline cannot use hindsight");
  });

  it("derives a quarter only from comparable YTD on the same basis", () => {
    const shifted = synthCase();
    const ocf = shifted.facts.find((f) => f.id === "f_ocf_ytd")!;
    ocf.period = { kind: "duration", start: "2031-07-01", end: "2031-09-30" };
    expect(() => quarterBridge(input(shifted))).toThrow("not on the same basis");

    const partial = synthCase();
    for (const f of partial.facts)
      if (f.id.endsWith("_ytd"))
        f.period = { kind: "duration", start: "2031-02-01", end: "2031-09-30" };
    expect(() => quarterBridge(input(partial))).toThrow("8 months, not whole quarters");
  });

  it("rejects wrong scope, currency and unsafe money", () => {
    expect(() => quarterBridge({ ...input(), usableCashFactId: "f_total_q3" })).toThrow(
      "expected cash_and_equivalents",
    );
    const eur = synthCase();
    eur.currency = "EUR";
    expect(() => quarterBridge(input(eur))).toThrow();
    const huge = synthCase();
    for (const f of huge.facts)
      if (f.id === "f_cash_q3" || f.id === "f_total_q3") f.cents = Number.MAX_SAFE_INTEGER;
      else if (f.id === "f_restricted_q3") f.cents = 0;
      else if (f.id === "f_ocf_ytd") f.cents = M(300);
    expect(() => quarterBridge(input(huge))).toThrow("outside safe integer cents");
  });
});

describe("quarterAlternative", () => {
  // a_cut: +2M..+6M per quarter from 11/11 after 30 days (12/11..12/31 = 21 days), cost 1M..2M.
  it("pays the cost upfront, lags the benefit and reports the downside", () => {
    const alt = quarterAlternative(input(), "a_cut");
    expect([alt.benefitStart, alt.benefitDays]).toEqual(["2031-12-11", 21]);
    // point 4M*21/92 - 1.5M; low 2M*21/92 - 2M; high 6M*21/92 - 1M.
    expect(alt.effectCents).toEqual({ low: -154_347_826, point: -58_695_652, high: 36_956_522 });
    expect(byId(alt.forecast, "target_total")).toMatchObject({
      cents: 6_341_304_348,
      range: { low: 6_145_652_174, high: 6_536_956_522 },
    });
    expect(byId(alt.forecast, "target_usable").cents).toBe(5_841_304_348);
  });

  it("shares the baseline nowcast and passes the alternative contract", () => {
    const alt = quarterAlternative(input(), "a_cut");
    expect(alt.nowcast).toEqual(quarterBridge(input()).nowcast);
    const base = asRun("run_b", alt.baseline.inputs, [...alt.nowcast, ...alt.baseline.forecast], {
      kind: "baseline",
    });
    const run = asRun("run_a", alt.inputs, [...alt.nowcast, ...alt.forecast], {
      kind: "alternative",
      baselineRunId: "run_b",
      decisionAssumptionIds: ["a_cut"],
      postHoc: alt.postHoc,
    });
    const ok = HistoricalRunContextSchema.safeParse({ case: synthCase(), run, baseline: base });
    expect(ok.success).toBe(true);
    expect(alt.postHoc).toBe(false);
  });

  it("still pays the cost when the benefit lands after the target", () => {
    const c = synthCase();
    c.assumptions.find((a) => a.id === "a_cut")!.benefitLagDays = 60;
    expect(quarterAlternative(input(c), "a_cut").effectCents).toEqual({
      low: M(-2),
      point: M(-1.5),
      high: M(-1),
    });
  });

  it("cannot act on or before the cutoff, or without a cost", () => {
    const early = synthCase();
    early.assumptions.find((a) => a.id === "a_cut")!.effectiveFrom = "2031-11-10";
    expect(() => quarterAlternative(input(early), "a_cut")).toThrow("after the cutoff");
    const free = synthCase();
    free.assumptions.find((a) => a.id === "a_cut")!.oneTimeCost = undefined;
    expect(() => quarterAlternative(input(free), "a_cut")).toThrow("needs cost and lag");
  });

  it("labels hindsight decisions post-hoc", () => {
    const c = synthCase();
    c.assumptions.find((a) => a.id === "a_cut")!.selectedAfterReveal = true;
    expect(quarterAlternative(input(c), "a_cut").postHoc).toBe(true);
  });
});

describe("compareRun", () => {
  const b = quarterBridge(input());
  const run = asRun("run_b", b.inputs, [...b.nowcast, ...b.forecast], { kind: "baseline" });

  it("scores same-period observations as observed minus predicted without editing the run", () => {
    const before = clone(run);
    const out = compareRun(synthCase(), run, fx.revealedThrough);
    expect(run).toEqual(before);
    expect(out.find((x) => x.predictionId === "target_usable")).toEqual({
      id: "run_b_target_usable_cmp",
      runId: "run_b",
      predictionId: "target_usable",
      status: "scored",
      observationFactId: "f_cash_fy",
      predictedCents: M(59),
      observedCents: M(52),
      errorCents: M(-7),
      absErrorCents: M(7),
      ruleOutcomes: [
        { ruleId: "r_min", predictedBreach: false, observedBreach: false },
        { ruleId: "r_55", predictedBreach: false, observedBreach: true },
      ],
    });
    const reason = (id: string) =>
      (out.find((x) => x.predictionId === id) as { reason?: string }).reason;
    // Only usable cash was observed at 12/31: total-cash scope stays unscored.
    expect(reason("target_total")).toBe("incomparable_scope");
    expect(reason("nowcast_usable")).toBe("no_observation");
  });

  it("does not score before publication", () => {
    const out = compareRun(synthCase(), run, "2032-01-15T00:00:00-05:00");
    expect(out.find((x) => x.predictionId === "target_usable")).toMatchObject({
      status: "unscored",
      reason: "not_yet_published",
    });
  });
});
