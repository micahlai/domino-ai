/**
 * Agent start (public). A newly selected operating company or judge sandbox starts idle: its
 * company, connections, mock world and source rows exist, but no ingest, analyst or clock work
 * is scheduled until a person presses Start agents on the Brain map. Older companies that
 * already saved a snapshot count as started (no migration), so existing baselines are untouched.
 *
 * Queries
 *   fieldAgents.state({ companyId })  null when the company is unknown, else
 *     { companyId, name, started, startedAt, tools: ToolId[] (connected),
 *       phase: "idle" | "reading" | "ready" | "failed", analystRunning }
 *     "reading" = started and the first read of the books has not finished yet.
 * Mutations
 *   fieldAgents.start({ companyId, sources? })  idempotent: marks started and queues the first
 *     ingest (which cascades to audit, flag explanations and the analyst as before). Calling it
 *     again, or on an already started company, schedules nothing. { started, scheduled, startedAt }
 *     `sources` (idle companies only): the connected tools to keep; the rest are disconnected
 *     before the first read. The bank must stay on, and HubSpot needs Stripe.
 */
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type MutationCtx,
  type QueryCtx,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { TOOL_IDS, type ToolId } from "./connectors/types";
import { AGENT, requireFeed, writeLog } from "./fieldJobs";

export const AGENTS_IDLE_MESSAGE = "Start agents first: open the Brain map and press Start agents";

type Db = Pick<QueryCtx, "db">;

/** Started = pressed Start agents, or (older rows) any snapshot was ever saved. */
export async function agentsStatus(ctx: Db, company: Doc<"companies">) {
  if (company.agentsStartedAt) return { started: true, startedAt: company.agentsStartedAt };
  const snapshot = await ctx.db
    .query("snapshots")
    .withIndex("by_company_asOf", (q) => q.eq("companyId", company._id))
    .first();
  return { started: snapshot !== null, startedAt: null };
}

export async function agentsStarted(ctx: Db, companyId: Id<"companies">) {
  const company = await ctx.db.get("companies", companyId);
  // An unknown company is left to the caller's own checks.
  return company ? (await agentsStatus(ctx, company)).started : true;
}

/** Throws AGENTS_IDLE for an idle company: no clock, ingest or analyst work before Start. */
export async function requireAgentsStarted(ctx: Db, companyId: Id<"companies">) {
  if (!(await agentsStarted(ctx, companyId)))
    throw new ConvexError({ code: "AGENTS_IDLE", message: AGENTS_IDLE_MESSAGE });
}

export const isStarted = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => agentsStarted(ctx, companyId),
});

export const state = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const company = await ctx.db.get("companies", companyId);
    if (!company) return null;
    const { started, startedAt } = await agentsStatus(ctx, company);
    const feed = await ctx.db
      .query("feeds")
      .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
      .unique();
    const rows = await ctx.db
      .query("connections")
      .withIndex("by_companyId_and_tool", (q) => q.eq("companyId", companyId))
      .take(TOOL_IDS.length);
    const tools = TOOL_IDS.filter((tool) =>
      rows.some((r) => r.tool === tool && r.status !== "disconnected"),
    );
    const last = await ctx.db
      .query("analystRuns")
      .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
      .order("desc")
      .first();
    const read = (feed?.snapshotVersion ?? 0) > 0;
    const phase = !started
      ? ("idle" as const)
      : read
        ? ("ready" as const)
        : feed?.lastIngestStatus === "failed"
          ? ("failed" as const)
          : ("reading" as const);
    return {
      companyId,
      name: company.name,
      started,
      startedAt,
      tools,
      phase,
      analystRunning: last?.status === "running",
    };
  },
});

const BANKS: readonly ToolId[] = ["plaid", "nessie"];
/** Tools that only make sense with another one on (same rule as the judge sandbox). */
const NEEDS: Partial<Record<ToolId, ToolId>> = { hubspot: "stripe" };

const refuse = (message: string) => new ConvexError({ code: "BAD_SOURCES", message });

/** Keeps only `keep` of the company's connected tools. Validated before anything is changed. */
async function applySources(ctx: MutationCtx, companyId: Id<"companies">, keep: string[]) {
  const rows = await ctx.db
    .query("connections")
    .withIndex("by_companyId_and_tool", (q) => q.eq("companyId", companyId))
    .take(TOOL_IDS.length);
  const live = rows.filter((r) => r.status !== "disconnected");
  for (const tool of keep)
    if (!live.some((r) => r.tool === tool)) throw refuse(`Not a connected tool: ${tool}`);
  if (live.some((r) => BANKS.includes(r.tool) && !keep.includes(r.tool)))
    throw refuse("Keep the bank connected: the forecast starts from its cash balance");
  for (const [tool, needs] of Object.entries(NEEDS))
    if (keep.includes(tool) && !keep.includes(needs))
      throw refuse("HubSpot needs Stripe: its deals point at Stripe invoices");
  for (const row of live)
    if (!keep.includes(row.tool))
      await ctx.db.patch("connections", row._id, {
        status: "disconnected",
        connectedAt: null,
        connectedBy: null,
      });
}

async function startAgents(ctx: MutationCtx, companyId: Id<"companies">, sources?: string[]) {
  const company = await ctx.db.get("companies", companyId);
  if (!company) throw new ConvexError({ code: "NOT_FOUND", message: "No such company" });
  if (company.judgeArchivedAt)
    throw new ConvexError({ code: "ARCHIVED", message: "This sandbox company was reset" });
  await requireFeed(ctx, companyId);
  const status = await agentsStatus(ctx, company);
  if (status.started) return { started: true, scheduled: false, startedAt: status.startedAt };
  if (sources) await applySources(ctx, companyId, sources);
  const startedAt = new Date().toISOString();
  await ctx.db.patch("companies", companyId, { agentsStartedAt: startedAt });
  await writeLog(ctx, companyId, undefined, {
    actor: "person",
    action: "ingest.requested",
    refs: ["agents.start"],
    agent: AGENT,
    summary: "Agents started: first read of the connected tools requested",
  });
  await ctx.scheduler.runAfter(0, internal.fieldJobs.ingestRun, { companyId, trigger: "start" });
  return { started: true, scheduled: true, startedAt };
}

export const start = mutation({
  args: { companyId: v.id("companies"), sources: v.optional(v.array(v.string())) },
  handler: async (ctx, { companyId, sources }) => startAgents(ctx, companyId, sources),
});
