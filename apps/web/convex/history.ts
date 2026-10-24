import { HistoryWeekSchema, PastEventSchema } from "@domino/contracts";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { parse } from "./lib/parse";

export const get = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const row = await ctx.db
      .query("history")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .unique();
    return row
      ? {
          weeks: parse(HistoryWeekSchema.array(), row.weeks),
          pastEvents: parse(PastEventSchema.array(), row.pastEvents),
        }
      : null;
  },
});
