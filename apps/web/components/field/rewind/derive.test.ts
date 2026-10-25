import {
  type HistoricalCase,
  HistoricalCaseSchema,
  type HistoricalComparison,
  type HistoricalRun,
  HistoricalRunSchema,
} from "@domino/contracts";
import { describe, expect, it } from "vitest";
import caseJson from "../../../../../data/historical/2u/case.json";
import protocol from "../../../../../data/historical/2u/protocol.json";
import { atCutoff, deriveReveal, deriveRewind } from "./derive";

// The audited 2U case, as the server holds it, and a baseline run carrying the audited
// protocol predictions (the same ones the engine's quarter bridge produces).
const full: HistoricalCase = HistoricalCaseSchema.parse(caseJson);
const CUTOFF = protocol.knowledgeCutoff;
const REVEALED_THROUGH = "2024-02-12T16:01:00-05:00";

const run: HistoricalRun = HistoricalRunSchema.parse({
  id: "baseline-test-2u",
  caseId: full.id,
  createdAt: "2026-10-24T12:00:00Z",
  knowledgeCutoff: CUTOFF,
  originBalanceDate: protocol.originBalanceDate,
  inputs: {
    sourceIds: protocol.inputs.sourceIds,
    factIds: protocol.inputs.factIds,
    assumptionIds: protocol.inputs.baselineAssumptionIds,
  },
  inputHash: "0".repeat(64),
  method: protocol.method,
  predictions: [...protocol.nowcast, ...protocol.baselineForecast],
  riskRules: [],
  branch: { kind: "baseline" },
});

function comparisons(): HistoricalComparison[] {
  return run.predictions.map((p) => {
    const base = { id: `cmp-${p.id}`, runId: run.id, predictionId: p.id };
    if (p.kind === "nowcast")
      return { ...base, status: "unscored" as const, reason: "no_observation" as const };
    const f = full.facts.find(
      (x) => x.id === (p.metric === "cash_and_equivalents" ? "H01" : "H03"),
    );
    if (!f) throw new Error("missing observation");
    return {
      ...base,
      status: "scored" as const,
      observationFactId: f.id,
      predictedCents: p.cents,
      observedCents: f.cents,
      errorCents: f.cents - p.cents,
      absErrorCents: Math.abs(f.cents - p.cents),
      ruleOutcomes: [],
    };
  });
}

/** Every fact that becomes public only after the cutoff. */
const later = full.facts.filter((f) => Date.parse(f.availableAt) > Date.parse(CUTOFF));
/** Later amounts that differ from every cutoff amount (restricted cash H02 repeats F02). */
const cutoffCents = new Set(atCutoff(full, CUTOFF).facts.map((f) => f.cents));
const laterCents = later.map((f) => f.cents).filter((c) => !cutoffCents.has(c));
const laterSources = full.sources.filter((s) => Date.parse(s.publishedAt) > Date.parse(CUTOFF));

describe("2U rewind: pre-reveal derivations", () => {
  const view = deriveRewind(atCutoff(full, CUTOFF), run);

  it("reads the last reported balance and the frozen forecast", () => {
    expect(view.cutoff).toBe("2023-11-10");
    expect(view.lastBalanceDate).toBe("2023-09-30");
    expect(view.usable).toMatchObject({ factId: "F01", cents: 4_114_100_000 });
    expect(view.total).toMatchObject({ factId: "F03", cents: 5_385_100_000 });
    expect(view.restricted?.cents).toBe(1_271_000_000);
    expect(view.forecast.usable).toMatchObject({ date: "2023-12-31", cents: 2_310_900_000 });
    expect(view.forecast.total?.cents).toBe(3_581_900_000);
    expect(view.forecastChange.cents).toBe(2_310_900_000 - 4_114_100_000);
  });

  it("averages the nine-month flows per quarter, exact in cents", () => {
    expect(view.perQuarter).toEqual({
      operating: protocol.projection.operatingPerQuarterCents,
      investing: protocol.projection.investingPerQuarterCents,
      beforeFinancing: protocol.projection.quarterChangeCents,
      quarters: 3,
    });
  });

  it("derives the start balance from the cash flow identity", () => {
    // F03 minus the nine-month operating, investing, financing and exchange-rate flows.
    expect(view.trendStart).toMatchObject({
      date: "2022-12-31",
      kind: "derived",
      cents: 5_385_100_000 + 1_752_000_000 + 3_657_600_000 + 7_351_300_000 + 111_800_000,
    });
  });

  it("flags with deterministic rules, each citing its cutoff facts", () => {
    const status = Object.fromEntries(view.flags.map((f) => [f.id, f.status]));
    expect(status).toEqual({
      "operating-outflow": "flagged",
      "before-financing": "flagged",
      "cash-decline": "flagged",
      "financing-outflow": "flagged",
      runway: "flagged",
      "debt-terms": "not_checked",
    });
    expect(view.flaggedCount).toBe(5);
    expect(view.rating).toBe("warning");
    expect(view.runway).toEqual({ quarters: 2.3, zeroOn: "2024-04-26" });
    for (const f of view.flags.filter((x) => x.status === "flagged")) {
      expect(f.evidence.length).toBeGreaterThan(0);
      for (const e of f.evidence) {
        expect(protocol.inputs.factIds).toContain(e.factId);
        expect(e.publishedOn <= "2023-11-10").toBe(true);
        expect(e.source?.id).toBe("S7");
      }
    }
    expect(deriveRewind(atCutoff(full, CUTOFF), run)).toEqual(view);
  });

  it("invents no lender's minimum", () => {
    expect(view.limit).toBeNull();
    expect(view.flags.find((f) => f.id === "debt-terms")?.title).toMatch(/not checked/);
  });

  it("never shows later facts, even when handed the full case", () => {
    const leaky = deriveRewind(full, run);
    expect(leaky).toEqual(view);
    const json = JSON.stringify(view);
    for (const f of later) expect(json).not.toContain(`"${f.id}"`);
    for (const c of laterCents) expect(json).not.toContain(String(c));
    for (const s of laterSources) {
      expect(json).not.toContain(s.title);
      expect(json).not.toContain(s.url);
    }
    expect(json).not.toMatch(/chapter 11|bankrupt/i);
  });

  it("refuses a run from another case", () => {
    expect(() => deriveRewind({ ...full, id: "other-case" }, run)).toThrow(/another case/);
  });
});

describe("2U rewind: reveal", () => {
  const revealed = deriveReveal(atCutoff(full, REVEALED_THROUGH), run, {
    runId: run.id,
    revealedThrough: REVEALED_THROUGH,
    comparisons: comparisons(),
  });

  it("compares the frozen forecast with what was reported next", () => {
    expect(revealed.revealedThrough).toBe("2024-02-12");
    const usable = revealed.rows.find((r) => r.metric === "cash_and_equivalents");
    expect(usable).toMatchObject({
      forecast: 2_310_900_000,
      actual: 6_068_900_000,
      difference: 6_068_900_000 - 2_310_900_000,
    });
    expect(usable?.fact.factId).toBe("H01");
    // Cash rose instead of falling: the forecast was wrong in direction, and the page says so.
    expect(revealed.allAbove).toBe(true);
    expect(revealed.newSources.map((s) => s.id)).toEqual(["S8"]);
    expect(revealed.quarterFlows.map((f) => f.factId).sort()).toEqual(["D01", "D02", "D03", "D04"]);
  });

  it("refuses a reveal for another run", () => {
    expect(() =>
      deriveReveal(full, run, {
        runId: "other",
        revealedThrough: REVEALED_THROUGH,
        comparisons: [],
      }),
    ).toThrow(/another run/);
  });
});
