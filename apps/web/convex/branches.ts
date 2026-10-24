import { BranchSchema } from "@domino/contracts";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { parse } from "./lib/parse";
import { branchRecord } from "./lib/records";

export const list = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const rows = await ctx.db
      .query("branches")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .collect();
    return rows.map((row) => parse(BranchSchema, row.data));
  },
});

export const get = query({
  args: { branchId: v.string() },
  handler: async (ctx, { branchId }) => (await branchRecord(ctx, branchId))?.data ?? null,
});
