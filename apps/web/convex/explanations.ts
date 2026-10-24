import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { actionReadiness } from "./lib/readiness";
import { requireBranch } from "./lib/records";

export const forBranch = query({
  args: { branchId: v.string() },
  handler: async (ctx, { branchId }) =>
    (
      await ctx.db
        .query("explanations")
        .withIndex("by_branch", (q) => q.eq("branchId", branchId))
        .order("desc")
        .first()
    )?.text ?? null,
});

export const request = mutation({
  args: { companyId: v.id("companies"), branchId: v.string() },
  handler: async (ctx, { companyId, branchId }) => {
    const branch = await requireBranch(ctx, branchId);
    if (branch.row.companyId !== companyId)
      throw new ConvexError("Scenario does not belong to this company");
    const cached = await ctx.db
      .query("explanations")
      .withIndex("by_branch", (q) => q.eq("branchId", branchId))
      .first();
    if (cached || !actionReadiness.explain) return { requested: false };
    await ctx.scheduler.runAfter(0, internal.agents.explain, { branchId });
    return { requested: true };
  },
});
