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
  ],
  field: [
    "companies",
    "sources",
    "snapshots",
    "models",
    "constraints",
    "approvals",
    "log",
    "investigationRequests",
    "investigationConversations",
    "investigationMessages",
    "investigationOperations",
  ],
};

const INDEXES: Record<string, Array<[string, string[]]>> = {
  companies: [],
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
  log: [["by_company", ["companyId"]]],
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
};

describe("schema composition", () => {
  it("assigns each table to exactly one lane fragment", () => {
    expect(Object.keys(legacy)).toEqual(["companyId"]);
    expect(Object.keys(timelineTables).sort()).toEqual([...LANES.timeline].sort());
    expect(Object.keys(fieldTables).sort()).toEqual([...LANES.field].sort());
    const all = [...LANES.timeline, ...LANES.field];
    expect(new Set(all).size).toBe(22);
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
