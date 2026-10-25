import { HistoricalCaseSchema, HistoricalRunSchema } from "@domino/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import caseJson from "../../../../../data/historical/2u/case.json";
import protocol from "../../../../../data/historical/2u/protocol.json";
import { EPILOGUE, RewindScreen, type ScreenState } from "./RewindDashboard";
import { atCutoff, deriveReveal } from "./derive";

const full = HistoricalCaseSchema.parse(caseJson);
const CUTOFF = protocol.knowledgeCutoff;
const THROUGH = "2024-02-12T16:01:00-05:00";
const run = HistoricalRunSchema.parse({
  id: "baseline-render-2u",
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
const comparisons = run.predictions.map((p) => {
  const base = { id: `cmp-${p.id}`, runId: run.id, predictionId: p.id };
  if (p.kind === "nowcast")
    return { ...base, status: "unscored" as const, reason: "no_observation" as const };
  const f = full.facts.find((x) => x.id === (p.metric === "cash_and_equivalents" ? "H01" : "H03"));
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

type Reveal = Extract<ScreenState, { kind: "ready" }>["reveal"];
const render = (reveal: Reveal, caseView = atCutoff(full, CUTOFF)) =>
  renderToStaticMarkup(
    createElement(RewindScreen, {
      state: {
        kind: "ready",
        caseView,
        run,
        disclosure: protocol.disclosure,
        reveal,
        act: {},
        onReveal: () => {},
        onRestart: () => {},
      },
    }),
  );

describe("2U rewind screen", () => {
  it("shows the rewind header, quarterly label and flags before the reveal", () => {
    const html = render(null);
    expect(html).toContain(
      "2U, Inc. · Real company · Quarterly public filings · As of Nov 10, 2023 (rewind)",
    );
    expect(html).toContain("quarterly, not weekly");
    expect(html).toContain("What Domino would have flagged");
    expect(html).toContain("Reveal what happened");
    expect(html).toContain("No lender&#x27;s minimum is in the case data");
    expect(html).toContain("$41.1M");
    expect(html).toContain("$23.1M");
  });

  it("never renders later figures or the later event before the reveal", () => {
    // Even if the full case (with later facts) were passed, the screen stays at the cutoff.
    for (const html of [render(null), render(null, full)]) {
      expect(html).not.toContain("$60.7M"); // H01, reported Dec 31, 2023
      expect(html).not.toContain("$73.4M"); // H03
      expect(html).not.toMatch(/chapter 11/i);
      expect(html).not.toContain("Fourth Quarter");
      expect(html).not.toContain(EPILOGUE.url);
      expect(html).not.toMatch(/\bH0[1-7]\b|\bD0[1-4]\b/);
    }
  });

  it("shows actual figures and the later event only after the reveal", () => {
    const revealed = deriveReveal(atCutoff(full, THROUGH), run, {
      runId: run.id,
      revealedThrough: THROUGH,
      comparisons,
    });
    const html = render(revealed);
    expect(html).toContain("$60.7M");
    expect(html).toContain("Cash rose instead");
    expect(html).toContain("2U Reports Results for Fourth Quarter and Full-Year 2023");
    expect(html).toMatch(/Chapter 11/);
    expect(html).toContain("not from the audited case data");
    expect(html).toContain("Rewind again");
  });
});
