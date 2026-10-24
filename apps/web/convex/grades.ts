import { v } from "convex/values";
import { query } from "./_generated/server";
import { GradeFields, parse } from "./lib/parse";

export const list = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const rows = await ctx.db
      .query("grades")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .collect();
    return rows
      .map((row) => ({ ...row, ...parse(GradeFields, row) }))
      .sort((a, b) => a.week.localeCompare(b.week));
  },
});
