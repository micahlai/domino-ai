import type { Cents, ISODate } from "@domino/contracts";
import { openedTimelineHref } from "../../../lib/timeline-entry";
import type { DashboardView } from "./derive";

/**
 * Risk cards for the dashboard, from one of two places:
 * - "analyst": the latest field analyst run (fieldAnalyst.latest), each scenario forecast and
 *   stress-tested by the engine on the backend.
 * - "illustrative": the dashboard's own sample events (derive.ts sampleRisks). The outcome of
 *   each is a real engine forecast, but the events were picked by a simple rule, so the UI
 *   labels them Illustrative.
 */

export type RiskOutcome = "stays_above" | "falls_below" | "below_zero" | "breaks_rule";

export type RiskCard = {
  id: string;
  title: string;
  outcome: RiskOutcome;
  /** First week a lender rule breaks; null when every rule holds for 13 weeks. */
  week: ISODate | null;
  /** Change in the 13-week lowest projected cash versus the plan (negative = worse). */
  impact: Cents;
  fix: { label: string; note: string | null; holds: boolean } | null;
  /** The risk's saved Timeline run, when the forecasting agent has saved it. */
  href?: string | null;
};

export type RiskFeed = {
  source: "analyst" | "illustrative";
  cards: RiskCard[];
  /** Analyst only: how many scenarios the run finished, and the books date it read. */
  total: number;
  asOf: ISODate | null;
  /** Analyst only: public web signals the research agent found (real Apify runs). */
  signals?: CounterpartySignals[];
};

export type CounterpartySignals = {
  counterparty: string;
  role: "customer" | "vendor" | null;
  /** Apify run id the signals came from. */
  runId: string;
  fetchedAt: string;
  headlines: { title: string; url: string; source: string; date: string | null; kinds: string[] }[];
};

/** The parts of fieldAnalyst.latest the dashboard reads (kept structural so tests need no Convex). */
export type AnalystLatest = {
  asOf: string;
  scenarios: {
    id: string;
    title: string;
    status: string;
    survives: boolean | null;
    breaksAt: string | null;
    low: number | null;
    lowPointImpact: number | null;
    bestFix: { label: string; costNote: string; survivesWithFix: boolean } | null;
    /** Saved Timeline risk run (fieldForecastRuns.ts); absent on older backends. */
    forecast?: { timelineCompanyId: string; scenarioRunId: string } | null;
  }[];
  research?: unknown[];
} | null;

const text = (v: unknown) => (typeof v === "string" ? v : "");

/** Timeline route that opens one analyst scenario's saved risk run, or null before it is saved. */
export function savedRiskHref(s: AnalystScenarioRow): string | null {
  const f = s.forecast;
  return f && text(f.timelineCompanyId) && text(f.scenarioRunId)
    ? openedTimelineHref(f.timelineCompanyId, f.scenarioRunId)
    : null;
}
type AnalystScenarioRow = NonNullable<AnalystLatest>["scenarios"][number];

/** Apify entries of the analyst's research list, one per counterparty (newest wins). */
export function counterpartySignals(research: unknown[] | undefined): CounterpartySignals[] {
  const out = new Map<string, CounterpartySignals>();
  for (const raw of research ?? []) {
    const r = raw as Record<string, unknown>;
    if (r.provider !== "apify" || !text(r.input) || !text(r.remoteRunId)) continue;
    const signals = Array.isArray(r.signals) ? (r.signals as Record<string, unknown>[]) : [];
    out.set(text(r.input), {
      counterparty: text(r.input),
      role: r.role === "customer" || r.role === "vendor" ? r.role : null,
      runId: text(r.remoteRunId),
      fetchedAt: text(r.fetchedAt),
      headlines: signals.flatMap((s) =>
        text(s.title) && /^https?:\/\//.test(text(s.url))
          ? [
              {
                title: text(s.title),
                url: text(s.url),
                source: text(s.source),
                date: text(s.date) || null,
                kinds: Array.isArray(s.kinds) ? s.kinds.map(text).filter(Boolean) : [],
              },
            ]
          : [],
      ),
    });
  }
  return [...out.values()];
}

const SHOWN = 3;

function outcome(survives: boolean, low: Cents, minimum: Cents | null): RiskOutcome {
  if (survives) return "stays_above";
  return minimum !== null && low < minimum ? "falls_below" : "breaks_rule";
}

export function illustrativeRisks(view: DashboardView): RiskFeed {
  const minimum = view.lenderMinimum?.cents ?? null;
  const base = view.lowest?.usable ?? view.usableToday;
  const cards = view.risks.map<RiskCard>((r) => ({
    id: r.id,
    title: r.title,
    // Without a lender's minimum the sample events are tested against zero (derive.ts).
    outcome:
      r.failsWeek === null
        ? "stays_above"
        : minimum === null
          ? "below_zero"
          : outcome(false, base + r.impact, minimum),
    week: r.failsWeek,
    impact: r.impact,
    fix: r.fix ? { label: r.fix.label, note: null, holds: r.fix.survives } : null,
  }));
  return { source: "illustrative", cards, total: cards.length, asOf: view.asOf };
}

/**
 * Worst finished analyst scenarios first. Null when the analyst has no finished scenario, so the
 * caller can fall back to the illustrative cards.
 */
export function analystRisks(latest: AnalystLatest, view: DashboardView): RiskFeed | null {
  if (!latest) return null;
  const minimum = view.lenderMinimum?.cents ?? null;
  const done = latest.scenarios.flatMap((s) =>
    s.status === "done" && s.survives !== null && s.low !== null && s.lowPointImpact !== null
      ? [{ ...s, survives: s.survives, low: s.low, lowPointImpact: s.lowPointImpact }]
      : [],
  );
  if (done.length === 0) return null;
  const cards = [...done]
    .sort((a, b) => a.lowPointImpact - b.lowPointImpact || a.id.localeCompare(b.id))
    .slice(0, SHOWN)
    .map<RiskCard>((s) => ({
      id: s.id,
      title: s.title,
      outcome: outcome(s.survives, s.low, minimum),
      week: s.survives ? null : s.breaksAt,
      impact: s.lowPointImpact,
      fix: s.bestFix
        ? { label: s.bestFix.label, note: s.bestFix.costNote, holds: s.bestFix.survivesWithFix }
        : null,
      href: savedRiskHref(s),
    }));
  const signals = counterpartySignals(latest.research);
  return {
    source: "analyst",
    cards,
    total: done.length,
    asOf: latest.asOf,
    ...(signals.length > 0 && { signals }),
  };
}

export const OUTCOME_WORDS: Record<RiskOutcome, string> = {
  stays_above: "Stays above the lender's minimum",
  falls_below: "Falls below the lender's minimum",
  below_zero: "Falls below zero",
  breaks_rule: "Breaks another illustrative cash rule",
};
