import type {
  Cents,
  HistoricalCase,
  HistoricalComparison,
  HistoricalFact,
  HistoricalMetric,
  HistoricalPrediction,
  HistoricalRun,
  ISODate,
  Timestamp,
} from "@domino/contracts";
import { ratio, roundCents } from "./money";
import { type QuarterBridgeInput, quarterAlternative, quarterBridge } from "./period";

/**
 * Quarterly backtest: what Domino would have suggested at a knowledge cutoff, ranked by
 * modeled quarter-end cash, and, after an explicit reveal, a simulated counterfactual of the
 * actual path plus the suggestion's effect. Pure: no clock, network, AI or randomness.
 *
 * Method assumptions (stated, not evidenced):
 * - A costed response is the existing quarterAlternative (one-time cost, benefit after a lag).
 * - A credit draw adds commitment minus drawn (both reported at the origin date and public by the
 *   cutoff) once, after the cutoff and inside the quarter. Interest and fees are not modeled.
 * - Every effect moves total and usable cash by the same amount; restricted cash stays flat.
 * - Ranking is by the point effect on quarter-end cash only. Later benefits are not counted.
 * - Counterfactual = observed quarter-end cash + (effect - the part the company is shown to have
 *   done anyway). It is arithmetic on stated assumptions, never an observation.
 */
export const QUARTER_BACKTEST_METHOD = { id: "quarterly_backtest", version: "0.1.0" } as const;

/** A dated, sourced figure kept outside the cash-only case (for example a credit facility). */
export type BacktestFact = {
  id: string;
  sourceId: string;
  metric: "revolver_commitment" | "revolver_drawn";
  date: ISODate;
  cents: Cents;
  availableAt: Timestamp;
};

export type BacktestResponse =
  | { id: string; kind: "keep_plan"; title: string }
  | { id: string; kind: "costed"; title: string; assumptionId: string }
  | {
      id: string;
      kind: "credit_draw";
      title: string;
      effectiveFrom: ISODate;
      commitmentFactId: string;
      drawnFactId: string;
    }
  | { id: string; kind: "not_modeled"; title: string; reason: string; basisIds: string[] };

export type BacktestEffect = { low: Cents; point: Cents; high: Cents };

export type BacktestSuggestion = {
  id: string;
  kind: BacktestResponse["kind"];
  title: string;
  /** 1 = best modeled quarter-end cash. null when the engine cannot model it. */
  rank: number | null;
  /** Suggestion minus the saved baseline at the quarter end. null when not modeled. */
  effectCents: BacktestEffect | null;
  /** Saved baseline forecast shifted by the effect. Empty when not modeled. */
  forecast: HistoricalPrediction[];
  effectiveFrom: ISODate | null;
  benefit: { start: ISODate; daysInQuarter: number } | null;
  feasibleAtCutoff: "yes" | "no" | "unknown";
  /** Inputs the numbers rest on; all public by the cutoff. */
  basisIds: string[];
  /** Credit draw only: commitment minus drawn, added once on effectiveFrom. */
  amountCents: Cents | null;
  /** Costed response only: the one-time cost range paid on effectiveFrom. */
  oneTimeCostCents: { low: Cents; high: Cents } | null;
  reason: string | null;
};

export type QuarterSuggestionsArgs = {
  bridge: QuarterBridgeInput;
  baseline: HistoricalRun;
  facts: BacktestFact[];
  responses: BacktestResponse[];
};

function fail(msg: string): never {
  throw new Error(`quarter backtest: ${msg}`);
}

const MAX = BigInt(Number.MAX_SAFE_INTEGER);
function safe(n: bigint): Cents {
  if (n > MAX || n < -MAX) fail("result outside safe integer cents");
  return Number(n);
}
const plus = (a: Cents, b: Cents): Cents => safe(BigInt(a) + BigInt(b));
const minus = (a: Cents, b: Cents): Cents => safe(BigInt(a) - BigInt(b));
const at = (t: Timestamp) => Date.parse(t);

const canon = (v: unknown): string =>
  JSON.stringify(v, (_, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x,
  );
const byId = (ps: HistoricalPrediction[]) => [...ps].sort((a, b) => (a.id < b.id ? -1 : 1));

/** The same predictions with the effect added to point, low and high. */
function shift(prev: HistoricalPrediction[], e: BacktestEffect): HistoricalPrediction[] {
  return prev.map(({ range, ...p }) => {
    const low = plus(range?.low ?? p.cents, e.low);
    const high = plus(range?.high ?? p.cents, e.high);
    const next = { ...p, cents: plus(p.cents, e.point) };
    return low === high ? next : { ...next, range: { low, high } };
  });
}

function cutoffFact(args: QuarterSuggestionsArgs, id: string, metric: BacktestFact["metric"]) {
  const f = args.facts.find((x) => x.id === id) ?? fail(`fact ${id} not found`);
  if (f.metric !== metric) fail(`fact ${id} is ${f.metric}, expected ${metric}`);
  if (!Number.isSafeInteger(f.cents) || f.cents < 0) fail(`fact ${id} is not whole cents`);
  if (!(at(f.availableAt) <= at(args.bridge.knowledgeCutoff)))
    fail(`fact ${id} was not available at the cutoff`);
  if (f.date !== args.bridge.originBalanceDate) fail(`fact ${id} is not at the origin date`);
  return f;
}

type Modeled = Omit<BacktestSuggestion, "rank">;

function evaluate(
  args: QuarterSuggestionsArgs,
  baseForecast: HistoricalPrediction[],
  targetDate: ISODate,
  r: BacktestResponse,
): Modeled {
  const common = { id: r.id, kind: r.kind, title: r.title, reason: null };
  const cutoffDay = args.bridge.knowledgeCutoff.slice(0, 10);
  if (r.kind === "keep_plan") {
    const effectCents = { low: 0, point: 0, high: 0 };
    return {
      ...common,
      effectCents,
      forecast: shift(baseForecast, effectCents),
      effectiveFrom: null,
      benefit: null,
      feasibleAtCutoff: "yes",
      basisIds: [...args.baseline.inputs.factIds, ...args.baseline.inputs.assumptionIds],
      amountCents: null,
      oneTimeCostCents: null,
    };
  }
  if (r.kind === "costed") {
    // The same costed decision computeAlternative saves; nothing is recomputed here.
    const alt = quarterAlternative(args.bridge, r.assumptionId);
    const a =
      args.bridge.case.assumptions.find((x) => x.id === r.assumptionId) ??
      fail(`assumption ${r.assumptionId} not found`);
    const cost = a.oneTimeCost ?? fail(`assumption ${a.id} has no cost`);
    return {
      ...common,
      effectCents: alt.effectCents,
      forecast: shift(baseForecast, alt.effectCents),
      effectiveFrom: a.effectiveFrom,
      benefit: { start: alt.benefitStart, daysInQuarter: alt.benefitDays },
      feasibleAtCutoff: a.feasibleAtCutoff,
      basisIds: [...a.basisFactIds, a.id],
      amountCents: null,
      oneTimeCostCents: { low: cost.low, high: cost.high },
    };
  }
  if (r.kind === "credit_draw") {
    if (!(cutoffDay < r.effectiveFrom && r.effectiveFrom <= targetDate))
      fail(`draw ${r.id} must take effect after the cutoff, inside the quarter`);
    const commitment = cutoffFact(args, r.commitmentFactId, "revolver_commitment");
    const drawn = cutoffFact(args, r.drawnFactId, "revolver_drawn");
    const amount = minus(commitment.cents, drawn.cents);
    if (amount <= 0) fail(`draw ${r.id} has no undrawn capacity`);
    const effectCents = { low: amount, point: amount, high: amount };
    return {
      ...common,
      effectCents,
      forecast: shift(baseForecast, effectCents),
      effectiveFrom: r.effectiveFrom,
      benefit: null,
      feasibleAtCutoff: "unknown",
      basisIds: [commitment.id, drawn.id],
      amountCents: amount,
      oneTimeCostCents: null,
    };
  }
  return {
    ...common,
    effectCents: null,
    forecast: [],
    effectiveFrom: null,
    benefit: null,
    feasibleAtCutoff: "unknown",
    basisIds: r.basisIds,
    amountCents: null,
    oneTimeCostCents: null,
    reason: r.reason,
  };
}

/**
 * Every response evaluated against the saved baseline with cutoff-only inputs, ranked by the
 * point effect on quarter-end cash (ties by id). Responses the engine cannot model keep rank null.
 */
export function quarterSuggestions(args: QuarterSuggestionsArgs): BacktestSuggestion[] {
  const bridge = quarterBridge(args.bridge);
  const run = args.baseline;
  if (run.branch.kind !== "baseline") fail("baseline is not a baseline run");
  if (run.knowledgeCutoff !== args.bridge.knowledgeCutoff) fail("baseline cutoff differs");
  if (run.originBalanceDate !== args.bridge.originBalanceDate) fail("baseline origin differs");
  const baseForecast = run.predictions.filter((p) => p.kind === "forecast");
  if (canon(byId(baseForecast)) !== canon(byId(bridge.forecast)))
    fail("baseline forecast differs from the frozen bridge");
  for (const f of args.facts)
    if (!(at(f.availableAt) <= at(args.bridge.knowledgeCutoff)))
      fail(`fact ${f.id} was published after the cutoff`);
  const ids = args.responses.map((r) => r.id);
  if (new Set(ids).size !== ids.length) fail("a response id repeats");
  const all = args.responses.map((r) => evaluate(args, baseForecast, bridge.targetDate, r));
  const ranked = all
    .filter((s) => s.effectCents !== null)
    .sort((a, b) => b.effectCents!.point - a.effectCents!.point || (a.id < b.id ? -1 : 1));
  const rank = new Map(ranked.map((s, i) => [s.id, i + 1]));
  return [...ranked, ...all.filter((s) => s.effectCents === null)].map((s) => ({
    ...s,
    rank: rank.get(s.id) ?? null,
  }));
}

/**
 * The part of a credit draw the company is shown to have done anyway: the increase in drawn
 * borrowings from origin to quarter end, capped at the suggested amount and never negative.
 */
export function creditDrawOverlap(before: BacktestFact, after: BacktestFact, amount: Cents): Cents {
  if (before.metric !== "revolver_drawn" || after.metric !== "revolver_drawn")
    fail("overlap needs drawn borrowings at both dates");
  if (!(before.date < after.date)) fail("overlap dates are out of order");
  const increase = minus(after.cents, before.cents);
  return Math.max(0, Math.min(increase, amount));
}

export type CounterfactualPoint = {
  metric: HistoricalMetric;
  date: ISODate;
  observationFactId: string;
  actualCents: Cents;
  forecastCents: Cents;
  counterfactualCents: Cents;
  counterfactualRange: { low: Cents; high: Cents } | null;
};

export type QuarterCounterfactual = {
  suggestionId: string;
  /** Effect minus the part already in the actual path; added to every scored actual. */
  appliedEffectCents: BacktestEffect;
  overlapCents: Cents;
  points: CounterfactualPoint[];
};

/** Actual quarter-end cash from the stored reveal plus the suggestion's remaining effect. */
export function quarterCounterfactual(args: {
  run: HistoricalRun;
  comparisons: HistoricalComparison[];
  suggestion: BacktestSuggestion;
  overlapCents: Cents;
}): QuarterCounterfactual {
  const { run, suggestion: s } = args;
  const e = s.effectCents ?? fail(`suggestion ${s.id} is not modeled`);
  if (!Number.isSafeInteger(args.overlapCents) || args.overlapCents < 0)
    fail("overlap must be nonnegative whole cents");
  const applied = {
    low: minus(e.low, args.overlapCents),
    point: minus(e.point, args.overlapCents),
    high: minus(e.high, args.overlapCents),
  };
  const points = args.comparisons.flatMap((c): CounterfactualPoint[] => {
    if (c.status !== "scored" || c.runId !== run.id) return [];
    const p = run.predictions.find((x) => x.id === c.predictionId);
    if (!p || p.kind !== "forecast" || p.period.kind !== "instant") return [];
    const low = plus(c.observedCents, applied.low);
    const high = plus(c.observedCents, applied.high);
    return [
      {
        metric: p.metric,
        date: p.period.date,
        observationFactId: c.observationFactId,
        actualCents: c.observedCents,
        forecastCents: c.predictedCents,
        counterfactualCents: plus(c.observedCents, applied.point),
        counterfactualRange: low === high ? null : { low, high },
      },
    ];
  });
  if (points.length === 0) fail("no scored quarter-end observation to build on");
  return {
    suggestionId: s.id,
    appliedEffectCents: applied,
    overlapCents: args.overlapCents,
    points,
  };
}

export type FlowLine = {
  metric:
    | "operating_cash_flow"
    | "investing_cash_flow"
    | "financing_cash_flow"
    | "fx_effect_on_cash";
  forecastCents: Cents;
  actualCents: Cents | null;
  actualFactId: string | null;
  errorCents: Cents | null;
};

/**
 * The quarter's flows as the bridge assumed them (YTD / elapsed quarters; financing and FX from
 * their assumptions' midpoints) beside the target-quarter flows in a revealed case, if any.
 */
export function quarterFlowMiss(input: QuarterBridgeInput, revealed: HistoricalCase): FlowLine[] {
  const bridge = quarterBridge(input);
  const q = bridge.elapsedQuarters;
  const factCents = (id: string) =>
    input.case.facts.find((f) => f.id === id)?.cents ?? fail(`fact ${id} not found`);
  const mid = (id: string) => {
    const a = input.case.assumptions.find((x) => x.id === id) ?? fail(`assumption ${id} not found`);
    return roundCents(ratio(BigInt(a.value.low) + BigInt(a.value.high), 2));
  };
  const end = bridge.targetDate;
  const quarterStart = `${end.slice(0, 5)}${String(Number(end.slice(5, 7)) - 2).padStart(2, "0")}-01`;
  const lines: [FlowLine["metric"], Cents][] = [
    ["operating_cash_flow", roundCents(ratio(factCents(input.operatingYtdFactId), q))],
    ["investing_cash_flow", roundCents(ratio(factCents(input.investingYtdFactId), q))],
    ["financing_cash_flow", mid(input.financingAssumptionId)],
    ["fx_effect_on_cash", mid(input.fxAssumptionId)],
  ];
  const cutoff = at(input.knowledgeCutoff);
  return lines.map(([metric, forecastCents]) => {
    const f: HistoricalFact | undefined = revealed.facts.find(
      (x) =>
        x.metric === metric &&
        at(x.availableAt) > cutoff &&
        x.period.kind === "duration" &&
        x.period.start === quarterStart &&
        x.period.end === bridge.targetDate,
    );
    return {
      metric,
      forecastCents,
      actualCents: f?.cents ?? null,
      actualFactId: f?.id ?? null,
      errorCents: f ? minus(f.cents, forecastCents) : null,
    };
  });
}
