/**
 * Field dashboard (public, read-only). One query that reads the latest ingested snapshot for a
 * feed and runs the pure engine on it (cash flow statement, summary, scheduled items) through
 * the same derivation the demo uses. Integer cents out; the UI formats.
 *
 *   fieldDashboard.summary({ companyId? })   latest feed when omitted. null when no feed.
 *     { companyId, name, asOf, lastSnapshotAt, lastIngestStatus, lastError, auto,
 *       autoIntervalMs, sources: { total, connected, off: tool names }, openFindings, openEscalations,
 *       result: DashboardResult | null }   result is null before the first ingest.
 */
import { CompanyModelSchema, ConstraintSchema, SnapshotSchema } from "@domino/contracts";
import { v } from "convex/values";
import { type DashboardResult, deriveDashboard } from "../components/field/dashboard/derive";
import { query } from "./_generated/server";
import { TOOLS } from "./connectors/catalog";
import { AUTO_INTERVAL_MS } from "./fieldJobs";

const EMPTY_MODEL = { version: 0, customerDelayDays: {}, recurringSpend: [], rules: [] };
const KINDS = [...new Set(TOOLS.map((t) => t.kind))];
const kindOn = (kind: string, on: Set<string>) =>
  TOOLS.some((t) => t.kind === kind && on.has(t.id));

export const summary = query({
  args: { companyId: v.optional(v.id("companies")) },
  handler: async (ctx, args) => {
    const feed = args.companyId
      ? await ctx.db
          .query("feeds")
          .withIndex("by_companyId", (q) => q.eq("companyId", args.companyId!))
          .unique()
      : await ctx.db.query("feeds").order("desc").first();
    if (!feed) return null;
    const { companyId } = feed;
    const company = await ctx.db.get("companies", companyId);
    const connections = await ctx.db
      .query("connections")
      .withIndex("by_companyId_and_tool", (q) => q.eq("companyId", companyId))
      .take(20);
    const on = new Set(connections.filter((c) => c.status !== "disconnected").map((c) => c.tool));
    const open = await ctx.db
      .query("findings")
      .withIndex("by_companyId_and_status", (q) =>
        q.eq("companyId", companyId).eq("status", "open"),
      )
      .take(500);

    let result: DashboardResult | null = null;
    const row = feed.lastSnapshotId ? await ctx.db.get("snapshots", feed.lastSnapshotId) : null;
    if (row) {
      const modelRow = await ctx.db
        .query("models")
        .withIndex("by_company_version", (q) => q.eq("companyId", companyId))
        .order("desc")
        .first();
      const constraintRows = await ctx.db
        .query("constraints")
        .withIndex("by_company", (q) => q.eq("companyId", companyId))
        .take(50);
      result = deriveDashboard({
        snapshot: SnapshotSchema.parse(row.data),
        model: CompanyModelSchema.parse(modelRow?.data ?? EMPTY_MODEL),
        constraints: constraintRows.map((c) => ConstraintSchema.parse(c.data)),
      });
    }

    return {
      companyId,
      name: company?.name ?? "",
      asOf: company?.today ?? null,
      lastSnapshotAt: feed.lastSnapshotAt,
      lastIngestStatus: feed.lastIngestStatus,
      lastError: feed.lastError,
      auto: feed.auto,
      autoIntervalMs: AUTO_INTERVAL_MS,
      // Tools the ingestion reads; a disconnected tool's data stays as of its last read. Counted
      // per kind: Capital One and the simulated bank are two choices for the one bank.
      sources: {
        total: KINDS.length,
        connected: KINDS.filter((k) => kindOn(k, on)).length,
        off: KINDS.filter((k) => !kindOn(k, on)).map(
          (k) => TOOLS.find((t) => t.kind === k)?.name ?? k,
        ),
      },
      openFindings: open.length,
      openEscalations: open.filter((f) => f.escalated).length,
      result,
    };
  },
});
