/**
 * Field model calls: budget guard and the Audit agent's Claude explainer.
 *
 * Budget (table aiCalls): per company at most one audit call, one analyst call and one CREAO
 * run per snapshot version (one ingest that changed the books), and at most AI_CALLS_PER_HOUR
 * calls in total across companies. Auto loops go through the same reservation, so re-running
 * the analyst every minute on the same version makes no new model call. A call that fails still
 * counts, so failures never turn into retry storms.
 *
 * Audit explainer: after the rule-based audit (engine.auditSnapshot) stores new findings, one
 * batched Claude call explains up to 8 of them in plain English with a suggested check. It sees
 * only the finding records. The result is stored on each finding (findings.explanation) and
 * logged as agent "flag-explainer#1" (agentKind "claude", parent "field.audit"). Without an
 * ANTHROPIC_API_KEY, or over budget, nothing is sent and the audit agent logs why.
 */
import { v } from "convex/values";
import {
  type FindingRecord,
  explainFindings,
  fieldClaude,
  pickFindingsToExplain,
} from "../../../packages/agents/src/fieldAi";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  type MutationCtx,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { type AgentRow, agentLog, agentRowArg } from "./lib/agentLog";

export const AI_CALLS_PER_HOUR = 60;
export const EXPLAINER = "flag-explainer#1";
export const AUDIT_AGENT = "field.audit";
const HOUR_MS = 3_600_000;

const kindArg = v.union(v.literal("audit"), v.literal("analyst"), v.literal("research"));
const providerArg = v.union(v.literal("claude"), v.literal("creao"));
type Kind = "audit" | "analyst" | "research";

export type Reservation = { ok: true; callId: Id<"aiCalls"> } | { ok: false; reason: string };

export async function reserveCall(
  ctx: Pick<MutationCtx, "db">,
  args: {
    companyId: Id<"companies">;
    kind: Kind;
    provider: "claude" | "creao";
    scope: string;
  },
): Promise<Reservation> {
  const { companyId, kind, scope } = args;
  const used = await ctx.db
    .query("aiCalls")
    .withIndex("by_companyId_and_kind_and_scope", (q) =>
      q.eq("companyId", companyId).eq("kind", kind).eq("scope", scope),
    )
    .first();
  if (used) return { ok: false, reason: `already ran once for ${scope} (one per ingest)` };
  const hour = Math.floor(Date.now() / HOUR_MS);
  const thisHour = await ctx.db
    .query("aiCalls")
    .withIndex("by_hour", (q) => q.eq("hour", hour))
    .take(AI_CALLS_PER_HOUR);
  if (thisHour.length >= AI_CALLS_PER_HOUR)
    return { ok: false, reason: `hourly cap of ${AI_CALLS_PER_HOUR} model calls reached` };
  const callId = await ctx.db.insert("aiCalls", {
    ...args,
    hour,
    at: new Date().toISOString(),
    status: "reserved",
  });
  return { ok: true, callId };
}

export const reserve = internalMutation({
  args: { companyId: v.id("companies"), kind: kindArg, provider: providerArg, scope: v.string() },
  handler: (ctx, args) => reserveCall(ctx, args),
});

export const settle = internalMutation({
  args: {
    callId: v.id("aiCalls"),
    status: v.optional(v.union(v.literal("ok"), v.literal("failed"))),
    detail: v.optional(v.string()),
    model: v.optional(v.string()),
    remoteRunId: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
  },
  handler: async (ctx, { callId, detail, ...rest }) => {
    await ctx.db.patch("aiCalls", callId, {
      ...rest,
      ...(detail !== undefined && { detail: detail.slice(0, 300) }),
    });
    return null;
  },
});

export const logRows = internalMutation({
  args: { companyId: v.id("companies"), runId: v.string(), rows: v.array(agentRowArg) },
  handler: async (ctx, { companyId, runId, rows }) => {
    for (const row of rows) await agentLog(ctx, companyId, runId, row as AgentRow);
    return null;
  },
});

/** Open findings of one snapshot version that have no explanation yet. */
export const unexplained = internalQuery({
  args: { companyId: v.id("companies"), version: v.number() },
  handler: async (ctx, { companyId, version }): Promise<FindingRecord[]> => {
    const rows = await ctx.db
      .query("findings")
      .withIndex("by_companyId_and_status", (q) =>
        q.eq("companyId", companyId).eq("status", "open"),
      )
      .order("desc")
      .take(200);
    return rows
      .filter((f) => f.version === version && !f.explanation)
      .map((f) => ({
        findingId: f.findingId,
        kind: f.kind,
        severity: f.severity,
        summary: f.summary,
        refs: f.refs,
      }));
  },
});

export const writeExplanations = internalMutation({
  args: {
    companyId: v.id("companies"),
    model: v.string(),
    explanations: v.array(
      v.object({ findingId: v.string(), explanation: v.string(), suggestedCheck: v.string() }),
    ),
  },
  handler: async (ctx, { companyId, model, explanations }) => {
    const at = new Date().toISOString();
    for (const e of explanations) {
      const row = await ctx.db
        .query("findings")
        .withIndex("by_companyId_and_findingId", (q) =>
          q.eq("companyId", companyId).eq("findingId", e.findingId),
        )
        .first();
      if (row)
        await ctx.db.patch("findings", row._id, {
          explanation: { text: e.explanation, suggestedCheck: e.suggestedCheck, model, at },
        });
    }
    return null;
  },
});

const tokens = (u: { inputTokens: number; outputTokens: number }) =>
  `${u.inputTokens} in / ${u.outputTokens} out tokens`;

/** Scheduled by fieldJobs.runIngest when an ingest stored new findings. Never throws. */
export const explainNewFindings = internalAction({
  args: { companyId: v.id("companies"), runId: v.string(), version: v.number() },
  handler: async (ctx, { companyId, runId, version }) => {
    const log = (rows: AgentRow[]) =>
      ctx.runMutation(internal.fieldAi.logRows, { companyId, runId, rows });
    const audit = (summary: string): AgentRow => ({
      action: "audit.explainSkipped",
      agentId: AUDIT_AGENT,
      agentKind: "domino",
      event: "status",
      status: "done",
      summary,
    });
    const found: FindingRecord[] = await ctx.runQuery(internal.fieldAi.unexplained, {
      companyId,
      version,
    });
    const picked = pickFindingsToExplain(found);
    if (picked.length === 0) return null;
    const scope = `v${version}`;
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      await log([
        audit(
          "Claude explanations unavailable (ANTHROPIC_API_KEY not set); flags keep their rule-based summaries",
        ),
      ]);
      return null;
    }
    const reservation: Reservation = await ctx.runMutation(internal.fieldAi.reserve, {
      companyId,
      kind: "audit",
      provider: "claude",
      scope,
    });
    if (!reservation.ok) {
      await log([audit(`Claude explanations skipped: ${reservation.reason}`)]);
      return null;
    }
    const task = `Explain ${picked.length} audit flag${picked.length === 1 ? "" : "s"} on snapshot ${scope}`;
    const as = (r: Omit<AgentRow, "agentId" | "agentKind" | "parentAgentId">): AgentRow => ({
      agentId: EXPLAINER,
      agentKind: "claude",
      parentAgentId: AUDIT_AGENT,
      ...r,
    });
    const refs = picked.map((f) => f.findingId);
    await log([
      as({
        action: "agent.spawned",
        event: "status",
        status: "spawned",
        currentTask: task,
        refs,
        summary: `Audit agent asked Claude to explain ${picked.length} flags`,
      }),
      {
        action: "agent.message",
        agentId: AUDIT_AGENT,
        agentKind: "domino",
        event: "message",
        fromAgentId: AUDIT_AGENT,
        toAgentId: EXPLAINER,
        refs,
        summary: `Explain these ${picked.length} flags and suggest a check for each`,
      },
      as({
        action: "agent.working",
        event: "status",
        status: "working",
        currentTask: task,
        summary: task,
      }),
    ]);
    const out = await explainFindings(fieldClaude(apiKey), picked);
    await ctx.runMutation(internal.fieldAi.settle, {
      callId: reservation.callId,
      status: out.ok ? "ok" : "failed",
      ...(out.ok ? { model: out.model } : { detail: `${out.reason}: ${out.detail}` }),
      ...(out.usage && out.usage),
    });
    if (!out.ok) {
      await log([
        as({
          action: "agent.failed",
          event: "status",
          status: "failed",
          currentTask: task,
          summary: `Claude call failed (${out.reason}: ${out.detail})${out.usage ? `; ${tokens(out.usage)}` : ""}. Flags keep their rule-based summaries`,
        }),
      ]);
      return null;
    }
    await ctx.runMutation(internal.fieldAi.writeExplanations, {
      companyId,
      model: out.model,
      explanations: out.value,
    });
    await log([
      as({
        action: "agent.tool",
        event: "tool",
        tool: "claude.explainFlags",
        toolCategory: "claude",
        toolLabel: "Claude: explain flags",
        currentTask: task,
        refs: out.value.map((e) => e.findingId),
        summary: `Explained ${out.value.length} flags with ${out.model} (${tokens(out.usage)})`,
      }),
      as({
        action: "agent.message",
        event: "message",
        fromAgentId: EXPLAINER,
        toAgentId: AUDIT_AGENT,
        refs: out.value.map((e) => e.findingId),
        summary: out.value[0]
          ? `${out.value[0].findingId}: ${out.value[0].explanation}`
          : "No explanations",
      }),
      as({
        action: "agent.done",
        event: "status",
        status: "done",
        currentTask: "Idle",
        summary: `${EXPLAINER} done: ${out.value.length} explanations stored on the findings`,
      }),
    ]);
    return null;
  },
});
