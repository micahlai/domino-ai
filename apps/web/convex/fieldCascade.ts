/**
 * Domino effects: look ahead from one saved Timeline scenario run, compute its second-order
 * consequences with the pure engine cascade, and save each follow-on as a child Timeline run
 * of its parent (so the chart draws it as a branch from the trigger week). Idempotent: request
 * ids hash the parent run, its input hash, the cascade version and each node's changes.
 *
 * Reactions: for each trigger, Claude may pick up to two reactions from the engine's catalog
 * (with a probability, a one-line reason and bounded parameters) when a key and the hourly AI
 * budget allow it; the engine still builds every Change and computes every forecast. Each
 * choice is cached on its aiCalls row per (parent run, trigger), so reruns never call again.
 * Without a key, budget or a valid answer the fixed rules apply ("Rule-based").
 */
import { canonicalJson } from "@domino/contracts";
import {
  CASCADE_VERSION,
  type CascadeNode,
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
  const link = (await ctx.db.query("timelineLinks").take(500)).find(
    (l) => l.timelineCompanyId === args.companyId && l.baselineRunId === args.baselineRunId,
  );
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

/** Compact cache form: [kindId, probability, param, reason] per reaction, under 300 chars. */
function cacheDetail(
  reactions: { kindId: string; probability: number; param: number | null; reason: string }[],
) {
  for (let room = 120; room >= 20; room -= 20) {
    const text = JSON.stringify(
      reactions.map((r) => [r.kindId, r.probability, r.param, r.reason.slice(0, room)]),
    );
    if (text.length <= CACHE_DETAIL_MAX) return text;
  }
  return null;
}
function fromCache(detail: string): unknown | null {
  try {
    const rows = JSON.parse(detail) as unknown;
    if (!Array.isArray(rows)) return null;
    return {
      reactions: rows.map((r) =>
        Array.isArray(r) ? { kindId: r[0], probability: r[1], param: r[2], reason: r[3] } : null,
      ),
    };
  } catch {
    return null;
  }
}

const SYSTEM = `You estimate how a company's lenders, vendors, customers and market most likely react to one cash event in its 13-week forecast. Choose at most two reactions, only from the catalog given, each with a probability from 0 to 1, a one-line plain-English reason (under 120 characters, no jargon) and, when the catalog entry has a parameter, a value inside its bounds (otherwise null). Never invent amounts: the engine computes all cash. Return JSON only.`;

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
  // The first two levels only: deeper reactions keep the fixed rules, bounding calls and time.
  if (
    !fieldId ||
    req.depth > 1 ||
    !process.env.ANTHROPIC_API_KEY?.trim() ||
    req.catalog.length === 0
  )
    return null;
  const scope = `cascade:${(
    await sha256(
      canonicalJson({
        run: parent.runId,
        input: parent.inputHash,
        level: req.levelId,
        key: req.key,
        week: req.trigger.weekStart,
        catalog: req.catalog.map((c) => c.kindId),
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
  if (cached) return fromCache(cached);
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
            scenario: req.event,
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
        required: ["reactions"],
        properties: {
          reactions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["kindId", "probability", "reason", "param"],
              properties: {
                kindId: { type: "string", enum: ids },
                probability: { type: "number" },
                reason: { type: "string" },
                param: { type: ["number", "null"] },
              },
            },
          },
        },
      },
    });
    const chosen = resolveReactions(req.catalog, value);
    if (!chosen) throw new Error("no usable reaction in the answer");
    const detail = cacheDetail(chosen);
    await ctx.runMutation(internal.fieldAi.settle, {
      callId: reservation.callId,
      status: "ok",
      ...(detail ? { detail } : {}),
    });
    rows.push(
      row(
        "done",
        `Claude estimated reactions to '${req.trigger.label}': ${chosen.map((c) => `${c.kindId} ${Math.round(c.probability * 100)}% (${c.reason})`).join("; ")}`,
      ),
    );
    return { reactions: chosen };
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
