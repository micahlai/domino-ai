/**
 * Customers page (public, read only). Reads the selected company's latest saved snapshot, learned
 * model, cash rules, open audit findings and saved public-web results, then runs the pure
 * derivation in components/field/customers/derive.ts (engine forecast, risks and dominoes).
 *
 *   fieldCustomers.list({ companyId })  null when the company has no feed;
 *     { name, result: CustomersView | null }  result is null before the first ingest.
 */
import { CompanyModelSchema, ConstraintSchema, SnapshotSchema } from "@domino/contracts";
import { v } from "convex/values";
import {
  type CustomerFinding,
  type CustomerSignal,
  type CustomersView,
  deriveCustomers,
} from "../components/field/customers/derive";
import { query } from "./_generated/server";
import { signalKey } from "./lib/apify";

const EMPTY_MODEL = { version: 0, customerDelayDays: {}, recurringSpend: [], rules: [] };
const MAX_SIGNAL_LOOKUPS = 60;

export const list = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const feed = await ctx.db
      .query("feeds")
      .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
      .unique();
    if (!feed) return null;
    const company = await ctx.db.get("companies", companyId);
    const row = feed.lastSnapshotId ? await ctx.db.get("snapshots", feed.lastSnapshotId) : null;
    if (!row) return { name: company?.name ?? "", result: null };
    const snapshot = SnapshotSchema.parse(row.data);
    const modelRow = await ctx.db
      .query("models")
      .withIndex("by_company_version", (q) => q.eq("companyId", companyId))
      .order("desc")
      .first();
    const constraintRows = await ctx.db
      .query("constraints")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .take(50);
    const connections = await ctx.db
      .query("connections")
      .withIndex("by_companyId_and_tool", (q) => q.eq("companyId", companyId))
      .take(20);
    const findingRows = await ctx.db
      .query("findings")
      .withIndex("by_companyId_and_status", (q) =>
        q.eq("companyId", companyId).eq("status", "open"),
      )
      .take(500);
    const findings: CustomerFinding[] = findingRows.map((f) => ({
      summary: f.summary,
      severity: f.severity,
      refs: f.refs,
    }));
    const signals: Record<string, CustomerSignal[]> = {};
    for (const customer of snapshot.customers.slice(0, MAX_SIGNAL_LOOKUPS)) {
      const runs = await ctx.db
        .query("apifyRuns")
        .withIndex("by_key_and_at", (q) => q.eq("key", signalKey(customer.name)))
        .order("desc")
        .take(5);
      const ok = runs.find((r) => r.status === "ok" && r.signals?.length);
      if (ok?.signals)
        signals[customer.id] = ok.signals.map((s) => ({
          title: s.title,
          source: s.source,
          ...(s.date !== undefined && { date: s.date }),
          kinds: s.kinds,
        }));
    }
    const result: CustomersView = deriveCustomers({
      snapshot,
      model: CompanyModelSchema.parse(modelRow?.data ?? EMPTY_MODEL),
      constraints: constraintRows.map((c) => ConstraintSchema.parse(c.data)),
      connected: connections.filter((c) => c.status !== "disconnected").map((c) => c.tool),
      findings,
      signals,
    });
    return { name: company?.name ?? "", result };
  },
});
