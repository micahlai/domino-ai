// P0-S: the frozen root composition must keep lane ownership disjoint and complete.
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { fieldTables } from "./schemas/field.schema";
import * as legacy from "./schemas/legacy.schema";
import { timelineTables } from "./schemas/timeline.schema";

// P0 v2: the 14 legacy tables are split between the lanes; legacy.schema.ts keeps only shared
// validators.
const LANES = {
  timeline: [
    "risks",
    "branches",
    "fixes",
    "resilience",
    "history",
    "grades",
    "explanations",
    "historicalRuns",
    "historicalReveals",
    "historicalRevealReceipts",
    "historicalActivity",
    "timelineBaselines",
    "timelineRuns",
    "timelineRunRequests",
    "timelineQuestions",
    "timelineAnalyses",
    "timelineChats",
    "timelineChatRequests",
  ],
  field: [
    "companies",
    "sources",
    "snapshots",
    "models",
    "constraints",
    "approvals",
    "log",
    "feeds",
    "feedWorlds",
    "simClocks",
    "findings",
    "connections",
    "nessieLinks",
    "analystRuns",
    "analystScenarios",
    "analystLoops",
    "aiCalls",
    "apifyRuns",
    "tools",
    "suggestions",
    "investigationRequests",
    "investigationConversations",
    "investigationMessages",
    "investigationOperations",
    "timelineLinks",
    "vendorWebhookSecrets",
    "vendorWebhookEvents",
    "webhookInbox",
  ],
};

const INDEXES: Record<string, Array<[string, string[]]>> = {
  companies: [["by_operating_demo", ["operatingDemo.company", "operatingDemo.scenario"]]],
  sources: [["by_company", ["companyId"]]],
  snapshots: [["by_company_asOf", ["companyId", "asOf"]]],
  models: [["by_company_version", ["companyId", "version"]]],
  constraints: [["by_company", ["companyId"]]],
  risks: [["by_company", ["companyId"]]],
  branches: [
    ["by_company", ["companyId"]],
    ["by_branchId", ["branchId"]],
  ],
  fixes: [["by_branch", ["branchId"]]],
  resilience: [["by_company_withFixes", ["companyId", "withFixes"]]],
  history: [["by_company", ["companyId"]]],
  approvals: [["by_company", ["companyId"]]],
  grades: [["by_company", ["companyId"]]],
  explanations: [["by_branch", ["branchId"]]],
  log: [
    ["by_company", ["companyId"]],
    ["by_company_and_runId", ["companyId", "runId"]],
    ["by_company_and_action", ["companyId", "action"]],
  ],
  feeds: [["by_companyId", ["companyId"]]],
  feedWorlds: [["by_companyId", ["companyId"]]],
  simClocks: [["by_companyId", ["companyId"]]],
  findings: [
    ["by_companyId_and_findingId", ["companyId", "findingId"]],
    ["by_companyId_and_status", ["companyId", "status"]],
  ],
  connections: [["by_companyId_and_tool", ["companyId", "tool"]]],
  nessieLinks: [["by_companyId", ["companyId"]]],
  analystRuns: [
    ["by_companyId", ["companyId"]],
    ["by_company_and_runId", ["companyId", "runId"]],
    ["by_company_snapshot_advisor", ["companyId", "snapshotVersion", "advisorScenarioId"]],
    ["by_runId", ["runId"]],
  ],
  analystScenarios: [["by_runId_and_index", ["runId", "index"]]],
  analystLoops: [["by_companyId", ["companyId"]]],
  aiCalls: [
    ["by_hour", ["hour"]],
    ["by_companyId_and_kind_and_scope", ["companyId", "kind", "scope"]],
  ],
  apifyRuns: [
    ["by_day", ["day"]],
    ["by_key_and_at", ["key", "at"]],
    ["by_analystRunId", ["analystRunId"]],
  ],
  tools: [
    ["by_companyId_and_capability", ["companyId", "capability"]],
    ["by_companyId_and_actorId", ["companyId", "actorId"]],
  ],
  suggestions: [
    ["by_companyId_and_suggestionId", ["companyId", "suggestionId"]],
    ["by_companyId_and_status", ["companyId", "status"]],
    ["by_companyId_and_updatedAt", ["companyId", "updatedAt"]],
    ["by_companyId_and_status_and_updatedAt", ["companyId", "status", "updatedAt"]],
    ["by_companyId_and_runId", ["companyId", "runId"]],
  ],
  historicalRuns: [
    ["by_runId", ["runId"]],
    ["by_requestId", ["requestId"]],
  ],
  historicalReveals: [
    ["by_runId", ["runId"]],
    ["by_requestId", ["requestId"]],
  ],
  historicalRevealReceipts: [["by_requestId", ["requestId"]]],
  historicalActivity: [["by_feed", ["baselineRunId", "sequence"]]],
  // TL1: additive Timeline table; every legacy entry above is unchanged.
  timelineBaselines: [
    ["by_company_and_runId", ["companyId", "runId"]],
    ["by_company_and_requestId", ["companyId", "requestId"]],
    ["by_company_and_seedId", ["companyId", "seedId"]],
  ],
  // TL1C-TL4: additive Timeline tables.
  timelineRuns: [
    ["by_company_and_runId", ["companyId", "runId"]],
    ["by_company_and_requestId", ["companyId", "requestId"]],
    ["by_company_and_baselineRunId", ["companyId", "baselineRunId"]],
    ["by_company", ["companyId"]],
  ],
  timelineQuestions: [
    ["by_company_and_requestId", ["companyId", "requestId"]],
    ["by_company_and_runId", ["companyId", "runId"]],
  ],
  timelineAnalyses: [
    ["by_company_and_analysisId", ["companyId", "analysisId"]],
    ["by_company_and_requestId", ["companyId", "requestId"]],
    ["by_company_and_runId", ["companyId", "runId"]],
  ],
  timelineChats: [
    ["by_company_and_conversationId", ["companyId", "conversationId"]],
    ["by_company_and_runId", ["companyId", "runId"]],
  ],
  timelineChatRequests: [["by_company_and_requestId", ["companyId", "requestId"]]],
  timelineRunRequests: [["by_company_and_requestId", ["companyId", "requestId"]]],
  investigationRequests: [["by_requestId", ["requestId"]]],
  investigationConversations: [
    ["by_conversationId", ["conversationId"]],
    ["by_case_createdAt", ["caseId", "createdAt"]],
  ],
  investigationMessages: [["by_conversation", ["conversationId", "sequence"]]],
  investigationOperations: [
    ["by_operationId", ["operationId"]],
    ["by_conversation", ["conversationId", "sequence"]],
  ],
  timelineLinks: [["by_companyId", ["companyId"]]],
  vendorWebhookSecrets: [["by_companyId_and_vendor", ["companyId", "vendor"]]],
  vendorWebhookEvents: [
    ["by_companyId_and_eventId", ["companyId", "eventId"]],
    ["by_companyId_and_status", ["companyId", "status"]],
  ],
  webhookInbox: [["by_companyId", ["companyId"]]],
};

describe("schema composition", () => {
  it("assigns each table to exactly one lane fragment", () => {
    expect(Object.keys(legacy)).toEqual(["companyId"]);
    expect(Object.keys(timelineTables).sort()).toEqual([...LANES.timeline].sort());
    expect(Object.keys(fieldTables).sort()).toEqual([...LANES.field].sort());
    const all = [...LANES.timeline, ...LANES.field];
    expect(new Set(all).size).toBe(46);
    expect(Object.keys(schema.tables).sort()).toEqual(all.sort());
  });

  it("keeps every index name and field order", () => {
    // " indexes"() is Convex's public (experimental) accessor; export() is internal-only.
    const actual = Object.fromEntries(
      Object.entries(schema.tables).map(([name, table]) => [
        name,
        table[" indexes"]().map((i) => [i.indexDescriptor, i.fields]),
      ]),
    );
    expect(actual).toEqual(INDEXES);
    expect(schema.schemaValidation).toBe(true);
  });
});
