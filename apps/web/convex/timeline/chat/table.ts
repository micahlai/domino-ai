import { defineTable } from "convex/server";
import { v } from "convex/values";

export const timelineChatsTable = defineTable({
  companyId: v.string(),
  conversationId: v.string(),
  runId: v.string(),
  data: v.any(),
})
  .index("by_company_and_conversationId", ["companyId", "conversationId"])
  .index("by_company_and_runId", ["companyId", "runId"]);

// Accepted request snapshots are separate bounded rows, so retries return their original
// receipt even after the conversation has advanced.
export const timelineChatRequestsTable = defineTable({
  companyId: v.string(),
  requestId: v.string(),
  requestHash: v.string(),
  data: v.any(),
  // Absent on old immutable receipts. Claims reserve the existing request key atomically.
  assistant: v.optional(
    v.object({
      status: v.union(v.literal("running"), v.literal("failed"), v.literal("accepted")),
      attempt: v.number(),
      leaseUntil: v.number(),
    }),
  ),
}).index("by_company_and_requestId", ["companyId", "requestId"]);
