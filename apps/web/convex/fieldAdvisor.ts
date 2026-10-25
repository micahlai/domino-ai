import type { Change } from "@domino/contracts";
/**
 * Advisor swarm, only when it makes sense: after the analyst's forecasters report, if a scenario
 * takes usable cash below the lender's minimum, the analyst ("analyst#1") starts one advisor per
 * candidate fix ("advisor.credit_line_draw", "advisor.delay_bill",
 * "advisor.accelerate_collections", "advisor.defer_hires"; engine advisorCandidates). Each
 * advisor is its own internal action computing that fix's engine effect under the scenario
 * (engine adviseFix: cash at the low point, survives or not), at most SWARM_LIMIT at once. The
 * results are stored as suggestions (one per scenario and fix kind, refreshed while open). Then
 * CREAO ("fix-recommender#1", role "advisor", ids only) recommends one with a rationale; without
 * CREAO the suggestions stay in engine order with no recommendation and the log says why.
 * No scenario below the minimum, or fewer than two fixes to compare: no advisors at all.
 * One advisor round per scenario and snapshot version; analyst loop reruns skip it.
 * Suggestions are records only: accepting one moves no money (fieldSuggestions.ts).
 *
 * Chain (fieldAnalyst.ts): counterpartyStep -> advisorStep -> recommendStep -> finish.
 */
import {
  type AdvisorCandidate,
  type AdvisorEffect,
  type AdvisorFixKind,
  adviseFix,
  advisorCandidates,
  rankAdvice,
  scenarioLow,
} from "@domino/engine";
import { v } from "convex/values";
import { type AdvisorInput, advisorCreaoJob } from "../../../packages/agents/src/fieldCreao";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import {
  BUSY_TOO_LONG,
  CREAO_WAIT_MS,
  type Reservation,
  creaoGate,
  creaoHooks,
  failureOf,
  queuedRow,
  runCreaoStep,
  shouldWait,
} from "./fieldAi";
import { ANALYST } from "./fieldAnalyst";
import type { AgentRow } from "./lib/agentLog";
import { type Inputs, usd } from "./lib/analystScenarios";
import { coordinatorRecordArg } from "./lib/coordinatorRecord";
import { SWARM_LIMIT, mapBounded, member } from "./lib/swarm";

export const RECOMMENDER = "fix-recommender#1";
export const advisorAgent = (kind: AdvisorFixKind) => `advisor.${kind}`;
const KIND_LABEL: Record<AdvisorFixKind, string> = {
  credit_line_draw: "Credit line advisor",
  delay_bill: "Bill timing advisor",
  accelerate_collections: "Collections advisor",
  defer_hires: "Hiring advisor",
};
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const nowIso = () => new Date().toISOString();

const aiSummaryArg = v.any();
const chainArgs = {
  runId: v.string(),
  summary: v.string(),
  coordinator: coordinatorRecordArg,
  aiSummary: aiSummaryArg,
};

type Target = {
  index: number;
  scenarioId: string;
  title: string;
  changes: Change[];
  breaksWeek: number | null;
};

/** Finished failing scenarios of a running run, the coordinator's focus first, then earliest. */
export const targets = internalQuery({
  args: { runId: v.string(), focus: v.optional(v.number()) },
  handler: async (ctx, { runId, focus }) => {
    const run = await ctx.db
      .query("analystRuns")
      .withIndex("by_runId", (q) => q.eq("runId", runId))
      .unique();
    if (!run || run.status !== "running") return null;
    const rows = await ctx.db
      .query("analystScenarios")
      .withIndex("by_runId_and_index", (q) => q.eq("runId", runId))
      .take(20);
    const failing = rows
      .filter((r) => r.status === "done" && r.work && !(r.work as { survives: boolean }).survives)
      .map(
        (r): Target => ({
          index: r.index,
          scenarioId: r.scenarioId,
          title: r.title,
          changes: r.changes as Change[],
          breaksWeek: (r.work as { breaksWeek?: number }).breaksWeek ?? null,
        }),
      )
      .sort(
        (a, b) =>
          Number(b.index === focus) - Number(a.index === focus) ||
          (a.breaksWeek ?? 99) - (b.breaksWeek ?? 99) ||
          a.index - b.index,
      );
    const company = (await ctx.db.get("companies", run.companyId))?.name ?? "";
    return {
      companyId: run.companyId,
      snapshotVersion: run.snapshotVersion,
      asOf: run.asOf,
      company,
      failing,
    };
  },
});

/** True when this scenario already got an advisor round on this snapshot version. */
export const advised = internalQuery({
  args: { companyId: v.id("companies"), scenarioId: v.string(), snapshotVersion: v.number() },
  handler: async (ctx, { companyId, scenarioId, snapshotVersion }) => {
    for (const kind of [
      "credit_line_draw",
      "delay_bill",
      "accelerate_collections",
      "defer_hires",
    ]) {
      const row = await ctx.db
        .query("suggestions")
        .withIndex("by_companyId_and_suggestionId", (q) =>
          q.eq("companyId", companyId).eq("suggestionId", `${scenarioId}:${kind}`),
        )
        .unique();
      if (row && row.snapshotVersion >= snapshotVersion) return true;
    }
    return false;
  },
});

/** One advisor: the engine effect of one candidate fix. Never throws. */
export const advise = internalAction({
  args: {
    runId: v.string(),
    scenarioIndex: v.number(),
    scenario: v.object({ id: v.string(), label: v.string(), changes: v.any() }),
    candidate: v.any(),
  },
  handler: async (
    ctx,
    a,
  ): Promise<{ ok: true; effect: AdvisorEffect } | { ok: false; error: string }> => {
    const candidate = a.candidate as AdvisorCandidate;
    const agentId = advisorAgent(candidate.kind);
    const m = member(agentId, ANALYST);
    const write = (rows: AgentRow[]) =>
      ctx.runMutation(internal.fieldAnalyst.record, { runId: a.runId, rows });
    const currentTask = `Scenario ${a.scenarioIndex + 1}: ${candidate.fix.label}`;
    try {
      await write([
        m.working({ currentTask, summary: `${agentId} scoring: ${candidate.fix.label}` }),
      ]);
      const inputs: Inputs = await ctx.runQuery(internal.fieldAnalyst.inputs, { runId: a.runId });
      const effect = adviseFix(
        { ...inputs, scenario: { ...a.scenario, changes: a.scenario.changes as Change[] } },
        candidate,
      );
      const outcome = `low point ${usd(effect.lowPoint)} (${effect.gain >= 0 ? "+" : ""}${usd(effect.gain)}), ${
        effect.survives ? "stays above the cash minimum" : "still breaks a limit"
      }`;
      await write([
        m.tool({
          tool: "engine.adviseFix",
          toolCategory: "engine",
          currentTask,
          refs: [candidate.fix.id, a.scenario.id],
          summary: `${candidate.fix.label}: ${outcome}`,
        }),
        m.reported(`${candidate.fix.label}: ${outcome}`, [candidate.fix.id]),
        m.done({
          currentTask: `${KIND_LABEL[candidate.kind]}: reported`,
          summary: `${agentId} done: ${outcome}`,
        }),
      ]);
      return { ok: true, effect };
    } catch (error) {
      await write([
        m.failed({ currentTask, summary: `${agentId} failed: ${errorText(error)}` }),
      ]).catch(() => undefined);
      return { ok: false, error: errorText(error) };
    }
  },
});

const fixKind = v.union(
  v.literal("credit_line_draw"),
  v.literal("delay_bill"),
  v.literal("accelerate_collections"),
  v.literal("defer_hires"),
);
const risk = v.union(v.literal("low"), v.literal("medium"), v.literal("high"));

/** Upserts one round's suggestions; a decided suggestion keeps its decision. */
export const store = internalMutation({
  args: {
    companyId: v.id("companies"),
    runId: v.string(),
    snapshotVersion: v.number(),
    scenarioId: v.string(),
    scenarioTitle: v.string(),
    scenarioLow: v.number(),
    lenderMinimum: v.number(),
    items: v.array(
      v.object({
        kind: fixKind,
        fix: v.object({
          id: v.string(),
          label: v.string(),
          costNote: v.string(),
          risk,
          changes: v.any(),
        }),
        effect: v.object({
          lowPoint: v.number(),
          lowWeekStart: v.string(),
          survives: v.boolean(),
          gain: v.number(),
          breaksAt: v.optional(v.string()),
          brokenConstraintId: v.optional(v.string()),
        }),
      }),
    ),
  },
  handler: async (ctx, a) => {
    const feed = await ctx.db
      .query("feeds")
      .withIndex("by_companyId", (q) => q.eq("companyId", a.companyId))
      .unique();
    if (!feed || feed.snapshotVersion !== a.snapshotVersion) return [];
    const run = await ctx.db
      .query("analystRuns")
      .withIndex("by_runId", (q) => q.eq("runId", a.runId))
      .unique();
    const latest = await ctx.db
      .query("analystRuns")
      .withIndex("by_companyId", (q) => q.eq("companyId", a.companyId))
      .order("desc")
      .first();
    if (
      !run ||
      run.companyId !== a.companyId ||
      run.snapshotVersion !== a.snapshotVersion ||
      run.status !== "running" ||
      latest?._id !== run._id
    )
      return [];
    const at = nowIso();
    const ids: string[] = [];
    for (const [rank, item] of a.items.entries()) {
      const suggestionId = `${a.scenarioId}:${item.kind}`;
      const doc = {
        companyId: a.companyId,
        suggestionId,
        runId: a.runId,
        snapshotVersion: a.snapshotVersion,
        scenarioId: a.scenarioId,
        scenarioTitle: a.scenarioTitle,
        agentId: advisorAgent(item.kind),
        fix: { ...item.fix, kind: item.kind },
        effect: { ...item.effect, scenarioLow: a.scenarioLow, lenderMinimum: a.lenderMinimum },
        rank,
        recommended: false,
        status: "open" as const,
        updatedAt: at,
      };
      const existing = await ctx.db
        .query("suggestions")
        .withIndex("by_companyId_and_suggestionId", (q) =>
          q.eq("companyId", a.companyId).eq("suggestionId", suggestionId),
        )
        .unique();
      if (!existing) await ctx.db.insert("suggestions", { ...doc, createdAt: at });
      else if (existing.status === "open" && existing.snapshotVersion <= a.snapshotVersion)
        await ctx.db.replace("suggestions", existing._id, {
          ...doc,
          createdAt: existing.createdAt,
        });
      ids.push(suggestionId);
    }
    return ids;
  },
});

export const recommend = internalMutation({
  args: {
    companyId: v.id("companies"),
    suggestionId: v.string(),
    runId: v.string(),
    snapshotVersion: v.number(),
    text: v.string(),
    remoteRunId: v.string(),
  },
  handler: async (ctx, { companyId, suggestionId, runId, snapshotVersion, text, remoteRunId }) => {
    const feed = await ctx.db
      .query("feeds")
      .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
      .unique();
    if (!feed || feed.snapshotVersion !== snapshotVersion) return false;
    const row = await ctx.db
      .query("suggestions")
      .withIndex("by_companyId_and_suggestionId", (q) =>
        q.eq("companyId", companyId).eq("suggestionId", suggestionId),
      )
      .unique();
    if (
      !row ||
      row.status !== "open" ||
      row.runId !== runId ||
      row.snapshotVersion !== snapshotVersion
    )
      return false;
    await ctx.db.patch("suggestions", row._id, {
      recommended: true,
      recommendation: { text: text.slice(0, 500), provider: "creao", remoteRunId, at: nowIso() },
    });
    return true;
  },
});

/** What recommendStep needs: the round's open suggestions, engine order. */
export const round = internalQuery({
  args: { companyId: v.id("companies"), runId: v.string() },
  handler: async (ctx, { companyId, runId }) => {
    const open = await ctx.db
      .query("suggestions")
      .withIndex("by_companyId_and_runId", (q) => q.eq("companyId", companyId).eq("runId", runId))
      .take(100);
    return open.filter((s) => s.status === "open").sort((a, b) => a.rank - b.rank);
  },
});

type Round = { scenarioIndex: number; breaksWeek: number | null; companyId: Id<"companies"> };

/**
 * Engine half of the advisor round: pick the scenario, spawn one advisor per candidate fix, run
 * them in parallel, store the suggestions. Always continues the chain (recommendStep or finish).
 */
export const advisorStep = internalAction({
  args: chainArgs,
  handler: async (ctx, args) => {
    let round: Round | null = null;
    try {
      round = await advisorRound(ctx, args.runId, args.coordinator.focus?.scenarioIndex);
    } catch (error) {
      await ctx
        .runMutation(internal.fieldAnalyst.record, {
          runId: args.runId,
          rows: [
            {
              action: "analyst.advisorsFailed",
              agentId: ANALYST,
              agentKind: "domino",
              event: "status",
              status: "working",
              summary: `Advisor round failed: ${errorText(error)}`,
            },
          ],
        })
        .catch(() => undefined);
    }
    if (round)
      await ctx.scheduler.runAfter(0, internal.fieldAdvisor.recommendStep, {
        ...args,
        companyId: round.companyId,
        scenarioIndex: round.scenarioIndex,
        breaksWeek: round.breaksWeek ?? undefined,
      });
    else await ctx.runMutation(internal.fieldAnalyst.finish, args);
    return null;
  },
});

async function advisorRound(
  ctx: ActionCtx,
  runId: string,
  focus: number | undefined,
): Promise<Round | null> {
  const t = await ctx.runQuery(internal.fieldAdvisor.targets, {
    runId,
    ...(focus !== undefined && { focus }),
  });
  if (!t || t.failing.length === 0) return null;
  const inputs: Inputs = await ctx.runQuery(internal.fieldAnalyst.inputs, { runId });
  // The first failing scenario that is actually below the lender's minimum (not only late on a bill).
  const pick = t.failing
    .map((sc) => {
      const input = {
        ...inputs,
        scenario: { id: sc.scenarioId, label: sc.title, changes: sc.changes },
      };
      return { sc, input, low: scenarioLow(input) };
    })
    .find((x) => x.low.belowMinimum);
  const floor = pick?.low.floor;
  if (!pick || floor === undefined) return null;
  const { sc, input, low } = pick;
  const already = await ctx.runQuery(internal.fieldAdvisor.advised, {
    companyId: t.companyId,
    scenarioId: sc.scenarioId,
    snapshotVersion: t.snapshotVersion,
  });
  if (already) return null;
  const candidates = advisorCandidates(input);
  const write = (rows: AgentRow[]) =>
    ctx.runMutation(internal.fieldAnalyst.record, { runId, rows });
  const n = sc.index + 1;
  if (candidates.length < 2) return null;
  await write([
    {
      action: "analyst.working",
      agentId: ANALYST,
      agentKind: "domino",
      event: "status",
      status: "working",
      currentTask: `Scenario ${n} breaks the cash minimum: comparing ${candidates.length} fixes`,
      refs: [sc.scenarioId],
      summary: `Scenario ${n} (${sc.title}) falls to ${usd(low.low)}, under the cash minimum of ${usd(floor)}; starting ${candidates.length} advisors`,
    },
    ...candidates.flatMap((c) => {
      const m = member(advisorAgent(c.kind), ANALYST);
      return [
        m.spawned({
          currentTask: `Scenario ${n}: ${c.fix.label}`,
          refs: [c.fix.id],
          summary: `Analyst spawned ${advisorAgent(c.kind)} (${KIND_LABEL[c.kind]})`,
        }),
        m.assigned(`Score "${c.fix.label}" under scenario ${n} with the engine`, [c.fix.id]),
      ];
    }),
  ]);
  const settled = await mapBounded(candidates, SWARM_LIMIT, (candidate) =>
    ctx.runAction(internal.fieldAdvisor.advise, {
      runId,
      scenarioIndex: sc.index,
      scenario: { id: sc.scenarioId, label: sc.title, changes: sc.changes },
      candidate,
    }),
  );
  const results = candidates.flatMap((candidate, i) => {
    const s = settled[i];
    return s?.status === "fulfilled" && s.value.ok ? [{ candidate, effect: s.value.effect }] : [];
  });
  if (results.length === 0) return null;
  const ranked = rankAdvice(results);
  await ctx.runMutation(internal.fieldAdvisor.store, {
    companyId: t.companyId,
    runId,
    snapshotVersion: t.snapshotVersion,
    scenarioId: sc.scenarioId,
    scenarioTitle: sc.title,
    scenarioLow: low.low,
    lenderMinimum: floor,
    items: ranked.map(({ candidate, effect }) => ({
      kind: candidate.kind,
      fix: {
        id: candidate.fix.id,
        label: candidate.fix.label,
        costNote: candidate.fix.costNote,
        risk: candidate.fix.risk,
        changes: candidate.fix.changes,
      },
      effect: {
        lowPoint: effect.lowPoint,
        lowWeekStart: effect.lowWeekStart,
        survives: effect.survives,
        gain: effect.gain,
        ...(effect.breaksAt && { breaksAt: effect.breaksAt }),
        ...(effect.brokenConstraintId && { brokenConstraintId: effect.brokenConstraintId }),
      },
    })),
  });
  const surviving = ranked.filter((r) => r.effect.survives).length;
  await write([
    {
      action: "analyst.tool",
      agentId: ANALYST,
      agentKind: "domino",
      event: "tool",
      tool: "convex.suggestions",
      toolCategory: "convex",
      refs: ranked.map((r) => r.candidate.fix.id),
      summary: `Saved ${ranked.length} suggestions for scenario ${n}: ${surviving} keep cash above the cash minimum`,
    },
  ]);
  return { scenarioIndex: sc.index, breaksWeek: sc.breaksWeek, companyId: t.companyId };
}

/** CREAO half: recommend one stored suggestion (ids only). Always ends in finish. */
export const recommendStep = internalAction({
  args: {
    ...chainArgs,
    companyId: v.id("companies"),
    scenarioIndex: v.number(),
    breaksWeek: v.optional(v.number()),
    wait: v.optional(v.number()),
  },
  handler: async (ctx, { companyId, scenarioIndex, breaksWeek, wait = 0, ...chain }) => {
    let outcome: "busy" | "ok" = "ok";
    try {
      outcome = await recommendFix(
        ctx,
        chain.runId,
        companyId,
        scenarioIndex,
        breaksWeek,
        !shouldWait(wait),
      );
    } catch (error) {
      await note(ctx, chain.runId, `Fix recommendation failed: ${errorText(error)}`);
    }
    if (outcome === "busy") {
      if (wait === 0)
        await ctx.runMutation(internal.fieldAnalyst.record, {
          runId: chain.runId,
          rows: [queuedRow(ANALYST, "Fix recommendation (CREAO)")],
        });
      await ctx.scheduler.runAfter(CREAO_WAIT_MS, internal.fieldAdvisor.recommendStep, {
        ...chain,
        companyId,
        scenarioIndex,
        ...(breaksWeek !== undefined && { breaksWeek }),
        wait: wait + 1,
      });
      return null;
    }
    await ctx.runMutation(internal.fieldAnalyst.finish, chain);
    return null;
  },
});

const note = (ctx: ActionCtx, runId: string, summary: string) =>
  ctx.runMutation(internal.fieldAnalyst.record, {
    runId,
    rows: [
      {
        action: "analyst.recommendSkipped",
        agentId: ANALYST,
        agentKind: "domino",
        event: "status",
        status: "working",
        currentTask: "Fix recommendation (CREAO)",
        summary,
      },
    ],
  });

async function recommendFix(
  ctx: ActionCtx,
  runId: string,
  companyId: Id<"companies">,
  scenarioIndex: number,
  breaksWeek: number | undefined,
  blocked: boolean,
): Promise<"busy" | "ok"> {
  const rows = await ctx.runQuery(internal.fieldAdvisor.round, { companyId, runId });
  const first = rows[0];
  if (!first) return "ok";
  const engineOrder = "suggestions stay in engine order with no recommendation";
  const gate = await creaoGate("advisor");
  if (!gate.ok) {
    await note(ctx, runId, `CREAO unavailable (${gate.reason}); ${engineOrder}`);
    return "ok";
  }
  if (blocked) {
    await note(ctx, runId, `CREAO skipped: ${BUSY_TOO_LONG}; ${engineOrder}`);
    return "ok";
  }
  const t = await ctx.runQuery(internal.fieldAdvisor.targets, { runId });
  const scope = `v${first.snapshotVersion}`;
  const reservation: Reservation = await ctx.runMutation(internal.fieldAi.reserve, {
    companyId,
    kind: "advisor",
    provider: "creao",
    scope,
  });
  if (!reservation.ok && reservation.busy) return "busy";
  if (!reservation.ok) {
    await note(ctx, runId, `CREAO skipped: ${reservation.reason}; ${engineOrder}`);
    return "ok";
  }
  const input: AdvisorInput = {
    company: t?.company ?? "",
    asOf: t?.asOf ?? "",
    snapshotVersion: first.snapshotVersion,
    scenario: {
      id: first.scenarioId,
      title: first.scenarioTitle,
      lowPoint: usd(first.effect.scenarioLow),
      lenderMinimum: usd(first.effect.lenderMinimum),
      breaksWeek: breaksWeek ?? null,
    },
    options: rows.map((r) => ({
      fixId: r.fix.id,
      label: r.fix.label,
      costNote: r.fix.costNote,
      risk: r.fix.risk,
      lowPointWithFix: usd(r.effect.lowPoint),
      survives: r.effect.survives,
      gainVsScenario: usd(r.effect.gain),
    })),
  };
  const task = `Recommend one of ${rows.length} fixes for scenario ${scenarioIndex + 1}`;
  const m = member(RECOMMENDER, ANALYST, "creao");
  const write = (r: AgentRow[]) =>
    ctx.runMutation(internal.fieldAnalyst.record, { runId, rows: r });
  await write([
    m.spawned({
      currentTask: task,
      summary: `Analyst asked CREAO to recommend a fix for scenario ${scenarioIndex + 1}`,
    }),
    m.assigned(
      `${task}: engine results only, answer with a fix id`,
      rows.map((r) => r.fix.id),
    ),
  ]);
  try {
    const run = await runCreaoStep(
      ctx,
      {
        companyId,
        kind: "advisor",
        scope,
        callId: reservation.callId,
        job: advisorCreaoJob(input),
      },
      creaoHooks(
        (summary, refs) =>
          write([m.working({ currentTask: task, ...(refs && { refs }), summary })]),
        "recommendation",
      ),
    );
    const pick = run.value as { fixId: string; rationale: string };
    const chosen = rows.find((r) => r.fix.id === pick.fixId);
    if (chosen)
      await ctx.runMutation(internal.fieldAdvisor.recommend, {
        companyId,
        suggestionId: chosen.suggestionId,
        runId,
        snapshotVersion: first.snapshotVersion,
        text: pick.rationale,
        remoteRunId: run.runId,
      });
    await write([
      m.tool({
        tool: "creao.recommendFix",
        toolCategory: "creao",
        toolLabel: "CREAO: recommend a fix",
        source: "creao",
        currentTask: task,
        refs: [run.runId, pick.fixId],
        summary: `CREAO run ${run.runId}${run.repaired ? " (repaired)" : ""}: ${chosen?.fix.label ?? pick.fixId}`,
      }),
      m.reported(`Recommend ${chosen?.fix.label ?? pick.fixId}: ${pick.rationale}`, [pick.fixId]),
      m.done({
        currentTask: "Idle",
        refs: [run.runId],
        summary: `${RECOMMENDER} done: recommended ${pick.fixId}`,
      }),
    ]);
  } catch (error) {
    await write([
      m.failed({
        currentTask: task,
        summary: `CREAO run failed (${failureOf(error)}); ${engineOrder}`,
      }),
    ]);
  }
  return "ok";
}
