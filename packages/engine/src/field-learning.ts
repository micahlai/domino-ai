import type {
  CompanyModel,
  FeedbackRecord,
  Finding,
  LearnedRuleVersion,
  RuleAction,
  RuleTask,
  Snapshot,
} from "@domino/contracts";
import { auditRows } from "./audit";
import { type RuleChange, decideFeedback, resolveRules, revokeRuleVersion } from "./learned-rules";
import { recurringAssumptions } from "./recurring-revenue";
import type { Result } from "./source-normalization";

/**
 * Weekly product learning (Field). Turns a person's decisions on flags and fix suggestions into
 * scoped learned rules (L3 learned-rules.ts: decideFeedback, resolveRules, revokeRuleVersion),
 * and applies the rules that are eligible at a later audit or advisor run.
 *
 * Pure: no clock, network or randomness. Every recordedAt and cutoff is passed in by the
 * backend (its own server stamp), so a rule recorded after a run's cutoff never reaches that
 * run, and nothing is ever re-applied to snapshots audited before the decision.
 *
 * Scope: one Field company. Field companies have no SEC CIK, so they share the placeholder
 * FIELD_RULE_CIK and are told apart by sourceSignature `field-company:<companyId>`, which
 * ruleEligibility checks; another company's rule is out_of_scope.
 *
 * Effects are bounded: a flag rule can only hide a flag (with a receipt) or raise its severity
 * one step; a fix preference only reorders suggestions within a scenario. All money stays the
 * engine's.
 */

export const FIELD_RULE_CIK = "0000000000";
export const fieldSourceSignature = (companyId: string) => `field-company:${companyId}`;
export const fieldRuleTask = (companyId: string, cutoff: string): RuleTask => ({
  cik: FIELD_RULE_CIK,
  schemaVersion: 1,
  sourceSignature: fieldSourceSignature(companyId),
  cutoff,
});

type FlagKind = Finding["kind"];
type Severity = Finding["severity"];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Oct 25" from an ISO timestamp, in UTC so the text is deterministic. */
export function shortDate(iso: string): string {
  const d = new Date(Date.parse(iso));
  return `${MONTHS[d.getUTCMonth()] ?? ""} ${d.getUTCDate()}`;
}

/** Who a flag is about: the first referenced record's vendor, merchant or customer name. */
export function flagCounterparty(snapshot: Snapshot, refs: readonly string[]): string | null {
  const names = new Map(snapshot.customers.map((c) => [c.id, c.name]));
  const who = new Map(auditRows(snapshot).map((r) => [r.id, r.who]));
  const plans = new Map((snapshot.billingPlans ?? []).map((p) => [p.id, p.customerId]));
  for (const ref of refs) {
    const raw = who.get(ref) ?? plans.get(ref) ?? (names.has(ref) ? ref : undefined);
    const name = raw === undefined ? undefined : (names.get(raw) ?? raw).trim();
    if (name) return name;
  }
  return null;
}

export const flagRuleId = (kind: FlagKind, counterparty: string) =>
  `flag:${kind}:${counterparty.toLowerCase()}`;
export const fixRuleId = (fixKind: string) => `fix:${fixKind}`;

function learn(args: {
  history: readonly LearnedRuleVersion[];
  companyId: string;
  ruleId: string;
  action: RuleAction;
  feedbackId: string;
  actorId: string;
  text: string;
  evidenceRefs: string[];
  recordedAt: string;
}): Result<RuleChange> {
  const feedback: FeedbackRecord = {
    id: args.feedbackId,
    cik: FIELD_RULE_CIK,
    actorId: args.actorId,
    text: args.text,
    proposedAction: args.action,
    recordedAt: args.recordedAt,
  };
  return decideFeedback({
    history: args.history,
    feedback,
    decision: {
      status: "accepted",
      ruleId: args.ruleId,
      scope: { kind: "company", sourceSignature: fieldSourceSignature(args.companyId) },
      rationale: args.text,
      evidenceRefs: args.evidenceRefs,
    },
    recordedAt: args.recordedAt,
  });
}

/**
 * A flag decision becomes a rule for that pattern (company + flag kind + counterparty).
 * Dismissed: later flags of the pattern are not raised. Confirmed: they come back one
 * severity step higher. A later decision on the same pattern is a new version of the rule.
 */
export function learnFromFlagDecision(args: {
  history: readonly LearnedRuleVersion[];
  companyId: string;
  findingId: string;
  kind: FlagKind;
  counterparty: string;
  decision: "approved" | "rejected";
  reason: string;
  actorId: string;
  /** Backend stamp of the decision. */
  recordedAt: string;
}): Result<RuleChange> {
  const dismissed = args.decision === "rejected";
  const reason = args.reason.trim();
  const text =
    reason ||
    (dismissed
      ? `Dismissed as expected for ${args.counterparty}`
      : `Confirmed as a real problem for ${args.counterparty}`);
  return learn({
    history: args.history,
    companyId: args.companyId,
    ruleId: flagRuleId(args.kind, args.counterparty),
    action: {
      kind: "flag_expectation",
      flagKind: args.kind,
      counterparty: args.counterparty,
      expect: dismissed ? "normal" : "problem",
    },
    feedbackId: `feedback:${args.findingId}:${args.recordedAt}`,
    actorId: args.actorId || "person",
    text,
    evidenceRefs: [args.findingId],
    recordedAt: args.recordedAt,
  });
}

/** Accept or decline of a suggestion becomes a preference for that fix type. */
export function learnFromSuggestionDecision(args: {
  history: readonly LearnedRuleVersion[];
  companyId: string;
  suggestionId: string;
  fixKind: string;
  fixLabel: string;
  decision: "accepted" | "declined";
  reason: string;
  actorId: string;
  recordedAt: string;
}): Result<RuleChange> {
  const accepted = args.decision === "accepted";
  const text = args.reason.trim() || `${accepted ? "Approved" : "Dismissed"} fix: ${args.fixLabel}`;
  return learn({
    history: args.history,
    companyId: args.companyId,
    ruleId: fixRuleId(args.fixKind),
    action: {
      kind: "fix_preference",
      fixKind: args.fixKind,
      prefer: accepted ? "higher" : "lower",
    },
    feedbackId: `feedback:${args.suggestionId}:${args.recordedAt}`,
    actorId: args.actorId || "person",
    text,
    evidenceRefs: [args.suggestionId],
    recordedAt: args.recordedAt,
  });
}

/** Undo: revoke the rule's live version with a new record (the old record is unchanged). */
export function undoLearnedRule(args: {
  history: readonly LearnedRuleVersion[];
  recordId: string;
  recordedAt: string;
}): Result<RuleChange> {
  return revokeRuleVersion({
    history: args.history,
    targetId: args.recordId,
    revocation: { rationale: "Undone by a person", evidenceRefs: [args.recordId] },
    recordedAt: args.recordedAt,
  });
}

/** Rules in force for one company at one cutoff, keyed by slot. */
function selected(history: readonly LearnedRuleVersion[], companyId: string, cutoff: string) {
  const r = resolveRules(history, fieldRuleTask(companyId, cutoff));
  if (!r.ok) return r;
  const rules: LearnedRuleVersion[] = [];
  for (const s of r.value.slots) if (s.status === "selected") rules.push(s.rule);
  return { ok: true as const, value: rules };
}

export type FlagEffect = {
  effect: "suppressed" | "raised";
  severityBefore: Severity;
  severityAfter: Severity;
  ruleId: string;
  recordId: string;
  version: number;
  learnedAt: string;
  text: string;
};

const RAISE: Record<Severity, Severity> = { low: "medium", medium: "high", high: "high" };

/** The learned effect on each new flag, by finding id. Flags with no rule are absent. */
export function applyFlagRules(args: {
  history: readonly LearnedRuleVersion[];
  companyId: string;
  /** The audit's own server stamp. Only rules in force by then apply. */
  cutoff: string;
  findings: readonly {
    id: string;
    kind: FlagKind;
    severity: Severity;
    counterparty: string | null;
  }[];
}): Result<Record<string, FlagEffect>> {
  const rules = selected(args.history, args.companyId, args.cutoff);
  if (!rules.ok) return rules;
  const byPattern = new Map<string, LearnedRuleVersion>();
  for (const rule of rules.value)
    if (rule.action.kind === "flag_expectation")
      byPattern.set(flagRuleId(rule.action.flagKind, rule.action.counterparty), rule);
  const out: Record<string, FlagEffect> = {};
  for (const f of args.findings) {
    if (!f.counterparty) continue;
    const rule = byPattern.get(flagRuleId(f.kind, f.counterparty));
    if (!rule || rule.action.kind !== "flag_expectation") continue;
    const on = shortDate(rule.recordedAt);
    const suppress = rule.action.expect === "normal";
    out[f.id] = {
      effect: suppress ? "suppressed" : "raised",
      severityBefore: f.severity,
      severityAfter: suppress ? f.severity : RAISE[f.severity],
      ruleId: rule.ruleId,
      recordId: rule.id,
      version: rule.version,
      learnedAt: rule.recordedAt,
      text: suppress
        ? `Not flagged: learned from your dismissal on ${on} (rule v${rule.version})`
        : `Raised to ${RAISE[f.severity]}: you confirmed this pattern on ${on} (rule v${rule.version})`,
    };
  }
  return { ok: true, value: out };
}

export type RankEffect = {
  effect: "ranked_higher" | "ranked_lower";
  engineRank: number;
  ruleId: string;
  recordId: string;
  version: number;
  text: string;
};

/**
 * Reorder one scenario's engine-ranked fixes by learned preference: preferred types first,
 * then neutral, then declined types, keeping engine order inside each group. Returns the new
 * order (indexes into items) and a receipt for each item a rule moved or grouped.
 */
export function rankWithPreferences<T extends { kind: string }>(args: {
  history: readonly LearnedRuleVersion[];
  companyId: string;
  cutoff: string;
  items: readonly T[];
}): Result<{ order: number[]; effects: (RankEffect | null)[] }> {
  const rules = selected(args.history, args.companyId, args.cutoff);
  if (!rules.ok) return rules;
  const pref = new Map<string, LearnedRuleVersion>();
  for (const rule of rules.value)
    if (rule.action.kind === "fix_preference") pref.set(rule.action.fixKind, rule);
  const bucket = (kind: string) => {
    const a = pref.get(kind)?.action;
    return a?.kind === "fix_preference" ? (a.prefer === "higher" ? 0 : 2) : 1;
  };
  const order = args.items
    .map((item, i) => ({ i, b: bucket(item.kind) }))
    .sort((x, y) => x.b - y.b || x.i - y.i)
    .map((x) => x.i);
  const effects = args.items.map((item, i): RankEffect | null => {
    const rule = pref.get(item.kind);
    if (!rule || rule.action.kind !== "fix_preference") return null;
    const higher = rule.action.prefer === "higher";
    const on = shortDate(rule.recordedAt);
    return {
      effect: higher ? "ranked_higher" : "ranked_lower",
      engineRank: i,
      ruleId: rule.ruleId,
      recordId: rule.id,
      version: rule.version,
      text: higher
        ? `Ranked higher: you approved this kind of fix on ${on} (rule v${rule.version})`
        : `Ranked lower: you dismissed this kind of fix on ${on} (rule v${rule.version})`,
    };
  });
  return { ok: true, value: { order, effects } };
}

export type LearnedPaymentDelay = {
  customerId: string;
  name: string;
  meanDays: number;
  samples: number;
  text: string;
};

/**
 * Customer payment delays the model learned from observed payments (learn.ts), which the
 * forecast uses to date expected collections (schedule.ts, recurring-revenue.ts). Only
 * customers with observed payments and a nonzero delay; most observed first.
 */
export function learnedPaymentDelays(
  snapshot: Snapshot,
  model: CompanyModel,
  limit = 5,
): LearnedPaymentDelay[] {
  const names = new Map(snapshot.customers.map((c) => [c.id, c.name]));
  // The exact per-customer delay the forecast uses for billing plans (recurring-revenue.ts).
  const used = recurringAssumptions(snapshot, model).delayDays;
  const paid = new Map<string, number>();
  for (const inv of snapshot.invoices)
    if (inv.paid !== undefined && inv.paid <= snapshot.asOf)
      paid.set(inv.customerId, (paid.get(inv.customerId) ?? 0) + 1);
  const out: LearnedPaymentDelay[] = [];
  const seen = new Set<string>();
  const add = (customerId: string, days: number, samples: number) => {
    if (seen.has(customerId) || samples <= 0 || days === 0) return;
    seen.add(customerId);
    const name = names.get(customerId) ?? customerId;
    const n = Math.abs(days);
    const late = `~${n} day${n === 1 ? "" : "s"} ${days > 0 ? "late" : "early"}`;
    out.push({
      customerId,
      name,
      meanDays: days,
      samples,
      text: `Learned: ${name} pays ${late} on average (from ${samples} payment${samples === 1 ? "" : "s"})`,
    });
  };
  // Model delays (learned across ingests) first, then the customer's own observed payments.
  for (const [id, d] of Object.entries(model.customerDelayDays))
    add(id, Math.round(d.mean), d.samples);
  for (const [id, days] of Object.entries(used))
    if (model.customerDelayDays[id] === undefined) add(id, days, paid.get(id) ?? 0);
  return out
    .sort(
      (a, b) =>
        b.samples - a.samples || b.meanDays - a.meanDays || (a.customerId < b.customerId ? -1 : 1),
    )
    .slice(0, limit);
}
