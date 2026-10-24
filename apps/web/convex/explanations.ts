import { v } from "convex/values";
import { query } from "./_generated/server";

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
