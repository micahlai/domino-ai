import { type Snapshot, SnapshotSchema, WorldStateSchema, canonicalJson } from "@domino/contracts";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { toolInfo } from "./connectors/catalog";
import { inProcessFetcher } from "./connectors/inProcess";
import { nessieFetcher, withNessie } from "./connectors/nessie";
import type { ToolId } from "./connectors/types";
import { runAuditSwarm } from "./fieldAudit";
import { type Overlay, servedSnapshot } from "./fieldFeed";
import { type Prepared, prepareNessie } from "./fieldNessie";
import {
  BANK_FALLBACK,
  type Ingested,
  type Pull,
  SOURCE_OF_TOOL,
  ingestConnected,
} from "./fieldSources";
import { storeToolResults, toolArg, toolResult } from "./lib/connectionRows";
import { computedRefs } from "./lib/refs";

/**
 * Field ingestion agent (internal). One run: read every connected tool through the connectors
 * (connectors/pullAll over the in-process vendor mocks, and the bank from the Capital One
 * Nessie sandbox after posting the week's lines to Domino's own accounts there; the simulated
 * bank stands in when Nessie cannot be used), map and validate, then commit a new immutable snapshot version, audit it
 * with the audit swarm (fieldAudit.ts: parallel checker agents), store
 * findings and recompute the forecast. Every step writes a `log` row naming the agent, tool
 * and data source. Deterministic code only: no money estimate, no real API. The one model call
 * (Claude explaining new flags) runs separately in fieldAi.explainNewFindings.
 */

/**
 * Auto-ingest cadence and bound: one tick every 45 s, at most 120 ticks per enable. A fallback
 * only: the simulated clock (fieldClock.ts) ingests right after each day it adds entries.
 */
export const AUTO_INTERVAL_MS = 45_000;
export const AUTO_MAX_TICKS = 120;
export const AGENT = "field.ingest";
const LISTS = [
  "customers",
  "invoices",
  "bankTxns",
  "bills",
  "cardTxns",
  "payroll",
  "deals",
] as const;

type Actor = "person" | "engine" | "connector";
export interface Step {
  actor: Actor;
  action: string;
  refs: string[];
  agent: string;
  tool?: string;
  source?: string;
  summary: string;
}

export async function writeLog(
  ctx: Pick<MutationCtx, "db">,
  companyId: Id<"companies">,
  runId: string | undefined,
  step: Step,
) {
  await ctx.db.insert("log", {
    companyId,
    actor: step.actor,
    action: step.action,
    refs: step.refs.slice(0, 64),
    at: new Date().toISOString(),
    agent: step.agent,
    summary: step.summary.slice(0, 500),
    ...(step.tool && { tool: step.tool }),
    ...(step.source && { source: step.source }),
    ...(runId && { runId }),
  });
}

export async function requireFeed(ctx: Pick<QueryCtx, "db">, companyId: Id<"companies">) {
  const feed = await ctx.db
    .query("feeds")
    .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
    .unique();
  if (!feed) throw new Error("This company has no live feed; run field.setup first");
  return feed;
}

export async function requireWorld(ctx: Pick<QueryCtx, "db">, companyId: Id<"companies">) {
  const row = await ctx.db
    .query("feedWorlds")
    .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
    .unique();
  if (!row) throw new Error("This company has no mock world");
  return { row, world: WorldStateSchema.parse(row.world), overlay: row.overlay as Overlay };
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const idsOf = (s: Snapshot) => new Set(LISTS.flatMap((k) => s[k].map((r) => r.id)));

/** What the mock sources would serve right now (observable snapshot only). */
export const served = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const { world, overlay } = await requireWorld(ctx, companyId);
    return servedSnapshot(world, overlay);
  },
});

/** One ingest's inputs: what the vendor mocks serve, which tools are connected, last version. */
export const ingestInputs = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const { world, overlay } = await requireWorld(ctx, companyId);
    const feed = await requireFeed(ctx, companyId);
    const rows = await ctx.db
      .query("connections")
      .withIndex("by_companyId_and_tool", (q) => q.eq("companyId", companyId))
      .take(20);
    const prev = feed.lastSnapshotId ? await ctx.db.get("snapshots", feed.lastSnapshotId) : null;
    return {
      served: servedSnapshot(world, overlay),
      connected: rows.filter((r) => r.status !== "disconnected").map((r) => r.tool),
      previous: prev ? SnapshotSchema.parse(prev.data) : null,
    };
  },
});

export const logStep = internalMutation({
  args: {
    companyId: v.id("companies"),
    runId: v.string(),
    actor: v.union(v.literal("person"), v.literal("engine"), v.literal("connector")),
    action: v.string(),
    refs: v.array(v.string()),
    agent: v.string(),
    tool: v.optional(v.string()),
    source: v.optional(v.string()),
    summary: v.string(),
    failed: v.optional(v.string()),
  },
  handler: async (ctx, { companyId, runId, failed, ...step }) => {
    await writeLog(ctx, companyId, runId, step);
    if (failed !== undefined) {
      const feed = await requireFeed(ctx, companyId);
      await ctx.db.patch("feeds", feed._id, {
        lastIngestAt: new Date().toISOString(),
        lastIngestStatus: "failed",
        lastError: failed.slice(0, 500),
      });
    }
    return null;
  },
});

const pullStep = (p: Pull): Step => ({
  actor: "connector",
  action: "ingest.pulled",
  refs: p.endpoints,
  agent: AGENT,
  tool: `${p.tool}.read`,
  source: p.tool,
  summary: `Read ${p.records} records from ${toolInfo(p.tool).name} in ${p.pages} page${p.pages === 1 ? "" : "s"}`,
});

const toolNames = (tools: ToolId[]) => tools.map((t) => toolInfo(t).name).join(", ");

/** Commit one ingest: new snapshot version (old ones untouched), findings and log rows. */
export const commit = internalMutation({
  args: {
    companyId: v.id("companies"),
    runId: v.string(),
    hash: v.string(),
    snapshot: v.any(),
    pulls: v.array(
      v.object({
        tool: toolArg,
        endpoints: v.array(v.string()),
        records: v.number(),
        pages: v.number(),
        tiedOut: v.boolean(),
      }),
    ),
    skipped: v.array(toolArg),
    stale: v.array(v.string()),
    results: v.array(toolResult),
    tieOut: v.object({ checked: v.number(), mismatches: v.array(v.string()) }),
    tieOutFailed: v.array(v.object({ name: v.string(), ref: v.string(), detail: v.string() })),
    bankFallback: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const { companyId, runId, hash, pulls, skipped, stale, results, tieOut } = args;
    const snapshot = SnapshotSchema.parse(args.snapshot);
    const feed = await requireFeed(ctx, companyId);
    // The previous version must finish its audit before another snapshot can replace its inputs.
    if (feed.auditPending) return { changed: false as const, pending: feed.auditPending };
    const at = new Date().toISOString();
    if (args.bankFallback)
      await writeLog(ctx, companyId, runId, {
        actor: "connector",
        action: "ingest.bankFallback",
        refs: ["nessie", "plaid"],
        agent: AGENT,
        tool: "nessie.read",
        source: "nessie",
        summary: `${BANK_FALLBACK}: ${args.bankFallback}`,
      });
    for (const p of pulls) await writeLog(ctx, companyId, runId, pullStep(p));
    if (skipped.length > 0)
      await writeLog(ctx, companyId, runId, {
        actor: "connector",
        action: "ingest.skipped",
        refs: skipped,
        agent: AGENT,
        summary: `Skipped ${toolNames(skipped)}: disconnected${
          stale.length > 0 ? `; kept the last ${stale.join(", ")} (stale until reconnected)` : ""
        }`,
      });
    await recordSources(ctx, companyId, snapshot.asOf, pulls);
    await storeToolResults(ctx, companyId, at, results);
    await writeLog(ctx, companyId, runId, {
      actor: "connector",
      action: "ingest.reconciled",
      refs: tieOut.mismatches.length > 0 ? tieOut.mismatches : pulls.map((p) => p.tool),
      agent: AGENT,
      tool: "field.tieOut",
      summary:
        tieOut.mismatches.length === 0
          ? `All ${tieOut.checked} cross-tool checks agree to the cent`
          : `${tieOut.mismatches.length} of ${tieOut.checked} cross-tool checks disagree`,
    });
    if (hash === feed.lastSnapshotHash) {
      await writeLog(ctx, companyId, runId, {
        actor: "connector",
        action: "ingest.noChange",
        refs: feed.lastSnapshotId ? [feed.lastSnapshotId] : [],
        agent: AGENT,
        summary: "No new or changed entries since the last version",
      });
      await ctx.db.patch("feeds", feed._id, {
        lastIngestAt: at,
        lastIngestStatus: "no_change",
        lastError: null,
      });
      return { changed: false as const, pending: null };
    }
    const prevRow = feed.lastSnapshotId ? await ctx.db.get("snapshots", feed.lastSnapshotId) : null;
    const previous = prevRow ? SnapshotSchema.parse(prevRow.data) : null;
    const before = previous ? idsOf(previous) : new Set<string>();
    const fresh = [...idsOf(snapshot)].filter((id) => !before.has(id));
    const recordCounts = Object.fromEntries(LISTS.map((k) => [k, snapshot[k].length]));
    await writeLog(ctx, companyId, runId, {
      actor: "connector",
      action: "ingest.mapped",
      refs: fresh,
      agent: AGENT,
      tool: "field.map",
      summary: `Mapped ${LISTS.reduce((n, k) => n + snapshot[k].length, 0)} records to the snapshot contract; ${fresh.length} new`,
    });

    const version = feed.snapshotVersion + 1;
    const snapshotId = await ctx.db.insert("snapshots", {
      companyId,
      asOf: snapshot.asOf,
      data: snapshot,
    });
    await writeLog(ctx, companyId, runId, {
      actor: "connector",
      action: "ingest.snapshotWritten",
      refs: [snapshotId, `v${version}`, hash],
      agent: AGENT,
      tool: "convex.snapshots",
      summary: `Wrote snapshot version ${version} as of ${snapshot.asOf}`,
    });

    await ctx.db.patch("companies", companyId, {
      today: snapshot.asOf,
      currentWeek: feed.week,
      status: "ready",
    });
    const pending = {
      snapshotId,
      ...(feed.lastSnapshotId && { previousId: feed.lastSnapshotId }),
      version,
      tieOut: args.tieOutFailed,
      phase: "audit" as const,
      newFindings: 0,
    };
    await ctx.db.patch("feeds", feed._id, {
      snapshotVersion: version,
      lastSnapshotId: snapshotId,
      lastSnapshotHash: hash,
      lastSnapshotAt: at,
      lastIngestAt: at,
      lastIngestStatus: null,
      lastError: null,
      recordCounts,
      auditPending: pending,
    });
    // The audit swarm (fieldAudit.ts) checks this version next, from the ingest action.
    return {
      changed: true as const,
      snapshotId,
      version,
      pending,
    };
  },
});

/** Read pending work before fetching sources, so an unchanged retry can finish it directly. */
export const pendingAudit = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => (await requireFeed(ctx, companyId)).auditPending ?? null,
});

export const finishPendingAudit = internalMutation({
  args: { companyId: v.id("companies"), snapshotId: v.id("snapshots") },
  handler: async (ctx, { companyId, snapshotId }) => {
    const feed = await requireFeed(ctx, companyId);
    if (feed.auditPending?.snapshotId !== snapshotId || feed.auditPending.phase !== "recompute")
      return false;
    await ctx.db.patch("feeds", feed._id, {
      auditPending: undefined,
      lastIngestAt: new Date().toISOString(),
      lastIngestStatus: "ok",
      lastError: null,
    });
    return true;
  },
});

/** Only tools read this run move forward; a disconnected tool's row keeps its last pull. */
async function recordSources(
  ctx: MutationCtx,
  companyId: Id<"companies">,
  asOf: string,
  pulls: Pull[],
) {
  const rows = await ctx.db
    .query("sources")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .take(20);
  for (const p of pulls) {
    const row = rows.find((r) => r.kind === SOURCE_OF_TOOL[p.tool]);
    if (!row) continue;
    await ctx.db.patch("sources", row._id, {
      lastPull: asOf,
      step: `${toolInfo(p.tool).name}: ${p.records} records`,
      tieOut: p.tiedOut ? "ok" : "needs_review",
    });
  }
}

export type IngestResult =
  | { changed: false; error?: string }
  | {
      changed: true;
      snapshotId: Id<"snapshots">;
      version: number;
      newFindings: number;
      recomputed: boolean;
    };

type PendingAudit = NonNullable<Doc<"feeds">["auditPending"]>;

/** Finish the exact snapshot committed earlier; a failed check or recompute leaves it retryable. */
async function completePendingAudit(
  ctx: ActionCtx,
  companyId: Id<"companies">,
  runId: string,
  pending: PendingAudit,
): Promise<IngestResult> {
  const { snapshotId, version } = pending;
  let newFindings = pending.newFindings;
  if (pending.phase === "audit") {
    await runAuditSwarm(ctx, {
      companyId,
      ingestRunId: runId,
      snapshotId,
      ...(pending.previousId && { previousId: pending.previousId }),
      version,
      tieOut: pending.tieOut,
    });
    const latest: PendingAudit | null = await ctx.runQuery(internal.fieldJobs.pendingAudit, {
      companyId,
    });
    if (!latest || latest.snapshotId !== snapshotId || latest.phase !== "recompute")
      return { changed: false };
    newFindings = latest.newFindings;
  }
  try {
    const r = await recomputeWithRetry(ctx, companyId);
    await ctx.runMutation(internal.fieldJobs.logStep, {
      companyId,
      runId,
      actor: "engine",
      action: "ingest.recomputed",
      refs: [snapshotId],
      agent: AGENT,
      tool: "engine.recompute",
      summary: `Forecast and risks recomputed as of ${r.asOf}${r.changed ? "" : " (unchanged)"}`,
    });
  } catch (error) {
    await ctx.runMutation(internal.fieldJobs.logStep, {
      companyId,
      runId,
      actor: "engine",
      action: "ingest.recomputeFailed",
      refs: [snapshotId],
      agent: AGENT,
      tool: "engine.recompute",
      summary: `Forecast recompute refused: ${message(error)}`,
    });
    throw error;
  }
  const finished: boolean = await ctx.runMutation(internal.fieldJobs.finishPendingAudit, {
    companyId,
    snapshotId,
  });
  if (!finished) return { changed: false };
  if (newFindings > 0)
    await ctx.scheduler.runAfter(0, internal.fieldAi.explainNewFindings, {
      companyId,
      runId,
      version,
    });
  return { changed: true, snapshotId, version, newFindings, recomputed: true };
}

/**
 * One full ingest run. Never throws: a failure is logged and recorded on the feed. The flag
 * explainer and the analyst are scheduled only after the forecast recompute committed, so they
 * never race it. `analyst: false` leaves the analyst to the caller (the simulated clock decides
 * whether a day is worth a run).
 */
export async function runIngest(
  ctx: ActionCtx,
  companyId: Id<"companies">,
  trigger: string,
  options: { analyst?: boolean } = {},
): Promise<IngestResult> {
  const runId = `ingest-${Date.now().toString(36)}`;
  const step = (s: Omit<Step, "agent"> & { failed?: string }) =>
    ctx.runMutation(internal.fieldJobs.logStep, { companyId, runId, agent: AGENT, ...s });
  const analyst = async (changed: boolean) => {
    if (options.analyst === false) return;
    await ctx.scheduler.runAfter(0, internal.fieldAnalyst.afterIngest, { companyId, changed });
  };
  try {
    await step({
      actor: "connector",
      action: "ingest.started",
      refs: [trigger],
      summary: `Ingestion agent started (${trigger})`,
    });
    const prior: PendingAudit | null = await ctx.runQuery(internal.fieldJobs.pendingAudit, {
      companyId,
    });
    if (prior) {
      const resumed = await completePendingAudit(ctx, companyId, runId, prior);
      if (resumed.changed) await analyst(true);
      return resumed;
    }
    const inputs: { served: Snapshot; connected: ToolId[]; previous: Snapshot | null } =
      await ctx.runQuery(internal.fieldJobs.ingestInputs, { companyId });
    const bank = inputs.connected.includes("nessie")
      ? await prepareNessie(ctx, companyId, inputs.served)
      : null;
    if (bank?.ok && (bank.posted > 0 || bank.adopted > 0 || bank.created > 0))
      await step({
        actor: "connector",
        action: "nessie.posted",
        refs: [bank.plan.checkingId, ...(bank.plan.savingsId ? [bank.plan.savingsId] : [])],
        tool: "nessie.post",
        source: "nessie",
        summary: `Posted ${bank.posted} simulated bank lines to Domino's Capital One Nessie sandbox account${
          bank.adopted > 0 ? ` (${bank.adopted} already there)` : ""
        }; ${bank.createdTotal} Nessie objects created for this company so far`,
      });
    const ingested: Ingested = await ingestConnected({
      fetcher: bankFetcher(inputs.served, bank),
      companyId: inputs.served.companyId,
      connected: inputs.connected,
      previous: inputs.previous,
      nessie: bank?.ok ? bank.plan : null,
      nessieDown: bank && !bank.ok ? bank.reason : null,
    });
    const hash = await sha256(canonicalJson(ingested.snapshot));
    const result = await ctx.runMutation(internal.fieldJobs.commit, {
      companyId,
      runId,
      hash,
      snapshot: ingested.snapshot,
      pulls: ingested.pulls,
      skipped: ingested.skipped,
      stale: ingested.stale,
      results: ingested.results,
      tieOut: { checked: ingested.tieOut.checked, mismatches: ingested.tieOut.mismatches },
      tieOutFailed: ingested.tieOut.failed,
      bankFallback: ingested.bankFallback,
    });
    if (!result.pending) {
      await analyst(false);
      return { changed: false };
    }
    const completed = await completePendingAudit(ctx, companyId, runId, result.pending);
    if (completed.changed) await analyst(true);
    return completed;
  } catch (error) {
    await step({
      actor: "connector",
      action: "ingest.failed",
      refs: [trigger],
      summary: `Ingest failed: ${message(error)}`,
      failed: message(error),
    });
    return { changed: false, error: message(error) };
  }
}

/**
 * The recompute is one heavy mutation (a few hundred ms of engine work against Convex's 1 s
 * limit). Under load, with the agents' actions computing beside it, it can time out; that is
 * transient, so it gets one more try after a short pause. Refusals (bad data, decided futures)
 * are not retried.
 */
async function recomputeWithRetry(ctx: ActionCtx, companyId: Id<"companies">) {
  try {
    return await ctx.runMutation(computedRefs.recompute, { companyId });
  } catch (error) {
    if (!/timed out|conflict|retry/i.test(message(error))) throw error;
    await new Promise((resolve) => setTimeout(resolve, RECOMPUTE_RETRY_MS));
    return ctx.runMutation(computedRefs.recompute, { companyId });
  }
}
const RECOMPUTE_RETRY_MS = 750;

/** The mock vendors in process, plus Domino's own Nessie accounts when they are ready. */
export function bankFetcher(served: Snapshot, bank: Prepared | null) {
  const mocks = inProcessFetcher(served);
  if (!bank?.ok) return mocks;
  const ids = [bank.plan.checkingId, ...(bank.plan.savingsId ? [bank.plan.savingsId] : [])];
  return withNessie(mocks, nessieFetcher(bank.http, ids));
}

function message(error: unknown): string {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data: unknown }).data;
    if (data && typeof data === "object" && "message" in data) return String(data.message);
  }
  return error instanceof Error ? error.message : "unknown error";
}

export const ingestRun = internalAction({
  args: { companyId: v.id("companies"), trigger: v.string() },
  handler: async (ctx, { companyId, trigger }) => {
    await runIngest(ctx, companyId, trigger);
    return null;
  },
});

/** Claims one auto tick; false when auto is off, superseded or out of ticks. */
export const claimTick = internalMutation({
  args: { companyId: v.id("companies"), generation: v.number() },
  handler: async (ctx, { companyId, generation }) => {
    const feed = await requireFeed(ctx, companyId);
    if (!feed.auto || feed.autoGeneration !== generation) return false;
    if (feed.autoTicksLeft <= 0) {
      await ctx.db.patch("feeds", feed._id, { auto: false });
      await writeLog(ctx, companyId, undefined, {
        actor: "connector",
        action: "ingest.autoStopped",
        refs: [],
        agent: AGENT,
        summary: `Auto-ingest stopped after ${AUTO_MAX_TICKS} runs`,
      });
      return false;
    }
    await ctx.db.patch("feeds", feed._id, { autoTicksLeft: feed.autoTicksLeft - 1 });
    return true;
  },
});

export const tick = internalAction({
  args: { companyId: v.id("companies"), generation: v.number() },
  handler: async (ctx, args) => {
    const go: boolean = await ctx.runMutation(internal.fieldJobs.claimTick, args);
    if (!go) return null;
    await runIngest(ctx, args.companyId, "auto");
    await ctx.scheduler.runAfter(AUTO_INTERVAL_MS, internal.fieldJobs.tick, args);
    return null;
  },
});
