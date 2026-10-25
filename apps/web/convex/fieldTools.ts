/**
 * Growing toolbox. Apify is a tool provider, not a data source: each company's toolbox starts
 * with the Google Search Results Scraper (seed) and grows when an agent needs a capability it
 * lacks. The agent searches the Apify Store (a free listing, no actor run), picks an actor
 * (lib/apifyStore.pickActor), and the tool is recorded once per company with who added it and
 * why. Each addition logs one `toolbox.added` tool row (toolCategory "apify", toolLabel = actor
 * name) so the brain map pops it into the Toolbox. Using a tool is an actor run and obeys the
 * same caps as every Apify run (fieldApify.reserve: per analyst run and per day, cached 24 h).
 *
 * Today one agent grows it: research#1, after its public searches, needs "website_check" for a
 * counterparty the news searches said nothing about; it runs the crawler only when that
 * counterparty's own website appeared in its search results.
 *
 * Query
 *   fieldTools.list({ companyId }) -> [{ provider, capability, actorId, name, description, url?,
 *     pricing?, addedAt, addedBy, reason, seed, runnable, considered }] oldest first
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type ActionCtx, internalMutation, internalQuery, query } from "./_generated/server";
import { type AgentRow, agentLog } from "./lib/agentLog";
import { APIFY_TOKEN_ENV, ApifyError, runActor } from "./lib/apify";
import {
  CAPABILITIES,
  type Capability,
  RUNNABLE,
  type StoreActor,
  pickActor,
  searchStore,
  websiteInput,
} from "./lib/apifyStore";

type Tool = Doc<"tools">;
const capabilityArg = v.union(v.literal("web_search"), v.literal("website_check"));

export const list = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const rows = await ctx.db
      .query("tools")
      .withIndex("by_companyId_and_capability", (q) => q.eq("companyId", companyId))
      .take(50);
    return rows
      .sort((a, b) => (a.addedAt < b.addedAt ? -1 : a.addedAt > b.addedAt ? 1 : 0))
      .map(({ _id, _creationTime, companyId: _c, ...t }) => t);
  },
});

export const forCapability = internalQuery({
  args: { companyId: v.id("companies"), capability: capabilityArg },
  handler: async (ctx, { companyId, capability }) =>
    ctx.db
      .query("tools")
      .withIndex("by_companyId_and_capability", (q) =>
        q.eq("companyId", companyId).eq("capability", capability),
      )
      .first(),
});

/** Records a tool once per company (by actor and by capability) and logs toolbox.added. */
export const add = internalMutation({
  args: {
    companyId: v.id("companies"),
    runId: v.string(),
    capability: capabilityArg,
    actor: v.object({
      actorId: v.string(),
      name: v.string(),
      description: v.string(),
      url: v.optional(v.string()),
      pricing: v.optional(v.string()),
    }),
    addedBy: v.string(),
    parentAgentId: v.optional(v.string()),
    reason: v.string(),
    seed: v.boolean(),
    considered: v.number(),
  },
  handler: async (ctx, a): Promise<{ added: boolean; tool: Tool | null }> => {
    const byCapability = await ctx.db
      .query("tools")
      .withIndex("by_companyId_and_capability", (q) =>
        q.eq("companyId", a.companyId).eq("capability", a.capability),
      )
      .first();
    if (byCapability) return { added: false, tool: byCapability };
    const byActor = await ctx.db
      .query("tools")
      .withIndex("by_companyId_and_actorId", (q) =>
        q.eq("companyId", a.companyId).eq("actorId", a.actor.actorId),
      )
      .first();
    if (byActor) return { added: false, tool: byActor };
    const addedAt = new Date().toISOString();
    const id = await ctx.db.insert("tools", {
      companyId: a.companyId,
      provider: "apify",
      capability: a.capability,
      ...a.actor,
      addedAt,
      addedBy: a.addedBy,
      reason: a.reason.slice(0, 300),
      seed: a.seed,
      runnable: RUNNABLE.has(a.actor.actorId),
      considered: a.considered,
    });
    await agentLog(ctx, a.companyId, a.runId, {
      action: "toolbox.added",
      agentId: a.addedBy,
      agentKind: "domino",
      ...(a.parentAgentId && { parentAgentId: a.parentAgentId }),
      event: "tool",
      tool: a.actor.actorId,
      toolCategory: "apify",
      toolLabel: a.actor.name,
      source: "apify",
      refs: [a.actor.actorId, a.capability],
      summary: a.seed
        ? `Toolbox starts with ${a.actor.name} (${a.actor.actorId}): ${a.reason}`
        : `Added ${a.actor.name} (${a.actor.actorId}) to the toolbox from the Apify Store: ${a.reason}`,
    });
    return { added: true, tool: await ctx.db.get("tools", id) };
  },
});

type Who = {
  companyId: Id<"companies">;
  runId: string;
  agentId: string;
  parentAgentId?: string;
  log: (rows: AgentRow[]) => Promise<unknown>;
};

const toolRow = (
  w: Who,
  r: Omit<AgentRow, "agentId" | "agentKind" | "parentAgentId">,
): AgentRow => ({
  agentId: w.agentId,
  agentKind: "domino",
  ...(w.parentAgentId && { parentAgentId: w.parentAgentId }),
  ...r,
});

/**
 * The tool for a capability: the toolbox's, else the seed, else one found in the Apify Store
 * now (one free listing call). Undefined, with a log row, when the Store has nothing usable or
 * cannot be reached. Never runs an actor.
 */
export async function ensureTool(
  ctx: ActionCtx,
  w: Who,
  capability: Capability,
  reason: string,
  opts: { fetch?: (input: string, init?: RequestInit) => Promise<Response> } = {},
): Promise<Tool | undefined> {
  const have: Tool | null = await ctx.runQuery(internal.fieldTools.forCapability, {
    companyId: w.companyId,
    capability,
  });
  if (have) return have;
  const spec = CAPABILITIES[capability];
  let actor: StoreActor | undefined = spec.seed;
  let considered = 0;
  let why = reason;
  if (!actor) {
    const token = process.env[APIFY_TOKEN_ENV]?.trim();
    try {
      const found = await searchStore(spec.query, {
        ...(token && { token }),
        ...(opts.fetch && { fetch: opts.fetch }),
      });
      const pick = pickActor(found.actors);
      considered = found.actors.length;
      await w.log([
        toolRow(w, {
          action: "toolbox.searched",
          event: "tool",
          tool: "apify.store.search",
          toolCategory: "apify",
          toolLabel: "Apify Store search",
          refs: found.actors.slice(0, 5).map((a) => a.actorId),
          summary: `Searched the Apify Store for "${spec.query}" (${spec.label}): ${found.total} actors, ${
            pick ? `picked ${pick.actor.actorId}, ${pick.why}` : "none usable"
          }`,
        }),
      ]);
      if (!pick) return undefined;
      actor = pick.actor;
      why = `${reason}; picked ${pick.why} from ${found.total} Store results`;
    } catch (error) {
      const category = error instanceof ApifyError ? error.category : "http";
      await w.log([
        toolRow(w, {
          action: "toolbox.searchFailed",
          event: "status",
          status: "working",
          summary: `Apify Store search for ${spec.label} failed (${category}); toolbox unchanged`,
        }),
      ]);
      return undefined;
    }
  }
  const { users: _u, ...fields } = actor;
  const out: { added: boolean; tool: Tool | null } = await ctx.runMutation(
    internal.fieldTools.add,
    {
      companyId: w.companyId,
      runId: w.runId,
      capability,
      actor: fields,
      addedBy: w.agentId,
      ...(w.parentAgentId && { parentAgentId: w.parentAgentId }),
      reason: why,
      seed: spec.seed !== undefined,
      considered,
    },
  );
  return out.tool ?? undefined;
}

export type WebsiteCheck =
  | { outcome: "live" | "cached"; remoteRunId: string; url: string; title: string; text: string }
  | { outcome: "skipped" | "failed"; reason: string; url?: string; remoteRunId?: string };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Website results are never reused for another company, actor, or URL. */
export const websiteCacheKey = (companyId: Id<"companies">, actorId: string, url: string) =>
  `site:${companyId}:${actorId}:${new URL(url).href}`;

/**
 * One page of a counterparty's website with the toolbox's crawler, through the shared caps and
 * the 24 h cache (company, actor and exact URL). Never throws.
 */
export async function checkWebsite(
  ctx: ActionCtx,
  a: {
    tool: Tool;
    counterparty: string;
    url: string;
    companyId: Id<"companies">;
    analystRunId: string;
  },
): Promise<WebsiteCheck> {
  if (!a.tool.runnable)
    return {
      outcome: "skipped",
      reason: `Domino cannot build input for ${a.tool.actorId}`,
      url: a.url,
    };
  try {
    if (new URL(a.url).protocol !== "https:")
      return { outcome: "skipped", reason: "Website URL must use HTTPS", url: a.url };
  } catch {
    return { outcome: "skipped", reason: "Invalid website URL", url: a.url };
  }
  const token = process.env[APIFY_TOKEN_ENV]?.trim() ?? "";
  if (!token) return { outcome: "skipped", reason: "Apify not configured", url: a.url };
  const key = websiteCacheKey(a.companyId, a.tool.actorId, a.url);
  const seen = await ctx.runQuery(internal.fieldApify.lookup, {
    keys: [key],
    analystRunId: a.analystRunId,
  });
  const hit = seen.cached[key];
  if (hit)
    return {
      outcome: "cached",
      remoteRunId: hit.remoteRunId,
      url: a.url,
      title: hit.signals[0]?.title ?? "",
      text: hit.signals[0]?.snippet ?? "",
    };
  const reservation = await ctx.runMutation(internal.fieldApify.reserve, {
    key,
    counterparty: a.counterparty,
    query: a.url,
    companyId: a.companyId,
    analystRunId: a.analystRunId,
    actorId: a.tool.actorId,
  });
  if (!reservation.ok) return { outcome: "skipped", reason: reservation.reason, url: a.url };
  try {
    const run = await runActor(token, a.tool.actorId.replace("/", "~"), websiteInput(a.url), {
      limit: 1,
    });
    const page = (Array.isArray(run.items) ? run.items[0] : undefined) as
      | { url?: unknown; metadata?: { title?: unknown }; markdown?: unknown; text?: unknown }
      | undefined;
    const title = clip(typeof page?.metadata?.title === "string" ? page.metadata.title : "", 200);
    const body =
      typeof page?.text === "string"
        ? page.text
        : typeof page?.markdown === "string"
          ? page.markdown
          : "";
    const text = clip(body.replace(/\s+/g, " ").trim(), 300);
    await ctx.runMutation(internal.fieldApify.settle, {
      id: reservation.id,
      status: "ok",
      remoteRunId: run.remoteRunId,
      datasetId: run.datasetId,
      itemCount: Array.isArray(run.items) ? run.items.length : 0,
      resultCount: page ? 1 : 0,
      ...(run.usageUsd !== undefined && { usageUsd: run.usageUsd }),
      signals: page
        ? [
            {
              title: title || a.url,
              url: a.url,
              source: new URL(a.url).hostname,
              snippet: text,
              kinds: [],
            },
          ]
        : [],
    });
    return { outcome: "live", remoteRunId: run.remoteRunId, url: a.url, title, text };
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
      outcome: "failed",
      reason: `Apify ${category}`,
      url: a.url,
      ...(remoteRunId && { remoteRunId }),
    };
  }
}
