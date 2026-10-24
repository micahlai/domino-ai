import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { baseBranchId } from "./lib/computed";
import { CompanyFields, CreateCompany, parse } from "./lib/parse";
import { branchRecord } from "./lib/records";

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

/**
 * I3: events and fixes need a saved computed base for the latest snapshot, which is what the
 * engine actions run on. Fixture or legacy branch IDs never match the helper, so they stay off.
 * Week advancement is not built yet.
 */
export const capabilities = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const off = { addEvent: false, simulate: false, nextWeek: false };
    if (!(await ctx.db.get(companyId))) return off;
    const snapshot = await ctx.db
      .query("snapshots")
      .withIndex("by_company_asOf", (q) => q.eq("companyId", companyId))
      .order("desc")
      .first();
    if (!snapshot) return off;
    const base = await branchRecord(ctx, baseBranchId(companyId, snapshot.asOf));
    const ready = base?.row.companyId === companyId && base.data.kind === "base";
    return { addEvent: ready, simulate: ready, nextWeek: false };
  },
});
