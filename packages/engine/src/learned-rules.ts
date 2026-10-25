import {
  CikSchema,
  type FeedbackRecord,
  FeedbackRecordSchema,
  type HistoricalPrediction,
  IdSchema,
  type LearnedRuleVersion,
  LearnedRuleVersionSchema,
  type RuleAction,
  type RuleTask,
  TimestampSchema,
  ruleEligibility,
} from "@domino/contracts";
import { QUARTER_BRIDGE_METHOD, type QuarterBridge, quarterBridge } from "./period";
import {
  type CandidateIneligibleReason,
  QUARTER_CANDIDATE_METHOD,
  type QuarterCandidate,
  type QuarterCandidateInput,
  engineFailure,
  plainSnapshot,
  quarterCandidate,
} from "./period-candidate";
import type { Result } from "./source-normalization";
import {
  type KeyReconciliation,
  type ReconcileArgs,
  type Reconciliation,
  reconcileSources,
} from "./source-reconciliation";

/**
 * L3 scoped learned rules. Pure and synchronous: no network, clock, AI or randomness. Every
 * caller-owned argument is copied once at entry as plain JSON data; only the copy is read.
 *
 * The rule log is append-only. A person's feedback becomes a LearnedRuleVersion only by an
 * explicit decision; rejection, revocation and rollback are new records, never edits. A
 * version applies to a task exactly when the contract's ruleEligibility says so (accepted,
 * in scope, recorded and effective by the task's knowledge cutoff), so present-day feedback
 * never enters an earlier cutoff, and re-running an earlier cutoff reproduces its result.
 *
 * Inside one rule the highest live version wins (a revocation in force removes the version
 * it names, so the preceding one returns: rollback). Rules are grouped by the behavior they
 * control (slot). Two or more rules live in one slot block that slot, whatever their order
 * or agreement; nothing picks a winner by iteration order, scope or recency.
 *
 * Time custody: every recordedAt (FeedbackRecord.recordedAt, and the recordedAt argument of
 * decideFeedback, revokeRuleVersion and rollbackRule) MUST be the backend's own ingestion
 * stamp (L5), never a value a caller or person typed. The engine has no clock, so its
 * no-backdating guarantee is relative to that stamp: a record takes effect at
 * max(recordedAt, effectiveFrom), any caller-chosen date before the stamp is rejected, and
 * the log refuses a stamp earlier than any already recorded.
 *
 * Applied behavior: authority_preference rules drive L2 conflict selection, method_selection
 * chooses the quarterly cash method. mapping_override is resolved here but L1 has no
 * override hook, so it does not yet change import.
 */

export const RULE_VALIDATOR = { version: "1.0.0" } as const;
/** The one slot every quarterly cash method selection competes for. */
export const QUARTER_METHOD_SLOT = "method_selection:quarterly_cash";

export type MethodRef = { methodId: string; version: string };
const ref = (m: { id: string; version: string }): MethodRef => ({
  methodId: m.id,
  version: m.version,
});
/** Selectable quarterly cash methods. B is the default when no rule applies. */
export const QUARTER_METHODS: readonly MethodRef[] = [
  ref(QUARTER_BRIDGE_METHOD),
  ref(QUARTER_CANDIDATE_METHOD),
];
const isBaseline = (m: MethodRef) =>
  m.methodId === QUARTER_BRIDGE_METHOD.id && m.version === QUARTER_BRIDGE_METHOD.version;
const isCandidate = (m: MethodRef) =>
  m.methodId === QUARTER_CANDIDATE_METHOD.id && m.version === QUARTER_CANDIDATE_METHOD.version;

type Rule = LearnedRuleVersion;
type Scope = Rule["scope"];

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const err = <T>(...errors: string[]): Result<T> => ({ ok: false, errors });
const ms = (t: string): number => Date.parse(t);
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const nonBlank = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0;
const isTimestamp = (t: unknown): t is string =>
  typeof t === "string" && TimestampSchema.safeParse(t).success;
/** When a record takes effect: its later of recordedAt and effectiveFrom. */
const inForce = (r: Rule): number => Math.max(ms(r.recordedAt), ms(r.effectiveFrom));
const inForceText = (r: Rule): string =>
  ms(r.effectiveFrom) >= ms(r.recordedAt) ? r.effectiveFrom : r.recordedAt;

/** Deep-frozen results: a returned receipt or history can never be edited afterwards. */
function freeze<T>(v: T): T {
  if (v !== null && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v)) freeze(x);
  }
  return v;
}

/** The behavior a rule controls. Rules in one slot compete. */
export function ruleSlot(a: RuleAction): string {
  if (a.kind === "mapping_override") return `mapping_override:${JSON.stringify([a.tag, a.unit])}`;
  if (a.kind === "authority_preference") return `authority_preference:${a.metric}`;
  return QUARTER_METHOD_SLOT;
}
/** Fields a change of this action can affect, in plain dotted names. */
function slotFields(a: RuleAction): string[] {
  if (a.kind === "mapping_override") return [`mapping.${a.tag}.${a.unit}`];
  if (a.kind === "authority_preference") return [`reconciliation.${a.metric}.conflict_selection`];
  return ["forecast.method", "forecast.target_total", "forecast.target_usable"];
}
const actionKey = (a: RuleAction): string =>
  JSON.stringify(
    a.kind === "mapping_override"
      ? [a.kind, a.tag, a.unit, a.metric, a.definition]
      : a.kind === "authority_preference"
        ? [a.kind, a.metric, a.prefer]
        : [a.kind, a.methodId, a.version],
  );
const scopeKey = (s: Scope): string =>
  JSON.stringify(
    s.kind === "company"
      ? [s.kind, s.cik, s.schemaVersion, s.sourceSignature]
      : [s.kind, s.userChoiceId],
  );
const overlaps = (a: Scope, b: Scope): boolean =>
  a.kind === "global" || b.kind === "global" || scopeKey(a) === scopeKey(b);

// ---------- History validation ----------

/**
 * Every record is validated, ids and (ruleId, version) are unique, and each rule keeps one
 * scope and slot, versions in recorded order, and supersedes/revokes pointing at an earlier
 * accepted version of the same rule. A version is revoked at most once.
 */
function readHistory(input: unknown): Result<Rule[]> {
  if (input === undefined) return ok([]);
  if (!Array.isArray(input)) return err("history must be an array of rule versions");
  const out: Rule[] = [];
  const errors: string[] = [];
  for (const [i, r] of input.entries()) {
    const p = LearnedRuleVersionSchema.safeParse(r);
    if (!p.success)
      errors.push(...p.error.issues.map((x) => `history ${i} ${x.path.join(".")}: ${x.message}`));
    else out.push(p.data);
  }
  if (errors.length) return err(...errors);
  const ids = new Set<string>();
  const versions = new Set<string>();
  for (const r of out) {
    if (ids.has(r.id)) errors.push(`history: duplicate rule version id ${r.id}`);
    const v = JSON.stringify([r.ruleId, r.version]);
    if (versions.has(v)) errors.push(`history: rule ${r.ruleId} has version ${r.version} twice`);
    ids.add(r.id);
    versions.add(v);
  }
  for (const chain of chains(out).values()) {
    const [first] = chain;
    if (!first) continue;
    const revoked = new Set<string>();
    for (const [i, r] of chain.entries()) {
      const at = `rule ${r.ruleId} version ${r.version}`;
      if (scopeKey(r.scope) !== scopeKey(first.scope)) errors.push(`${at}: scope differs`);
      if (ruleSlot(r.action) !== ruleSlot(first.action))
        errors.push(`${at}: controls a different behavior`);
      const before = chain[i - 1];
      if (before && ms(r.recordedAt) < ms(before.recordedAt))
        errors.push(`${at}: recorded before version ${before.version}; never backdate`);
      for (const [field, target] of [
        ["supersedes", r.supersedes],
        ["revokes", r.revokes],
      ] as const) {
        if (target === undefined) continue;
        const t = chain.find((x) => x.id === target);
        if (!t || t.version >= r.version || t.status !== "accepted")
          errors.push(`${at}: ${field} must name an earlier accepted version of the same rule`);
        else if (field === "revokes" && actionKey(t.action) !== actionKey(r.action))
          errors.push(`${at}: a revocation must carry the revoked version's action`);
      }
      if (r.supersedes !== undefined && r.status !== "accepted")
        errors.push(`${at}: only an accepted version supersedes`);
      if (r.revokes !== undefined) {
        if (revoked.has(r.revokes)) errors.push(`${at}: ${r.revokes} is already revoked`);
        revoked.add(r.revokes);
      }
    }
  }
  if (errors.length) return err(...[...new Set(errors)].sort(byText));
  return ok(out.sort((a, b) => byText(a.id, b.id)));
}

/** Records grouped by rule, each sorted by version; groups keyed and iterated by rule id. */
function chains(rules: readonly Rule[]): Map<string, Rule[]> {
  const m = new Map<string, Rule[]>();
  for (const r of [...rules].sort((a, b) => byText(a.ruleId, b.ruleId) || a.version - b.version))
    m.set(r.ruleId, [...(m.get(r.ruleId) ?? []), r]);
  return m;
}

/** Live accepted versions at instant t, highest version first. */
function liveAt(chain: readonly Rule[], t: number): Rule[] {
  const revoked = new Set(
    chain.flatMap((r) =>
      r.status === "revoked" && inForce(r) <= t && r.revokes ? [r.revokes] : [],
    ),
  );
  return chain
    .filter((r) => r.status === "accepted" && inForce(r) <= t && !revoked.has(r.id))
    .sort((a, b) => b.version - a.version);
}

function readTask(t: unknown): Result<RuleTask> {
  const x = t as Partial<RuleTask> | undefined;
  if (!CikSchema.safeParse(x?.cik).success) return err("task cik must be a ten-digit CIK");
  if (x?.schemaVersion !== 1) return err("task schemaVersion must be 1");
  if (!nonBlank(x.sourceSignature)) return err("task sourceSignature is required");
  if (!isTimestamp(x.cutoff)) return err("task cutoff must be a timestamp with an explicit offset");
  return ok({
    cik: x.cik as string,
    schemaVersion: 1,
    sourceSignature: x.sourceSignature,
    cutoff: x.cutoff,
  });
}

// ---------- Receipts ----------

export type RuleVersionRef = { id: string; ruleId: string; version: number; action: RuleAction };
const versionRef = (r: Rule): RuleVersionRef => ({
  id: r.id,
  ruleId: r.ruleId,
  version: r.version,
  action: r.action,
});

/** What one rule version did to one task, against the version it replaced (null: default). */
export type RuleApplication = {
  slot: string;
  ruleId: string;
  version: RuleVersionRef;
  previous: RuleVersionRef | null;
  feedbackId: string;
  reason: string;
  evidenceRefs: string[];
  /** Work with a knowledge cutoff at or after this instant can use the version. */
  eligibleAt: string;
  /** Fields whose result differs from the previous version's (slot fields when not computed). */
  affectedFields: string[];
};

const application = (rule: Rule, previous: Rule | null, affected: string[]): RuleApplication => ({
  slot: ruleSlot(rule.action),
  ruleId: rule.ruleId,
  version: versionRef(rule),
  previous: previous ? versionRef(previous) : null,
  feedbackId: rule.feedbackId,
  reason: rule.rationale,
  evidenceRefs: [...rule.evidenceRefs],
  eligibleAt: inForceText(rule),
  affectedFields: affected,
});

/** One decision appended to the log: the rule's live version before and after it. */
export type RuleChangeReceipt = {
  kind: "accepted" | "rejected" | "revoked";
  recordId: string;
  ruleId: string;
  slot: string;
  scope: Scope;
  /** Live version of this rule just before the change took effect (null: none). */
  previous: RuleVersionRef | null;
  /** Live version once it took effect. Equal to previous when nothing changed. */
  next: RuleVersionRef | null;
  reason: string;
  /** Empty exactly when the change alters no behavior (a rejection). */
  affectedFields: string[];
  /** Only work with a knowledge cutoff at or after this instant can see the change. */
  eligibleAt: string;
  /** Other rules live in the same slot and an overlapping scope: these will block. */
  conflictsWith: string[];
};

export type RuleChange = {
  record: LearnedRuleVersion;
  /** A new log: the old one plus the record. The caller's log is never edited. */
  history: readonly LearnedRuleVersion[];
  receipt: RuleChangeReceipt;
};

function change(kind: RuleChangeReceipt["kind"], before: Rule[], record: Rule): Result<RuleChange> {
  const after = [...before, record];
  const valid = readHistory(after);
  if (!valid.ok) return valid;
  const t = inForce(record);
  const chainOf = (rs: Rule[]) => rs.filter((r) => r.ruleId === record.ruleId);
  const prev = liveAt(chainOf(before), t)[0] ?? null;
  const next = liveAt(chainOf(after), t)[0] ?? null;
  const slot = ruleSlot(record.action);
  const conflictsWith = next
    ? [...chains(after).values()]
        .filter((c) => c[0]?.ruleId !== record.ruleId)
        .flatMap((c) => liveAt(c, t).slice(0, 1))
        .filter((h) => ruleSlot(h.action) === slot && overlaps(h.scope, record.scope))
        .map((h) => h.id)
        .sort(byText)
    : [];
  return ok(
    freeze({
      record,
      history: valid.value,
      receipt: {
        kind,
        recordId: record.id,
        ruleId: record.ruleId,
        slot,
        scope: record.scope,
        previous: prev ? versionRef(prev) : null,
        next: next ? versionRef(next) : null,
        reason: record.rationale,
        affectedFields: prev?.id === next?.id ? [] : slotFields(record.action),
        eligibleAt: inForceText(record),
        conflictsWith,
      },
    }),
  );
}

/** Append-only: a new record is never dated before anything already in the log. */
function appendable(history: Rule[], recordedAt: string): string | undefined {
  const last = history.reduce((m, r) => Math.max(m, ms(r.recordedAt)), Number.NEGATIVE_INFINITY);
  return ms(recordedAt) < last
    ? `recordedAt ${recordedAt} is before the latest decision in the log; never backdate`
    : undefined;
}

const nextVersion = (history: Rule[], ruleId: string): number =>
  history.filter((r) => r.ruleId === ruleId).reduce((m, r) => Math.max(m, r.version), 0) + 1;

function readText(x: Record<string, unknown>, k: string): string | undefined {
  return nonBlank(x[k]) ? (x[k] as string) : undefined;
}
function readRefs(v: unknown): string[] | undefined {
  return Array.isArray(v) && v.length > 0 && v.every(nonBlank) ? [...v] : undefined;
}

// ---------- Decisions ----------

export type FeedbackDecision = {
  status: "accepted" | "rejected";
  /** A new rule id, or an existing rule to give a new version. */
  ruleId: string;
  /** company: the feedback's own company only. global needs a separate user choice. */
  scope: { kind: "company"; sourceSignature: string } | { kind: "global"; userChoiceId: string };
  rationale: string;
  evidenceRefs: readonly string[];
  /** When the person wants it to start. Defaults to the stamp; a date before it is refused. */
  effectiveFrom?: string;
};

/** A date a caller chose must not precede the backend stamp. */
function stamped(
  recordedAt: unknown,
  effectiveFrom: unknown,
  what: string,
): Result<[string, string]> {
  const from = effectiveFrom ?? recordedAt;
  if (!isTimestamp(recordedAt))
    return err(`${what} recordedAt must be the backend's ingestion stamp, with an explicit offset`);
  if (!isTimestamp(from)) return err(`${what} effectiveFrom must be a timestamp with an offset`);
  if (ms(from) < ms(recordedAt))
    return err(`${what} is dated ${from}, before its recorded time ${recordedAt}; never backdate`);
  return ok([recordedAt, from]);
}

/**
 * Turn one feedback record into an accepted or rejected rule version. The action is the
 * feedback's proposed finite action, unchanged; free text is never applied. An accepted
 * version of an existing rule supersedes that rule's latest live version.
 */
export function decideFeedback(args: {
  history: readonly LearnedRuleVersion[];
  feedback: FeedbackRecord;
  decision: FeedbackDecision;
  /** Backend ingestion stamp of this decision (L5). Never caller-chosen. */
  recordedAt: string;
}): Result<RuleChange> {
  const snap = plainSnapshot(args, "args");
  if (!snap.ok) return snap;
  const own = (snap.value ?? {}) as Record<string, unknown>;
  const history = readHistory(own.history);
  if (!history.ok) return history;
  const fb = FeedbackRecordSchema.safeParse(own.feedback);
  if (!fb.success)
    return err(...fb.error.issues.map((i) => `feedback ${i.path.join(".")}: ${i.message}`));
  const feedback = fb.data;
  if (!feedback.proposedAction)
    return err("feedback has no finite proposed action; free text is never applied");
  const d = (own.decision ?? {}) as Record<string, unknown>;
  const status = d.status;
  if (status !== "accepted" && status !== "rejected")
    return err("decision status must be accepted or rejected");
  const ruleId = readText(d, "ruleId");
  const rationale = readText(d, "rationale");
  const evidenceRefs = readRefs(d.evidenceRefs);
  if (!ruleId || !IdSchema.safeParse(ruleId).success) return err("decision ruleId is required");
  if (!rationale) return err("decision rationale is required");
  if (!evidenceRefs) return err("decision evidenceRefs must be nonblank, at least one");
  if (d.recordedAt !== undefined)
    return err("decision recordedAt is not accepted; pass the backend stamp as recordedAt");
  const times = stamped(own.recordedAt, d.effectiveFrom, "decision");
  if (!times.ok) return times;
  const [recordedAt, effectiveFrom] = times.value;
  if (ms(recordedAt) < ms(feedback.recordedAt))
    return err("a decision cannot be recorded before the feedback it decides");
  const s = (d.scope ?? {}) as Record<string, unknown>;
  let scope: Scope;
  if (s.kind === "company" && nonBlank(s.sourceSignature))
    scope = {
      kind: "company",
      cik: feedback.cik,
      schemaVersion: 1,
      sourceSignature: s.sourceSignature,
    };
  else if (s.kind === "global" && nonBlank(s.userChoiceId))
    scope = { kind: "global", userChoiceId: s.userChoiceId };
  else
    return err(
      "decision scope must be company with a sourceSignature, or global with a userChoiceId",
    );
  const action = feedback.proposedAction;
  if (
    status === "accepted" &&
    action.kind === "method_selection" &&
    !QUARTER_METHODS.some((m) => m.methodId === action.methodId && m.version === action.version)
  )
    return err(`unknown method ${action.methodId}@${action.version}; only registered methods`);
  const log = history.value;
  if (log.some((r) => r.feedbackId === feedback.id && r.status !== "revoked"))
    return err(`feedback ${feedback.id} is already decided`);
  const late = appendable(log, recordedAt);
  if (late) return err(late);
  const chain = log.filter((r) => r.ruleId === ruleId).sort((a, b) => a.version - b.version);
  const [first] = chain;
  if (first && scopeKey(first.scope) !== scopeKey(scope))
    return err(`rule ${ruleId} has another scope; a new scope needs a new rule`);
  if (first && ruleSlot(first.action) !== ruleSlot(action))
    return err(`rule ${ruleId} controls another behavior; use a new rule`);
  const version = nextVersion(log, ruleId);
  const supersedes =
    status === "accepted" ? liveAt(chain, Number.POSITIVE_INFINITY)[0]?.id : undefined;
  const record = LearnedRuleVersionSchema.safeParse({
    id: `${ruleId}/v${version}`,
    ruleId,
    version,
    feedbackId: feedback.id,
    scope,
    action,
    rationale,
    evidenceRefs,
    status,
    ...(supersedes ? { supersedes } : {}),
    validatorVersion: RULE_VALIDATOR.version,
    recordedAt,
    effectiveFrom,
  });
  if (!record.success)
    return err(...record.error.issues.map((i) => `rule ${i.path.join(".")}: ${i.message}`));
  return change(status, log, record.data);
}

export type Revocation = {
  rationale: string;
  evidenceRefs: readonly string[];
  /** When it should start. Defaults to the stamp; a date before it is refused. */
  effectiveFrom?: string;
  /** Feedback that asked for it; defaults to the revoked version's feedback. */
  feedbackId?: string;
};

function revokeIn(
  log: Rule[],
  targetId: string,
  r: Record<string, unknown>,
  stamp: unknown,
): Result<RuleChange> {
  const target = log.find((x) => x.id === targetId);
  if (!target) return err(`rule version ${targetId} is not in the log`);
  if (target.status !== "accepted") return err(`rule version ${targetId} is not accepted`);
  if (log.some((x) => x.revokes === targetId)) return err(`${targetId} is already revoked`);
  const rationale = readText(r, "rationale");
  const evidenceRefs = readRefs(r.evidenceRefs);
  if (!rationale) return err("revocation rationale is required");
  if (!evidenceRefs) return err("revocation evidenceRefs must be nonblank, at least one");
  if (r.recordedAt !== undefined)
    return err("revocation recordedAt is not accepted; pass the backend stamp as recordedAt");
  const times = stamped(stamp, r.effectiveFrom, "revocation");
  if (!times.ok) return times;
  const [recordedAt, effectiveFrom] = times.value;
  const feedbackId = r.feedbackId ?? target.feedbackId;
  if (!nonBlank(feedbackId)) return err("revocation feedbackId must be nonblank");
  const late = appendable(log, recordedAt);
  if (late) return err(late);
  const version = nextVersion(log, target.ruleId);
  const record = LearnedRuleVersionSchema.safeParse({
    id: `${target.ruleId}/v${version}`,
    ruleId: target.ruleId,
    version,
    feedbackId,
    scope: target.scope,
    action: target.action,
    rationale,
    evidenceRefs,
    status: "revoked",
    revokes: target.id,
    validatorVersion: RULE_VALIDATOR.version,
    recordedAt,
    effectiveFrom,
  });
  if (!record.success)
    return err(...record.error.issues.map((i) => `revocation ${i.path.join(".")}: ${i.message}`));
  return change("revoked", log, record.data);
}

/** Revoke one accepted version with a NEW record. The revoked record itself is unchanged. */
export function revokeRuleVersion(args: {
  history: readonly LearnedRuleVersion[];
  targetId: string;
  revocation: Revocation;
  /** Backend ingestion stamp of this revocation (L5). Never caller-chosen. */
  recordedAt: string;
}): Result<RuleChange> {
  const snap = plainSnapshot(args, "args");
  if (!snap.ok) return snap;
  const own = (snap.value ?? {}) as Record<string, unknown>;
  const history = readHistory(own.history);
  if (!history.ok) return history;
  if (!nonBlank(own.targetId)) return err("targetId is required");
  const r = (own.revocation ?? {}) as Record<string, unknown>;
  return revokeIn(history.value, own.targetId, r, own.recordedAt);
}

/**
 * Roll a rule back: revoke the version live when the revocation takes effect, so the
 * preceding live version (or no rule) applies to work with a later cutoff. Work at earlier
 * cutoffs still resolves to what it used.
 */
export function rollbackRule(args: {
  history: readonly LearnedRuleVersion[];
  ruleId: string;
  revocation: Revocation;
  /** Backend ingestion stamp of this rollback (L5). Never caller-chosen. */
  recordedAt: string;
}): Result<RuleChange> {
  const snap = plainSnapshot(args, "args");
  if (!snap.ok) return snap;
  const own = (snap.value ?? {}) as Record<string, unknown>;
  const history = readHistory(own.history);
  if (!history.ok) return history;
  const r = (own.revocation ?? {}) as Record<string, unknown>;
  if (!nonBlank(own.ruleId)) return err("ruleId is required");
  const times = stamped(own.recordedAt, r.effectiveFrom, "rollback");
  if (!times.ok) return times;
  const t = ms(times.value[1]);
  const chain = history.value.filter((x) => x.ruleId === own.ruleId);
  const live = liveAt(chain, t)[0];
  if (!live) return err(`rule ${own.ruleId} has no live version to roll back`);
  return revokeIn(history.value, live.id, r, own.recordedAt);
}

// ---------- Resolution for one task ----------

export type RuleUse =
  | "selected"
  | "previous"
  | "conflict"
  | "superseded"
  | "revoked"
  | "revocation"
  | "rejected"
  | "out_of_scope"
  | "after_cutoff"
  | "invalid_time";

export type SlotResolution =
  | {
      slot: string;
      status: "selected";
      rule: LearnedRuleVersion;
      previous: LearnedRuleVersion | null;
      application: RuleApplication;
    }
  | { slot: string; status: "blocked"; reason: string; rules: LearnedRuleVersion[] };

export type RuleResolution = {
  task: RuleTask;
  /** Sorted by slot. */
  slots: SlotResolution[];
  /** Every log record and how this task used it, sorted by id. */
  considered: { id: string; ruleId: string; use: RuleUse }[];
};

const useOf = (
  reason: "invalid_time" | "not_accepted" | "out_of_scope" | "after_cutoff",
): RuleUse => (reason === "not_accepted" ? "rejected" : reason);

function resolve(log: Rule[], task: RuleTask): RuleResolution {
  const use = new Map<string, RuleUse>();
  const heads: { head: Rule; previous: Rule | null }[] = [];
  for (const chain of chains(log).values()) {
    const live: Rule[] = [];
    for (const r of chain) {
      if (r.status === "rejected") use.set(r.id, "rejected");
      else if (r.status === "revoked") {
        // A revocation carries its target's scope, so the contract's scope check applies to it.
        const e = ruleEligibility({ ...r, status: "accepted" }, task);
        use.set(r.id, e.eligible ? "revocation" : useOf(e.reason));
      } else {
        const e = ruleEligibility(r, task);
        if (e.eligible) live.push(r);
        else use.set(r.id, useOf(e.reason));
      }
    }
    const inForceRevocations = new Set(
      chain.flatMap((r) => (use.get(r.id) === "revocation" && r.revokes ? [r.revokes] : [])),
    );
    const standing = live.filter((r) => {
      if (inForceRevocations.has(r.id)) use.set(r.id, "revoked");
      return !inForceRevocations.has(r.id);
    });
    // For an in-scope rule this is liveAt(chain, cutoff); the contract check decides scope.
    const ordered = [...standing].sort((a, b) => b.version - a.version);
    const [head, previous, ...older] = ordered;
    for (const r of older) use.set(r.id, "superseded");
    if (head) heads.push({ head, previous: previous ?? null });
    if (previous) use.set(previous.id, "previous");
  }
  const bySlot = new Map<string, { head: Rule; previous: Rule | null }[]>();
  for (const h of heads) {
    const s = ruleSlot(h.head.action);
    bySlot.set(s, [...(bySlot.get(s) ?? []), h]);
  }
  const slots: SlotResolution[] = [];
  for (const slot of [...bySlot.keys()].sort(byText)) {
    const hs = (bySlot.get(slot) ?? []).sort((a, b) => byText(a.head.id, b.head.id));
    const [only] = hs;
    if (hs.length === 1 && only) {
      use.set(only.head.id, "selected");
      slots.push({
        slot,
        status: "selected",
        rule: only.head,
        previous: only.previous,
        application: application(only.head, only.previous, slotFields(only.head.action)),
      });
    } else {
      for (const h of hs) {
        use.set(h.head.id, "conflict");
        if (h.previous) use.set(h.previous.id, "superseded");
      }
      slots.push({
        slot,
        status: "blocked",
        reason: `${hs.length} rules apply equally (${hs.map((h) => h.head.id).join(", ")}); exactly one may apply`,
        rules: hs.map((h) => h.head),
      });
    }
  }
  const considered = log
    .map((r) => ({ id: r.id, ruleId: r.ruleId, use: use.get(r.id) ?? ("superseded" as const) }))
    .sort((a, b) => byText(a.id, b.id));
  return { task, slots, considered };
}

/** The rule versions that apply to one task at its knowledge cutoff, per slot. */
export function resolveRules(
  history: readonly LearnedRuleVersion[],
  task: RuleTask,
): Result<RuleResolution> {
  const snap = plainSnapshot([history, task] as const, "args");
  if (!snap.ok) return snap;
  const log = readHistory(snap.value[0]);
  const t = readTask(snap.value[1]);
  if (!log.ok || !t.ok) return err(...(log.ok ? [] : log.errors), ...(t.ok ? [] : t.errors));
  return ok(freeze(resolve(log.value, t.value)));
}

// ---------- Applied behavior: reconciliation ----------

export type RuledReconcileArgs = Omit<ReconcileArgs, "rules"> & {
  /** The company the work is for; rule scope is checked against it. */
  cik: string;
  history?: readonly LearnedRuleVersion[];
};

export type RuledReconciliation = {
  resolution: RuleResolution;
  reconciliation: Reconciliation;
  /** Selected authority rules, each with the keys it changed against its previous version. */
  applications: RuleApplication[];
};

const keyOutcome = (k: KeyReconciliation): string =>
  JSON.stringify([k.receipt?.outcome ?? null, k.value?.cents ?? null]);
function changedKeys(a: Reconciliation, b: Reconciliation): string[] {
  const before = new Map(b.keys.map((k) => [k.keyId, keyOutcome(k)]));
  const after = new Map(a.keys.map((k) => [k.keyId, keyOutcome(k)]));
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((id) => before.get(id) !== after.get(id))
    .sort(byText);
}

/**
 * L2 reconciliation with the authority rules that apply at the cutoff. The log is resolved
 * first (versions, revocations, scope, time), then every live authority rule goes to L2,
 * which blocks a key when more than one decision applies. Each selected rule's receipt lists
 * the keys whose outcome differs from a run with its previous version instead.
 */
export function reconcileWithRules(args: RuledReconcileArgs): Result<RuledReconciliation> {
  const snap = plainSnapshot(args, "args");
  if (!snap.ok) return snap;
  const own = (snap.value ?? {}) as Record<string, unknown>;
  if (own.rules !== undefined) return err("pass the rule log as history; L3 resolves versions");
  const { cik, history, ...rest } = own;
  const log = readHistory(history);
  const task = readTask({
    cik,
    schemaVersion: 1,
    sourceSignature: own.sourceSignature,
    cutoff: own.cutoff,
  });
  if (!log.ok || !task.ok)
    return err(...(log.ok ? [] : log.errors), ...(task.ok ? [] : task.errors));
  const resolution = resolve(log.value, task.value);
  const authority = resolution.slots.filter((s) => s.slot.startsWith("authority_preference:"));
  const heads = authorityHeads(resolution);
  const run = (rules: Rule[]) =>
    reconcileSources({ ...(rest as Omit<ReconcileArgs, "rules">), rules });
  const rec = run(heads);
  if (!rec.ok) return rec;
  const applications: RuleApplication[] = [];
  for (const s of authority) {
    if (s.status !== "selected") continue;
    const alt = run([
      ...heads.filter((h) => h.id !== s.rule.id),
      ...(s.previous ? [s.previous] : []),
    ]);
    if (!alt.ok) return alt;
    applications.push(application(s.rule, s.previous, changedKeys(rec.value, alt.value)));
  }
  return ok(freeze({ resolution, reconciliation: rec.value, applications }));
}

// ---------- Applied behavior: quarterly cash method ----------

export type MethodSelection =
  | { status: "selected"; method: MethodRef; source: "default" }
  | {
      status: "selected";
      method: MethodRef;
      source: "rule";
      rule: LearnedRuleVersion;
      previous: LearnedRuleVersion | null;
    }
  | { status: "blocked"; reason: string; ruleIds: string[] };

function selectIn(resolution: RuleResolution): MethodSelection {
  const s = resolution.slots.find((x) => x.slot === QUARTER_METHOD_SLOT);
  if (!s) return { status: "selected", method: ref(QUARTER_BRIDGE_METHOD), source: "default" };
  if (s.status === "blocked")
    return { status: "blocked", reason: s.reason, ruleIds: s.rules.map((r) => r.id) };
  const a = s.rule.action;
  const method =
    a.kind === "method_selection" ? { methodId: a.methodId, version: a.version } : undefined;
  if (!method || !(isBaseline(method) || isCandidate(method)))
    return {
      status: "blocked",
      reason: `rule ${s.rule.id} selects an unregistered method; nothing falls back silently`,
      ruleIds: [s.rule.id],
    };
  return { status: "selected", method, source: "rule", rule: s.rule, previous: s.previous };
}

/** Which quarterly cash method applies at the task's cutoff. Default B; one rule may change it. */
export function selectQuarterMethod(
  history: readonly LearnedRuleVersion[],
  task: RuleTask,
): Result<MethodSelection> {
  const r = resolveRules(history, task);
  return r.ok ? ok(freeze(selectIn(r.value))) : r;
}

type MethodRun =
  | { status: "baseline"; bridge: QuarterBridge }
  | { status: "candidate"; candidate: QuarterCandidate }
  | {
      status: "ineligible";
      method: MethodRef;
      reason: CandidateIneligibleReason;
      detail: string;
    };

function runMethod(
  m: MethodRef,
  input: QuarterCandidateInput,
  authority: readonly Rule[],
): Result<MethodRun> {
  if (isBaseline(m)) {
    try {
      return ok({ status: "baseline", bridge: quarterBridge(input) });
    } catch (e) {
      const detail = engineFailure(e);
      return ok({ status: "ineligible", method: m, reason: "baseline_unavailable", detail });
    }
  }
  const c = quarterCandidate(input, authority);
  if (!c.ok) return c;
  return ok(
    c.value.status === "predicted"
      ? { status: "candidate", candidate: c.value }
      : { status: "ineligible", method: m, reason: c.value.reason, detail: c.value.detail },
  );
}
const forecastOf = (r: MethodRun): HistoricalPrediction[] =>
  r.status === "baseline"
    ? r.bridge.forecast
    : r.status === "candidate"
      ? r.candidate.forecast
      : [];

export type RuledForecast = {
  resolution: RuleResolution;
  selection: MethodSelection;
  /** Present when a rule chose the method: affected fields are forecast ids that changed. */
  application?: RuleApplication;
  outcome: MethodRun | { status: "blocked"; reason: string };
};

/** Every live authority rule at a task: selected ones and every member of a blocked slot. */
const authorityHeads = (r: RuleResolution): Rule[] =>
  r.slots
    .filter((s) => s.slot.startsWith("authority_preference:"))
    .flatMap((s) => (s.status === "selected" ? [s.rule] : s.rules));

/**
 * One quarterly forecast with the rules that apply at the input's own company, source
 * signature and knowledge cutoff. None of these is supplied separately: the company is the
 * input's, every package must be that company, and the cutoff is the forecast's, so another
 * company's or a later rule cannot reach it. A blocked slot or unregistered method gives no
 * forecast. The same authority rules reach C's own reconciliation.
 */
export function quarterForecastWithRules(args: {
  history: readonly LearnedRuleVersion[];
  input: QuarterCandidateInput;
}): Result<RuledForecast> {
  const snap = plainSnapshot(args, "args");
  if (!snap.ok) return snap;
  const own = (snap.value ?? {}) as Record<string, unknown>;
  if (own.cik !== undefined || own.sourceSignature !== undefined)
    return err("company and source signature come from the input, never separately");
  const input = (own.input ?? {}) as QuarterCandidateInput;
  const sources = (input.sources ?? {}) as Partial<QuarterCandidateInput["sources"]>;
  const packages: unknown[] = Array.isArray(sources.packages) ? sources.packages : [];
  if (
    packages.length === 0 ||
    !packages.every((p) => (p as { company?: { cik?: unknown } })?.company?.cik === input.cik)
  )
    return err("input.sources.packages must all be the input company; never mix companies");
  const log = readHistory(own.history);
  const task = readTask({
    cik: input.cik,
    schemaVersion: 1,
    sourceSignature: sources.sourceSignature,
    cutoff: input.knowledgeCutoff,
  });
  if (!log.ok || !task.ok)
    return err(...(log.ok ? [] : log.errors), ...(task.ok ? [] : task.errors));
  const resolution = resolve(log.value, task.value);
  const authority = authorityHeads(resolution);
  const selection = selectIn(resolution);
  if (selection.status === "blocked")
    return ok(
      freeze({ resolution, selection, outcome: { status: "blocked", reason: selection.reason } }),
    );
  const outcome = runMethod(selection.method, input, authority);
  if (!outcome.ok) return outcome;
  if (selection.source === "default")
    return ok(freeze({ resolution, selection, outcome: outcome.value }));
  const prevAction = selection.previous?.action;
  const prevMethod =
    prevAction?.kind === "method_selection"
      ? { methodId: prevAction.methodId, version: prevAction.version }
      : ref(QUARTER_BRIDGE_METHOD);
  const before = runMethod(prevMethod, input, authority);
  if (!before.ok) return before;
  const was = new Map(forecastOf(before.value).map((p) => [p.id, JSON.stringify(p)]));
  const changed = forecastOf(outcome.value)
    .filter((p) => was.get(p.id) !== JSON.stringify(p))
    .map((p) => `forecast.${p.id}`);
  const methodChanged =
    prevMethod.methodId !== selection.method.methodId ||
    prevMethod.version !== selection.method.version;
  return ok(
    freeze({
      resolution,
      selection,
      application: application(selection.rule, selection.previous, [
        ...(methodChanged ? ["forecast.method"] : []),
        ...changed.sort(byText),
      ]),
      outcome: outcome.value,
    }),
  );
}
