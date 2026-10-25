import {
  type DataModelFromSchemaDefinition,
  type MutationBuilder,
  type QueryBuilder,
  defineSchema,
  defineTable,
  internalMutationGeneric,
  mutationGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";
export const timelineAnalysesTable = defineTable({
  companyId: v.string(),
  analysisId: v.string(),
  runId: v.string(),
  requestId: v.string(),
  requestHash: v.string(),
  sourceAnalysisId: v.union(v.string(), v.null()),
  leaseUntil: v.number(),
  claimed: v.boolean(),
  data: v.any(),
})
  .index("by_company_and_analysisId", ["companyId", "analysisId"])
  .index("by_company_and_requestId", ["companyId", "requestId"])
  .index("by_company_and_runId", ["companyId", "runId"]);
const schema = defineSchema({ timelineAnalyses: timelineAnalysesTable });
export type AnalysisDataModel = DataModelFromSchemaDefinition<typeof schema>;
export const analysisQuery = queryGeneric as QueryBuilder<AnalysisDataModel, "public">;
export const analysisMutation = mutationGeneric as MutationBuilder<AnalysisDataModel, "public">;
export const analysisInternalMutation = internalMutationGeneric as MutationBuilder<
  AnalysisDataModel,
  "internal"
>;
