/**
 * Forecast runs the agent brain deploys on its own. After each analyst run finishes (forecasting
 * swarm, advisors, CREAO coordinator), every open suggestion of the run (at most MAX_FIXES, the
 * coordinator's focus scenario first) is saved to Timeline through the same path as "Open in
 * forecast": its risk scenario, the fix as a child of that risk, and the risk's domino effects.
 * The resulting runs are stored on the suggestion and on the analyst scenario row, so the Worker
 * and the Dashboard open saved runs instead of computing on click. One more top risk without a
 * fix may be saved beside them.
 *
 * Bounded and idempotent per snapshot: every save uses a request id that hashes its inputs, rows
 * that already hold their runs are skipped, and a later run on the same snapshot reuses the runs
 * an earlier run saved for the same risk and fix instead of branching again. Domino effects call
 * Claude only within the hourly AI budget (fieldCascade.ts). Every number comes from the engine;
 * nothing is paid or moved.
 */
import { canonicalJson } from "@domino/contracts";
import { money } from "@domino/engine";
import { type Infer, v } from "convex/values";
import { FieldTraceSchema } from "../lib/field-trace-contract";
import { workerTimelineHref } from "../lib/timeline-entry";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { cascadeFor } from "./fieldCascade";
import { sha256 } from "./fieldJobs";
import { type ComparisonResult, saveComparison } from "./fieldSuggestionSimulation";
import { savedScenarioForecast, savedSuggestionForecast } from "./schemas/field.schema";
import { timelineRunRef } from "./timeline/chat/brainLog";
import type { WorkspaceRun } from "./timeline/workspace";

/** Suggestions saved per run, plus at most one more top risk. */
const MAX_FIXES = 3;
const COORDINATOR = "coordinator#1";
const FORECASTER = "forecaster#1";

export type ScenarioForecast = Infer<typeof savedScenarioForecast>;
export type SuggestionForecast = Infer<typeof savedSuggestionForecast>;
type SavedFix = ScenarioForecast["fixes"][number];

type Target = {
  suggestionId: string;
  scenarioId: string;
  scenarioTitle: string;
  fixKind: string;
  fixLabel: string;
  /** Runs an earlier analyst run on this snapshot saved for the same risk and fix. */
  reuse: { scenario: ScenarioForecast; fix: SavedFix } | null;
};
type Extra = {
  scenarioId: string;
  title: string;
  changesJson: string;
  reuse: ScenarioForecast | null;
};
type Plan = {
  companyId: Id<"companies">;
  runId: string;
  logRunId: string;
  snapshotVersion: number;
  agent: string;
  /** The coordinator's focus scenario, when it chose one (for the log). */
  focusScenarioId: string | null;
  targets: Target[];
  extra: Extra | null;
  /** A Timeline root this run already saved, so the extra risk can branch from it. */
  root: { timelineCompanyId: string; rootRunId: string } | null;
};

const logRunIdFor = (snapshotId: string) => `forecast-run.${snapshotId}`;
const sameChanges = (a: unknown, b: unknown) => canonicalJson(a ?? []) === canonicalJson(b ?? []);

/** What to save for one finished analyst run, or null when every run is already saved. */
export const plan = internalQuery({
  args: { companyId: v.id("companies"), runId: v.string() },
  handler: async (ctx, args): Promise<Plan | null> => {
    const run = await ctx.db
      .query("analystRuns")
      .withIndex("by_company_and_runId", (q) =>
        q.eq("companyId", args.companyId).eq("runId", args.runId),
      )
      .unique();
    if (!run || run.status !== "done" || !run.traceReceipt) return null;
    const trace = FieldTraceSchema.parse(JSON.parse(run.traceReceipt));
    const rowsOf = (runId: string) =>
      ctx.db
        .query("analystScenarios")
        .withIndex("by_runId_and_index", (q) => q.eq("runId", runId))
        .take(20);
    const rows = new Map((await rowsOf(run.runId)).map((r) => [r.scenarioId, r]));

    // Saved runs of earlier finished runs on the same snapshot, newest first, same changes only.
    const prior = new Map<string, ScenarioForecast>();
    const earlier = (
      await ctx.db
        .query("analystRuns")
        .withIndex("by_companyId", (q) => q.eq("companyId", args.companyId))
        .order("desc")
        .take(10)
    ).filter(
      (r) => r.runId !== run.runId && r.snapshotId === run.snapshotId && r.status === "done",
    );
    for (const r of earlier)
      for (const row of await rowsOf(r.runId)) {
        const current = rows.get(row.scenarioId);
        if (row.forecast && current && !prior.has(row.scenarioId))
          if (sameChanges(row.changes, current.changes)) prior.set(row.scenarioId, row.forecast);
      }

    const harmful = trace.scenarios.filter(
      (s) => s.status === "done" && s.work && s.work.cashImpact > 0 && s.changes.length > 0,
    );
    const focusIndex = run.coordinator?.focus?.scenarioIndex;
    const focus = harmful.find((s) => s.index === focusIndex);
    const ranked = [...harmful].sort(
      (a, b) => (b.work?.cashImpact ?? 0) - (a.work?.cashImpact ?? 0) || a.index - b.index,
    );
    const ordered = focus ? [focus, ...ranked.filter((s) => s !== focus)] : ranked;
    const order = (scenarioId: string) => {
      const i = ordered.findIndex((s) => s.id === scenarioId);
      return i < 0 ? ordered.length : i;
    };

    // Only suggestions the frozen receipt can rebuild: the save path re-reads them from it.
    const saveable = new Set(trace.candidates.map((c) => `${c.suggestionId}|${c.fix.kind}`));
    const open = (
      await ctx.db
        .query("suggestions")
        .withIndex("by_companyId_and_runId", (q) =>
          q.eq("companyId", args.companyId).eq("runId", run.runId),
        )
        .take(50)
    )
      .filter((s) => s.status === "open" && saveable.has(`${s.suggestionId}|${s.fix.kind}`))
      .sort(
        (a, b) =>
          order(a.scenarioId) - order(b.scenarioId) ||
          Number(b.recommended) - Number(a.recommended) ||
          a.rank - b.rank,
      )
      .slice(0, MAX_FIXES);
    const targets = open
      .filter((s) => !s.forecast)
      .map<Target>((s) => {
        const scenario = prior.get(s.scenarioId);
        const fix = scenario?.fixes.find(
          (f) => f.suggestionId === s.suggestionId && f.fixLabel === s.fix.label,
        );
        return {
          suggestionId: s.suggestionId,
          scenarioId: s.scenarioId,
          scenarioTitle: s.scenarioTitle,
          fixKind: s.fix.kind,
          fixLabel: s.fix.label,
          reuse: scenario && fix ? { scenario, fix } : null,
        };
      });

    const covered = new Set(open.map((s) => s.scenarioId));
    const next = ordered.find((s) => !covered.has(s.id));
    const extra: Extra | null =
      next && !rows.get(next.id)?.forecast
        ? {
            scenarioId: next.id,
            title: next.title,
            changesJson: JSON.stringify(next.changes),
            reuse: prior.get(next.id) ?? null,
          }
        : null;
    if (targets.length === 0 && !extra) return null;

    const saved = [...rows.values()].find((r) => r.forecast)?.forecast;
    return {
      companyId: args.companyId,
      runId: args.runId,
      logRunId: logRunIdFor(run.snapshotId),
      snapshotVersion: run.snapshotVersion,
      agent: focus ? COORDINATOR : FORECASTER,
      focusScenarioId: focus?.id ?? null,
      targets,
      extra,
      root: saved
        ? { timelineCompanyId: saved.timelineCompanyId, rootRunId: saved.rootRunId }
        : null,
    };
  },
});

/** Store saved runs on the analyst scenario row and, for a fix, on its suggestion. */
export const attach = internalMutation({
  args: {
    companyId: v.id("companies"),
    runId: v.string(),
    scenarioId: v.string(),
    scenario: savedScenarioForecast,
    suggestion: v.optional(
      v.object({ suggestionId: v.string(), forecast: savedSuggestionForecast }),
    ),
  },
  handler: async (ctx, args): Promise<null> => {
    const rows = await ctx.db
      .query("analystScenarios")
      .withIndex("by_runId_and_index", (q) => q.eq("runId", args.runId))
      .take(20);
    const row = rows.find(
      (r) => r.scenarioId === args.scenarioId && r.companyId === args.companyId,
    );
    if (row) {
      const same = row.forecast?.scenarioRunId === args.scenario.scenarioRunId;
      const fixes = new Map<string, SavedFix>(
        [...(same ? (row.forecast?.fixes ?? []) : []), ...args.scenario.fixes].map((f) => [
          f.suggestionId,
          f,
        ]),
      );
      await ctx.db.patch("analystScenarios", row._id, {
        forecast: { ...args.scenario, fixes: [...fixes.values()] },
      });
    }
    if (args.suggestion) {
      const { suggestionId, forecast } = args.suggestion;
      const s: Doc<"suggestions"> | null = await ctx.db
        .query("suggestions")
        .withIndex("by_companyId_and_suggestionId", (q) =>
          q.eq("companyId", args.companyId).eq("suggestionId", suggestionId),
        )
        .unique();
      // A newer analyst run refreshed this suggestion: its own runs are saved with that run.
      if (s && s.runId === args.runId) await ctx.db.patch("suggestions", s._id, { forecast });
    }
    return null;
  },
});

/** Scheduled by fieldAnalyst.finish. Never throws: a failed deploy is logged and left. */
export const afterAnalyst = internalAction({
  args: { companyId: v.id("companies"), runId: v.string() },
  handler: async (ctx, args): Promise<null> => {
    let p: Plan | null = null;
    try {
      p = await ctx.runQuery(internal.fieldForecastRuns.plan, args);
      if (p) await deploy(ctx, p);
    } catch (e) {
      if (p) await log(ctx, p, `Forecast run failed: ${errorText(e)}`, []);
    }
    return null;
  },
});

export const latestDoneRun = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }): Promise<string | null> => {
    const runs = await ctx.db
      .query("analystRuns")
      .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(10);
    return runs.find((r) => r.status === "done")?.runId ?? null;
  },
});

/**
 * Saves the runs for the latest finished analyst run when an older deploy left suggestions
 * without them (`npx convex run fieldForecastRuns:backfill '{"companyId":"..."}'`). Idempotent.
 */
export const backfill = internalAction({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }): Promise<string | null> => {
    const runId = await ctx.runQuery(internal.fieldForecastRuns.latestDoneRun, { companyId });
    if (runId) await ctx.runAction(internal.fieldForecastRuns.afterAnalyst, { companyId, runId });
    return runId;
  },
});

type Effects = { outOfCash?: { weekStart: string }; effects: number; runIds: string[] };

async function deploy(ctx: ActionCtx, p: Plan) {
  let root = p.root;
  const effectsByRun = new Map<string, Promise<Effects>>();
  /** Domino effects of one saved risk run, computed once per deploy. */
  const effectsOf = (timelineCompanyId: string, scenarioRunId: string) => {
    let pending = effectsByRun.get(scenarioRunId);
    if (!pending) {
      pending = cascadeFor(ctx, {
        companyId: timelineCompanyId,
        runId: scenarioRunId,
        fieldCompanyId: p.companyId,
      }).then(
        (view): Effects => {
          const runIds = view.nodes.flatMap((n) => (n.runId ? [n.runId] : []));
          return {
            ...(view.outOfCash && { outOfCash: { weekStart: view.outOfCash.weekStart } }),
            effects: runIds.length,
            runIds,
          };
        },
        async (e): Promise<Effects> => {
          await log(ctx, p, `Forecast run: domino effects not saved: ${errorText(e)}`, []);
          return { effects: 0, runIds: [] };
        },
      );
      effectsByRun.set(scenarioRunId, pending);
    }
    return pending;
  };
  const logged = new Set<string>();
  const logRisk = async (title: string, s: ScenarioForecast, effects: string[]) => {
    if (logged.has(s.scenarioRunId)) return;
    logged.add(s.scenarioRunId);
    await log(
      ctx,
      p,
      `Forecast run: saved '${title}' -> lowest cash ${money(s.low.cents)} in the week of ${s.low.weekStart}${s.outOfCash ? `; runs out of cash in the week of ${s.outOfCash.weekStart}` : ""}; ${plural(s.effects, "domino effect")} saved`,
      [s.scenarioRunId, ...effects].map((id) => timelineRunRef(s.timelineCompanyId, id)),
    );
  };

  for (const t of p.targets) {
    if (t.reuse) {
      const { scenario, fix } = t.reuse;
      await ctx.runMutation(internal.fieldForecastRuns.attach, {
        companyId: p.companyId,
        runId: p.runId,
        scenarioId: t.scenarioId,
        scenario: { ...scenario, fixes: [fix] },
        suggestion: { suggestionId: t.suggestionId, forecast: suggestionForecast(scenario, fix) },
      });
      root ??= { timelineCompanyId: scenario.timelineCompanyId, rootRunId: scenario.rootRunId };
      await log(
        ctx,
        p,
        `Forecast run: reused the runs saved earlier on this snapshot for '${t.fixLabel}' (${t.scenarioTitle})`,
        [fix.fixRunId, scenario.scenarioRunId].map((id) =>
          timelineRunRef(scenario.timelineCompanyId, id),
        ),
      );
      continue;
    }
    let saved: ComparisonResult;
    try {
      saved = await saveComparison(
        ctx,
        {
          companyId: p.companyId,
          runId: p.runId,
          scenarioId: t.scenarioId,
          fixKind: t.fixKind,
          suggestionId: t.suggestionId,
          snapshotVersion: p.snapshotVersion,
        },
        { autoCascade: false },
      );
    } catch (e) {
      await log(ctx, p, `Forecast run: could not save '${t.fixLabel}': ${errorText(e)}`, []);
      continue;
    }
    const company = saved.timelineCompanyId;
    root ??= { timelineCompanyId: company, rootRunId: saved.rootRunId };
    const effects = await effectsOf(company, saved.scenarioRunId);
    const fix: SavedFix = {
      suggestionId: t.suggestionId,
      fixLabel: t.fixLabel,
      fixRunId: saved.fixRunId,
      conversationId: saved.conversationId,
      low: saved.fixLow,
    };
    const scenario: ScenarioForecast = {
      timelineCompanyId: company,
      rootRunId: saved.rootRunId,
      scenarioRunId: saved.scenarioRunId,
      low: saved.scenarioLow,
      ...(effects.outOfCash && { outOfCash: effects.outOfCash }),
      effects: effects.effects,
      fixes: [fix],
      savedAt: new Date().toISOString(),
    };
    await ctx.runMutation(internal.fieldForecastRuns.attach, {
      companyId: p.companyId,
      runId: p.runId,
      scenarioId: t.scenarioId,
      scenario,
      suggestion: { suggestionId: t.suggestionId, forecast: suggestionForecast(scenario, fix) },
    });
    await logRisk(
      `${t.scenarioTitle}${p.focusScenarioId === t.scenarioId ? " (coordinator's focus)" : ""}`,
      scenario,
      effects.runIds,
    );
    await log(
      ctx,
      p,
      `Forecast run: saved '${t.fixLabel}' as the fix for ${t.scenarioTitle} -> lowest cash ${money(saved.fixLow.cents)} (${money(saved.scenarioLow.cents)} without it); open it in the Timeline at ${saved.route}`,
      [saved.fixRunId, saved.scenarioRunId].map((id) => timelineRunRef(company, id)),
    );
  }

  const extra = p.extra;
  if (!extra) return;
  if (extra.reuse) {
    await ctx.runMutation(internal.fieldForecastRuns.attach, {
      companyId: p.companyId,
      runId: p.runId,
      scenarioId: extra.scenarioId,
      scenario: { ...extra.reuse, fixes: [] },
    });
    return;
  }
  if (!root) {
    if (p.targets.length === 0)
      await log(ctx, p, "Forecast run: no risk with a saved fix to deploy on this snapshot", []);
    return;
  }
  const company = root.timelineCompanyId;
  try {
    // Same request id as earlier deploys of this run, so a rerun lands on the same branch.
    const key = (
      await sha256(canonicalJson({ root: root.rootRunId, risk: extra.scenarioId, p: p.runId }))
    ).slice(0, 40);
    const r: { runId: string } = await ctx.runMutation(api.timeline.workspace.simulate, {
      companyId: company,
      parentRunId: root.rootRunId,
      requestId: `forecast.${key}`,
      label: `If: ${extra.title}`.slice(0, 200),
      changesJson: extra.changesJson,
      reviewed: true,
    });
    const run: WorkspaceRun | null = await ctx.runQuery(api.timeline.workspace.get, {
      companyId: company,
      runId: r.runId,
    });
    if (!run) throw new Error("the saved run could not be read back");
    const effects = await effectsOf(company, r.runId);
    const scenario: ScenarioForecast = {
      timelineCompanyId: company,
      rootRunId: root.rootRunId,
      scenarioRunId: r.runId,
      low: { cents: run.forecast.lowPoint.usable, weekStart: run.forecast.lowPoint.weekStart },
      ...(effects.outOfCash && { outOfCash: effects.outOfCash }),
      effects: effects.effects,
      fixes: [],
      savedAt: new Date().toISOString(),
    };
    await ctx.runMutation(internal.fieldForecastRuns.attach, {
      companyId: p.companyId,
      runId: p.runId,
      scenarioId: extra.scenarioId,
      scenario,
    });
    await logRisk(
      `${extra.title}${p.focusScenarioId === extra.scenarioId ? " (coordinator's focus)" : ""}`,
      scenario,
      effects.runIds,
    );
  } catch (e) {
    await log(ctx, p, `Forecast run: could not save '${extra.title}': ${errorText(e)}`, []);
  }
}

function suggestionForecast(s: ScenarioForecast, fix: SavedFix): SuggestionForecast {
  return {
    timelineCompanyId: s.timelineCompanyId,
    scenarioRunId: s.scenarioRunId,
    fixRunId: fix.fixRunId,
    conversationId: fix.conversationId,
    route: workerTimelineHref(s.timelineCompanyId, fix.fixRunId, fix.conversationId),
    scenarioLow: s.low,
    fixLow: fix.low,
    ...(s.outOfCash && { outOfCash: s.outOfCash }),
    effects: s.effects,
    savedAt: s.savedAt,
  };
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

function log(ctx: ActionCtx, p: Plan, summary: string, refs: string[]) {
  return ctx.runMutation(internal.fieldJobs.logStep, {
    companyId: p.companyId,
    runId: p.logRunId,
    actor: "engine",
    action: "forecast.run",
    refs: refs.slice(0, 32),
    agent: p.agent,
    tool: "engine.forecast",
    summary,
  });
}
