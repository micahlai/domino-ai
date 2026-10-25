import { type Snapshot, SnapshotSchema, WorldStateSchema, canonicalJson } from "@domino/contracts";
import { auditSnapshot } from "@domino/engine";
import { createMockHandler } from "@domino/mocks";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { type Overlay, servedSnapshot } from "./fieldFeed";
import { type Ingested, type Pull, type SourceKind, ingestSources } from "./fieldSources";
import { computedRefs } from "./lib/refs";

/**
 * Field ingestion agent (internal). One run: pull every mock source through the in-process
 * mock API, map and validate, then commit a new immutable snapshot version, audit it, store
 * findings and recompute the forecast. Every step writes a `log` row naming the agent, tool
 * and data source. Deterministic code only: no model call, no money estimate, no real API.
 */

/** Auto-ingest cadence and bound: one tick every 45 s, at most 120 ticks per enable. */
export const AUTO_INTERVAL_MS = 45_000;
export const AUTO_MAX_TICKS = 120;
export const AGENT = "field.ingest";
/** The mock handler runs in-process here; this key only satisfies its auth check. */
const IN_PROCESS_KEY = "field-in-process";
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
  tool: p.tool,
  source: p.kind,
  summary: `Pulled ${p.records} records from ${p.kind} in ${p.pages} page${p.pages === 1 ? "" : "s"}`,
});

/** Commit one ingest: new snapshot version (old ones untouched), findings and log rows. */
export const commit = internalMutation({
  args: {
    companyId: v.id("companies"),
    runId: v.string(),
    hash: v.string(),
    snapshot: v.any(),
    pulls: v.array(
      v.object({
        kind: v.string(),
        tool: v.string(),
        endpoints: v.array(v.string()),
        records: v.number(),
        pages: v.number(),
      }),
    ),
    tieOut: v.object({ checked: v.number(), mismatches: v.array(v.string()) }),
  },
  handler: async (ctx, { companyId, runId, hash, pulls, tieOut, ...args }) => {
    const snapshot = SnapshotSchema.parse(args.snapshot);
    const feed = await requireFeed(ctx, companyId);
    const at = new Date().toISOString();
    for (const p of pulls) await writeLog(ctx, companyId, runId, pullStep(p as Pull));
    await recordSources(ctx, companyId, snapshot.asOf, pulls as Pull[], tieOut);
    await writeLog(ctx, companyId, runId, {
      actor: "connector",
      action: "ingest.reconciled",
      refs: tieOut.mismatches.length > 0 ? tieOut.mismatches : ["stripe", "nessie"],
      agent: AGENT,
      tool: "field.tieOut",
      source: "stripe",
      summary:
        tieOut.mismatches.length === 0
          ? `All ${tieOut.checked} billing payouts match a bank deposit to the cent`
          : `${tieOut.mismatches.length} of ${tieOut.checked} billing payouts do not match the bank`,
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
      return { changed: false as const };
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

    const found = auditSnapshot({ snapshot, previous, detectedAt: at });
    const added: string[] = [];
    for (const f of found) {
      const existing = await ctx.db
        .query("findings")
        .withIndex("by_companyId_and_findingId", (q) =>
          q.eq("companyId", companyId).eq("findingId", f.id),
        )
        .first();
      if (existing) continue;
      const escalated = f.severity === "high";
      await ctx.db.insert("findings", {
        companyId,
        findingId: f.id,
        snapshotId,
        version,
        kind: f.kind,
        severity: f.severity,
        summary: f.summary,
        refs: f.refs,
        detectedAt: f.detectedAt,
        escalated,
        status: "open",
      });
      added.push(f.id);
      if (escalated)
        await writeLog(ctx, companyId, runId, {
          actor: "engine",
          action: "audit.escalated",
          refs: [f.id, ...f.refs],
          agent: "field.audit",
          tool: "engine.auditSnapshot",
          summary: f.summary,
        });
    }
    await writeLog(ctx, companyId, runId, {
      actor: "engine",
      action: "audit.completed",
      refs: added,
      agent: "field.audit",
      tool: "engine.auditSnapshot",
      summary: `Audit found ${found.length} issue${found.length === 1 ? "" : "s"}, ${added.length} new`,
    });

    await ctx.db.patch("companies", companyId, {
      today: snapshot.asOf,
      currentWeek: feed.week,
      status: "ready",
    });
    await ctx.db.patch("feeds", feed._id, {
      snapshotVersion: version,
      lastSnapshotId: snapshotId,
      lastSnapshotHash: hash,
      lastSnapshotAt: at,
      lastIngestAt: at,
      lastIngestStatus: "ok",
      lastError: null,
      recordCounts,
    });
    return { changed: true as const, snapshotId, version, newFindings: added.length };
  },
});

const SOURCE_STEP: Record<SourceKind, string> = {
  stripe: "billing",
  crm: "crm",
  ramp: "cards",
  books: "books",
  payroll: "payroll",
  nessie: "bank",
};

async function recordSources(
  ctx: MutationCtx,
  companyId: Id<"companies">,
  asOf: string,
  pulls: Pull[],
  tieOut: { mismatches: string[] },
) {
  const rows = await ctx.db
    .query("sources")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .take(20);
  for (const p of pulls) {
    const row = rows.find((r) => r.kind === p.kind);
    if (!row) continue;
    const reconciled = p.kind === "stripe" || p.kind === "nessie";
    await ctx.db.patch("sources", row._id, {
      lastPull: asOf,
      step: `${SOURCE_STEP[p.kind]}: ${p.records} records`,
      tieOut: !reconciled ? "ok" : tieOut.mismatches.length === 0 ? "ok" : "needs_review",
    });
  }
}

/** One full ingest run. Never throws: a failure is logged and recorded on the feed. */
export async function runIngest(ctx: ActionCtx, companyId: Id<"companies">, trigger: string) {
  const runId = `ingest-${Date.now().toString(36)}`;
  const step = (s: Omit<Step, "agent"> & { failed?: string }) =>
    ctx.runMutation(internal.fieldJobs.logStep, { companyId, runId, agent: AGENT, ...s });
  try {
    await step({
      actor: "connector",
      action: "ingest.started",
      refs: [trigger],
      summary: `Ingestion agent started (${trigger})`,
    });
    const snapshot: Snapshot = await ctx.runQuery(internal.fieldJobs.served, { companyId });
    const handler = createMockHandler({ apiKey: IN_PROCESS_KEY, snapshot: () => snapshot });
    const fetcher = (path: string) =>
      handler(
        new Request(`http://mocks.local${path}`, { headers: { "x-api-key": IN_PROCESS_KEY } }),
      );
    const ingested: Ingested = await ingestSources(fetcher);
    const hash = await sha256(canonicalJson(ingested.snapshot));
    const result = await ctx.runMutation(internal.fieldJobs.commit, {
      companyId,
      runId,
      hash,
      snapshot: ingested.snapshot,
      pulls: ingested.pulls,
      tieOut: ingested.tieOut,
    });
    // Field analyst after the ingest (and after recompute, which scans the log).
    const analyst = () =>
      ctx.scheduler.runAfter(0, internal.fieldAnalyst.afterIngest, {
        companyId,
        changed: result.changed,
      });
    if (!result.changed) return analyst().then(() => result);
    try {
      const r = await ctx.runMutation(computedRefs.recompute, { companyId });
      await step({
        actor: "engine",
        action: "ingest.recomputed",
        refs: [result.snapshotId],
        tool: "engine.recompute",
        summary: `Forecast and risks recomputed as of ${r.asOf}${r.changed ? "" : " (unchanged)"}`,
      });
    } catch (error) {
      await step({
        actor: "engine",
        action: "ingest.recomputeFailed",
        refs: [result.snapshotId],
        tool: "engine.recompute",
        summary: `Forecast recompute refused: ${message(error)}`,
      });
    }
    await analyst();
    return result;
  } catch (error) {
    await step({
      actor: "connector",
      action: "ingest.failed",
      refs: [trigger],
      summary: `Ingest failed: ${message(error)}`,
      failed: message(error),
    });
    return { changed: false as const, error: message(error) };
  }
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
