/**
 * Forecast runs the agent brain deploys on its own. After each analyst run finishes (forecasting
 * swarm, advisors, CREAO coordinator), the top risks by engine impact (the coordinator's focus
 * scenario first when it chose one) and the best fix for the top risk are saved as Timeline
 * scenarios, and each scenario's domino effects are computed and saved as child runs.
 *
 * Bounded and idempotent: at most MAX_AUTO_RUNS saved runs per snapshot, and a snapshot whose
 * forecast runs were already deployed (books unchanged) deploys nothing new. Every number comes
 * from the engine; nothing is paid or moved.
 */
import { canonicalJson } from "@domino/contracts";
import { money } from "@domino/engine";
import { v } from "convex/values";
import { FieldTraceSchema } from "../lib/field-trace-contract";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, internalAction, internalQuery } from "./_generated/server";
import { cascadeFor } from "./fieldCascade";
import { sha256 } from "./fieldJobs";
import type { WorkspaceRun } from "./timeline/workspace";

/** Risk + its fix + one more risk. */
const MAX_AUTO_RUNS = 3;
const MAX_RISKS = 2;
const COORDINATOR = "coordinator#1";
const FORECASTER = "forecaster#1";

type Risk = { scenarioId: string; title: string; changesJson: string; cashImpact: number };
type Plan = {
  companyId: Id<"companies">;
  runId: string;
  logRunId: string;
  snapshotVersion: number;
  agent: string;
  /** How the risks were chosen, for the log */
  source: "coordinator" | "engine";
  risks: Risk[];
  fix: { suggestionId: string; fixKind: string; label: string } | null;
};

const logRunIdFor = (snapshotId: string) => `forecast-run.${snapshotId}`;

/** What to deploy for one finished analyst run, or null when there is nothing (new) to do. */
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
    const logRunId = logRunIdFor(run.snapshotId);
    const deployed = await ctx.db
      .query("log")
      .withIndex("by_company_and_runId", (q) =>
        q.eq("companyId", args.companyId).eq("runId", logRunId),
      )
      .first();
    if (deployed) return null;
    const trace = FieldTraceSchema.parse(JSON.parse(run.traceReceipt));
    const harmful = trace.scenarios.filter(
      (s) => s.status === "done" && s.work && s.work.cashImpact > 0 && s.changes.length > 0,
    );
    const focusIndex = run.coordinator?.focus?.scenarioIndex;
    const focus = harmful.find((s) => s.index === focusIndex);
    const ranked = [...harmful].sort(
      (a, b) => (b.work?.cashImpact ?? 0) - (a.work?.cashImpact ?? 0) || a.index - b.index,
    );
    const ordered = focus ? [focus, ...ranked.filter((s) => s !== focus)] : ranked;
    // The top risk is the first one with a saved fix candidate: the Timeline save needs one.
    const withFix = ordered.find((s) => trace.candidates.some((c) => c.scenarioId === s.id));
    const top = withFix ?? ordered[0];
    if (!top) return null;
    const risks = [top, ...ordered.filter((s) => s !== top)].slice(0, MAX_RISKS);
    const candidates = trace.candidates
      .filter((c) => c.scenarioId === top.id)
      .sort((a, b) => Number(b.recommended) - Number(a.recommended) || a.rank - b.rank);
    const best = candidates[0];
    return {
      companyId: args.companyId,
      runId: args.runId,
      logRunId,
      snapshotVersion: run.snapshotVersion,
      agent: focus ? COORDINATOR : FORECASTER,
      source: focus ? "coordinator" : "engine",
      risks: risks.map((s) => ({
        scenarioId: s.id,
        title: s.title,
        changesJson: JSON.stringify(s.changes),
        cashImpact: s.work?.cashImpact ?? 0,
      })),
      fix: best
        ? { suggestionId: best.suggestionId, fixKind: best.fix.kind, label: best.fix.label }
        : null,
    };
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
      if (p)
        await log(ctx, p, `Forecast run failed: ${e instanceof Error ? e.message : String(e)}`, []);
    }
    return null;
  },
});

async function deploy(ctx: ActionCtx, p: Plan) {
  const [top, ...rest] = p.risks;
  if (!top || !p.fix) {
    await log(ctx, p, "Forecast run: no risk with a saved fix to deploy on this snapshot", []);
    return;
  }
  const saved: {
    timelineCompanyId: string;
    rootRunId: string;
    scenarioRunId: string;
    fixRunId: string;
    route: string;
  } = await ctx.runAction(api.fieldSuggestionSimulation.simulate, {
    companyId: p.companyId,
    runId: p.runId,
    scenarioId: top.scenarioId,
    fixKind: p.fix.fixKind,
    suggestionId: p.fix.suggestionId,
    snapshotVersion: p.snapshotVersion,
  });
  const companyId = saved.timelineCompanyId;
  const scenarios: { risk: Risk; runId: string }[] = [{ risk: top, runId: saved.scenarioRunId }];
  let budget = MAX_AUTO_RUNS - 2;
  for (const risk of rest) {
    if (budget-- <= 0) break;
    const key = (
      await sha256(canonicalJson({ root: saved.rootRunId, risk: risk.scenarioId, p: p.runId }))
    ).slice(0, 40);
    try {
      const r: { runId: string } = await ctx.runMutation(api.timeline.workspace.simulate, {
        companyId,
        parentRunId: saved.rootRunId,
        requestId: `forecast.${key}`,
        label: `If: ${risk.title}`.slice(0, 200),
        changesJson: risk.changesJson,
        reviewed: true,
      });
      scenarios.push({ risk, runId: r.runId });
    } catch (e) {
      await log(
        ctx,
        p,
        `Forecast run: could not save '${risk.title}': ${e instanceof Error ? e.message : e}`,
        [],
      );
    }
  }
  for (const { risk, runId } of scenarios) {
    const view = await cascadeFor(ctx, { companyId, runId, fieldCompanyId: p.companyId });
    const run: WorkspaceRun | null = await ctx.runQuery(api.timeline.workspace.get, {
      companyId,
      runId,
    });
    if (!run) continue;
    const low = run.forecast.lowPoint;
    const out = view.outOfCash
      ? `; runs out of cash in the week of ${view.outOfCash.weekStart}`
      : "";
    const effects = `${view.nodes.length} follow-on effect${view.nodes.length === 1 ? "" : "s"}`;
    await log(
      ctx,
      p,
      `Forecast run: ${risk.title} -> lowest cash ${money(low.usable)} in the week of ${low.weekStart}${out}; ${effects}${p.source === "coordinator" && risk === top ? " (coordinator's focus)" : ""}`,
      [runId, ...view.nodes.flatMap((n) => (n.runId ? [n.runId] : []))],
    );
  }
  await log(
    ctx,
    p,
    `Forecast run: saved '${p.fix.label}' as the fix for ${top.title}; open it in the Timeline at ${saved.route}`,
    [saved.fixRunId],
  );
}

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
