/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { BaselineDataSchema } from "../historical/live";
import {
  BacktestScreen,
  COUNTERFACTUAL_LABEL,
  type OutcomeData,
  type ScreenState,
  type SuggestionsData,
} from "./BacktestView";

// Real backend payloads from an in-memory Convex, rendered by the pure screen.
const modules = import.meta.glob([
  "../../convex/**/*.ts",
  "../../convex/_generated/*.js",
  "!../../convex/tests/**",
]);
const caseId = "twou-2023-cash-v1";

async function payloads(reveal: boolean) {
  const t = convexTest(schema, modules);
  const { runId } = await t.mutation(api.historical.saveBaseline, {
    requestId: "backtest-ui-1",
    caseId,
  });
  const run = BaselineDataSchema.parse(await t.query(api.historical.getRun, { caseId, runId }));
  const suggestions: SuggestionsData = await t.query(api.backtest.getSuggestions, {
    caseId,
    runId,
  });
  let outcome: OutcomeData | null = null;
  if (reveal) {
    await t.mutation(api.historical.reveal, { requestId: "backtest-ui-r1", runId });
    outcome = await t.query(api.backtest.getOutcome, { caseId, runId });
  }
  return { run, suggestions, outcome };
}

const render = (
  s: Omit<Extract<ScreenState, { kind: "ready" }>, "kind" | "act" | "onReveal" | "onRestart">,
) =>
  renderToStaticMarkup(
    createElement(BacktestScreen, {
      state: { kind: "ready", act: {}, onReveal: () => {}, onRestart: () => {}, ...s },
    }),
  );

describe("2U backtest screen", () => {
  it("before the reveal: steps 1 and 2 only, no later figure or event", async () => {
    const html = render(await payloads(false));
    for (const label of [
      "Step 1 · What we knew on Nov 10, 2023",
      "Step 2 · What Domino would have suggested then",
      "Step 3 · What actually happened",
      "Reveal what actually happened",
      "Step 4 · If they had followed our suggestion",
      "Top suggestion",
      "AI rationale: skipped",
      "Quarterly granularity",
      "2U · Backtest from Nov 2023 (real history)",
    ])
      expect(html).toContain(label);
    expect(html).toContain("$23.1M"); // frozen Dec 31 forecast
    expect(html).toContain("$43.1M"); // with the suggested draw
    expect(html).not.toMatch(/\$60\.7M|60,689,000|Chapter 11|H01|S8|Feb 12, 2024/);
    expect(html).not.toContain(COUNTERFACTUAL_LABEL);
    expect(html).not.toContain('data-line="actual"');
  });

  it("after the reveal: error by quarter, Chapter 11 note with source, labelled counterfactual", async () => {
    const data = await payloads(true);
    const html = render(data);
    expect(html).toContain(COUNTERFACTUAL_LABEL);
    expect(html).toContain("$60,689,000.00"); // actual usable cash, Dec 31, 2023
    expect(html).toContain("+$37,580,000.00"); // actual minus forecast
    expect(html).toContain("prepackaged Chapter 11");
    expect(html).toContain("Unverified");
    expect(html).toContain("2U did this anyway");
    expect(html).toContain("does not claim it would have prevented the Chapter 11 filing");
    for (const line of ["forecast", "actual", "counterfactual"])
      expect(html).toContain(`data-line="${line}"`);
    // Choosing the cost cut: 60,689,000.00 - 4,262,500.00.
    expect(render({ ...data, selected: "R-CUT" })).toContain("$56,426,500.00");
  });
});
