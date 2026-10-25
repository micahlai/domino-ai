/**
 * Connected tools (public). Mock sign-in only: connecting is a consent step, no credentials
 * are asked for or stored, and every vendor API is the in-process mock except the bank, which
 * is the Capital One Nessie sandbox (Domino's own accounts there, fieldNessie.ts). The
 * simulated bank (Plaid mock) stays selectable and stands in when Nessie cannot be used.
 *
 * Queries
 *   connections.list({ companyId? })  latest live-feed company when omitted, null when none:
 *     { companyId, name, asOf, tools: [{ tool, status, account, connectedAt, lastSyncAt,
 *       counts, recordsIn, recordsOut, skipped, checksOk, checksTotal, lastError }] }
 * Mutations
 *   connections.connect({ companyId?, tool, consent: true })  mark connected, then sync.
 *   connections.disconnect({ companyId?, tool })  stop reading the tool; counts are cleared.
 *   connections.syncNow({ companyId? })  read every connected tool again.
 *
 * field.setup connects six tools (Capital One as the bank; the Plaid mock stays disconnected). The field ingestion reads only connected tools through
 * connectors.pullAll and updates these rows; the sync here re-reads them for the Connect page.
 */
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type MutationCtx,
  type QueryCtx,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { TOOLS, toolInfo, toolSummaries } from "./connectors/catalog";
import { pullAll } from "./connectors/pullAll";
import { TOOL_IDS, type ToolId } from "./connectors/types";
import { bankFetcher, writeLog } from "./fieldJobs";
import { prepareNessie } from "./fieldNessie";
import { BANK_FALLBACK } from "./fieldSources";
import { storeToolResults, toolArg, toolResult } from "./lib/connectionRows";

const tool = toolArg;
const AGENT = "field.connectors";

async function companyFor(ctx: QueryCtx, companyId: Id<"companies"> | undefined) {
  if (companyId) return ctx.db.get("companies", companyId);
  const feed = await ctx.db.query("feeds").order("desc").first();
  return feed ? ctx.db.get("companies", feed.companyId) : null;
}

async function requireCompany(ctx: QueryCtx, companyId: Id<"companies"> | undefined) {
  const company = await companyFor(ctx, companyId);
  if (!company) throw new ConvexError("No company yet: start the live feed first");
  return company;
}

const rowFor = (ctx: QueryCtx, companyId: Id<"companies">, t: ToolId) =>
  ctx.db
    .query("connections")
    .withIndex("by_companyId_and_tool", (q) => q.eq("companyId", companyId).eq("tool", t))
    .unique();

async function personName(ctx: { auth: QueryCtx["auth"] }) {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.tokenIdentifier ?? "demo-user (unverified)";
}

const cleared = {
  cursor: null,
  lastSyncAt: null,
  counts: {},
  recordsIn: 0,
  recordsOut: 0,
  skipped: 0,
  checksOk: 0,
  checksTotal: 0,
  lastError: null,
};

function view(t: ToolId, row: Doc<"connections"> | null) {
  return {
    tool: t,
    status: row?.status ?? ("disconnected" as const),
    account: row?.account ?? null,
    connectedAt: row?.status === "disconnected" ? null : (row?.connectedAt ?? null),
    lastSyncAt: row?.lastSyncAt ?? null,
    counts: row?.counts ?? {},
    recordsIn: row?.recordsIn ?? 0,
    recordsOut: row?.recordsOut ?? 0,
    skipped: row?.skipped ?? 0,
    checksOk: row?.checksOk ?? 0,
    checksTotal: row?.checksTotal ?? 0,
    lastError: row?.lastError ?? null,
  };
}

/** The simulated bank is an alternative to Capital One, so it starts disconnected. */
export const DEFAULT_OFF: ToolId[] = ["plaid"];

/** Setup: legacy feeds use Nessie; reconstructed operating feeds use the simulated bank. */
export async function connectAll(
  ctx: MutationCtx,
  companyId: Id<"companies">,
  name: string,
  bank: "nessie" | "plaid" = "nessie",
) {
  const by = await personName(ctx);
  const at = new Date().toISOString();
  for (const t of TOOLS) {
    const off = bank === "plaid" ? t.id === "nessie" : DEFAULT_OFF.includes(t.id);
    await ctx.db.insert("connections", {
      companyId,
      tool: t.id,
      status: off ? "disconnected" : "connected",
      account: `${name} (sandbox)`,
      scopes: t.reads,
      connectedAt: off ? null : at,
      connectedBy: off ? null : by,
      ...cleared,
    });
  }
}

export const list = query({
  args: { companyId: v.optional(v.id("companies")) },
  handler: async (ctx, args) => {
    const company = await companyFor(ctx, args.companyId);
    if (!company) return null;
    const tools = [];
    for (const t of TOOLS) tools.push(view(t.id, await rowFor(ctx, company._id, t.id)));
    return { companyId: company._id, name: company.name, asOf: company.today, tools };
  },
});

export const connect = mutation({
  args: { companyId: v.optional(v.id("companies")), tool, consent: v.boolean() },
  handler: async (ctx, args) => {
    if (!args.consent) throw new ConvexError("Connecting needs your consent to read this tool");
    const company = await requireCompany(ctx, args.companyId);
    const info = toolInfo(args.tool);
    const by = await personName(ctx);
    const at = new Date().toISOString();
    const fields = {
      status: "connected" as const,
      account: `${company.name} (sandbox)`,
      scopes: info.reads,
      connectedAt: at,
      connectedBy: by,
      ...cleared,
    };
    const row = await rowFor(ctx, company._id, args.tool);
    if (row?.status === "connected") return { status: "connected" as const };
    if (row) await ctx.db.patch("connections", row._id, fields);
    else await ctx.db.insert("connections", { companyId: company._id, tool: args.tool, ...fields });
    await writeLog(ctx, company._id, undefined, {
      actor: "person",
      action: "connections.connected",
      refs: [args.tool],
      agent: AGENT,
      tool: `${args.tool}.consent`,
      source: args.tool,
      summary: `${info.name} connected (read only): ${info.reads.join(", ")}`,
    });
    await ctx.scheduler.runAfter(0, internal.connections.sync, { companyId: company._id });
    return { status: "connected" as const };
  },
});

export const disconnect = mutation({
  args: { companyId: v.optional(v.id("companies")), tool },
  handler: async (ctx, args) => {
    const company = await requireCompany(ctx, args.companyId);
    const row = await rowFor(ctx, company._id, args.tool);
    if (!row || row.status === "disconnected") return { status: "disconnected" as const };
    await ctx.db.patch("connections", row._id, { status: "disconnected", ...cleared });
    await writeLog(ctx, company._id, undefined, {
      actor: "person",
      action: "connections.disconnected",
      refs: [args.tool],
      agent: AGENT,
      source: args.tool,
      summary: `${toolInfo(args.tool).name} disconnected; Domino stopped reading it`,
    });
    return { status: "disconnected" as const };
  },
});

export const syncNow = mutation({
  args: { companyId: v.optional(v.id("companies")) },
  handler: async (ctx, args) => {
    const company = await requireCompany(ctx, args.companyId);
    await ctx.scheduler.runAfter(0, internal.connections.sync, { companyId: company._id });
    return null;
  },
});

export const connected = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const rows = await ctx.db
      .query("connections")
      .withIndex("by_companyId_and_tool", (q) => q.eq("companyId", companyId))
      .take(TOOL_IDS.length);
    return rows.map((r) => ({ tool: r.tool, status: r.status }));
  },
});

export const recordSync = internalMutation({
  args: {
    companyId: v.id("companies"),
    at: v.string(),
    results: v.array(toolResult),
    summary: v.string(),
  },
  handler: async (ctx: MutationCtx, { companyId, at, results, summary }) => {
    await storeToolResults(ctx, companyId, at, results);
    await writeLog(ctx, companyId, undefined, {
      actor: "connector",
      action: "connections.synced",
      refs: results.map((r) => r.tool),
      agent: AGENT,
      tool: "connectors.pullAll",
      summary,
    });
    return null;
  },
});

export const sync = internalAction({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const connections = await ctx.runQuery(internal.connections.connected, { companyId });
    const live = connections.filter((c) => c.status !== "disconnected");
    if (live.length === 0) return null;
    const snapshot = await ctx.runQuery(internal.fieldJobs.served, { companyId });
    let tools = live.map((c) => c.tool);
    const bank = tools.includes("nessie") ? await prepareNessie(ctx, companyId, snapshot) : null;
    // Nessie cannot be used: read the simulated bank instead and say so on the Capital One card.
    if (bank && !bank.ok)
      tools = [...new Set([...tools.filter((t) => t !== "nessie"), "plaid" as const])];
    const r = await pullAll({
      fetcher: bankFetcher(snapshot, bank),
      companyId: snapshot.companyId,
      nessie: bank?.ok ? bank.plan : null,
      // An errored tool is retried on every sync.
      connections: tools.map((tool) => ({ tool, status: "connected" as const })),
    });
    const results = toolSummaries(r);
    if (bank && !bank.ok)
      results.push({
        tool: "nessie",
        error: `${BANK_FALLBACK}: ${bank.reason}`.slice(0, 300),
        cursor: null,
        counts: {},
        recordsIn: 0,
        recordsOut: 0,
        skipped: 0,
        checksOk: 0,
        checksTotal: 0,
      });
    const ok = r.checks.filter((c) => c.ok).length;
    const total = (k: "recordsIn" | "recordsOut" | "skipped") =>
      results.reduce((t, x) => t + x[k], 0);
    await ctx.runMutation(internal.connections.recordSync, {
      companyId,
      at: new Date().toISOString(),
      results,
      summary: [
        `Read ${results.length} tools: ${total("recordsIn")} records in, ${total("recordsOut")} kept,`,
        `${total("skipped")} skipped with a reason; ${ok} of ${r.checks.length} cross-tool checks agree`,
        ...(r.snapshotError ? [`(${r.snapshotError})`] : []),
      ].join(" "),
    });
    return null;
  },
});
