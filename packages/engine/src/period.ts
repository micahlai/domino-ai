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
const neg = (r: Ratio): Ratio => ({ num: -r.num, den: r.den });
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

function assumption(
  input: QuarterBridgeInput,
  id: string,
  allowHindsight: boolean,
): HistoricalAssumption {
  const a = input.case.assumptions.find((x) => x.id === id) ?? fail(`assumption ${id} not found`);
  if (a.value.unit !== "cents") fail(`assumption ${id} is not in cents`);
  if (!allowHindsight && (a.label === "hindsight" || a.selectedAfterReveal))
    fail(`baseline cannot use hindsight assumption ${id}`);
  // Hindsight basis may be later facts by definition; anything else rests on cutoff evidence.
  if (a.label !== "hindsight")
    for (const b of a.basisFactIds) {
      const f = input.case.facts.find((x) => x.id === b);
      if (!f || !knownBy(input.knowledgeCutoff, f)) fail(`assumption ${id} basis ${b} is late`);
    }
  return a;
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

function prediction(
  id: string,
  kind: HistoricalPrediction["kind"],
  metric: HistoricalMetric,
  date: ISODate,
  currency: string,
  b: Band,
): HistoricalPrediction {
  const low = checkedCents(b.low);
  const high = checkedCents(b.high);
  const p: HistoricalPrediction = {
    id,
    kind,
    metric,
    period: { kind: "instant", date },
    currency,
    cents: checkedCents(b.mid),
  };
  return low === high ? p : { ...p, range: { low, high } };
}

/** Total and usable cash at one date, from total-cash bands. */
function cashPair(
  prefix: string,
  kind: HistoricalPrediction["kind"],
  date: ISODate,
  currency: string,
  total: Band,
  restricted: Ratio,
): HistoricalPrediction[] {
  return [
    prediction(`${prefix}_total`, kind, "cash_including_restricted", date, currency, total),
    prediction(
      `${prefix}_usable`,
      kind,
      "cash_and_equivalents",
      date,
      currency,
      addBand(total, point(neg(restricted))),
    ),
  ];
}

type Prepared = { bridge: QuarterBridge; total0: Ratio; restricted: Ratio; quarterFlow: Band };

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
  const financing = assumption(input, input.financingAssumptionId, false);
  const fx = assumption(input, input.fxAssumptionId, false);

  const quarterFlow = [band(financing), band(fx)].reduce(
    addBand,
    point(ratio(BigInt(ocf.cents) + BigInt(icf.cents), n)),
  );
  const quarterDays = daysBetween(origin, targetDate);
  const restricted = ratio(BigInt(total.cents) - BigInt(usable.cents));
  const total0 = ratio(total.cents);
  const at = (date: ISODate) =>
    addBand(point(total0), scaleBand(quarterFlow, daysBetween(origin, date), quarterDays));
  const cur = input.case.currency;
  const facts = [usable, total, ocf, icf];
  const bridge: QuarterBridge = {
    method: QUARTER_BRIDGE_METHOD,
    targetDate,
    quarterDays,
    elapsedQuarters: n,
    inputs: inputsOf(input.case, facts, [financing, fx]),
    nowcast: cashPair("nowcast", "nowcast", cutoff, cur, at(cutoff), restricted),
    forecast: cashPair("target", "forecast", targetDate, cur, at(targetDate), restricted),
  };
  return { bridge, total0, restricted, quarterFlow };
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
  for (const f of [...used, ...as.flatMap((a) => a.basisFactIds.map((b) => byId.get(b)!))])
    visit(f);
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
  const { bridge, total0, restricted, quarterFlow } = prepare(input);
  const a = assumption(input, decisionAssumptionId, true);
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
  const baseTarget = addBand(point(total0), quarterFlow);
  const cur = input.case.currency;
  return {
    baseline: bridge,
    inputs: { ...bridge.inputs, assumptionIds: [...bridge.inputs.assumptionIds, a.id] },
    nowcast: bridge.nowcast,
    forecast: cashPair(
      "target",
      "forecast",
      bridge.targetDate,
      cur,
      addBand(baseTarget, effect),
      restricted,
    ),
    effectCents: {
      low: checkedCents(effect.low),
      point: checkedCents(effect.mid),
      high: checkedCents(effect.high),
    },
    benefitStart,
    benefitDays,
    postHoc: a.label === "hindsight" || a.selectedAfterReveal,
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
    const f = matches.find(revealed);
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
