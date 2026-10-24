import { ConstraintSchema } from "@domino/contracts";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { parse } from "./lib/parse";

export const list = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const rows = await ctx.db
      .query("constraints")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .collect();
    return rows.map((row) => parse(ConstraintSchema, row.data));
  },
});
