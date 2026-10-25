import {
  CikSchema,
  type HistoricalAssumption,
  HistoricalCaseSchema,
  type HistoricalFact,
  type HistoricalPrediction,
  type LearnedRuleVersion,
  type ObservationKey,
  ObservationKeySchema,
  type SourcePackage,
  TimestampSchema,
  observationKeyId,
} from "@domino/contracts";
import { addDays, daysBetween } from "./dates";
import { type Ratio, addRatio, ratio, roundCents } from "./money";
import {
  QUARTER_BRIDGE_METHOD,
  type QuarterBridge,
  type QuarterBridgeInput,
  type RunInputs,
  quarterBridge,
} from "./period";
import { type QuarterRole, type Result, SEC_CASH_DICTIONARY } from "./source-normalization";
import {
  type ConflictResolution,
  type KeyOutcome,
  type ReconciledValue,
  type Reconciliation,
  quarterFlow,
  reconcileSources,
  valueFor,
} from "./source-reconciliation";

/**
 * Candidate C of forecast-evaluation-protocol-v1, a retrospective experimental method.
 * Pure and synchronous: no network, clock, AI or randomness. Caller input is copied once
 * at entry as plain JSON data; only that private copy is read afterwards.
 *
 * C accepts no flow values from the caller. It reconciles the forecast company's packages
 * itself (L2 reconcileSources at the knowledge cutoff), reads both YTD flows under the
 * frozen L1 dictionary definitions for that company, and requires B's own YTD facts to be
 * exactly those reconciled source rows (same accession, pointer, period and cents). Packages
 * must come from L1's authenticated intake (readSecSource), the same trust root as L2.
 *
 * Identical to baseline B (quarterly_cash_bridge 0.1.0) in cash definitions, origin,
 * target, financing/FX assumptions, held-flat restricted cash and the origin-to-cutoff
 * nowcast, which is B's own output, unchanged. Only the post-cutoff interval differs: its
 * OCF and ICF per quarter are the latest fully reported comparable single quarter known at
 * the cutoff, the quarter ending at the origin balance date:
 *   first quarter: that YTD itself; later quarters: YTD minus the compatible preceding YTD
 *   (same company, scope, currency, metric, definition and start), via L2 quarterFlow.
 * With D = target-quarter days, e = origin-to-cutoff days, Bq = B's quarterly net change
 * and Cq = last-quarter OCF + ICF plus the same financing/FX assumptions:
 *   target combined cash = origin combined cash + Bq*e/D + Cq*(D-e)/D,
 * exact rationals rounded once per range end; usable = rounded combined - origin
 * restricted. No weights, hyperparameters or company exceptions. A missing predecessor,
 * blocked value or definition mismatch makes the pair ineligible; nothing becomes zero.
 */
export const QUARTER_CANDIDATE_METHOD = {
  id: "quarterly_cash_last_quarter",
  version: "0.1.0",
  /** Chosen today on development data; never a historical human decision. */
  experimental: "retrospective",
  baseline: QUARTER_BRIDGE_METHOD,
} as const;

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const err = <T>(...errors: string[]): Result<T> => ({ ok: false, errors });
const ms = (t: string): number => Date.parse(t);
const big = (n: number): bigint => BigInt(n);
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sortedUnique = (xs: Iterable<string>): string[] => [...new Set(xs)].sort(byText);
const isTimestamp = (t: unknown): t is string =>
  typeof t === "string" && TimestampSchema.safeParse(t).success;

// ---------- One plain copy of caller input (mirrors L2's boundary) ----------

/** Our own rejection: the message lives in CopyState, the thrown value is never read. */
const NOT_PLAIN: unique symbol = Symbol("not plain data");
type CopyState = { ancestors: Set<object>; done: Map<object, unknown>; problem?: string };
function reject(st: CopyState, message: string): never {
  st.problem = message;
  throw NOT_PLAIN;
}

/**
 * Recursive copy that is also the plain-JSON check: null, booleans, finite numbers, strings,
 * arrays and objects whose prototype is Object.prototype or null. Anything else anywhere
 * (class instances, Date, BigInt, Map/Set, typed arrays, functions, symbols, non-finite
 * numbers, cycles, hidden or symbol keys, array holes) is rejected. Each property is read
 * exactly once per call: a shared object reuses its finished copy, cycles are rejected.
 */
function plainCopy(v: unknown, path: string, st: CopyState): unknown {
  if (v === null || typeof v === "boolean" || typeof v === "string") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) reject(st, `${path} is a non-finite number`);
    return v;
  }
  if (typeof v !== "object") reject(st, `${path} is a ${typeof v}, not JSON data`);
  const o = v as object;
  if (st.ancestors.has(o)) reject(st, `${path} is a cycle`);
  if (st.done.has(o)) return st.done.get(o);
  const proto = Object.getPrototypeOf(o);
  const isArray = Array.isArray(o);
  if (isArray ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
    reject(st, `${path} is not a plain object or array`);
  if (Object.getOwnPropertySymbols(o).length > 0) reject(st, `${path} has symbol keys`);
  const keys = Object.keys(o);
  if (Object.getOwnPropertyNames(o).length !== keys.length + (isArray ? 1 : 0))
    reject(st, `${path} has non-enumerable properties`);
  st.ancestors.add(o);
  try {
    if (isArray) {
      const items = o as unknown[];
      const n = items.length;
      if (keys.length !== n) reject(st, `${path} has holes or extra keys`);
      const out: unknown[] = [];
      for (let i = 0; i < n; i++) out.push(plainCopy(items[i], `${path}[${i}]`, st));
      st.done.set(o, out);
      return out;
    }
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      if (k === "__proto__") reject(st, `${path} has a __proto__ key`);
      const x = (o as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = plainCopy(x, `${path}.${k}`, st);
    }
    st.done.set(o, out);
    return out;
  } finally {
    st.ancestors.delete(o);
  }
}

/**
 * One private plain-JSON copy of caller input, taken before any validation. Pass every
 * argument of an entry point in one call so references shared between them are read once.
 * Whatever caller code throws (a getter, a proxy trap, even a revoked proxy) is mapped to a
 * fixed error: the caught value is never inspected, compared by type or stringified.
 */
export function plainSnapshot<T>(input: T, name: string): Result<T> {
  const st: CopyState = { ancestors: new Set(), done: new Map() };
  try {
    return ok(plainCopy(input, name, st) as T);
  } catch {
    return st.problem !== undefined
      ? err(`input is not plain JSON data: ${st.problem}`)
      : err(`${name} could not be read: caller code threw while it was copied`);
  }
}

/**
 * Run engine code on a private plain copy. Engine failures are Errors we created; the
 * message is read defensively and anything unexpected becomes a fixed text.
 */
export function engineFailure(e: unknown): string {
  try {
    return e instanceof Error && typeof e.message === "string" ? e.message : "engine failure";
  } catch {
    return "engine failure";
  }
}

// ---------- Types ----------

/** Where C reads its flow histories. Never values: L2 runs on these packages here. */
export type CandidateSources = {
  /** The forecast company's packages from L1's authenticated intake (readSecSource). */
  packages: readonly SourcePackage[];
  sourceSignature: string;
  /** L2 run id prefix and computation instant (supplied: there is no clock). */
  reconciliationId: string;
  computedAt: string;
  /** Dated user conflict decisions; L2 applies only those eligible at the cutoff. */
  resolutions?: readonly ConflictResolution[];
};

export type QuarterCandidateInput = QuarterBridgeInput & {
  /** The forecast company. Every package must be this company. */
  cik: string;
  sources: CandidateSources;
};

export type CandidateIneligibleReason =
  | "baseline_unavailable"
  | "missing_predecessor"
  | "definition_conflict"
  | "unresolved_conflict"
  | "needs_input"
  | "unsafe_value"
  | "after_cutoff"
  | "missing_input";

export type CandidateIneligible = {
  status: "ineligible";
  method: typeof QUARTER_CANDIDATE_METHOD;
  reason: CandidateIneligibleReason;
  detail: string;
};

/** One derived single-quarter flow with its full lineage. */
export type DerivedQuarterFlow = {
  key: ObservationKey;
  cents: number;
  derivation: string;
  ytdCents: number;
  /** Absent only for a first quarter, where the YTD is the quarter. */
  priorCents?: number;
  receiptIds: string[];
  observationIds: string[];
  availableAt: string;
  eligibleAt: string;
};

/** An exact rational as reduced "num/den" text, before the single rounding. */
export type ExactBand = { low: string; mid: string; high: string };

export type QuarterCandidate = {
  status: "predicted";
  method: typeof QUARTER_CANDIDATE_METHOD;
  /** B on the same input; its nowcast is reused as is. */
  baseline: QuarterBridge;
  targetDate: string;
  /** D */
  quarterDays: number;
  /** e */
  cutoffDays: number;
  /** Same case inputs as B; L2 lineage is in lastQuarter and the id lists. */
  inputs: RunInputs;
  /** The same objects as baseline.nowcast. */
  nowcast: HistoricalPrediction[];
  forecast: HistoricalPrediction[];
  lastQuarter: { operating: DerivedQuarterFlow; investing: DerivedQuarterFlow };
  /** The L2 run C performed; every receipt id below belongs to it. */
  reconciliationId: string;
  exact: { baselineQuarter: ExactBand; candidateQuarter: ExactBand; targetTotal: ExactBand };
  resolutionIds: string[];
  observationIds: string[];
};

// ---------- Exact arithmetic ----------

type Band = { low: Ratio; mid: Ratio; high: Ratio };
const times = (r: Ratio, num: number, den: number): Ratio => ({
  num: r.num * BigInt(num),
  den: r.den * BigInt(den),
});
const point = (r: Ratio): Band => ({ low: r, mid: r, high: r });
const addBand = (a: Band, b: Band): Band => ({
  low: addRatio(a.low, b.low),
  mid: addRatio(a.mid, b.mid),
  high: addRatio(a.high, b.high),
});
const band = (a: HistoricalAssumption): Band => ({
  low: ratio(a.value.low),
  mid: ratio(big(a.value.low) + big(a.value.high), 2),
  high: ratio(a.value.high),
});
const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
};
const fraction = (r: Ratio): string => {
  const sign = r.den < 0n ? -1n : 1n;
  const g = gcd(r.num, r.den) || 1n;
  return `${(sign * r.num) / g}/${(sign * r.den) / g}`;
};
const exactBand = (b: Band): ExactBand => ({
  low: fraction(b.low),
  mid: fraction(b.mid),
  high: fraction(b.high),
});

// ---------- Flow histories, derived here ----------

type Read<T> =
  | { kind: "value"; value: T }
  | { kind: "ineligible"; reason: CandidateIneligibleReason; detail: string }
  | { kind: "error"; errors: string[] };
const ineligibleRead = (reason: CandidateIneligibleReason, detail: string): Read<never> => ({
  kind: "ineligible",
  reason,
  detail,
});

/** The frozen L1 dictionary definition for a role: never chosen by the caller. */
function definitionOf(role: QuarterRole): string | undefined {
  const tags = [...SEC_CASH_DICTIONARY].filter(([, e]) => e.use === "direct" && e.role === role);
  const [only] = tags;
  return tags.length === 1 && only ? `us-gaap:${only[0]}@1` : undefined;
}

/** L2's outcome for one key; a blocked key makes the pair ineligible, never zero. */
function outcomeOf(
  rec: Reconciliation,
  key: ObservationKey,
  name: string,
  missing: CandidateIneligibleReason,
): Read<ReconciledValue> {
  const o: KeyOutcome = valueFor(rec, key);
  if (o.status === "selected") return { kind: "value", value: o.value };
  const reason = o.reason === "missing_input" ? missing : o.reason;
  return ineligibleRead(reason, `${name} is blocked (${o.reason}): ${o.detail}`);
}

/**
 * B's YTD fact must be a reported fact for exactly a selected source row of the reconciled
 * key: L1's fact shape names the row by sourceId "source/<accession>" and locator = pointer.
 */
function boundToSource(rec: Reconciliation, key: ObservationKey, f: HistoricalFact): boolean {
  if (f.kind !== "reported" || f.currency !== key.currency) return false;
  const k = rec.keys.find((x) => x.keyId === observationKeyId(key));
  const outcome = k?.receipt?.outcome;
  if (!k?.value || outcome?.kind !== "selected" || f.cents !== k.value.cents) return false;
  return k.candidates.some(
    (c) =>
      outcome.selectedIds.includes(c.observationId) &&
      f.sourceId === `source/${c.accession}` &&
      f.locator === c.pointer &&
      c.cents === f.cents,
  );
}

const MONTHS = ["three", "six", "nine", "twelve"] as const;
/** First day of the calendar quarter whose last day is the origin (a month end). */
const quarterStart = (origin: string): string => {
  const m = Number(origin.slice(0, 4)) * 12 + Number(origin.slice(5, 7)) - 1 - 2;
  return `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}-01`;
};
const dayBefore = (date: string): string => addDays(date, -1);

/** The single quarter ending at the origin for one flow, derived from the reconciliation. */
function lastQuarterOf(
  rec: Reconciliation,
  cik: string,
  name: "operating" | "investing",
  ytdFact: HistoricalFact,
  quarters: number,
  origin: string,
  cutoff: string,
): Read<DerivedQuarterFlow> {
  const metric = name === "operating" ? "operating_cash_flow" : "investing_cash_flow";
  const definition = definitionOf(name === "operating" ? "operating_ytd" : "investing_ytd");
  if (!definition) return { kind: "error", errors: [`no frozen dictionary tag for ${name}`] };
  if (ytdFact.period.kind !== "duration")
    return { kind: "error", errors: [`baseline ${name} YTD fact is not a duration`] };
  const { start } = ytdFact.period;
  const keyFor = (end: string) =>
    ObservationKeySchema.safeParse({
      cik,
      scope: "consolidated",
      metric,
      definition,
      currency: "USD",
      period: { kind: "duration", start, end },
    });
  const ytdKey = keyFor(origin);
  if (!ytdKey.success) return { kind: "error", errors: [`${name} YTD key is invalid`] };
  const ytd = outcomeOf(rec, ytdKey.data, `${name} YTD`, "missing_input");
  if (ytd.kind !== "value") return ytd;
  const y = ytd.value;
  if (ytdFact.metric !== metric || !boundToSource(rec, ytdKey.data, ytdFact))
    return ineligibleRead(
      "definition_conflict",
      `baseline fact ${ytdFact.id} is not a selected ${definition} row of company ${cik} for ${start}..${origin}`,
    );
  if (ms(y.eligibleAt) > ms(cutoff))
    return ineligibleRead(
      "after_cutoff",
      `${name} YTD is eligible ${y.eligibleAt}, after the cutoff`,
    );
  const span = MONTHS[quarters - 1] ?? `${quarters * 3}`;
  if (quarters === 1)
    return {
      kind: "value",
      value: {
        key: y.key,
        cents: y.cents,
        derivation: "three-month YTD is the quarter",
        ytdCents: y.cents,
        receiptIds: sortedUnique(y.receiptIds),
        observationIds: sortedUnique(y.observationIds),
        availableAt: y.availableAt,
        eligibleAt: y.eligibleAt,
      },
    };
  const priorKey = keyFor(dayBefore(quarterStart(origin)));
  if (!priorKey.success) return { kind: "error", errors: [`${name} predecessor key is invalid`] };
  const prior = outcomeOf(rec, priorKey.data, `${name} preceding YTD`, "missing_predecessor");
  if (prior.kind !== "value") return prior;
  const p = prior.value;
  if (ms(p.eligibleAt) > ms(cutoff))
    return ineligibleRead(
      "after_cutoff",
      `${name} preceding YTD is eligible ${p.eligibleAt}, after the cutoff`,
    );
  const q = quarterFlow(y, p);
  if (!q.ok)
    return ineligibleRead(
      q.errors.some((e) => e.includes("outside safe")) ? "unsafe_value" : "definition_conflict",
      `${name}: ${q.errors.join("; ")}`,
    );
  const period = q.value.key.period;
  if (period.kind !== "duration" || period.start !== quarterStart(origin) || period.end !== origin)
    return ineligibleRead(
      "definition_conflict",
      `${name}: derived period is not the origin quarter`,
    );
  return {
    kind: "value",
    value: {
      key: q.value.key,
      cents: q.value.cents,
      derivation: `${span}-month YTD minus ${MONTHS[quarters - 2]}-month YTD`,
      ytdCents: y.cents,
      priorCents: p.cents,
      receiptIds: sortedUnique(q.value.receiptIds),
      observationIds: sortedUnique(q.value.observationIds),
      availableAt: q.value.availableAt,
      eligibleAt: q.value.eligibleAt,
    },
  };
}

function prediction(
  id: string,
  metric: HistoricalPrediction["metric"],
  date: string,
  currency: string,
  c: { low: number; mid: number; high: number },
): HistoricalPrediction {
  const p: HistoricalPrediction = {
    id,
    kind: "forecast",
    metric,
    period: { kind: "instant", date },
    currency,
    cents: c.mid,
  };
  return c.low === c.high ? p : { ...p, range: { low: c.low, high: c.high } };
}

// ---------- Entry point ----------

/**
 * Candidate C for one planned pair. Errors only for malformed input; a pair that fails
 * eligibility (B failing, a missing or blocked predecessor, B's facts not being the
 * company's reconciled rows, a value eligible after the cutoff) is ineligible, with no
 * prediction. authorityRules are L3's resolved authority rule versions for this cutoff;
 * L2 still checks each one's scope and time, and blocks when more than one applies.
 */
export function quarterCandidate(
  input: QuarterCandidateInput,
  authorityRules: readonly LearnedRuleVersion[] = [],
): Result<QuarterCandidate | CandidateIneligible> {
  const snap = plainSnapshot([input, authorityRules] as const, "input");
  if (!snap.ok) return snap;
  const own = (snap.value[0] ?? {}) as Partial<QuarterCandidateInput> & Record<string, unknown>;
  const rules = snap.value[1];
  const ineligible = (reason: CandidateIneligibleReason, detail: string) =>
    ok<CandidateIneligible>({
      status: "ineligible",
      method: QUARTER_CANDIDATE_METHOD,
      reason,
      detail,
    });
  if (typeof own !== "object" || own === null || Array.isArray(own))
    return err("input must be an object");
  if (own.lastQuarter !== undefined)
    return err("flow values are not accepted; C derives them from the company's packages");
  if (!isTimestamp(own.knowledgeCutoff))
    return err("knowledgeCutoff must be a timestamp with an explicit offset");
  const cik = own.cik;
  if (!CikSchema.safeParse(cik).success) return err("cik must be a ten-digit CIK");
  const src = (own.sources ?? {}) as Partial<CandidateSources> & Record<string, unknown>;
  if (typeof src !== "object" || src === null) return err("sources are required");
  if (src.rules !== undefined) return err("authority rules come from L3 resolution, not sources");
  if (!Array.isArray(src.packages) || src.packages.length === 0)
    return err("sources.packages must list the company's packages");
  const companies = src.packages.map((p) => (p as { company?: { cik?: unknown } })?.company?.cik);
  if (!companies.every((x) => x === cik))
    return err(`every package must be company ${cik}; never mix companies`);
  if (!Array.isArray(rules)) return err("authorityRules must be an array");

  let baseline: QuarterBridge;
  try {
    baseline = quarterBridge(own as QuarterBridgeInput);
  } catch (e) {
    return ineligible("baseline_unavailable", engineFailure(e));
  }
  const parsed = HistoricalCaseSchema.safeParse(own.case);
  if (!parsed.success)
    return ineligible("baseline_unavailable", "case is not a valid HistoricalCase");
  const c = parsed.data;
  const fact = (id: unknown) => c.facts.find((f) => f.id === id) as HistoricalFact;
  const assumption = (id: unknown) =>
    c.assumptions.find((a) => a.id === id) as HistoricalAssumption;
  const origin = own.originBalanceDate as string;
  const cutoff = own.knowledgeCutoff as string;
  const n = baseline.elapsedQuarters;
  if (c.currency !== "USD") return ineligible("definition_conflict", "case currency is not USD");

  const rec = reconcileSources({
    id: src.reconciliationId as string,
    cutoff,
    computedAt: src.computedAt as string,
    sourceSignature: src.sourceSignature as string,
    packages: src.packages as SourcePackage[],
    ...(src.resolutions !== undefined ? { resolutions: src.resolutions } : {}),
    rules: [...rules],
  });
  if (!rec.ok) return rec;

  const derived: Partial<Record<"operating" | "investing", DerivedQuarterFlow>> = {};
  for (const [name, factId] of [
    ["operating", own.operatingYtdFactId],
    ["investing", own.investingYtdFactId],
  ] as const) {
    const r = lastQuarterOf(rec.value, cik as string, name, fact(factId), n, origin, cutoff);
    if (r.kind === "error") return err(...r.errors);
    if (r.kind === "ineligible") return ineligible(r.reason, r.detail);
    derived[name] = r.value;
  }
  const { operating, investing } = derived as Record<"operating" | "investing", DerivedQuarterFlow>;

  // Exact: total(x) = T0 + Bq(x)*e/D + Cq(x)*(D-e)/D for x in low/mid/high; round once.
  const D = baseline.quarterDays;
  const e = daysBetween(origin, cutoff.slice(0, 10));
  const total = fact(own.totalCashFactId);
  const usable = fact(own.usableCashFactId);
  const ocf = fact(own.operatingYtdFactId);
  const icf = fact(own.investingYtdFactId);
  const financingFx = addBand(
    band(assumption(own.financingAssumptionId)),
    band(assumption(own.fxAssumptionId)),
  );
  const bq = addBand(point(ratio(big(ocf.cents) + big(icf.cents), n)), financingFx);
  const cq = addBand(point(ratio(big(operating.cents) + big(investing.cents))), financingFx);
  const exactTotal = addBand(
    point(ratio(total.cents)),
    addBand(
      { low: times(bq.low, e, D), mid: times(bq.mid, e, D), high: times(bq.high, e, D) },
      {
        low: times(cq.low, D - e, D),
        mid: times(cq.mid, D - e, D),
        high: times(cq.high, D - e, D),
      },
    ),
  );
  const rounded = {
    low: roundCents(exactTotal.low),
    mid: roundCents(exactTotal.mid),
    high: roundCents(exactTotal.high),
  };
  const restricted = big(total.cents) - big(usable.cents);
  const usableBand = {
    low: Number(big(rounded.low) - restricted),
    mid: Number(big(rounded.mid) - restricted),
    high: Number(big(rounded.high) - restricted),
  };
  if (![...Object.values(rounded), ...Object.values(usableBand)].every(Number.isSafeInteger))
    return ineligible("unsafe_value", "candidate target is outside safe integer cents");
  if (!(rounded.low <= rounded.mid && rounded.mid <= rounded.high))
    return err("candidate range does not contain its point");

  const targetDate = baseline.targetDate;
  const cur = c.currency;
  // Guard: B's target is the quarter end after the origin, D days later.
  if (addDays(origin, D) !== targetDate) return err("baseline target is not D days after origin");
  return ok({
    status: "predicted",
    method: QUARTER_CANDIDATE_METHOD,
    baseline,
    targetDate,
    quarterDays: D,
    cutoffDays: e,
    inputs: baseline.inputs,
    nowcast: baseline.nowcast,
    forecast: [
      prediction("target_total", "cash_including_restricted", targetDate, cur, rounded),
      prediction("target_usable", "cash_and_equivalents", targetDate, cur, usableBand),
    ],
    lastQuarter: { operating, investing },
    reconciliationId: rec.value.id,
    exact: {
      baselineQuarter: exactBand(bq),
      candidateQuarter: exactBand(cq),
      targetTotal: exactBand(exactTotal),
    },
    resolutionIds: sortedUnique([...operating.receiptIds, ...investing.receiptIds]),
    observationIds: sortedUnique([...operating.observationIds, ...investing.observationIds]),
  });
}
