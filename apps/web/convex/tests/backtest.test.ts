/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob(["../**/*.ts", "../_generated/*.js", "!./**"]);
const caseId = "twou-2023-cash-v1";
const setup = () => convexTest(schema, modules);
const usable = (ps: { metric: string; cents: number }[]) =>
  ps.find((p) => p.metric === "cash_and_equivalents")?.cents;

async function saved(t: ReturnType<typeof setup>) {
  const { runId } = await t.mutation(api.historical.saveBaseline, {
    requestId: "backtest-base-1",
    caseId,
  });
  return runId as string;
}

describe("2U backtest (Nov 10, 2023 cutoff)", () => {
  it("suggests from cutoff facts only and hides every later figure before the reveal", async () => {
    const t = setup();
    const runId = await saved(t);
    const s = await t.query(api.backtest.getSuggestions, { caseId, runId });
    expect(s.mode).toBe("Backtest: Nov 2023");
    expect(s.suggestions.map((x) => [x.id, x.rank, usable(x.forecast)])).toEqual([
      ["R-DRAW", 1, 4_310_900_000],
      ["R-KEEP", 2, 2_310_900_000],
      ["R-CUT", 3, 1_884_650_000],
      ["R-REFI", null, undefined],
    ]);
    expect(s.rationale.provider).toBeNull();
    const json = JSON.stringify(s);
    expect(json).not.toMatch(
      /\bS8\b|\bS5\b|\bH0\d|\bH13\b|\bD0\d|2024-02-12|2024-07|Chapter 11|6068900000|7339900000/,
    );
    expect(s.sources.map((x) => x.id)).toEqual(["S1", "S7"]);
    await expect(t.query(api.backtest.getOutcome, { caseId, runId })).rejects.toThrow(
      /Reveal what actually happened first/,
    );
  });

  it("after the reveal, builds the counterfactual from the stored comparisons", async () => {
    const t = setup();
    const runId = await saved(t);
    await t.mutation(api.historical.reveal, { requestId: "backtest-reveal-1", runId });
    const o = await t.query(api.backtest.getOutcome, { caseId, runId });
    expect(o.label).toBe("Simulated counterfactual: illustrative, not a fact");
    const cf = (id: string) =>
      o.counterfactuals
        .find((c) => c.suggestionId === id)
        ?.points.find((p) => p.metric === "cash_and_equivalents");
    // Actual 60,689,000.00 (H01). Draw: 2U itself went from $20M to $40M drawn, so +0.
    expect(cf("R-DRAW")).toMatchObject({
      actualCents: 6_068_900_000,
      counterfactualCents: 6_068_900_000,
    });
    expect(o.counterfactuals.find((c) => c.suggestionId === "R-DRAW")?.overlapFactIds).toEqual([
      "F19",
      "H09-REV",
    ]);
    // Cost cut: 60,689,000.00 - 4,262,500.00 = 56,426,500.00.
    expect(cf("R-CUT")).toMatchObject({ counterfactualCents: 5_642_650_000 });
    expect(o.counterfactuals.some((c) => c.suggestionId === "R-REFI")).toBe(false);
    expect(o.flows.map((f) => f.errorCents)).toEqual([
      1_992_900_000, -106_300_000, 1_849_500_000, 21_900_000,
    ]);
    expect(o.epilogue.verification).toMatch(/^Unverified/);
    expect(o.sources.map((x) => x.id)).toEqual(["S8"]);
  });

  it("rejects an unknown case or a non-baseline run", async () => {
    const t = setup();
    const runId = await saved(t);
    await expect(t.query(api.backtest.getSuggestions, { caseId: "nope", runId })).rejects.toThrow(
      /Unknown case/,
    );
    const alt = await t.mutation(api.historical.computeAlternative, {
      requestId: "backtest-alt-1",
      baselineRunId: runId,
    });
    await expect(
      t.query(api.backtest.getSuggestions, { caseId, runId: alt.runId as string }),
    ).rejects.toThrow(/starts from a baseline/);
  });
});
