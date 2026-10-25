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
    // Judge sandbox (fieldJudge.ts, optional): an isolated simulated company a judge started.
    // Hidden from the main company picker (its name is not a picker name).
    judge: v.optional(v.boolean()),
    judgeNumber: v.optional(v.number()),
    judgeArchivedAt: v.optional(v.string()),
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
    // Field weekly ingest (optional, so older rows stay valid): who did the step, with which
    // tool, against which data source, so the brain map animates only recorded exchanges.
    agent: v.optional(v.string()),
    tool: v.optional(v.string()),
    source: v.optional(v.string()),
    runId: v.optional(v.string()),
    summary: v.optional(v.string()),
    // Field agent web (fieldAnalyst.ts, optional): agent instances, manager links, agent to
    // agent messages, status transitions and categorized tool calls, all from real operations.
    agentId: v.optional(v.string()),
    agentKind: v.optional(
      v.union(v.literal("domino"), v.literal("claude"), v.literal("creao"), v.literal("system")),
    ),
    parentAgentId: v.optional(v.string()),
    event: v.optional(v.union(v.literal("status"), v.literal("message"), v.literal("tool"))),
    status: v.optional(
      v.union(v.literal("spawned"), v.literal("working"), v.literal("done"), v.literal("failed")),
    ),
    currentTask: v.optional(v.string()),
    fromAgentId: v.optional(v.string()),
    toAgentId: v.optional(v.string()),
    toolCategory: v.optional(v.string()),
    toolLabel: v.optional(v.string()),
    step: v.optional(v.number()),
    steps: v.optional(v.number()),
  }).index("by_company", ["companyId"]),
  // Field analyst (fieldAnalyst.ts): one row per orchestrated run and per forecaster scenario.
  analystRuns: defineTable({
    companyId,
    runId: v.string(),
    trigger: v.string(),
    snapshotId: v.id("snapshots"),
    snapshotVersion: v.number(),
    asOf: v.string(),
    status: v.union(v.literal("running"), v.literal("done"), v.literal("failed")),
    paceMs: v.number(),
    children: v.number(),
    reported: v.number(),
    startedAt: v.string(),
    finishedAt: v.optional(v.string()),
    summary: v.optional(v.string()),
    research: v.optional(v.any()),
    // Claude's summary of the engine results (fieldAnalyst.summarize). Absent on older rows.
    aiSummary: v.optional(
      v.object({
        status: v.union(v.literal("done"), v.literal("unavailable"), v.literal("skipped")),
        reason: v.optional(v.string()),
        recommendation: v.optional(v.string()),
        rationale: v.optional(v.string()),
        citedScenarios: v.optional(v.array(v.number())),
        model: v.optional(v.string()),
        provider: v.optional(v.union(v.literal("claude"), v.literal("creao"))),
        remoteRunId: v.optional(v.string()),
        inputTokens: v.optional(v.number()),
        outputTokens: v.optional(v.number()),
        at: v.string(),
      }),
    ),
    // CREAO coordinator plan (fieldCoordinator.ts) after validation and execution.
    coordinator: v.optional(
      v.object({
        status: v.union(
          v.literal("done"),
          v.literal("unavailable"),
          v.literal("skipped"),
          v.literal("failed"),
        ),
        reason: v.optional(v.string()),
        summary: v.optional(v.string()),
        escalate: v.optional(v.array(v.object({ findingId: v.string(), reason: v.string() }))),
        focus: v.optional(v.object({ scenarioIndex: v.number(), reason: v.string() })),
        research: v.optional(v.object({ counterparty: v.string(), reason: v.string() })),
        remoteRunId: v.optional(v.string()),
        at: v.string(),
      }),
    ),
  })
    .index("by_companyId", ["companyId"])
    .index("by_runId", ["runId"]),
  // Model-call budget (fieldAi.ts): one row per Claude call or CREAO run. Per company at most one
  // of each kind per snapshot version, and at most AI_CALLS_PER_HOUR rows per hour in total.
  aiCalls: defineTable({
    companyId,
    kind: v.union(
      v.literal("audit"),
      v.literal("analyst"),
      v.literal("research"),
      v.literal("coordinator"),
    ),
    provider: v.union(v.literal("claude"), v.literal("creao")),
    /** Snapshot version this call belongs to, as "v3". */
    scope: v.string(),
    hour: v.number(),
    at: v.string(),
    status: v.union(v.literal("reserved"), v.literal("ok"), v.literal("failed")),
    detail: v.optional(v.string()),
    model: v.optional(v.string()),
    remoteRunId: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
  })
    .index("by_hour", ["hour"])
    .index("by_companyId_and_kind_and_scope", ["companyId", "kind", "scope"]),
  analystScenarios: defineTable({
    companyId,
    runId: v.string(),
    index: v.number(),
    agentId: v.string(),
    scenarioId: v.string(),
    title: v.string(),
    basis: v.string(),
    changes: v.any(),
    status: v.union(
      v.literal("spawned"),
      v.literal("working"),
      v.literal("done"),
      v.literal("failed"),
    ),
    work: v.optional(v.any()),
    fixes: v.optional(v.any()),
    error: v.optional(v.string()),
  }).index("by_runId_and_index", ["runId", "index"]),
  analystLoops: defineTable({ companyId, generation: v.number(), ticksLeft: v.number() }).index(
    "by_companyId",
    ["companyId"],
  ),
  // Field weekly feed (field.ts): ingest state, kept small because it changes every run.
  feeds: defineTable({
    companyId,
    auto: v.boolean(),
    /** Bumped on every enable/disable so a stale self-scheduled tick stops itself. */
    autoGeneration: v.number(),
    autoTicksLeft: v.number(),
    week: v.number(),
    snapshotVersion: v.number(),
    lastSnapshotId: v.union(v.id("snapshots"), v.null()),
    lastSnapshotHash: v.union(v.string(), v.null()),
    lastSnapshotAt: v.union(v.string(), v.null()),
    lastIngestAt: v.union(v.string(), v.null()),
    lastIngestStatus: v.union(
      v.literal("ok"),
      v.literal("no_change"),
      v.literal("failed"),
      v.null(),
    ),
    lastError: v.union(v.string(), v.null()),
    /** Records per snapshot list in the latest version, so status never loads a snapshot. */
    recordCounts: v.union(v.record(v.string(), v.number()), v.null()),
  }).index("by_companyId", ["companyId"]),
  // The private mock world behind the feed (sim WorldState plus planted entries). Only the
  // in-process mock source handler reads it; ingest sees source responses only.
  feedWorlds: defineTable({ companyId, world: v.any(), overlay: v.any() }).index("by_companyId", [
    "companyId",
  ]),
  // Audit findings (FindingSchema fields) per snapshot version; high severity is an escalation
  // a person approves (finding confirmed) or rejects (dismissed) via field.decide.
  findings: defineTable({
    companyId,
    findingId: v.string(),
    snapshotId: v.id("snapshots"),
    version: v.number(),
    kind: v.union(
      v.literal("duplicate"),
      v.literal("conflict"),
      v.literal("unusual_amount"),
      v.literal("unusual_timing"),
      v.literal("missing_expected"),
    ),
    severity: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    summary: v.string(),
    refs: v.array(v.string()),
    detectedAt: v.string(),
    escalated: v.boolean(),
    status: v.union(v.literal("open"), v.literal("approved"), v.literal("rejected")),
    decidedBy: v.optional(v.string()),
    decidedAt: v.optional(v.string()),
    note: v.optional(v.string()),
    // Claude's plain-English explanation of the rule-based finding (fieldAi.explainFindings).
    explanation: v.optional(
      v.object({
        text: v.string(),
        suggestedCheck: v.string(),
        model: v.string(),
        provider: v.optional(v.union(v.literal("claude"), v.literal("creao"))),
        remoteRunId: v.optional(v.string()),
        at: v.string(),
      }),
    ),
  })
    .index("by_companyId_and_findingId", ["companyId", "findingId"])
    .index("by_companyId_and_status", ["companyId", "status"]),
  // Connected tools (connections.ts): mock sign-in per tool, sync position and last counts.
  // No credentials are stored: the vendor APIs are in-process mocks.
  connections: defineTable({
    companyId,
    tool: v.union(
      v.literal("stripe"),
      v.literal("ramp"),
      v.literal("qbo"),
      v.literal("gusto"),
      v.literal("hubspot"),
      v.literal("plaid"),
      v.literal("nessie"),
    ),
    status: v.union(v.literal("connected"), v.literal("disconnected"), v.literal("error")),
    account: v.string(),
    scopes: v.array(v.string()),
    connectedAt: v.union(v.string(), v.null()),
    connectedBy: v.union(v.string(), v.null()),
    cursor: v.union(v.string(), v.null()),
    lastSyncAt: v.union(v.string(), v.null()),
    /** Canonical records per Snapshot list from the last sync, after dedupe. */
    counts: v.record(v.string(), v.number()),
    recordsIn: v.number(),
    recordsOut: v.number(),
    skipped: v.number(),
    checksOk: v.number(),
    checksTotal: v.number(),
    lastError: v.union(v.string(), v.null()),
  }).index("by_companyId_and_tool", ["companyId", "tool"]),
  // Capital One Nessie sandbox (fieldNessie.ts): Domino's own customer and accounts per company
  // and every bank line posted to them. Only these stored ids are ever read or written; the
  // key's other customers and accounts are never touched. One row per company.
  nessieLinks: defineTable({
    companyId,
    label: v.string(),
    customerId: v.union(v.string(), v.null()),
    checkingId: v.union(v.string(), v.null()),
    savingsId: v.union(v.string(), v.null()),
    openingBalance: v.union(v.number(), v.null()),
    posted: v.array(
      v.object({
        bankId: v.string(),
        nessieId: v.string(),
        kind: v.union(v.literal("deposit"), v.literal("withdrawal")),
      }),
    ),
    postedThrough: v.union(v.string(), v.null()),
    created: v.number(),
    /** A sync holds the row until this time (ms) so two runs never post the same line. */
    lockUntil: v.number(),
    lastError: v.union(v.string(), v.null()),
  }).index("by_companyId", ["companyId"]),
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
