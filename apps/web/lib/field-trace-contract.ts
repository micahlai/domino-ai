/** Browser-safe, validated evidence. Reading a trace never runs an engine or provider. */
import { ChangeSchema, CompanyModelSchema, ConstraintSchema } from "@domino/contracts";
import { z } from "zod";

const cents = z.number().int();
const text = z.string();
export const FieldTraceFixKindSchema = z.enum([
  "credit_line_draw",
  "delay_bill",
  "accelerate_collections",
  "defer_hires",
]);
export const FieldTraceInputsSchema = z.object({
  company: z.object({
    id: text,
    name: text,
    profile: text,
    datasetId: text,
    datasetScenario: text.nullable(),
    datasetVersion: z.number().nullable(),
  }),
  snapshot: z.object({
    id: text,
    version: z.number(),
    asOf: text,
    companyId: text,
    cashOnHand: cents,
    restrictedCash: cents,
    recordCounts: z.record(z.number()),
  }),
  model: z.object({ id: text, version: z.number(), data: CompanyModelSchema }),
  constraints: z.array(ConstraintSchema),
  /** Absent on older receipts. Missing evidence is never replaced with today's findings. */
  coordinatorFindings: z
    .object({
      openFlags: z.number().int().nonnegative(),
      openEscalations: z.number().int().nonnegative(),
      flags: z.array(
        z.object({
          findingId: text,
          kind: z.enum([
            "duplicate",
            "conflict",
            "unusual_amount",
            "unusual_timing",
            "missing_expected",
          ]),
          severity: z.enum(["low", "medium", "high"]),
          summary: text,
          escalated: z.boolean(),
        }),
      ),
    })
    .optional(),
  sources: z.array(z.object({ kind: text, lastPull: text.nullable(), tieOut: text, step: text })),
  connections: z.array(
    z.object({
      tool: text,
      status: text,
      lastSyncAt: text.nullable(),
      counts: z.record(z.number()),
      recordsIn: z.number(),
      recordsOut: z.number(),
      checksOk: z.number(),
      checksTotal: z.number(),
    }),
  ),
  provenance: z
    .object({
      label: text,
      company: text,
      scenario: text,
      version: z.number(),
      periodStart: text,
      periodEnd: text,
      reportedAt: text,
      reported: z.array(
        z.object({
          id: text,
          label: text,
          cents,
          periodStart: text.optional(),
          periodEnd: text,
          sourceUrl: text,
          basis: z.enum(["reported", "derived-from-reported"]),
          sourceValue: text.optional(),
          sourceUnit: text.optional(),
          note: text.optional(),
        }),
      ),
      assumptions: z.array(text),
      aggregateBasis: z.record(text),
    })
    .nullable(),
});
export const FieldTraceWorkSchema = z.object({
  weeks: z.array(z.object({ weekStart: text, usable: cents })),
  baseLow: cents,
  low: cents,
  cashImpact: cents,
  cashImpactWeek: z.number(),
  lowWeek: z.number(),
  baseSurvives: z.boolean(),
  survives: z.boolean(),
  breaksAt: text.optional(),
  breaksWeek: z.number().optional(),
  brokenConstraintId: text.optional(),
});
export const FieldTraceFixSchema = z.object({
  id: text,
  label: text,
  costNote: text,
  risk: z.enum(["low", "medium", "high"]),
  gain: cents,
  clearsAllRules: z.boolean(),
  survivesWithFix: z.boolean(),
});
export const FieldTraceScenarioSchema = z.object({
  id: text,
  index: z.number(),
  agentId: text,
  title: text,
  basis: text,
  changes: z.array(ChangeSchema),
  status: z.enum(["spawned", "working", "done", "failed"]),
  work: FieldTraceWorkSchema.nullable(),
  fixes: z.array(FieldTraceFixSchema),
  error: text.nullable(),
});
export const FieldTraceCandidateSchema = z.object({
  suggestionId: text,
  scenarioId: text,
  scenarioTitle: text,
  agentId: text,
  fix: z.object({
    id: text,
    kind: FieldTraceFixKindSchema,
    label: text,
    costNote: text,
    risk: z.enum(["low", "medium", "high"]),
    changes: z.array(ChangeSchema),
  }),
  effect: z.object({
    lowPoint: cents,
    lowWeekStart: text,
    survives: z.boolean(),
    gain: cents,
    scenarioLow: cents,
    lenderMinimum: cents,
    breaksAt: text.optional(),
    brokenConstraintId: text.optional(),
  }),
  rank: z.number(),
  recommended: z.boolean(),
  recommendation: z
    .object({ text, provider: z.literal("creao"), remoteRunId: text, at: text })
    .nullable(),
});
export const FieldTraceOperationSchema = z.object({
  id: text,
  at: text,
  action: text,
  summary: text,
  refs: z.array(text),
  agentId: text.nullable(),
  agentKind: z.enum(["domino", "claude", "creao", "system"]).nullable(),
  parentAgentId: text.nullable(),
  event: z.enum(["status", "message", "tool"]).nullable(),
  status: z.enum(["spawned", "working", "done", "failed"]).nullable(),
  task: text.nullable(),
  tool: text.nullable(),
  toolCategory: text.nullable(),
  toolLabel: text.nullable(),
  fromAgentId: text.nullable(),
  toAgentId: text.nullable(),
});
export const FieldTraceProviderSchema = z.object({
  id: text,
  provider: z.enum(["claude", "creao", "apify", "crs"]),
  kind: text,
  scope: text.nullable(),
  status: z.enum(["reserved", "ok", "failed"]),
  at: text,
  attribution: z.enum(["this_run", "same_snapshot", "cached", "unknown"]),
  originRunId: text.nullable(),
  model: text.nullable(),
  remoteRunId: text.nullable(),
  detail: text.nullable(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
});
const aiSummary = z.object({
  status: z.enum(["done", "unavailable", "skipped"]),
  reason: text.optional(),
  recommendation: text.optional(),
  rationale: text.optional(),
  citedScenarios: z.array(z.number()).optional(),
  model: text.optional(),
  provider: z.enum(["claude", "creao"]).optional(),
  remoteRunId: text.optional(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  at: text,
});
const coordinator = z.object({
  status: z.enum(["done", "unavailable", "skipped", "failed"]),
  reason: text.optional(),
  summary: text.optional(),
  escalate: z.array(z.object({ findingId: text, reason: text })).optional(),
  focus: z.object({ scenarioIndex: z.number(), reason: text }).optional(),
  research: z.object({ counterparty: text, reason: text }).optional(),
  remoteRunId: text.optional(),
  at: text,
});

export const FieldTraceSchema = z.object({
  schemaVersion: z.literal(1),
  readOnly: z.literal(true),
  run: z.object({
    companyId: text,
    runId: text,
    snapshotId: text,
    snapshotVersion: z.number(),
    asOf: text,
    trigger: text,
    status: z.enum(["running", "done", "failed"]),
    startedAt: text,
    finishedAt: text.nullable(),
    summary: text.nullable(),
  }),
  selection: z.object({ scenarioId: text.nullable(), fixKind: FieldTraceFixKindSchema.nullable() }),
  evidence: z.enum(["live", "frozen", "legacy"]),
  frozenAt: text.nullable(),
  inputs: FieldTraceInputsSchema.nullable(),
  scenarios: z.array(FieldTraceScenarioSchema),
  candidates: z.array(FieldTraceCandidateSchema),
  operations: z.array(FieldTraceOperationSchema),
  providers: z.array(FieldTraceProviderSchema),
  aiSummary: aiSummary.nullable(),
  coordinator: coordinator.nullable(),
  limitations: z.array(text),
  truncation: z.object({
    operations: z.boolean(),
    providers: z.boolean(),
    scenarios: z.boolean(),
    candidates: z.boolean(),
  }),
});
export type FieldTrace = z.infer<typeof FieldTraceSchema>;
export type FieldTraceInputs = z.infer<typeof FieldTraceInputsSchema>;
export type FieldTraceCandidate = z.infer<typeof FieldTraceCandidateSchema>;
export type FieldTraceProvider = z.infer<typeof FieldTraceProviderSchema>;
