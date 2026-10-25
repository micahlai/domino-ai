/**
 * Field analyst (agent web). An orchestrator agent ("analyst#1") picks 6 to 10 stress scenarios
 * from the latest snapshot and spawns one forecaster sub-agent per scenario ("forecaster#N")
 * plus a research agent ("research#1"). Each child is its own chain of scheduled internal
 * actions (engine work) that write through one internal mutation (`record`), all in parallel;
 * the analyst aggregates when every child reported. Every log row comes from the operation it
 * describes. Forecasters and all money math are deterministic engine code. The research agent
 * searches public news on the top customers and vendors with real Apify actor runs
 * (fieldApify.ts: capped per ingest and per day, cached 24 h, skipped with a log line when
 * APIFY_TOKEN is missing) and those signals become facts in the CREAO job. Real model steps are
 * budgeted (fieldAi.ts) and logged with the agentKind that actually ran: research#1 itself runs
 * on CREAO (agentKind "creao", one app run for counterparty notes) when CREAO is configured and
 * its profile is verified; after aggregation the CREAO
 * coordinator ("coordinator#1", fieldCoordinator.ts) returns a validated plan that Domino
 * executes deterministically (escalate flags, focus scenario, next research), then
 * "scenario-summarizer#1" writes a three-sentence recommendation from the engine results on
 * CREAO first, Claude only as the fallback (fieldAi.runAiStep). None has a canned fallback:
 * unavailable means no result, and the log says why. Nothing moves money.
 *
 * Triggers: after each ingest (fieldJobs.runIngest schedules afterIngest after recompute), on
 * demand (fieldAnalyst.run) and on a loop every 60 s while auto-ingest is on, at most 120 runs
 * per enable. A run that is still going blocks a new one (skipped, not queued).
 *
 * Log rows written here (table `log`, newest first via field.log) carry, besides the base
 * fields (actor, action, refs, at, agent = agentId, runId, summary, tool?, source?):
 *   agentId        "analyst#1" | "forecaster#3" | "research#1" | "analyst.loop"
 *   agentKind      "domino" | "claude" | "creao" | "system"
 *   parentAgentId  manager agentId (forecasters and research: "analyst#1")
 *   event          "status" | "message" | "tool"
 *   status         "spawned" | "working" | "done" | "failed"       (event "status")
 *   currentTask    e.g. "Scenario 4: Halcyon Freight leaves, week 8 of 13"
 *   fromAgentId, toAgentId                                          (event "message")
 *   tool, toolCategory ("engine" | "apify" | "convex" | "creao"), toolLabel (actor name for
 *                  apify; refs = [Apify run id, counterparty])
 *   step, steps    progress of a forecaster (1..6 of 6)
 *
 * Queries
 *   fieldAnalyst.latest({ companyId }) -> null | { runId, status, trigger, asOf,
 *     snapshotVersion, startedAt, finishedAt, summary, reported, children, inProgress,
 *     baseline: { survives, low } | null,
 *     scenarios: [{ index, agentId, id, title, basis, status, survives, breaksWeek,
 *       breaksAt, brokenConstraintId, low, lowWeek, cashImpact (worst weekly usable delta vs
 *       base, cents <= 0), cashImpactWeek, lowPointImpact, bestFix, fixes, error }],
 *     research: [{ actor, name, input, items, provider?: "creao" | "apify", remoteRunId?,
 *       apify only: cached, fetchedAt, role?, itemCount, resultCount, usageUsd?,
 *       signals: [{ title, url, source, date?, snippet, kinds }] }],
 *     aiSummary: null | { status: "done"|"unavailable"|"skipped", reason?, recommendation?,
 *       rationale?, citedScenarios?, model?, provider?: "creao"|"claude", remoteRunId?,
 *       inputTokens?, outputTokens?, at, runId },
 *     coordinator: null | { status: "done"|"unavailable"|"skipped"|"failed", reason?,
 *       summary?, escalate?: [{ findingId, reason }], focus?: { scenarioIndex, reason },
 *       research?: { counterparty, reason }, remoteRunId?, at, runId } }
 *   (newest finished run, else newest)
 * Mutations
 *   fieldAnalyst.run({ companyId, paceMs? }) -> { runId, skipped }
 */
import type { Snapshot } from "@domino/contracts";
import { ConvexError, type Infer, v } from "convex/values";
import { type AnalystDigest, summarizeScenarios } from "../../../packages/agents/src/fieldAi";
import { counterpartyCreaoJob, summaryCreaoJob } from "../../../packages/agents/src/fieldCreao";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { requireAgentsStarted } from "./fieldAgents";
import {
  ALREADY_RAN,
  BUSY_TOO_LONG,
  CREAO_WAIT_MS,
  type Reservation,
  creaoGate,
  creaoHooks,
  failureOf,
  isRepeatRun,
  queuedRow,
  runAiStep,
  runCreaoStep,
  shouldWait,
} from "./fieldAi";
import {
  NOT_CONFIGURED,
  apifyConfigured,
  cachedSignals,
  searchReport,
  searchSignals,
} from "./fieldApify";
import { wantsCatchUp } from "./fieldClock";
import { coordinate } from "./fieldCoordinator";
import { requireFeed } from "./fieldJobs";
import { checkWebsite, ensureTool } from "./fieldTools";
import { freezeTrace, numericalInputs, pinInputs, pinnedInputs } from "./fieldTrace";
import { type AgentRow, agentLog, agentRowArg } from "./lib/agentLog";
import {
  type FixResult,
  type ForecastWork,
  type Inputs,
  type Scenario,
  WEEK_CHUNKS,
  chunkSummary,
  forecastScenario,
  outcomeText,
  pickScenarios,
  scoreFixes,
  usd,
} from "./lib/analystScenarios";
import { APIFY_ACTOR, searchName, searchOrder, signalFacts } from "./lib/apify";
import { websiteOf } from "./lib/apifyStore";
import { type CoordinatorRecord, coordinatorRecordArg } from "./lib/coordinatorRecord";
import { counterpartyJob } from "./lib/counterparties";
import { SWARM_LIMIT } from "./lib/swarm";

export const ANALYST = "analyst#1";
export const RESEARCH = "research#1";
/** Claude helper of the analyst; only appears when a Claude call is actually made. */
export const SUMMARIZER = "scenario-summarizer#1";
const LOOP_AGENT = "analyst.loop";
export const LOOP_INTERVAL_MS = 60_000;
export const LOOP_MAX_RUNS = 120;
const DEFAULT_PACE_MS = 800;
const MAX_PACE_MS = 3_000;
/** A run older than this that never finished is treated as abandoned. */
const STALE_MS = 5 * 60_000;
const INGEST_QUIET_MS = 10_000;
/** Forecaster steps: forecast + stress test, three week chunks, fixes and report. */
const STEPS = 2 + WEEK_CHUNKS.length + 1;
const forecasterId = (index: number) => `forecaster#${index + 1}`;
const task = (index: number, title: string, detail: string) =>
  `Scenario ${index + 1}: ${title}, ${detail}`;

type Ctx = MutationCtx;

const agentRow = agentRowArg;
const nextStep = v.object({
  fn: v.union(v.literal("forecaster"), v.literal("research")),
  step: v.number(),
});
type RecordArgs = {
  runId: string;
  index?: number;
  rows: Infer<typeof agentRow>[];
  scenario?: {
    status?: "working" | "done" | "failed";
    work?: ForecastWork;
    fixes?: FixResult[];
    error?: string;
  };
  research?: unknown;
  next?: Infer<typeof nextStep>;
  reported?: boolean;
  failRun?: string;
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function runRow(ctx: Pick<QueryCtx, "db">, runId: string) {
  return ctx.db
    .query("analystRuns")
    .withIndex("by_runId", (q) => q.eq("runId", runId))
    .unique();
}

async function scenarioRow(ctx: Pick<QueryCtx, "db">, runId: string, index: number) {
  return ctx.db
    .query("analystScenarios")
    .withIndex("by_runId_and_index", (q) => q.eq("runId", runId).eq("index", index))
    .unique();
}

/** Open one orchestrated run on the latest snapshot; skipped while another is running. */
async function startRun(ctx: Ctx, companyId: Id<"companies">, trigger: string, paceMs: number) {
  const feed = await requireFeed(ctx, companyId);
  if (!feed.lastSnapshotId)
    throw new ConvexError({ code: "MISSING_INPUT", message: "No ingested snapshot yet" });
  const last = await ctx.db
    .query("analystRuns")
    .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
    .order("desc")
    .first();
  const now = Date.now();
  if (last?.status === "running" && now - Date.parse(last.startedAt) < STALE_MS)
    return { runId: last.runId, skipped: true };
  if (last?.status === "running") {
    await ctx.db.patch("analystRuns", last._id, {
      status: "failed",
      finishedAt: new Date(now).toISOString(),
      summary: "Run abandoned after its completion deadline",
    });
    await agentLog(ctx, companyId, last.runId, {
      action: "analyst.failed",
      agentId: ANALYST,
      agentKind: "domino",
      event: "status",
      status: "failed",
      summary: "Run abandoned after its completion deadline",
    });
    await freezeTrace(ctx, last._id);
  }
  // Company and previous durable row prevent collisions across companies or same-ms reruns.
  const runId = `analyst-${companyId}-${now.toString(36)}-${last?._id ?? "first"}`;
  const version = `v${feed.snapshotVersion}`;
  const { pinned, json } = await pinInputs(
    ctx,
    companyId,
    feed.lastSnapshotId,
    feed.snapshotVersion,
  );
  await ctx.db.insert("analystRuns", {
    companyId,
    runId,
    trigger,
    snapshotId: feed.lastSnapshotId,
    snapshotVersion: feed.snapshotVersion,
    asOf: pinned.snapshot.asOf,
    traceInputs: json,
    traceCandidates: "[]",
    status: "running",
    paceMs,
    children: 0,
    reported: 0,
    startedAt: new Date(now).toISOString(),
  });
  await agentLog(ctx, companyId, runId, {
    action: "analyst.working",
    agentKind: "domino",
    agentId: ANALYST,
    event: "status",
    status: "working",
    currentTask: `Planning stress scenarios from snapshot ${version} (${trigger})`,
    refs: [feed.lastSnapshotId, version],
    summary: `Analyst started on snapshot ${version} (${trigger})`,
  });
  await ctx.scheduler.runAfter(0, internal.fieldAnalyst.plan, { runId });
  return { runId, skipped: false };
}

/** A forecaster slot freed up: start the next queued forecaster, if any. */
async function startQueued(ctx: Ctx, run: Doc<"analystRuns">) {
  const scenarios = run.children - 1;
  const started = run.started ?? scenarios;
  if (started >= scenarios) return;
  await ctx.db.patch("analystRuns", run._id, { started: started + 1 });
  await ctx.scheduler.runAfter(run.paceMs, internal.fieldAnalyst.forecasterStep, {
    runId: run.runId,
    index: started,
    step: 0,
  });
}

/** A child finished (done or failed); the last report triggers aggregation. */
async function childReported(ctx: Ctx, run: Doc<"analystRuns">) {
  const reported = run.reported + 1;
  await ctx.db.patch("analystRuns", run._id, { reported });
  if (reported >= run.children)
    await ctx.scheduler.runAfter(run.paceMs, internal.fieldAnalyst.aggregate, { runId: run.runId });
}

export const run = mutation({
  args: { companyId: v.id("companies"), paceMs: v.optional(v.number()) },
  handler: async (ctx, { companyId, paceMs }) => {
    await requireAgentsStarted(ctx, companyId);
    const pace = Math.max(0, Math.min(MAX_PACE_MS, Math.floor(paceMs ?? DEFAULT_PACE_MS)));
    return startRun(ctx, companyId, "manual", pace);
  },
});

/** Pinned snapshot, model and constraints captured when this exact run started. */
export const inputs = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    const run = await runRow(ctx, runId);
    if (!run) throw new Error(`Unknown analyst run ${runId}`);
    return numericalInputs(ctx, run);
  },
});

export const context = internalQuery({
  args: { runId: v.string(), index: v.optional(v.number()) },
  handler: async (ctx, { runId, index }) => {
    const run = await runRow(ctx, runId);
    if (!run || run.status !== "running") return null;
    const row = index === undefined ? null : await scenarioRow(ctx, runId, index);
    return {
      companyId: run.companyId,
      paceMs: run.paceMs,
      snapshotVersion: run.snapshotVersion,
      row: row && {
        agentId: row.agentId,
        status: row.status,
        scenario: {
          id: row.scenarioId,
          title: row.title,
          basis: row.basis,
          changes: row.changes,
        } as Scenario,
        work: row.work as ForecastWork | undefined,
      },
      leadScenario: (await scenarioRow(ctx, runId, 0))?.title ?? null,
      leadScenarioId: (await scenarioRow(ctx, runId, 0))?.scenarioId ?? null,
      research: (run.research as unknown[] | undefined) ?? [],
    };
  },
});

/** The single writer for child agents: log rows, scenario state, next step, report. */
export const record = internalMutation({
  args: {
    runId: v.string(),
    index: v.optional(v.number()),
    rows: v.array(agentRow),
    scenario: v.optional(
      v.object({
        status: v.optional(v.union(v.literal("working"), v.literal("done"), v.literal("failed"))),
        work: v.optional(v.any()),
        fixes: v.optional(v.any()),
        error: v.optional(v.string()),
      }),
    ),
    research: v.optional(v.any()),
    next: v.optional(nextStep),
    reported: v.optional(v.boolean()),
    failRun: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await runRow(ctx, args.runId);
    if (!run || run.status !== "running") return false;
    for (const row of args.rows) await agentLog(ctx, run.companyId, run.runId, row as AgentRow);
    if (args.index !== undefined && args.scenario) {
      const row = await scenarioRow(ctx, run.runId, args.index);
      if (row)
        await ctx.db.patch("analystScenarios", row._id, {
          ...args.scenario,
          ...(args.scenario.error && { error: args.scenario.error.slice(0, 500) }),
        });
    }
    if (args.research !== undefined)
      await ctx.db.patch("analystRuns", run._id, {
        research: [...((run.research as unknown[] | undefined) ?? []), args.research],
      });
    if (args.failRun) {
      await ctx.db.patch("analystRuns", run._id, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        summary: args.failRun.slice(0, 500),
      });
      await freezeTrace(ctx, run._id);
      return true;
    }
    if (args.next) {
      const target =
        args.next.fn === "forecaster"
          ? internal.fieldAnalyst.forecasterStep
          : internal.fieldAnalyst.researchStep;
      await ctx.scheduler.runAfter(run.paceMs, target, {
        runId: run.runId,
        index: args.index ?? 0,
        step: args.next.step,
      });
    }
    if (args.reported && args.index !== undefined) await startQueued(ctx, run);
    if (args.reported) await childReported(ctx, run);
    return true;
  },
});

const scenarioArg = v.object({
  id: v.string(),
  title: v.string(),
  basis: v.string(),
  changes: v.any(),
});

/** Analyst plan (action: engine.scanRisks and scenario picking can exceed a mutation budget). */
export const plan = internalAction({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    try {
      const inputs: Inputs = await ctx.runQuery(internal.fieldAnalyst.inputs, { runId });
      const scenarios = pickScenarios(inputs);
      await ctx.runMutation(internal.fieldAnalyst.spawn, { runId, scenarios });
    } catch (error) {
      await ctx.runMutation(internal.fieldAnalyst.record, {
        runId,
        rows: [
          {
            action: "analyst.failed",
            agentKind: "domino",
            agentId: ANALYST,
            event: "status",
            status: "failed",
            summary: `Analyst could not plan: ${errorText(error)}`,
          },
        ],
        failRun: `Planning failed: ${errorText(error)}`,
      });
    }
    return null;
  },
});

export const spawn = internalMutation({
  args: { runId: v.string(), scenarios: v.array(scenarioArg) },
  handler: async (ctx, { runId, scenarios }) => {
    const run = await runRow(ctx, runId);
    if (!run || run.status !== "running") return null;
    const { companyId, paceMs } = run;
    const version = `v${run.snapshotVersion}`;
    const log = (row: Omit<AgentRow, "agentKind">) =>
      agentLog(ctx, companyId, runId, { agentKind: "domino", ...row });
    await log({
      action: "analyst.tool",
      agentId: ANALYST,
      event: "tool",
      tool: "engine.scanRisks",
      toolCategory: "engine",
      refs: scenarios.map((s) => s.id),
      summary: `Picked ${scenarios.length} scenarios from records, scheduled items and engine risks`,
    });
    // Forecaster swarm: at most SWARM_LIMIT at once; each report starts the next queued one.
    const first = Math.min(SWARM_LIMIT, scenarios.length);
    await ctx.db.patch("analystRuns", run._id, { children: scenarios.length + 1, started: first });
    for (const [index, sc] of scenarios.entries()) {
      const agentId = forecasterId(index);
      await ctx.db.insert("analystScenarios", {
        companyId,
        runId,
        index,
        agentId,
        scenarioId: sc.id,
        title: sc.title,
        basis: sc.basis,
        changes: sc.changes,
        status: "spawned",
      });
      await log({
        action: "agent.spawned",
        agentId,
        parentAgentId: ANALYST,
        event: "status",
        status: "spawned",
        currentTask: task(index, sc.title, index < first ? "starting" : "queued for a free slot"),
        refs: [sc.id],
        summary: `Analyst spawned ${agentId} for scenario ${index + 1}: ${sc.title}`,
      });
      await log({
        action: "agent.message",
        agentId: ANALYST,
        event: "message",
        fromAgentId: ANALYST,
        toAgentId: agentId,
        refs: [sc.id],
        summary: `Run scenario ${index + 1} on ${version}: ${sc.title} (${sc.basis})`,
      });
      // Small stagger so parallel children interleave visibly; the work itself is real.
      if (index < first)
        await ctx.scheduler.runAfter(
          Math.floor((index * paceMs) / 4),
          internal.fieldAnalyst.forecasterStep,
          { runId, index, step: 0 },
        );
    }
    await log({
      action: "agent.spawned",
      agentId: RESEARCH,
      parentAgentId: ANALYST,
      event: "status",
      status: "spawned",
      currentTask: "Research: public signals on top counterparties and counterparty risk",
      summary: `Analyst spawned ${RESEARCH} for outside context`,
    });
    await log({
      action: "agent.message",
      agentId: ANALYST,
      event: "message",
      fromAgentId: ANALYST,
      toAgentId: RESEARCH,
      summary:
        "Search public news on the top customers and vendors (Apify) and get counterparty risk notes",
    });
    await ctx.scheduler.runAfter(paceMs, internal.fieldAnalyst.researchStep, {
      runId,
      index: 0,
      step: 0,
    });
    return null;
  },
});

const stepArgs = { runId: v.string(), index: v.number(), step: v.number() };

export const forecasterStep = internalAction({
  args: stepArgs,
  handler: async (ctx, { runId, index, step }) => {
    const c = await ctx.runQuery(internal.fieldAnalyst.context, { runId, index });
    const row = c?.row;
    if (!c || !row || row.status === "done" || row.status === "failed") return null;
    const { agentId, scenario: sc } = row;
    const as = (r: Omit<AgentRow, "agentKind" | "agentId" | "parentAgentId" | "steps">) => ({
      agentKind: "domino" as const,
      agentId,
      parentAgentId: ANALYST,
      steps: STEPS,
      ...r,
    });
    const write = (r: Omit<RecordArgs, "runId" | "index">) =>
      ctx.runMutation(internal.fieldAnalyst.record, { runId, index, ...r });
    try {
      if (step === 0) {
        await write({
          rows: [
            as({
              action: "agent.working",
              event: "status",
              status: "working",
              step: 1,
              currentTask: task(index, sc.title, `forecasting 13 weeks on v${c.snapshotVersion}`),
              summary: `Loaded snapshot v${c.snapshotVersion}; running the 13-week forecast`,
            }),
          ],
          scenario: { status: "working" },
        });
        const inputs: Inputs = await ctx.runQuery(internal.fieldAnalyst.inputs, { runId });
        const work = forecastScenario(inputs, sc);
        await write({
          rows: [
            as({
              action: "agent.tool",
              event: "tool",
              tool: "engine.forecast",
              toolCategory: "engine",
              step: 1,
              refs: [sc.id],
              summary: `Forecast: low ${usd(work.low)} in week ${work.lowWeek} (base low ${usd(work.baseLow)})`,
            }),
            as({
              action: "agent.tool",
              event: "tool",
              tool: "engine.stressTest",
              toolCategory: "engine",
              step: 2,
              refs: [sc.id, ...(work.brokenConstraintId ? [work.brokenConstraintId] : [])],
              summary: `Stress test: ${outcomeText(work)}`,
            }),
          ],
          scenario: { work },
          next: { fn: "forecaster", step: 1 },
        });
        return null;
      }
      const work = row.work;
      if (!work) throw new Error("Forecast state is missing");
      if (step <= WEEK_CHUNKS.length) {
        const [, to] = WEEK_CHUNKS[step - 1] ?? [1, 13];
        await write({
          rows: [
            as({
              action: "agent.progress",
              event: "status",
              status: "working",
              step: step + 2,
              currentTask: task(index, sc.title, `week ${to} of 13`),
              summary: chunkSummary(work, step - 1),
            }),
          ],
          next: { fn: "forecaster", step: step + 1 },
        });
        return null;
      }
      const inputs: Inputs = await ctx.runQuery(internal.fieldAnalyst.inputs, { runId });
      const { tried, ranked } = scoreFixes(inputs, sc, work);
      const best = ranked[0];
      await write({
        rows: [
          as({
            action: "agent.tool",
            event: "tool",
            tool: "engine.scoreFix",
            toolCategory: "engine",
            step: STEPS,
            refs: ranked.map((f) => f.id),
            summary: best
              ? `Scored ${tried} fixes; best: ${best.label} (+${usd(best.gain)}${best.survivesWithFix ? ", survives" : ", still fails"})`
              : `Scored ${tried} fixes; none raises the low point`,
          }),
          as({
            action: "agent.message",
            event: "message",
            step: STEPS,
            fromAgentId: agentId,
            toAgentId: ANALYST,
            refs: [sc.id],
            summary: `Scenario ${index + 1} ${outcomeText(work)}; worst week ${usd(work.cashImpact)} vs base (week ${work.cashImpactWeek})${best ? `; best fix: ${best.label}` : ""}`,
          }),
          as({
            action: "agent.done",
            event: "status",
            status: "done",
            step: STEPS,
            currentTask: task(index, sc.title, "reported"),
            summary: `${agentId} done: ${outcomeText(work)}`,
          }),
        ],
        scenario: { status: "done", fixes: ranked },
        reported: true,
      });
    } catch (error) {
      await write({
        rows: [
          as({
            action: "agent.failed",
            event: "status",
            status: "failed",
            currentTask: task(index, sc.title, "failed"),
            summary: `${agentId} failed: ${errorText(error)}`,
          }),
        ],
        scenario: { status: "failed", error: errorText(error) },
        reported: true,
      });
    }
    return null;
  },
});

export const researchStep = internalAction({
  args: stepArgs,
  handler: async (ctx, { runId, step }) => {
    const c = await ctx.runQuery(internal.fieldAnalyst.context, { runId });
    if (!c) return null;
    const as = (r: Omit<AgentRow, "agentKind" | "agentId" | "parentAgentId">) => ({
      agentKind: "domino" as const,
      agentId: RESEARCH,
      parentAgentId: ANALYST,
      ...r,
    });
    const write = (r: Omit<RecordArgs, "runId">) =>
      ctx.runMutation(internal.fieldAnalyst.record, { runId, ...r });
    try {
      const inputs: Inputs = await ctx.runQuery(internal.fieldAnalyst.inputs, { runId });
      const targets = searchOrder(counterpartyJob(inputs.snapshot, "").counterparties);
      const configured = apifyConfigured();
      const who = {
        companyId: c.companyId,
        runId,
        agentId: RESEARCH,
        parentAgentId: ANALYST,
        log: (rows: AgentRow[]) => write({ rows }),
      };
      // The toolbox starts with the public web search this agent uses (fieldTools.ts).
      if (step === 0 && configured)
        await ensureTool(ctx, who, "web_search", "public news on top counterparties");
      const target = configured ? targets[step] : undefined;
      if (target) {
        const { name, role } = target;
        const report = searchReport(
          await searchSignals(ctx, {
            counterparty: name,
            role,
            companyId: c.companyId,
            analystRunId: runId,
            onStart: () =>
              write({
                rows: [
                  as({
                    action: "agent.working",
                    event: "status",
                    status: "working",
                    currentTask: `Research: public signals for ${name} (${role} ${target.rank})`,
                    summary: `Searching public news on ${name} with the Apify ${APIFY_ACTOR.name}`,
                  }),
                ],
              }),
          }),
        );
        await write({
          rows: report.rows.map(as),
          ...(report.research && { research: report.research }),
          next: { fn: "research" as const, step: step + 1 },
        });
        return null;
      }
      const found = (c.research as { provider?: string; signals?: unknown[] }[]).filter(
        (r) => r.provider === "apify",
      );
      const flagged = found.filter((r) => (r.signals?.length ?? 0) > 0).length;
      if (configured)
        await websiteStep(
          ctx,
          who,
          c.companyId,
          runId,
          found as { input?: string; signals?: { url: string }[] }[],
        );
      await write({
        rows: [
          ...(configured
            ? []
            : [
                as({
                  action: "research.apifySkipped",
                  event: "status",
                  status: "working",
                  currentTask: "Research: public signals",
                  summary: NOT_CONFIGURED,
                }),
              ]),
          as({
            action: "agent.message",
            event: "message",
            fromAgentId: RESEARCH,
            toAgentId: ANALYST,
            summary: configured
              ? `Research: public web search on ${found.length} of ${targets.length} top counterparties, ${flagged} with signals; counterparty risk (CREAO) follows the summary`
              : `Research: ${NOT_CONFIGURED}; counterparty risk (CREAO) follows the summary`,
          }),
          as({
            action: "agent.done",
            event: "status",
            status: "done",
            currentTask: "Research reported",
            summary: `${RESEARCH} done`,
          }),
        ],
        reported: true,
      });
    } catch (error) {
      await write({
        rows: [
          as({
            action: "agent.failed",
            event: "status",
            status: "failed",
            currentTask: "Research failed",
            summary: `${RESEARCH} failed: ${errorText(error)}`,
          }),
        ],
        reported: true,
      });
    }
    return null;
  },
});

/**
 * Research grows the toolbox: after the news searches it wants the top searched counterparty's
 * own website (to confirm a same-name match, or that a quiet name is an operating business).
 * That capability is added from the Apify Store once; the crawler runs, within the caps, only
 * when the counterparty's own site is among its search results.
 */
async function websiteStep(
  ctx: ActionCtx,
  who: Parameters<typeof ensureTool>[1],
  companyId: Id<"companies">,
  runId: string,
  found: { provider?: string; input?: string; signals?: { url: string }[] }[],
) {
  const first = found.find((r) => r.input);
  const name = first?.input;
  if (!first || !name) return;
  const quiet = (first.signals?.length ?? 0) === 0;
  const tool = await ensureTool(
    ctx,
    who,
    "website_check",
    quiet
      ? `no public news on ${name}; check whether it runs a website`
      : `news mentions ${name}; check its own website to confirm it is the same business`,
  );
  if (!tool) return;
  const url = websiteOf(
    searchName(name),
    (first.signals ?? []).map((s) => s.url),
  );
  const as = (r: Omit<AgentRow, "agentKind" | "agentId" | "parentAgentId">): AgentRow => ({
    agentKind: "domino",
    agentId: RESEARCH,
    parentAgentId: ANALYST,
    ...r,
  });
  if (!url) {
    await who.log([
      as({
        action: "research.websiteSkipped",
        event: "status",
        status: "working",
        currentTask: `Research: website check (${name})`,
        refs: [tool.actorId, name],
        summary: `No website for ${name} among its search results; ${tool.name} not run (no actor run spent)`,
      }),
    ]);
    return;
  }
  const check = await checkWebsite(ctx, {
    tool,
    counterparty: name,
    url,
    companyId,
    analystRunId: runId,
  });
  await who.log([
    "remoteRunId" in check &&
    check.remoteRunId &&
    (check.outcome === "live" || check.outcome === "cached")
      ? as({
          action: "agent.tool",
          event: "tool",
          tool: tool.actorId,
          toolCategory: "apify",
          toolLabel: tool.name,
          source: "apify",
          refs: [check.remoteRunId, name],
          summary: `${check.outcome === "cached" ? "Cached " : ""}Apify run ${check.remoteRunId}: ${url} ${
            check.title ? `"${check.title}"` : "(no title)"
          }`,
        })
      : as({
          action: "research.websiteSkipped",
          event: "status",
          status: "working",
          currentTask: `Research: website check (${name})`,
          refs: [tool.actorId, name],
          summary: `Website check of ${name} ${check.outcome}: ${"reason" in check ? check.reason : ""}`,
        }),
  ]);
}

export const aggregate = internalMutation({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    const run = await runRow(ctx, runId);
    if (!run || run.status !== "running") return null;
    const rows = await ctx.db
      .query("analystScenarios")
      .withIndex("by_runId_and_index", (q) => q.eq("runId", runId))
      .take(20);
    const done = rows.filter((r) => r.status === "done");
    const failing = done.filter((r) => !(r.work as ForecastWork).survives);
    const earliest = [...failing].sort(
      (a, b) =>
        ((a.work as ForecastWork).breaksWeek ?? 99) - ((b.work as ForecastWork).breaksWeek ?? 99) ||
        a.index - b.index,
    )[0];
    await agentLog(ctx, run.companyId, runId, {
      action: "analyst.working",
      agentKind: "domino",
      agentId: ANALYST,
      event: "status",
      status: "working",
      currentTask: `Aggregating ${done.length} forecaster reports`,
      summary: `Aggregating ${done.length} of ${rows.length} scenario reports`,
    });
    const earliestWork = earliest?.work as ForecastWork | undefined;
    const bestFix = (earliest?.fixes as FixResult[] | undefined)?.[0];
    const parts = [`${failing.length} of ${done.length} scenarios fail`];
    if (earliest && earliestWork)
      parts.push(`earliest: ${earliest.title} in week ${earliestWork.breaksWeek ?? "?"}`);
    if (bestFix) parts.push(`best fix: ${bestFix.label}`);
    if (rows.length > done.length) parts.push(`${rows.length - done.length} forecasters failed`);
    const summary = parts.join("; ");
    // Claude reads the engine results next; finish() closes the run either way.
    await ctx.scheduler.runAfter(0, internal.fieldAnalyst.summarize, { runId, summary });
    return null;
  },
});

/** Engine results of one run as the summarizer sees them: formatted amounts, no raw data. */
export const digest = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    const run = await runRow(ctx, runId);
    if (!run || run.status !== "running") return null;
    return { companyId: run.companyId, digest: await buildDigest(ctx, run) };
  },
});

export async function buildDigest(
  ctx: Pick<QueryCtx, "db">,
  run: Doc<"analystRuns">,
): Promise<AnalystDigest> {
  const rows = await ctx.db
    .query("analystScenarios")
    .withIndex("by_runId_and_index", (q) => q.eq("runId", run.runId))
    .take(20);
  const done = rows.filter((r) => r.status === "done" && r.work);
  const first = done[0]?.work as ForecastWork | undefined;
  return {
    asOf: run.asOf,
    snapshotVersion: run.snapshotVersion,
    baseline: first ? { survives: first.baseSurvives, lowPoint: usd(first.baseLow) } : null,
    failedForecasters: rows.length - done.length,
    scenarios: done.map((r) => {
      const w = r.work as ForecastWork;
      const fix = (r.fixes as FixResult[] | undefined)?.[0];
      return {
        index: r.index,
        title: r.title,
        basis: r.basis,
        survives: w.survives,
        breaksWeek: w.breaksWeek ?? null,
        brokenRule: w.brokenConstraintId ?? null,
        lowPoint: usd(w.low),
        lowWeek: w.lowWeek,
        worstWeekVsBase: usd(w.cashImpact),
        worstWeek: w.cashImpactWeek,
        bestFix: fix
          ? {
              label: fix.label,
              gain: usd(fix.gain),
              survivesWithFix: fix.survivesWithFix,
              risk: fix.risk,
              costNote: fix.costNote,
            }
          : null,
      };
    }),
  };
}

const aiSummaryArg = v.object({
  status: v.union(v.literal("done"), v.literal("unavailable"), v.literal("skipped")),
  reason: v.optional(v.string()),
  recommendation: v.optional(v.string()),
  rationale: v.optional(v.string()),
  citedScenarios: v.optional(v.array(v.number())),
  model: v.optional(v.string()),
  provider: v.optional(v.union(v.literal("claude"), v.literal("creao"))),
  remoteRunId: v.optional(v.string()),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  at: v.string(),
});
type AiSummary = Infer<typeof aiSummaryArg>;

/**
 * After aggregation, one CREAO run at a time per company, each step its own scheduled action:
 *   summarize (coordinator plan, executed deterministically)
 *   -> summaryStep (three-sentence summary leading with the focus scenario; CREAO first,
 *      Claude fallback)
 *   -> counterpartyStep (CREAO counterparty notes, the coordinator's pick first)
 *   -> fieldAdvisor.advisorStep / recommendStep (advisor swarm, only when a scenario breaks the
 *      lender's minimum) -> finish.
 * A step that finds another CREAO run in flight for the company reschedules itself every
 * CREAO_WAIT_MS (`wait` counts), and after CREAO_MAX_WAITS proceeds without CREAO. Without a
 * provider, over budget or on failure the run closes on the engine summary alone and the log
 * says why. Never throws.
 */
const chainArgs = { runId: v.string(), summary: v.string(), wait: v.optional(v.number()) };
const nowIso = () => new Date().toISOString();

export const summarize = internalAction({
  args: chainArgs,
  handler: async (ctx, { runId, summary, wait = 0 }) => {
    let plan: CoordinatorRecord | "busy";
    try {
      plan = await coordinate(ctx, runId, !shouldWait(wait));
    } catch (error) {
      plan = {
        status: "failed",
        reason: `Coordinator step failed: ${errorText(error)}`,
        at: nowIso(),
      };
    }
    if (plan === "busy") {
      if (wait === 0) await queued(ctx, runId, "Coordinator plan (CREAO)");
      await ctx.scheduler.runAfter(CREAO_WAIT_MS, internal.fieldAnalyst.summarize, {
        runId,
        summary,
        wait: wait + 1,
      });
      return null;
    }
    await ctx.scheduler.runAfter(0, internal.fieldAnalyst.summaryStep, {
      runId,
      summary,
      coordinator: plan,
    });
    return null;
  },
});

export const summaryStep = internalAction({
  args: { ...chainArgs, coordinator: coordinatorRecordArg },
  handler: async (ctx, { runId, summary, coordinator, wait = 0 }) => {
    let ai: AiSummary | "busy";
    try {
      ai = await aiSummary(ctx, runId, coordinator.focus?.scenarioIndex, !shouldWait(wait));
    } catch (error) {
      ai = {
        status: "unavailable",
        reason: `Summary step failed: ${errorText(error)}`,
        at: nowIso(),
      };
    }
    if (ai === "busy") {
      if (wait === 0) await queued(ctx, runId, "Scenario summary (CREAO)");
      await ctx.scheduler.runAfter(CREAO_WAIT_MS, internal.fieldAnalyst.summaryStep, {
        runId,
        summary,
        coordinator,
        wait: wait + 1,
      });
      return null;
    }
    await ctx.scheduler.runAfter(0, internal.fieldAnalyst.counterpartyStep, {
      runId,
      summary,
      coordinator,
      aiSummary: ai,
    });
    return null;
  },
});

export const counterpartyStep = internalAction({
  args: { ...chainArgs, coordinator: coordinatorRecordArg, aiSummary: aiSummaryArg },
  handler: async (ctx, { runId, summary, coordinator, aiSummary, wait = 0 }) => {
    const c = await ctx.runQuery(internal.fieldAnalyst.context, { runId });
    if (!c) return null;
    let outcome: string;
    try {
      const inputs: Inputs = await ctx.runQuery(internal.fieldAnalyst.inputs, { runId });
      outcome = await counterpartyResearch(
        ctx,
        runId,
        c,
        inputs.snapshot,
        coordinator.research?.counterparty,
        !shouldWait(wait),
      );
    } catch (error) {
      outcome = `Counterparty step failed: ${errorText(error)}`;
    }
    if (outcome === "busy") {
      if (wait === 0) await queued(ctx, runId, "Counterparty risk (CREAO)");
      await ctx.scheduler.runAfter(CREAO_WAIT_MS, internal.fieldAnalyst.counterpartyStep, {
        runId,
        summary,
        coordinator,
        aiSummary,
        wait: wait + 1,
      });
      return null;
    }
    // Advisors (fieldAdvisor.ts) only when a scenario breaks the lender's minimum; then finish.
    await ctx.scheduler.runAfter(0, internal.fieldAdvisor.advisorStep, {
      runId,
      summary,
      coordinator,
      aiSummary,
    });
    return null;
  },
});

const queued = (ctx: ActionCtx, runId: string, task: string) =>
  ctx.runMutation(internal.fieldAnalyst.record, { runId, rows: [queuedRow(ANALYST, task)] });

async function aiSummary(
  ctx: ActionCtx,
  runId: string,
  focusScenario: number | undefined,
  blocked: boolean,
): Promise<AiSummary | "busy"> {
  const at = nowIso;
  const d: { companyId: Id<"companies">; digest: AnalystDigest } | null = await ctx.runQuery(
    internal.fieldAnalyst.digest,
    { runId },
  );
  if (!d) return { status: "skipped", reason: "run is no longer active", at: at() };
  const { companyId } = d;
  const digest: AnalystDigest =
    focusScenario === undefined ? d.digest : { ...d.digest, focusScenario };
  if (digest.scenarios.length === 0)
    return { status: "skipped", reason: "no finished scenarios to summarize", at: at() };
  const n = digest.scenarios.length;
  const task = `Summarize ${n} scenario reports on v${digest.snapshotVersion}`;
  const out = await runAiStep(ctx, {
    companyId,
    analystRunId: runId,
    kind: "analyst",
    scope: `v${digest.snapshotVersion}`,
    agentId: SUMMARIZER,
    parentAgentId: ANALYST,
    ...(blocked && { creaoBlocked: BUSY_TOO_LONG }),
    task,
    ask: `${task}: survives or fails, week, engine impact, best scored fix${
      focusScenario === undefined ? "" : `; lead with scenario ${focusScenario + 1}`
    }`,
    spawned: (provider) =>
      `Analyst spawned ${SUMMARIZER} (${provider}) to summarize the engine results`,
    creao: {
      job: summaryCreaoJob(digest),
      tool: "creao.summarizeScenarios",
      toolLabel: "CREAO: summarize scenarios",
    },
    claude: {
      call: (send) => summarizeScenarios(send, digest),
      tool: "claude.summarizeScenarios",
      toolLabel: "Claude: summarize scenarios",
    },
    report: (value, via) => ({
      refs: value.citedScenarios.map((i) => `scenario ${i + 1}`),
      tool: `Summarized ${n} scenarios with ${via}`,
      reply: value.recommendation,
      done: `${SUMMARIZER} done`,
    }),
    log: (rows) => ctx.runMutation(internal.fieldAnalyst.record, { runId, rows }),
  });
  if (!out.ok)
    return out.status === "busy" ? "busy" : { status: out.status, reason: out.reason, at: at() };
  return {
    status: "done",
    recommendation: out.value.recommendation,
    rationale: out.value.rationale,
    citedScenarios: out.value.citedScenarios,
    model: out.model,
    provider: out.provider,
    ...(out.remoteRunId && { remoteRunId: out.remoteRunId }),
    ...(out.usage && {
      inputTokens: out.usage.inputTokens,
      outputTokens: out.usage.outputTokens,
    }),
    at: at(),
  };
}

/**
 * Research agent's CREAO step: one budgeted run on the CREAO app for counterparty risk notes,
 * only when the app is configured and its profile is listed in DOMINO_CREAO_VERIFIED_PROFILES.
 * research#1 itself runs it, logged with agentKind "creao" (no Domino hand-off). An answer that
 * fails validation gets one repair run. Otherwise, or on failure, nothing is stored (no canned
 * stand-in) and the log says exactly why: research.creaoUnavailable (app or profile gate),
 * research.creaoSkipped (budget, lock or nothing to research; logged once per version) or
 * agent.failed (the run). Returns a short outcome for the research report. Never throws.
 */
async function counterpartyResearch(
  ctx: ActionCtx,
  runId: string,
  c: { companyId: Id<"companies">; snapshotVersion: number },
  s: Snapshot,
  /** The coordinator's research_counterparty pick, researched first when it is in the job. */
  first: string | undefined,
  blocked: boolean,
): Promise<string> {
  const write = (r: Omit<RecordArgs, "runId">) =>
    ctx.runMutation(internal.fieldAnalyst.record, { runId, ...r });
  const note = async (
    action: "research.creaoUnavailable" | "research.creaoSkipped",
    summary: string,
  ) => {
    if (await ctx.runQuery(internal.fieldAi.repeatRun, { runId })) return summary;
    await write({
      rows: [
        {
          action,
          agentId: RESEARCH,
          agentKind: "domino",
          parentAgentId: ANALYST,
          event: "status",
          status: "working",
          currentTask: "Research: counterparty risk (CREAO)",
          summary,
        },
      ],
    });
    return summary;
  };
  const gate = await creaoGate("research");
  if (!gate.ok)
    return note(
      "research.creaoUnavailable",
      `CREAO unavailable (${gate.reason}); no counterparty notes`,
    );
  const company: string = await ctx.runQuery(internal.fieldAnalyst.companyName, {
    companyId: c.companyId,
    runId,
  });
  const plain = counterpartyJob(s, company);
  // Public signals the research agent already fetched (Apify, cached 24 h) ride along as facts.
  const signals = await cachedSignals(
    ctx,
    plain.counterparties.map((p) => p.name),
  );
  const base = {
    ...plain,
    counterparties: plain.counterparties.map((p) => ({
      ...p,
      facts: [...p.facts, ...signalFacts(signals[p.name])],
    })),
  };
  if (base.counterparties.length === 0)
    return note("research.creaoSkipped", "CREAO skipped: no customers or vendors in the snapshot");
  const picked = base.counterparties.filter((p) => p.name === first);
  const job = {
    ...base,
    counterparties: [...picked, ...base.counterparties.filter((p) => p.name !== first)],
  };
  if (blocked)
    return note("research.creaoSkipped", `CREAO skipped: ${BUSY_TOO_LONG}; no counterparty notes`);
  const scope = `v${c.snapshotVersion}`;
  const reservation: Reservation = await ctx.runMutation(internal.fieldAi.reserve, {
    companyId: c.companyId,
    analystRunId: runId,
    kind: "research",
    provider: "creao",
    scope,
  });
  if (!reservation.ok && reservation.busy) return "busy";
  if (!reservation.ok)
    return note(
      "research.creaoSkipped",
      `CREAO skipped: ${reservation.reason}; no counterparty notes`,
    );
  const names = job.counterparties.map((p) => p.name);
  const task = `Counterparty risk notes for ${names.length} customers and vendors`;
  const as = (r: Omit<AgentRow, "agentId" | "agentKind" | "parentAgentId">): AgentRow => ({
    agentId: RESEARCH,
    agentKind: "creao",
    parentAgentId: ANALYST,
    ...r,
  });
  await write({
    rows: [
      {
        action: "agent.message",
        agentId: ANALYST,
        agentKind: "domino",
        event: "message",
        fromAgentId: ANALYST,
        toAgentId: RESEARCH,
        refs: names,
        summary: `Write a risk note for: ${names.join(", ")}`,
      },
      as({
        action: "agent.spawned",
        event: "status",
        status: "spawned",
        currentTask: task,
        refs: names,
        summary: `Research agent runs on CREAO for ${names.length} counterparties${
          picked.length > 0 ? ` (${first} first, as the coordinator asked)` : ""
        }`,
      }),
    ],
  });
  const working = (summary: string, refs?: string[]) =>
    write({
      rows: [
        as({
          action: "agent.working",
          event: "status",
          status: "working",
          currentTask: task,
          ...(refs && { refs }),
          summary,
        }),
      ],
    });
  try {
    const result = await runCreaoStep(
      ctx,
      {
        companyId: c.companyId,
        analystRunId: runId,
        kind: "research",
        scope,
        callId: reservation.callId,
        job: counterpartyCreaoJob(job),
      },
      creaoHooks(working, "notes"),
    );
    const notes = result.value;
    const via = `CREAO run ${result.runId}${result.repaired ? " (repaired)" : ""}`;
    await write({
      rows: [
        as({
          action: "agent.tool",
          event: "tool",
          tool: "creao.counterpartyRisk",
          toolCategory: "creao",
          toolLabel: "CREAO app run",
          source: "creao",
          currentTask: task,
          refs: [result.runId, ...notes.map((n) => n.counterparty)],
          summary: `${via}: ${notes.map((n) => `${n.counterparty} ${n.risk}`).join("; ")}`,
        }),
        as({
          action: "agent.message",
          event: "message",
          fromAgentId: RESEARCH,
          toAgentId: ANALYST,
          refs: [result.runId],
          summary: notes.map((n) => `${n.counterparty}: ${n.note}`).join(" | "),
        }),
        as({
          action: "agent.done",
          event: "status",
          status: "done",
          currentTask: "Research reported",
          summary: `${RESEARCH} done: ${notes.length} counterparty notes from ${via}`,
        }),
      ],
      research: {
        actor: "creao/counterparty-risk",
        name: "Counterparty risk notes",
        input: names.join(", "),
        items: notes.map((n) => `${n.counterparty} (${n.risk} risk): ${n.note}`),
        provider: "creao",
        remoteRunId: result.runId,
      },
    });
    return `${via}: ${notes.length} counterparty notes`;
  } catch (error) {
    const failure = failureOf(error);
    await write({
      rows: [
        as({
          action: "agent.failed",
          event: "status",
          status: "failed",
          currentTask: task,
          summary: `CREAO run failed (${failure}); no counterparty notes`,
        }),
      ],
    });
    return `CREAO run failed (${failure}); no counterparty notes`;
  }
}

export const companyName = internalQuery({
  args: { companyId: v.id("companies"), runId: v.optional(v.string()) },
  handler: async (ctx, { companyId, runId }) => {
    if (!runId) return (await ctx.db.get("companies", companyId))?.name ?? "";
    const run = await runRow(ctx, runId);
    return run?.companyId === companyId
      ? (pinnedInputs(run)?.company.name ?? "Unknown saved company")
      : "";
  },
});

/** Closes the run with the engine summary, the coordinator plan and the AI summary. */
export const finish = internalMutation({
  args: {
    runId: v.string(),
    summary: v.string(),
    aiSummary: aiSummaryArg,
    coordinator: v.optional(coordinatorRecordArg),
  },
  handler: async (ctx, { runId, summary, aiSummary, coordinator }) => {
    const run = await runRow(ctx, runId);
    if (!run || run.status !== "running") return null;
    // A repeat run on one version only re-states the skip an earlier run already logged.
    const quiet =
      aiSummary.status === "skipped" &&
      (aiSummary.reason ?? "").includes(ALREADY_RAN) &&
      (await isRepeatRun(ctx, runId));
    if (aiSummary.status !== "done" && !quiet)
      await agentLog(ctx, run.companyId, runId, {
        action: "analyst.aiSummarySkipped",
        agentKind: "domino",
        agentId: ANALYST,
        event: "status",
        status: "working",
        currentTask: "Writing the engine summary",
        summary: `AI summary ${aiSummary.status} (${aiSummary.reason ?? "no reason"}); engine summary only`,
      });
    await ctx.db.patch("analystRuns", run._id, {
      status: "done",
      finishedAt: new Date().toISOString(),
      summary,
      aiSummary,
      ...(coordinator && { coordinator }),
    });
    const failing = (
      await ctx.db
        .query("analystScenarios")
        .withIndex("by_runId_and_index", (q) => q.eq("runId", runId))
        .take(20)
    ).filter((r) => r.status === "done" && !(r.work as ForecastWork).survives);
    await agentLog(ctx, run.companyId, runId, {
      action: "analyst.tool",
      agentKind: "domino",
      agentId: ANALYST,
      event: "tool",
      tool: "convex.analystRuns",
      toolCategory: "convex",
      refs: [runId],
      summary: `Wrote analyst result for snapshot v${run.snapshotVersion}`,
    });
    await agentLog(ctx, run.companyId, runId, {
      action: "analyst.done",
      agentKind: "domino",
      agentId: ANALYST,
      event: "status",
      status: "done",
      currentTask: "Idle",
      refs: failing.map((r) => r.scenarioId),
      summary: `Analyst done: ${summary}`,
    });
    await freezeTrace(ctx, run._id);
    // The brain deploys its own forecast runs: top risks and fix saved to Timeline, with effects.
    await ctx.scheduler.runAfter(0, internal.fieldForecastRuns.afterAnalyst, {
      companyId: run.companyId,
      runId,
    });
    // Every meaningful new snapshot version gets a run (and so a coordinator plan): a version
    // ingested while this run was busy was skipped by startRun, so pick up the newest one now.
    // The simulated clock's routine days and its own queued run are left to the clock.
    const feed = await requireFeed(ctx, run.companyId);
    if (
      feed.snapshotVersion > run.snapshotVersion &&
      feed.lastSnapshotId &&
      (await wantsCatchUp(ctx, run.companyId, run.snapshotVersion, feed.snapshotVersion))
    )
      await startRun(ctx, run.companyId, "catch-up", DEFAULT_PACE_MS);
    return null;
  },
});

/** Scheduled by fieldJobs.runIngest after every successful ingest. Never throws. */
export const afterIngest = internalMutation({
  args: { companyId: v.id("companies"), changed: v.boolean() },
  handler: async (ctx, { companyId, changed }) => {
    const feed = await requireFeed(ctx, companyId);
    if (changed) {
      try {
        await startRun(ctx, companyId, "ingest", DEFAULT_PACE_MS);
      } catch (error) {
        await agentLog(ctx, companyId, `analyst-${Date.now().toString(36)}`, {
          action: "analyst.failed",
          agentKind: "domino",
          agentId: ANALYST,
          event: "status",
          status: "failed",
          summary: `Analyst could not start: ${errorText(error)}`,
        });
      }
    }
    if (!feed.auto) return null;
    const loop = await ctx.db
      .query("analystLoops")
      .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
      .unique();
    if (loop?.generation === feed.autoGeneration) return null;
    const state = { companyId, generation: feed.autoGeneration, ticksLeft: LOOP_MAX_RUNS };
    if (loop) await ctx.db.replace("analystLoops", loop._id, state);
    else await ctx.db.insert("analystLoops", state);
    await agentLog(ctx, companyId, `analyst-loop-${feed.autoGeneration}`, {
      action: "analyst.loopStarted",
      agentKind: "system",
      agentId: LOOP_AGENT,
      event: "status",
      status: "working",
      currentTask: `Re-run the analyst every ${LOOP_INTERVAL_MS / 1000} s`,
      summary: `Analyst loop on: every ${LOOP_INTERVAL_MS / 1000} s, at most ${LOOP_MAX_RUNS} runs`,
    });
    await ctx.scheduler.runAfter(LOOP_INTERVAL_MS, internal.fieldAnalyst.tick, {
      companyId,
      generation: feed.autoGeneration,
    });
    return null;
  },
});

export const tick = internalMutation({
  args: { companyId: v.id("companies"), generation: v.number() },
  handler: async (ctx, { companyId, generation }) => {
    const feed = await requireFeed(ctx, companyId);
    const loop = await ctx.db
      .query("analystLoops")
      .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
      .unique();
    if (!loop || loop.generation !== generation) return null;
    // The engine recompute after an ingest scans the log; wait rather than collide with it.
    const sinceIngest = feed.lastIngestAt
      ? Date.now() - Date.parse(feed.lastIngestAt)
      : Number.POSITIVE_INFINITY;
    if (feed.auto && sinceIngest < INGEST_QUIET_MS) {
      await ctx.scheduler.runAfter(INGEST_QUIET_MS, internal.fieldAnalyst.tick, {
        companyId,
        generation,
      });
      return null;
    }
    if (!feed.auto || feed.autoGeneration !== generation || loop.ticksLeft <= 0) {
      await agentLog(ctx, companyId, `analyst-loop-${generation}`, {
        action: "analyst.loopStopped",
        agentKind: "system",
        agentId: LOOP_AGENT,
        event: "status",
        status: "done",
        summary:
          loop.ticksLeft <= 0
            ? `Analyst loop stopped after ${LOOP_MAX_RUNS} runs`
            : "Analyst loop stopped: auto mode is off",
      });
      await ctx.db.patch("analystLoops", loop._id, { ticksLeft: 0, generation: -1 });
      return null;
    }
    await ctx.db.patch("analystLoops", loop._id, { ticksLeft: loop.ticksLeft - 1 });
    await agentLog(ctx, companyId, `analyst-loop-${generation}`, {
      action: "analyst.loopTick",
      agentKind: "system",
      agentId: LOOP_AGENT,
      event: "message",
      fromAgentId: LOOP_AGENT,
      toAgentId: ANALYST,
      summary: `Scheduled analyst run (${LOOP_MAX_RUNS - loop.ticksLeft + 1} of ${LOOP_MAX_RUNS})`,
    });
    try {
      await startRun(ctx, companyId, "auto", DEFAULT_PACE_MS);
    } catch {
      // No snapshot yet: try again next tick.
    }
    await ctx.scheduler.runAfter(LOOP_INTERVAL_MS, internal.fieldAnalyst.tick, {
      companyId,
      generation,
    });
    return null;
  },
});

export const latest = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const runs = await ctx.db
      .query("analystRuns")
      .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(10);
    const pick = runs.find((r) => r.status === "done") ?? runs[0];
    if (!pick) return null;
    const rows = await ctx.db
      .query("analystScenarios")
      .withIndex("by_runId_and_index", (q) => q.eq("runId", pick.runId))
      .take(20);
    const firstWork = rows.find((r) => r.work)?.work as ForecastWork | undefined;
    // One AI summary and one coordinator plan per snapshot version: later runs on the same
    // version show them with the run that made them, instead of a second call.
    const summarized =
      pick.aiSummary?.status === "done"
        ? pick
        : runs.find(
            (r) => r.snapshotVersion === pick.snapshotVersion && r.aiSummary?.status === "done",
          );
    const aiSummary = summarized?.aiSummary ?? pick.aiSummary;
    const planned =
      pick.coordinator?.status === "done"
        ? pick
        : runs.find(
            (r) => r.snapshotVersion === pick.snapshotVersion && r.coordinator?.status === "done",
          );
    const coordinator = planned?.coordinator ?? pick.coordinator;
    return {
      aiSummary: aiSummary ? { ...aiSummary, runId: (summarized ?? pick).runId } : null,
      coordinator: coordinator ? { ...coordinator, runId: (planned ?? pick).runId } : null,
      runId: pick.runId,
      status: pick.status,
      trigger: pick.trigger,
      asOf: pick.asOf,
      snapshotVersion: pick.snapshotVersion,
      startedAt: pick.startedAt,
      finishedAt: pick.finishedAt ?? null,
      summary: pick.summary ?? null,
      reported: pick.reported,
      children: pick.children,
      inProgress: runs[0]?.status === "running" ? runs[0].runId : null,
      baseline: firstWork ? { survives: firstWork.baseSurvives, low: firstWork.baseLow } : null,
      scenarios: rows.map((r) => {
        const work = r.work as ForecastWork | undefined;
        const fixes = (r.fixes as FixResult[] | undefined) ?? [];
        return {
          index: r.index,
          agentId: r.agentId,
          id: r.scenarioId,
          title: r.title,
          basis: r.basis,
          status: r.status,
          survives: work?.survives ?? null,
          breaksWeek: work?.breaksWeek ?? null,
          breaksAt: work?.breaksAt ?? null,
          brokenConstraintId: work?.brokenConstraintId ?? null,
          low: work?.low ?? null,
          lowWeek: work?.lowWeek ?? null,
          cashImpact: work?.cashImpact ?? null,
          cashImpactWeek: work?.cashImpactWeek ?? null,
          lowPointImpact: work ? work.low - work.baseLow : null,
          bestFix: fixes[0] ?? null,
          fixes,
          error: r.error ?? null,
          /** Saved Timeline risk run (fieldForecastRuns.ts), null until the agent saves it. */
          forecast: r.forecast
            ? {
                timelineCompanyId: r.forecast.timelineCompanyId,
                scenarioRunId: r.forecast.scenarioRunId,
                low: r.forecast.low,
                outOfCash: r.forecast.outOfCash ?? null,
                effects: r.forecast.effects,
              }
            : null,
        };
      }),
      research: (pick.research as unknown[] | undefined) ?? [],
    };
  },
});
