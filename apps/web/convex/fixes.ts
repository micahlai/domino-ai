import { FixCandidateSchema } from "@domino/contracts";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { isComputed } from "./lib/computed";
import { Cents, parse } from "./lib/parse";
import { branchRecord, candidateRecord, missing, requireBranch } from "./lib/records";

export const forBranch = query({
  args: { branchId: v.string() },
  handler: async (ctx, { branchId }) => {
    const branch = await branchRecord(ctx, branchId);
    if (!branch) return [];
    const rows = await ctx.db
      .query("fixes")
      .withIndex("by_branch", (q) => q.eq("branchId", branchId))
      .collect();
    const fixes = rows
      .filter((row) => row.companyId === branch.row.companyId)
      .map((row) => ({ fix: parse(FixCandidateSchema, row.data), gain: parse(Cents, row.gain) }));
    // Computed futures store rows in engine rank order (rules cleared first); a gain-only
    // sort would undo it. Illustrative fixture rows keep the original gain order.
    if (isComputed(branch.row.companyId, branchId)) return fixes;
    return fixes.sort((a, b) => b.gain - a.gain || a.fix.id.localeCompare(b.fix.id));
  },
});

export const simulate = mutation({
  args: { branchId: v.string(), fixId: v.string() },
  handler: async (ctx, { branchId, fixId }): Promise<null> => {
    const branch = await requireBranch(ctx, branchId);
    const candidate = await candidateRecord(ctx, branchId, fixId);
    if (!candidate || candidate.row.companyId !== branch.row.companyId)
      missing("Fix not found for this future");
    await ctx.scheduler.runAfter(0, internal.engine.simulateFix, { branchId, fixId });
    return null;
  },
});
