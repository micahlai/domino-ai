import { defineTable } from "convex/server";
import { v } from "convex/values";

// One row per prediction attempt. `data` is the PredictionReceipt, re-validated on every read.
export const timelinePredictionsTable = defineTable({
  companyId: v.string(),
  predictionId: v.string(),
  runId: v.string(),
  requestId: v.string(),
  leaseUntil: v.number(),
  data: v.any(),
})
  .index("by_company_and_predictionId", ["companyId", "predictionId"])
  .index("by_company_and_requestId", ["companyId", "requestId"])
  .index("by_company_and_runId", ["companyId", "runId"]);
