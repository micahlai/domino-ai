import { SnapshotSchema } from "@domino/contracts";
/**
 * Audit swarm. After each ingest that wrote a new snapshot version, the Audit lead ("field.audit")
 * starts one checker agent per independent check ("audit.duplicates", "audit.crossToolTieOut",
 * "audit.amounts", "audit.timing", "audit.overdueCustomers", "audit.missingExpected",
 * "audit.billingEnds"). Each checker is its own internal action running one pure engine check
 * (engine runAuditCheck), at most SWARM_LIMIT at a time. The lead merges and dedupes their
 * drafts (engine mergeAuditFindings: checker order, never completion order), stores new findings
 * (high = escalated) and logs the result. The flag explainer (CREAO first, fieldAi.ts) then
 * explains new flags as before. Checks are math; AI only explains.
 *
 * The ingest action awaits the swarm, so runIngest still reports how many findings are new
 * (the simulated clock reads that) and the forecast recompute runs after the audit, as before.
 *
 * Log rows: the swarm's lifecycle rows go under runId `<ingest runId>.audit` (lead working,
 * per checker spawned, assignment message, working, engine tool row, report message, done or
 * failed; parentAgentId "field.audit"). The ingest run keeps its audit.escalated rows and one
 * audit.completed row.
 */
import {
  AUDIT_CHECKERS,
  AUDIT_CHECKER_INFO,
  type AuditCheckerId,
  type AuditDraft,
  type CheckerResult,
  type TieOutFailure,
  mergeAuditFindings,
  runAuditCheck,
} from "@domino/engine";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { AUDIT_AGENT } from "./fieldAi";
import { writeLog } from "./fieldJobs";
import { LEARNED_BY, flagEffects } from "./fieldLearning";
import { type AgentRow, agentLog } from "./lib/agentLog";
import { SWARM_LIMIT, mapBounded, member } from "./lib/swarm";

export const AUDIT_LEAD = AUDIT_AGENT;
export const checkerAgent = (c: AuditCheckerId) => `audit.${c}`;
const checkerArg = v.union(...AUDIT_CHECKERS.map((c) => v.literal(c)));
const tieOutArg = v.array(v.object({ name: v.string(), ref: v.string(), detail: v.string() }));
const draftArg = v.object({
  kind: v.union(
    v.literal("duplicate"),
    v.literal("conflict"),
    v.literal("unusual_amount"),
    v.literal("unusual_timing"),
    v.literal("missing_expected"),
  ),
  severity: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
  summary: v.string(),
  refs: v.array(v.string()),
});

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const inputs = internalQuery({
  args: { snapshotId: v.id("snapshots"), previousId: v.optional(v.id("snapshots")) },
  handler: async (ctx, { snapshotId, previousId }) => {
    const row = await ctx.db.get("snapshots", snapshotId);
    if (!row) throw new Error("Snapshot not found");
    const prev = previousId ? await ctx.db.get("snapshots", previousId) : null;
    return {
      snapshot: SnapshotSchema.parse(row.data),
      previous: prev ? SnapshotSchema.parse(prev.data) : null,
    };
  },
});

const checkArgs = {
  companyId: v.id("companies"),
  runId: v.string(),
  checker: checkerArg,
  snapshotId: v.id("snapshots"),
  previousId: v.optional(v.id("snapshots")),
  version: v.number(),
  tieOut: tieOutArg,
  detectedAt: v.string(),
};

/** One checker agent: one pure engine check, its own lifecycle rows. Never throws. */
export const check = internalAction({
  args: checkArgs,
  handler: async (ctx, a): Promise<{ ok: true; drafts: AuditDraft[] } | { ok: false }> => {
    const agentId = checkerAgent(a.checker);
    const info = AUDIT_CHECKER_INFO[a.checker];
    const m = member(agentId, AUDIT_LEAD);
    const log = (rows: AgentRow[]) =>
      ctx.runMutation(internal.fieldAi.logRows, { companyId: a.companyId, runId: a.runId, rows });
    const currentTask = `${info.label} on v${a.version}: ${info.task}`;
    try {
      await log([m.working({ currentTask, summary: `${info.label} started on v${a.version}` })]);
      const { snapshot, previous } = await ctx.runQuery(internal.fieldAudit.inputs, {
        snapshotId: a.snapshotId,
        ...(a.previousId && { previousId: a.previousId }),
      });
      const drafts = runAuditCheck(a.checker, {
        snapshot,
        previous,
        detectedAt: a.detectedAt,
        tieOut: a.tieOut,
      });
      const high = drafts.filter((d) => d.severity === "high").length;
      const found =
        drafts.length === 0 ? "nothing" : `${plural(drafts.length, "issue")}, ${high} high`;
      await log([
        m.tool({
          tool: `engine.audit.${a.checker}`,
          toolCategory: "engine",
          currentTask,
          refs: drafts.flatMap((d) => d.refs.slice(0, 2)).slice(0, 16),
          summary: `${info.label}: ${found}`,
        }),
        m.reported(
          `${info.label} on v${a.version}: ${found}`,
          drafts.flatMap((d) => d.refs.slice(0, 1)),
        ),
        m.done({ currentTask: `${info.label}: reported`, summary: `${agentId} done: ${found}` }),
      ]);
      return { ok: true, drafts };
    } catch (error) {
      await log([
        m.failed({ currentTask, summary: `${agentId} failed: ${errorText(error)}` }),
      ]).catch(() => undefined);
      return { ok: false };
    }
  },
});

/** Stores the merged findings once each (findingId) and writes the ingest run's audit rows. */
export const store = internalMutation({
  args: {
    companyId: v.id("companies"),
    ingestRunId: v.string(),
    swarmRunId: v.string(),
    snapshotId: v.id("snapshots"),
    version: v.number(),
    findings: v.array(v.object({ id: v.string(), detectedAt: v.string(), ...draftArg.fields })),
    checkers: v.number(),
    failed: v.array(v.string()),
    dropped: v.number(),
  },
  handler: async (ctx, a) => {
    const { companyId, snapshotId, version } = a;
    const feed = await ctx.db
      .query("feeds")
      .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
      .unique();
    const pending = feed?.auditPending;
    if (!feed || !pending || pending.snapshotId !== snapshotId) return [];
    if (pending.phase !== "audit") return [];
    const added: string[] = [];
    // Learned rules in force at this audit's own server stamp (never earlier snapshots).
    const cutoff = a.findings[0]?.detectedAt ?? new Date().toISOString();
    const learned = await flagEffects(ctx, { companyId, snapshotId, cutoff, findings: a.findings });
    let hidden = 0;
    for (const f of a.findings) {
      const existing = await ctx.db
        .query("findings")
        .withIndex("by_companyId_and_findingId", (q) =>
          q.eq("companyId", companyId).eq("findingId", f.id),
        )
        .first();
      if (existing) continue;
      const effect = learned.effects[f.id];
      const receipt = effect && {
        effect: effect.effect,
        text: effect.text,
        ruleId: effect.ruleId,
        recordId: effect.recordId,
        version: effect.version,
        severityBefore: effect.severityBefore,
      };
      if (effect?.effect === "suppressed") {
        // Not flagged: kept as a record with its receipt, outside the review queue.
        await ctx.db.insert("findings", {
          companyId,
          findingId: f.id,
          snapshotId,
          version,
          kind: f.kind,
          severity: f.severity,
          summary: f.summary,
          refs: f.refs,
          detectedAt: f.detectedAt,
          escalated: false,
          status: "rejected",
          decidedBy: LEARNED_BY,
          decidedAt: cutoff,
          note: effect.text,
          learned: receipt,
        });
        hidden++;
        continue;
      }
      const severity = effect?.severityAfter ?? f.severity;
      const escalated = severity === "high";
      await ctx.db.insert("findings", {
        companyId,
        findingId: f.id,
        snapshotId,
        version,
        kind: f.kind,
        severity,
        summary: f.summary,
        refs: f.refs,
        detectedAt: f.detectedAt,
        escalated,
        status: "open",
        ...(receipt && { learned: receipt }),
      });
      added.push(f.id);
      if (escalated)
        await writeLog(ctx, companyId, a.ingestRunId, {
          actor: "engine",
          action: "audit.escalated",
          refs: [f.id, ...f.refs],
          agent: AUDIT_LEAD,
          tool: "engine.mergeAuditFindings",
          summary: f.summary,
        });
    }
    await learned.commit();
    const n = a.findings.length;
    const learnedNote = hidden > 0 ? `; ${hidden} not flagged by learned rules` : "";
    const failed = a.failed.length > 0 ? `; ${plural(a.failed.length, "checker")} failed` : "";
    await writeLog(ctx, companyId, a.ingestRunId, {
      actor: "engine",
      action: "audit.completed",
      refs: added,
      agent: AUDIT_LEAD,
      tool: "engine.mergeAuditFindings",
      summary: `Audit found ${plural(n, "issue")}, ${added.length} new${learnedNote} (${a.checkers} checkers in parallel${failed})`,
    });
    await agentLog(ctx, companyId, a.swarmRunId, {
      action: "agent.done",
      agentId: AUDIT_LEAD,
      agentKind: "domino",
      event: "status",
      status: "done",
      currentTask: "Idle",
      refs: added,
      summary: `Audit lead merged ${a.checkers - a.failed.length} of ${a.checkers} checker reports: ${plural(n, "issue")}${
        a.dropped > 0 ? ` (${a.dropped} reported twice, kept once)` : ""
      }, ${added.length} new${failed}`,
    });
    // Findings and retry progress commit together. A crashed caller can resume recompute.
    await ctx.db.patch("feeds", feed._id, {
      auditPending: { ...pending, phase: "recompute", newFindings: added.length },
    });
    return added;
  },
});

/**
 * The audit swarm for one new snapshot version. Called from the ingest action after the commit;
 * returns the ids of findings stored for the first time. A failed checker aborts the merge, so
 * the pending snapshot can be retried without claiming a partial audit completed.
 */
export async function runAuditSwarm(
  ctx: ActionCtx,
  a: {
    companyId: Id<"companies">;
    ingestRunId: string;
    snapshotId: Id<"snapshots">;
    previousId?: Id<"snapshots">;
    version: number;
    tieOut: TieOutFailure[];
  },
): Promise<{ found: number; added: string[] }> {
  const swarmRunId = `${a.ingestRunId}.audit`;
  const detectedAt = new Date().toISOString();
  const version = `v${a.version}`;
  const rows: AgentRow[] = [
    {
      action: "agent.working",
      agentId: AUDIT_LEAD,
      agentKind: "domino",
      event: "status",
      status: "working",
      currentTask: `Auditing ${version} with ${AUDIT_CHECKERS.length} checkers`,
      refs: [a.snapshotId, version],
      summary: `Audit lead started ${AUDIT_CHECKERS.length} checkers on ${version}${
        a.tieOut.length > 0 ? ` (${plural(a.tieOut.length, "cross-tool mismatch")} to review)` : ""
      }`,
    },
  ];
  for (const c of AUDIT_CHECKERS) {
    const info = AUDIT_CHECKER_INFO[c];
    const m = member(checkerAgent(c), AUDIT_LEAD);
    rows.push(
      m.spawned({
        currentTask: `${info.label} on ${version}: queued`,
        summary: `Audit lead spawned ${checkerAgent(c)}: ${info.task}`,
      }),
      m.assigned(`Check ${version} for ${info.task}`, [version]),
    );
  }
  await ctx.runMutation(internal.fieldAi.logRows, {
    companyId: a.companyId,
    runId: swarmRunId,
    rows,
  });
  const settled = await mapBounded(AUDIT_CHECKERS, SWARM_LIMIT, (checker) =>
    ctx.runAction(internal.fieldAudit.check, {
      companyId: a.companyId,
      runId: swarmRunId,
      checker,
      snapshotId: a.snapshotId,
      ...(a.previousId && { previousId: a.previousId }),
      version: a.version,
      tieOut: a.tieOut,
      detectedAt,
    }),
  );
  const results: CheckerResult[] = [];
  const failed: string[] = [];
  settled.forEach((s, i) => {
    const checker = AUDIT_CHECKERS[i] as AuditCheckerId;
    if (s.status === "fulfilled" && s.value.ok) results.push({ checker, drafts: s.value.drafts });
    else failed.push(checker);
  });
  if (failed.length > 0) {
    await ctx.runMutation(internal.fieldAi.logRows, {
      companyId: a.companyId,
      runId: swarmRunId,
      rows: [
        {
          action: "agent.failed",
          agentId: AUDIT_LEAD,
          agentKind: "domino",
          event: "status",
          status: "failed",
          summary: `Audit incomplete: ${failed.join(", ")} failed; retry required`,
        },
      ],
    });
    throw new Error(`Audit incomplete: ${failed.join(", ")} failed`);
  }
  const { findings, dropped } = mergeAuditFindings(results, detectedAt);
  const added: string[] = await ctx.runMutation(internal.fieldAudit.store, {
    companyId: a.companyId,
    ingestRunId: a.ingestRunId,
    swarmRunId,
    snapshotId: a.snapshotId,
    version: a.version,
    findings,
    checkers: AUDIT_CHECKERS.length,
    failed,
    dropped,
  });
  return { found: findings.length, added };
}
