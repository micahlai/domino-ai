import { RiskEventSchema } from "@domino/contracts";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { parse } from "./lib/parse";

export const list = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const rows = await ctx.db
      .query("risks")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .collect();
    const latestDate = rows.reduce((date, row) => (row.asOf > date ? row.asOf : date), "");
    return rows
      .filter((row) => row.asOf === latestDate)
      .map((row) => parse(RiskEventSchema, row.data))
      .sort(
        (a, b) =>
          b.probability * b.impactLowPoint - a.probability * a.impactLowPoint ||
          a.id.localeCompare(b.id),
      );
  },
});
