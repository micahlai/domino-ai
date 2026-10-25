/**
 * Field learning (Learning agent, learning#1). A person's decisions become scoped learned rules
 * (engine field-learning.ts over learned-rules.ts) and later work applies the eligible ones:
 *
 * - Dismiss flag with a reason: later flags of the same pattern (this company, flag kind and
 *   counterparty) are not raised; each keeps a receipt. Confirm issue: they come back one
 *   severity step higher.
 * - Accept / Decline suggestion: later advisor runs rank that fix type higher / lower for this
 *   company. Ordering only; every money value stays the engine's.
 *
 * Every recordedAt is this server's own stamp. Rules apply only to audits and advisor runs whose
 * server cutoff is at or after the rule; findings and suggestions saved before are never
 * rewritten (except Undo, which reopens flags the undone rule itself hid).
 *
 * Public
 *   fieldLearning.list({ companyId }) -> { rules: [...], paymentDelays: [...] }
 *   fieldLearning.undo({ companyId, ruleId }) -> { recordId }
 */
import {
  CompanyModelSchema,
  type LearnedRuleVersion,
  LearnedRuleVersionSchema,
  SnapshotSchema,
} from "@domino/contracts";
import {
  type FlagEffect,
  type RankEffect,
  applyFlagRules,
  flagCounterparty,
  learnFromFlagDecision,
  learnFromSuggestionDecision,
  learnedPaymentDelays,
  rankWithPreferences,
  undoLearnedRule,
} from "@domino/engine";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, type QueryCtx, mutation, query } from "./_generated/server";
import { agentLog } from "./lib/agentLog";

export const LEARNING_AGENT = "learning#1";
export const LEARNED_BY = "Domino (learned rule)";
const FIX_LABEL: Record<string, string> = {
  credit_line_draw: "Credit line draw",
  delay_bill: "Delay a bill",
  accelerate_collections: "Collect sooner",
  defer_hires: "Defer hires",
};
const FLAG_LABEL: Record<string, string> = {
  duplicate: "Duplicate",
  conflict: "Changed record",
  unusual_amount: "Unusual amount",
  unusual_timing: "Unusual timing",
  missing_expected: "Missing item",
};

type Db = Pick<MutationCtx, "db">;
type Row = Doc<"learnedRules">;

async function rows(ctx: Pick<QueryCtx, "db">, companyId: Id<"companies">): Promise<Row[]> {
  return ctx.db
    .query("learnedRules")
    .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
    .take(1000);
}
const historyOf = (rs: Row[]): LearnedRuleVersion[] =>
  rs.map((r) => LearnedRuleVersionSchema.parse(r.record));

/** Three status rows so the brain map lights the Learning agent for a real rule change. */
async function logLearning(
  ctx: Db,
  companyId: Id<"companies">,
  at: string,
  task: string,
  summary: string,
  refs: string[],
) {
  const runId = `learning.${at}`;
  const base = { agentId: LEARNING_AGENT, agentKind: "domino" as const, refs };
  await agentLog(ctx, companyId, runId, {
    ...base,
    action: "agent.working",
    event: "status",
    status: "working",
    currentTask: task,
    summary: `Learning agent: ${task}`,
  });
  await agentLog(ctx, companyId, runId, {
    ...base,
    action: "learning.tool",
    event: "tool",
    tool: "engine.learnedRules",
    toolCategory: "engine",
    currentTask: task,
    summary,
  });
  await agentLog(ctx, companyId, runId, {
    ...base,
    action: "agent.done",
    event: "status",
    status: "done",
    currentTask: "Idle",
    summary,
  });
}

async function save(
  ctx: Db,
  companyId: Id<"companies">,
  record: LearnedRuleVersion,
  source: Row["source"],
) {
  await ctx.db.insert("learnedRules", {
    companyId,
    ruleId: record.ruleId,
    recordId: record.id,
    version: record.version,
    status: record.status,
    record,
    source,
    scope: "This company only",
    recordedAt: record.recordedAt,
    applied: 0,
  });
}

/** Called by field.decide after the decision is saved. Never throws: learning is best effort. */
export async function learnFromFinding(
  ctx: Db,
  a: {
    companyId: Id<"companies">;
    finding: Doc<"findings">;
    decision: "approved" | "rejected";
    note: string;
    by: string;
    at: string;
  },
) {
  const { companyId, finding } = a;
  const dismissed = a.decision === "rejected";
  if (dismissed && !a.note) {
    await logLearning(
      ctx,
      companyId,
      a.at,
      "Read a dismissal",
      "Nothing learned: the flag was dismissed without a reason",
      [finding.findingId],
    );
    return null;
  }
  const snap = await ctx.db.get("snapshots", finding.snapshotId);
  const parsed = snap ? SnapshotSchema.safeParse(snap.data) : null;
  const counterparty = parsed?.success ? flagCounterparty(parsed.data, finding.refs) : null;
  if (!counterparty) {
    await logLearning(
      ctx,
      companyId,
      a.at,
      "Read a flag decision",
      "Nothing learned: this flag names no vendor or customer to learn a pattern for",
      [finding.findingId],
    );
    return null;
  }
  const r = learnFromFlagDecision({
    history: historyOf(await rows(ctx, companyId)),
    companyId,
    findingId: finding.findingId,
    kind: finding.kind,
    counterparty,
    decision: a.decision,
    reason: a.note,
    actorId: a.by,
    recordedAt: a.at,
  });
  const pattern = `${FLAG_LABEL[finding.kind] ?? finding.kind} from ${counterparty}`;
  if (!r.ok) {
    await logLearning(
      ctx,
      companyId,
      a.at,
      "Learn from a flag decision",
      `Nothing learned: ${r.errors[0] ?? "rule refused"}`,
      [finding.findingId],
    );
    return null;
  }
  await save(ctx, companyId, r.value.record, {
    decision: dismissed ? "dismissed_flag" : "confirmed_flag",
    ref: finding.findingId,
    summary: `${dismissed ? "Dismissed" : "Confirmed"}: ${pattern}`,
    by: a.by,
  });
  await logLearning(
    ctx,
    companyId,
    a.at,
    `Learn from your ${dismissed ? "dismissal" : "confirmation"}`,
    `Learned rule v${r.value.record.version}: ${pattern} is ${dismissed ? "expected, stop flagging it" : "a real problem, flag it higher"}`,
    [r.value.record.id, finding.findingId],
  );
  return r.value.record.id;
}

/** Called by fieldSuggestions.decide after the decision is saved. */
export async function learnFromSuggestion(
  ctx: Db,
  a: {
    companyId: Id<"companies">;
    row: Doc<"suggestions">;
    decision: "accepted" | "declined";
    note: string;
    by: string;
    at: string;
  },
) {
  const { companyId, row } = a;
  const r = learnFromSuggestionDecision({
    history: historyOf(await rows(ctx, companyId)),
    companyId,
    suggestionId: row.suggestionId,
    fixKind: row.fix.kind,
    fixLabel: row.fix.label,
    decision: a.decision,
    reason: a.note,
    actorId: a.by,
    recordedAt: a.at,
  });
  if (!r.ok) {
    await logLearning(
      ctx,
      companyId,
      a.at,
      "Learn from a suggestion decision",
      `Nothing learned: ${r.errors[0] ?? "rule refused"}`,
      [row.suggestionId],
    );
    return null;
  }
  const accepted = a.decision === "accepted";
  const label = FIX_LABEL[row.fix.kind] ?? row.fix.kind;
  await save(ctx, companyId, r.value.record, {
    decision: accepted ? "accepted_fix" : "declined_fix",
    ref: row.suggestionId,
    summary: `${accepted ? "Approved" : "Dismissed"}: ${row.fix.label}`,
    by: a.by,
  });
  await logLearning(
    ctx,
    companyId,
    a.at,
    `Learn from your ${accepted ? "approval" : "dismissal"} of a suggestion`,
    `Learned rule v${r.value.record.version}: rank "${label}" fixes ${accepted ? "higher" : "lower"} for this company`,
    [r.value.record.id, row.suggestionId],
  );
  return r.value.record.id;
}

async function countApplications(
  ctx: Db,
  companyId: Id<"companies">,
  all: Row[],
  effects: { recordId: string; text: string }[],
  at: string,
) {
  const byRecord = new Map<string, { n: number; text: string }>();
  for (const e of effects)
    byRecord.set(e.recordId, { n: (byRecord.get(e.recordId)?.n ?? 0) + 1, text: e.text });
  for (const [recordId, { n, text }] of byRecord) {
    const row = all.find((r) => r.recordId === recordId);
    if (row)
      await ctx.db.patch("learnedRules", row._id, {
        applied: row.applied + n,
        lastEffect: text,
        lastAppliedAt: at,
      });
  }
  if (effects.length > 0)
    await logLearning(
      ctx,
      companyId,
      at,
      "Apply learned rules",
      effects.length === 1
        ? (effects[0]?.text ?? "")
        : `Applied learned rules ${effects.length} times: ${effects[0]?.text ?? ""}`,
      [...byRecord.keys()],
    );
}

/** Learned effects for one new audit's findings. `cutoff` is the audit's server stamp. */
export async function flagEffects(
  ctx: Db,
  a: {
    companyId: Id<"companies">;
    snapshotId: Id<"snapshots">;
    cutoff: string;
    findings: {
      id: string;
      kind: Doc<"findings">["kind"];
      severity: Doc<"findings">["severity"];
      refs: string[];
    }[];
  },
): Promise<{ effects: Record<string, FlagEffect>; commit: () => Promise<void> }> {
  const none = { effects: {}, commit: async () => undefined };
  const all = await rows(ctx, a.companyId);
  if (all.length === 0 || a.findings.length === 0) return none;
  const snap = await ctx.db.get("snapshots", a.snapshotId);
  const parsed = snap ? SnapshotSchema.safeParse(snap.data) : null;
  if (!parsed?.success) return none;
  const r = applyFlagRules({
    history: historyOf(all),
    companyId: a.companyId,
    cutoff: a.cutoff,
    findings: a.findings.map((f) => ({
      id: f.id,
      kind: f.kind,
      severity: f.severity,
      counterparty: flagCounterparty(parsed.data, f.refs),
    })),
  });
  if (!r.ok) return none;
  const effects = r.value;
  return {
    effects,
    commit: () =>
      countApplications(ctx, a.companyId, all, Object.values(effects), new Date().toISOString()),
  };
}

/** Learned order for one scenario's engine-ranked fixes. */
export async function rankEffects<T extends { kind: string }>(
  ctx: Db,
  a: { companyId: Id<"companies">; cutoff: string; items: readonly T[] },
): Promise<{ order: number[]; effects: (RankEffect | null)[]; commit: () => Promise<void> }> {
  const identity = {
    order: a.items.map((_, i) => i),
    effects: a.items.map(() => null),
    commit: async () => undefined,
  };
  const all = await rows(ctx, a.companyId);
  if (all.length === 0) return identity;
  const r = rankWithPreferences({
    history: historyOf(all),
    companyId: a.companyId,
    cutoff: a.cutoff,
    items: a.items,
  });
  if (!r.ok) return identity;
  const applied = r.value.effects.flatMap((e) => (e ? [e] : []));
  return {
    ...r.value,
    commit: () => countApplications(ctx, a.companyId, all, applied, new Date().toISOString()),
  };
}

const DECISION_TEXT: Record<Row["source"]["decision"], string> = {
  dismissed_flag: "You dismissed a flag",
  confirmed_flag: "You confirmed an issue",
  accepted_fix: "You approved a suggestion",
  declined_fix: "You dismissed a suggestion",
  undo: "You undid this rule",
};

function describe(action: LearnedRuleVersion["action"]): string {
  if (action.kind === "flag_expectation")
    return action.expect === "normal"
      ? `Don't flag ${FLAG_LABEL[action.flagKind]?.toLowerCase() ?? action.flagKind} from ${action.counterparty}`
      : `Flag ${FLAG_LABEL[action.flagKind]?.toLowerCase() ?? action.flagKind} from ${action.counterparty} higher`;
  if (action.kind === "fix_preference")
    return `Rank "${FIX_LABEL[action.fixKind] ?? action.fixKind}" fixes ${action.prefer}`;
  return action.kind;
}

export const list = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const all = await rows(ctx, companyId);
    const byRule = new Map<string, Row[]>();
    for (const r of all) byRule.set(r.ruleId, [...(byRule.get(r.ruleId) ?? []), r]);
    const rules = [...byRule.values()]
      .map((chain) => {
        const sorted = [...chain].sort((a, b) => a.version - b.version);
        const latest = sorted.at(-1) as Row;
        const decided = [...sorted].reverse().find((r) => r.status === "accepted") ?? latest;
        const record = LearnedRuleVersionSchema.parse(decided.record);
        return {
          ruleId: latest.ruleId,
          version: decided.version,
          active: latest.status === "accepted",
          rule: describe(record.action),
          reason: record.rationale,
          source: DECISION_TEXT[decided.source.decision],
          sourceSummary: decided.source.summary,
          learnedAt: decided.recordedAt,
          undoneAt: latest.status === "revoked" ? latest.recordedAt : null,
          scope: decided.scope,
          applied: sorted.reduce((n, r) => n + r.applied, 0),
          lastEffect: decided.lastEffect ?? null,
          lastAppliedAt: decided.lastAppliedAt ?? null,
          versions: sorted.filter((r) => r.source.decision !== "undo").length,
        };
      })
      .sort((a, b) => (a.learnedAt < b.learnedAt ? 1 : -1));

    // Payment behavior the forecast already uses (model.customerDelayDays from observed payments).
    const feed = await ctx.db
      .query("feeds")
      .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
      .unique();
    const snap = feed?.lastSnapshotId ? await ctx.db.get("snapshots", feed.lastSnapshotId) : null;
    const modelRow = await ctx.db
      .query("models")
      .withIndex("by_company_version", (q) => q.eq("companyId", companyId))
      .order("desc")
      .first();
    const snapshot = snap ? SnapshotSchema.safeParse(snap.data) : null;
    const model = modelRow ? CompanyModelSchema.safeParse(modelRow.data) : null;
    const paymentDelays =
      snapshot?.success && model?.success ? learnedPaymentDelays(snapshot.data, model.data) : [];
    return {
      rules,
      paymentDelays,
      asOf: snapshot?.success ? snapshot.data.asOf : null,
    };
  },
});

export const undo = mutation({
  args: { companyId: v.id("companies"), ruleId: v.string() },
  handler: async (ctx, { companyId, ruleId }) => {
    const all = await rows(ctx, companyId);
    const chain = all.filter((r) => r.ruleId === ruleId).sort((a, b) => a.version - b.version);
    const latest = chain.at(-1);
    if (!latest || latest.status !== "accepted")
      throw new ConvexError({ code: "NOT_ACTIVE", message: "This rule is not active" });
    const at = new Date().toISOString();
    const identity = await ctx.auth.getUserIdentity();
    const by = identity?.tokenIdentifier ?? "demo-user (unverified)";
    const r = undoLearnedRule({
      history: historyOf(all),
      recordId: latest.recordId,
      recordedAt: at,
    });
    if (!r.ok) throw new ConvexError({ code: "UNDO_FAILED", message: r.errors.join("; ") });
    await save(ctx, companyId, r.value.record, {
      decision: "undo",
      ref: latest.recordId,
      summary: `Undid rule v${latest.version}`,
      by,
    });
    // Flags this rule hid come back to the queue, marked as undone.
    const hidden = await ctx.db
      .query("findings")
      .withIndex("by_companyId_and_status", (q) =>
        q.eq("companyId", companyId).eq("status", "rejected"),
      )
      .take(500);
    let reopened = 0;
    for (const f of hidden) {
      if (f.decidedBy !== LEARNED_BY || f.learned?.ruleId !== ruleId || f.learned.undoneAt)
        continue;
      await ctx.db.patch("findings", f._id, {
        status: "open",
        decidedBy: undefined,
        decidedAt: undefined,
        note: undefined,
        learned: { ...f.learned, undoneAt: at },
      });
      reopened++;
    }
    const record = LearnedRuleVersionSchema.parse(latest.record);
    await logLearning(
      ctx,
      companyId,
      at,
      "Undo a learned rule",
      `Undid rule v${latest.version} (${describe(record.action)})${reopened > 0 ? `; ${reopened} hidden flag${reopened === 1 ? "" : "s"} back in review` : ""}`,
      [r.value.record.id, latest.recordId],
    );
    return { recordId: r.value.record.id, reopened };
  },
});
