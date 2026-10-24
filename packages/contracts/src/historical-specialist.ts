import { z } from "zod";
import { flagRepeats } from "./checks";
import { IdSchema } from "./core";
import {
  HistoricalCaseSchema,
  HistoricalComparisonContextSchema,
  HistoricalComparisonSchema,
  HistoricalRunContextSchema,
  HistoricalRunSchema,
  TimestampSchema,
} from "./historical";

/**
 * One bounded historical specialist model call on frozen, permitted evidence. The
 * model proposes prose and citations; code checks them. It never computes money.
 */

export const HISTORICAL_SPECIALIST_LIMITS = {
  questionChars: 1000,
  historyTurns: 8,
  historyTurnChars: 2000,
  sources: 20,
  sourceExcerptChars: 4000,
  facts: 80,
  assumptions: 20,
  comparisons: 40,
  assessmentChars: 1200,
  citations: 12,
  uncertainties: 5,
  uncertaintyChars: 300,
} as const;
const L = HISTORICAL_SPECIALIST_LIMITS;

export const HistoricalSpecialistRoleSchema = z.enum(["evidence_analyst", "scenario_reviewer"]);
export type HistoricalSpecialistRole = z.infer<typeof HistoricalSpecialistRoleSchema>;

export const HistoricalCitationKindSchema = z.enum(["source", "fact", "assumption", "engine"]);
export type HistoricalCitationKind = z.infer<typeof HistoricalCitationKindSchema>;

/** Citation kinds each role may use. */
export const HISTORICAL_CITATION_KINDS: Record<
  HistoricalSpecialistRole,
  readonly HistoricalCitationKind[]
> = {
  evidence_analyst: ["source", "fact", "engine"],
  scenario_reviewer: ["source", "fact", "assumption", "engine"],
};

/** Bounded source text for the model. Untrusted: it may hold instructions, which are data. */
export const HistoricalSpecialistExcerptSchema = z
  .object({ sourceId: IdSchema, text: z.string().min(1).max(L.sourceExcerptChars) })
  .strict();

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  new Set(a).size === new Set(b).size && a.every((id) => b.includes(id));

/**
 * The frozen packet. Financial and date integrity comes from the canonical case, run and
 * comparison contexts, not from parallel checks here. Unknown keys inside the case and runs
 * are stripped on parse, so only parsed fields reach the model.
 */
export const HistoricalSpecialistInputSchema = z
  .object({
    role: HistoricalSpecialistRoleSchema,
    /** Run cutoff before the reveal; the reveal instant after it. */
    visibleThrough: TimestampSchema,
    question: z.string().trim().min(1).max(L.questionChars),
    history: z
      .array(
        z
          .object({
            speaker: z.enum(["user", "domino"]),
            text: z.string().trim().min(1).max(L.historyTurnChars),
          })
          .strict(),
      )
      .max(L.historyTurns),
    /** Canonical case filtered to visibleThrough by the server. */
    case: HistoricalCaseSchema,
    /** Saved run under review: a baseline for the analyst, an alternative for the reviewer. */
    run: HistoricalRunSchema,
    /** The alternative's saved baseline; scenario reviewer only. */
    baseline: HistoricalRunSchema.optional(),
    comparisons: z.array(HistoricalComparisonSchema).max(L.comparisons),
    excerpts: z.array(HistoricalSpecialistExcerptSchema).max(L.sources),
  })
  .strict()
  .superRefine((x, ctx) => {
    // Messages are fixed strings: input text is untrusted and must not be echoed.
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    const forward = (r: z.SafeParseReturnType<unknown, unknown>, path?: (string | number)[]) => {
      if (!r.success) for (const i of r.error.issues) issue(path ?? i.path, i.message);
    };
    const c = x.case;
    if (
      c.sources.length > L.sources ||
      c.facts.length > L.facts ||
      c.assumptions.length > L.assumptions
    )
      issue(["case"], "case is too large");

    const visible = Date.parse(x.visibleThrough);
    for (const [i, s] of c.sources.entries())
      if (Date.parse(s.publishedAt) > visible)
        issue(["case", "sources", i, "publishedAt"], "source is after the visible time");
    for (const [i, f] of c.facts.entries())
      if (Date.parse(f.availableAt) > visible)
        issue(["case", "facts", i, "availableAt"], "fact is after the visible time");
    const cutoff = Date.parse(x.run.knowledgeCutoff);
    if (cutoff > visible) issue(["visibleThrough"], "run cutoff is after the visible time");
    // Before the reveal nothing later than the cutoff is visible, even in unused assumptions.
    if (visible <= cutoff)
      for (const [i, a] of c.assumptions.entries())
        if (a.label === "hindsight" || a.selectedAfterReveal)
          issue(["case", "assumptions", i], "hindsight is not visible before the reveal");

    const sourceIds = new Set(c.sources.map((s) => s.id));
    flagRepeats(
      ctx,
      x.excerpts,
      (e) => e.sourceId,
      (i) => ["excerpts", i, "sourceId"],
      "duplicate excerpt source",
    );
    for (const [i, e] of x.excerpts.entries())
      if (!sourceIds.has(e.sourceId))
        issue(["excerpts", i, "sourceId"], "excerpt source not supplied");

    // Run inputs, rule sources, hindsight, baseline link and shared nowcast.
    forward(HistoricalRunContextSchema.safeParse({ case: c, run: x.run, baseline: x.baseline }));

    const runs = x.baseline ? [x.run, x.baseline] : [x.run];
    // Runs and comparisons share the "engine" citation namespace; also stops a self-baseline.
    flagRepeats(
      ctx,
      [...runs, ...x.comparisons],
      (e) => e.id,
      (i) =>
        i < runs.length ? [i === 0 ? "run" : "baseline", "id"] : ["comparisons", i - runs.length],
      "duplicate engine id",
    );
    for (const [i, cmp] of x.comparisons.entries())
      if (!runs.some((r) => r.id === cmp.runId))
        issue(["comparisons", i, "runId"], "comparison run not supplied");
    // Prediction, rule, metric, period, currency, availability and exact values per run.
    for (const r of runs) {
      const mine = x.comparisons.filter((cmp) => cmp.runId === r.id);
      if (mine.length > 0)
        forward(
          HistoricalComparisonContextSchema.safeParse({
            case: c,
            run: r,
            revealedThrough: x.visibleThrough,
            comparisons: mine,
          }),
          ["comparisons"],
        );
    }

    if (x.role === "evidence_analyst") {
      if (x.run.branch.kind !== "baseline")
        issue(["run", "branch"], "evidence analyst reviews a baseline run");
      if (x.baseline) issue(["baseline"], "evidence analyst takes one baseline run");
    } else if (x.run.branch.kind !== "alternative") {
      issue(["run", "branch"], "scenario reviewer reviews an alternative run");
    } else if (x.baseline) {
      // The alternative differs from its baseline only by the decision it adds.
      const b = x.baseline.inputs;
      const r = x.run.inputs;
      const decision = x.run.branch.decisionAssumptionIds;
      if (
        !sameSet(b.sourceIds, r.sourceIds) ||
        !sameSet(b.factIds, r.factIds) ||
        !sameSet([...b.assumptionIds, ...decision], r.assumptionIds) ||
        decision.some((id) => b.assumptionIds.includes(id))
      )
        issue(
          ["run", "inputs"],
          "alternative inputs must be the baseline inputs plus the decision",
        );
    }
  });
export type HistoricalSpecialistInput = z.infer<typeof HistoricalSpecialistInputSchema>;

export const HistoricalCitationSchema = z
  .object({ kind: HistoricalCitationKindSchema, id: IdSchema })
  .strict();
export type HistoricalCitation = z.infer<typeof HistoricalCitationSchema>;

export const HistoricalSpecialistOutputSchema = z
  .object({
    assessment: z.string().trim().min(1).max(L.assessmentChars),
    citations: z.array(HistoricalCitationSchema).min(1).max(L.citations),
    uncertainties: z
      .array(z.string().trim().min(1).max(L.uncertaintyChars))
      .min(1)
      .max(L.uncertainties),
  })
  .strict()
  .superRefine((o, ctx) =>
    flagRepeats(
      ctx,
      o.citations,
      (c) => `${c.kind}:${c.id}`,
      (i) => ["citations", i],
      "duplicate citation",
    ),
  );
export type HistoricalSpecialistOutput = z.infer<typeof HistoricalSpecialistOutputSchema>;

/** Ids the role may cite, by kind. Disallowed kinds map to []. engine = run, baseline, then comparison ids. */
export function historicalCitationRefs(
  input: HistoricalSpecialistInput,
): Record<HistoricalCitationKind, string[]> {
  const allowed = HISTORICAL_CITATION_KINDS[input.role];
  const pick = (kind: HistoricalCitationKind, ids: string[]): string[] =>
    allowed.includes(kind) ? ids : [];
  const runs = input.baseline ? [input.run, input.baseline] : [input.run];
  return {
    source: pick(
      "source",
      input.case.sources.map((s) => s.id),
    ),
    fact: pick(
      "fact",
      input.case.facts.map((f) => f.id),
    ),
    assumption: pick(
      "assumption",
      input.case.assumptions.map((a) => a.id),
    ),
    engine: pick("engine", [...runs.map((r) => r.id), ...input.comparisons.map((c) => c.id)]),
  };
}

// ponytail: digit-only heuristic; spelled-out amounts ("forty million") pass. Upgrade path: structured amount refs.
const AMOUNT =
  /[$€£]\s*\d|\d[\d,.]*\s*(?:%|percent\b|thousand\b|million\b|billion\b|trillion\b|bn\b|mm\b|[mbk]\b)|\b\d{1,3}(?:,\d{3})+\b|\b\d{5,}\b/i;
const OVERCLAIM =
  /\bbankrupt\w*.{0,80}?\b(?:prevent|avert|avoid|stop)\w*|\b(?:prevent|avert|avoid|stop|save)\w*.{0,80}?\bbankrupt|\bguarantee\w*|\bwill (?:go|file|be|become) (?:bankrupt|insolvent)/i;
const NEGATION = /\b(?:no|not|never|cannot|without|nor)\b|n't\b/i;
/**
 * ponytail: phrase list plus "a negation earlier in the same clause excuses it", so "There is no
 * guarantee" passes and "This is not a forecast, but the cut would have prevented bankruptcy"
 * fails. Pattern checks cannot prove prose true: "Not only would this prevent bankruptcy" or a
 * reworded claim slips through. Upgrade path: a classifier or human review.
 */
const overclaims = (text: string): boolean =>
  text.split(/[.;!?]|\b(?:but|however|yet)\b/i).some((clause) => {
    const m = OVERCLAIM.exec(clause);
    return m !== null && !NEGATION.test(clause.slice(0, m.index + m[0].length));
  });

/** Problems with a schema-valid output for this input; [] means acceptable. Fixed messages: no ids or text. */
export function checkHistoricalSpecialistOutput(
  input: HistoricalSpecialistInput,
  output: HistoricalSpecialistOutput,
): string[] {
  const problems: string[] = [];
  const refs = historicalCitationRefs(input);
  if (output.citations.some((c) => !refs[c.kind].includes(c.id)))
    problems.push("citation not allowed");

  const has = (...kinds: HistoricalCitationKind[]) =>
    output.citations.some((c) => kinds.includes(c.kind) && refs[c.kind].includes(c.id));
  if (input.role === "evidence_analyst" && !has("source", "fact"))
    problems.push("evidence analyst must cite a source or fact");
  if (input.role === "scenario_reviewer" && !has("engine"))
    problems.push("scenario reviewer must cite an engine result");

  const texts = [output.assessment, ...output.uncertainties];
  if (texts.some((t) => AMOUNT.test(t))) problems.push("text contains a money amount or figure");
  if (texts.some(overclaims)) problems.push("text makes a guarantee or bankruptcy claim");
  return problems;
}
