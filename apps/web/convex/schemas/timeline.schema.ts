// Lane: Timeline (historical case study). Owns the historical* tables below.
// Root ../schema.ts composition is frozen: change it, or any table owned by another lane, only
// through a versioned checkpoint reviewed by both lanes.
// Seams (document, do not change without a checkpoint):
// - Field's investigation.ts writes historicalRuns only through historical.ts helpers
//   (saveBaselineIn, computeAlternativeIn, revealIn, loadRun), passing the `owner` column.
// - Timeline's S2 catalog (investigationCatalog.ts) reads Field tables from ./field.schema.ts.
import { defineTable } from "convex/server";
import { v } from "convex/values";

export const timelineTables = {
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
} as const;
