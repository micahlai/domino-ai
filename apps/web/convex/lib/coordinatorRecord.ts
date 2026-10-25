import { type Infer, v } from "convex/values";

/**
 * Stored coordinator outcome (analystRuns.coordinator). Lives here, not in fieldCoordinator.ts,
 * because fieldAnalyst.ts needs it at module load and fieldCoordinator.ts imports fieldAnalyst.
 */
export const coordinatorRecordArg = v.object({
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
});
export type CoordinatorRecord = Infer<typeof coordinatorRecordArg>;
