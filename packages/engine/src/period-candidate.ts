import {
  type HistoricalAssumption,
  HistoricalCaseSchema,
  type HistoricalFact,
  type HistoricalPrediction,
  type ObservationKey,
  ObservationKeySchema,
  TimestampSchema,
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
import type { Result } from "./source-normalization";
import { type KeyOutcome, type ReconciledValue, quarterFlow } from "./source-reconciliation";

/**
 * Candidate C of forecast-evaluation-protocol-v1, a retrospective experimental method.
 * Pure and synchronous: no network, clock, AI or randomness. Caller input is copied once
 * at entry as plain JSON data; only that private copy is read afterwards.
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
const nonBlank = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0;
const isTimestamp = (t: unknown): t is string =>
  typeof t === "string" && TimestampSchema.safeParse(t).success;

// ---------- One plain copy of caller input (mirrors L2's boundary) ----------

class NotPlainData extends Error {}
type CopyState = { ancestors: Set<object>; done: Map<object, unknown> };

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
    if (!Number.isFinite(v)) throw new NotPlainData(`${path} is a non-finite number`);
    return v;
  }
  if (typeof v !== "object") throw new NotPlainData(`${path} is a ${typeof v}, not JSON data`);
  if (st.ancestors.has(v)) throw new NotPlainData(`${path} is a cycle`);
  if (st.done.has(v)) return st.done.get(v);
  const proto = Object.getPrototypeOf(v);
  const isArray = Array.isArray(v);
  if (isArray ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
    throw new NotPlainData(`${path} is not a plain object or array`);
  if (Object.getOwnPropertySymbols(v).length > 0) throw new NotPlainData(`${path} has symbol keys`);
  const keys = Object.keys(v);
  if (Object.getOwnPropertyNames(v).length !== keys.length + (isArray ? 1 : 0))
    throw new NotPlainData(`${path} has non-enumerable properties`);
  st.ancestors.add(v);
  try {
    if (isArray) {
      const items = v as unknown[];
      const n = items.length;
      if (keys.length !== n) throw new NotPlainData(`${path} has holes or extra keys`);
      const out: unknown[] = [];
      for (let i = 0; i < n; i++) out.push(plainCopy(items[i], `${path}[${i}]`, st));
      st.done.set(v, out);
      return out;
    }
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      if (k === "__proto__") throw new NotPlainData(`${path} has a __proto__ key`);
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = plainCopy(x, `${path}.${k}`, st);
    }
    st.done.set(v, out);
    return out;
  } finally {
    st.ancestors.delete(v);
  }
}

/**
 * One private plain-JSON copy of caller input, taken before any validation. Pass every
 * argument of an entry point in one call so references shared between them are read once.
 */
export function plainSnapshot<T>(input: T, name: string): Result<T> {
  try {
    return ok(plainCopy(input, name, { ancestors: new Set(), done: new Map() }) as T);
  } catch (e) {
    if (e instanceof NotPlainData) return err(`input is not plain JSON data: ${e.message}`);
    // A throwing getter or proxy trap is bad input too: report it, never rethrow.
    return err(`input could not be read: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ---------- Types ----------

/** L2 outcomes for one flow: the YTD B uses and, after a first quarter, its predecessor. */
export type LastQuarterFlow = { ytd: KeyOutcome; prior?: KeyOutcome };

export type QuarterCandidateInput = QuarterBridgeInput & {
  lastQuarter: { operating: LastQuarterFlow; investing: LastQuarterFlow };
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

// ---------- Input readers (private copy only) ----------

const BLOCK_REASONS = new Set([
  "missing_input",
  "needs_input",
  "unresolved_conflict",
  "after_cutoff",
  "unsafe_value",
]);

type Read<T> =
  | { kind: "value"; value: T }
  | { kind: "ineligible"; reason: CandidateIneligibleReason; detail: string }
  | { kind: "error"; errors: string[] };

/** Validates one L2 value from the private copy and rebuilds it field by field. */
function readValue(v: unknown, name: string): Read<ReconciledValue> {
  const x = v as Partial<ReconciledValue> | undefined;
  const bad = (m: string): Read<ReconciledValue> => ({ kind: "error", errors: [`${name}: ${m}`] });
  const key = ObservationKeySchema.safeParse(x?.key);
  if (!key.success) return bad("key is not a valid ObservationKey");
  if (!Number.isSafeInteger(x?.cents)) return bad("cents must be safe integer cents");
  if (!isTimestamp(x?.availableAt) || !isTimestamp(x?.eligibleAt))
    return bad("availableAt and eligibleAt must be timestamps");
  if (ms(x.eligibleAt) < ms(x.availableAt))
    return bad("eligibleAt is before availableAt; eligibility cannot precede the source");
  const ids = (a: unknown): a is string[] =>
    Array.isArray(a) && a.length > 0 && a.every((s) => nonBlank(s));
  if (!ids(x?.receiptIds) || !ids(x?.observationIds))
    return bad("receipt and observation lineage is required");
  return {
    kind: "value",
    value: {
      key: key.data,
      cents: x.cents as number,
      availableAt: x.availableAt,
      eligibleAt: x.eligibleAt,
      receiptIds: [...x.receiptIds],
      observationIds: [...x.observationIds],
    },
  };
}

/** A selected outcome is read as a value; a blocked one makes the pair ineligible. */
function readOutcome(
  o: unknown,
  name: string,
  missing: CandidateIneligibleReason,
): Read<ReconciledValue> {
  const x = o as { status?: unknown; value?: unknown; reason?: unknown; detail?: unknown };
  if (x?.status === "selected") return readValue(x.value, name);
  if (x?.status === "blocked" && typeof x.reason === "string" && BLOCK_REASONS.has(x.reason)) {
    const reason = x.reason === "missing_input" ? missing : (x.reason as CandidateIneligibleReason);
    const detail = typeof x.detail === "string" ? x.detail : "";
    return { kind: "ineligible", reason, detail: `${name} is blocked: ${detail}` };
  }
  return { kind: "error", errors: [`${name} must be an L2 selected or blocked outcome`] };
}

const samePeriod = (a: ObservationKey["period"], b: HistoricalFact["period"]): boolean =>
  a.kind === "duration" && b.kind === "duration" && a.start === b.start && a.end === b.end;

const MONTHS = ["three", "six", "nine", "twelve"] as const;
/** First day of the calendar quarter whose last day is the origin (a month end). */
const quarterStart = (origin: string): string => {
  const m = Number(origin.slice(0, 4)) * 12 + Number(origin.slice(5, 7)) - 1 - 2;
  return `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}-01`;
};

/** The single quarter ending at the origin for one flow, or why the pair is ineligible. */
function lastQuarterOf(
  name: "operating" | "investing",
  flow: unknown,
  ytdFact: HistoricalFact,
  quarters: number,
  origin: string,
  cutoff: string,
): Read<DerivedQuarterFlow> {
  const f = flow as { ytd?: unknown; prior?: unknown } | undefined;
  if (typeof f !== "object" || f === null || f.ytd === undefined)
    return { kind: "error", errors: [`lastQuarter.${name}.ytd is required`] };
  const ytd = readOutcome(f.ytd, `${name} YTD`, "missing_input");
  if (ytd.kind !== "value") return ytd;
  const y = ytd.value;
  const ineligible = (reason: CandidateIneligibleReason, detail: string): Read<never> => ({
    kind: "ineligible",
    reason,
    detail,
  });
  // The L2 value must be the very YTD fact B uses: same metric, currency, span and cents.
  if (
    y.key.metric !== ytdFact.metric ||
    y.key.currency !== ytdFact.currency ||
    !samePeriod(y.key.period, ytdFact.period) ||
    y.cents !== ytdFact.cents
  )
    return ineligible(
      "definition_conflict",
      `${name} YTD value ${y.cents} for ${y.key.metric} differs from baseline fact ${ytdFact.id} (${ytdFact.cents})`,
    );
  if (ms(y.eligibleAt) > ms(cutoff))
    return ineligible("after_cutoff", `${name} YTD is eligible ${y.eligibleAt}, after the cutoff`);
  const span = MONTHS[quarters - 1] ?? `${quarters * 3}`;
  if (quarters === 1) {
    if (f.prior !== undefined)
      return ineligible(
        "definition_conflict",
        `${name}: a three-month YTD is itself the quarter; a predecessor does not apply`,
      );
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
  }
  if (f.prior === undefined)
    return ineligible(
      "missing_predecessor",
      `${name}: no preceding YTD for the ${span}-month YTD; never assumed zero`,
    );
  const prior = readOutcome(f.prior, `${name} preceding YTD`, "missing_predecessor");
  if (prior.kind !== "value") return prior;
  const p = prior.value;
  if (ms(p.eligibleAt) > ms(cutoff))
    return ineligible(
      "after_cutoff",
      `${name} preceding YTD is eligible ${p.eligibleAt}, after the cutoff`,
    );
  const q = quarterFlow(y, p);
  if (!q.ok)
    return ineligible(
      q.errors.some((e) => e.includes("outside safe")) ? "unsafe_value" : "definition_conflict",
      `${name}: ${q.errors.join("; ")}`,
    );
  const period = q.value.key.period;
  const start = quarterStart(origin);
  if (period.kind !== "duration" || period.start !== start || period.end !== origin)
    return ineligible(
      "definition_conflict",
      `${name}: YTD minus predecessor covers ${period.kind === "duration" ? `${period.start}..${period.end}` : "an instant"}, not the single quarter ${start}..${origin}`,
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
 * eligibility (B failing, a missing or blocked predecessor, a definition mismatch, a value
 * eligible after the cutoff) is an ineligible outcome with no prediction.
 */
export function quarterCandidate(
  input: QuarterCandidateInput,
): Result<QuarterCandidate | CandidateIneligible> {
  const snap = plainSnapshot(input, "input");
  if (!snap.ok) return snap;
  const own = (snap.value ?? {}) as Partial<QuarterCandidateInput>;
  const ineligible = (reason: CandidateIneligibleReason, detail: string) =>
    ok<CandidateIneligible>({
      status: "ineligible",
      method: QUARTER_CANDIDATE_METHOD,
      reason,
      detail,
    });
  if (!isTimestamp(own.knowledgeCutoff))
    return err("knowledgeCutoff must be a timestamp with an explicit offset");
  const lq = own.lastQuarter as unknown;
  if (typeof lq !== "object" || lq === null)
    return err("lastQuarter with operating and investing outcomes is required");

  let baseline: QuarterBridge;
  try {
    baseline = quarterBridge(own as QuarterBridgeInput);
  } catch (e) {
    return ineligible("baseline_unavailable", e instanceof Error ? e.message : String(e));
  }
  // B parsed the same private copy successfully, so these lookups exist and are valid.
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

  const flows = lq as Record<string, unknown>;
  const derived: Partial<Record<"operating" | "investing", DerivedQuarterFlow>> = {};
  for (const [name, factId] of [
    ["operating", own.operatingYtdFactId],
    ["investing", own.investingYtdFactId],
  ] as const) {
    const r = lastQuarterOf(name, flows[name], fact(factId), n, origin, cutoff);
    if (r.kind === "error") return err(...r.errors);
    if (r.kind === "ineligible") return ineligible(r.reason, r.detail);
    derived[name] = r.value;
  }
  const { operating, investing } = derived as Record<"operating" | "investing", DerivedQuarterFlow>;
  if (operating.key.cik !== investing.key.cik)
    return ineligible(
      "definition_conflict",
      "operating and investing flows are different companies",
    );

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
    exact: {
      baselineQuarter: exactBand(bq),
      candidateQuarter: exactBand(cq),
      targetTotal: exactBand(exactTotal),
    },
    resolutionIds: sortedUnique([...operating.receiptIds, ...investing.receiptIds]),
    observationIds: sortedUnique([...operating.observationIds, ...investing.observationIds]),
  });
}
