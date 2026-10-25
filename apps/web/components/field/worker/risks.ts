import type { DashboardView } from "../dashboard/derive";
import { type AnalystLatest, savedRiskHref } from "../dashboard/risks";
import { type TimelineRead, cashMinimum, timelineRiskCards } from "../dashboard/timeline";
import { money, weekOf } from "./format";
import type { LowPoint } from "./suggestions";

/**
 * "Risks we're watching": one row shape for Timeline's saved risk scenarios (TL7, the forecast of
 * record), Field's analyst triage scenarios and, before either exists, the dashboard's labelled
 * sample events. Every number is read from those engine outputs; nothing is recalculated except
 * the gap to the lender's minimum at a known low point.
 */

export type RiskSource = "timeline" | "triage" | "sample";

export type WatchedRisk = {
  id: string;
  title: string;
  source: RiskSource;
  /** below: under the cash minimum (or zero); rule: another lender rule breaks; holds: all hold. */
  status: "below" | "rule" | "holds";
  /** The broken rule in words, e.g. "the lender's minimum". */
  rule: string;
  week: string | null;
  low: LowPoint | null;
  /** How far below the rule the cash goes, in cents; null when unknown or not short. */
  shortfall: number | null;
  href: string | null;
};

export const SOURCE_LABEL: Record<RiskSource, string> = {
  timeline: "Timeline scenario",
  triage: "Field check",
  sample: "Sample event",
};

const MINIMUM = "the lender's minimum";
const gap = (minimum: number | null, low: number | null) =>
  minimum !== null && low !== null && low < minimum ? minimum - low : null;

export function timelineRisks(timeline: TimelineRead | undefined): WatchedRisk[] {
  // Same rule as the dashboard's TimelineRisks: finished (fully or partly) analyses only.
  const status = timeline?.state === "ready" ? timeline.analysis?.status : undefined;
  if (timeline?.state !== "ready" || !timeline.output || !timeline.analysis) return [];
  if (status === "queued" || status === "running" || status === "failed") return [];
  const { link, output, analysis } = timeline;
  return timelineRiskCards(analysis, output, link.timelineCompanyId).map((r) => {
    const cash = r.breach?.kind === "min_cash";
    return {
      id: r.id,
      title: r.label,
      source: "timeline",
      status: r.breach ? (cash ? "below" : "rule") : "holds",
      rule: r.breach && !cash ? r.breach.label.toLowerCase() : MINIMUM,
      week: r.breach?.weekStart ?? r.breach?.date ?? null,
      low: { cents: r.lowPoint.usable, week: r.lowPoint.weekStart },
      shortfall: cash ? (r.breach?.shortfall ?? null) : null,
      href: r.route ?? link.route,
    };
  });
}

export function triageRisks(
  latest: AnalystLatest | undefined,
  minimum: number | null,
  href: string | null,
): WatchedRisk[] {
  if (!latest) return [];
  return latest.scenarios.flatMap<WatchedRisk>((s) => {
    if (s.status !== "done" || s.survives === null || s.low === null) return [];
    const short = gap(minimum, s.low);
    return [
      {
        id: s.id,
        title: s.title,
        source: "triage",
        status: s.survives ? "holds" : short !== null ? "below" : "rule",
        rule: s.survives || short !== null ? MINIMUM : "another illustrative cash rule",
        week: s.survives ? null : s.breaksAt,
        low: { cents: s.low, week: null },
        shortfall: short,
        href: savedRiskHref(s) ?? href,
      },
    ];
  });
}

/** The dashboard's sample events; without a lender's minimum they are tested against zero. */
export function sampleRisks(view: DashboardView): WatchedRisk[] {
  const minimum = view.lenderMinimum?.cents ?? null;
  const base = view.lowest?.usable ?? view.usableToday;
  return view.risks.map((r) => {
    const low = base + r.impact;
    return {
      id: r.id,
      title: r.title,
      source: "sample",
      status: r.failsWeek === null ? "holds" : "below",
      rule: minimum === null ? "zero" : MINIMUM,
      week: r.failsWeek,
      low: { cents: low, week: null },
      shortfall: gap(minimum ?? 0, low),
      href: null,
    };
  });
}

/** Breaking risks first, then the lowest cash. */
export function orderRisks(rows: WatchedRisk[]): WatchedRisk[] {
  const rank = { below: 0, rule: 1, holds: 2 } as const;
  return [...rows].sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      (a.low?.cents ?? 0) - (b.low?.cents ?? 0) ||
      a.id.localeCompare(b.id),
  );
}

/** Timeline's scenarios are the record; Field triage is listed after them; samples only alone. */
export function watchedRisks(input: {
  timeline: TimelineRead | undefined;
  latest: AnalystLatest | undefined;
  view: DashboardView | null;
}): WatchedRisk[] {
  const timeline = timelineRisks(input.timeline);
  const link =
    input.timeline?.state === "ready" || input.timeline?.state === "loading"
      ? input.timeline.link
      : undefined;
  const minimum =
    (input.timeline?.state === "ready" && input.timeline.output
      ? cashMinimum(input.timeline.output.receipts)?.cents
      : undefined) ??
    input.view?.lenderMinimum?.cents ??
    null;
  const triage = triageRisks(input.latest, minimum, link ? link.route : null);
  if (timeline.length > 0 || triage.length > 0)
    return [...orderRisks(timeline), ...orderRisks(triage)];
  return input.view ? orderRisks(sampleRisks(input.view)) : [];
}

/** What happens, in one sentence. */
export function riskSentence(r: WatchedRisk): string {
  if (r.status === "holds")
    return `Stays above ${r.rule === "zero" ? "zero" : MINIMUM} for all 13 weeks${
      r.low ? `. Lowest cash ${money(r.low.cents)}` : ""
    }.`;
  const when = weekOf(r.week);
  const head =
    r.status === "below"
      ? `Falls below ${r.rule}${when ? ` in ${when}` : ""}`
      : `Breaks ${r.rule}${when ? ` in ${when}` : ""}`;
  return r.shortfall !== null ? `${head}, short ${money(r.shortfall)}.` : `${head}.`;
}
