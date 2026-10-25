import {
  type CompanyKnowledgeSnapshot,
  IdSchema,
  type LearnedRuleVersion,
  LearnedRuleVersionSchema,
  type MappingReceipt,
  type NormalizedObservation,
  type ObservationKey,
  ObservationKeySchema,
  type ReconciliationReceipt,
  ReconciliationReceiptSchema,
  type SourcePackage,
  SourcePackageSchema,
  TimestampSchema,
  observationKeyId,
  ruleEligibility,
} from "@domino/contracts";
import { type MappedSource, type Result, mapSecRecords } from "./source-normalization";

/**
 * L2 source evidence reconciliation. Pure and synchronous: no network, clock, AI or
 * randomness. Every caller-owned input is copied once at entry as plain JSON data (anything
 * else is rejected), before any validation, and only that private copy is read afterwards.
 *
 * Candidates are L1 normalized observations, re-derived here from validated packages with
 * mapSecRecords, never taken from the caller. Values are compared only inside one
 * ObservationKey. The evidence origin of a candidate is its filing accession: the same
 * accession seen through several packages or URLs (for example byte-identical payloads) is
 * one origin, never several votes. Agreement across distinct accessions is corroboration.
 * Values must match in exact cents: companyfacts carries no XBRL decimals, so no rounding
 * precision can be authenticated. Any difference is a conflict that blocks the key unless
 * exactly one applicable, dated authority rule or accepted user resolution selects one
 * value. Nothing is averaged, majority-voted or preferred for being retrieved later. Every
 * result is sorted by content, so input order cannot change it.
 */

export const SOURCE_RECONCILER = { methodId: "source-reconciliation", version: "1.0.0" } as const;

type Filing = SourcePackage["accessions"][number];
type BlockReason = Extract<
  CompanyKnowledgeSnapshot["roles"][number],
  { status: "blocked" }
>["reason"];

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const err = <T>(...errors: string[]): Result<T> => ({ ok: false, errors });
const ms = (t: string): number => Date.parse(t);
const isTimestamp = (t: unknown): t is string =>
  typeof t === "string" && TimestampSchema.safeParse(t).success;
const nonBlank = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0;
/** Code-unit order: never locale-dependent. */
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sortedUnique = (xs: Iterable<string>): string[] => [...new Set(xs)].sort(byText);
const big = (n: number): bigint => BigInt(n);
const safe = (n: bigint): boolean =>
  n >= big(Number.MIN_SAFE_INTEGER) && n <= big(Number.MAX_SAFE_INTEGER);
/** The instant with the latest time; equal instants tie-break on text, so order is irrelevant. */
const latestOf = (ts: readonly string[]): string =>
  [...ts].sort((a, b) => ms(b) - ms(a) || byText(a, b))[0] as string;
const periodLabel = (p: ObservationKey["period"]): string =>
  p.kind === "instant" ? p.date : `${p.start}..${p.end}`;
/** Raised only inside snapshot and always caught there. */
class NotPlainData extends Error {}

/**
 * Recursive copy that is also the plain-JSON check: null, booleans, finite numbers, strings,
 * arrays and objects whose prototype is Object.prototype or null. Anything else anywhere in
 * the tree (class instances, Date, BigInt, Map/Set, typed arrays, functions, symbols,
 * non-finite numbers, cycles, hidden or symbol keys, array holes) is rejected, including in
 * fields L2 otherwise ignores. Each property is read exactly once, here.
 */
function plainCopy(v: unknown, path: string, ancestors: Set<object>): unknown {
  if (v === null || typeof v === "boolean" || typeof v === "string") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new NotPlainData(`${path} is a non-finite number`);
    return v;
  }
  if (typeof v !== "object") throw new NotPlainData(`${path} is a ${typeof v}, not JSON data`);
  if (ancestors.has(v)) throw new NotPlainData(`${path} is a cycle`);
  const proto = Object.getPrototypeOf(v);
  const isArray = Array.isArray(v);
  if (isArray ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
    throw new NotPlainData(`${path} is not a plain object or array`);
  if (Object.getOwnPropertySymbols(v).length > 0) throw new NotPlainData(`${path} has symbol keys`);
  const keys = Object.keys(v);
  // Hidden (non-enumerable) own properties are state JSON would drop; arrays add only length.
  if (Object.getOwnPropertyNames(v).length !== keys.length + (isArray ? 1 : 0))
    throw new NotPlainData(`${path} has non-enumerable properties`);
  ancestors.add(v);
  try {
    if (isArray) {
      const items = v as unknown[];
      const n = items.length;
      if (keys.length !== n) throw new NotPlainData(`${path} has holes or extra keys`);
      const out: unknown[] = [];
      for (let i = 0; i < n; i++) out.push(plainCopy(items[i], `${path}[${i}]`, ancestors));
      return out;
    }
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      if (k === "__proto__") throw new NotPlainData(`${path} has a __proto__ key`);
      const x = (v as Record<string, unknown>)[k];
      // An undefined property is absent, as in JSON.
      if (x !== undefined) out[k] = plainCopy(x, `${path}.${k}`, ancestors);
    }
    return out;
  } finally {
    ancestors.delete(v);
  }
}

/**
 * One private plain-JSON copy of caller input, taken before any validation; only it is read
 * afterwards. The declared type is not trusted: the copy is validated field by field later.
 */
function snapshot<T>(input: T, name: string): Result<T> {
  try {
    return ok(plainCopy(input, name, new Set()) as T);
  } catch (e) {
    if (e instanceof NotPlainData) return err(`input is not plain JSON data: ${e.message}`);
    throw e;
  }
}

// ---------- Inputs ----------

/** A person's choice between conflicting candidates of one key. Only accepted ones apply. */
export type ConflictResolution = {
  id: string;
  userId: string;
  status: "accepted" | "rejected";
  key: ObservationKey;
  /** Exactly the eligible candidates the person compared; a changed set makes it stale. */
  consideredIds: readonly string[];
  selectedIds: readonly string[];
  recordedAt: string;
  effectiveFrom: string;
};

export type ReconcileArgs = {
  /** Prefix for receipt ids. */
  id: string;
  /** Knowledge cutoff. Filings accepted after it are excluded, amendments included. */
  cutoff: string;
  /** Computation instant recorded on deterministic receipts. Supplied: there is no clock. */
  computedAt: string;
  /** Source signature used to scope authority rules. */
  sourceSignature: string;
  packages: readonly SourcePackage[];
  /** Learned rule versions; only applicable authority_preference rules are used. */
  rules?: readonly LearnedRuleVersion[];
  resolutions?: readonly ConflictResolution[];
};

// ---------- Outputs ----------

/** One eligible candidate with its full lineage. */
export type Candidate = {
  observationId: string;
  sourcePackageId: string;
  /** SHA-256 of the package's raw companyfacts bytes. */
  sourceHash: string;
  originalUrl: string;
  recordId: string;
  pointer: string;
  mappingReceiptId: string;
  accession: string;
  form: Filing["form"];
  amends?: string;
  rawValue: string;
  cents: number;
  availableAt: string;
};

/** A candidate kept for lineage but not compared, with the reason. */
export type ExcludedCandidate = {
  /** Observation id, or mapping receipt id when L1 produced no observation. */
  id: string;
  sourcePackageId: string;
  accession: string;
  availableAt: string;
  reason: "after_cutoff" | "needs_input" | "unsafe_value" | "rejected";
  detail: string;
};

/**
 * A usable value in exact cents. availableAt is the latest source availability; eligibleAt
 * adds any decision's times, so it is never earlier than availableAt.
 */
export type ReconciledValue = {
  key: ObservationKey;
  cents: number;
  availableAt: string;
  eligibleAt: string;
  receiptIds: string[];
  observationIds: string[];
};

export type KeyReconciliation = {
  keyId: string;
  key: ObservationKey;
  candidates: Candidate[];
  excluded: ExcludedCandidate[];
  /** Absent only when no candidate is eligible; a receipt never cites a post-cutoff fact. */
  receipt?: ReconciliationReceipt;
  /** Present exactly when the receipt selected a value. */
  value?: ReconciledValue;
};

export type Reconciliation = { id: string; cutoff: string; keys: KeyReconciliation[] };

export type KeyOutcome =
  | { status: "selected"; value: ReconciledValue }
  | { status: "blocked"; reason: BlockReason; detail: string };

// ---------- Input validation (copy once) ----------

const filingSignature = (cik: string, f: Filing): string =>
  JSON.stringify([
    cik,
    f.accession,
    f.form,
    f.acceptedAt,
    periodLabel(f.reportPeriod),
    f.amends ?? null,
  ]);

function readRules(input: unknown): Result<LearnedRuleVersion[]> {
  if (input === undefined) return ok([]);
  if (!Array.isArray(input)) return err("rules must be an array");
  const out: LearnedRuleVersion[] = [];
  const errors: string[] = [];
  for (const [i, r] of [...input].entries()) {
    const p = LearnedRuleVersionSchema.safeParse(r);
    if (!p.success)
      errors.push(...p.error.issues.map((x) => `rules ${i} ${x.path.join(".")}: ${x.message}`));
    else out.push(p.data);
  }
  const ids = out.map((r) => r.id);
  if (new Set(ids).size !== ids.length) errors.push("rules: duplicate rule version id");
  return errors.length ? err(...errors) : ok(out);
}

type Resolution = Omit<ConflictResolution, "consideredIds" | "selectedIds"> & {
  keyId: string;
  consideredIds: string[];
  selectedIds: string[];
};

function readResolutions(input: unknown): Result<Resolution[]> {
  if (input === undefined) return ok([]);
  if (!Array.isArray(input)) return err("resolutions must be an array");
  const out: Resolution[] = [];
  const errors: string[] = [];
  const ids = (v: unknown): string[] | undefined =>
    Array.isArray(v) && v.every((x) => IdSchema.safeParse(x).success) ? [...v] : undefined;
  for (const [i, r] of [...input].entries()) {
    const key = ObservationKeySchema.safeParse(r?.key);
    const considered = ids(r?.consideredIds);
    const selected = ids(r?.selectedIds);
    const at = `resolutions ${i}`;
    if (!IdSchema.safeParse(r?.id).success || !IdSchema.safeParse(r?.userId).success)
      errors.push(`${at}: id and userId are required`);
    else if (r.status !== "accepted" && r.status !== "rejected")
      errors.push(`${at}: status must be accepted or rejected`);
    else if (!key.success) errors.push(`${at}: key is not a valid ObservationKey`);
    else if (!considered || new Set(considered).size !== considered.length)
      errors.push(`${at}: consideredIds must be distinct ids`);
    else if (!selected || selected.length === 0 || new Set(selected).size !== selected.length)
      errors.push(`${at}: selectedIds must be distinct ids, at least one`);
    else if (!isTimestamp(r.recordedAt) || !isTimestamp(r.effectiveFrom))
      errors.push(`${at}: recordedAt and effectiveFrom must be timestamps with offsets`);
    else
      out.push({
        id: r.id,
        userId: r.userId,
        status: r.status,
        key: key.data,
        keyId: observationKeyId(key.data),
        consideredIds: sortedUnique(considered),
        selectedIds: sortedUnique(selected),
        recordedAt: r.recordedAt,
        effectiveFrom: r.effectiveFrom,
      });
  }
  const all = out.map((r) => r.id);
  if (new Set(all).size !== all.length) errors.push("resolutions: duplicate resolution id");
  return errors.length ? err(...errors) : ok(out);
}

// ---------- Classification ----------

type Group = { key: ObservationKey; candidates: Candidate[]; excluded: ExcludedCandidate[] };
type Authority = Extract<ReconciliationReceipt["outcome"], { kind: "selected" }>["authority"];
type Decision =
  | {
      kind: "selected";
      classification: ReconciliationReceipt["classification"];
      selected: Candidate[];
      authority: Authority;
      recordedAt?: string;
      effectiveFrom?: string;
      note: string;
    }
  | { kind: "blocked"; reason: string; note: string };

const distinctCents = (cs: readonly Candidate[]): bigint[] =>
  [...new Set(cs.map((c) => big(c.cents)))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const originsOf = (cs: readonly Candidate[]): string[] => sortedUnique(cs.map((c) => c.accession));
const describe = (cs: readonly Candidate[]): string =>
  originsOf(cs)
    .map((a) => {
      const vals = sortedUnique(cs.filter((c) => c.accession === a).map((c) => String(c.cents)));
      return `${a}=${vals.join("|")}`;
    })
    .join(", ");
const DETERMINISTIC: Authority = { kind: "deterministic_method", ...SOURCE_RECONCILER };

type Ctx = {
  cutoff: string;
  sourceSignature: string;
  rules: LearnedRuleVersion[];
  resolutions: Resolution[];
};

function resolveConflict(keyId: string, key: ObservationKey, cs: Candidate[], ctx: Ctx): Decision {
  const candidateIds = cs.map((c) => c.observationId);
  const notes: string[] = [];
  const rules = ctx.rules
    .filter((r) => r.action.kind === "authority_preference" && r.action.metric === key.metric)
    .sort((a, b) => byText(a.id, b.id));
  const applicableRules = rules.filter((r) => {
    const e = ruleEligibility(r, {
      cik: key.cik,
      schemaVersion: 1,
      sourceSignature: ctx.sourceSignature,
      cutoff: ctx.cutoff,
    });
    if (!e.eligible) notes.push(`rule ${r.id} not applied: ${e.reason}`);
    return e.eligible;
  });
  const cutoff = ms(ctx.cutoff);
  const applicableResolutions = ctx.resolutions
    .filter((r) => r.keyId === keyId)
    .sort((a, b) => byText(a.id, b.id))
    .filter((r) => {
      const why =
        r.status !== "accepted"
          ? "not accepted"
          : ms(r.effectiveFrom) < ms(r.recordedAt)
            ? "effective before it was recorded"
            : Math.max(ms(r.recordedAt), ms(r.effectiveFrom)) > cutoff
              ? "after_cutoff"
              : JSON.stringify(r.consideredIds) !== JSON.stringify(candidateIds)
                ? "stale: it considered a different candidate set"
                : undefined;
      if (why) notes.push(`resolution ${r.id} not applied: ${why}`);
      return why === undefined;
    });
  const values = distinctCents(cs).join(" vs ");
  const base = `conflict: ${cs.length} candidates from ${originsOf(cs).length} origins disagree (${describe(cs)}; values ${values})`;
  const note = [base, ...notes].join("; ");
  const decisions = applicableRules.length + applicableResolutions.length;
  if (decisions === 0)
    return {
      kind: "blocked",
      reason: "unresolved conflict between eligible same-key values",
      note,
    };
  if (decisions > 1)
    return {
      kind: "blocked",
      reason: `${decisions} applicable decisions (${[...applicableRules, ...applicableResolutions]
        .map((d) => d.id)
        .join(", ")}); exactly one must apply`,
      note,
    };
  const single = (picked: Candidate[]): boolean =>
    picked.length > 0 && distinctCents(picked).length === 1;
  const [rule] = applicableRules;
  if (rule && rule.action.kind === "authority_preference") {
    let picked: Candidate[];
    if (rule.action.prefer === "original_filing") picked = cs.filter((c) => !c.amends);
    else {
      const amendments = cs.filter((c) => c.amends);
      const last = amendments.length ? latestOf(amendments.map((c) => c.availableAt)) : "";
      picked = amendments.filter((c) => ms(c.availableAt) === ms(last));
    }
    if (!single(picked))
      return {
        kind: "blocked",
        reason: `authority rule ${rule.id} (${rule.action.prefer}) does not select one value`,
        note,
      };
    return {
      kind: "selected",
      classification: "conflict",
      selected: picked,
      authority: { kind: "authority_rule", ruleVersionId: rule.id },
      recordedAt: rule.recordedAt,
      effectiveFrom: rule.effectiveFrom,
      note: `${note}; selected by authority rule ${rule.id} (${rule.action.prefer})`,
    };
  }
  const [res] = applicableResolutions;
  if (!res) return { kind: "blocked", reason: "no decision", note };
  const picked = cs.filter((c) => res.selectedIds.includes(c.observationId));
  if (picked.length !== res.selectedIds.length || !single(picked))
    return {
      kind: "blocked",
      reason: `resolution ${res.id} does not select candidates sharing one value`,
      note,
    };
  return {
    kind: "selected",
    classification: "conflict",
    selected: picked,
    authority: { kind: "user_resolution", userId: res.userId },
    recordedAt: res.recordedAt,
    effectiveFrom: res.effectiveFrom,
    note: `${note}; selected by accepted user resolution ${res.id}`,
  };
}

function decide(keyId: string, g: Group, ctx: Ctx): Decision {
  const cs = g.candidates;
  const origins = originsOf(cs);
  if (distinctCents(cs).length === 1) {
    const classification =
      cs.length === 1 ? "single" : origins.length === 1 ? "duplicate" : "corroborated";
    const note =
      classification === "single"
        ? `single candidate from ${describe(cs)}`
        : classification === "duplicate"
          ? `${cs.length} copies of one evidence origin (${describe(cs)}); one origin is one vote`
          : `${origins.length} distinct origins agree (${describe(cs)})`;
    return { kind: "selected", classification, selected: cs, authority: DETERMINISTIC, note };
  }
  return resolveConflict(keyId, g.key, cs, ctx);
}

function buildKey(
  runId: string,
  keyId: string,
  g: Group,
  computedAt: string,
  ctx: Ctx,
): Result<KeyReconciliation> {
  const candidates = [...g.candidates].sort((a, b) => byText(a.observationId, b.observationId));
  const excluded = [...g.excluded].sort((a, b) => byText(a.id, b.id));
  const out: KeyReconciliation = { keyId, key: g.key, candidates, excluded };
  if (candidates.length === 0) return ok(out);
  const d = decide(keyId, { ...g, candidates }, ctx);
  const sourceAvailableAt = latestOf(candidates.map((c) => c.availableAt));
  const lineage = excluded.length
    ? `; not compared: ${excluded.map((e) => `${e.id} (${e.reason})`).join(", ")}`
    : "";
  const common = {
    id: `${runId}/rec/${keyId}`,
    key: g.key,
    candidateIds: candidates.map((c) => c.observationId),
    rationale: `${d.note}${lineage}`,
    sourceAvailableAt,
  };
  const receipt =
    d.kind === "blocked"
      ? {
          ...common,
          classification: "conflict" as const,
          outcome: { kind: "blocked" as const, reason: d.reason },
          recordedAt: computedAt,
          effectiveFrom: sourceAvailableAt,
          eligibleAt: sourceAvailableAt,
        }
      : {
          ...common,
          classification: d.classification,
          outcome: {
            kind: "selected" as const,
            selectedIds: d.selected.map((c) => c.observationId),
            authority: d.authority,
          },
          recordedAt: d.recordedAt ?? computedAt,
          effectiveFrom: d.effectiveFrom ?? sourceAvailableAt,
          eligibleAt:
            d.recordedAt && d.effectiveFrom
              ? latestOf([sourceAvailableAt, d.recordedAt, d.effectiveFrom])
              : sourceAvailableAt,
        };
  const parsed = ReconciliationReceiptSchema.safeParse(receipt);
  if (!parsed.success)
    return err(
      ...parsed.error.issues.map((i) => `receipt ${keyId} ${i.path.join(".")}: ${i.message}`),
    );
  out.receipt = parsed.data;
  if (d.kind === "selected") {
    const [first] = d.selected;
    if (!first) return err(`receipt ${keyId}: nothing selected`);
    out.value = {
      key: g.key,
      cents: first.cents,
      availableAt: sourceAvailableAt,
      eligibleAt: parsed.data.eligibleAt,
      receiptIds: [parsed.data.id],
      observationIds: d.selected.map((c) => c.observationId),
    };
  }
  return ok(out);
}

// ---------- Entry point ----------

/**
 * Reconcile every ObservationKey found in the packages at a knowledge cutoff. Errors only for
 * malformed or mutually inconsistent inputs; a conflict is a blocked receipt, not an error.
 * Packages must come from L1's authenticated intake (readSecSource); L2 adds no authentication.
 */
export function reconcileSources(args: ReconcileArgs): Result<Reconciliation> {
  const snap = snapshot(args, "args");
  if (!snap.ok) return snap;
  const own: Record<string, unknown> = snap.value ?? {};
  const { id, cutoff, computedAt, sourceSignature } = own;
  const packagesIn = own.packages;
  if (own.roundings !== undefined)
    return err("rounding disclosures are not supported: values must match in exact cents");
  if (!IdSchema.safeParse(id).success || !nonBlank(id)) return err("id is required");
  if (!isTimestamp(cutoff) || !isTimestamp(computedAt))
    return err("cutoff and computedAt must be timestamps with explicit offsets");
  if (!nonBlank(sourceSignature)) return err("sourceSignature is required");
  if (!Array.isArray(packagesIn) || packagesIn.length === 0)
    return err("at least one source package is required");

  const errors: string[] = [];
  const packages: SourcePackage[] = [];
  for (const [i, p] of packagesIn.entries()) {
    const parsed = SourcePackageSchema.safeParse(p);
    if (!parsed.success)
      errors.push(
        ...parsed.error.issues.map((x) => `package ${i} ${x.path.join(".")}: ${x.message}`),
      );
    else packages.push(parsed.data);
  }
  if (errors.length) return err(...errors);
  const pkgIds = packages.map((p) => p.id);
  if (new Set(pkgIds).size !== pkgIds.length) return err("duplicate source package id");

  // One accession, one set of filing metadata, across every package.
  const filings = new Map<string, Filing>();
  const signatures = new Map<string, string>();
  for (const p of packages)
    for (const f of p.accessions) {
      const s = filingSignature(p.company.cik, f);
      const seen = signatures.get(f.accession);
      if (seen !== undefined && seen !== s)
        errors.push(`accession ${f.accession} has inconsistent filing metadata across packages`);
      signatures.set(f.accession, s);
      filings.set(f.accession, f);
    }
  if (errors.length) return err(...sortedUnique(errors));

  const rules = readRules(own.rules);
  const resolutions = readResolutions(own.resolutions);
  if (!rules.ok || !resolutions.ok)
    return err(...[rules, resolutions].flatMap((r) => (r.ok ? [] : r.errors)));

  const cut = ms(cutoff);
  const groups = new Map<string, Group>();
  const group = (key: ObservationKey): Group => {
    const k = observationKeyId(key);
    let g = groups.get(k);
    if (!g) {
      g = { key, candidates: [], excluded: [] };
      groups.set(k, g);
    }
    return g;
  };
  for (const pkg of packages) {
    let mapped: MappedSource;
    try {
      mapped = mapSecRecords(pkg);
    } catch (e) {
      return err(
        `package ${pkg.id}: mapping failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const records = new Map(pkg.records.map((r) => [r.id, r]));
    const observations = new Map<string, NormalizedObservation>(
      mapped.observations.map((o) => [o.mappingReceiptId, o]),
    );
    for (const receipt of mapped.receipts) {
      const record = records.get(receipt.recordId);
      const filing = record && filings.get(record.accession);
      if (!record || !filing)
        return err(`package ${pkg.id}: receipt ${receipt.id} lost its record`);
      const obs = observations.get(receipt.id);
      const g = group(receipt.key);
      const late = ms(filing.acceptedAt) > cut;
      if (obs && !late) {
        g.candidates.push({
          observationId: obs.id,
          sourcePackageId: pkg.id,
          sourceHash: pkg.rawContentHash,
          originalUrl: pkg.originalUrl,
          recordId: record.id,
          pointer: record.pointer,
          mappingReceiptId: receipt.id,
          accession: obs.accession,
          form: filing.form,
          ...(filing.amends ? { amends: filing.amends } : {}),
          rawValue: obs.rawValue,
          cents: obs.cents,
          availableAt: obs.availableAt,
        });
      } else g.excluded.push(exclusion(pkg.id, receipt, filing, obs, late));
    }
  }

  const ctx: Ctx = {
    cutoff,
    sourceSignature,
    rules: rules.value,
    resolutions: resolutions.value,
  };
  const keys: KeyReconciliation[] = [];
  for (const keyId of [...groups.keys()].sort(byText)) {
    const g = groups.get(keyId) as Group;
    const built = buildKey(id, keyId, g, computedAt, ctx);
    if (!built.ok) return built;
    keys.push(built.value);
  }
  return ok({ id, cutoff, keys });
}

function exclusion(
  pkgId: string,
  receipt: MappingReceipt,
  filing: Filing,
  obs: NormalizedObservation | undefined,
  late: boolean,
): ExcludedCandidate {
  const base = {
    id: obs?.id ?? receipt.id,
    sourcePackageId: pkgId,
    accession: filing.accession,
    availableAt: filing.acceptedAt,
  };
  if (late)
    return {
      ...base,
      reason: "after_cutoff",
      detail: `${filing.form} ${filing.accession} accepted ${filing.acceptedAt}, after the cutoff`,
    };
  const detail = receipt.validationErrors.join("; ");
  if (receipt.status === "needs_input")
    return { ...base, reason: "needs_input", detail: receipt.question ?? detail };
  if (receipt.validationErrors.some((e) => e.startsWith("unsafe")))
    return { ...base, reason: "unsafe_value", detail };
  return { ...base, reason: "rejected", detail };
}

// ---------- Lookups and arithmetic ----------

/** The outcome for one key. A blocked or missing key blocks only what uses it. */
export function valueFor(rec: Reconciliation, key: ObservationKey): KeyOutcome {
  const keyId = observationKeyId(key);
  const k = rec.keys.find((x) => x.keyId === keyId);
  const label = `${key.metric} ${key.definition} ${periodLabel(key.period)}`;
  if (!k)
    return { status: "blocked", reason: "missing_input", detail: `no candidate for ${label}` };
  if (k.value) return { status: "selected", value: k.value };
  if (k.receipt?.outcome.kind === "blocked")
    return {
      status: "blocked",
      reason: "unresolved_conflict",
      detail: `${label}: ${k.receipt.outcome.reason}`,
    };
  const timely = k.excluded.filter((e) => e.reason !== "after_cutoff");
  const first = (r: ExcludedCandidate["reason"]) => timely.find((e) => e.reason === r);
  const needs = first("needs_input");
  if (needs) return { status: "blocked", reason: "needs_input", detail: needs.detail };
  const unsafe = first("unsafe_value");
  if (unsafe) return { status: "blocked", reason: "unsafe_value", detail: unsafe.detail };
  const rejected = first("rejected");
  if (rejected) return { status: "blocked", reason: "missing_input", detail: rejected.detail };
  return {
    status: "blocked",
    reason: "after_cutoff",
    detail: `${label} is only in filings accepted after the cutoff (${sortedUnique(
      k.excluded.map((e) => e.accession),
    ).join(", ")})`,
  };
}

/** Validates one value from an already private snapshot and rebuilds it field by field. */
function readValue(v: unknown, name: string): Result<ReconciledValue> {
  const x = v as ReconciledValue | undefined;
  const key = ObservationKeySchema.safeParse(x?.key);
  if (!key.success) return err(`${name}: key is not a valid ObservationKey`);
  if (!Number.isSafeInteger(x?.cents)) return err(`${name}: cents must be safe integer cents`);
  if (!isTimestamp(x?.availableAt) || !isTimestamp(x?.eligibleAt))
    return err(`${name}: availableAt and eligibleAt must be timestamps`);
  if (ms(x.eligibleAt) < ms(x.availableAt))
    return err(`${name}: eligibleAt is before availableAt; eligibility cannot precede the source`);
  const ids = (a: unknown): a is string[] =>
    Array.isArray(a) && a.length > 0 && a.every((s) => nonBlank(s));
  if (!ids(x?.receiptIds) || !ids(x?.observationIds))
    return err(`${name}: receipt and observation lineage is required`);
  const value = x as ReconciledValue;
  return ok({
    key: key.data,
    cents: value.cents,
    availableAt: value.availableAt,
    eligibleAt: value.eligibleAt,
    receiptIds: [...value.receiptIds],
    observationIds: [...value.observationIds],
  });
}

const nextDay = (date: string): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Latest of every input's availability and eligibility: a derived value waits for all. */
const gate = (vs: readonly ReconciledValue[]) => ({
  availableAt: latestOf(vs.map((v) => v.availableAt)),
  eligibleAt: latestOf(vs.flatMap((v) => [v.availableAt, v.eligibleAt])),
});

/**
 * Quarter (or any later sub-period) flow from two cumulative flows: ytd minus prior, in exact
 * cents. Both must share company, scope, currency, metric, definition and start, and prior
 * must end first. The result keeps both lineages and the latest availability/eligibility.
 */
export function quarterFlow(ytd: ReconciledValue, prior: ReconciledValue): Result<ReconciledValue> {
  const snap = snapshot([ytd, prior] as const, "values");
  if (!snap.ok) return snap;
  const a = readValue(snap.value[0], "ytd");
  const b = readValue(snap.value[1], "prior");
  if (!a.ok || !b.ok) return err(...(a.ok ? [] : a.errors), ...(b.ok ? [] : b.errors));
  const x = a.value;
  const y = b.value;
  const kx = x.key;
  const ky = y.key;
  if (kx.period.kind !== "duration" || ky.period.kind !== "duration")
    return err("YTD subtraction needs two flow durations");
  const problems: string[] = [];
  if (kx.cik !== ky.cik) problems.push("different companies");
  if (kx.scope !== ky.scope) problems.push("different scopes");
  if (kx.currency !== ky.currency) problems.push("different currencies");
  if (kx.metric !== ky.metric || kx.definition !== ky.definition)
    problems.push(`incompatible definitions (${kx.definition} vs ${ky.definition})`);
  if (kx.period.start !== ky.period.start)
    problems.push(`different starts (${kx.period.start} vs ${ky.period.start})`);
  if (!(ky.period.end < kx.period.end))
    problems.push("prior period must end before the ytd period");
  if (problems.length) return err(`incompatible YTD subtraction: ${problems.join("; ")}`);
  const cents = big(x.cents) - big(y.cents);
  if (!safe(cents)) return err("YTD difference is outside safe integer cents");
  const key = ObservationKeySchema.safeParse({
    ...kx,
    period: { kind: "duration", start: nextDay(ky.period.end), end: kx.period.end },
  });
  if (!key.success) return err("derived period is invalid");
  return ok({
    key: key.data,
    cents: Number(cents),
    ...gate([x, y]),
    receiptIds: [...x.receiptIds, ...y.receiptIds],
    observationIds: [...x.observationIds, ...y.observationIds],
  });
}

export const CASH_TERMS = [
  "beginning",
  "operating",
  "investing",
  "financing",
  "fx",
  "ending",
] as const;
export type CashTerm = (typeof CASH_TERMS)[number];
const TERM_METRIC: Record<CashTerm, ObservationKey["metric"]> = {
  beginning: "cash_including_restricted",
  operating: "operating_cash_flow",
  investing: "investing_cash_flow",
  financing: "financing_cash_flow",
  fx: "fx_effect_on_cash",
  ending: "cash_including_restricted",
};

export type CashIdentity =
  | { status: "blocked"; blocked: { term: CashTerm; reason: BlockReason; detail: string }[] }
  | {
      status: "ties" | "breaks";
      /** beginning + operating + investing + financing + fx, in cents. */
      computedEndingCents: string;
      reportedEndingCents: string;
      /** computed - reported; ties exactly when 0. */
      differenceCents: string;
      receiptIds: string[];
      availableAt: string;
      eligibleAt: string;
    };

/**
 * beginning combined cash + OCF + ICF + FCF + FX = ending combined cash, for one company,
 * scope and currency, with every flow covering exactly the day after beginning through
 * ending, in exact cents. A blocked or missing term blocks the identity; it is never zero.
 */
export function cashIdentity(terms: Readonly<Record<CashTerm, KeyOutcome>>): Result<CashIdentity> {
  const snap = snapshot(terms, "terms");
  if (!snap.ok) return snap;
  const own: Partial<Record<CashTerm, KeyOutcome>> = snap.value ?? {};
  const given = CASH_TERMS.map((t) => [t, own[t]] as const);
  const missing = given.filter(([, o]) => !o).map(([t]) => t);
  if (missing.length) return err(`missing cash identity terms: ${missing.join(", ")}`);
  const blocked = given.flatMap(([term, o]) =>
    o?.status === "blocked" ? [{ term, reason: o.reason, detail: o.detail }] : [],
  );
  if (blocked.length) return ok({ status: "blocked", blocked });
  const values = {} as Record<CashTerm, ReconciledValue>;
  for (const [term, o] of given) {
    const v = readValue(o?.status === "selected" ? o.value : undefined, term);
    if (!v.ok) return v;
    values[term] = v.value;
  }
  const { beginning, ending } = values;
  if (beginning.key.period.kind !== "instant" || ending.key.period.kind !== "instant")
    return err("beginning and ending cash must be instants");
  const start = nextDay(beginning.key.period.date);
  const end = ending.key.period.date;
  if (!(beginning.key.period.date < end)) return err("beginning must be before ending");
  const problems: string[] = [];
  for (const term of CASH_TERMS) {
    const k = values[term].key;
    if (k.metric !== TERM_METRIC[term]) problems.push(`${term} must be ${TERM_METRIC[term]}`);
    if (k.cik !== beginning.key.cik) problems.push(`${term} is another company`);
    if (k.scope !== beginning.key.scope) problems.push(`${term} has another scope`);
    if (k.currency !== beginning.key.currency) problems.push(`${term} has another currency`);
    if (term !== "beginning" && term !== "ending") {
      const p = k.period;
      if (p.kind !== "duration" || p.start !== start || p.end !== end)
        problems.push(`${term} must cover ${start}..${end}, got ${periodLabel(p)}`);
    }
  }
  if (problems.length) return err(`incompatible cash identity: ${problems.join("; ")}`);
  const computed = (["beginning", "operating", "investing", "financing", "fx"] as const).reduce(
    (s, t) => s + big(values[t].cents),
    0n,
  );
  const diff = computed - big(ending.cents);
  return ok({
    status: diff === 0n ? "ties" : "breaks",
    computedEndingCents: String(computed),
    reportedEndingCents: String(ending.cents),
    differenceCents: String(diff),
    receiptIds: sortedUnique(CASH_TERMS.flatMap((t) => values[t].receiptIds)),
    ...gate(CASH_TERMS.map((t) => values[t])),
  });
}

/** Why two keys are not comparable, in plain terms; "same" means compare their values. */
export type KeyDifference =
  | "same"
  | "company"
  | "currency"
  | "scope"
  | "definition"
  | "period"
  | "timing";

/**
 * company/currency/scope: different subjects. definition: another metric or dictionary
 * definition (total vs usable cash). period: another span with the same end, or a
 * balance vs a flow (YTD vs quarter). timing: the same kind of period at another date.
 */
export function keyDifference(a: ObservationKey, b: ObservationKey): KeyDifference {
  if (a.cik !== b.cik) return "company";
  if (a.currency !== b.currency) return "currency";
  if (a.scope !== b.scope) return "scope";
  if (a.metric !== b.metric || a.definition !== b.definition) return "definition";
  const pa = a.period;
  const pb = b.period;
  if (pa.kind === "instant" && pb.kind === "instant")
    return pa.date === pb.date ? "same" : "timing";
  if (pa.kind === "duration" && pb.kind === "duration") {
    if (pa.start !== pb.start) return "period";
    return pa.end === pb.end ? "same" : "timing";
  }
  return "period";
}
