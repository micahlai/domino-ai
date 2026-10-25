import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const companyId = v.id("companies");
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

export default defineSchema({
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
  risks: defineTable({ companyId, asOf: v.string(), data: v.any() }).index("by_company", [
    "companyId",
  ]),
  branches: defineTable({
    companyId,
    branchId: v.string(),
    parentId: v.union(v.string(), v.null()),
    kind: v.union(v.literal("base"), v.literal("event"), v.literal("fix")),
    data: v.any(),
  })
    .index("by_company", ["companyId"])
    .index("by_branchId", ["branchId"]),
  fixes: defineTable({ companyId, branchId: v.string(), data: v.any(), gain: v.number() }).index(
    "by_branch",
    ["branchId"],
  ),
  resilience: defineTable({
    companyId,
    asOf: v.string(),
    withFixes: v.boolean(),
    data: v.any(),
  }).index("by_company_withFixes", ["companyId", "withFixes"]),
  history: defineTable({ companyId, weeks: v.any(), pastEvents: v.any() }).index("by_company", [
    "companyId",
  ]),
  approvals: defineTable({
    companyId,
    fixId: v.string(),
    branchId: v.string(),
    decision,
    by: v.string(),
    at: v.string(),
    note: v.string(),
  }).index("by_company", ["companyId"]),
  grades: defineTable({ companyId, week: v.string(), errorPct: v.number(), misses: v.any() }).index(
    "by_company",
    ["companyId"],
  ),
  explanations: defineTable({
    branchId: v.string(),
    inputHash: v.string(),
    text: v.string(),
  }).index("by_branch", ["branchId"]),
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
  // Historical case study (H2c). Runs are append-only; reveal state lives in its own table.
  historicalRuns: defineTable({
    runId: v.string(),
    requestId: v.string(),
    caseId: v.string(),
    kind: v.union(v.literal("baseline"), v.literal("alternative")),
    baselineRunId: v.optional(v.string()),
    // G2b: the investigation conversation that owns this run. Public writes never touch it.
    owner: v.optional(v.string()),
    run: v.any(),
    snapshot: v.any(),
    summary: v.any(),
    rowHash: v.string(),
  })
    .index("by_runId", ["runId"])
    .index("by_requestId", ["requestId"]),
  historicalReveals: defineTable({
    runId: v.string(),
    requestId: v.string(),
    revealedThrough: v.string(),
    revealedAt: v.string(),
    comparisons: v.any(),
    // Optional only so pre-repair local rows still validate; reads fail closed without them.
    view: v.optional(v.any()),
    revealHash: v.optional(v.string()),
  })
    .index("by_runId", ["runId"])
    .index("by_requestId", ["requestId"]),
  // One per accepted reveal requestId, so a key stays bound to its first runId.
  historicalRevealReceipts: defineTable({ requestId: v.string(), runId: v.string() }).index(
    "by_requestId",
    ["requestId"],
  ),
  // H2d: one feed per baseline, written only in the mutation that commits the outcome.
  historicalActivity: defineTable({
    baselineRunId: v.string(),
    sequence: v.number(),
    event: v.any(),
  }).index("by_feed", ["baselineRunId", "sequence"]),
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
});
