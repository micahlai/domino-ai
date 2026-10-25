import { openedTimelineHref } from "../../../lib/timeline-entry";
import type { AnalysisReceipt } from "../../timeline/analysis/api";
import { analysisHref } from "../../timeline/analysis/links";
import type { FinancialOutput } from "../../timeline/analysis/output";
import type { CashPoint, Health } from "./derive";

/**
 * Dashboard adoption of Timeline's saved outputs (TL6 health/chart, TL7 risk scenarios), as
 * pure functions over Timeline's validated envelopes. Every number here is read from a saved
 * Timeline run; nothing is recalculated. Interface: kb/features/timeline/TL6-TL7-interface.md.
 */

/** The pointer back from Timeline, as fieldTimeline.latest returns it. */
export type TimelineLink = {
  timelineCompanyId: string;
  runId: string;
  baselineRunId: string;
  analysisId: string | null;
  analysisError: string | null;
  route: string;
  asOf: string;
  snapshotVersion: number;
  savedAt: string;
  /** False when Field has ingested newer books than the ones this run was saved from. */
  current: boolean;
};

export type TimelineRead =
  | { state: "none" }
  | { state: "loading"; link?: TimelineLink }
  | {
      state: "ready";
      link: TimelineLink;
      /** null when the saved output could not be read or verified. */
      output: FinancialOutput | null;
      /** The analysis started with this link (or the newest), null when none exists. */
      analysis: AnalysisReceipt | null;
    };

type Receipt = FinancialOutput["receipts"][number];

export const timelineAnalysisHref = (link: TimelineLink) =>
  analysisHref(link.timelineCompanyId, link.runId, link.analysisId ?? undefined);

/** First breached rule, cash minimums first, then by week. */
export function firstBreach(receipts: Receipt[]): Receipt | null {
  const breached = receipts.filter((r) => r.status === "breached");
  const order = (r: Receipt) => `${r.kind === "min_cash" ? 0 : 1}${r.weekStart ?? r.date ?? "~"}`;
  return [...breached].sort((a, b) => order(a).localeCompare(order(b)))[0] ?? null;
}

/** The lender's cash minimum the run was checked against, if the run has one. */
export function cashMinimum(receipts: Receipt[]): { label: string; cents: number } | null {
  const r = receipts.find((x) => x.kind === "min_cash");
  return r ? { label: r.label, cents: r.limit } : null;
}

/** Usable cash today, then each saved forecast week, in the dashboard chart's point shape. */
export function timelineCashLine(output: FinancialOutput, asOf: string): CashPoint[] {
  const weeks = output.chart.forecast.weeks;
  const first = weeks[0];
  // usable = closing - restricted cash, so the opening's usable uses the same restricted amount.
  const today = first ? first.opening - (first.closing - first.usable) : 0;
  return [
    { weekStart: asOf, label: "today", usable: today },
    ...weeks.map((w) => ({ weekStart: w.weekStart, label: "week" as const, usable: w.usable })),
  ];
}

export type TimelineHealth = {
  rating: Health;
  /** The first breached rule's week (cash minimum first), else the low point's week. */
  week: string;
  breach: Receipt | null;
  lowPoint: { weekStart: string; usable: number };
  unknownRules: number;
  scope: string;
};

export function timelineHealth(output: FinancialOutput): TimelineHealth {
  const breach = firstBreach(output.receipts);
  return {
    rating: output.health.rating,
    week: breach?.weekStart ?? breach?.date ?? output.chart.lowPoint.weekStart,
    breach,
    lowPoint: output.chart.lowPoint,
    unknownRules: output.health.unknownRuleCount,
    scope: output.health.scope,
  };
}

/** One saved TL7 risk scenario, with its best tested response, for a dashboard card. */
export type TimelineRiskCard = {
  id: string;
  label: string;
  /** Scenario weight from the analysis, with its stated basis (an assumption, not a forecast). */
  weight: number;
  weightBasis: string;
  breach: Receipt | null;
  lowPoint: { weekStart: string; usable: number };
  /** Change in the 13-week low point versus the saved run (negative = worse). */
  impact: number;
  failureReason: string | null;
  route: string | null;
  response: {
    label: string;
    costNote: string;
    gainCents: number;
    clearsAllRules: boolean;
    route: string | null;
  } | null;
};

export function timelineRiskCards(
  receipt: AnalysisReceipt,
  output: FinancialOutput,
  companyId: string,
): TimelineRiskCard[] {
  const base = output.chart.lowPoint.usable;
  return receipt.risks.map((risk) => {
    const best = receipt.responses
      .filter((r) => r.riskId === risk.id)
      .sort(
        (a, b) => Number(b.clearsAllRules) - Number(a.clearsAllRules) || b.gainCents - a.gainCents,
      )[0];
    return {
      id: risk.id,
      label: risk.label,
      weight: risk.probability,
      weightBasis: risk.probabilityBasis,
      breach: firstBreach(risk.receipts),
      lowPoint: risk.forecast.lowPoint,
      impact: risk.forecast.lowPoint.usable - base,
      failureReason: risk.failureReason,
      route: risk.runId ? openedTimelineHref(companyId, risk.runId) : null,
      response: best
        ? {
            label: best.label,
            costNote: best.costNote,
            gainCents: best.gainCents,
            clearsAllRules: best.clearsAllRules,
            route: best.runId ? openedTimelineHref(companyId, best.runId) : null,
          }
        : null,
    };
  });
}

/** Pick the analysis this link started, else the newest one Timeline lists for the run. */
export function pickAnalysis(
  receipts: AnalysisReceipt[],
  analysisId: string | null,
): AnalysisReceipt | null {
  return receipts.find((r) => r.analysisId === analysisId) ?? receipts[0] ?? null;
}
