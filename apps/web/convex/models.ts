import { CompanyModelSchema } from "@domino/contracts";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { parse } from "./lib/parse";

export const latest = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const row = await ctx.db
      .query("models")
      .withIndex("by_company_version", (q) => q.eq("companyId", companyId))
      .order("desc")
      .first();
    return row ? parse(CompanyModelSchema, row.data) : null;
  },
});
