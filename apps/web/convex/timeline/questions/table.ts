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

/**
 * `timelineQuestions` columns frozen in kb/features/timeline/TL2-TL5-interface.md. The schema
 * owner (TL2B) adds this table to ./schemas/timeline.schema.ts; this module does not edit the
 * schema. Questions functions are typed against this one-table data model so they compile
 * before and after that schema lands. Only timeline/questions writes these rows.
 */
export const timelineQuestionsTable = defineTable({
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
  .index("by_company_and_runId", ["companyId", "runId"]);

const questionsSchema = defineSchema({ timelineQuestions: timelineQuestionsTable });
export type QuestionsDataModel = DataModelFromSchemaDefinition<typeof questionsSchema>;

export const questionQuery = queryGeneric as QueryBuilder<QuestionsDataModel, "public">;
export const questionMutation = mutationGeneric as MutationBuilder<QuestionsDataModel, "public">;
export const questionInternalMutation = internalMutationGeneric as MutationBuilder<
  QuestionsDataModel,
  "internal"
>;
