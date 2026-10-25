/**
 * Domino effects: look ahead from one saved Timeline scenario run, compute its second-order
 * consequences with the pure engine cascade, and save each follow-on as a child Timeline run
 * of its parent (so the chart draws it as a branch from the trigger week). Idempotent: request
 * ids hash the parent run, its input hash, the cascade version and each node's changes.
 *
 * Reactions: at every level (up to four deep), Claude may pick up to two alternative branches
 * per trigger, each combining one to three reactions from the engine's catalog that happen
 * together (with a probability, a one-line reason and bounded parameters), when a key and the
 * hourly AI budget allow it; the engine still builds every Change and computes every forecast.
 * Each choice is cached on its aiCalls row per (parent run, trigger), so reruns never call
 * again. Without a key, budget or a valid answer the fixed rules apply ("Rule-based").
 */
import { canonicalJson } from "@domino/contracts";
import {
  CASCADE_VERSION,
  type CascadeNode,
  type ReactionChoice,
  type ReactionRequest,
  cascadeWith,
  money,
  resolveReactions,
} from "@domino/engine";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  type QueryCtx,
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { sha256 } from "./fieldJobs";
import { type AgentRow, agentLog, agentRowArg } from "./lib/agentLog";
import { runStructured } from "./timeline/assistant/claude";
import { companyContext } from "./timeline/assistant/context";
import { brainContext } from "./timeline/chat/brain";
import type { WorkspaceRun } from "./timeline/workspace";

export type CascadeView = {
  scenarioRunId: string;
  event: string;
  eventLow: { cents: number; weekStart: string };
  /** The scenario itself runs out of cash (terminal outcome, plain wording) */
  outOfCash: { weekStart: string; available: number } | null;
  nodes: (Omit<CascadeNode, "forecast" | "allChanges"> & {
    runId: string | null;
    route: string | null;
    error: string | null;
  })[];
};

const routeFor = (companyId: string, runId: string) =>
  `/c/${encodeURIComponent(companyId)}/timeline?${new URLSearchParams({ runId })}`;

type CascadeArgs = { companyId: string; runId: string; fieldCompanyId?: Id<"companies"> };

export const run = action({
  args: {
    /** Timeline company id (the saved run's company) */
    companyId: v.string(),
    runId: v.string(),
    /** Field company for agent log rows; defaults to companyId when it is a Field id */
    fieldCompanyId: v.optional(v.id("companies")),
  },
  handler: (ctx, args): Promise<CascadeView> => cascadeFor(ctx, args),
});

/**
 * Scheduled by Timeline simulate when a person (chat, event form) or the Worker saves a
 * scenario: its domino effects are computed and saved as child runs right away. Idempotent
 * (same request ids and log run id as the button), so "Show domino effects" just reads them.
 */
export const auto = internalAction({
  args: { companyId: v.string(), runId: v.string(), fieldCompanyId: v.optional(v.id("companies")) },
  handler: async (ctx, args): Promise<null> => {
    try {
      await cascadeFor(ctx, args);
    } catch (e) {
      console.warn(`auto cascade for ${args.runId} failed: ${e instanceof Error ? e.message : e}`);
    }
    return null;
  },
});

export async function cascadeFor(ctx: ActionCtx, args: CascadeArgs): Promise<CascadeView> {
  const parent: WorkspaceRun | null = await ctx.runQuery(api.timeline.workspace.get, {
    companyId: args.companyId,
    runId: args.runId,
  });
  if (!parent || parent.kind !== "scenario" || parent.ownChanges.length === 0)
    throw new Error("Domino effects need a saved scenario run that changes events");
  const own = parent.ownChanges;
  const fieldId: Id<"companies"> | null = await ctx.runQuery(internal.fieldCascade.fieldCompany, {
    companyId: args.companyId,
    baselineRunId: parent.baselineRunId,
    fieldCompanyId: args.fieldCompanyId,
  });
  const aiRows: AgentRow[] = [];
  const result = await cascadeWith(
    {
      snapshot: parent.baseline.seed.snapshot,
      model: parent.baseline.model,
      constraints: parent.constraints,
      baseChanges: parent.changes.slice(0, parent.changes.length - own.length),
      eventChanges: own,
      eventLabel: parent.label.replace(/^If:\s*/, ""),
    },
    (req) => estimateReactions(ctx, { fieldId, parent, req, rows: aiRows }),
  );
  const key = (
    await sha256(canonicalJson({ runId: parent.runId, input: parent.inputHash, CASCADE_VERSION }))
  ).slice(0, 40);
  const runIds = new Map<string, string>();
  const nodes: CascadeView["nodes"] = [];
  for (const node of result.nodes) {
    const { forecast: _f, allChanges: _a, ...view } = node;
    const parentRunId = node.parentId === null ? parent.runId : runIds.get(node.parentId);
    if (!parentRunId) {
      nodes.push({ ...view, runId: null, route: null, error: "Its parent could not be saved" });
      continue;
    }
    try {
      const saved: { runId: string } = await ctx.runMutation(api.timeline.workspace.simulate, {
        companyId: args.companyId,
        parentRunId,
        requestId: `cascade.${key}.${node.id}.${(await sha256(canonicalJson(node.changes))).slice(0, 12)}`,
        label: `Then: ${node.event}${estimateText(node.estimate, " (", ")")}`.slice(0, 200),
        changesJson: JSON.stringify(node.changes),
        reviewed: true,
      });
      const check: WorkspaceRun | null = await ctx.runQuery(api.timeline.workspace.get, {
        companyId: args.companyId,
        runId: saved.runId,
      });
      if (
        !check ||
        check.parentRunId !== parentRunId ||
        check.forecast.lowPoint.usable !== node.lowPoint.usable
      )
        throw new Error("Saved run does not match the engine cascade");
      runIds.set(node.id, saved.runId);
      nodes.push({
        ...view,
        runId: saved.runId,
        route: routeFor(args.companyId, saved.runId),
        error: null,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      nodes.push({ ...view, runId: null, route: null, error: msg.slice(0, 300) });
    }
  }
  const nodeRows: AgentRow[] = nodes.map((n, i) => {
    const parentText =
      n.parentId === null
        ? result.event
        : (result.nodes.find((p) => p.id === n.parentId)?.event ?? result.event);
    return {
      action: "cascade.node",
      agentId: `cascade#${n.id}`,
      agentKind: "domino",
      parentAgentId: n.parentId === null ? "cascade" : `cascade#${n.parentId}`,
      event: "message",
      status: n.error ? "failed" : "done",
      tool: "engine.cascade",
      toolCategory: "engine",
      toolLabel: "Domino effects",
      refs: [parent.runId, ...(n.runId ? [n.runId] : [])],
      step: i + 1,
      steps: nodes.length,
      summary: `Looked ahead from '${parentText}': ${n.trigger.label} -> ${n.event} (${n.estimate.source === "ai" ? estimateText(n.estimate, "", `: ${n.estimate.reason}`) : `rule-based, ${n.likelihood.toLowerCase()}`}); lowest cash ${money(n.lowPoint.usable)} in the week of ${n.lowPoint.weekStart}${n.outOfCash ? `; out of cash in the week of ${n.outOfCash.weekStart}` : ""}`,
    };
  });
  const rows = [...aiRows, ...nodeRows];
  await ctx.runMutation(internal.fieldCascade.logChain, {
    companyId: args.companyId,
    fieldCompanyId: args.fieldCompanyId,
    baselineRunId: parent.baselineRunId,
    runId: `cascade.${key}`,
    summary: `Looked ahead from '${result.event}': ${result.outOfCash ? `runs out of cash in the week of ${result.outOfCash.weekStart}; ` : ""}${nodes.length === 0 ? "no follow-on effects found" : `${nodes.length} possible follow-on effect${nodes.length === 1 ? "" : "s"}`}`,
    rows,
  });
  return {
    scenarioRunId: parent.runId,
    event: result.event,
    eventLow: {
      cents: result.forecast.lowPoint.usable,
      weekStart: result.forecast.lowPoint.weekStart,
    },
    outOfCash: result.outOfCash
      ? { weekStart: result.outOfCash.weekStart, available: result.outOfCash.available }
      : null,
    nodes,
  };
}

/** Agent rows for the brain map and agent snapshots; written once per cascade run id. */
export const logChain = internalMutation({
  args: {
    companyId: v.string(),
    fieldCompanyId: v.optional(v.id("companies")),
    baselineRunId: v.string(),
    runId: v.string(),
    summary: v.string(),
    rows: v.array(agentRowArg),
  },
  handler: async (ctx, args) => {
    const fieldId = await fieldCompanyOf(ctx, args);
    if (!fieldId) return { logged: false };
    const prior = await ctx.db
      .query("log")
      .withIndex("by_company_and_runId", (q) => q.eq("companyId", fieldId).eq("runId", args.runId))
      .first();
    if (prior) return { logged: false };
    await agentLog(ctx, fieldId, args.runId, {
      action: "cascade.start",
      agentId: "cascade",
      agentKind: "domino",
      event: "status",
      status: "done",
      tool: "engine.cascade",
      toolCategory: "engine",
      toolLabel: "Domino effects",
      summary: args.summary,
    });
    for (const row of args.rows) await agentLog(ctx, fieldId, args.runId, row as AgentRow);
    return { logged: true };
  },
});

/** The Field company that opened this baseline in Timeline (small table, bounded scan). */
async function fieldCompanyOf(
  ctx: Pick<QueryCtx, "db">,
  args: { companyId: string; baselineRunId: string; fieldCompanyId?: Id<"companies"> },
): Promise<Id<"companies"> | null> {
  const links = (await ctx.db.query("timelineLinks").take(500)).filter(
    (l) => l.timelineCompanyId === args.companyId,
  );
  // Prefer the link for this exact baseline; any newer baseline of the same Timeline company
  // still belongs to the same Field company (scenarios outlive the baseline they were built on).
  const link =
    links.find((l) => l.baselineRunId === args.baselineRunId) ??
    links.sort((a, b) => b._creationTime - a._creationTime)[0];
  const id =
    args.fieldCompanyId ?? link?.companyId ?? ctx.db.normalizeId("companies", args.companyId);
  return id && (await ctx.db.get("companies", id)) ? id : null;
}

export const fieldCompany = internalQuery({
  args: {
    companyId: v.string(),
    baselineRunId: v.string(),
    fieldCompanyId: v.optional(v.id("companies")),
  },
  handler: (ctx, args) => fieldCompanyOf(ctx, args),
});

// ---------- Claude-estimated reactions ----------

/** "AI estimate 60%" for a model pick, "Rule-based" otherwise. */
export function estimateText(e: CascadeNode["estimate"], before = "", after = ""): string {
  return e.source === "ai"
    ? `${before}AI estimate ${Math.round(e.probability * 100)}%${after}`
    : "";
}

const ESTIMATE_KIND = "advisor" as const;
const CACHE_DETAIL_MAX = 300;

/** The cached answer for one (parent run, trigger) scope, if a call already settled ok. */
export const cachedReaction = internalQuery({
  args: { companyId: v.id("companies"), scope: v.string() },
  handler: async (ctx, { companyId, scope }): Promise<string | null> => {
    const rows = await ctx.db
      .query("aiCalls")
      .withIndex("by_companyId_and_kind_and_scope", (q) =>
        q.eq("companyId", companyId).eq("kind", ESTIMATE_KIND).eq("scope", scope),
      )
      .take(4);
    return rows.find((r) => r.provider === "claude" && r.status === "ok")?.detail ?? null;
  },
});

/**
 * Compact cache form, under 300 chars: [catalog indexes, params, probability, reason] per
 * branch. The scope hashes the catalog's kind ids in order, so an index names the same kind.
 */
function cacheDetail(catalog: ReactionRequest["catalog"], branches: ReactionChoice[]) {
  for (let room = 120; room >= 0; room -= 20) {
    const text = JSON.stringify(
      branches.map((b) => [
        b.kinds.map((k) => catalog.findIndex((c) => c.kindId === k.kindId)),
        b.kinds.map((k) => k.param),
        b.probability,
        b.reason.slice(0, room),
      ]),
    );
    if (text.length <= CACHE_DETAIL_MAX) return text;
  }
  return null;
}
function fromCache(catalog: ReactionRequest["catalog"], detail: string): unknown | null {
  try {
    const rows = JSON.parse(detail) as unknown;
    if (!Array.isArray(rows)) return null;
    return {
      branches: rows.map((r) => {
        if (!Array.isArray(r) || !Array.isArray(r[0]) || !Array.isArray(r[1])) return null;
        const params = r[1] as unknown[];
        return {
          kinds: (r[0] as unknown[]).map((i, n) => ({
            kindId: typeof i === "number" ? catalog[i]?.kindId : undefined,
            param: params[n] ?? null,
          })),
          probability: r[2],
          reason: r[3],
        };
      }),
    };
  } catch {
    return null;
  }
}

const SYSTEM = `You estimate how a company, its lenders, vendors, customers and market most likely react to one cash event in its 13-week forecast. Companies under pressure usually respond with several actions at once (for example stretch vendors and draw the credit line together), and effects compound: each reaction changes the cash the next one sees. Read the whole chain so far (the scenario, then chainSoFar, oldest first) and the branch's lowest cash, and react to where the company is now, not only to the latest trigger. Good news cascades too: new money or growth usually leads to hiring, which raises payroll and later cash needs.
Return up to branchesAllowed alternative branches (different futures; their probabilities should reflect how likely each is). Each branch lists one to three catalog kinds that happen together in that future, only kindIds from the catalog, each with a value inside its parameter bounds when it has a parameter (otherwise null). Combine kinds only when they plausibly happen together; a single kind is fine. Give each branch a probability from 0 to 1 and one plain-English reason under 120 characters, no jargon. Never invent amounts: the engine computes all cash. Return JSON only.`;

/**
 * One trigger's reactions from Claude, or null for the fixed rules. Cached per (parent run,
 * trigger) on its aiCalls row; budgeted by the hourly AI cap. Logs one agent row per call.
 */
async function estimateReactions(
  ctx: ActionCtx,
  a: {
    fieldId: Id<"companies"> | null;
    parent: WorkspaceRun;
    req: ReactionRequest;
    rows: AgentRow[];
  },
): Promise<unknown | null> {
  const { fieldId, parent, req, rows } = a;
  // Every level asks Claude; the engine's node and branch limits bound the number of calls.
  if (!fieldId || !process.env.ANTHROPIC_API_KEY?.trim() || req.catalog.length === 0) return null;
  const scope = `cascade:${(
    await sha256(
      canonicalJson({
        run: parent.runId,
        input: parent.inputHash,
        level: req.levelId,
        key: req.key,
        week: req.trigger.weekStart,
        catalog: req.catalog.map((c) => c.kindId),
        branches: req.branches,
        CASCADE_VERSION,
      }),
    )
  ).slice(0, 40)}`;
  const n = rows.length + 1;
  const row = (status: "done" | "failed", summary: string): AgentRow => ({
    action: "cascade.estimate",
    agentId: `cascade.ai#${n}`,
    agentKind: "claude",
    parentAgentId: "cascade",
    event: "tool",
    status,
    tool: "claude",
    toolCategory: "claude",
    toolLabel: "Claude: predict reactions",
    refs: [parent.runId],
    summary: summary.slice(0, 480),
  });
  const cached: string | null = await ctx.runQuery(internal.fieldCascade.cachedReaction, {
    companyId: fieldId,
    scope,
  });
  if (cached) return fromCache(req.catalog, cached);
  const reservation: { ok: boolean; callId?: Id<"aiCalls">; reason?: string } =
    await ctx.runMutation(internal.fieldAi.reserve, {
      companyId: fieldId,
      kind: ESTIMATE_KIND,
      provider: "claude",
      scope,
    });
  if (!reservation.ok || !reservation.callId) {
    rows.push(
      row(
        "failed",
        `Rule-based for '${req.trigger.label}': ${reservation.reason ?? "no AI budget"}`,
      ),
    );
    return null;
  }
  const s = parent.baseline.seed.snapshot;
  const ids = req.catalog.map((c) => c.kindId);
  try {
    const value = await runStructured({
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            company: {
              cashOnHand: money(s.cashOnHand),
              restrictedCash: money(s.restrictedCash),
              customers: s.customers.length,
              asOf: s.asOf,
            },
            // The saved books, weekly forecast, rules and learned payment behavior of this branch,
            // plus what the other agents currently report: flags, research, recommendations.
            books: companyContext(parent),
            agentFindings: await agentFindings(ctx, fieldId, parent),
            scenario: req.event,
            chainSoFar: req.chain,
            depth: req.depth + 1,
            branchesAllowed: req.branches,
            branchLowestCash: `${money(req.lowPoint.usable)} in the week of ${req.lowPoint.weekStart}`,
            trigger: req.trigger.label,
            catalog: req.catalog.map((c) => ({
              kindId: c.kindId,
              event: c.event,
              why: c.reason,
              outsideFactor: c.external,
              parameter: c.param,
            })),
          }),
        },
      ],
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["branches"],
        properties: {
          branches: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["kinds", "probability", "reason"],
              properties: {
                kinds: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["kindId", "param"],
                    properties: {
                      kindId: { type: "string", enum: ids },
                      param: { type: ["number", "null"] },
                    },
                  },
                },
                probability: { type: "number" },
                reason: { type: "string" },
              },
            },
          },
        },
      },
    });
    const chosen = resolveReactions(req.catalog, value, req.branches);
    if (!chosen) throw new Error("no usable reaction in the answer");
    const detail = cacheDetail(req.catalog, chosen);
    await ctx.runMutation(internal.fieldAi.settle, {
      callId: reservation.callId,
      status: "ok",
      ...(detail ? { detail } : {}),
    });
    rows.push(
      row(
        "done",
        `Claude estimated reactions to '${req.trigger.label}': ${chosen.map((c) => `${c.kinds.map((k) => k.kindId).join(" + ")} ${Math.round(c.probability * 100)}% (${c.reason})`).join("; ")}`,
      ),
    );
    return { branches: chosen };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await ctx.runMutation(internal.fieldAi.settle, {
      callId: reservation.callId,
      status: "failed",
      detail: msg,
    });
    rows.push(
      row("failed", `Rule-based for '${req.trigger.label}': Claude answer unusable (${msg})`),
    );
    return null;
  }
}

/** The Brain map's current findings for the linked Field company, or null if unreadable. */
async function agentFindings(ctx: ActionCtx, fieldId: Id<"companies">, parent: WorkspaceRun) {
  try {
    const snapshot = parent.baseline.seed.snapshot;
    return await brainContext(ctx, {
      status: "linked",
      fieldCompanyId: fieldId,
      via: "timeline_link",
      frozen: {
        seedId: parent.baseline.seed.id,
        snapshotVersion: null,
        asOf: snapshot.asOf,
        linkedAt: null,
        analystRunId: null,
      },
      currentFieldSnapshotVersion: null,
    });
  } catch {
    return null;
  }
}
