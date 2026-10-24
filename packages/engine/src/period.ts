import {
  type Cents,
  type HistoricalAssumption,
  type HistoricalCase,
  HistoricalCaseSchema,
  type HistoricalComparison,
  HistoricalComparisonContextSchema,
  type HistoricalFact,
  type HistoricalMetric,
  type HistoricalPrediction,
  type HistoricalRun,
  type ISODate,
  type Timestamp,
} from "@domino/contracts";
import { addDays, daysBetween, daysInMonth, toMs } from "./dates";
import { type Ratio, addRatio, ratio, roundCents } from "./money";

/**
 * Historical quarterly cash bridge. One target quarter: the quarter after a reported
 * quarter-end origin balance. Pure: no clock, network or randomness.
 *
 * Method assumptions (stated, not evidenced):
 * - Operating and investing flow per quarter = comparable YTD flow / elapsed quarters.
 * - Financing and FX have no default: each needs an explicit cents-per-quarter assumption.
 * - Flows land uniformly per day across the target quarter.
 * - Flows move cash including restricted (what the cash flow statement reconciles);
 *   restricted cash stays at its origin amount, so usable = total - origin restricted.
 * - Point value = midpoint of each assumption range; range = all lows / all highs.
 */
export const QUARTER_BRIDGE_METHOD = { id: "quarterly_cash_bridge", version: "0.1.0" } as const;

export type QuarterBridgeInput = {
  case: HistoricalCase;
  knowledgeCutoff: Timestamp;
  originBalanceDate: ISODate;
  usableCashFactId: string;
  totalCashFactId: string;
  operatingYtdFactId: string;
  investingYtdFactId: string;
  /** Cents per quarter. Unknown financing/FX is an explicit range, never an inferred 0. */
  financingAssumptionId: string;
  fxAssumptionId: string;
};

export type RunInputs = HistoricalRun["inputs"];
type Band = { low: Ratio; mid: Ratio; high: Ratio };

export type QuarterBridge = {
  method: typeof QUARTER_BRIDGE_METHOD;
  targetDate: ISODate;
  quarterDays: number;
  elapsedQuarters: number;
  inputs: RunInputs;
  /** Origin to cutoff. Identical in every branch. */
  nowcast: HistoricalPrediction[];
  forecast: HistoricalPrediction[];
};

export type QuarterAlternative = {
  baseline: QuarterBridge;
  inputs: RunInputs;
  /** Same objects as the baseline nowcast. */
  nowcast: HistoricalPrediction[];
  forecast: HistoricalPrediction[];
  /** Alternative minus baseline at the target date. low is the downside. */
  effectCents: { low: Cents; point: Cents; high: Cents };
  benefitStart: ISODate;
  benefitDays: number;
  postHoc: boolean;
};

function fail(msg: string): never {
  throw new Error(`quarter bridge: ${msg}`);
}

/** Exact final rounding; refuses results outside safe integer cents. */
function checkedCents(r: Ratio): Cents {
  const c = roundCents(r);
  if (!Number.isSafeInteger(c)) fail("result outside safe integer cents");
  return c;
}

const times = (r: Ratio, num: number, den: number): Ratio => ({
  num: r.num * BigInt(num),
  den: r.den * BigInt(den),
});
const addBand = (a: Band, b: Band): Band => ({
  low: addRatio(a.low, b.low),
  mid: addRatio(a.mid, b.mid),
  high: addRatio(a.high, b.high),
});
const point = (r: Ratio): Band => ({ low: r, mid: r, high: r });
const scaleBand = (b: Band, num: number, den: number): Band => ({
  low: times(b.low, num, den),
  mid: times(b.mid, num, den),
  high: times(b.high, num, den),
});

const cutoffDate = (t: Timestamp): ISODate => t.slice(0, 10);
const knownBy = (cutoff: Timestamp, f: HistoricalFact): boolean =>
  Date.parse(f.availableAt) <= Date.parse(cutoff);

function fact(input: QuarterBridgeInput, id: string, metric: HistoricalMetric): HistoricalFact {
  const f = input.case.facts.find((x) => x.id === id) ?? fail(`fact ${id} not found`);
  if (f.metric !== metric) fail(`fact ${id} is ${f.metric}, expected ${metric}`);
  if (f.currency !== input.case.currency) fail(`fact ${id} currency differs from the case`);
  if (!knownBy(input.knowledgeCutoff, f)) fail(`fact ${id} was not available at the cutoff`);
  return f;
}

function assumption(input: QuarterBridgeInput, id: string): HistoricalAssumption {
  const a = input.case.assumptions.find((x) => x.id === id) ?? fail(`assumption ${id} not found`);
  if (a.value.unit !== "cents") fail(`assumption ${id} is not in cents`);
  return a;
}

const isPostHoc = (a: HistoricalAssumption): boolean =>
  a.label === "hindsight" || a.selectedAfterReveal;

/**
 * The assumptions plus everything they depend on, in case order, each checked: a hidden
 * hindsight dependency taints the run exactly like a direct one.
 */
function closure(
  input: QuarterBridgeInput,
  ids: string[],
  allowHindsight: boolean,
): HistoricalAssumption[] {
  const byId = new Map(input.case.assumptions.map((a) => [a.id, a]));
  const want = new Set<string>();
  const visit = (id: string): void => {
    if (want.has(id)) return;
    want.add(id);
    (byId.get(id) ?? fail(`assumption ${id} not found`)).dependsOn.forEach(visit);
  };
  ids.forEach(visit);
  const all = input.case.assumptions.filter((a) => want.has(a.id));
  for (const a of all) {
    if (!allowHindsight && isPostHoc(a)) fail(`baseline cannot use hindsight assumption ${a.id}`);
    // Hindsight basis may be later facts by definition; anything else rests on cutoff evidence.
    if (a.label !== "hindsight")
      for (const b of a.basisFactIds) {
        const f = input.case.facts.find((x) => x.id === b);
        if (!f || !knownBy(input.knowledgeCutoff, f)) fail(`assumption ${a.id} basis ${b} is late`);
      }
  }
  return all;
}

const band = (a: HistoricalAssumption): Band => ({
  low: ratio(a.value.low),
  mid: ratio(BigInt(a.value.low) + BigInt(a.value.high), 2),
  high: ratio(a.value.high),
});

/** Months from a month-start to a month-end, inclusive. Fails off month boundaries. */
function wholeMonths(start: ISODate, end: ISODate): number {
  if (!start.endsWith("-01")) fail(`YTD start ${start} is not a month start`);
  if (Number(end.slice(8)) !== daysInMonth(end)) fail(`${end} is not a month end`);
  const months = (d: ISODate) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7));
  return months(end) - months(start) + 1;
}

function quarterEndAfter(origin: ISODate): ISODate {
  const m = Number(origin.slice(0, 4)) * 12 + Number(origin.slice(5, 7)) - 1 + 3;
  const first = `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}-01`;
  return addDays(first, daysInMonth(first) - 1);
}

/** OCF and ICF must cover the same YTD period ending at the origin, in whole quarters. */
function ytdQuarters(origin: ISODate, flows: HistoricalFact[]): number {
  const [first] = flows;
  if (!first || first.period.kind !== "duration") return fail("YTD flow needs a duration");
  const { start } = first.period;
  for (const f of flows)
    if (f.period.kind !== "duration" || f.period.start !== start || f.period.end !== origin)
      fail(`YTD fact ${f.id} is not on the same basis ending at the origin`);
  const months = wholeMonths(start, origin);
  if (months % 3 !== 0 || months > 12) fail(`YTD covers ${months} months, not whole quarters`);
  return months / 3;
}

/** Published cents. Every displayed difference is integer math on these. */
type CentsBand = { low: Cents; mid: Cents; high: Cents };

/** Rounding is monotone, so an ordered exact band stays ordered; checked anyway. */
function roundBand(b: Band): CentsBand {
  const c = { low: checkedCents(b.low), mid: checkedCents(b.mid), high: checkedCents(b.high) };
  if (!(c.low <= c.mid && c.mid <= c.high)) fail("range does not contain its point");
  return c;
}
const plusCents = (a: CentsBand, b: CentsBand): CentsBand =>
  roundBand({
    low: ratio(BigInt(a.low) + BigInt(b.low)),
    mid: ratio(BigInt(a.mid) + BigInt(b.mid)),
    high: ratio(BigInt(a.high) + BigInt(b.high)),
  });

function prediction(
  id: string,
  kind: HistoricalPrediction["kind"],
  metric: HistoricalMetric,
  date: ISODate,
  currency: string,
  c: CentsBand,
): HistoricalPrediction {
  const p: HistoricalPrediction = {
    id,
    kind,
    metric,
    period: { kind: "instant", date },
    currency,
    cents: c.mid,
  };
  return c.low === c.high ? p : { ...p, range: { low: c.low, high: c.high } };
}

/** Total and usable cash at one date; usable = total - origin restricted, in whole cents. */
function cashPair(
  prefix: string,
  kind: HistoricalPrediction["kind"],
  date: ISODate,
  currency: string,
  total: CentsBand,
  restricted: Cents,
): HistoricalPrediction[] {
  return [
    prediction(`${prefix}_total`, kind, "cash_including_restricted", date, currency, total),
    prediction(
      `${prefix}_usable`,
      kind,
      "cash_and_equivalents",
      date,
      currency,
      plusCents(total, { low: -restricted, mid: -restricted, high: -restricted }),
    ),
  ];
}

type Prepared = {
  bridge: QuarterBridge;
  used: HistoricalFact[];
  restricted: Cents;
  /** Rounded baseline total at the target; the alternative adds its rounded effect to this. */
  target: CentsBand;
};

function prepare(raw: QuarterBridgeInput): Prepared {
  const input = { ...raw, case: HistoricalCaseSchema.parse(raw.case) };
  const origin = input.originBalanceDate;
  const cutoff = cutoffDate(input.knowledgeCutoff);
  toMs(origin); // rejects impossible calendar dates
  const usable = fact(input, input.usableCashFactId, "cash_and_equivalents");
  const total = fact(input, input.totalCashFactId, "cash_including_restricted");
  for (const f of [usable, total])
    if (f.period.kind !== "instant" || f.period.date !== origin)
      fail(`balance ${f.id} is not at the origin date`);
  if (total.cents < usable.cents) fail("total cash is below usable cash");
  const ocf = fact(input, input.operatingYtdFactId, "operating_cash_flow");
  const icf = fact(input, input.investingYtdFactId, "investing_cash_flow");
  const n = ytdQuarters(origin, [ocf, icf]);
  const targetDate = quarterEndAfter(origin);
  if (!(origin < cutoff && cutoff < targetDate)) fail("cutoff must fall inside the target quarter");
  // Reported restricted cash at the origin must agree with the chosen balances; never infer past it.
  const restrictedFacts = input.case.facts.filter(
    (f) =>
      f.metric === "restricted_cash" &&
      f.period.kind === "instant" &&
      f.period.date === origin &&
      knownBy(input.knowledgeCutoff, f),
  );
  for (const f of restrictedFacts)
    if (BigInt(f.cents) !== BigInt(total.cents) - BigInt(usable.cents))
      fail(`restricted cash ${f.id} contradicts total minus usable at the origin`);
  const financing = assumption(input, input.financingAssumptionId);
  const fx = assumption(input, input.fxAssumptionId);
  // ponytail: no partial-quarter timing; a rate must cover the whole modeled interval or it is rejected.
  for (const a of [financing, fx])
    if (a.effectiveFrom > addDays(origin, 1))
      fail(`assumption ${a.id} starts ${a.effectiveFrom}, after the modeled interval begins`);
  const assumptions = closure(input, [financing.id, fx.id], false);

  const quarterFlow = [band(financing), band(fx)].reduce(
    addBand,
    point(ratio(BigInt(ocf.cents) + BigInt(icf.cents), n)),
  );
  const quarterDays = daysBetween(origin, targetDate);
  const restricted = checkedCents(ratio(BigInt(total.cents) - BigInt(usable.cents)));
  const at = (date: ISODate) =>
    roundBand(
      addBand(
        point(ratio(total.cents)),
        scaleBand(quarterFlow, daysBetween(origin, date), quarterDays),
      ),
    );
  const cur = input.case.currency;
  const used = [usable, total, ocf, icf, ...restrictedFacts];
  const target = at(targetDate);
  const bridge: QuarterBridge = {
    method: QUARTER_BRIDGE_METHOD,
    targetDate,
    quarterDays,
    elapsedQuarters: n,
    inputs: inputsOf(input.case, used, assumptions),
    nowcast: cashPair("nowcast", "nowcast", cutoff, cur, at(cutoff), restricted),
    forecast: cashPair("target", "forecast", targetDate, cur, target, restricted),
  };
  return { bridge, used, restricted, target };
}

/** Sources, facts (with derivation inputs) and assumptions a run must list. */
function inputsOf(
  c: HistoricalCase,
  used: HistoricalFact[],
  as: HistoricalAssumption[],
): RunInputs {
  const byId = new Map(c.facts.map((f) => [f.id, f]));
  const facts = new Set<string>();
  const visit = (f: HistoricalFact): void => {
    facts.add(f.id);
    if (f.kind === "derived") for (const d of f.derivedFrom) visit(byId.get(d)!);
  };
  // Hindsight basis is later evidence by definition and cannot be a run input.
  const basis = as.filter((a) => a.label !== "hindsight").flatMap((a) => a.basisFactIds);
  for (const f of [...used, ...basis.map((b) => byId.get(b)!)]) visit(f);
  const sources = new Set<string>();
  for (const id of facts) {
    const f = byId.get(id)!;
    if (f.kind === "reported") sources.add(f.sourceId);
  }
  return {
    sourceIds: [...sources].sort(),
    factIds: [...facts].sort(),
    assumptionIds: as.map((a) => a.id),
  };
}

/** Baseline: shared nowcast plus target-quarter-end total and usable cash. */
export function quarterBridge(input: QuarterBridgeInput): QuarterBridge {
  return prepare(input).bridge;
}

/**
 * One costed decision against the same evidence. value = net cash per quarter once
 * running (low end may be negative: downside such as lost revenue). The one-time cost
 * is paid in full on effectiveFrom; benefit starts benefitLagDays later and accrues
 * uniformly per day to the target date. Nothing at or before the cutoff changes.
 */
export function quarterAlternative(
  input: QuarterBridgeInput,
  decisionAssumptionId: string,
): QuarterAlternative {
  const { bridge, used, restricted, target } = prepare(input);
  const a = assumption(input, decisionAssumptionId);
  if (a.label === "synthetic") fail("a decision must be counterfactual or hindsight");
  if (!a.oneTimeCost || a.benefitLagDays === undefined) fail("a decision needs cost and lag");
  const cutoff = cutoffDate(input.knowledgeCutoff);
  if (!(cutoff < a.effectiveFrom && a.effectiveFrom <= bridge.targetDate))
    fail("decision must take effect after the cutoff, inside the target quarter");
  const benefitStart = addDays(a.effectiveFrom, a.benefitLagDays);
  const benefitDays = Math.max(0, daysBetween(benefitStart, bridge.targetDate) + 1);
  const cost = a.oneTimeCost;
  // Downside pairs the weakest benefit with the highest cost.
  const effect: Band = {
    low: addRatio(times(ratio(a.value.low), benefitDays, bridge.quarterDays), ratio(-cost.high)),
    mid: addRatio(
      times(band(a).mid, benefitDays, bridge.quarterDays),
      ratio(-(BigInt(cost.low) + BigInt(cost.high)), 2),
    ),
    high: addRatio(times(ratio(a.value.high), benefitDays, bridge.quarterDays), ratio(-cost.low)),
  };
  const assumptions = closure(input, [...bridge.inputs.assumptionIds, a.id], true);
  // Rounded baseline + rounded effect, so the published effect is exactly the displayed
  // difference (may sit 1 cent from rounding the exact alternative once).
  const effectCents = roundBand(effect);
  return {
    baseline: bridge,
    inputs: inputsOf(input.case, used, assumptions),
    nowcast: bridge.nowcast,
    forecast: cashPair(
      "target",
      "forecast",
      bridge.targetDate,
      input.case.currency,
      plusCents(target, effectCents),
      restricted,
    ),
    effectCents: { low: effectCents.low, point: effectCents.mid, high: effectCents.high },
    benefitStart,
    benefitDays,
    postHoc: assumptions.some(isPostHoc),
  };
}

/**
 * Period-matched comparison, observed minus predicted. Reads the run; never edits it.
 * Only facts published after the cutoff and by revealedThrough can score.
 */
export function compareRun(
  c: HistoricalCase,
  run: HistoricalRun,
  revealedThrough: Timestamp,
): HistoricalComparison[] {
  const after = (f: HistoricalFact) => Date.parse(f.availableAt) > Date.parse(run.knowledgeCutoff);
  const revealed = (f: HistoricalFact) => Date.parse(f.availableAt) <= Date.parse(revealedThrough);
  const comparisons = run.predictions.map((p): HistoricalComparison => {
    const base = { id: `${run.id}_${p.id}_cmp`, runId: run.id, predictionId: p.id };
    const samePeriod = c.facts.filter(
      (f) => after(f) && JSON.stringify(f.period) === JSON.stringify(p.period),
    );
    // Earliest publication wins: a later amendment cannot replace what was first observed.
    const matches = samePeriod
      .filter((f) => f.metric === p.metric && f.currency === p.currency)
      .sort((x, y) => Date.parse(x.availableAt) - Date.parse(y.availableAt));
    const first = matches.find(revealed);
    // Same-instant earliest observations: the first value is ambiguous unless they agree.
    // Ties pick the smallest id so the result never depends on case array order.
    const tied = first
      ? matches
          .filter((x) => Date.parse(x.availableAt) === Date.parse(first.availableAt))
          .sort((x, y) => (x.id < y.id ? -1 : 1))
      : [];
    // ponytail: the contract has no "conflicting observations" reason; incomparable_scope is the
    // closest fail-closed label. Add a dedicated reason by contract change if the UI needs it.
    if (tied.some((x) => x.cents !== first?.cents))
      return { ...base, status: "unscored", reason: "incomparable_scope" };
    const f = tied[0];
    if (!f) {
      if (matches.length > 0) return { ...base, status: "unscored", reason: "not_yet_published" };
      const other = samePeriod.some(revealed);
      return {
        ...base,
        status: "unscored",
        reason: other ? "incomparable_scope" : "no_observation",
      };
    }
    const error = f.cents - p.cents;
    const breach = (r: HistoricalRun["riskRules"][number], v: number) =>
      r.breachWhen === "below" ? v < r.thresholdCents : v > r.thresholdCents;
    return {
      ...base,
      status: "scored",
      observationFactId: f.id,
      predictedCents: p.cents,
      observedCents: f.cents,
      errorCents: error,
      absErrorCents: Math.abs(error),
      ruleOutcomes: run.riskRules
        .filter((r) => r.metric === p.metric)
        .map((r) => ({
          ruleId: r.id,
          predictedBreach: breach(r, p.cents),
          observedBreach: breach(r, f.cents),
        })),
    };
  });
  return HistoricalComparisonContextSchema.parse({ case: c, run, revealedThrough, comparisons })
    .comparisons;
}
