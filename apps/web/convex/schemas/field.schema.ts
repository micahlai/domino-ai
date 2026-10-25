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
/** CRS identity and fraud check on a vendor's account owner (fieldCrs.ts, connectors/crs.ts). */
export const crsResult = v.object({
  verdict: v.union(
    v.literal("verified"),
    v.literal("signals"),
    v.literal("unavailable"),
    v.literal("not_configured"),
    v.literal("capped"),
  ),
  personaId: v.string(),
  personaName: v.string(),
  personaProfile: v.string(),
  identity: v.union(
    v.null(),
    v.object({
      result: v.union(v.literal("PASS"), v.literal("FAIL"), v.literal("REVIEW")),
      messages: v.array(v.object({ code: v.string(), text: v.string() })),
      requestId: v.union(v.string(), v.null()),
    }),
  ),
  fraud: v.union(
    v.null(),
    v.object({
      score: v.union(v.number(), v.null()),
      emailStatus: v.union(v.string(), v.null()),
      emailFirstSeen: v.union(v.string(), v.null()),
      domainRisk: v.union(v.number(), v.null()),
      phoneMatch: v.union(v.string(), v.null()),
      addressMatch: v.union(v.string(), v.null()),
      requestId: v.union(v.string(), v.null()),
    }),
  ),
  headline: v.string(),
  signals: v.array(v.string()),
  calls: v.number(),
  detail: v.union(v.string(), v.null()),
  /** Reused an earlier sandbox result for this persona (no new CRS call). */
  cached: v.boolean(),
  checkedAt: v.string(),
});

const decision = v.union(v.literal("approved"), v.literal("rejected"));
const webhookVendor = v.union(
  v.literal("stripe"),
  v.literal("gusto"),
  v.literal("ramp"),
  v.literal("nessie"),
);

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
    // Agents (fieldAgents.ts, optional): when a person pressed Start agents. New operating and
    // judge companies start idle; an older row with any snapshot counts as started.
    agentsStartedAt: v.optional(v.string()),
    operatingDemo: v.optional(
      v.object({
        company: v.union(
          v.literal("2u"),
          v.literal("asana-inspired"),
          v.literal("gitlab-inspired"),
          v.literal("asana-current"),
          v.literal("gitlab-current"),
        ),
        scenario: v.union(
          v.literal("baseline"),
          v.literal("late-payments"),
          v.literal("customer-loss"),
          v.literal("unexpected-expense"),
        ),
        version: v.literal(1),
      }),
    ),
  }).index("by_operating_demo", ["operatingDemo.company", "operatingDemo.scenario"]),
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
  })
    .index("by_company", ["companyId"])
    .index("by_company_and_runId", ["companyId", "runId"])
    // Bounded lookups of one action (the engine's saved proposal order) without a log scan.
    .index("by_company_and_action", ["companyId", "action"]),
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
    /** Forecasters started so far; the rest wait for a free slot (lib/swarm.ts SWARM_LIMIT). */
    started: v.optional(v.number()),
    startedAt: v.string(),
    finishedAt: v.optional(v.string()),
    summary: v.optional(v.string()),
    research: v.optional(v.any()),
    /** Validated FieldTraceInputs JSON, captured once when the run starts. */
    traceInputs: v.optional(v.string()),
    /** Run-local candidates survive the mutable open-suggestion upserts. */
    traceCandidates: v.optional(v.string()),
    /** Completed round lookup also works when decided suggestions retain legacy origins. */
    advisorScenarioId: v.optional(v.string()),
    /** Validated FieldTrace JSON, written once when this run becomes terminal. */
    traceReceipt: v.optional(v.string()),
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
    .index("by_company_and_runId", ["companyId", "runId"])
    .index("by_company_snapshot_advisor", ["companyId", "snapshotVersion", "advisorScenarioId"])
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
      v.literal("advisor"),
    ),
    provider: v.union(v.literal("claude"), v.literal("creao")),
    /** Snapshot version this call belongs to, as "v3". */
    scope: v.string(),
    /** Original caller only. Duplicate reservations never transfer this attribution. */
    analystRunId: v.optional(v.string()),
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
  // Apify actor runs (fieldApify.ts): one row per live run of the public signal search, with
  // its signals. Doubles as the 24 h cache per counterparty (key) and the run caps (per UTC day,
  // per analyst run). Reserved and failed rows count toward the caps.
  apifyRuns: defineTable({
    key: v.string(),
    counterparty: v.string(),
    query: v.string(),
    actorId: v.string(),
    companyId: v.optional(companyId),
    analystRunId: v.optional(v.string()),
    day: v.string(),
    at: v.string(),
    status: v.union(v.literal("reserved"), v.literal("ok"), v.literal("failed")),
    detail: v.optional(v.string()),
    remoteRunId: v.optional(v.string()),
    datasetId: v.optional(v.string()),
    itemCount: v.optional(v.number()),
    resultCount: v.optional(v.number()),
    usageUsd: v.optional(v.number()),
    signals: v.optional(
      v.array(
        v.object({
          title: v.string(),
          url: v.string(),
          source: v.string(),
          date: v.optional(v.string()),
          snippet: v.string(),
          kinds: v.array(v.string()),
        }),
      ),
    ),
  })
    .index("by_day", ["day"])
    .index("by_key_and_at", ["key", "at"])
    .index("by_analystRunId", ["analystRunId"]),
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
    /** Durable post-commit work. A newer snapshot waits until this version is audited and recomputed. */
    auditPending: v.optional(
      v.object({
        snapshotId: v.id("snapshots"),
        previousId: v.optional(v.id("snapshots")),
        version: v.number(),
        tieOut: v.array(v.object({ name: v.string(), ref: v.string(), detail: v.string() })),
        phase: v.union(v.literal("audit"), v.literal("recompute")),
        newFindings: v.number(),
      }),
    ),
    /** Records per snapshot list in the latest version, so status never loads a snapshot. */
    recordCounts: v.union(v.record(v.string(), v.number()), v.null()),
  }).index("by_companyId", ["companyId"]),
  // Simulated clock per company (fieldClock.ts): plays the mock world day by day. Only the
  // clock moves simulated time; one tick at a time per company (tickStartedAt is the lease).
  simClocks: defineTable({
    companyId,
    status: v.union(v.literal("playing"), v.literal("paused")),
    speed: v.number(),
    /** Bumped on play, pause and speed changes so a stale scheduled tick stops itself. */
    generation: v.number(),
    /** World date when the clock was created: simulated day 0. */
    originDate: v.string(),
    day: v.number(),
    date: v.string(),
    /** Day and wall time the current play session started (bounds: 13 weeks, 60 min). */
    sessionStartDay: v.number(),
    playStartedAt: v.union(v.number(), v.null()),
    tickStartedAt: v.union(v.number(), v.null()),
    ticks: v.number(),
    lastTickAt: v.union(v.string(), v.null()),
    pausedReason: v.union(v.string(), v.null()),
    lastSummary: v.union(v.string(), v.null()),
    /** Dashboard rating after the last ingest a tick ran, to spot a verdict change. */
    lastRating: v.union(v.string(), v.null()),
    /** Snapshot versions ("v7") a routine tick wrote: no model call is made for them. */
    quietScopes: v.array(v.string()),
    /** A meaningful tick wants an analyst run while one is still going. */
    analystPending: v.boolean(),
    analystRequestedAt: v.union(v.number(), v.null()),
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
    crs: v.optional(crsResult),
  })
    .index("by_companyId_and_findingId", ["companyId", "findingId"])
    .index("by_companyId_and_status", ["companyId", "status"]),
  // CRS sandbox checks (fieldCrs.ts): one row per check. Doubles as the per-persona cache and the
  // per-company hourly cap. kind "login_failed" stops further logins (the sandbox locks accounts).
  crsChecks: defineTable({
    kind: v.union(v.literal("check"), v.literal("login_failed")),
    companyId: v.optional(companyId),
    personaId: v.string(),
    at: v.string(),
    calls: v.number(),
    result: v.optional(crsResult),
  })
    .index("by_kind_and_personaId", ["kind", "personaId"])
    .index("by_kind_and_at", ["kind", "at"])
    .index("by_companyId_and_at", ["companyId", "at"]),
  // Toolbox (fieldTools.ts): outside tools an agent added for this company, once each. Seeded
  // with the Apify Google Search Results Scraper; others are found by searching the Apify Store
  // (free listing) when an agent needs a capability the toolbox lacks. Runs stay capped
  // (fieldApify.ts); adding a tool runs nothing.
  tools: defineTable({
    companyId,
    provider: v.literal("apify"),
    /** What the tool is for, e.g. "web_search", "website_check". */
    capability: v.string(),
    /** owner/name, e.g. "apify/website-content-crawler". */
    actorId: v.string(),
    name: v.string(),
    description: v.string(),
    url: v.optional(v.string()),
    pricing: v.optional(v.string()),
    addedAt: v.string(),
    /** Agent id that needed it ("research#1"). */
    addedBy: v.string(),
    reason: v.string(),
    seed: v.boolean(),
    /** Domino can build this actor's input; other tools are kept but not run. */
    runnable: v.boolean(),
    /** Store results considered when it was picked (0 for the seed). */
    considered: v.number(),
  })
    .index("by_companyId_and_capability", ["companyId", "capability"])
    .index("by_companyId_and_actorId", ["companyId", "actorId"]),
  // Advisor suggestions (fieldAdvisor.ts, fieldSuggestions.ts): one row per scenario and fix
  // kind, refreshed while open. Engine effect only; CREAO marks one recommended. Accept or
  // decline records a decision; Domino never moves money.
  suggestions: defineTable({
    companyId,
    /** `${scenarioId}:${fixKind}`, stable across runs. */
    suggestionId: v.string(),
    runId: v.string(),
    snapshotVersion: v.number(),
    scenarioId: v.string(),
    scenarioTitle: v.string(),
    agentId: v.string(),
    fix: v.object({
      id: v.string(),
      kind: v.union(
        v.literal("credit_line_draw"),
        v.literal("delay_bill"),
        v.literal("accelerate_collections"),
        v.literal("defer_hires"),
      ),
      label: v.string(),
      costNote: v.string(),
      risk: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
      changes: v.any(),
    }),
    effect: v.object({
      lowPoint: v.number(),
      lowWeekStart: v.string(),
      survives: v.boolean(),
      gain: v.number(),
      scenarioLow: v.number(),
      lenderMinimum: v.number(),
      breaksAt: v.optional(v.string()),
      brokenConstraintId: v.optional(v.string()),
    }),
    /** Engine order within its scenario (0 = first). */
    rank: v.number(),
    recommended: v.boolean(),
    recommendation: v.optional(
      v.object({
        text: v.string(),
        provider: v.literal("creao"),
        remoteRunId: v.string(),
        at: v.string(),
      }),
    ),
    status: v.union(v.literal("open"), v.literal("accepted"), v.literal("declined")),
    decidedBy: v.optional(v.string()),
    decidedAt: v.optional(v.string()),
    note: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_companyId_and_suggestionId", ["companyId", "suggestionId"])
    .index("by_companyId_and_status", ["companyId", "status"])
    .index("by_companyId_and_updatedAt", ["companyId", "updatedAt"])
    .index("by_companyId_and_status_and_updatedAt", ["companyId", "status", "updatedAt"])
    .index("by_companyId_and_runId", ["companyId", "runId"]),
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
  // Mock vendor webhooks (fieldWebhooks.ts, http.ts). One signing secret per company and vendor,
  // never sent to a client. Each accepted event is kept once (vendors retry), and one inbox row
  // per company debounces the ingest a burst of events starts.
  vendorWebhookSecrets: defineTable({
    companyId,
    vendor: webhookVendor,
    secret: v.string(),
    createdAt: v.string(),
  }).index("by_companyId_and_vendor", ["companyId", "vendor"]),
  vendorWebhookEvents: defineTable({
    companyId,
    vendor: webhookVendor,
    eventId: v.string(),
    type: v.string(),
    summary: v.string(),
    refs: v.array(v.string()),
    /** "http" = signed delivery to the Convex site URL; "internal" = site URL unreachable. */
    transport: v.union(v.literal("http"), v.literal("internal")),
    receivedAt: v.string(),
    /** joined = a simulated day's ingest was already starting and reads it. */
    status: v.union(
      v.literal("queued"),
      v.literal("joined"),
      v.literal("ingesting"),
      v.literal("ingested"),
      v.literal("failed"),
    ),
    runId: v.optional(v.string()),
  })
    .index("by_companyId_and_eventId", ["companyId", "eventId"])
    .index("by_companyId_and_status", ["companyId", "status"]),
  webhookInbox: defineTable({
    companyId,
    /** Wall time (ms) the pending debounced ingest runs; null = none pending. */
    drainAt: v.union(v.number(), v.null()),
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
  // TL7 joint seam: one row per "Open in Timeline" import. The WeeklyResultRefV1 pointer back
  // from Timeline (canonical JSON from timeline/workspace:resultRef) plus the ids needed to read
  // its saved run, TL6 output and TL7 analysis. Field never copies Timeline's financial values.
  timelineLinks: defineTable({
    companyId,
    /** Timeline's company id: the seed's company.id (the sim profile id). */
    timelineCompanyId: v.string(),
    seedId: v.string(),
    seedHash: v.string(),
    asOf: v.string(),
    snapshotVersion: v.number(),
    baselineRunId: v.string(),
    runId: v.string(),
    /** Canonical WeeklyResultRefV1 JSON text, checked by parseWeeklyResultRefJson. */
    resultRef: v.string(),
    analysisId: v.union(v.string(), v.null()),
    analysisError: v.union(v.string(), v.null()),
    savedAt: v.string(),
  }).index("by_companyId", ["companyId"]),
} as const;
