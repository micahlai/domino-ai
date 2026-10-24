import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, mutation } from "./_generated/server";
import { requireCompany } from "./lib/records";

export const next = mutation({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }): Promise<null> => {
    await requireCompany(ctx, companyId);
    await ctx.scheduler.runAfter(0, internal.week.advance, { companyId });
    return null;
  },
});

/** E7 replaces this placeholder; no simulated result is reported as real. */
export const advance = internalAction({
  args: { companyId: v.id("companies") },
  handler: async (): Promise<never> => {
    throw new Error("not built");
  },
});
