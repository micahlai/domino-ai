/**
 * Field model calls: budget guard, the CREAO gate, the CREAO-first step runner and the Audit
 * agent's flag explainer.
 *
 * Budget (table aiCalls): per company at most one call of each kind per provider per snapshot
 * version (one ingest that changed the books), so a CREAO run that fails may fall back to one
 * Claude call, plus at most one CREAO repair run per kind per version (scope "v3:repair") when
 * the first answer failed validation; and at most hourlyCap() calls in total across companies
 * and providers (FIELD_AI_HOURLY_CAP, default AI_CALLS_PER_HOUR).
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
  FieldCreaoRejected,
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
  type QueryCtx,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { type AgentRow, agentLog, agentRowArg } from "./lib/agentLog";

/** Default hourly cap on model calls, all companies and providers together. */
export const AI_CALLS_PER_HOUR = 120;
const MAX_HOURLY_CAP = 1_000;

/** FIELD_AI_HOURLY_CAP when it is a whole number from 1 to 1000, else AI_CALLS_PER_HOUR. */
export function hourlyCap(env: Record<string, string | undefined> = process.env): number {
  const raw = env.FIELD_AI_HOURLY_CAP?.trim();
  const n = raw && /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  return n >= 1 && n <= MAX_HOURLY_CAP ? n : AI_CALLS_PER_HOUR;
}
/** Reservation reason for a second call of one kind on one version; skips with it are quiet. */
export const ALREADY_RAN = "already ran once";
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
export const CREAO_STEP_DEADLINE_MS = 150_000;
/** A reserved CREAO row younger than this means a run is still in flight for the company. */
export const CREAO_IN_FLIGHT_MS = CREAO_STEP_DEADLINE_MS + 60_000;
/** A step that finds CREAO busy reschedules itself this often, at most CREAO_MAX_WAITS times. */
export const CREAO_WAIT_MS = 5_000;
export const CREAO_MAX_WAITS = Math.ceil(CREAO_IN_FLIGHT_MS / CREAO_WAIT_MS);

export type Reservation =
  | { ok: true; callId: Id<"aiCalls"> }
  | { ok: false; reason: string; busy?: true; duplicate?: true };

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
    return { ok: false, duplicate: true, reason: `${ALREADY_RAN} for ${scope} (one per ingest)` };
  const cap = hourlyCap();
  const now = Date.now();
  const hour = Math.floor(now / HOUR_MS);
  const thisHour = await ctx.db
    .query("aiCalls")
    .withIndex("by_hour", (q) => q.eq("hour", hour))
    .take(cap);
  // One CREAO run at a time per company: parallel runs drew HTTP errors from CREAO. The check
  // and the insert share this transaction, so two steps cannot both pass it.
  if (provider === "creao") {
    const lastHour = await ctx.db
      .query("aiCalls")
      .withIndex("by_hour", (q) => q.eq("hour", hour - 1))
      .take(cap);
    const inFlight = [...lastHour, ...thisHour].some(
      (c) =>
        c.companyId === companyId &&
        c.provider === "creao" &&
        c.status === "reserved" &&
        now - Date.parse(c.at) < CREAO_IN_FLIGHT_MS,
    );
    if (inFlight)
      return { ok: false, busy: true, reason: "another CREAO run is in progress for this company" };
  }
  if (thisHour.length >= cap)
    return { ok: false, reason: `hourly cap of ${cap} model calls reached` };
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

/**
 * True for the third and later analyst run on one snapshot version. Their CREAO steps only
 * repeat "skipped" or "unavailable" notes the earlier runs already logged, so they stay quiet:
 * a skip is logged once per version, not on every analyst loop tick.
 */
export async function isRepeatRun(ctx: Pick<QueryCtx, "db">, runId: string): Promise<boolean> {
  const run = await ctx.db
    .query("analystRuns")
    .withIndex("by_runId", (q) => q.eq("runId", runId))
    .unique();
  if (!run) return false;
  const recent = await ctx.db
    .query("analystRuns")
    .withIndex("by_companyId", (q) => q.eq("companyId", run.companyId))
    .order("desc")
    .take(30);
  return (
    recent.filter((r) => r.snapshotVersion === run.snapshotVersion && r.startedAt < run.startedAt)
      .length >= 2
  );
}

export const repeatRun = internalQuery({
  args: { runId: v.string() },
  handler: (ctx, { runId }) => isRepeatRun(ctx, runId),
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

/**
 * Failure text for logs: category, HTTP status, the transport stage and the sanitized provider
 * reason when there is one, e.g. "http_status 429 at create: Too many requests". No secrets.
 */
export function creaoFailure(error: unknown, stage?: string): string {
  if (!(error instanceof ProviderError)) return "unexpected";
  const status = error.httpStatus === undefined ? "" : ` ${error.httpStatus}`;
  const where = stage && error.category === "http_status" ? ` at ${stage}` : "";
  const why = error.detail ? `: ${error.detail}` : "";
  return `${error.category}${status}${where}${why}`;
}

/** Transport options shared by field CREAO runs: deadline, stage capture, retry logging. */
export function creaoRunOptions(onRetry: (attempt: number) => Promise<unknown>) {
  const seen: { stage?: string } = {};
  return {
    seen,
    options: {
      runDeadlineMs: CREAO_STEP_DEADLINE_MS,
      diagnostics: (d: { stage: string }) => {
        seen.stage = d.stage;
      },
      onResultRetry: async ({ attempt }: { attempt: number }) => {
        await onRetry(attempt);
      },
    },
  };
}

/** A CREAO step that did not produce a value; `failure` is the loggable reason. */
export class CreaoRunFailed extends Error {
  constructor(public readonly failure: string) {
    super(`CREAO run failed (${failure})`);
    this.name = "CreaoRunFailed";
  }
}

export const repairScope = (scope: string) => `${scope}:repair`;

/** Callbacks of one CREAO step; `repair` is true for the repair run. */
export type CreaoHooks = {
  created: (run: { runId: string; status: string; repair: boolean }) => Promise<unknown>;
  retry: (attempt: number, repair: boolean) => Promise<unknown>;
  /** The first answer was rejected; `next` says whether a repair run follows, or why not. */
  rejected: (
    failure: string,
    next: { repair: true } | { repair: false; why: string },
  ) => Promise<unknown>;
};

/**
 * One budgeted CREAO step with at most one repair round. Runs the job on the reserved call;
 * when the answer fails validation, settles that call failed with the precise reasons, reserves
 * one more call (scope "<scope>:repair", counts against the hourly cap) and sends the job again
 * with the reasons and the rejected answer. No repair when the budget or the lock refuses it.
 * Throws CreaoRunFailed with the loggable reason; never retries anything else.
 */
export async function runCreaoStep<T>(
  ctx: ActionCtx,
  args: {
    companyId: Id<"companies">;
    kind: Kind;
    scope: string;
    callId: Id<"aiCalls">;
    job: FieldCreaoJob<T>;
  },
  hooks: CreaoHooks,
): Promise<{ value: T; runId: string; repaired?: string }> {
  const attempt = async (callId: Id<"aiCalls">, repair?: FieldCreaoRejected) => {
    const transport = creaoRunOptions((n) => hooks.retry(n, repair !== undefined));
    try {
      const run = await runFieldCreaoJob(process.env, args.job, {
        ...transport.options,
        ...(repair && { repair: { issues: repair.issues, previousOutput: repair.output } }),
        onRunCreated: async ({ runId, status }) => {
          await ctx.runMutation(internal.fieldAi.settle, { callId, remoteRunId: runId });
          await hooks.created({ runId, status, repair: repair !== undefined });
        },
      });
      await ctx.runMutation(internal.fieldAi.settle, {
        callId,
        status: "ok",
        model: "creao",
        remoteRunId: run.runId,
        ...(repair && { detail: `repaired: ${repair.detail ?? ""}` }),
      });
      return { ok: true as const, run };
    } catch (error) {
      const failure = creaoFailure(error, transport.seen.stage);
      await ctx.runMutation(internal.fieldAi.settle, { callId, status: "failed", detail: failure });
      return { ok: false as const, error, failure };
    }
  };

  const first = await attempt(args.callId);
  if (first.ok) return first.run;
  if (!(first.error instanceof FieldCreaoRejected)) throw new CreaoRunFailed(first.failure);
  const rejection = first.error;
  const reservation: Reservation = await ctx.runMutation(internal.fieldAi.reserve, {
    companyId: args.companyId,
    kind: args.kind,
    provider: "creao",
    scope: repairScope(args.scope),
  });
  if (!reservation.ok) {
    const why = `repair skipped: ${reservation.reason}`;
    await hooks.rejected(first.failure, { repair: false, why });
    throw new CreaoRunFailed(`${first.failure}; ${why}`);
  }
  await hooks.rejected(first.failure, { repair: true });
  const second = await attempt(reservation.callId, rejection);
  if (second.ok) return { ...second.run, repaired: first.failure };
  throw new CreaoRunFailed(`${first.failure}; repair run failed: ${second.failure}`);
}

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

/** Loggable reason of a failed runCreaoStep (or anything it let through). */
export const failureOf = (error: unknown) =>
  error instanceof CreaoRunFailed ? error.failure : creaoFailure(error);

/** The usual working rows of a CREAO step: run created, result retry, answer rejected. */
export function creaoHooks(
  working: (summary: string, refs?: string[]) => Promise<unknown>,
  what = "answer",
): CreaoHooks {
  return {
    created: ({ runId, status, repair }) =>
      working(`Waiting for CREAO ${repair ? "repair run" : "run"} ${runId} (${status})`, [runId]),
    retry: (attempt, repair) =>
      working(`Waiting for CREAO ${repair ? "repair " : ""}result (retry ${attempt})`),
    rejected: (failure, next) =>
      working(
        next.repair
          ? `CREAO ${what} rejected (${failure}); asking CREAO for a corrected ${what} (one repair run)`
          : `CREAO ${what} rejected (${failure}); ${next.why}`,
      ),
  };
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
  /** Set after waiting too long for another CREAO run: skip CREAO and fall back to Claude. */
  creaoBlocked?: string;
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
  | { ok: false; status: "unavailable" | "skipped" | "busy"; reason: string };

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
  else if (step.creaoBlocked) creaoMiss = `CREAO ${step.creaoBlocked}`;
  else {
    const reservation = await reserve("creao");
    if (!reservation.ok)
      return {
        ok: false,
        status: reservation.busy ? "busy" : "skipped",
        reason: `CREAO ${reservation.reason}`,
      };
    await log(opening("creao", "CREAO"));
    const row = as("creao");
    const working = (summary: string, refs?: string[]) =>
      log([
        row({
          action: "agent.working",
          event: "status",
          status: "working",
          currentTask: step.task,
          ...(refs && { refs }),
          summary,
        }),
      ]);
    try {
      const run = await runCreaoStep(
        ctx,
        { companyId, kind, scope, callId: reservation.callId, job: step.creao.job },
        creaoHooks(working),
      );
      await log(
        closing(
          "creao",
          run.value,
          `CREAO run ${run.runId}${run.repaired ? " (repaired)" : ""}`,
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
      creaoMiss = `CREAO run failed (${failureOf(error)})`;
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

/** Parent agent row for a step that waits for the company's current CREAO run. */
export const queuedRow = (agentId: string, task: string): AgentRow => ({
  action: "creao.queued",
  agentId,
  agentKind: "domino",
  event: "status",
  status: "working",
  currentTask: task,
  summary: `Queued: ${task} waits for the company's current CREAO run (one at a time)`,
});

/** True when a busy step should wait again; false once it has waited CREAO_MAX_WAITS times. */
export const shouldWait = (wait: number) => wait < CREAO_MAX_WAITS;
export const BUSY_TOO_LONG = "busy (another run for this company did not finish in time)";

/**
 * Scheduled by fieldJobs.runIngest when an ingest stored new findings. When another CREAO run
 * for the company is in flight it reschedules itself (`wait` counts the retries). Never throws.
 */
export const explainNewFindings = internalAction({
  args: {
    companyId: v.id("companies"),
    runId: v.string(),
    version: v.number(),
    wait: v.optional(v.number()),
  },
  handler: async (ctx, { companyId, runId, version, wait = 0 }) => {
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
      ...(!shouldWait(wait) && { creaoBlocked: BUSY_TOO_LONG }),
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
    if (!out.ok && out.status === "busy") {
      if (wait === 0) await log([queuedRow(AUDIT_AGENT, `Explain ${n} on snapshot ${scope}`)]);
      await ctx.scheduler.runAfter(CREAO_WAIT_MS, internal.fieldAi.explainNewFindings, {
        companyId,
        runId,
        version,
        wait: wait + 1,
      });
      return null;
    }
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
