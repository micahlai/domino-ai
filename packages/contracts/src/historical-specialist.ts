import { z } from "zod";
import { flagRepeats } from "./checks";
import { IdSchema } from "./core";
import {
  HistoricalAssumptionSchema,
  HistoricalComparisonSchema,
  HistoricalFactSchema,
  HistoricalRunSchema,
  HistoricalSourceSchema,
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
  sourceTitleChars: 300,
  sourceExcerptChars: 4000,
  facts: 80,
  assumptions: 20,
  runs: 2,
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

/** Source as the model sees it: publication-safe subset plus a bounded excerpt (untrusted text). */
export const HistoricalSpecialistSourceSchema = HistoricalSourceSchema.pick({
  id: true,
  title: true,
  publishedAt: true,
})
  .extend({
    title: z.string().min(1).max(L.sourceTitleChars),
    excerpt: z.string().max(L.sourceExcerptChars).optional(),
  })
  .strict();

export const HistoricalSpecialistInputSchema = z
  .object({
    role: HistoricalSpecialistRoleSchema,
    caseId: IdSchema,
    companyName: z.string().trim().min(1).max(200),
    /** Evidence visibility frozen for this task (run cutoff before reveal; reveal instant after). */
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
    sources: z.array(HistoricalSpecialistSourceSchema).max(L.sources),
    facts: z.array(HistoricalFactSchema).min(1).max(L.facts),
    assumptions: z.array(HistoricalAssumptionSchema).max(L.assumptions),
    runs: z.array(HistoricalRunSchema).min(1).max(L.runs),
    comparisons: z.array(HistoricalComparisonSchema).max(L.comparisons),
  })
  .strict()
  .superRefine((x, ctx) => {
    // Messages are fixed strings: input text is untrusted and must not be echoed.
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    const dup = <T>(items: readonly T[], key: (t: T) => string, name: string, label: string) =>
      flagRepeats(ctx, items, key, (i) => [name, i, "id"], `duplicate ${label} id`);
    dup(x.sources, (s) => s.id, "sources", "source");
    dup(x.facts, (f) => f.id, "facts", "fact");
    dup(x.assumptions, (a) => a.id, "assumptions", "assumption");
    // Runs and comparisons share the "engine" citation namespace.
    flagRepeats(
      ctx,
      [...x.runs, ...x.comparisons],
      (e) => e.id,
      (i) => (i < x.runs.length ? ["runs", i, "id"] : ["comparisons", i - x.runs.length, "id"]),
      "duplicate engine id",
    );

    const visible = Date.parse(x.visibleThrough);
    for (const [i, s] of x.sources.entries())
      if (Date.parse(s.publishedAt) > visible)
        issue(["sources", i, "publishedAt"], "source is after the visible time");
    for (const [i, f] of x.facts.entries())
      if (Date.parse(f.availableAt) > visible)
        issue(["facts", i, "availableAt"], "fact is after the visible time");
    for (const [i, r] of x.runs.entries())
      if (Date.parse(r.knowledgeCutoff) > visible)
        issue(["runs", i, "knowledgeCutoff"], "run cutoff is after the visible time");

    const sourceIds = new Set(x.sources.map((s) => s.id));
    const factIds = new Set(x.facts.map((f) => f.id));
    const assumptionIds = new Set(x.assumptions.map((a) => a.id));
    const runIds = new Set(x.runs.map((r) => r.id));
    for (const [i, f] of x.facts.entries()) {
      if (f.kind === "reported" && !sourceIds.has(f.sourceId))
        issue(["facts", i, "sourceId"], "fact source not supplied");
      if (f.kind === "derived" && f.derivedFrom.some((d) => !factIds.has(d)))
        issue(["facts", i, "derivedFrom"], "derived fact input not supplied");
    }
    for (const [i, a] of x.assumptions.entries()) {
      if (a.basisFactIds.some((id) => !factIds.has(id)))
        issue(["assumptions", i, "basisFactIds"], "assumption basis fact not supplied");
      if (a.dependsOn.some((id) => !assumptionIds.has(id)))
        issue(["assumptions", i, "dependsOn"], "assumption dependency not supplied");
    }
    for (const [i, r] of x.runs.entries())
      if (r.caseId !== x.caseId) issue(["runs", i, "caseId"], "run belongs to another case");
    for (const [i, c] of x.comparisons.entries()) {
      if (!runIds.has(c.runId)) issue(["comparisons", i, "runId"], "comparison run not supplied");
      if (c.status === "scored" && !factIds.has(c.observationFactId))
        issue(["comparisons", i, "observationFactId"], "observation fact not supplied");
    }

    if (x.role === "evidence_analyst") {
      for (const [i, r] of x.runs.entries())
        if (r.branch.kind !== "baseline")
          issue(["runs", i, "branch"], "evidence analyst takes baseline runs only");
    } else {
      const alternatives = x.runs.filter((r) => r.branch.kind === "alternative");
      if (alternatives.length === 0) issue(["runs"], "scenario reviewer needs an alternative run");
      for (const [i, r] of x.runs.entries())
        if (r.branch.kind === "alternative" && !runIds.has(r.branch.baselineRunId))
          issue(["runs", i, "branch", "baselineRunId"], "baseline run not supplied");
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

/** Ids the role may cite, by kind. Disallowed kinds map to []. engine = run ids then comparison ids. */
export function historicalCitationRefs(
  input: HistoricalSpecialistInput,
): Record<HistoricalCitationKind, string[]> {
  const allowed = HISTORICAL_CITATION_KINDS[input.role];
  const pick = (kind: HistoricalCitationKind, ids: string[]): string[] =>
    allowed.includes(kind) ? ids : [];
  return {
    source: pick(
      "source",
      input.sources.map((s) => s.id),
    ),
    fact: pick(
      "fact",
      input.facts.map((f) => f.id),
    ),
    assumption: pick(
      "assumption",
      input.assumptions.map((a) => a.id),
    ),
    engine: pick("engine", [...input.runs.map((r) => r.id), ...input.comparisons.map((c) => c.id)]),
  };
}

// ponytail: digit-only heuristic; spelled-out amounts ("forty million") pass. Upgrade path: structured amount refs.
const AMOUNT =
  /[$€£]\s*\d|\d[\d,.]*\s*(?:%|percent\b|thousand\b|million\b|billion\b|trillion\b|bn\b|mm\b|[mbk]\b)|\b\d{1,3}(?:,\d{3})+\b|\b\d{5,}\b/i;
// ponytail: phrase list, not semantics; a reworded claim can slip through. Upgrade path: a classifier or human review.
const OVERCLAIM =
  /\bbankrupt\w*[^.]{0,80}\b(?:prevent|avert|avoid|stop)\w*|\b(?:prevent|avert|avoid|stop|save)\w*[^.]{0,80}\bbankrupt|\bguarantee\w*|\bwill (?:go|file|be|become) (?:bankrupt|insolvent)/i;

/** Problems with a schema-valid output for this input; [] means acceptable. Messages never contain output text. */
export function checkHistoricalSpecialistOutput(
  input: HistoricalSpecialistInput,
  output: HistoricalSpecialistOutput,
): string[] {
  const problems: string[] = [];
  const refs = historicalCitationRefs(input);
  for (const c of output.citations)
    if (!refs[c.kind].includes(c.id)) problems.push(`citation not allowed: ${c.kind}:${c.id}`);

  const has = (...kinds: HistoricalCitationKind[]) =>
    output.citations.some((c) => kinds.includes(c.kind) && refs[c.kind].includes(c.id));
  if (input.role === "evidence_analyst" && !has("source", "fact"))
    problems.push("evidence analyst must cite a source or fact");
  if (input.role === "scenario_reviewer" && !has("engine"))
    problems.push("scenario reviewer must cite an engine result");

  const texts = [output.assessment, ...output.uncertainties];
  if (texts.some((t) => AMOUNT.test(t))) problems.push("text contains a money amount or figure");
  if (texts.some((t) => OVERCLAIM.test(t)))
    problems.push("text makes a guarantee or bankruptcy claim");
  return problems;
}
