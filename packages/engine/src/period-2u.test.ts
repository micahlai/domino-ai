import {
  type HistoricalCase,
  HistoricalCaseSchema,
  type HistoricalPrediction,
  type HistoricalRun,
  HistoricalRunContextSchema,
} from "@domino/contracts";
import { describe, expect, it } from "vitest";
import caseJson from "../../../data/historical/2u/case.json";
import protocol from "../../../data/historical/2u/protocol.json";
import {
  QUARTER_BRIDGE_METHOD,
  type QuarterBridgeInput,
  compareRun,
  quarterAlternative,
  quarterBridge,
} from "./period";

/**
 * REAL CASE: 2U, Inc. cash-only, cutoff 2023-11-10. Expected cents below are the protocol's
 * hand math, written as literals so the engine is checked against them, not against itself.
 * Nothing here feeds S8 numbers into the bridge; S8 is used only by compareRun after reveal.
 */
const c: HistoricalCase = HistoricalCaseSchema.parse(caseJson);
const cutoff = protocol.knowledgeCutoff;
const revealedThrough = "2024-02-13T00:00:00-05:00";

const input: QuarterBridgeInput = {
  case: c,
  knowledgeCutoff: cutoff,
  originBalanceDate: protocol.originBalanceDate,
  usableCashFactId: "F01",
  totalCashFactId: "F03",
  operatingYtdFactId: "F05",
  investingYtdFactId: "F06",
  financingAssumptionId: "AS-FIN0",
  fxAssumptionId: "AS-FX0",
};

/** The bridge applies "restricted held flat" by method but does not take it as an input id. */
const METHOD_ASSUMPTIONS = ["AS-RESTRICTED"];
const DECISION = "A1";

/** Case order, so the manifest is stable whatever order the caller appends in. */
const inCaseOrder = (ids: string[]) =>
  c.assumptions.map((a) => a.id).filter((id) => ids.includes(id));

const pick = (ps: HistoricalPrediction[], metric: string, date: string) =>
  ps.find((p) => p.metric === metric && p.period.kind === "instant" && p.period.date === date)!;

/** H2c assembly, minus persistence: engine output + method assumptions + protocol labels. */
function assemble() {
  const bridge = quarterBridge(input);
  const alt = quarterAlternative(input, DECISION);
  const common = {
    caseId: c.id,
    createdAt: "2026-10-24T12:00:00Z", // H2c sets save time, id and hash
    knowledgeCutoff: cutoff,
    originBalanceDate: protocol.originBalanceDate,
    inputHash: "a".repeat(64),
    method: { ...QUARTER_BRIDGE_METHOD },
    riskRules: [],
  };
  const baseline: HistoricalRun = {
    ...common,
    id: "run-2u-baseline",
    inputs: {
      ...bridge.inputs,
      assumptionIds: inCaseOrder([...bridge.inputs.assumptionIds, ...METHOD_ASSUMPTIONS]),
    },
    predictions: [...bridge.nowcast, ...bridge.forecast],
    branch: { kind: "baseline" },
  };
  const response: HistoricalRun = {
    ...common,
    id: "run-2u-response",
    inputs: {
      ...alt.inputs,
      assumptionIds: inCaseOrder([...alt.inputs.assumptionIds, ...METHOD_ASSUMPTIONS]),
    },
    predictions: [...alt.nowcast, ...alt.forecast],
    branch: {
      kind: "alternative",
      baselineRunId: "run-2u-baseline",
      decisionAssumptionIds: [DECISION],
      // Authors knew the outcome: the protocol label wins over the engine's evidence-only flag.
      postHoc: alt.postHoc || protocol.response.postHoc,
    },
  };
  return { bridge, alt, baseline, response };
}

describe("2U real case: quarter bridge", () => {
  const { bridge, alt } = assemble();
  const at = (date: string) => ({
    total: pick([...bridge.nowcast, ...bridge.forecast], "cash_including_restricted", date),
    usable: pick([...bridge.nowcast, ...bridge.forecast], "cash_and_equivalents", date),
  });

  it("nowcast at the cutoff is 45,815,000.00 total / 33,105,000.00 usable", () => {
    expect(bridge.elapsedQuarters).toBe(3);
    expect(bridge.quarterDays).toBe(92);
    expect(bridge.targetDate).toBe("2023-12-31");
    expect(at("2023-11-10").total.cents).toBe(4_581_500_000);
    expect(at("2023-11-10").usable.cents).toBe(3_310_500_000);
  });

  it("baseline target at 2023-12-31 is 35,819,000.00 total / 23,109,000.00 usable, no range", () => {
    expect(at("2023-12-31").total.cents).toBe(3_581_900_000);
    expect(at("2023-12-31").usable.cents).toBe(2_310_900_000);
    // AS-FIN0 and AS-FX0 are zero-width, so the baseline is a point.
    expect(at("2023-12-31").total.range).toBeUndefined();
  });

  it("response is cost only: point 31,556,500.00, range 28,669,000.00..34,444,000.00", () => {
    expect(alt.benefitStart).toBe("2024-02-11");
    expect(alt.benefitDays).toBe(0);
    expect(alt.effectCents).toEqual({ low: -715_000_000, point: -426_250_000, high: -137_500_000 });
    const total = pick(alt.forecast, "cash_including_restricted", "2023-12-31");
    const usable = pick(alt.forecast, "cash_and_equivalents", "2023-12-31");
    expect(total.cents).toBe(3_155_650_000);
    expect(total.range).toEqual({ low: 2_866_900_000, high: 3_444_400_000 });
    expect(usable.cents).toBe(1_884_650_000);
    expect(usable.range).toEqual({ low: 1_595_900_000, high: 2_173_400_000 });
    expect(alt.nowcast).toBe(alt.baseline.nowcast);
    expect(alt.nowcast).toEqual(bridge.nowcast);
  });

  it("matches every protocol prediction by metric and date (IDs differ by design)", () => {
    const pairs = [
      [protocol.nowcast, bridge.nowcast],
      [protocol.baselineForecast, bridge.forecast],
      [protocol.responseForecast, alt.forecast],
    ] as const;
    for (const [want, got] of pairs)
      for (const w of want) {
        const g = pick([...got], w.metric, w.period.date);
        expect(
          { cents: g.cents, range: g.range, kind: g.kind, currency: g.currency },
          w.id,
        ).toEqual({
          cents: w.cents,
          range: "range" in w ? w.range : undefined,
          kind: w.kind,
          currency: w.currency,
        });
      }
    // Engine ids nowcast_*/target_* vs protocol P-*; engine method vs protocol label.
    expect(bridge.nowcast.map((p) => p.id)).toEqual(["nowcast_total", "nowcast_usable"]);
    expect(bridge.method).toEqual({ id: "quarterly_cash_bridge", version: "0.1.0" });
    expect(protocol.method).toEqual({ id: "ytd-thirds-uniform-daily", version: "1.0.0" });
  });

  it("output is identical when every post-cutoff fact is deleted from the case", () => {
    const blind: HistoricalCase = {
      ...c,
      sources: c.sources.filter((s) => s.id !== "S8"),
      facts: c.facts.filter((f) => Date.parse(f.availableAt) <= Date.parse(cutoff)),
    };
    expect(quarterBridge({ ...input, case: blind })).toEqual(bridge);
    expect(quarterAlternative({ ...input, case: blind }, DECISION)).toEqual(alt);
  });
});

describe("2U real case: run manifests", () => {
  const { baseline, response, alt } = assemble();

  it("manifests read S7 only, list the protocol inputs and skip A1-DOWNSIDE", () => {
    for (const run of [baseline, response]) {
      expect(run.inputs.sourceIds).toEqual(["S7"]);
      expect(run.inputs.factIds).toEqual(protocol.inputs.factIds);
      expect(run.inputs.assumptionIds).not.toContain("A1-DOWNSIDE");
    }
    expect(baseline.inputs.assumptionIds).toEqual(protocol.inputs.baselineAssumptionIds);
    expect(response.inputs.assumptionIds).toEqual(protocol.inputs.responseAssumptionIds);
  });

  it("raw cash scopes are one issuer, consolidated, USD, origin-dated", () => {
    const used = baseline.inputs.factIds.map((id) => c.facts.find((f) => f.id === id)!);
    for (const f of [...used, ...["H01", "H03"].map((id) => c.facts.find((x) => x.id === id)!)]) {
      expect(f.kind).toBe("reported");
      if (f.kind === "reported") expect(f.locator).toContain("Condensed Consolidated");
      expect(f.currency).toBe("USD");
    }
    const balances = used.filter((f) => f.period.kind === "instant");
    expect(balances.map((f) => f.id)).toEqual(["F01", "F02", "F03"]);
    expect(
      balances.every((f) => f.period.kind === "instant" && f.period.date === "2023-09-30"),
    ).toBe(true);
  });

  it("both runs pass the save-time contract with one shared nowcast; postHoc is true", () => {
    expect(alt.postHoc).toBe(false); // evidence labels alone do not mark it
    expect(response.branch.kind === "alternative" && response.branch.postHoc).toBe(true);
    const ok = (ctx: unknown) => {
      const r = HistoricalRunContextSchema.safeParse(ctx);
      return r.success ? [] : r.error.issues;
    };
    expect(ok({ case: c, run: baseline })).toEqual([]);
    expect(ok({ case: c, run: response, baseline })).toEqual([]);
  });
});

describe("2U real case: comparison after reveal", () => {
  const { baseline, response } = assemble();
  const scored = (run: HistoricalRun) =>
    Object.fromEntries(
      compareRun(c, run, revealedThrough).map((x) => [
        x.predictionId,
        x.status === "scored" ? [x.observationFactId, x.observedCents, x.errorCents] : x.reason,
      ]),
    );

  it("baseline misses by +37,580,000.00 on both scopes; nowcast has no observation", () => {
    expect(scored(baseline)).toEqual({
      nowcast_total: "no_observation",
      nowcast_usable: "no_observation",
      target_total: ["H03", 7_339_900_000, 3_758_000_000],
      target_usable: ["H01", 6_068_900_000, 3_758_000_000],
    });
  });

  it("response scores against the same observations; runs are not edited", () => {
    const before = JSON.stringify(response);
    expect(scored(response)).toEqual({
      nowcast_total: "no_observation",
      nowcast_usable: "no_observation",
      target_total: ["H03", 7_339_900_000, 4_184_250_000],
      target_usable: ["H01", 6_068_900_000, 4_184_250_000],
    });
    expect(JSON.stringify(response)).toBe(before);
  });

  it("before S8 publishes, nothing scores", () => {
    const early = compareRun(c, baseline, "2024-02-12T16:00:00-05:00");
    expect(early.filter((x) => x.status === "scored")).toEqual([]);
  });
});
