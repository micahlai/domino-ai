/**
 * CREAO coordinator ("coordinator#1", agentKind "creao", parent "analyst#1"). After the analyst
 * aggregates, one budgeted CREAO run (kind "coordinator", one per snapshot version) reads the
 * snapshot summary, the open audit flags, the engine's scenario results and the counterparty
 * list (engine-computed, engine-formatted numbers only) and returns a prioritized plan. The plan
 * is validated by acceptCoordinatorPlan (allowlisted actions only, known ids only, no new money
 * amounts; anything else rejects the whole plan) and executed here by deterministic code:
 *   escalate_flag          mark the open finding escalated for review (a person decides)
 *   focus_scenario         the summary leads with that scenario
 *   research_counterparty  research#1 runs the demo news check on that counterparty
 * Each action is logged as a coordinator -> sub-agent message. There is no Claude fallback and
 * no canned plan: without CREAO the agents keep their default order and the log says why. A plan
 * that fails validation is logged with its reasons and gets one repair run (fieldAi.runCreaoStep).
 * It runs on every new snapshot version (one call per version); later runs on the same version
 * skip it, and only the first of those logs the skip.
 */
import { SnapshotSchema } from "@domino/contracts";
import { v } from "convex/values";
import {
  type CoordinatorInput,
  type CoordinatorPlan,
  MAX_COORDINATOR_FLAGS,
  coordinatorCreaoJob,
} from "../../../packages/agents/src/fieldCreao";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, internalMutation, internalQuery } from "./_generated/server";
import {
  AUDIT_AGENT,
  BUSY_TOO_LONG,
  type Reservation,
  creaoGate,
  creaoHooks,
  failureOf,
  runCreaoStep,
} from "./fieldAi";
import { ANALYST, RESEARCH, SUMMARIZER, buildDigest } from "./fieldAnalyst";
import type { AgentRow } from "./lib/agentLog";
import type { Inputs } from "./lib/analystScenarios";
import { APIFY_LABEL, checkCustomerNews } from "./lib/apifyDemo";
import type { CoordinatorRecord } from "./lib/coordinatorRecord";
import { counterpartyJob } from "./lib/counterparties";
import { parse } from "./lib/parse";

export const COORDINATOR = "coordinator#1";

const SEVERITY = { high: 0, medium: 1, low: 2 } as const;
/** A plan reason may be empty (tolerated); then the message has none. */
const because = (reason: string) => (reason ? `: ${reason}` : "");

/** What the coordinator sees for one running analyst run, or null when the run is over. */
export const input = internalQuery({
  args: { runId: v.string() },
  handler: async (
    ctx,
    { runId },
  ): Promise<{ companyId: Id<"companies">; input: CoordinatorInput } | null> => {
    const run = await ctx.db
      .query("analystRuns")
      .withIndex("by_runId", (q) => q.eq("runId", runId))
      .unique();
    if (!run || run.status !== "running") return null;
    const digest = await buildDigest(ctx, run);
    const open = await ctx.db
      .query("findings")
      .withIndex("by_companyId_and_status", (q) =>
        q.eq("companyId", run.companyId).eq("status", "open"),
      )
      .order("desc")
      .take(200);
    const flags = [...open]
      .sort(
        (a, b) =>
          SEVERITY[a.severity] - SEVERITY[b.severity] ||
          (a.findingId < b.findingId ? -1 : a.findingId > b.findingId ? 1 : 0),
      )
      .slice(0, MAX_COORDINATOR_FLAGS)
      .map((f) => ({
        findingId: f.findingId,
        kind: f.kind,
        severity: f.severity,
        summary: f.summary,
        escalated: f.escalated,
      }));
    const snapshot = await ctx.db.get("snapshots", run.snapshotId);
    const company = (await ctx.db.get("companies", run.companyId))?.name ?? "";
    const counterparties = snapshot
      ? counterpartyJob(parse(SnapshotSchema, snapshot.data), company).counterparties.map(
          ({ name, role, rank }) => ({ name, role, rank }),
        )
      : [];
    return {
      companyId: run.companyId,
      input: {
        company,
        asOf: digest.asOf,
        snapshotVersion: digest.snapshotVersion,
        snapshot: {
          baseline: digest.baseline,
          openFlags: open.length,
          openEscalations: open.filter((f) => f.escalated).length,
          failingScenarios: digest.scenarios.filter((s) => !s.survives).length,
          scenarios: digest.scenarios.length,
        },
        flags,
        scenarios: digest.scenarios,
        counterparties,
      },
    };
  },
});

/** Deterministic execution of escalate_flag: open findings only; returns newly escalated ids. */
export const escalate = internalMutation({
  args: { companyId: v.id("companies"), findingIds: v.array(v.string()) },
  handler: async (ctx, { companyId, findingIds }) => {
    const newly: string[] = [];
    for (const findingId of findingIds) {
      const row = await ctx.db
        .query("findings")
        .withIndex("by_companyId_and_findingId", (q) =>
          q.eq("companyId", companyId).eq("findingId", findingId),
        )
        .first();
      if (!row || row.status !== "open" || row.escalated) continue;
      await ctx.db.patch("findings", row._id, { escalated: true });
      newly.push(findingId);
    }
    return newly;
  },
});

/** One coordinator step for an analyst run. Never throws for provider errors. */
/**
 * Returns "busy" (nothing logged, nothing reserved) when another CREAO run for the company is in
 * flight, so the caller can reschedule; `blocked` means it waited too long and should skip.
 */
export async function coordinate(
  ctx: ActionCtx,
  runId: string,
  blocked = false,
): Promise<CoordinatorRecord | "busy"> {
  const at = () => new Date().toISOString();
  const write = (rows: AgentRow[], research?: unknown) =>
    ctx.runMutation(internal.fieldAnalyst.record, {
      runId,
      rows,
      ...(research !== undefined && { research }),
    });
  const analystNote = async (status: CoordinatorRecord["status"], reason: string) => {
    // Skips repeat on every analyst loop tick on one version; log them once per version.
    const quiet =
      status !== "failed" && (await ctx.runQuery(internal.fieldAi.repeatRun, { runId }));
    if (quiet) return { status, reason, at: at() };
    await write([
      {
        action: "analyst.coordinatorSkipped",
        agentId: ANALYST,
        agentKind: "domino",
        event: "status",
        status: "working",
        currentTask: "Coordinator plan (CREAO)",
        summary: `CREAO coordinator ${status} (${reason}); agents keep their default order`,
      },
    ]);
    return { status, reason, at: at() };
  };
  const q: { companyId: Id<"companies">; input: CoordinatorInput } | null = await ctx.runQuery(
    internal.fieldCoordinator.input,
    { runId },
  );
  if (!q) return { status: "skipped", reason: "run is no longer active", at: at() };
  const { companyId, input: data } = q;
  if (data.flags.length + data.scenarios.length + data.counterparties.length === 0)
    return analystNote("skipped", "nothing to plan");
  const gate = await creaoGate("coordinator");
  if (!gate.ok) return analystNote("unavailable", gate.reason);
  if (blocked) return analystNote("skipped", BUSY_TOO_LONG);
  const scope = `v${data.snapshotVersion}`;
  const reservation: Reservation = await ctx.runMutation(internal.fieldAi.reserve, {
    companyId,
    kind: "coordinator",
    provider: "creao",
    scope,
  });
  if (!reservation.ok && reservation.busy) return "busy";
  if (!reservation.ok) return analystNote("skipped", reservation.reason);

  const task = `Plan the next steps on ${scope}: ${data.flags.length} flags, ${data.scenarios.length} scenarios, ${data.counterparties.length} counterparties`;
  const as = (r: Omit<AgentRow, "agentId" | "agentKind" | "parentAgentId">): AgentRow => ({
    agentId: COORDINATOR,
    agentKind: "creao",
    parentAgentId: ANALYST,
    ...r,
  });
  const say = (toAgentId: string, summary: string, refs: string[]): AgentRow =>
    as({
      action: "agent.message",
      event: "message",
      fromAgentId: COORDINATOR,
      toAgentId,
      refs,
      summary,
    });
  await write([
    as({
      action: "agent.spawned",
      event: "status",
      status: "spawned",
      currentTask: task,
      summary: `Analyst started the CREAO coordinator on ${scope}`,
    }),
    {
      action: "agent.message",
      agentId: ANALYST,
      agentKind: "domino",
      event: "message",
      fromAgentId: ANALYST,
      toAgentId: COORDINATOR,
      summary: `${task}: which flags to escalate, which scenario to look at, who to research`,
    },
  ]);

  let plan: CoordinatorPlan;
  let remoteRunId: string;
  let repaired: string | undefined;
  const working = (summary: string, refs?: string[]) =>
    write([
      as({
        action: "agent.working",
        event: "status",
        status: "working",
        currentTask: task,
        ...(refs && { refs }),
        summary,
      }),
    ]);
  try {
    const run = await runCreaoStep(
      ctx,
      {
        companyId,
        kind: "coordinator",
        scope,
        callId: reservation.callId,
        job: coordinatorCreaoJob(data),
      },
      creaoHooks(working, "plan"),
    );
    plan = run.value;
    remoteRunId = run.runId;
    repaired = run.repaired;
  } catch (error) {
    const failure = failureOf(error);
    await write([
      as({
        action: "agent.failed",
        event: "status",
        status: "failed",
        currentTask: task,
        summary: `CREAO run failed (${failure}); no plan, agents keep their default order`,
      }),
    ]);
    return { status: "failed", reason: `CREAO run failed (${failure})`, at: at() };
  }
  await write([
    as({
      action: "agent.tool",
      event: "tool",
      tool: "creao.coordinatorPlan",
      toolCategory: "creao",
      toolLabel: "CREAO: coordinator plan",
      source: "creao",
      currentTask: task,
      refs: [remoteRunId, ...plan.escalate.map((e) => e.findingId)],
      summary: `CREAO run ${remoteRunId}${repaired ? " (repaired)" : ""}: ${plan.summary}`,
    }),
  ]);

  // Execute the validated plan. Only these three actions exist; amounts never come from it.
  const executed: string[] = [];
  if (plan.escalate.length > 0) {
    const ids = plan.escalate.map((e) => e.findingId);
    const newly: string[] = await ctx.runMutation(internal.fieldCoordinator.escalate, {
      companyId,
      findingIds: ids,
    });
    await write([
      ...plan.escalate.map((e, i) =>
        say(AUDIT_AGENT, `Escalate ${e.findingId} first (priority ${i + 1})${because(e.reason)}`, [
          e.findingId,
        ]),
      ),
      ...newly.map(
        (id): AgentRow => ({
          action: "audit.escalated",
          agentId: AUDIT_AGENT,
          agentKind: "domino",
          event: "status",
          status: "done",
          refs: [id],
          summary: `Escalated ${id} for review at the coordinator's request`,
        }),
      ),
    ]);
    executed.push(`escalate ${ids.join(", ")}`);
  }
  if (plan.focus) {
    const { scenarioIndex, reason } = plan.focus;
    const title = data.scenarios.find((s) => s.index === scenarioIndex)?.title ?? "";
    await write([
      say(
        `forecaster#${scenarioIndex + 1}`,
        `Scenario ${scenarioIndex + 1} is the focus${because(reason)}`,
        [`scenario ${scenarioIndex + 1}`],
      ),
      say(SUMMARIZER, `Lead the summary with scenario ${scenarioIndex + 1} (${title})`, [
        `scenario ${scenarioIndex + 1}`,
      ]),
    ]);
    executed.push(`focus scenario ${scenarioIndex + 1}`);
  }
  if (plan.research) {
    const { counterparty, reason } = plan.research;
    const inputs: Inputs = await ctx.runQuery(internal.fieldAnalyst.inputs, { runId });
    const news = checkCustomerNews(inputs.snapshot, counterparty);
    const r = (body: Omit<AgentRow, "agentId" | "agentKind" | "parentAgentId">): AgentRow => ({
      agentId: RESEARCH,
      agentKind: "domino",
      parentAgentId: ANALYST,
      ...body,
    });
    await write(
      [
        say(RESEARCH, `Research ${counterparty} next${because(reason)}`, [counterparty]),
        r({
          action: "agent.working",
          event: "status",
          status: "working",
          currentTask: `Research: ${news.name} (${counterparty}) for the coordinator`,
          summary: `Calling the ${news.name} ${APIFY_LABEL} for ${counterparty}`,
        }),
        r({
          action: "agent.tool",
          event: "tool",
          tool: news.actor,
          toolCategory: "apify",
          toolLabel: APIFY_LABEL,
          source: "apify",
          refs: [counterparty],
          summary: `${news.name}: ${news.items.join("; ")}`,
        }),
        r({
          action: "agent.message",
          event: "message",
          fromAgentId: RESEARCH,
          toAgentId: COORDINATOR,
          refs: [counterparty],
          summary: `${counterparty}: ${news.items.join("; ")}`,
        }),
        r({
          action: "agent.done",
          event: "status",
          status: "done",
          currentTask: "Research reported",
          summary: `${RESEARCH} done: coordinator follow-up on ${counterparty}`,
        }),
      ],
      { ...news, requestedBy: COORDINATOR },
    );
    executed.push(`research ${counterparty}`);
  }
  await write([
    as({
      action: "agent.done",
      event: "status",
      status: "done",
      currentTask: "Idle",
      refs: [remoteRunId],
      summary: `${COORDINATOR} done: plan from CREAO run ${remoteRunId} (${executed.join("; ") || "no actions"})`,
    }),
  ]);
  return {
    status: "done",
    summary: plan.summary,
    escalate: plan.escalate,
    ...(plan.focus && { focus: plan.focus }),
    ...(plan.research && { research: plan.research }),
    remoteRunId,
    at: at(),
  };
}
