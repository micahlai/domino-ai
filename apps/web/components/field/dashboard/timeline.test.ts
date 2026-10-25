import { describe, expect, it } from "vitest";
import { fixtureAnalysis } from "../../timeline/analysis/fixtures";
import type { FinancialOutput } from "../../timeline/analysis/output";
import {
  cashMinimum,
  firstBreach,
  pickAnalysis,
  timelineCashLine,
  timelineHealth,
  timelineRiskCards,
} from "./timeline";

type Receipt = FinancialOutput["receipts"][number];
const receipt = (over: Partial<Receipt>): Receipt => ({
  constraintId: "con_lender_min",
  constraintVersion: "rule/1",
  label: "Lender's minimum",
  kind: "min_cash",
  status: "clear",
  relation: "clear",
  limit: 300_000_000,
  unit: "cents",
  value: null,
  shortfall: null,
  date: null,
  weekStart: null,
  actionLabels: [],
  evidence: [],
  ...over,
});

const week = (weekStart: string, opening: number, closing: number, restricted = 10_000) => ({
  weekStart,
  opening,
  inflow: Math.max(0, closing - opening),
  outflow: Math.max(0, opening - closing),
  closing,
  usable: closing - restricted,
});

// Only the fields these helpers read; the full envelope is validated by Timeline's parser.
const output = {
  health: {
    rating: "at_risk",
    reasonCodes: ["rule_breach"],
    evaluatedRuleCount: 2,
    unknownRuleCount: 0,
    scope: "Saved 13-week forecast and stated rules only.",
  },
  receipts: [
    receipt({
      kind: "min_runway_months",
      constraintId: "con_runway",
      status: "breached",
      relation: "pre_existing",
      unit: "months",
      limit: 18,
      weekStart: "2026-11-02",
    }),
    receipt({
      status: "breached",
      relation: "pre_existing",
      value: 280_000_000,
      shortfall: -20_000_000,
      weekStart: "2026-11-23",
    }),
  ],
  chart: {
    forecast: {
      weeks: [
        week("2026-11-02", 500_000_000, 400_000_000),
        week("2026-11-09", 400_000_000, 290_010_000),
      ],
      lowPoint: { weekStart: "2026-11-09", usable: 290_000_000 },
    },
    lowPoint: { weekStart: "2026-11-09", usable: 290_000_000 },
  },
} as unknown as FinancialOutput;

describe("Timeline outputs on the dashboard", () => {
  it("names the cash-minimum breach first, even when another rule breaks earlier", () => {
    expect(firstBreach(output.receipts)?.constraintId).toBe("con_lender_min");
    const h = timelineHealth(output);
    expect(h).toMatchObject({ rating: "at_risk", week: "2026-11-23", unknownRules: 0 });
    expect(cashMinimum(output.receipts)).toEqual({
      label: "Lender's minimum",
      cents: 300_000_000,
    });
  });

  it("charts today's usable cash, then each saved week's usable cash", () => {
    // Today: opening 500,000,000 minus 10,000 restricted.
    expect(timelineCashLine(output, "2026-10-30")).toEqual([
      { weekStart: "2026-10-30", label: "today", usable: 499_990_000 },
      { weekStart: "2026-11-02", label: "week", usable: 399_990_000 },
      { weekStart: "2026-11-09", label: "week", usable: 290_000_000 },
    ]);
  });

  it("turns saved TL7 risks into cards with their best response and scenario links", () => {
    const cards = timelineRiskCards(fixtureAnalysis, output, "kestrel");
    expect(cards).toHaveLength(fixtureAnalysis.risks.length);
    for (const [i, risk] of fixtureAnalysis.risks.entries()) {
      const card = cards[i];
      expect(card?.impact).toBe(risk.forecast.lowPoint.usable - 290_000_000);
      expect(card?.route).toBe(
        risk.runId
          ? `/c/kestrel/timeline?runId=${encodeURIComponent(risk.runId)}&reveal=${encodeURIComponent(risk.runId)}`
          : null,
      );
      const responses = fixtureAnalysis.responses.filter((r) => r.riskId === risk.id);
      if (responses.length === 0) expect(card?.response).toBeNull();
      else expect(responses.map((r) => r.label)).toContain(card?.response?.label);
    }
  });

  it("prefers the analysis the link started, else the newest", () => {
    const other = { ...fixtureAnalysis, analysisId: "timeline:analysis/other" };
    expect(pickAnalysis([other, fixtureAnalysis], fixtureAnalysis.analysisId)).toBe(
      fixtureAnalysis,
    );
    expect(pickAnalysis([other, fixtureAnalysis], null)).toBe(other);
    expect(pickAnalysis([], null)).toBeNull();
  });
});
