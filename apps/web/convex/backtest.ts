import {
  HistoricalCaseSchema,
  HistoricalComparisonSchema,
  ISODateSchema,
  TimestampSchema,
} from "@domino/contracts";
import {
  type BacktestSuggestion,
  QUARTER_BACKTEST_METHOD,
  type QuarterBridgeInput,
  creditDrawOverlap,
  quarterBridge,
  quarterCounterfactual,
  quarterFlowMiss,
  quarterSuggestions,
} from "@domino/engine";
import { v } from "convex/values";
import { z } from "zod";
import backtestJson from "../../../data/historical/2u/backtest.json";
import { query } from "./_generated/server";
import {
  CASE,
  CUTOFF,
  ROLES,
  fail,
  loadReveal,
  loadRun,
  same,
  snapshotOf,
  visibleCase,
} from "./historical";

/**
 * 2U backtest from the Nov 10, 2023 cutoff. Read-only queries over a saved baseline:
 * getSuggestions ranks engine-evaluated responses from cutoff facts only; getOutcome, which
 * refuses until the run's own reveal exists, builds the simulated counterfactual from the stored
 * reveal comparisons. No AI call is made here; every number comes from @domino/engine.
 */

const Source = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url(),
  publishedAt: TimestampSchema,
  verification: z.string(),
});
const Fact = z.object({
  id: z.string(),
  sourceId: z.string(),
  metric: z.enum(["revolver_commitment", "revolver_drawn"]),
  label: z.string(),
  date: ISODateSchema,
  cents: z.number().int().safe().nonnegative(),
  availableAt: TimestampSchema,
  locator: z.string(),
});
const Response = z.discriminatedUnion("kind", [
  z.object({ id: z.string(), kind: z.literal("keep_plan"), title: z.string() }),
  z.object({
    id: z.string(),
    kind: z.literal("costed"),
    title: z.string(),
    assumptionId: z.string(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("credit_draw"),
    title: z.string(),
    effectiveFrom: ISODateSchema,
    commitmentFactId: z.string(),
    drawnFactId: z.string(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("not_modeled"),
    title: z.string(),
    reason: z.string(),
    basisIds: z.array(z.string()),
  }),
]);
const BacktestDataSchema = z.object({
  id: z.string(),
  caseId: z.string(),
  mode: z.string(),
  disclosure: z.string(),
  sources: z.array(Source),
  cutoffFacts: z.array(Fact),
  cutoffNotes: z.array(
    z.object({
      id: z.string(),
      sourceId: z.string(),
      availableAt: TimestampSchema,
      quote: z.string(),
      locator: z.string(),
    }),
  ),
  responses: z.array(Response),
  revealSources: z.array(Source),
  revealFacts: z.array(Fact),
  epilogue: z.object({
    id: z.string(),
    sourceId: z.string(),
    date: ISODateSchema,
    title: z.string(),
    url: z.string().url(),
    text: z.string(),
    verification: z.string(),
  }),
});
const DATA = BacktestDataSchema.parse(backtestJson);
if (DATA.caseId !== CASE.id) throw new Error("backtest data belongs to a different case");

const at = (t: string) => Date.parse(t);
const known = <T extends { availableAt?: string; publishedAt?: string }>(items: T[]) =>
  items.filter((x) => at(x.availableAt ?? x.publishedAt ?? "") <= at(CUTOFF));

const NO_AI =
  "No AI rationale: this view calls no model. The ranking and every amount come from the engine.";

/** The baseline, checked like computeAlternative: saved from today's cutoff view, unchanged. */
async function suggestionsFor(ctx: Parameters<typeof loadRun>[0], caseId: string, runId: string) {
  if (caseId !== CASE.id) fail("NOT_FOUND", "Unknown case");
  const { run, snapshot } = await loadRun(ctx, runId, caseId);
  if (run.branch.kind !== "baseline") fail("INVALID_BRANCH", "A backtest starts from a baseline");
  if (!same(snapshotOf(run.inputs), snapshot) || run.knowledgeCutoff !== CUTOFF)
    fail("CASE_CHANGED", "The case changed since this baseline was saved; save a new baseline");
  const bridge: QuarterBridgeInput = { ...ROLES, case: visibleCase(CUTOFF) };
  const suggestions = quarterSuggestions({
    bridge,
    baseline: run,
    facts: known(DATA.cutoffFacts),
    responses: DATA.responses,
  });
  return { run, bridge, suggestions, targetDate: quarterBridge(bridge).targetDate };
}

/** What Domino would have suggested on the cutoff, ranked by modeled quarter-end cash. */
export const getSuggestions = query({
  args: { caseId: v.string(), runId: v.string() },
  handler: async (ctx, { caseId, runId }) => {
    const { suggestions } = await suggestionsFor(ctx, caseId, runId);
    return {
      mode: DATA.mode,
      method: { ...QUARTER_BACKTEST_METHOD },
      knowledgeCutoff: CUTOFF,
      suggestions,
      sources: known(DATA.sources),
      facts: known(DATA.cutoffFacts),
      notes: known(DATA.cutoffNotes),
      disclosure: DATA.disclosure,
      rationale: { provider: null, status: "skipped" as const, note: NO_AI },
    };
  },
});

/**
 * After this run's reveal only: forecast error by quarter flow and, for every modeled suggestion,
 * the simulated counterfactual (actual + effect - the part 2U is shown to have done anyway).
 */
export const getOutcome = query({
  args: { caseId: v.string(), runId: v.string() },
  handler: async (ctx, { caseId, runId }) => {
    const { run, bridge, suggestions, targetDate } = await suggestionsFor(ctx, caseId, runId);
    const reveal = await loadReveal(ctx, run);
    if (!reveal) fail("NOT_REVEALED", "Reveal what actually happened first");
    const through = reveal.revealedThrough;
    const view = HistoricalCaseSchema.parse(reveal.view);
    const comparisons = z.array(HistoricalComparisonSchema).parse(reveal.comparisons);
    const later = DATA.revealFacts.filter(
      (f) => at(f.availableAt) > at(CUTOFF) && at(f.availableAt) <= at(through),
    );
    const counterfactuals = suggestions
      .filter((s) => s.effectCents !== null)
      .map((s: BacktestSuggestion) => {
        let overlapCents = 0;
        let overlapFactIds: string[] = [];
        const r = DATA.responses.find((x) => x.id === s.id);
        if (r?.kind === "credit_draw" && s.amountCents !== null) {
          const before = DATA.cutoffFacts.find((f) => f.id === r.drawnFactId);
          const after = later.find((f) => f.metric === "revolver_drawn" && f.date === targetDate);
          if (before && after) {
            overlapCents = creditDrawOverlap(before, after, s.amountCents);
            overlapFactIds = [before.id, after.id];
          }
        }
        return {
          ...quarterCounterfactual({ run, comparisons, suggestion: s, overlapCents }),
          overlapFactIds,
        };
      });
    return {
      revealedThrough: through,
      comparisons,
      flows: quarterFlowMiss(bridge, view),
      counterfactuals,
      sources: [
        ...DATA.revealSources.filter((s) => at(s.publishedAt) <= at(through)),
        ...view.sources
          .filter((s) => at(s.publishedAt) > at(CUTOFF))
          .map((s) => ({ ...s, verification: "Audited case source." })),
      ].filter((s, i, all) => all.findIndex((x) => x.id === s.id) === i),
      facts: later,
      epilogue: DATA.epilogue,
      label: "Simulated counterfactual: illustrative, not a fact",
    };
  },
});
