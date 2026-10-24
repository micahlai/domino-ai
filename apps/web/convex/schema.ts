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
  })
    .index("by_runId", ["runId"])
    .index("by_requestId", ["requestId"]),
});
