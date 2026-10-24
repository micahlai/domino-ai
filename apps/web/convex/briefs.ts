import { EvidenceSchema } from "@domino/contracts";
import { ConvexError, v } from "convex/values";
import { z } from "zod";
import { internalMutation, query } from "./_generated/server";
import { Timestamp, Week, parse } from "./lib/parse";
import { requireCompany } from "./lib/records";
const Brief = z.object({
  week: Week,
  text: z.string().trim().min(1).max(6000),
  evidence: z.array(EvidenceSchema),
  at: Timestamp,
});
export const latest = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const row = await ctx.db
      .query("briefs")
      .withIndex("by_company_week", (q) => q.eq("companyId", companyId))
      .order("desc")
      .first();
    return row ? parse(Brief, row) : null;
  },
});
export const save = internalMutation({
  args: { companyId: v.id("companies"), week: v.string(), text: v.string(), evidence: v.any() },
  handler: async (ctx, args) => {
    const company = await requireCompany(ctx, args.companyId);
    const data = parse(Brief, { ...args, at: new Date().toISOString() });
    if (data.week > company.today)
      throw new ConvexError("Brief week is later than the company’s current date");
    const existing = await ctx.db
      .query("briefs")
      .withIndex("by_company_week", (q) => q.eq("companyId", args.companyId).eq("week", data.week))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, data);
      return existing._id;
    }
    return ctx.db.insert("briefs", { companyId: args.companyId, ...data });
  },
});
