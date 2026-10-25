// Lane: Field (ingestion, audit, agent workspace). Owns the weekly company core (companies,
// sources, snapshots, models, constraints, approvals, log; P0 v2) and the investigation* tables.
// Root ../schema.ts composition is frozen: change it, or any table owned by another lane, only
// through a versioned checkpoint reviewed by both lanes.
// Seams (document, do not change without a checkpoint):
// - investigation.ts writes Timeline's historicalRuns only through historical.ts helpers, setting
//   the `owner` column to the conversationId. Rows are written inside historical.ts.
// - Timeline's S2 catalog (investigationCatalog.ts) reads investigationConversations (via
//   by_case_createdAt) and investigationOperations. Keep those shapes and indexes stable.
// - Timeline's weekly tables key on companies (companyId) and the existing pipeline reads
//   snapshots, models and constraints. Keep those shapes and indexes stable. Weekly state
//   crosses lanes as WeeklySeedV1 JSON text (packages/contracts weekly-boundary.ts).
import { defineTable } from "convex/server";
import { v } from "convex/values";
import { companyId } from "./legacy.schema";

const sourceKind = v.union(
  v.literal("stripe"),
  v.literal("nessie"),
  v.literal("crm"),
  v.literal("ramp"),
  v.literal("books"),
  v.literal("payroll"),
  v.literal("document"),
  v.literal("learned"),
);
const decision = v.union(v.literal("approved"), v.literal("rejected"));

export const fieldTables = {
  // Weekly company core (P0 v2): company, ingestion, model, constraints, approvals, log.
  companies: defineTable({
    name: v.string(),
    profile: v.union(v.literal("kestrel"), v.literal("tally"), v.literal("orbit")),
    currentWeek: v.number(),
    today: v.string(),
    status: v.union(v.literal("connecting"), v.literal("ready")),
  }),
  sources: defineTable({
    companyId,
    kind: sourceKind,
    baseUrl: v.string(),
    mappings: v.any(),
    lastPull: v.union(v.string(), v.null()),
    tieOut: v.union(v.literal("ok"), v.literal("needs_review"), v.literal("pending")),
    step: v.string(),
  }).index("by_company", ["companyId"]),
  snapshots: defineTable({ companyId, asOf: v.string(), data: v.any() }).index("by_company_asOf", [
    "companyId",
    "asOf",
  ]),
  models: defineTable({ companyId, version: v.number(), data: v.any() }).index(
    "by_company_version",
    ["companyId", "version"],
  ),
  constraints: defineTable({ companyId, data: v.any() }).index("by_company", ["companyId"]),
  approvals: defineTable({
    companyId,
    fixId: v.string(),
    branchId: v.string(),
    decision,
    by: v.string(),
    at: v.string(),
    note: v.string(),
  }).index("by_company", ["companyId"]),
  log: defineTable({
    companyId,
    actor: v.union(
      v.literal("person"),
      v.literal("engine"),
      v.literal("agent:creao"),
      v.literal("agent:claude"),
      v.literal("connector"),
    ),
    action: v.string(),
    refs: v.array(v.string()),
    at: v.string(),
  }).index("by_company", ["companyId"]),
  // Investigations.
  // G2b: server-owned investigation conversations. One receipt per accepted requestId binds it
  // to its kind, payload hash and conversation, so retries return and key reuse conflicts.
  investigationRequests: defineTable({
    requestId: v.string(),
    kind: v.union(v.literal("investigate"), v.literal("reveal"), v.literal("alternative")),
    payloadHash: v.string(),
    conversationId: v.string(),
    operationIds: v.array(v.string()),
  }).index("by_requestId", ["requestId"]),
  investigationConversations: defineTable({
    conversationId: v.string(),
    caseId: v.string(),
    question: v.string(),
    createdAt: v.string(),
  })
    .index("by_conversationId", ["conversationId"])
    // S2: newest-first saved investigation catalog for one exact case.
    .index("by_case_createdAt", ["caseId", "createdAt"]),
  investigationMessages: defineTable({
    conversationId: v.string(),
    sequence: v.number(),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
    // receipt = deterministic server text; assessment = validated specialist output.
    kind: v.union(v.literal("question"), v.literal("receipt"), v.literal("assessment")),
    text: v.string(),
    operationId: v.optional(v.string()),
    createdAt: v.string(),
  }).index("by_conversation", ["conversationId", "sequence"]),
  investigationOperations: defineTable({
    operationId: v.string(),
    conversationId: v.string(),
    sequence: v.number(),
    kind: v.union(
      v.literal("source_load"),
      v.literal("forecast"),
      v.literal("specialist"),
      v.literal("reveal"),
      v.literal("alternative"),
    ),
    role: v.optional(v.union(v.literal("evidence_analyst"), v.literal("scenario_reviewer"))),
    title: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("unknown"),
    ),
    dependsOn: v.array(v.string()),
    createdAt: v.string(),
    startedAt: v.optional(v.string()),
    finishedAt: v.optional(v.string()),
    leaseUntil: v.optional(v.number()),
    // Frozen when the operation starts: cutoff, visibility, ids and hash. Never widened later.
    input: v.optional(v.any()),
    // Full specialist packet, server-only; the client sees input (ids + hash) only.
    packet: v.optional(v.any()),
    profile: v.optional(v.any()),
    providerMode: v.optional(v.string()),
    provider: v.optional(v.string()),
    // CREAO run identity and created status, persisted before any poll. Server-only.
    remoteRunId: v.optional(v.string()),
    remoteStatus: v.optional(v.string()),
    model: v.optional(v.string()),
    usage: v.optional(v.object({ inputTokens: v.number(), outputTokens: v.number() })),
    outputRef: v.optional(v.object({ kind: v.string(), id: v.string() })),
    output: v.optional(v.any()),
    error: v.optional(v.object({ code: v.string(), message: v.string() })),
  })
    .index("by_operationId", ["operationId"])
    .index("by_conversation", ["conversationId", "sequence"]),
} as const;
