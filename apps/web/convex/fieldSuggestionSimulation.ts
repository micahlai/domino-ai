/** Turn one frozen Field suggestion into saved, editable Timeline runs. No provider calls. */
import { canonicalJson } from "@domino/contracts";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { action } from "./_generated/server";
import { sha256 } from "./fieldJobs";

type Result = {
  timelineCompanyId: string;
  baselineRunId: string;
  rootRunId: string;
  scenarioRunId: string;
  fixRunId: string;
  route: string;
  reused: boolean;
  scenarioLow: { cents: number; weekStart: string };
  fixLow: { cents: number; weekStart: string };
};

type Saved = { companyId: string; runId: string; created: boolean };
const hash = async (value: unknown) => (await sha256(canonicalJson(value))).slice(0, 48);
const routeFor = (companyId: string, runId: string) =>
  `/c/${encodeURIComponent(companyId)}/timeline?${new URLSearchParams({ runId })}`;

/** Explicit click saves the pinned baseline, risk scenario, then fix child in that order. */
export const simulate = action({
  args: {
    companyId: v.id("companies"),
    runId: v.string(),
    scenarioId: v.string(),
    fixKind: v.string(),
    suggestionId: v.string(),
    snapshotVersion: v.number(),
  },
  handler: async (ctx, args): Promise<Result> => {
    const savedInputs: {
      seedJson: string;
      contentHash: string;
      timelineCompanyId: string;
      modelJson: string;
      constraintsJson: string;
      asOf: string;
      snapshotVersion: number;
      scenarioId: string;
      scenarioTitle: string;
      scenarioChangesJson: string;
      fixKind: string;
      fixLabel: string;
      fixChangesJson: string;
      suggestionId: string;
      illustrative: boolean;
      provenanceLabel: string | null;
      periodStart: string | null;
      periodEnd: string | null;
      reportedAt: string | null;
    } = await ctx.runQuery(internal.fieldTimeline.suggestionInputs, args);
    const sourcePeriod =
      savedInputs.provenanceLabel && savedInputs.periodStart && savedInputs.periodEnd
        ? ` ${savedInputs.provenanceLabel}: reconstructed ledger period ${savedInputs.periodStart} to ${savedInputs.periodEnd}${savedInputs.reportedAt ? `, public report ${savedInputs.reportedAt}` : ""}.`
        : "";
    const origin = `Field trace: /field/analysis?${new URLSearchParams({
      companyId: args.companyId,
      runId: args.runId,
      scenarioId: args.scenarioId,
      fixKind: args.fixKind,
    })}`;
    const description = `${sourcePeriod ? `${sourcePeriod.trim()} ` : ""}${savedInputs.illustrative ? "Illustrative " : ""}Field books and rules pinned for this analyst run, snapshot version ${savedInputs.snapshotVersion}, as of ${savedInputs.asOf}. Review by choosing Simulate this option. The cash floor and any credit line are simulation assumptions, not a reported facility. Nothing is paid or moved.`;
    if (origin.length >= 2000) throw new Error("The saved suggestion identity is too long");
    const note = `${description.slice(0, 1999 - origin.length)}\n${origin}`;
    const baselineKey = await hash({
      runId: args.runId,
      snapshotVersion: args.snapshotVersion,
      contentHash: savedInputs.contentHash,
      modelJson: savedInputs.modelJson,
      constraintsJson: savedInputs.constraintsJson,
      note,
    });
    const baseline: Saved = await ctx.runMutation(api.timeline.baselines.save, {
      requestId: `field.option.base.${baselineKey}`,
      seedJson: savedInputs.seedJson,
      modelJson: savedInputs.modelJson,
      constraintsJson: savedInputs.constraintsJson,
      assumptionNote: note,
      reviewed: true,
    });
    if (baseline.companyId !== savedInputs.timelineCompanyId)
      throw new Error("Timeline saved this option under another company");
    const root: Saved = await ctx.runMutation(api.timeline.workspace.open, {
      companyId: baseline.companyId,
      baselineRunId: baseline.runId,
      requestId: `field.option.open.${baselineKey}`,
    });
    const scenarioKey = await hash({
      runId: args.runId,
      scenarioId: savedInputs.scenarioId,
      parentRunId: root.runId,
      changesJson: savedInputs.scenarioChangesJson,
    });
    const scenario: Saved = await ctx.runMutation(api.timeline.workspace.simulate, {
      companyId: baseline.companyId,
      parentRunId: root.runId,
      requestId: `field.option.risk.${scenarioKey}`,
      label: `If: ${savedInputs.scenarioTitle}`.slice(0, 200),
      changesJson: savedInputs.scenarioChangesJson,
      reviewed: true,
    });
    const fixKey = await hash({
      runId: args.runId,
      scenarioRunId: scenario.runId,
      suggestionId: savedInputs.suggestionId,
      fixKind: savedInputs.fixKind,
      changesJson: savedInputs.fixChangesJson,
    });
    const fix: Saved = await ctx.runMutation(api.timeline.workspace.simulate, {
      companyId: baseline.companyId,
      parentRunId: scenario.runId,
      requestId: `field.option.fix.${fixKey}`,
      label: `With fix: ${savedInputs.fixLabel}`.slice(0, 200),
      changesJson: savedInputs.fixChangesJson,
      reviewed: true,
    });
    const [riskSaved, fixSaved] = await Promise.all([
      ctx.runQuery(api.timeline.workspace.get, {
        companyId: baseline.companyId,
        runId: scenario.runId,
      }),
      ctx.runQuery(api.timeline.workspace.get, { companyId: baseline.companyId, runId: fix.runId }),
    ]);
    if (
      !riskSaved ||
      !fixSaved ||
      riskSaved.companyId !== baseline.companyId ||
      fixSaved.companyId !== baseline.companyId ||
      riskSaved.runId !== scenario.runId ||
      fixSaved.runId !== fix.runId ||
      fixSaved.parentRunId !== scenario.runId
    )
      throw new Error("Saved Timeline comparison could not be verified");
    return {
      timelineCompanyId: baseline.companyId,
      baselineRunId: baseline.runId,
      rootRunId: root.runId,
      scenarioRunId: scenario.runId,
      fixRunId: fix.runId,
      route: routeFor(baseline.companyId, fix.runId),
      reused: !baseline.created && !root.created && !scenario.created && !fix.created,
      scenarioLow: {
        cents: riskSaved.forecast.lowPoint.usable,
        weekStart: riskSaved.forecast.lowPoint.weekStart,
      },
      fixLow: {
        cents: fixSaved.forecast.lowPoint.usable,
        weekStart: fixSaved.forecast.lowPoint.weekStart,
      },
    };
  },
});
