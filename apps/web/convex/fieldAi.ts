/**
 * Field model calls: budget guard, the CREAO gate, the CREAO-first step runner and the Audit
 * agent's flag explainer.
 *
 * Budget (table aiCalls): per company at most one call of each kind per provider per snapshot
 * version (one ingest that changed the books), so a CREAO run that fails may fall back to one
 * Claude call, and at most AI_CALLS_PER_HOUR calls in total across companies and providers.
 * Auto loops go through the same reservation, so re-running the analyst every minute on the
 * same version makes no new model call. A call that fails still counts, so failures never turn
 * into retry storms.
 *
 * Provider order (runAiStep): CREAO first, on the app named by the evidence analyst env vars and
 * only when the role's profile is listed in DOMINO_CREAO_VERIFIED_PROFILES. Claude runs only
 * when CREAO is not configured, not verified, fails or times out. A step skipped by the budget
 * never falls back. Log rows carry the agentKind of the provider that actually ran, and a CREAO
 * run logs spawned -> working ("Waiting for CREAO run <id>") -> done or failed.
 *
 * Audit explainer: after the rule-based audit (engine.auditSnapshot) stores new findings, one
 * batched call explains up to 8 of them in plain English with a suggested check. It sees only
 * the finding records. The result is stored on each finding (findings.explanation, with
 * provider and remoteRunId) and logged as agent "flag-explainer#1" (parent "field.audit").
 */
import { v } from "convex/values";
import { ProviderError } from "../../../packages/agents/src/errors";
import {
  type ClaudeOutcome,
  type FindingRecord,
  type SendMessage,
  type Usage,
  explainFindings,
  fieldClaude,
  pickFindingsToExplain,
} from "../../../packages/agents/src/fieldAi";
import {
  type FieldCreaoJob,
  type FieldCreaoRole,
  explainCreaoJob,
  fieldCreaoEnv,
  fieldCreaoProfileVersion,
  runFieldCreaoJob,
} from "../../../packages/agents/src/fieldCreao";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  type ActionCtx,
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

const kindArg = v.union(
  v.literal("audit"),
  v.literal("analyst"),
  v.literal("research"),
  v.literal("coordinator"),
);
const providerArg = v.union(v.literal("claude"), v.literal("creao"));
export type Kind = "audit" | "analyst" | "research" | "coordinator";
export type Provider = "claude" | "creao";
/** Per CREAO run: create, polls and answer. Claude has its own 60 s client timeout. */
export const CREAO_STEP_DEADLINE_MS = 120_000;

export type Reservation = { ok: true; callId: Id<"aiCalls"> } | { ok: false; reason: string };

export async function reserveCall(
  ctx: Pick<MutationCtx, "db">,
  args: {
    companyId: Id<"companies">;
    kind: Kind;
    provider: Provider;
    scope: string;
  },
): Promise<Reservation> {
  const { companyId, kind, provider, scope } = args;
  const used = await ctx.db
    .query("aiCalls")
    .withIndex("by_companyId_and_kind_and_scope", (q) =>
      q.eq("companyId", companyId).eq("kind", kind).eq("scope", scope),
    )
    .take(4);
  if (used.some((c) => c.provider === provider))
    return { ok: false, reason: `already ran once for ${scope} (one per ingest)` };
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
    provider: v.optional(providerArg),
    remoteRunId: v.optional(v.string()),
  },
  handler: async (ctx, { companyId, model, explanations, provider, remoteRunId }) => {
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
          explanation: {
            text: e.explanation,
            suggestedCheck: e.suggestedCheck,
            model,
            ...(provider && { provider }),
            ...(remoteRunId && { remoteRunId }),
            at,
          },
        });
    }
    return null;
  },
});

export const tokens = (u: Usage) => `${u.inputTokens} in / ${u.outputTokens} out tokens`;

/**
 * Server-side CREAO gate, default off: the app must be configured and `${appId}/${version}`
 * listed in DOMINO_CREAO_VERIFIED_PROFILES. Never returns the app id or key.
 */
export async function creaoGate(
  role: FieldCreaoRole,
  env: Record<string, string | undefined> = process.env,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const appId = env[fieldCreaoEnv.appId]?.trim();
  const apiKey = env[fieldCreaoEnv.apiKey]?.trim();
  if (!appId || !apiKey) return { ok: false, reason: "app not configured" };
  const version = await fieldCreaoProfileVersion(role);
  const verified = (env.DOMINO_CREAO_VERIFIED_PROFILES ?? "").split(",").map((p) => p.trim());
  if (!verified.includes(`${appId}/${version}`))
    return { ok: false, reason: `profile ${version} not verified` };
  return { ok: true };
}

type RowBody = Omit<AgentRow, "agentId" | "agentKind" | "parentAgentId">;

/** One AI step that runs on CREAO first and on Claude only as the fallback. */
export type AiStep<T> = {
  companyId: Id<"companies">;
  kind: Kind;
  scope: string;
  agentId: string;
  parentAgentId: string;
  task: string;
  refs?: string[];
  /** Parent -> agent message. */
  ask: string;
  /** e.g. "Audit agent asked CREAO to explain 3 flags". */
  spawned: (provider: string) => string;
  creao: { job: FieldCreaoJob<T>; tool: string; toolLabel: string };
  claude: {
    call: (send: SendMessage) => Promise<ClaudeOutcome<T>>;
    tool: string;
    toolLabel: string;
  };
  /** What the tool row, the reply message and the done row say about a result. */
  report: (value: T, via: string) => { refs: string[]; tool: string; reply: string; done: string };
  log: (rows: AgentRow[]) => Promise<unknown>;
};

export type AiStepResult<T> =
  | {
      ok: true;
      value: T;
      provider: Provider;
      model: string;
      remoteRunId?: string;
      usage?: Usage;
      /** Set when Claude ran because CREAO did not. */
      fallbackFrom?: string;
    }
  | { ok: false; status: "unavailable" | "skipped"; reason: string };

/**
 * CREAO first, then Claude only when CREAO is not configured, not verified, fails or times out.
 * A budget refusal stops the step without a fallback. Never throws for provider errors.
 */
export async function runAiStep<T>(ctx: ActionCtx, step: AiStep<T>): Promise<AiStepResult<T>> {
  const { companyId, kind, scope, log } = step;
  const reserve = (provider: Provider): Promise<Reservation> =>
    ctx.runMutation(internal.fieldAi.reserve, { companyId, kind, provider, scope });
  const as =
    (agentKind: Provider) =>
    (r: RowBody): AgentRow => ({
      agentId: step.agentId,
      agentKind,
      parentAgentId: step.parentAgentId,
      ...r,
    });
  const opening = (provider: Provider, label: string): AgentRow[] => [
    as(provider)({
      action: "agent.spawned",
      event: "status",
      status: "spawned",
      currentTask: step.task,
      ...(step.refs && { refs: step.refs }),
      summary: step.spawned(label),
    }),
    {
      action: "agent.message",
      agentId: step.parentAgentId,
      agentKind: "domino",
      event: "message",
      fromAgentId: step.parentAgentId,
      toAgentId: step.agentId,
      ...(step.refs && { refs: step.refs }),
      summary: step.ask,
    },
  ];
  const closing = (provider: Provider, value: T, via: string, tool: string, toolLabel: string) => {
    const r = step.report(value, via);
    const row = as(provider);
    return [
      row({
        action: "agent.tool",
        event: "tool",
        tool,
        toolCategory: provider,
        toolLabel,
        ...(provider === "creao" && { source: "creao" }),
        currentTask: step.task,
        refs: r.refs,
        summary: r.tool,
      }),
      row({
        action: "agent.message",
        event: "message",
        fromAgentId: step.agentId,
        toAgentId: step.parentAgentId,
        refs: r.refs,
        summary: r.reply,
      }),
      row({
        action: "agent.done",
        event: "status",
        status: "done",
        currentTask: "Idle",
        summary: r.done,
      }),
    ];
  };

  let creaoMiss: string;
  const gate = await creaoGate(step.creao.job.role);
  if (!gate.ok) creaoMiss = `CREAO ${gate.reason}`;
  else {
    const reservation = await reserve("creao");
    if (!reservation.ok)
      return { ok: false, status: "skipped", reason: `CREAO ${reservation.reason}` };
    await log(opening("creao", "CREAO"));
    const row = as("creao");
    try {
      const run = await runFieldCreaoJob(process.env, step.creao.job, {
        runDeadlineMs: CREAO_STEP_DEADLINE_MS,
        onRunCreated: async ({ runId, status }) => {
          await ctx.runMutation(internal.fieldAi.settle, {
            callId: reservation.callId,
            remoteRunId: runId,
          });
          await log([
            row({
              action: "agent.working",
              event: "status",
              status: "working",
              currentTask: step.task,
              refs: [runId],
              summary: `Waiting for CREAO run ${runId} (${status})`,
            }),
          ]);
        },
      });
      await ctx.runMutation(internal.fieldAi.settle, {
        callId: reservation.callId,
        status: "ok",
        model: "creao",
        remoteRunId: run.runId,
      });
      await log(
        closing(
          "creao",
          run.value,
          `CREAO run ${run.runId}`,
          step.creao.tool,
          step.creao.toolLabel,
        ),
      );
      return {
        ok: true,
        value: run.value,
        provider: "creao",
        model: "creao",
        remoteRunId: run.runId,
      };
    } catch (error) {
      const category = error instanceof ProviderError ? error.category : "unexpected";
      await ctx.runMutation(internal.fieldAi.settle, {
        callId: reservation.callId,
        status: "failed",
        detail: category,
      });
      creaoMiss = `CREAO run failed (${category})`;
      await log([
        row({
          action: "agent.failed",
          event: "status",
          status: "failed",
          currentTask: step.task,
          summary: `${creaoMiss}; falling back to Claude`,
        }),
      ]);
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey)
    return {
      ok: false,
      status: "unavailable",
      reason: `${creaoMiss}; ANTHROPIC_API_KEY not set`,
    };
  const reservation = await reserve("claude");
  if (!reservation.ok)
    return { ok: false, status: "skipped", reason: `${creaoMiss}; Claude ${reservation.reason}` };
  await log(opening("claude", "Claude"));
  const row = as("claude");
  await log([
    row({
      action: "agent.working",
      event: "status",
      status: "working",
      currentTask: step.task,
      summary: `${step.task} (Claude; ${creaoMiss})`,
    }),
  ]);
  const out = await step.claude.call(fieldClaude(apiKey));
  await ctx.runMutation(internal.fieldAi.settle, {
    callId: reservation.callId,
    status: out.ok ? "ok" : "failed",
    ...(out.ok ? { model: out.model } : { detail: `${out.reason}: ${out.detail}` }),
    ...(out.usage && out.usage),
  });
  if (!out.ok) {
    await log([
      row({
        action: "agent.failed",
        event: "status",
        status: "failed",
        currentTask: step.task,
        summary: `Claude call failed (${out.reason}: ${out.detail})${out.usage ? `; ${tokens(out.usage)}` : ""}`,
      }),
    ]);
    return {
      ok: false,
      status: "unavailable",
      reason: `${creaoMiss}; Claude ${out.reason}: ${out.detail}`,
    };
  }
  await log(
    closing(
      "claude",
      out.value,
      `${out.model} (${tokens(out.usage)})`,
      step.claude.tool,
      step.claude.toolLabel,
    ),
  );
  return {
    ok: true,
    value: out.value,
    provider: "claude",
    model: out.model,
    usage: out.usage,
    fallbackFrom: creaoMiss,
  };
}

/** Scheduled by fieldJobs.runIngest when an ingest stored new findings. Never throws. */
export const explainNewFindings = internalAction({
  args: { companyId: v.id("companies"), runId: v.string(), version: v.number() },
  handler: async (ctx, { companyId, runId, version }) => {
    const log = (rows: AgentRow[]) =>
      ctx.runMutation(internal.fieldAi.logRows, { companyId, runId, rows });
    const found: FindingRecord[] = await ctx.runQuery(internal.fieldAi.unexplained, {
      companyId,
      version,
    });
    const picked = pickFindingsToExplain(found);
    if (picked.length === 0) return null;
    const scope = `v${version}`;
    const n = `${picked.length} flag${picked.length === 1 ? "" : "s"}`;
    const out = await runAiStep(ctx, {
      companyId,
      kind: "audit",
      scope,
      agentId: EXPLAINER,
      parentAgentId: AUDIT_AGENT,
      task: `Explain ${n} on snapshot ${scope}`,
      refs: picked.map((f) => f.findingId),
      ask: `Explain these ${n} and suggest a check for each`,
      spawned: (provider) => `Audit agent asked ${provider} to explain ${n}`,
      creao: {
        job: explainCreaoJob(picked),
        tool: "creao.explainFlags",
        toolLabel: "CREAO: explain flags",
      },
      claude: {
        call: (send) => explainFindings(send, picked),
        tool: "claude.explainFlags",
        toolLabel: "Claude: explain flags",
      },
      report: (value, via) => ({
        refs: value.map((e) => e.findingId),
        tool: `Explained ${value.length} flags with ${via}`,
        reply: value[0] ? `${value[0].findingId}: ${value[0].explanation}` : "No explanations",
        done: `${EXPLAINER} done: ${value.length} explanations stored on the findings`,
      }),
      log,
    });
    if (!out.ok) {
      await log([
        {
          action: "audit.explainSkipped",
          agentId: AUDIT_AGENT,
          agentKind: "domino",
          event: "status",
          status: "done",
          summary: `Flag explanations ${out.status} (${out.reason}); flags keep their rule-based summaries`,
        },
      ]);
      return null;
    }
    await ctx.runMutation(internal.fieldAi.writeExplanations, {
      companyId,
      model: out.model,
      explanations: out.value,
      provider: out.provider,
      ...(out.remoteRunId && { remoteRunId: out.remoteRunId }),
    });
    return null;
  },
});
