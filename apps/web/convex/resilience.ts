import { ResilienceReportSchema } from "@domino/contracts";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { parse } from "./lib/parse";

export const get = query({
  args: { companyId: v.id("companies"), withFixes: v.boolean() },
  handler: async (ctx, { companyId, withFixes }) => {
    const rows = await ctx.db
      .query("resilience")
      .withIndex("by_company_withFixes", (q) =>
        q.eq("companyId", companyId).eq("withFixes", withFixes),
      )
      .collect();
    const row = rows.sort(
      (a, b) => b.asOf.localeCompare(a.asOf) || b._creationTime - a._creationTime,
    )[0];
    return row ? parse(ResilienceReportSchema, row.data) : null;
  },
});
