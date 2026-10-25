import { z } from "zod";
import { CalendarDateSchema, SafeCentsSchema, flagRepeats, isCalendarDate } from "./checks";
import { IdSchema } from "./core";

/**
 * Historical case study contracts: public disclosures, frozen runs and later
 * period-matched comparisons. Separate from the operational 13-week Forecast and the
 * bank-window GradeContext, which need ledger records public filings do not have.
 * Availability is a publication instant, never a financial period end.
 */

const TIMESTAMP_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

/** Instant with an explicit offset, for example "2023-11-09T16:45:46-05:00". */
export const TimestampSchema = z
  .string()
  .regex(TIMESTAMP_SHAPE, "expected an ISO timestamp with an explicit offset")
  .refine(
    (t) => isCalendarDate(t.slice(0, 10)) && Number.isFinite(Date.parse(t)),
    "invalid timestamp",
  );
export type Timestamp = z.infer<typeof TimestampSchema>;

const ms = (t: string): number => Date.parse(t);
/** Local calendar date as written in the timestamp, before the offset. */
const localDate = (t: string): string => t.slice(0, 10);

export const Sha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "expected a lowercase sha256 hex digest");

/** ISO 4217 code. A case uses one currency; no silent FX mixing. */
export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/, "expected an ISO 4217 code");

/** A balance is at one date; a flow covers an inclusive date range. */
export const PeriodSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("instant"), date: CalendarDateSchema }),
    z.object({ kind: z.literal("duration"), start: CalendarDateSchema, end: CalendarDateSchema }),
  ])
  .refine((p) => p.kind === "instant" || p.start <= p.end, {
    message: "period end is before its start",
    path: ["end"],
  });
export type Period = z.infer<typeof PeriodSchema>;

const periodEnd = (p: Period): string => (p.kind === "instant" ? p.date : p.end);
const samePeriod = (a: Period, b: Period): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Restricted cash stays separate. Revenue, EBITDA and net loss are not cash. */
export const BALANCE_METRICS = [
  "cash_and_equivalents",
  "restricted_cash",
  "cash_including_restricted",
  "debt_principal",
  "revolver_availability",
] as const;
export const FLOW_METRICS = [
  "operating_cash_flow",
  "investing_cash_flow",
  "financing_cash_flow",
  "fx_effect_on_cash",
  "revenue",
  "net_loss",
  "adjusted_ebitda",
] as const;
export const HistoricalMetricSchema = z.enum([...BALANCE_METRICS, ...FLOW_METRICS]);
export type HistoricalMetric = z.infer<typeof HistoricalMetricSchema>;

const isBalance = (m: HistoricalMetric): boolean =>
  (BALANCE_METRICS as readonly string[]).includes(m);
const NONNEGATIVE: readonly HistoricalMetric[] = [
  "cash_and_equivalents",
  "restricted_cash",
  "cash_including_restricted",
  "debt_principal",
  "revolver_availability",
];

/** Balances are at an instant; flows cover a duration. Shared by facts and predictions. */
function checkMetricPeriod(ctx: z.RefinementCtx, metric: HistoricalMetric, period: Period): void {
  const wantInstant = isBalance(metric);
  if (wantInstant !== (period.kind === "instant"))
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["period"],
      message: wantInstant
        ? "a balance metric needs an instant period"
        : "a flow metric needs a duration period",
    });
}

/** A disclosure as published. An amendment is a new source; it never replaces the original. */
export const HistoricalSourceSchema = z.object({
  id: IdSchema,
  title: z.string().min(1),
  url: z.string().url(),
  /** SEC accession number or similar stable registry ID, when one exists. */
  accession: z.string().min(1).optional(),
  /** Publication or EDGAR acceptance instant. Required: unknown availability fails closed. */
  publishedAt: TimestampSchema,
  /** IANA zone the publisher used, for example "America/New_York". */
  timezone: z.string().min(1),
  /** Financial period the document reports on. Never used for availability. */
  period: PeriodSchema.optional(),
  retrievedOn: CalendarDateSchema,
  contentHash: Sha256Schema,
  amends: IdSchema.optional(),
});
export type HistoricalSource = z.infer<typeof HistoricalSourceSchema>;

const FactBase = {
  id: IdSchema,
  metric: HistoricalMetricSchema,
  period: PeriodSchema,
  currency: CurrencySchema,
  cents: SafeCentsSchema,
  /**
   * Earliest instant this value was knowable. Reported: the source's publishedAt.
   * Derived: the latest availableAt of every input, checked by HistoricalCaseSchema.
   */
  availableAt: TimestampSchema,
};

export const HistoricalFactSchema = z
  .discriminatedUnion("kind", [
    z.object({
      ...FactBase,
      kind: z.literal("reported"),
      sourceId: IdSchema,
      /** Section/table/line locator inside the source. */
      locator: z.string().min(1),
      /** Scale the source printed in, before normalizing to cents. */
      reportedScale: z.enum(["ones", "thousands", "millions"]),
    }),
    z.object({
      ...FactBase,
      kind: z.literal("derived"),
      derivedFrom: z.array(IdSchema).min(1),
      /** Plain formula, for example "nine months YTD minus six months YTD". */
      derivation: z.string().min(1),
    }),
  ])
  .superRefine((fact, ctx) => {
    checkMetricPeriod(ctx, fact.metric, fact.period);
    if (NONNEGATIVE.includes(fact.metric) && fact.cents < 0)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cents"],
        message: "balance cannot be negative",
      });
  });
export type HistoricalFact = z.infer<typeof HistoricalFactSchema>;

const RangeSchema = z
  .object({
    unit: z.enum(["cents", "days", "basis_points"]),
    low: SafeCentsSchema,
    high: SafeCentsSchema,
  })
  .refine((r) => r.low <= r.high, { message: "low is above high", path: ["high"] });

const CostRangeSchema = z
  .object({
    unit: z.literal("cents"),
    low: SafeCentsSchema.nonnegative(),
    high: SafeCentsSchema.nonnegative(),
  })
  .refine((r) => r.low <= r.high, { message: "low is above high", path: ["high"] });

/**
 * Not evidence. synthetic: invented operational detail; counterfactual: a decision
 * not taken; hindsight: uses information published after the cutoff.
 */
export const HistoricalAssumptionSchema = z.object({
  id: IdSchema,
  label: z.enum(["synthetic", "counterfactual", "hindsight"]),
  description: z.string().min(1),
  /** Facts the value rests on. Non-hindsight basis must be available at the run cutoff. */
  basisFactIds: z.array(IdSchema),
  value: RangeSchema,
  effectiveFrom: CalendarDateSchema,
  /** Upfront cash cost, as a nonnegative cents range. */
  oneTimeCost: CostRangeSchema.optional(),
  /** Delay between decision and first benefit. */
  benefitLagDays: z.number().int().nonnegative().optional(),
  /** Assumptions listed earlier in the case; this keeps dependencies acyclic. */
  dependsOn: z.array(IdSchema).default([]),
  feasibleAtCutoff: z.enum(["yes", "no", "unknown"]),
  /** Chosen or tuned after a reveal; forces the run to be labelled post-hoc. */
  selectedAfterReveal: z.boolean(),
});
export type HistoricalAssumption = z.infer<typeof HistoricalAssumptionSchema>;

/** Reviewed local evidence bundle for one company. Holds later disclosures too; runs filter by cutoff. */
export const HistoricalCaseSchema = z
  .object({
    id: IdSchema,
    companyName: z.string().min(1),
    /** synthetic_fixture: invented test data, never shown as a real company record. */
    provenance: z.enum(["evidence", "synthetic_fixture"]),
    currency: CurrencySchema,
    sources: z.array(HistoricalSourceSchema),
    /** Inputs before the facts derived from them; this keeps derivation acyclic. */
    facts: z.array(HistoricalFactSchema),
    assumptions: z.array(HistoricalAssumptionSchema),
  })
  .superRefine((c, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    flagRepeats(
      ctx,
      c.sources,
      (s) => s.id,
      (i) => ["sources", i, "id"],
      "duplicate source id",
    );
    flagRepeats(
      ctx,
      c.facts,
      (f) => f.id,
      (i) => ["facts", i, "id"],
      "duplicate fact id",
    );
    flagRepeats(
      ctx,
      c.assumptions,
      (a) => a.id,
      (i) => ["assumptions", i, "id"],
      "duplicate assumption id",
    );

    const sources = new Map(c.sources.map((s) => [s.id, s]));
    for (const [i, s] of c.sources.entries()) {
      if (s.amends === undefined) continue;
      const original = sources.get(s.amends);
      if (!original) issue(["sources", i, "amends"], "amended source not found");
      else if (ms(s.publishedAt) <= ms(original.publishedAt))
        issue(["sources", i, "publishedAt"], "an amendment must be published after the original");
    }

    const earlier = new Map<string, HistoricalFact>();
    for (const [i, f] of c.facts.entries()) {
      if (f.currency !== c.currency)
        issue(["facts", i, "currency"], "fact currency differs from the case");
      if (f.kind === "reported") {
        const source = sources.get(f.sourceId);
        if (!source) issue(["facts", i, "sourceId"], "source not found");
        else if (f.availableAt !== source.publishedAt)
          issue(
            ["facts", i, "availableAt"],
            "a reported fact is available when its source is published",
          );
      } else {
        const inputs = f.derivedFrom.map((id) => earlier.get(id));
        if (inputs.some((x) => x === undefined))
          issue(["facts", i, "derivedFrom"], "derived inputs must be listed earlier");
        const latest = Math.max(...inputs.flatMap((x) => (x ? [ms(x.availableAt)] : [])));
        if (inputs.every((x) => x) && ms(f.availableAt) !== latest)
          issue(
            ["facts", i, "availableAt"],
            "a derived fact inherits the latest input availability",
          );
      }
      earlier.set(f.id, f);
    }

    const factIds = new Set(c.facts.map((f) => f.id));
    const earlierAssumptions = new Set<string>();
    for (const [i, a] of c.assumptions.entries()) {
      if (a.basisFactIds.some((id) => !factIds.has(id)))
        issue(["assumptions", i, "basisFactIds"], "basis fact not found");
      if (a.dependsOn.some((id) => !earlierAssumptions.has(id)))
        issue(["assumptions", i, "dependsOn"], "dependencies must be listed earlier");
      earlierAssumptions.add(a.id);
    }
  });
export type HistoricalCase = z.infer<typeof HistoricalCaseSchema>;

/**
 * nowcast: the unobserved interval from the stale origin balance to the cutoff,
 * identical across baseline and alternative. forecast: periods ending after the cutoff.
 */
export const HistoricalPredictionSchema = z
  .object({
    id: IdSchema,
    kind: z.enum(["nowcast", "forecast"]),
    metric: HistoricalMetricSchema,
    period: PeriodSchema,
    currency: CurrencySchema,
    cents: SafeCentsSchema,
    /** Labelled assumption range, not a statistical interval. */
    range: z.object({ low: SafeCentsSchema, high: SafeCentsSchema }).optional(),
  })
  .superRefine((p, ctx) => {
    checkMetricPeriod(ctx, p.metric, p.period);
    if (p.range && !(p.range.low <= p.cents && p.cents <= p.range.high))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["range"],
        message: "range must contain the point value",
      });
  });
export type HistoricalPrediction = z.infer<typeof HistoricalPredictionSchema>;

/** analyst thresholds are labelled; disclosed_term thresholds cite input sources. */
export const HistoricalRiskRuleSchema = z.object({
  id: IdSchema,
  metric: HistoricalMetricSchema,
  breachWhen: z.enum(["below", "above"]),
  thresholdCents: SafeCentsSchema,
  basis: z.enum(["disclosed_term", "analyst"]),
  sourceIds: z.array(IdSchema),
});
export type HistoricalRiskRule = z.infer<typeof HistoricalRiskRuleSchema>;

/** Immutable once saved. Reveal adds comparisons; it never edits a run. */
export const HistoricalRunSchema = z
  .object({
    id: IdSchema,
    caseId: IdSchema,
    /** Runtime save instant, unrelated to the historical dates. */
    createdAt: TimestampSchema,
    knowledgeCutoff: TimestampSchema,
    /** Date of the latest reported balance; usually before the cutoff. */
    originBalanceDate: CalendarDateSchema,
    inputs: z.object({
      sourceIds: z.array(IdSchema),
      factIds: z.array(IdSchema).min(1),
      assumptionIds: z.array(IdSchema),
    }),
    inputHash: Sha256Schema,
    method: z.object({ id: IdSchema, version: z.string().min(1) }),
    predictions: z.array(HistoricalPredictionSchema).min(1),
    riskRules: z.array(HistoricalRiskRuleSchema),
    branch: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("baseline") }),
      z.object({
        kind: z.literal("alternative"),
        baselineRunId: IdSchema,
        decisionAssumptionIds: z.array(IdSchema).min(1),
        postHoc: z.boolean(),
      }),
    ]),
  })
  .superRefine((run, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    flagRepeats(
      ctx,
      run.predictions,
      (p) => p.id,
      (i) => ["predictions", i, "id"],
      "duplicate prediction id",
    );
    const cutoffDate = localDate(run.knowledgeCutoff);
    if (run.originBalanceDate > cutoffDate)
      issue(["originBalanceDate"], "origin balance date is after the cutoff");
    for (const [i, p] of run.predictions.entries()) {
      const end = periodEnd(p.period);
      if (p.kind === "nowcast" && !(run.originBalanceDate < end && end <= cutoffDate))
        issue(
          ["predictions", i, "period"],
          "a nowcast ends after the origin balance and by the cutoff",
        );
      if (p.kind === "forecast" && end <= cutoffDate)
        issue(["predictions", i, "period"], "a forecast period must end after the cutoff");
    }
  });
export type HistoricalRun = z.infer<typeof HistoricalRunSchema>;

function checkRun(ctx: z.RefinementCtx, c: HistoricalCase, run: HistoricalRun, path: string): void {
  const issue = (sub: (string | number)[], message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path, ...sub], message });
  if (run.caseId !== c.id) issue(["caseId"], "run belongs to another case");
  const cutoff = ms(run.knowledgeCutoff);
  const sources = new Map(c.sources.map((s) => [s.id, s]));
  const facts = new Map(c.facts.map((f) => [f.id, f]));
  const assumptions = new Map(c.assumptions.map((a) => [a.id, a]));
  const inputSources = new Set(run.inputs.sourceIds);
  const inputFacts = new Set(run.inputs.factIds);
  const inputAssumptions = new Set(run.inputs.assumptionIds);

  for (const [i, id] of run.inputs.sourceIds.entries()) {
    const s = sources.get(id);
    if (!s) issue(["inputs", "sourceIds", i], "source not found");
    else if (ms(s.publishedAt) > cutoff)
      issue(["inputs", "sourceIds", i], "source published after the cutoff");
  }
  for (const [i, id] of run.inputs.factIds.entries()) {
    const f = facts.get(id);
    if (!f) issue(["inputs", "factIds", i], "fact not found");
    else if (ms(f.availableAt) > cutoff)
      issue(["inputs", "factIds", i], "fact available after the cutoff");
    else if (f.kind === "reported" && !inputSources.has(f.sourceId))
      issue(["inputs", "factIds", i], "fact source is not a run input");
    else if (f.kind === "derived" && f.derivedFrom.some((d) => !inputFacts.has(d)))
      issue(["inputs", "factIds", i], "derived fact inputs are not run inputs");
  }
  const hasOrigin = run.inputs.factIds.some((id) => {
    const f = facts.get(id);
    return (
      f?.period.kind === "instant" && f.period.date === run.originBalanceDate && isBalance(f.metric)
    );
  });
  if (!hasOrigin) issue(["originBalanceDate"], "no input balance fact at the origin balance date");

  let hindsight = false;
  for (const [i, id] of run.inputs.assumptionIds.entries()) {
    const a = assumptions.get(id);
    if (!a) {
      issue(["inputs", "assumptionIds", i], "assumption not found");
      continue;
    }
    // Post-reveal selection marks the run post-hoc; only a hindsight label may rest on later facts.
    if (a.label === "hindsight" || a.selectedAfterReveal) hindsight = true;
    if (a.label !== "hindsight" && a.basisFactIds.some((f) => !inputFacts.has(f)))
      issue(
        ["inputs", "assumptionIds", i],
        "assumption basis must be run input facts available at the cutoff",
      );
    // Each input's dependencies are inputs too, so the closure is validated as a whole.
    if (a.dependsOn.some((d) => !inputAssumptions.has(d)))
      issue(["inputs", "assumptionIds", i], "assumption dependencies must be run inputs");
  }
  if (run.branch.kind === "alternative") {
    if (run.branch.decisionAssumptionIds.some((id) => !run.inputs.assumptionIds.includes(id)))
      issue(["branch", "decisionAssumptionIds"], "decision assumptions must be run inputs");
    if (hindsight && !run.branch.postHoc)
      issue(["branch", "postHoc"], "hindsight or post-reveal choices are post-hoc");
  } else if (hindsight)
    issue(["inputs", "assumptionIds"], "a baseline cannot use hindsight assumptions");

  for (const [i, p] of run.predictions.entries())
    if (p.currency !== c.currency)
      issue(["predictions", i, "currency"], "prediction currency differs from the case");
  for (const [i, r] of run.riskRules.entries()) {
    if (r.sourceIds.some((id) => !inputSources.has(id)))
      issue(["riskRules", i, "sourceIds"], "rule sources must be run inputs");
    if (r.basis === "disclosed_term" && r.sourceIds.length === 0)
      issue(["riskRules", i, "sourceIds"], "a disclosed term needs a source");
  }
}

/**
 * Save-time boundary: the run reads only evidence available at its cutoff. An
 * alternative must share its baseline's cutoff, origin and pre-decision nowcast.
 */
export const HistoricalRunContextSchema = z
  .object({
    case: HistoricalCaseSchema,
    run: HistoricalRunSchema,
    baseline: HistoricalRunSchema.optional(),
  })
  .superRefine(({ case: c, run, baseline }, ctx) => {
    checkRun(ctx, c, run, "run");
    if (run.branch.kind !== "alternative") return;
    const issue = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["baseline"], message });
    if (!baseline || baseline.id !== run.branch.baselineRunId)
      return issue("alternative needs its baseline run");
    if (baseline.branch.kind !== "baseline") return issue("baseline run is itself an alternative");
    checkRun(ctx, c, baseline, "baseline");
    if (
      baseline.knowledgeCutoff !== run.knowledgeCutoff ||
      baseline.originBalanceDate !== run.originBalanceDate
    )
      issue("alternative must share the baseline cutoff and origin");
    const nowcast = (r: HistoricalRun) =>
      JSON.stringify(r.predictions.filter((p) => p.kind === "nowcast"));
    if (nowcast(baseline) !== nowcast(run)) issue("alternative must share the baseline nowcast");
  });
export type HistoricalRunContext = z.infer<typeof HistoricalRunContextSchema>;

/** observed minus predicted. Unscored comparisons carry no numbers. */
export const HistoricalComparisonSchema = z.discriminatedUnion("status", [
  z.object({
    id: IdSchema,
    runId: IdSchema,
    predictionId: IdSchema,
    status: z.literal("scored"),
    observationFactId: IdSchema,
    predictedCents: SafeCentsSchema,
    observedCents: SafeCentsSchema,
    errorCents: SafeCentsSchema,
    absErrorCents: SafeCentsSchema.nonnegative(),
    ruleOutcomes: z.array(
      z.object({ ruleId: IdSchema, predictedBreach: z.boolean(), observedBreach: z.boolean() }),
    ),
  }),
  z.object({
    id: IdSchema,
    runId: IdSchema,
    predictionId: IdSchema,
    status: z.literal("unscored"),
    reason: z.enum(["not_yet_published", "no_observation", "incomparable_scope"]),
  }),
]);
export type HistoricalComparison = z.infer<typeof HistoricalComparisonSchema>;

/**
 * Reveal-time boundary: only facts published by revealedThrough and after the run
 * cutoff can score it, matched on metric, period and currency.
 */
export const HistoricalComparisonContextSchema = z
  .object({
    case: HistoricalCaseSchema,
    run: HistoricalRunSchema,
    revealedThrough: TimestampSchema,
    comparisons: z.array(HistoricalComparisonSchema),
  })
  .superRefine(({ case: c, run, revealedThrough, comparisons }, ctx) => {
    const issue = (i: number, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["comparisons", i], message });
    if (run.caseId !== c.id)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["run", "caseId"],
        message: "run belongs to another case",
      });
    if (ms(revealedThrough) <= ms(run.knowledgeCutoff))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["revealedThrough"],
        message: "reveal must be after the cutoff",
      });
    flagRepeats(
      ctx,
      comparisons,
      (x) => x.predictionId,
      (i) => ["comparisons", i, "predictionId"],
      "prediction compared twice",
    );
    const facts = new Map(c.facts.map((f) => [f.id, f]));
    const predictions = new Map(run.predictions.map((p) => [p.id, p]));
    const rules = new Map(run.riskRules.map((r) => [r.id, r]));
    for (const [i, x] of comparisons.entries()) {
      const p = predictions.get(x.predictionId);
      if (x.runId !== run.id || !p) {
        issue(i, "prediction not in this run");
        continue;
      }
      if (x.status === "unscored") continue;
      const f = facts.get(x.observationFactId);
      if (!f) {
        issue(i, "observation fact not found");
        continue;
      }
      if (ms(f.availableAt) <= ms(run.knowledgeCutoff))
        issue(i, "observation was available at the cutoff");
      if (ms(f.availableAt) > ms(revealedThrough)) issue(i, "observation is not revealed yet");
      if (f.metric !== p.metric || f.currency !== p.currency || !samePeriod(f.period, p.period))
        issue(i, "observation does not match the prediction metric, period and currency");
      if (x.predictedCents !== p.cents || x.observedCents !== f.cents)
        issue(i, "values differ from the run and fact");
      if (
        x.errorCents !== x.observedCents - x.predictedCents ||
        x.absErrorCents !== Math.abs(x.errorCents)
      )
        issue(i, "error must be observed minus predicted");
      for (const o of x.ruleOutcomes) {
        const r = rules.get(o.ruleId);
        if (!r || r.metric !== p.metric) issue(i, "rule not in this run for this metric");
        else {
          const breach = (v: number) =>
            r.breachWhen === "below" ? v < r.thresholdCents : v > r.thresholdCents;
          if (
            o.predictedBreach !== breach(x.predictedCents) ||
            o.observedBreach !== breach(x.observedCents)
          )
            issue(i, "rule outcome does not follow the threshold");
        }
      }
    }
  });
export type HistoricalComparisonContext = z.infer<typeof HistoricalComparisonContextSchema>;

// ---------- Optional activity feed (emitted by H2d; contract only here) ----------

/** Real app operations only. agent/tool kinds exist for a future product lifecycle, not development workers. */
export const ActivityKindSchema = z.enum([
  "source_validated",
  "run_saved",
  "disclosure_revealed",
  "alternative_computed",
  "agent_task",
  "tool_registered",
  "tool_invoked",
]);
const LONG_RUNNING: readonly z.infer<typeof ActivityKindSchema>[] = ["agent_task", "tool_invoked"];

export const ActivityEventSchema = z
  .object({
    /** Stable and idempotent: a retried operation reuses it. */
    id: IdSchema,
    /** Strictly increasing per feed; the UI orders and dedupes by it. */
    sequence: z.number().int().nonnegative(),
    /** Runtime instant, never a historical publication or financial date. */
    occurredAt: TimestampSchema,
    caseId: IdSchema,
    runId: IdSchema.optional(),
    kind: ActivityKindSchema,
    /** Instant operations emit only succeeded or failed; no invented running stage. */
    status: z.enum(["started", "succeeded", "failed"]),
    entity: z.object({
      kind: z.enum(["source", "run", "comparison", "agent_task", "tool"]),
      id: IdSchema,
    }),
    /** Plain label; subject to the same reveal filter as payloads. */
    label: z.string().min(1),
    /** Source/fact IDs already visible to the viewer. */
    evidenceIds: z.array(IdSchema).default([]),
    outputId: IdSchema.optional(),
  })
  .refine((e) => e.status !== "started" || LONG_RUNNING.includes(e.kind), {
    message: "only long-running operations have a started event",
    path: ["status"],
  });
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;
