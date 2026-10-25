import { z } from "zod";
import { CalendarDateSchema, SafeCentsSchema, flagRepeats } from "./checks";
import { IdSchema } from "./core";
import {
  BALANCE_METRICS,
  CurrencySchema,
  HistoricalCaseSchema,
  HistoricalMetricSchema,
  PeriodSchema,
  Sha256Schema,
  TimestampSchema,
} from "./historical";

/**
 * Learning loop L0: source packages, mapping and reconciliation receipts, company
 * knowledge snapshots, scoped feedback rules and sealed quarterly evaluation shapes.
 * Additive; existing historical and operational learning contracts are unchanged.
 * Schemas check shape and internal consistency only. Whether a hash matches bytes, a
 * record matches its source, or a rule applies to a task is the engine's/backend's job.
 * Supported v1 boundary: SEC companyfacts + submissions JSON, consolidated US-GAAP USD.
 */

type Path = (string | number)[];
const ms = (t: string): number => Date.parse(t);
const latest = (...ts: string[]): number => Math.max(...ts.map(ms));
const NonBlank = z.string().refine((s) => s.trim().length > 0, "must not be blank");
const issuer =
  (ctx: z.RefinementCtx) =>
  (path: Path, message: string): void =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

/** Exact semantic version. Rejects "latest", blanks and placeholders. */
export const SemverSchema = z.string().regex(/^\d+\.\d+\.\d+$/, "expected an exact x.y.z version");
/** Full 40-hex Git object ID. */
export const GitObjectIdSchema = z.string().regex(/^[0-9a-f]{40}$/, "expected a full git hash");
/** SEC CIK, zero-padded to ten digits. */
export const CikSchema = z.string().regex(/^\d{10}$/, "expected a ten-digit CIK");
/** SEC accession number, for example "0001234567-23-000001". */
export const AccessionSchema = z
  .string()
  .regex(/^\d{10}-\d{2}-\d{6}$/, "expected an accession like 0001234567-23-000001");

/** A decimal exactly as written in the source JSON. Never a re-serialized JS number. */
export const DecimalLexemeSchema = z
  .string()
  .regex(/^-?(0|[1-9]\d*)(\.\d+)?$/, "expected a plain decimal lexeme");

/**
 * Cents too large for a JS number (evaluator aggregates, differences of two safe values),
 * as a base-10 integer string. Compare and add with BigInt only.
 */
export const BigCentsStringSchema = z
  .string()
  .regex(/^(0|-?[1-9]\d*)$/, "expected a base-10 integer string of cents");

/**
 * Exact cents for a base-dollar decimal lexeme, or undefined when it has sub-cent digits
 * or is outside the safe integer range. SEC USD values are dollars, not table thousands.
 */
export function dollarLexemeToCents(lexeme: string): number | undefined {
  if (!DecimalLexemeSchema.safeParse(lexeme).success) return undefined;
  const [whole = "", frac = ""] = lexeme.replace("-", "").split(".");
  if (frac.replace(/0+$/, "").length > 2) return undefined;
  const cents =
    BigInt(whole + frac.padEnd(2, "0").slice(0, 2)) * (lexeme.startsWith("-") ? -1n : 1n);
  return cents >= BigInt(Number.MIN_SAFE_INTEGER) && cents <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(cents)
    : undefined;
}

// ---------- L1 source package ----------

export const FilingFormSchema = z.enum(["10-Q", "10-K", "10-Q/A", "10-K/A"]);

/** One filing. Acceptance is a verified instant; a date-only filing is not eligible. */
export const SourceAccessionSchema = z
  .object({
    accession: AccessionSchema,
    form: FilingFormSchema,
    acceptedAt: TimestampSchema,
    /** Fiscal period the filing reports on. Never used for availability. */
    reportPeriod: PeriodSchema,
    /** Original accession this amendment amends. Amendments are separate dated sources. */
    amends: AccessionSchema.optional(),
  })
  .strict();

/** One raw companyfacts record, kept with its pointer and raw lexeme. */
export const SourceRecordSchema = z
  .object({
    id: IdSchema,
    accession: AccessionSchema,
    taxonomy: NonBlank,
    tag: NonBlank,
    /** Unit exactly as written ("USD", "shares"). Unknown units become mapping questions. */
    unit: NonBlank,
    /** RFC 6901 JSON pointer into the raw payload. */
    pointer: z.string().regex(/^(\/[^/]*)+$/, "expected a JSON pointer"),
    rawValue: DecimalLexemeSchema,
    period: PeriodSchema,
  })
  .strict();
export type SourceRecord = z.infer<typeof SourceRecordSchema>;

export const SourcePackageSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: IdSchema,
    format: z.literal("sec_companyfacts_v1"),
    /** synthetic_fixture: invented test data, never shown as a real company record. */
    provenance: z.enum(["evidence", "synthetic_fixture"]),
    company: z.object({ cik: CikSchema, name: NonBlank }).strict(),
    originalUrl: z.string().url(),
    retrievedAt: TimestampSchema,
    /** SHA-256 of the raw companyfacts and submissions bytes. */
    rawContentHash: Sha256Schema,
    submissionsContentHash: Sha256Schema,
    accessions: z.array(SourceAccessionSchema).min(1),
    records: z.array(SourceRecordSchema),
  })
  .strict()
  .superRefine((pkg, ctx) => {
    const issue = issuer(ctx);
    flagRepeats(
      ctx,
      pkg.accessions,
      (a) => a.accession,
      (i) => ["accessions", i, "accession"],
      "duplicate accession",
    );
    flagRepeats(
      ctx,
      pkg.records,
      (r) => r.id,
      (i) => ["records", i, "id"],
      "duplicate record id",
    );
    const filings = new Map(pkg.accessions.map((a) => [a.accession, a]));
    for (const [i, a] of pkg.accessions.entries()) {
      if (ms(a.acceptedAt) > ms(pkg.retrievedAt))
        issue(["accessions", i, "acceptedAt"], "accepted after the package was retrieved");
      const amended = a.form.endsWith("/A");
      if (amended !== (a.amends !== undefined))
        issue(
          ["accessions", i, "amends"],
          "an amendment form needs amends, and only amendments have it",
        );
      if (a.amends === undefined) continue;
      const original = filings.get(a.amends);
      if (!original) issue(["accessions", i, "amends"], "amended accession not in package");
      else if (ms(a.acceptedAt) <= ms(original.acceptedAt))
        issue(["accessions", i, "acceptedAt"], "an amendment must be accepted after the original");
    }
    for (const [i, r] of pkg.records.entries())
      if (!filings.has(r.accession))
        issue(["records", i, "accession"], "record accession not in package");
  });
export type SourcePackage = z.infer<typeof SourcePackageSchema>;

// ---------- Observation identity and mapping ----------

/** What a value means. Two candidates are comparable only when their keys are equal. */
export const ObservationKeySchema = z
  .object({
    cik: CikSchema,
    scope: z.literal("consolidated"),
    metric: HistoricalMetricSchema,
    /** Versioned dictionary definition, for example "us-gaap:CashAndCashEquivalentsAtCarryingValue@1". */
    definition: NonBlank,
    currency: CurrencySchema,
    period: PeriodSchema,
  })
  .strict()
  .superRefine((k, ctx) => {
    const balance = (BALANCE_METRICS as readonly string[]).includes(k.metric);
    if (balance !== (k.period.kind === "instant"))
      issuer(ctx)(
        ["period"],
        balance
          ? "a balance metric needs an instant period"
          : "a flow metric needs a duration period",
      );
  });
export type ObservationKey = z.infer<typeof ObservationKeySchema>;

/** Stable string form for equality and indexing. Field order is fixed here, not by input. */
export const observationKeyId = (k: ObservationKey): string =>
  JSON.stringify([
    k.cik,
    k.scope,
    k.metric,
    k.definition,
    k.currency,
    k.period.kind === "instant" ? [k.period.date] : [k.period.start, k.period.end],
  ]);

/** Finite transform allowlist. No generated or executable code. */
export const MappingTransformSchema = z.enum([
  "usd_dollars_to_cents",
  "negated_usd_dollars_to_cents",
]);

export const MappingReceiptSchema = z
  .object({
    id: IdSchema,
    sourcePackageId: IdSchema,
    sourceHash: Sha256Schema,
    recordId: IdSchema,
    pointer: SourceRecordSchema.shape.pointer,
    tag: NonBlank,
    unit: NonBlank,
    key: ObservationKeySchema,
    transform: MappingTransformSchema,
    status: z.enum(["proposed", "validated", "rejected", "needs_input"]),
    mapperVersion: SemverSchema,
    dictionaryVersion: SemverSchema,
    validationErrors: z.array(NonBlank),
    /** Plain question for the user when status is needs_input. */
    question: NonBlank.optional(),
  })
  .strict()
  .superRefine((m, ctx) => {
    const issue = issuer(ctx);
    const failed = m.status === "rejected" || m.status === "needs_input";
    if (failed !== m.validationErrors.length > 0)
      issue(["validationErrors"], "rejected or needs_input needs errors; other statuses have none");
    if ((m.status === "needs_input") !== (m.question !== undefined))
      issue(["question"], "needs_input needs a question, and only needs_input has one");
    if (m.status === "validated" && m.unit !== m.key.currency)
      issue(["unit"], "a validated money mapping needs the unit to equal the key currency");
  });
export type MappingReceipt = z.infer<typeof MappingReceiptSchema>;

/** A normalized candidate value. cents must equal the raw lexeme exactly. */
export const NormalizedObservationSchema = z
  .object({
    id: IdSchema,
    key: ObservationKeySchema,
    sourcePackageId: IdSchema,
    recordId: IdSchema,
    accession: AccessionSchema,
    mappingReceiptId: IdSchema,
    transform: MappingTransformSchema,
    rawValue: DecimalLexemeSchema,
    cents: SafeCentsSchema,
    /** Source acceptance instant. Separate from the accounting period and retrieval time. */
    availableAt: TimestampSchema,
  })
  .strict()
  .superRefine((o, ctx) => {
    const exact = dollarLexemeToCents(o.rawValue);
    const want =
      exact === undefined
        ? undefined
        : o.transform === "negated_usd_dollars_to_cents"
          ? -exact
          : exact;
    if (want === undefined) issuer(ctx)(["rawValue"], "raw value is not exact safe cents");
    else if (want !== o.cents)
      issuer(ctx)(["cents"], "cents do not equal the raw value under the transform");
  });
export type NormalizedObservation = z.infer<typeof NormalizedObservationSchema>;

// ---------- L2 reconciliation ----------

export const ReconciliationClassSchema = z.enum([
  "single",
  "corroborated",
  "duplicate",
  "rounding_difference",
  "conflict",
]);

/**
 * deterministic_method: sealed source-only parsing/dedup/original-accession selection;
 * eligible at source availability. authority_rule/user_resolution: a later decision,
 * eligible at max(source availability, recordedAt, effectiveFrom). Never a fake fact.
 */
const AuthoritySchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("deterministic_method"), methodId: IdSchema, version: SemverSchema })
    .strict(),
  z.object({ kind: z.literal("authority_rule"), ruleVersionId: IdSchema }).strict(),
  z.object({ kind: z.literal("user_resolution"), userId: IdSchema }).strict(),
]);

export const ReconciliationReceiptSchema = z
  .object({
    id: IdSchema,
    key: ObservationKeySchema,
    /** Every candidate survives, selected or not. */
    candidateIds: z.array(IdSchema).min(1),
    classification: ReconciliationClassSchema,
    outcome: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("selected"),
          selectedIds: z.array(IdSchema).min(1),
          authority: AuthoritySchema,
        })
        .strict(),
      z.object({ kind: z.literal("blocked"), reason: NonBlank }).strict(),
    ]),
    rationale: NonBlank,
    /** Latest availability among the candidates. */
    sourceAvailableAt: TimestampSchema,
    /** Decision or computation instant (computedAt for deterministic methods). */
    recordedAt: TimestampSchema,
    effectiveFrom: TimestampSchema,
    eligibleAt: TimestampSchema,
  })
  .strict()
  .superRefine((r, ctx) => {
    const issue = issuer(ctx);
    flagRepeats(
      ctx,
      r.candidateIds,
      (id) => id,
      (i) => ["candidateIds", i],
      "duplicate candidate id",
    );
    if (r.outcome.kind === "blocked") {
      if (ms(r.eligibleAt) !== ms(r.sourceAvailableAt))
        issue(["eligibleAt"], "a block is eligible at source availability");
      return;
    }
    const { selectedIds, authority } = r.outcome;
    for (const [i, id] of selectedIds.entries())
      if (!r.candidateIds.includes(id))
        issue(["outcome", "selectedIds", i], "selected id is not a candidate");
    if (r.classification === "conflict" && authority.kind === "deterministic_method")
      issue(
        ["outcome", "authority"],
        "a genuine conflict needs an authority rule or user resolution",
      );
    const want =
      authority.kind === "deterministic_method"
        ? ms(r.sourceAvailableAt)
        : latest(r.sourceAvailableAt, r.recordedAt, r.effectiveFrom);
    if (ms(r.eligibleAt) !== want)
      issue(
        ["eligibleAt"],
        authority.kind === "deterministic_method"
          ? "a deterministic method is eligible at source availability"
          : "a decision is eligible at max(source availability, recordedAt, effectiveFrom)",
      );
  });
export type ReconciliationReceipt = z.infer<typeof ReconciliationReceiptSchema>;

// ---------- L3 feedback and scoped rules ----------

/** Finite rule actions. No code, no money. */
export const RuleActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("mapping_override"),
      tag: NonBlank,
      unit: NonBlank,
      metric: HistoricalMetricSchema,
      definition: NonBlank,
    })
    .strict(),
  z
    .object({
      kind: z.literal("authority_preference"),
      metric: HistoricalMetricSchema,
      prefer: z.enum(["original_filing", "latest_amendment"]),
    })
    .strict(),
  z
    .object({ kind: z.literal("method_selection"), methodId: IdSchema, version: SemverSchema })
    .strict(),
]);
export type RuleAction = z.infer<typeof RuleActionSchema>;

/** Raw suggestion from a person. Never applied directly. */
export const FeedbackRecordSchema = z
  .object({
    id: IdSchema,
    cik: CikSchema,
    actorId: IdSchema,
    text: NonBlank,
    proposedAction: RuleActionSchema.optional(),
    recordedAt: TimestampSchema,
  })
  .strict();
export type FeedbackRecord = z.infer<typeof FeedbackRecordSchema>;

/** Default scope is one company and source signature. Global needs a separate user choice. */
export const RuleScopeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("company"),
      cik: CikSchema,
      schemaVersion: z.literal(1),
      sourceSignature: NonBlank,
    })
    .strict(),
  z.object({ kind: z.literal("global"), userChoiceId: IdSchema }).strict(),
]);

export const LearnedRuleVersionSchema = z
  .object({
    id: IdSchema,
    ruleId: IdSchema,
    version: z.number().int().positive(),
    feedbackId: IdSchema,
    scope: RuleScopeSchema,
    action: RuleActionSchema,
    rationale: NonBlank,
    evidenceRefs: z.array(NonBlank).min(1),
    /** revoked is a NEW record naming what it revokes; old versions are never edited. */
    status: z.enum(["accepted", "rejected", "revoked"]),
    supersedes: IdSchema.optional(),
    revokes: IdSchema.optional(),
    validatorVersion: SemverSchema,
    recordedAt: TimestampSchema,
    effectiveFrom: TimestampSchema,
  })
  .strict()
  .superRefine((r, ctx) => {
    const issue = issuer(ctx);
    if ((r.status === "revoked") !== (r.revokes !== undefined))
      issue(["revokes"], "a revoked record names what it revokes, and only it does");
    if (r.supersedes !== undefined && r.revokes !== undefined)
      issue(["supersedes"], "a record supersedes or revokes, not both");
    if (ms(r.effectiveFrom) < ms(r.recordedAt))
      issue(["effectiveFrom"], "a rule cannot take effect before it was recorded (no backdating)");
  });
export type LearnedRuleVersion = z.infer<typeof LearnedRuleVersionSchema>;

export type RuleTask = { cik: string; schemaVersion: 1; sourceSignature: string; cutoff: string };
export type RuleEligibility =
  | { eligible: true }
  | { eligible: false; reason: "not_accepted" | "out_of_scope" | "after_cutoff" };

/** Accepted, in scope, and recorded and effective no later than the task's knowledge cutoff. */
export function ruleEligibility(rule: LearnedRuleVersion, task: RuleTask): RuleEligibility {
  if (rule.status !== "accepted") return { eligible: false, reason: "not_accepted" };
  const s = rule.scope;
  if (
    s.kind === "company" &&
    (s.cik !== task.cik ||
      s.schemaVersion !== task.schemaVersion ||
      s.sourceSignature !== task.sourceSignature)
  )
    return { eligible: false, reason: "out_of_scope" };
  if (latest(rule.recordedAt, rule.effectiveFrom) > ms(task.cutoff))
    return { eligible: false, reason: "after_cutoff" };
  return { eligible: true };
}

// ---------- Company knowledge snapshot ----------

/** Fact roles the quarterly bridge consumes. */
export const QuarterRoleSchema = z.enum([
  "usable_cash",
  "total_cash",
  "restricted_cash",
  "operating_ytd",
  "investing_ytd",
  "financing_ytd",
  "fx_ytd",
]);

/** A missing value is a blocked role, never zero. */
const RoleBindingSchema = z.discriminatedUnion("status", [
  z.object({ role: QuarterRoleSchema, status: z.literal("validated"), factId: IdSchema }).strict(),
  z
    .object({
      role: QuarterRoleSchema,
      status: z.literal("blocked"),
      reason: z.enum([
        "missing_input",
        "needs_input",
        "unresolved_conflict",
        "after_cutoff",
        "unsafe_value",
      ]),
      detail: NonBlank,
    })
    .strict(),
]);

export const CompanyKnowledgeSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: IdSchema,
    cik: CikSchema,
    sourceSignature: NonBlank,
    cutoff: TimestampSchema,
    sourcePackageIds: z.array(IdSchema).min(1),
    mappingReceiptIds: z.array(IdSchema),
    /** Receipts and rules used. Each must be eligible at the cutoff. */
    reconciliations: z.array(ReconciliationReceiptSchema),
    rules: z.array(LearnedRuleVersionSchema),
    /** HistoricalCase-compatible facts and assumptions; nothing invented to fill gaps. */
    case: HistoricalCaseSchema,
    roles: z.array(RoleBindingSchema).min(1),
    completeness: z.enum(["complete", "incomplete"]),
    contentHash: Sha256Schema,
  })
  .strict()
  .superRefine((s, ctx) => {
    const issue = issuer(ctx);
    const cutoff = ms(s.cutoff);
    flagRepeats(
      ctx,
      s.roles,
      (r) => r.role,
      (i) => ["roles", i, "role"],
      "duplicate role",
    );
    for (const [i, r] of s.reconciliations.entries())
      if (ms(r.eligibleAt) > cutoff)
        issue(["reconciliations", i, "eligibleAt"], "receipt is not eligible at the cutoff");
    const task = {
      cik: s.cik,
      schemaVersion: 1 as const,
      sourceSignature: s.sourceSignature,
      cutoff: s.cutoff,
    };
    for (const [i, rule] of s.rules.entries()) {
      const e = ruleEligibility(rule, task);
      if (!e.eligible) issue(["rules", i], `rule is not eligible: ${e.reason}`);
    }
    for (const [i, f] of s.case.facts.entries())
      if (ms(f.availableAt) > cutoff)
        issue(["case", "facts", i, "availableAt"], "fact is after the cutoff");
    const facts = new Set(s.case.facts.map((f) => f.id));
    for (const [i, r] of s.roles.entries())
      if (r.status === "validated" && !facts.has(r.factId))
        issue(["roles", i, "factId"], "role fact not in case");
    const blocked = s.roles.some((r) => r.status === "blocked");
    if ((s.completeness === "complete") === blocked)
      issue(["completeness"], "complete exactly when no role is blocked");
  });
export type CompanyKnowledgeSnapshot = z.infer<typeof CompanyKnowledgeSnapshotSchema>;

// ---------- Sealed quarterly evaluation ----------

export const EvaluationProtocolSchema = z
  .object({ id: IdSchema, version: SemverSchema, contentHash: Sha256Schema })
  .strict();

const QUARTER = /^(\d{4})Q([1-4])$/;
const quarterBounds = (q: string): [string, string] | undefined => {
  const m = QUARTER.exec(q);
  if (!m) return undefined;
  const n = Number(m[2]);
  const start = `${m[1]}-${String(n * 3 - 2).padStart(2, "0")}-01`;
  const end = `${m[1]}-${["03-31", "06-30", "09-30", "12-31"][n - 1]}`;
  return [start, end];
};

/** Planned pair identity. Labels stay evaluator-only: only their hashes appear here. */
export const EvaluationPairSchema = z
  .object({
    pairId: IdSchema,
    cik: CikSchema,
    targetQuarter: z.string().regex(QUARTER, "expected a calendar quarter like 2024Q1"),
    targetDate: CalendarDateSchema,
    originAccession: AccessionSchema,
    /** Must fall strictly inside the target quarter. */
    originAcceptedAt: TimestampSchema,
    originSliceHash: Sha256Schema,
    labelHash: Sha256Schema,
  })
  .strict()
  .superRefine((p, ctx) => {
    const issue = issuer(ctx);
    const bounds = quarterBounds(p.targetQuarter);
    if (!bounds) return;
    if (p.targetDate !== bounds[1]) issue(["targetDate"], "target date must be the quarter end");
    const day = p.originAcceptedAt.slice(0, 10);
    if (!(bounds[0] <= day && day < bounds[1]))
      issue(["originAcceptedAt"], "origin must fall strictly inside the target quarter");
  });

export const EvaluationManifestSchema = z
  .object({
    protocol: EvaluationProtocolSchema,
    pairs: z.array(EvaluationPairSchema).min(1),
    sourceHashes: z.array(Sha256Schema).min(1),
  })
  .strict()
  .superRefine((m, ctx) =>
    flagRepeats(
      ctx,
      m.pairs,
      (p) => p.pairId,
      (i) => ["pairs", i, "pairId"],
      "duplicate pair id",
    ),
  );
export type EvaluationManifest = z.infer<typeof EvaluationManifestSchema>;

const MethodPinSchema = z
  .object({
    methodId: IdSchema,
    version: SemverSchema,
    gitCommit: GitObjectIdSchema,
    gitTree: GitObjectIdSchema,
  })
  .strict();

/** Separate identities for protocol, dataset, sources, methods, rules and evaluator. No blanks or "latest". */
export const EvaluationSealSchema = z
  .object({
    protocol: EvaluationProtocolSchema,
    manifestHash: Sha256Schema,
    datasetHash: Sha256Schema,
    sourceHashes: z.array(Sha256Schema).min(1),
    baseline: MethodPinSchema,
    candidate: MethodPinSchema,
    ruleVersionIds: z.array(IdSchema),
    normalizerHash: Sha256Schema,
    reconcilerHash: Sha256Schema,
    evaluatorHash: Sha256Schema,
    dependencyLockHash: Sha256Schema,
    sealedAt: TimestampSchema,
  })
  .strict();
export type EvaluationSeal = z.infer<typeof EvaluationSealSchema>;

/** signed = prediction - observed (opposite of compareRun.errorCents); exact strings. */
const PairOutcomeSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("predicted"),
      predictionCents: SafeCentsSchema,
      observedCents: SafeCentsSchema,
      signedErrorCents: BigCentsStringSchema,
      absErrorCents: BigCentsStringSchema,
    })
    .strict(),
  z.object({ status: z.literal("ineligible"), reason: NonBlank }).strict(),
]);

export const EvaluationReportSchema = z
  .object({
    seal: EvaluationSealSchema,
    sealHash: Sha256Schema,
    rows: z
      .array(
        z
          .object({
            pairId: IdSchema,
            cik: CikSchema,
            baseline: PairOutcomeSchema,
            candidate: PairOutcomeSchema,
          })
          .strict(),
      )
      .min(1),
    baselineAbsErrorSum: BigCentsStringSchema,
    candidateAbsErrorSum: BigCentsStringSchema,
    pass: z.boolean(),
  })
  .strict()
  .superRefine((r, ctx) => {
    const issue = issuer(ctx);
    flagRepeats(
      ctx,
      r.rows,
      (row) => row.pairId,
      (i) => ["rows", i, "pairId"],
      "duplicate pair id",
    );
    const sums = { baseline: 0n, candidate: 0n };
    const perCompany = new Map<string, { baseline: bigint; candidate: bigint }>();
    let complete = true;
    let wins = 0;
    for (const [i, row] of r.rows.entries()) {
      const abs: Partial<Record<"baseline" | "candidate", bigint>> = {};
      for (const side of ["baseline", "candidate"] as const) {
        const o = row[side];
        if (o.status !== "predicted") {
          complete = false;
          continue;
        }
        if (!Number.isSafeInteger(o.predictionCents) || !Number.isSafeInteger(o.observedCents))
          return;
        const signed = BigInt(o.predictionCents) - BigInt(o.observedCents);
        const a = signed < 0n ? -signed : signed;
        if (o.signedErrorCents !== String(signed))
          issue(
            ["rows", i, side, "signedErrorCents"],
            "signed error is not prediction minus observed",
          );
        if (o.absErrorCents !== String(a))
          issue(["rows", i, side, "absErrorCents"], "absolute error is wrong");
        abs[side] = a;
        sums[side] += a;
      }
      if (abs.baseline !== undefined && abs.candidate !== undefined) {
        if (abs.candidate < abs.baseline) wins += 1;
        const c = perCompany.get(row.cik) ?? { baseline: 0n, candidate: 0n };
        c.baseline += abs.baseline;
        c.candidate += abs.candidate;
        perCompany.set(row.cik, c);
      }
    }
    if (r.baselineAbsErrorSum !== String(sums.baseline))
      issue(["baselineAbsErrorSum"], "baseline sum is wrong");
    if (r.candidateAbsErrorSum !== String(sums.candidate))
      issue(["candidateAbsErrorSum"], "candidate sum is wrong");
    const pass =
      complete &&
      sums.baseline > 0n &&
      100n * sums.candidate <= 95n * sums.baseline &&
      [...perCompany.values()].every((c) => c.candidate <= c.baseline) &&
      wins * 16 >= r.rows.length * 9;
    if (r.pass !== pass) issue(["pass"], "pass does not match the frozen acceptance rule");
  });
export type EvaluationReport = z.infer<typeof EvaluationReportSchema>;
