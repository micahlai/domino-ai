import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { CompanyFields, CreateCompany, parse } from "./lib/parse";

export const get = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const row = await ctx.db.get(companyId);
    if (!row) return null;
    parse(CompanyFields, row);
    return row;
  },
});

export const create = mutation({
  args: { name: v.string(), profile: v.string() },
  handler: async (ctx, args): Promise<Id<"companies">> => {
    const input = parse(CreateCompany, args);
    const companyId = await ctx.db.insert(
      "companies",
      parse(CompanyFields, {
        ...input,
        currentWeek: 0,
        today: new Date().toISOString().slice(0, 10),
        status: "connecting",
      }),
    );
    await ctx.scheduler.runAfter(0, internal.connect.run, { companyId });
    return companyId;
  },
});
