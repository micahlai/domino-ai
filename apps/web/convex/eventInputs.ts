import { SnapshotSchema } from "@domino/contracts";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { parse } from "./lib/parse";

export const get = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    if (!(await ctx.db.get(companyId))) return null;
    const row = await ctx.db
      .query("snapshots")
      .withIndex("by_company_asOf", (q) => q.eq("companyId", companyId))
      .order("desc")
      .first();
    if (!row) return null;
    const snapshot = parse(SnapshotSchema, row.data);
    return { asOf: snapshot.asOf, customers: snapshot.customers, invoices: snapshot.invoices };
  },
});
