// Lane: Timeline (dashboard, 13-week timeline, simulations). Owns the weekly forecast core
// (risks, branches, fixes, resilience, history, grades, explanations; P0 v2) and historical*.
// Root ../schema.ts composition is frozen: change it, or any table owned by another lane, only
// through a versioned checkpoint reviewed by both lanes.
// Seams (document, do not change without a checkpoint):
// - Field's investigation.ts writes historicalRuns only through historical.ts helpers
//   (saveBaselineIn, computeAlternativeIn, revealIn, loadRun), passing the `owner` column.
// - Timeline's S2 catalog (investigationCatalog.ts) reads Field tables from ./field.schema.ts.
// - Weekly tables key on Field's companies (companyId from ./legacy.schema.ts). Approvals and
//   log stay Field-owned. Weekly state arrives as WeeklySeedV1 JSON text.
import { defineTable } from "convex/server";
import { v } from "convex/values";
import { timelineAnalysesTable } from "../timeline/analysis/table";
import { timelineChatRequestsTable, timelineChatsTable } from "../timeline/chat/table";
import { timelinePredictionsTable } from "../timeline/predict/table";
import { companyId } from "./legacy.schema";

export const timelineTables = {
  // Weekly forecast core (P0 v2): risks, branches, fixes, resilience, history, grades.
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
  grades: defineTable({ companyId, week: v.string(), errorPct: v.number(), misses: v.any() }).index(
    "by_company",
    ["companyId"],
  ),
  explanations: defineTable({
    branchId: v.string(),
    inputHash: v.string(),
    text: v.string(),
  }).index("by_branch", ["branchId"]),
  // Historical case study.
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
  // TL1: one append-only saved weekly baseline per accepted request. Keyed by the seed's own
  // company id (a string, not Field's companies table). seedText is the canonical seed JSON;
  // the other payloads are frozen engine inputs/outputs, parsed with contract schemas on read.
  timelineBaselines: defineTable({
    runId: v.string(),
    companyId: v.string(),
    requestId: v.string(),
    seedId: v.string(),
    seedHash: v.string(),
    inputHash: v.string(),
    methodVersion: v.string(),
    assumptionNote: v.string(),
    seedText: v.string(),
    model: v.any(),
    constraints: v.any(),
    forecast: v.any(),
    dominoes: v.any(),
    history: v.any(),
    pastEvents: v.any(),
    savedAt: v.string(),
  })
    .index("by_company_and_runId", ["companyId", "runId"])
    .index("by_company_and_requestId", ["companyId", "requestId"])
    .index("by_company_and_seedId", ["companyId", "seedId"]),
  // TL1C/TL2/TL4: append-only workspace runs on one saved baseline (timeline/workspace.ts).
  // Each row freezes its complete rules, complete ordered changes and engine outputs; the seed
  // stays on the baseline row. requestId binds the first accepted inputs (inputHash).
  timelineRuns: defineTable({
    runId: v.string(),
    companyId: v.string(),
    requestId: v.string(),
    inputHash: v.string(),
    baselineRunId: v.string(),
    parentRunId: v.union(v.string(), v.null()),
    kind: v.union(v.literal("baseline"), v.literal("rules"), v.literal("scenario")),
    label: v.string(),
    depth: v.number(),
    seedId: v.string(),
    seedHash: v.string(),
    methodVersion: v.string(),
    constraintVersion: v.string(),
    constraintNote: v.string(),
    constraints: v.any(),
    ownChanges: v.any(),
    changes: v.any(),
    forecast: v.any(),
    dominoes: v.any(),
    receipts: v.any(),
    comparison: v.any(),
    lowPointCents: v.number(),
    lowPointWeek: v.string(),
    operation: v.any(),
    savedAt: v.string(),
  })
    .index("by_company_and_runId", ["companyId", "runId"])
    .index("by_company_and_requestId", ["companyId", "requestId"])
    .index("by_company_and_baselineRunId", ["companyId", "baselineRunId"])
    .index("by_company", ["companyId"]),
  // Every accepted workspace key stays bound, including opens that reuse an existing root.
  timelineRunRequests: defineTable({
    companyId: v.string(),
    requestId: v.string(),
    inputHash: v.string(),
    runId: v.string(),
    acceptedAt: v.string(),
  }).index("by_company_and_requestId", ["companyId", "requestId"]),
  // TL3: one-shot question receipts. Written only by the questions worker's functions.
  timelineQuestions: defineTable({
    companyId: v.string(),
    runId: v.string(),
    requestId: v.string(),
    inputHash: v.string(),
    status: v.string(),
    data: v.any(),
    startedAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_company_and_requestId", ["companyId", "requestId"])
    .index("by_company_and_runId", ["companyId", "runId"]),
  timelineAnalyses: timelineAnalysesTable,
  timelineChats: timelineChatsTable,
  timelineChatRequests: timelineChatRequestsTable,
  timelinePredictions: timelinePredictionsTable,
} as const;
