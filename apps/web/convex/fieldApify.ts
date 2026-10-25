/**
 * Apify public signal search for the research agent ("research#1"). For each top customer and
 * vendor, one real run of the Google Search Results Scraper (lib/apify.ts) looks for recent
 * layoffs, funding, bankruptcy, lawsuits, acquisitions or leadership changes. Results feed the
 * CREAO counterparty job (as facts), the analyst run's research list (fieldAnalyst.latest) and
 * the map (tool rows: toolCategory "apify", toolLabel = actor name, refs = [Apify run id, name]).
 *
 * Cost control, enforced in `reserve` (a mutation, so concurrent runs cannot both pass):
 *   at most APIFY_LIMITS.runsPerAnalystRun live runs per analyst run (one ingest),
 *   at most APIFY_LIMITS.runsPerDay live runs per UTC day in total (FIELD_APIFY_RUNS_PER_DAY may
 *   lower it), toolbox actors included (fieldTools.ts),
 *   a counterparty searched in the last 24 h is answered from the apifyRuns row (cache).
 * Without APIFY_TOKEN nothing runs and the log says "Apify not configured"; there is no canned
 * stand-in anywhere.
 *
 * Internal functions
 *   fieldApify.lookup({ keys, analystRunId }) -> { cached: { [key]: CachedSearch }, usedToday,
 *     usedThisRun }
 *   fieldApify.reserve({ key, counterparty, query, companyId?, analystRunId? })
 *     -> { ok: true, id } | { ok: false, reason }
 *   fieldApify.settle({ id, status, ... })
 * Query
 *   fieldApify.recent({ limit? }) -> newest runs (no signals), for an operator check of cost
 */
import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  type QueryCtx,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import type { AgentRow } from "./lib/agentLog";
import {
  APIFY_ACTOR,
  APIFY_LIMITS,
  APIFY_TOKEN_ENV,
  ApifyError,
  type Signal,
  apifyDailyCap,
  isGenericName,
  runSignalSearch,
  signalKey,
  signalLines,
  signalQuery,
} from "./lib/apify";

const signalArg = v.object({
  title: v.string(),
  url: v.string(),
  source: v.string(),
  date: v.optional(v.string()),
  snippet: v.string(),
  kinds: v.array(v.string()),
});

export type CachedSearch = {
  remoteRunId: string;
  fetchedAt: string;
  itemCount: number;
  resultCount: number;
  usageUsd?: number;
  signals: Signal[];
};

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function freshSearch(ctx: QueryCtx, key: string, now: number) {
  const since = new Date(now - APIFY_LIMITS.cacheMs).toISOString();
  const rows = await ctx.db
    .query("apifyRuns")
    .withIndex("by_key_and_at", (q) => q.eq("key", key).gte("at", since))
    .order("desc")
    .take(10);
  const row = rows.find((r) => r.status === "ok" && r.remoteRunId);
  if (!row?.remoteRunId) return undefined;
  return {
    remoteRunId: row.remoteRunId,
    fetchedAt: row.at,
    itemCount: row.itemCount ?? 0,
    resultCount: row.resultCount ?? 0,
    ...(row.usageUsd !== undefined && { usageUsd: row.usageUsd }),
    signals: (row.signals ?? []) as Signal[],
  } satisfies CachedSearch;
}

async function usage(ctx: QueryCtx, now: number, analystRunId: string | undefined) {
  const usedToday = (
    await ctx.db
      .query("apifyRuns")
      .withIndex("by_day", (q) => q.eq("day", dayOf(now)))
      .take(apifyDailyCap() + 1)
  ).length;
  const usedThisRun = analystRunId
    ? (
        await ctx.db
          .query("apifyRuns")
          .withIndex("by_analystRunId", (q) => q.eq("analystRunId", analystRunId))
          .take(APIFY_LIMITS.runsPerAnalystRun + 1)
      ).length
    : 0;
  return { usedToday, usedThisRun };
}

export const lookup = internalQuery({
  args: { keys: v.array(v.string()), analystRunId: v.optional(v.string()) },
  handler: async (ctx, { keys, analystRunId }) => {
    const now = Date.now();
    const cached: Record<string, CachedSearch> = {};
    for (const key of keys.slice(0, 12)) {
      const hit = await freshSearch(ctx, key, now);
      if (hit) cached[key] = hit;
    }
    return { cached, ...(await usage(ctx, now, analystRunId)) };
  },
});

export const reserve = internalMutation({
  args: {
    key: v.string(),
    counterparty: v.string(),
    query: v.string(),
    companyId: v.optional(v.id("companies")),
    analystRunId: v.optional(v.string()),
    /** Toolbox actors other than the seed search (fieldTools.ts); same caps. */
    actorId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { actorId, ...args },
  ): Promise<{ ok: true; id: Id<"apifyRuns"> } | { ok: false; reason: string }> => {
    const now = Date.now();
    const { usedToday, usedThisRun } = await usage(ctx, now, args.analystRunId);
    const cap = apifyDailyCap();
    if (usedToday >= cap) return { ok: false, reason: `daily cap of ${cap} Apify runs reached` };
    if (args.analystRunId && usedThisRun >= APIFY_LIMITS.runsPerAnalystRun)
      return {
        ok: false,
        reason: `cap of ${APIFY_LIMITS.runsPerAnalystRun} Apify runs per ingest reached`,
      };
    const id = await ctx.db.insert("apifyRuns", {
      ...args,
      actorId: actorId ?? APIFY_ACTOR.id,
      day: dayOf(now),
      at: new Date(now).toISOString(),
      status: "reserved",
    });
    return { ok: true, id };
  },
});

export const settle = internalMutation({
  args: {
    id: v.id("apifyRuns"),
    status: v.union(v.literal("ok"), v.literal("failed")),
    detail: v.optional(v.string()),
    remoteRunId: v.optional(v.string()),
    datasetId: v.optional(v.string()),
    itemCount: v.optional(v.number()),
    resultCount: v.optional(v.number()),
    usageUsd: v.optional(v.number()),
    signals: v.optional(v.array(signalArg)),
  },
  handler: async (ctx, { id, ...rest }) => {
    await ctx.db.patch("apifyRuns", id, {
      ...rest,
      // The cache is fresh from the moment the result arrived, not from the reservation.
      ...(rest.status === "ok" && { at: new Date().toISOString() }),
    });
    return null;
  },
});

/** Newest Apify runs with ids, counts and cost; signals omitted. */
export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("apifyRuns")
      .order("desc")
      .take(Math.min(Math.max(limit ?? 20, 1), 100));
    return rows.map(({ signals, ...r }) => ({ ...r, signalCount: signals?.length ?? 0 }));
  },
});

export type SignalSearch = {
  counterparty: string;
  role?: "customer" | "vendor";
  outcome: "live" | "cached" | "skipped" | "failed";
  reason?: string;
  remoteRunId?: string;
  fetchedAt?: string;
  itemCount?: number;
  resultCount?: number;
  usageUsd?: number;
  signals: Signal[];
};

export const apifyConfigured = (env: Record<string, string | undefined> = process.env) =>
  Boolean(env[APIFY_TOKEN_ENV]?.trim());

export const NOT_CONFIGURED = "Apify not configured (APIFY_TOKEN missing); no public signals";

/**
 * One counterparty: the cached search when fresh, else one live actor run if the caps allow.
 * Never throws; a failure is an outcome. Callers check apifyConfigured() first.
 */
export async function searchSignals(
  ctx: ActionCtx,
  args: {
    counterparty: string;
    role?: "customer" | "vendor";
    companyId?: Id<"companies">;
    analystRunId?: string;
    /** Called once, just before a live actor run starts (not for cache hits or skips). */
    onStart?: () => Promise<unknown>;
  },
): Promise<SignalSearch> {
  const { counterparty, role } = args;
  const base = { counterparty, ...(role && { role }) };
  const key = signalKey(counterparty);
  const seen = await ctx.runQuery(internal.fieldApify.lookup, {
    keys: [key],
    ...(args.analystRunId && { analystRunId: args.analystRunId }),
  });
  const hit = seen.cached[key];
  if (hit) return { ...base, outcome: "cached", ...hit };
  if (isGenericName(counterparty))
    return {
      ...base,
      outcome: "skipped",
      reason: "a category in the books, not a business name",
      signals: [],
    };
  const token = process.env[APIFY_TOKEN_ENV]?.trim() ?? "";
  if (!token) return { ...base, outcome: "skipped", reason: NOT_CONFIGURED, signals: [] };
  const reservation = await ctx.runMutation(internal.fieldApify.reserve, {
    key,
    counterparty,
    query: signalQuery(counterparty),
    ...(args.companyId && { companyId: args.companyId }),
    ...(args.analystRunId && { analystRunId: args.analystRunId }),
  });
  if (!reservation.ok)
    return { ...base, outcome: "skipped", reason: reservation.reason, signals: [] };
  try {
    await args.onStart?.();
    const run = await runSignalSearch(token, counterparty);
    await ctx.runMutation(internal.fieldApify.settle, {
      id: reservation.id,
      status: "ok",
      remoteRunId: run.remoteRunId,
      datasetId: run.datasetId,
      itemCount: run.itemCount,
      resultCount: run.resultCount,
      ...(run.usageUsd !== undefined && { usageUsd: run.usageUsd }),
      signals: run.signals,
    });
    return {
      ...base,
      outcome: "live",
      remoteRunId: run.remoteRunId,
      fetchedAt: new Date().toISOString(),
      itemCount: run.itemCount,
      resultCount: run.resultCount,
      ...(run.usageUsd !== undefined && { usageUsd: run.usageUsd }),
      signals: run.signals,
    };
  } catch (error) {
    const category = error instanceof ApifyError ? error.category : "http";
    const remoteRunId = error instanceof ApifyError ? error.remoteRunId : undefined;
    await ctx.runMutation(internal.fieldApify.settle, {
      id: reservation.id,
      status: "failed",
      detail: category,
      ...(remoteRunId && { remoteRunId }),
    });
    return {
      ...base,
      outcome: "failed",
      reason: `Apify ${category}`,
      ...(remoteRunId && { remoteRunId }),
      signals: [],
    };
  }
}

type RowBody = Omit<AgentRow, "agentId" | "agentKind" | "parentAgentId">;

const usd = (n: number | undefined) => (n === undefined ? "" : `, cost $${n.toFixed(4)}`);

/** Research list entry (analystRuns.research) for a search that has a run behind it. */
export const researchEntryArg = v.object({
  actor: v.string(),
  name: v.string(),
  input: v.string(),
  items: v.array(v.string()),
  provider: v.literal("apify"),
  remoteRunId: v.string(),
  cached: v.boolean(),
  fetchedAt: v.string(),
  role: v.optional(v.union(v.literal("customer"), v.literal("vendor"))),
  itemCount: v.number(),
  resultCount: v.number(),
  usageUsd: v.optional(v.number()),
  signals: v.array(signalArg),
});
export type ResearchEntry = Infer<typeof researchEntryArg>;

/** Log rows and the research entry for one search outcome. */
export function searchReport(s: SignalSearch): { rows: RowBody[]; research?: ResearchEntry } {
  const { counterparty } = s;
  if (s.outcome === "skipped" || s.outcome === "failed" || !s.remoteRunId)
    return {
      rows: [
        {
          action: s.outcome === "failed" ? "research.apifyFailed" : "research.apifySkipped",
          event: "status",
          status: "working",
          currentTask: `Research: public signals (${counterparty})`,
          ...(s.remoteRunId && { refs: [s.remoteRunId, counterparty] }),
          summary: `${APIFY_ACTOR.name} ${s.outcome} for ${counterparty}: ${s.reason ?? "no run"}${
            s.remoteRunId ? ` (run ${s.remoteRunId})` : ""
          }; no signals`,
        },
      ],
    };
  const lines = signalLines(counterparty, s.signals);
  const counts = `${s.itemCount ?? 0} dataset items, ${s.resultCount ?? 0} results, ${s.signals.length} mention the name`;
  const head =
    s.outcome === "cached"
      ? `Cached Apify run ${s.remoteRunId} (${s.fetchedAt?.slice(0, 16) ?? "?"}) for ${counterparty}`
      : `Apify run ${s.remoteRunId} for ${counterparty}`;
  return {
    rows: [
      {
        action: "agent.tool",
        event: "tool",
        tool: APIFY_ACTOR.id,
        toolCategory: "apify",
        toolLabel: APIFY_ACTOR.name,
        source: "apify",
        refs: [s.remoteRunId, counterparty],
        summary: `${head}: ${counts}${s.outcome === "live" ? usd(s.usageUsd) : ""}. ${lines.join("; ")}`,
      },
    ],
    research: {
      actor: APIFY_ACTOR.id,
      name: APIFY_ACTOR.name,
      input: counterparty,
      items: lines,
      provider: "apify",
      remoteRunId: s.remoteRunId,
      cached: s.outcome === "cached",
      fetchedAt: s.fetchedAt ?? new Date().toISOString(),
      ...(s.role && { role: s.role }),
      itemCount: s.itemCount ?? 0,
      resultCount: s.resultCount ?? 0,
      ...(s.usageUsd !== undefined && { usageUsd: s.usageUsd }),
      signals: s.signals,
    },
  };
}

/** Fresh cached searches for CREAO facts, keyed by counterparty name. Reads only, no runs. */
export async function cachedSignals(
  ctx: ActionCtx,
  names: string[],
): Promise<Record<string, CachedSearch>> {
  const keys = names.map(signalKey);
  const { cached } = await ctx.runQuery(internal.fieldApify.lookup, { keys });
  const out: Record<string, CachedSearch> = {};
  for (const [i, name] of names.entries()) {
    const hit = cached[keys[i] ?? ""];
    if (hit) out[name] = hit;
  }
  return out;
}
