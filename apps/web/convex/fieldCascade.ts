/**
 * Domino effects: look ahead from one saved Timeline scenario run, compute its second-order
 * consequences with the pure engine cascade, and save each follow-on as a child Timeline run
 * of its parent (so the chart draws it as a branch from the trigger week). Idempotent: request
 * ids hash the parent run, its input hash and the cascade version. No provider calls.
 */
import { canonicalJson } from "@domino/contracts";
import { CASCADE_VERSION, type CascadeNode, cascade, money } from "@domino/engine";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation } from "./_generated/server";
import { sha256 } from "./fieldJobs";
import { type AgentRow, agentLog, agentRowArg } from "./lib/agentLog";
import type { WorkspaceRun } from "./timeline/workspace";

export type CascadeView = {
  scenarioRunId: string;
  event: string;
  eventLow: { cents: number; weekStart: string };
  nodes: (Omit<CascadeNode, "forecast" | "allChanges"> & {
    runId: string | null;
    route: string | null;
    error: string | null;
  })[];
};

const routeFor = (companyId: string, runId: string) =>
  `/c/${encodeURIComponent(companyId)}/timeline?${new URLSearchParams({ runId })}`;

export const run = action({
  args: {
    /** Timeline company id (the saved run's company) */
    companyId: v.string(),
    runId: v.string(),
    /** Field company for agent log rows; defaults to companyId when it is a Field id */
    fieldCompanyId: v.optional(v.id("companies")),
  },
  handler: async (ctx, args): Promise<CascadeView> => {
    const parent: WorkspaceRun | null = await ctx.runQuery(api.timeline.workspace.get, {
      companyId: args.companyId,
      runId: args.runId,
    });
    if (!parent || parent.kind !== "scenario" || parent.ownChanges.length === 0)
      throw new Error("Domino effects need a saved scenario run that changes events");
    const own = parent.ownChanges;
    const result = cascade({
      snapshot: parent.baseline.seed.snapshot,
      model: parent.baseline.model,
      constraints: parent.constraints,
      baseChanges: parent.changes.slice(0, parent.changes.length - own.length),
      eventChanges: own,
      eventLabel: parent.label.replace(/^If:\s*/, ""),
    });
    const key = (
      await sha256(canonicalJson({ runId: parent.runId, input: parent.inputHash, CASCADE_VERSION }))
    ).slice(0, 40);
    const runIds = new Map<string, string>();
    const nodes: CascadeView["nodes"] = [];
    for (const node of result.nodes) {
      const { forecast: _f, allChanges: _a, ...view } = node;
      const parentRunId = node.parentId === null ? parent.runId : runIds.get(node.parentId);
      if (!parentRunId) {
        nodes.push({ ...view, runId: null, route: null, error: "Its parent could not be saved" });
        continue;
      }
      try {
        const saved: { runId: string } = await ctx.runMutation(api.timeline.workspace.simulate, {
          companyId: args.companyId,
          parentRunId,
          requestId: `cascade.${key}.${node.id}`,
          label: `Then: ${node.event}`.slice(0, 200),
          changesJson: JSON.stringify(node.changes),
          reviewed: true,
        });
        const check: WorkspaceRun | null = await ctx.runQuery(api.timeline.workspace.get, {
          companyId: args.companyId,
          runId: saved.runId,
        });
        if (
          !check ||
          check.parentRunId !== parentRunId ||
          check.forecast.lowPoint.usable !== node.lowPoint.usable
        )
          throw new Error("Saved run does not match the engine cascade");
        runIds.set(node.id, saved.runId);
        nodes.push({
          ...view,
          runId: saved.runId,
          route: routeFor(args.companyId, saved.runId),
          error: null,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        nodes.push({ ...view, runId: null, route: null, error: msg.slice(0, 300) });
      }
    }
    const rows: AgentRow[] = nodes.map((n, i) => {
      const parentText =
        n.parentId === null
          ? result.event
          : (result.nodes.find((p) => p.id === n.parentId)?.event ?? result.event);
      return {
        action: "cascade.node",
        agentId: `cascade#${n.id}`,
        agentKind: "domino",
        parentAgentId: n.parentId === null ? "cascade" : `cascade#${n.parentId}`,
        event: "message",
        status: n.error ? "failed" : "done",
        tool: "engine.cascade",
        toolCategory: "engine",
        toolLabel: "Domino effects",
        refs: [parent.runId, ...(n.runId ? [n.runId] : [])],
        step: i + 1,
        steps: nodes.length,
        summary: `Looked ahead from '${parentText}': ${n.trigger.label} -> ${n.event} (${n.likelihood.toLowerCase()}); lowest cash ${money(n.lowPoint.usable)} in the week of ${n.lowPoint.weekStart}`,
      };
    });
    await ctx.runMutation(internal.fieldCascade.logChain, {
      companyId: args.companyId,
      fieldCompanyId: args.fieldCompanyId,
      baselineRunId: parent.baselineRunId,
      runId: `cascade.${key}`,
      summary: `Looked ahead from '${result.event}': ${nodes.length === 0 ? "no follow-on effects found" : `${nodes.length} possible follow-on effect${nodes.length === 1 ? "" : "s"}`}`,
      rows,
    });
    return {
      scenarioRunId: parent.runId,
      event: result.event,
      eventLow: {
        cents: result.forecast.lowPoint.usable,
        weekStart: result.forecast.lowPoint.weekStart,
      },
      nodes,
    };
  },
});

/** Agent rows for the brain map and agent snapshots; written once per cascade run id. */
export const logChain = internalMutation({
  args: {
    companyId: v.string(),
    fieldCompanyId: v.optional(v.id("companies")),
    baselineRunId: v.string(),
    runId: v.string(),
    summary: v.string(),
    rows: v.array(agentRowArg),
  },
  handler: async (ctx, args) => {
    // The Field company that opened this baseline in Timeline (small table, bounded scan).
    const link = (await ctx.db.query("timelineLinks").take(500)).find(
      (l) => l.timelineCompanyId === args.companyId && l.baselineRunId === args.baselineRunId,
    );
    const fieldId: Id<"companies"> | null =
      args.fieldCompanyId ?? link?.companyId ?? ctx.db.normalizeId("companies", args.companyId);
    if (!fieldId || !(await ctx.db.get("companies", fieldId))) return { logged: false };
    const prior = await ctx.db
      .query("log")
      .withIndex("by_company_and_runId", (q) => q.eq("companyId", fieldId).eq("runId", args.runId))
      .first();
    if (prior) return { logged: false };
    await agentLog(ctx, fieldId, args.runId, {
      action: "cascade.start",
      agentId: "cascade",
      agentKind: "domino",
      event: "status",
      status: "done",
      tool: "engine.cascade",
      toolCategory: "engine",
      toolLabel: "Domino effects",
      summary: args.summary,
    });
    for (const row of args.rows) await agentLog(ctx, fieldId, args.runId, row as AgentRow);
    return { logged: true };
  },
});
