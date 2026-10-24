import { HistoricalCaseSchema, HistoricalRunSchema } from "@domino/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
// Server evidence JSON is read here, in tests only. Client code never imports it.
import rawCase from "../../../../../data/historical/2u/case.json";
import protocol from "../../../../../data/historical/2u/protocol.json";
import { FinancialOutputView } from "./FinancialOutput";
import { InvestigateLive } from "./InvestigateLive";
import type { OutputTarget } from "./adapt";

const html = (target: OutputTarget, raw: Parameters<typeof FinancialOutputView>[0]["raw"]) =>
  renderToStaticMarkup(<FinancialOutputView target={target} raw={raw} />);
const forecast: OutputTarget = { stage: "forecast", baselineRunId: "b1", revealed: false };
const reveal: OutputTarget = { stage: "reveal", baselineRunId: "b1", revealed: true };

describe("FinancialOutputView", () => {
  it("shows loading, not empty, while records are unread", () => {
    expect(html(forecast, {})).toContain("Loading the saved case");
  });

  it("reports a failed read instead of drawing nothing", () => {
    const out = html(forecast, { case: new Error("x"), run: undefined });
    expect(out).toContain("Could not load this result");
  });

  it("refuses a malformed record rather than guessing", () => {
    const out = html(forecast, { case: { nope: 1 }, run: { nope: 1 } });
    expect(out).toContain("not in the expected shape");
  });

  it("never reads the reveal for the forecast view", () => {
    // A reveal error is irrelevant to a forecast node, so it must not surface there.
    const out = html(forecast, { case: undefined, run: undefined, reveal: new Error("x") });
    expect(out).toContain("Loading the saved case");
  });

  it("needs the reveal record for a reveal node", () => {
    expect(html(reveal, { case: {}, run: {}, reveal: undefined })).toContain("Loading");
    expect(html(reveal, { case: {}, run: {}, reveal: new Error("x") })).toContain(
      "Could not load this result",
    );
  });

  describe("alternative before the reveal", () => {
    const FULL = HistoricalCaseSchema.parse(rawCase);
    const cutoffMs = Date.parse(protocol.knowledgeCutoff);
    const pick = <T extends { id: string }>(items: T[], ids: string[]) =>
      items.filter((i) => ids.includes(i.id));
    const baseInputs = {
      sourceIds: protocol.inputs.sourceIds,
      factIds: protocol.inputs.factIds,
      assumptionIds: protocol.inputs.baselineAssumptionIds,
    };
    const altInputs = { ...baseInputs, assumptionIds: protocol.inputs.responseAssumptionIds };
    const snapshot = (inputs: typeof baseInputs) => ({
      caseId: FULL.id,
      currency: FULL.currency,
      method: protocol.method,
      sources: pick(FULL.sources, inputs.sourceIds),
      facts: pick(FULL.facts, inputs.factIds),
      assumptions: pick(FULL.assumptions, inputs.assumptionIds),
    });
    const baseRun = HistoricalRunSchema.parse({
      id: "baseline-0123456789abcdef",
      caseId: FULL.id,
      createdAt: "2026-10-24T18:00:00.000Z",
      knowledgeCutoff: protocol.knowledgeCutoff,
      originBalanceDate: protocol.originBalanceDate,
      inputs: baseInputs,
      inputHash: "a".repeat(64),
      method: protocol.method,
      riskRules: [],
      predictions: [...protocol.nowcast, ...protocol.baselineForecast].map((p, i) => ({
        ...p,
        id: `pred-${i}`,
      })),
      branch: { kind: "baseline" },
    });
    const altRun = HistoricalRunSchema.parse({
      ...baseRun,
      id: "alternative-fedcba9876543210",
      inputs: altInputs,
      inputHash: "b".repeat(64),
      predictions: [...protocol.nowcast, ...protocol.responseForecast].map((p, i) => ({
        ...p,
        id: `alt-pred-${i}`,
      })),
      branch: {
        kind: "alternative",
        baselineRunId: baseRun.id,
        decisionAssumptionIds: ["A1"],
        postHoc: true,
      },
    });
    // The case as frozen at the cutoff: nothing published later is in it.
    const facts = FULL.facts.filter((f) => Date.parse(f.availableAt) <= cutoffMs);
    const caseView = {
      case: HistoricalCaseSchema.parse({
        ...FULL,
        sources: FULL.sources.filter((s) => Date.parse(s.publishedAt) <= cutoffMs),
        facts,
        assumptions: FULL.assumptions.filter(
          (a) =>
            a.label !== "hindsight" && a.basisFactIds.every((id) => facts.some((f) => f.id === id)),
        ),
      }),
      knowledgeCutoff: protocol.knowledgeCutoff,
      originBalanceDate: protocol.originBalanceDate,
      visibleThrough: protocol.knowledgeCutoff,
      revealed: false,
      disclosure: protocol.disclosure,
      method: protocol.method,
      projectionAssumptions: ["Uniform daily flow across the quarter"],
      riskRulesNote: "No verified threshold, so no risk rule is applied. Risk is unknown.",
    };
    const raw = {
      case: caseView,
      run: {
        runId: baseRun.id,
        run: baseRun,
        riskRulesNote: caseView.riskRulesNote,
        inputSnapshot: snapshot(baseInputs),
      },
      alt: {
        runId: altRun.id,
        run: altRun,
        inputSnapshot: snapshot(altInputs),
        costRelativeToBaseline: { low: -715_000_000, point: -426_250_000, high: -137_500_000 },
        benefit: { start: "2024-02-11", daysInWindow: 0, afterTarget: "unknown" },
        postHoc: true,
        postHocReason: protocol.response.postHocReason,
        caveats: [protocol.response.unmodeledNote, protocol.response.pointNote],
      },
    };
    const early: OutputTarget = {
      stage: "alternative",
      baselineRunId: baseRun.id,
      altRunId: altRun.id,
      revealed: false,
    };

    it("shows the saved forecast, alternative, costs and post-hoc warning but no future values", () => {
      const out = html(early, raw);
      expect(out).toContain("hypothetical, cost only");
      expect(out).toContain("-$4.3M");
      expect(out).toContain("Post-hoc: chosen with the outcome known");
      expect(out).toContain("Saved forecast, Dec 31, 2023: $23.1M");
      expect(out).toContain("Alternative (projected), Dec 31, 2023: $18.8M");
      // The reported value that arrives later, the reveal date and any comparison table.
      expect(out).not.toMatch(/60[.,]?689|\$60\.7M/);
      expect(out).not.toContain("Disclosure published");
      expect(out).not.toContain("Feb 12, 2024");
      expect(out).not.toContain("revealed:");
      expect(out).not.toContain("Saved forecast versus what was reported");
    });

    it("does not read the reveal, so a failing reveal read cannot surface", () => {
      expect(html(early, { ...raw, reveal: new Error("x") })).toContain("hypothetical, cost only");
    });

    it("still refuses an alternative that belongs to another baseline", () => {
      const other = {
        ...raw.alt,
        run: {
          ...altRun,
          branch: { ...altRun.branch, baselineRunId: "baseline-ffffffffffffffff" },
        },
      };
      expect(html(early, { ...raw, alt: other })).toContain("does not belong to this forecast");
    });
  });
});

describe("InvestigateLive", () => {
  it("is honestly unavailable with no deployment and stages nothing", () => {
    const out = renderToStaticMarkup(<InvestigateLive />);
    expect(out).toContain("not connected to the investigation service");
    expect(out).toContain("Waiting for a question");
    expect(out).toContain("Unavailable right now");
  });
});
