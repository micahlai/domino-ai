/**
 * Advisor suggestions (public). Written by the advisor swarm (fieldAdvisor.ts) when a stress
 * scenario takes usable cash below the lender's minimum: one row per scenario and fix kind, with
 * the engine's effect and, on at most one per round, CREAO's recommendation. A person accepts or
 * declines; that records a decision only. Domino never moves money.
 *
 * Queries
 *   fieldSuggestions.list({ companyId, status?: "open"|"accepted"|"declined" })
 *     -> up to 50, newest round first, then engine rank:
 *     [{ id, scenarioId, scenarioTitle, runId, snapshotVersion, agentId,
 *        fix: { id, kind: "credit_line_draw"|"delay_bill"|"accelerate_collections"|"defer_hires",
 *               label, costNote, risk: "low"|"medium"|"high" },
 *        effect: { lowPoint, lowWeekStart, survives, gain, scenarioLow, lenderMinimum,
 *                  breaksAt?, brokenConstraintId? }      (integer cents; dates ISO)
 *        rank, recommended, recommendation: null | { text, provider: "creao", remoteRunId, at },
 *        status, decidedBy?, decidedAt?, note?,
 *        forecast?: { timelineCompanyId, scenarioRunId, fixRunId, conversationId, route,
 *                     scenarioLow, fixLow, outOfCash?, effects, savedAt },
 *        createdAt, updatedAt }]
 * Mutations
 *   fieldSuggestions.decide({ companyId, id, expectedRunId, expectedSnapshotVersion,
 *                             decision: "accepted"|"declined", note? })
 *     -> { id, status }; an open suggestion only (ALREADY_DECIDED otherwise). Logs
 *     suggestion.accepted | suggestion.declined (agent field.worker).
 */
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireFeed, writeLog } from "./fieldJobs";
import { learnFromSuggestion } from "./fieldLearning";

const status = v.union(v.literal("open"), v.literal("accepted"), v.literal("declined"));

const view = (s: Doc<"suggestions">) => ({
  id: s.suggestionId,
  scenarioId: s.scenarioId,
  scenarioTitle: s.scenarioTitle,
  runId: s.runId,
  snapshotVersion: s.snapshotVersion,
  agentId: s.agentId,
  fix: {
    id: s.fix.id,
    kind: s.fix.kind,
    label: s.fix.label,
    costNote: s.fix.costNote,
    risk: s.fix.risk,
  },
  effect: s.effect,
  rank: s.rank,
  recommended: s.recommended,
  recommendation: s.recommendation ?? null,
  status: s.status,
  ...(s.decidedBy && { decidedBy: s.decidedBy }),
  ...(s.decidedAt && { decidedAt: s.decidedAt }),
  ...(s.note && { note: s.note }),
  ...(s.learned && { learned: s.learned }),
  ...(s.forecast && { forecast: s.forecast }),
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

export const list = query({
  args: { companyId: v.id("companies"), status: v.optional(status) },
  handler: async (ctx, { companyId, status }) => {
    const rows = status
      ? await ctx.db
          .query("suggestions")
          .withIndex("by_companyId_and_status_and_updatedAt", (q) =>
            q.eq("companyId", companyId).eq("status", status),
          )
          .order("desc")
          .take(50)
      : await ctx.db
          .query("suggestions")
          .withIndex("by_companyId_and_updatedAt", (q) => q.eq("companyId", companyId))
          .order("desc")
          .take(50);
    return rows
      .sort((a, b) =>
        a.updatedAt === b.updatedAt ? a.rank - b.rank : a.updatedAt < b.updatedAt ? 1 : -1,
      )
      .map(view);
  },
});

export const decide = mutation({
  args: {
    companyId: v.id("companies"),
    id: v.string(),
    expectedRunId: v.string(),
    expectedSnapshotVersion: v.number(),
    decision: v.union(v.literal("accepted"), v.literal("declined")),
    note: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { companyId, id, expectedRunId, expectedSnapshotVersion, decision, note },
  ) => {
    const feed = await requireFeed(ctx, companyId);
    const row = await ctx.db
      .query("suggestions")
      .withIndex("by_companyId_and_suggestionId", (q) =>
        q.eq("companyId", companyId).eq("suggestionId", id),
      )
      .unique();
    if (!row) throw new ConvexError({ code: "NOT_FOUND", message: "No such suggestion" });
    if (row.runId !== expectedRunId || row.snapshotVersion !== expectedSnapshotVersion)
      throw new ConvexError({
        code: "STALE_SUGGESTION",
        message: "This suggestion changed; review it again",
      });
    if (row.snapshotVersion !== feed.snapshotVersion)
      throw new ConvexError({
        code: "STALE_SUGGESTION",
        message: "The snapshot changed; review this suggestion again",
      });
    if (row.status !== "open")
      throw new ConvexError({ code: "ALREADY_DECIDED", message: `Already ${row.status}` });
    const identity = await ctx.auth.getUserIdentity();
    const by = identity?.tokenIdentifier ?? "demo-user (unverified)";
    const at = new Date().toISOString();
    const text = (note ?? "").trim().slice(0, 2000);
    await ctx.db.patch("suggestions", row._id, {
      status: decision,
      decidedBy: by,
      decidedAt: at,
      updatedAt: at,
      ...(text && { note: text }),
    });
    await writeLog(ctx, companyId, undefined, {
      actor: "person",
      action: `suggestion.${decision}`,
      refs: [id, row.fix.id, row.scenarioId],
      agent: "field.worker",
      summary: `${decision === "accepted" ? "Accepted" : "Declined"} suggestion: ${row.fix.label} (${row.scenarioTitle}). A decision record only; no money moved.`,
    });
    await learnFromSuggestion(ctx, { companyId, row, decision, note: text, by, at });
    return { id, status: decision };
  },
});
