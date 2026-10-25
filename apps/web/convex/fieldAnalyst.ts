/**
 * Field analyst (agent web). An orchestrator agent ("analyst#1") picks 6 to 10 stress scenarios
 * from the latest snapshot and spawns one forecaster sub-agent per scenario ("forecaster#N")
 * plus a research agent ("research#1"). Each child is its own chain of scheduled internal
 * actions (engine work) that write through one internal mutation (`record`), all in parallel;
 * the analyst aggregates when every child reported. Every log row comes from the operation it
 * describes. Forecasters and all money math are deterministic engine code; the Apify actors are
 * demos with canned results. Real model steps are budgeted (fieldAi.ts) and logged with the
 * agentKind that actually ran: the research agent starts "counterparty-research#1" (one CREAO
 * app run) when CREAO is configured and its profile is verified; after aggregation the CREAO
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
 *   tool, toolCategory ("engine" | "apify" | "convex"), toolLabel ("demo actor" for apify)
 *   step, steps    progress of a forecaster (1..6 of 6)
 *
 * Queries
 *   fieldAnalyst.latest({ companyId }) -> null | { runId, status, trigger, asOf,
 *     snapshotVersion, startedAt, finishedAt, summary, reported, children, inProgress,
 *     baseline: { survives, low } | null,
 *     scenarios: [{ index, agentId, id, title, basis, status, survives, breaksWeek,
 *       breaksAt, brokenConstraintId, low, lowWeek, cashImpact (worst weekly usable delta vs
 *       base, cents <= 0), cashImpactWeek, lowPointImpact, bestFix, fixes, error }],
 *     research: [{ actor, name, input, items, provider?: "creao", remoteRunId? }],
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
import {
  CompanyModelSchema,
  ConstraintSchema,
  type Snapshot,
  SnapshotSchema,
} from "@domino/contracts";
import { ConvexError, type Infer, v } from "convex/values";
import { ProviderError } from "../../../packages/agents/src/errors";
import {
  type AnalystDigest,
  counterpartyCreaoEnv,
  counterpartyProfileVersion,
  runCreaoCounterpartyResearch,
  summarizeScenarios,
} from "../../../packages/agents/src/fieldAi";
import { summaryCreaoJob } from "../../../packages/agents/src/fieldCreao";
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
import { type Reservation, runAiStep } from "./fieldAi";
import { coordinate } from "./fieldCoordinator";
import { requireFeed } from "./fieldJobs";
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
import { APIFY_LABEL, checkCustomerNews, lookUpCompanyFunding } from "./lib/apifyDemo";
import { type CoordinatorRecord, coordinatorRecordArg } from "./lib/coordinatorRecord";
import { counterpartyJob } from "./lib/counterparties";
import { parse } from "./lib/parse";

export const ANALYST = "analyst#1";
export const RESEARCH = "research#1";
/** Claude helper of the analyst; only appears when a Claude call is actually made. */
export const SUMMARIZER = "scenario-summarizer#1";
/** CREAO helper of the research agent; only appears when a CREAO run is actually started. */
export const COUNTERPARTY = "counterparty-research#1";
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

async function readInputs(
  ctx: Pick<QueryCtx, "db">,
  companyId: Id<"companies">,
  snapshotId: Id<"snapshots">,
): Promise<Inputs> {
  const row = await ctx.db.get("snapshots", snapshotId);
  const modelRow = await ctx.db
    .query("models")
    .withIndex("by_company_version", (q) => q.eq("companyId", companyId))
    .order("desc")
    .first();
  if (!row || !modelRow) throw new Error("The analyst needs a snapshot and a model");
  const constraints = await ctx.db
    .query("constraints")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .take(100);
  return {
    snapshot: parse(SnapshotSchema, row.data),
    model: parse(CompanyModelSchema, modelRow.data),
    constraints: constraints.map((c) => parse(ConstraintSchema, c.data)),
  };
}

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
  const runId = `analyst-${now.toString(36)}`;
  const version = `v${feed.snapshotVersion}`;
  const company = await ctx.db.get("companies", companyId);
  await ctx.db.insert("analystRuns", {
    companyId,
    runId,
    trigger,
    snapshotId: feed.lastSnapshotId,
    snapshotVersion: feed.snapshotVersion,
    asOf: company?.today ?? "",
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
    const pace = Math.max(0, Math.min(MAX_PACE_MS, Math.floor(paceMs ?? DEFAULT_PACE_MS)));
    return startRun(ctx, companyId, "manual", pace);
  },
});

/** Pinned inputs for one run: its snapshot version, the newest model, every constraint. */
export const inputs = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    const run = await runRow(ctx, runId);
    if (!run) throw new Error(`Unknown analyst run ${runId}`);
    return readInputs(ctx, run.companyId, run.snapshotId);
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
    await ctx.db.patch("analystRuns", run._id, { children: scenarios.length + 1 });
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
        currentTask: task(index, sc.title, "queued"),
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
      currentTask: "Research: customer news, company funding and counterparty risk",
      summary: `Analyst spawned ${RESEARCH} for outside context`,
    });
    await log({
      action: "agent.message",
      agentId: ANALYST,
      event: "message",
      fromAgentId: ANALYST,
      toAgentId: RESEARCH,
      summary:
        "Check news on the top customer, look up company funding and get counterparty risk notes",
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
      const s = inputs.snapshot;
      if (step < 2) {
        const customer =
          c.leadScenarioId === "top_customer_leaves" && c.leadScenario
            ? c.leadScenario.replace(/ leaves$/, "")
            : s.companyId;
        const result = step === 0 ? checkCustomerNews(s, customer) : lookUpCompanyFunding(s);
        await write({
          rows: [
            as({
              action: step === 0 ? "agent.working" : "agent.progress",
              event: "status",
              status: "working",
              currentTask: `Research: ${result.name} (${result.input})`,
              summary: `Calling the ${result.name} ${APIFY_LABEL}`,
            }),
            as({
              action: "agent.tool",
              event: "tool",
              tool: result.actor,
              toolCategory: "apify",
              toolLabel: APIFY_LABEL,
              source: "apify",
              refs: [result.input],
              summary: `${result.name}: ${result.items.join("; ")}`,
            }),
          ],
          research: result,
          next: { fn: "research" as const, step: step + 1 },
        });
        return null;
      }
      const creao = await counterpartyResearch(ctx, runId, c, s);
      const demo = c.research.filter((r) => (r as { provider?: string }).provider !== "creao");
      await write({
        rows: [
          as({
            action: "agent.message",
            event: "message",
            fromAgentId: RESEARCH,
            toAgentId: ANALYST,
            summary: `Research: ${demo.length} demo actor results (canned, not live Apify); ${creao}`,
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
 * After aggregation: the CREAO coordinator plans and Domino executes its allowlisted actions,
 * then one budgeted summary (CREAO first, Claude fallback) turns the engine results into a
 * three-sentence recommendation that leads with the coordinator's focus scenario. Without a
 * provider, over budget or on failure the run closes on the engine summary alone and the log
 * says why. Never throws.
 */
export const summarize = internalAction({
  args: { runId: v.string(), summary: v.string() },
  handler: async (ctx, { runId, summary }) => {
    const at = () => new Date().toISOString();
    let plan: CoordinatorRecord;
    try {
      plan = await coordinate(ctx, runId);
    } catch (error) {
      plan = { status: "failed", reason: `Coordinator step failed: ${errorText(error)}`, at: at() };
    }
    let ai: AiSummary;
    try {
      ai = await aiSummary(ctx, runId, at, plan.focus?.scenarioIndex);
    } catch (error) {
      ai = { status: "unavailable", reason: `Summary step failed: ${errorText(error)}`, at: at() };
    }
    await ctx.runMutation(internal.fieldAnalyst.finish, {
      runId,
      summary,
      aiSummary: ai,
      coordinator: plan,
    });
    return null;
  },
});

async function aiSummary(
  ctx: ActionCtx,
  runId: string,
  at: () => string,
  focusScenario: number | undefined,
): Promise<AiSummary> {
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
    kind: "analyst",
    scope: `v${digest.snapshotVersion}`,
    agentId: SUMMARIZER,
    parentAgentId: ANALYST,
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
  if (!out.ok) return { status: out.status, reason: out.reason, at: at() };
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
 * Otherwise, or on failure, nothing is stored (no canned stand-in) and the log says why.
 * Returns a short outcome for the research report. Never throws.
 */
async function counterpartyResearch(
  ctx: ActionCtx,
  runId: string,
  c: { companyId: Id<"companies">; snapshotVersion: number },
  s: Snapshot,
): Promise<string> {
  const write = (r: Omit<RecordArgs, "runId">) =>
    ctx.runMutation(internal.fieldAnalyst.record, { runId, ...r });
  const note = async (summary: string) => {
    await write({
      rows: [
        {
          action: "research.creaoUnavailable",
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
  const appId = process.env[counterpartyCreaoEnv.appId]?.trim();
  const apiKey = process.env[counterpartyCreaoEnv.apiKey]?.trim();
  if (!appId || !apiKey)
    return note("CREAO unavailable (app not configured); no counterparty notes");
  const version = await counterpartyProfileVersion();
  const verified = (process.env.DOMINO_CREAO_VERIFIED_PROFILES ?? "")
    .split(",")
    .map((p) => p.trim());
  if (!verified.includes(`${appId}/${version}`))
    return note(`CREAO unavailable (profile ${version} not verified); no counterparty notes`);
  const company: string = await ctx.runQuery(internal.fieldAnalyst.companyName, {
    companyId: c.companyId,
  });
  const job = counterpartyJob(s, company);
  if (job.counterparties.length === 0)
    return note("CREAO skipped: no customers or vendors in the snapshot");
  const reservation: Reservation = await ctx.runMutation(internal.fieldAi.reserve, {
    companyId: c.companyId,
    kind: "research",
    provider: "creao",
    scope: `v${c.snapshotVersion}`,
  });
  if (!reservation.ok) return note(`CREAO skipped: ${reservation.reason}`);
  const names = job.counterparties.map((p) => p.name);
  const task = `Counterparty risk notes for ${names.length} customers and vendors`;
  const as = (r: Omit<AgentRow, "agentId" | "agentKind" | "parentAgentId">): AgentRow => ({
    agentId: COUNTERPARTY,
    agentKind: "creao",
    parentAgentId: RESEARCH,
    ...r,
  });
  await write({
    rows: [
      as({
        action: "agent.spawned",
        event: "status",
        status: "spawned",
        currentTask: task,
        refs: names,
        summary: `Research agent started a CREAO run for ${names.length} counterparties`,
      }),
      {
        action: "agent.message",
        agentId: RESEARCH,
        agentKind: "domino",
        event: "message",
        fromAgentId: RESEARCH,
        toAgentId: COUNTERPARTY,
        refs: names,
        summary: `Write a risk note for: ${names.join(", ")}`,
      },
    ],
  });
  try {
    const result = await runCreaoCounterpartyResearch(process.env, job, {
      runDeadlineMs: 120_000,
      onRunCreated: async ({ runId: remote, status }) => {
        await ctx.runMutation(internal.fieldAi.settle, {
          callId: reservation.callId,
          remoteRunId: remote,
        });
        await write({
          rows: [
            as({
              action: "agent.working",
              event: "status",
              status: "working",
              currentTask: task,
              refs: [remote],
              summary: `CREAO run ${remote} created (${status}); polling`,
            }),
          ],
        });
      },
    });
    await ctx.runMutation(internal.fieldAi.settle, {
      callId: reservation.callId,
      status: "ok",
      detail: `${result.notes.length} notes`,
      remoteRunId: result.runId,
    });
    await write({
      rows: [
        as({
          action: "agent.tool",
          event: "tool",
          tool: "creao.counterpartyRisk",
          toolCategory: "creao",
          toolLabel: "CREAO app run",
          source: "creao",
          refs: [result.runId, ...result.notes.map((n) => n.counterparty)],
          summary: `CREAO run ${result.runId}: ${result.notes
            .map((n) => `${n.counterparty} ${n.risk}`)
            .join("; ")}`,
        }),
        as({
          action: "agent.message",
          event: "message",
          fromAgentId: COUNTERPARTY,
          toAgentId: RESEARCH,
          refs: [result.runId],
          summary: result.notes.map((n) => `${n.counterparty}: ${n.note}`).join(" | "),
        }),
        as({
          action: "agent.done",
          event: "status",
          status: "done",
          currentTask: "Idle",
          summary: `${COUNTERPARTY} done: ${result.notes.length} notes from CREAO run ${result.runId}`,
        }),
      ],
      research: {
        actor: "creao/counterparty-risk",
        name: "Counterparty risk notes",
        input: names.join(", "),
        items: result.notes.map((n) => `${n.counterparty} (${n.risk} risk): ${n.note}`),
        provider: "creao",
        remoteRunId: result.runId,
      },
    });
    return `CREAO run ${result.runId}: ${result.notes.length} counterparty notes`;
  } catch (error) {
    const category = error instanceof ProviderError ? error.category : "unexpected";
    await ctx.runMutation(internal.fieldAi.settle, {
      callId: reservation.callId,
      status: "failed",
      detail: category,
    });
    await write({
      rows: [
        as({
          action: "agent.failed",
          event: "status",
          status: "failed",
          currentTask: task,
          summary: `CREAO run failed (${category}); no counterparty notes`,
        }),
      ],
    });
    return `CREAO run failed (${category}); no counterparty notes`;
  }
}

export const companyName = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => (await ctx.db.get("companies", companyId))?.name ?? "",
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
    if (aiSummary.status !== "done")
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
        };
      }),
      research: (pick.research as unknown[] | undefined) ?? [],
    };
  },
});
