import { v } from "convex/values";
import { z } from "zod";
import { query } from "./_generated/server";
import { Timestamp, parse } from "./lib/parse";

export const list = query({
  args: { companyId: v.id("companies"), limit: v.number() },
  handler: async (ctx, { companyId, limit }) => {
    const count = parse(z.number().int().min(1).max(200), limit);
    const rows = await ctx.db
      .query("log")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(count);
    for (const row of rows) parse(Timestamp, row.at);
    return rows;
  },
});
