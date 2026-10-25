import { makeFunctionReference } from "convex/server";
import type { DashboardView } from "../dashboard/derive";
import { money, weekOf } from "./format";

/**
 * Suggested fixes for the worker page (fieldSuggestions.* on the backend). This file is the one
 * place that knows the backend shape: the page reads `Suggestion`, never the raw rows.
 *
 * The backend module is built in a separate lane. Until it is deployed the list query fails with
 * "Could not find public function"; the page catches that and shows its empty state. Set
 * SUGGESTIONS_ENABLED to false to skip the query entirely.
 */
export const SUGGESTIONS_ENABLED = true;

export type SuggestionStatus = "open" | "accepted" | "declined";
export type SuggestionDecision = "accepted" | "declined";
export type SimulationResult = {
  timelineCompanyId: string;
  baselineRunId: string;
  rootRunId: string;
  scenarioRunId: string;
  fixRunId: string;
  route: string;
  reused: boolean;
  scenarioLow: { cents: number; weekStart: string };
  fixLow: { cents: number; weekStart: string };
};

/** A fix as the backend may send it: a sentence, or the parts of one. */
export type SuggestionFix =
  | string
  | {
      kind?: string;
      label?: string;
      amountCents?: number;
      cents?: number;
      week?: string;
      weekStart?: string;
      date?: string;
    };

export type Suggestion = {
  id: string;
  scenarioId: string | null;
  scenarioTitle?: string;
  runId?: string;
  snapshotVersion?: number;
  fix: SuggestionFix;
  /** Engine values with the fix applied. */
  effect: {
    lowPointCents: number;
    lowPointWeek: string;
    staysAboveMinimum: boolean;
    scenarioLow?: number;
    lenderMinimum?: number;
  };
  recommendation: string;
  status: SuggestionStatus;
  note?: string;
  /** Who suggested it; the CREAO advisor unless the backend says otherwise. */
  by: string;
};

export const SUGGESTED_BY = "Engine advisors";

// Referenced by name so the page compiles before the backend module and its codegen exist.
export const SUGGESTIONS_API = {
  list: makeFunctionReference<"query", { companyId: string }, unknown[]>("fieldSuggestions:list"),
  decide: makeFunctionReference<
    "mutation",
    {
      companyId: string;
      id: string;
      expectedRunId: string;
      expectedSnapshotVersion: number;
      decision: SuggestionDecision;
      note?: string;
    },
    unknown
  >("fieldSuggestions:decide"),
};

export const SIMULATE_SUGGESTION_API = makeFunctionReference<
  "action",
  {
    companyId: string;
    runId: string;
    scenarioId: string;
    fixKind: string;
    suggestionId: string;
    snapshotVersion: number;
  },
  SimulationResult
>("fieldSuggestionSimulation:simulate");

/** Refuse incomplete legacy identities instead of simulating a different current suggestion. */
export function simulationArgs(companyId: string, s: Suggestion) {
  if (
    !companyId ||
    !s.runId ||
    !s.scenarioId ||
    !Number.isSafeInteger(s.snapshotVersion) ||
    typeof s.fix === "string" ||
    !s.fix.kind
  )
    throw new Error("This older suggestion has no complete saved inputs to simulate.");
  return {
    companyId,
    runId: s.runId,
    scenarioId: s.scenarioId,
    fixKind: s.fix.kind,
    suggestionId: s.id,
    snapshotVersion: s.snapshotVersion as number,
  };
}

/** True for the Convex error a query raises when its function is not deployed. */
export const isNotDeployed = (error: unknown) =>
  error instanceof Error && /could not find (public )?function/i.test(error.message);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** One backend row as a Suggestion; null when a required part is missing. */
export function toSuggestion(raw: unknown): Suggestion | null {
  if (!isRecord(raw) || !isRecord(raw.effect)) return null;
  const id = str(raw.id) || str(raw._id);
  const low = num(raw.effect.lowPoint) ?? num(raw.effect.lowPointCents);
  const fix = typeof raw.fix === "string" || isRecord(raw.fix) ? (raw.fix as SuggestionFix) : null;
  const status = raw.status;
  if (!id || low === null || !Number.isSafeInteger(low) || fix === null) return null;
  if (status !== "open" && status !== "accepted" && status !== "declined") return null;
  return {
    id,
    scenarioId: str(raw.scenarioId) || null,
    scenarioTitle: str(raw.scenarioTitle),
    runId: str(raw.runId),
    ...(num(raw.snapshotVersion) !== null && { snapshotVersion: raw.snapshotVersion as number }),
    fix,
    effect: {
      lowPointCents: low,
      lowPointWeek: str(raw.effect.lowWeekStart) || str(raw.effect.lowPointWeek),
      staysAboveMinimum: (raw.effect.survives ?? raw.effect.staysAboveMinimum) === true,
      ...(num(raw.effect.scenarioLow) !== null && {
        scenarioLow: raw.effect.scenarioLow as number,
      }),
      ...(num(raw.effect.lenderMinimum) !== null && {
        lenderMinimum: raw.effect.lenderMinimum as number,
      }),
    },
    recommendation: isRecord(raw.recommendation)
      ? str(raw.recommendation.text)
      : str(raw.recommendation),
    status,
    ...(str(raw.note) && { note: str(raw.note) }),
    by:
      str(raw.by) ||
      str(raw.suggestedBy) ||
      (isRecord(raw.recommendation) && raw.recommendation.provider === "creao"
        ? "CREAO advisor"
        : SUGGESTED_BY),
  };
}

const CREDIT_KINDS = new Set([
  "credit_line_draw",
  "credit_draw",
  "draw_credit",
  "draw_credit_line",
  "add_cash",
]);

/** The fix in plain words: "Draw $1.2M on the credit line in the week of Dec 14". */
export function fixSentence(fix: SuggestionFix): string {
  if (typeof fix === "string") return fix.trim() || "Suggested fix";
  const amount = num(fix.amountCents) ?? num(fix.cents);
  const when = weekOf(fix.week ?? fix.weekStart ?? fix.date);
  const label = str(fix.label).trim();
  const credit = (fix.kind && CREDIT_KINDS.has(fix.kind)) || /credit line/i.test(label);
  const what =
    credit && amount !== null
      ? `Draw ${money(amount)} on the credit line`
      : label
        ? amount !== null && !label.includes("$")
          ? `${label}: ${money(amount)}`
          : label
        : amount !== null
          ? `Add ${money(amount)} of cash`
          : "Suggested fix";
  return when ? `${what} in ${when}` : what;
}

export type LowPoint = { cents: number; week: string | null };

/** What the fix does to the lowest projected cash, against the lender's minimum. */
export type CashEffect = {
  before: LowPoint | null;
  after: LowPoint;
  minimum: number | null;
  stays: boolean;
};

export type EffectContext = {
  /** Lowest projected cash with no change (the plan). */
  baseline: LowPoint | null;
  /** Lowest projected cash in each risk scenario, by scenario id. */
  scenarios: Map<string, LowPoint & { title: string }>;
  minimum: number | null;
};

export function cashEffect(s: Suggestion, ctx: EffectContext): CashEffect {
  const scenario = s.scenarioId ? ctx.scenarios.get(s.scenarioId) : undefined;
  return {
    before:
      s.effect.scenarioLow !== undefined
        ? { cents: s.effect.scenarioLow, week: null }
        : scenario
          ? { cents: scenario.cents, week: scenario.week }
          : ctx.baseline,
    after: { cents: s.effect.lowPointCents, week: s.effect.lowPointWeek || null },
    minimum: s.effect.lenderMinimum ?? ctx.minimum,
    stays: s.effect.staysAboveMinimum,
  };
}

/** How far the fixed low point sits from the minimum: "$27K above the minimum", "$1.2M short". */
export function roomLine(e: CashEffect): string | null {
  if (e.minimum === null) return null;
  const room = e.after.cents - e.minimum;
  return room >= 0 ? `${money(room)} above the minimum` : `${money(-room)} short`;
}

/** The scenario this fix answers, in words, when the page knows it. */
export const scenarioTitle = (s: Suggestion, ctx: EffectContext) =>
  s.scenarioTitle || (s.scenarioId ? (ctx.scenarios.get(s.scenarioId)?.title ?? null) : null);

export function splitSuggestions(list: Suggestion[]) {
  return {
    open: list.filter((s) => s.status === "open"),
    decided: list.filter((s) => s.status !== "open"),
  };
}

/** Record a decision locally: the demo's whole state, and the live page's optimistic view. */
export function applyDecision(
  list: Suggestion[],
  id: string,
  decision: SuggestionDecision,
  note: string,
): Suggestion[] {
  const trimmed = note.trim();
  return list.map((s) => {
    if (s.id !== id || s.status !== "open") return s;
    const { note: _old, ...rest } = s;
    return { ...rest, status: decision, ...(trimmed && { note: trimmed }) };
  });
}

/** Mutation arguments for one decision; an empty note is left out. */
export const decideArgs = (
  companyId: string,
  suggestion: Suggestion,
  decision: SuggestionDecision,
  note: string,
) => {
  if (!suggestion.runId || !Number.isSafeInteger(suggestion.snapshotVersion))
    throw new Error("Reload suggestions before recording a decision.");
  return {
    companyId,
    id: suggestion.id,
    expectedRunId: suggestion.runId,
    expectedSnapshotVersion: suggestion.snapshotVersion as number,
    decision,
    ...(note.trim() && { note: note.trim() }),
  };
};

/**
 * Demo suggestions: the dashboard's sample risks that need a credit line draw (derive.ts, real
 * engine forecasts on the demo books). The draw is one cash addition at the start of the
 * forecast, so every projected week, the low point included, rises by exactly the draw amount;
 * whether the lender's rules then hold is the engine's own answer (`fix.survives`).
 */
export function demoSuggestions(view: DashboardView): Suggestion[] {
  const base = view.lowest?.usable ?? view.usableToday;
  return view.risks.flatMap((r) => {
    if (!r.fix) return [];
    const before = base + r.impact;
    return [
      {
        id: `demo-${r.id}`,
        scenarioId: r.id,
        fix: { kind: "credit_draw", amountCents: r.fix.cents, week: view.forecastStart },
        effect: {
          lowPointCents: before + r.fix.cents,
          // The sample risk does not keep its own low-point week, so none is claimed.
          lowPointWeek: "",
          staysAboveMinimum: r.fix.survives,
        },
        recommendation:
          "Covers the gap to the lender's minimum at the low point, rounded up to the next $50K.",
        status: "open" as const,
        by: "Engine-tested sample",
      },
    ];
  });
}
