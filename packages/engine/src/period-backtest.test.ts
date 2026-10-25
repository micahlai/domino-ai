import { readFileSync } from "node:fs";
import { type HistoricalCase, HistoricalCaseSchema, type HistoricalRun } from "@domino/contracts";
import { describe, expect, it } from "vitest";
import backtest from "../../../data/historical/2u/backtest.json";
import caseJson from "../../../data/historical/2u/case.json";
import protocol from "../../../data/historical/2u/protocol.json";
import {
  QUARTER_BRIDGE_METHOD,
  type QuarterBridgeInput,
  compareRun,
  quarterBridge,
} from "./period";
import {
  type BacktestFact,
  type BacktestResponse,
  creditDrawOverlap,
  quarterCounterfactual,
  quarterFlowMiss,
  quarterSuggestions,
} from "./period-backtest";

/**
 * REAL CASE: 2U, cutoff 2023-11-10. Expected cents are hand math written as literals:
 * baseline usable 23,109,000.00 and total 35,819,000.00 at 2023-12-31 (protocol), revolver
 * $40M commitment - $20M drawn = $20M, A1 point cost (1,375,000 + 7,150,000) / 2 = 4,262,500,
 * actual usable 60,689,000.00 (H01) and total 73,399,000.00 (H03).
 */
const full: HistoricalCase = HistoricalCaseSchema.parse(caseJson);
const cutoff = protocol.knowledgeCutoff;
const known: HistoricalCase = {
  ...full,
  sources: full.sources.filter((s) => Date.parse(s.publishedAt) <= Date.parse(cutoff)),
  facts: full.facts.filter((f) => Date.parse(f.availableAt) <= Date.parse(cutoff)),
  assumptions: full.assumptions.filter((a) => a.label !== "hindsight"),
};
const input: QuarterBridgeInput = {
  case: known,
  knowledgeCutoff: cutoff,
  originBalanceDate: protocol.originBalanceDate,
  usableCashFactId: "F01",
  totalCashFactId: "F03",
  operatingYtdFactId: "F05",
  investingYtdFactId: "F06",
  financingAssumptionId: "AS-FIN0",
  fxAssumptionId: "AS-FX0",
};
const bridge = quarterBridge(input);
const baseline: HistoricalRun = {
  id: "run-2u-baseline",
  caseId: full.id,
  createdAt: "2026-10-25T12:00:00Z",
  knowledgeCutoff: cutoff,
  originBalanceDate: protocol.originBalanceDate,
  inputs: { ...bridge.inputs, assumptionIds: ["AS-FIN0", "AS-FX0", "AS-RESTRICTED"] },
  inputHash: "a".repeat(64),
  method: { ...QUARTER_BRIDGE_METHOD },
  riskRules: [],
  predictions: [...bridge.nowcast, ...bridge.forecast],
  branch: { kind: "baseline" },
};
const facts = backtest.cutoffFacts as BacktestFact[];
const responses = backtest.responses as BacktestResponse[];
const suggestions = () => quarterSuggestions({ bridge: input, baseline, facts, responses });
const usable = (ps: { metric: string; cents: number; range?: unknown }[]) =>
  ps.find((p) => p.metric === "cash_and_equivalents");

describe("2U backtest: suggestions at the cutoff", () => {
  it("ranks the draw, keeping the plan, then the cost cut by quarter-end cash", () => {
    const s = suggestions();
    expect(s.map((x) => [x.id, x.rank])).toEqual([
      ["R-DRAW", 1],
      ["R-KEEP", 2],
      ["R-CUT", 3],
      ["R-REFI", null],
    ]);
    const [draw, keep, cut, refi] = s;
    expect(draw!.effectCents).toEqual({
      low: 2_000_000_000,
      point: 2_000_000_000,
      high: 2_000_000_000,
    });
    expect(usable(draw!.forecast)).toMatchObject({ cents: 4_310_900_000 });
    expect(keep!.effectCents).toEqual({ low: 0, point: 0, high: 0 });
    expect(usable(keep!.forecast)).toMatchObject({ cents: 2_310_900_000 });
    // Same numbers as the protocol's response forecast, through quarterAlternative.
    expect(cut!.effectCents).toEqual({
      low: -715_000_000,
      point: -426_250_000,
      high: -137_500_000,
    });
    expect(usable(cut!.forecast)).toEqual(
      expect.objectContaining({
        cents: 1_884_650_000,
        range: { low: 1_595_900_000, high: 2_173_400_000 },
      }),
    );
    expect(cut!.benefit).toEqual({ start: "2024-02-11", daysInQuarter: 0 });
    expect(refi!.effectCents).toBeNull();
    expect(refi!.forecast).toEqual([]);
  });

  it("uses no fact published after the cutoff", () => {
    const json = JSON.stringify(suggestions());
    expect(json).not.toMatch(/\bS8\b|\bH0\d|\bD0\d|2024-02-12|6068900000|7339900000/);
    const late: BacktestFact = { ...facts[1]!, availableAt: "2024-02-12T16:01:00-05:00" };
    expect(() =>
      quarterSuggestions({ bridge: input, baseline, facts: [facts[0]!, late], responses }),
    ).toThrow(/after the cutoff|not available at the cutoff/);
  });

  it("rejects a draw dated at or before the cutoff, or a baseline that is not the bridge", () => {
    const early = responses.map((r) =>
      r.kind === "credit_draw" ? { ...r, effectiveFrom: "2023-11-10" } : r,
    );
    expect(() => quarterSuggestions({ bridge: input, baseline, facts, responses: early })).toThrow(
      /after the cutoff/,
    );
    const edited = {
      ...baseline,
      predictions: baseline.predictions.map((p) => ({ ...p, cents: p.cents + 1 })),
    };
    expect(() => quarterSuggestions({ bridge: input, baseline: edited, facts, responses })).toThrow(
      /differs from the frozen bridge/,
    );
  });
});

describe("2U backtest: simulated counterfactual after the reveal", () => {
  const comparisons = compareRun(full, baseline, "2024-02-12T16:01:00-05:00");
  const byId = (id: string) => suggestions().find((s) => s.id === id)!;

  it("cost cut: actual minus the in-quarter cost, by hand", () => {
    const cf = quarterCounterfactual({
      run: baseline,
      comparisons,
      suggestion: byId("R-CUT"),
      overlapCents: 0,
    });
    const u = cf.points.find((p) => p.metric === "cash_and_equivalents")!;
    expect(u).toEqual({
      metric: "cash_and_equivalents",
      date: "2023-12-31",
      observationFactId: "H01",
      actualCents: 6_068_900_000,
      forecastCents: 2_310_900_000,
      counterfactualCents: 6_068_900_000 - 426_250_000, // 5,642,650,000
      counterfactualRange: { low: 5_353_900_000, high: 5_931_400_000 },
    });
    const t = cf.points.find((p) => p.metric === "cash_including_restricted")!;
    expect(t.counterfactualCents).toBe(7_339_900_000 - 426_250_000);
  });

  it("draw: 2U's revolver went from $20M to $40M, so nothing is added twice", () => {
    const [after] = backtest.revealFacts as BacktestFact[];
    const overlap = creditDrawOverlap(facts[1]!, after!, 2_000_000_000);
    expect(overlap).toBe(2_000_000_000);
    const cf = quarterCounterfactual({
      run: baseline,
      comparisons,
      suggestion: byId("R-DRAW"),
      overlapCents: overlap,
    });
    expect(cf.appliedEffectCents).toEqual({ low: 0, point: 0, high: 0 });
    expect(cf.points.every((p) => p.counterfactualCents === p.actualCents)).toBe(true);
    // Without the evidence, the full draw would be added: 60,689,000 + 20,000,000.
    const naive = quarterCounterfactual({
      run: baseline,
      comparisons,
      suggestion: byId("R-DRAW"),
      overlapCents: 0,
    });
    expect(naive.points.find((p) => p.metric === "cash_and_equivalents")?.counterfactualCents).toBe(
      8_068_900_000,
    );
  });

  it("refuses a suggestion the engine did not model", () => {
    expect(() =>
      quarterCounterfactual({
        run: baseline,
        comparisons,
        suggestion: byId("R-REFI"),
        overlapCents: 0,
      }),
    ).toThrow(/not modeled/);
  });

  it("explains the miss line by line from the revealed quarter flows", () => {
    const before = quarterFlowMiss(input, known);
    expect(before.every((l) => l.actualCents === null)).toBe(true);
    expect(quarterFlowMiss(input, full)).toEqual([
      {
        metric: "operating_cash_flow",
        forecastCents: -584_000_000,
        actualCents: 1_408_900_000,
        actualFactId: "D01",
        errorCents: 1_992_900_000,
      },
      {
        metric: "investing_cash_flow",
        forecastCents: -1_219_200_000,
        actualCents: -1_325_500_000,
        actualFactId: "D02",
        errorCents: -106_300_000,
      },
      {
        metric: "financing_cash_flow",
        forecastCents: 0,
        actualCents: 1_849_500_000,
        actualFactId: "D03",
        errorCents: 1_849_500_000,
      },
      {
        metric: "fx_effect_on_cash",
        forecastCents: 0,
        actualCents: 21_900_000,
        actualFactId: "D04",
        errorCents: 21_900_000,
      },
    ]);
  });
});

describe("2U backtest data: quotes match the saved source bytes", () => {
  const raw = (p: string) =>
    readFileSync(new URL(`../../../data/historical/2u/raw/${p}`, import.meta.url), "utf8");

  it("the Dec 31 revolver figure is in the S8 release, the refinancing talks in S7", () => {
    expect(raw("held-out/prnewswire-2u-q4-fy2023.html")).toContain(
      'including borrowings of <span class="xn-money">$40</span>.0&nbsp;million under the company\'s revolving credit facility',
    );
    expect(raw("pre-cutoff/prnewswire-2u-q3-2023.html")).toContain(backtest.cutoffNotes[0]!.quote);
    expect(backtest.revealFacts[0]!.availableAt).toBe(
      full.sources.find((x) => x.id === "S8")!.publishedAt,
    );
  });
});
