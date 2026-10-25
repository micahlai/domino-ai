/** Open frozen Worker comparison runs and an inspectable Ask Domino thread. No provider calls. */
import { canonicalJson } from "@domino/contracts";
import { v } from "convex/values";
import { z } from "zod";
import { workerTimelineHref } from "../lib/timeline-entry";
import { api, internal } from "./_generated/api";
import { action } from "./_generated/server";
import { sha256 } from "./fieldJobs";

type Result = {
  timelineCompanyId: string;
  baselineRunId: string;
  rootRunId: string;
  scenarioRunId: string;
  fixRunId: string;
  conversationId: string;
  route: string;
  reused: boolean;
  scenarioLow: { cents: number; weekStart: string };
  fixLow: { cents: number; weekStart: string };
};

type Saved = { companyId: string; runId: string; created: boolean };
const hash = async (value: unknown) => (await sha256(canonicalJson(value))).slice(0, 48);
const routeFor = workerTimelineHref;

/** Explicit viewing saves the pinned baseline, risk, fix and context without accepting it. */
export const simulate = action({
  args: {
    companyId: v.id("companies"),
    runId: v.string(),
    scenarioId: v.string(),
    fixKind: v.string(),
    suggestionId: v.string(),
    snapshotVersion: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Result> => {
    const optionalNote = z
      .string()
      .max(500)
      .parse(args.note ?? "");
    const { note: _note, ...identity } = args;
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
    } = await ctx.runQuery(internal.fieldTimeline.suggestionInputs, identity);
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
    const description = `${sourcePeriod ? `${sourcePeriod.trim()} ` : ""}${savedInputs.illustrative ? "Illustrative " : ""}Field books and rules pinned for this analyst run, snapshot version ${savedInputs.snapshotVersion}, as of ${savedInputs.asOf}. Saved for comparison by choosing Show on Timeline; this does not accept the suggestion. The cash floor and any credit line are simulation assumptions, not a reported facility. Nothing is paid or moved.`;
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
      autoCascade: true,
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
      // The saved fix is an automated response; it may act before the risk it answers starts.
      allowEarlierStart: true,
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
    const chat = await ctx.runMutation(internal.timeline.chat.beginWorker, {
      fieldCompanyId: args.companyId,
      fieldRunId: args.runId,
      scenarioId: args.scenarioId,
      fixKind: args.fixKind,
      suggestionId: args.suggestionId,
      snapshotVersion: args.snapshotVersion,
      companyId: baseline.companyId,
      runId: fix.runId,
      scenarioRunId: scenario.runId,
      requestId: `field.option.chat.${await hash({ fixKey, note: optionalNote })}`,
      note: optionalNote,
    });
    return {
      timelineCompanyId: baseline.companyId,
      baselineRunId: baseline.runId,
      rootRunId: root.runId,
      scenarioRunId: scenario.runId,
      fixRunId: fix.runId,
      conversationId: chat.conversationId,
      route: routeFor(baseline.companyId, fix.runId, chat.conversationId),
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
