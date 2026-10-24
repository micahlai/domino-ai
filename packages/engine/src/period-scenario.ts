import {
  type Cents,
  type HistoricalAssumption,
  type HistoricalCase,
  type HistoricalMetric,
  type HistoricalPrediction,
  type HistoricalRun,
  HistoricalRunContextSchema,
  type HistoricalScenarioInput,
  HistoricalScenarioInputSchema,
  type HistoricalScenarioResult,
  HistoricalScenarioResultSchema,
} from "@domino/contracts";
import { ratio, roundCents } from "./money";
import {
  QUARTER_BRIDGE_METHOD,
  type QuarterBridge,
  type QuarterBridgeInput,
  quarterAlternative,
  quarterBridge,
} from "./period";

/**
 * One hypothetical aggregate operating outflow inside the target quarter, plus at most one
 * costed response, on top of a saved baseline. Pure: no clock, network or randomness.
 *
 * Method assumptions (stated, not evidenced):
 * - The event is the TOTAL extra outflow over its interval. It is subtracted once from the
 *   quarter-end balances; the interval only has to sit after the cutoff and inside the quarter.
 * - Total and usable cash move by the same amount, so restricted cash stays at its origin amount.
 * - The response is the existing costed decision (quarterAlternative) added to the event branch.
 *   It may leave cash lower: a cost with no benefit inside the quarter is a valid answer.
 * - No threshold, rule, default or insolvency is modeled; the graph only states arithmetic,
 *   the hypothetical event and the response assumption.
 */
export const QUARTER_SCENARIO_METHOD = { id: "quarterly_event_bridge", version: "0.1.0" } as const;

export type QuarterScenarioArgs = {
  /** The frozen inputs the saved baseline was built from. */
  bridge: QuarterBridgeInput;
  /** Saved baseline run; read, never edited. */
  baseline: HistoricalRun;
  scenario: HistoricalScenarioInput;
};

type Effect = { low: Cents; point: Cents; high: Cents };
type Response = NonNullable<HistoricalScenarioResult["response"]>;
type Node = HistoricalScenarioResult["impact"]["nodes"][number];
type Edge = HistoricalScenarioResult["impact"]["edges"][number];
type Ref = Edge["refs"][number];

function fail(msg: string): never {
  throw new Error(`quarter scenario: ${msg}`);
}

const MAX = BigInt(Number.MAX_SAFE_INTEGER);
/** Exact integer cents; refuses anything outside safe integers instead of losing precision. */
function safe(n: bigint): Cents {
  if (n > MAX || n < -MAX) fail("result outside safe integer cents");
  return Number(n);
}
const plus = (a: Cents, b: Cents): Cents => safe(BigInt(a) + BigInt(b));

/** Key-sorted JSON, so saved records compare equal whatever order their keys were stored in. */
const canon = (v: unknown): string =>
  JSON.stringify(v, (_, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x,
  );
const sorted = (ps: HistoricalPrediction[]): HistoricalPrediction[] =>
  [...ps].sort((a, b) => (a.id < b.id ? -1 : 1));

/** Negated outflow range; point is the negated midpoint, rounded once like the bridge does. */
function eventEffect(out: { low: Cents; high: Cents }): Effect {
  return {
    low: safe(-BigInt(out.high)),
    point: roundCents(ratio(-(BigInt(out.low) + BigInt(out.high)), 2)),
    high: safe(-BigInt(out.low)),
  };
}

/** The same metrics and periods with the effect added to the point, low and high ends. */
function shift(prev: HistoricalPrediction[], e: Effect): HistoricalPrediction[] {
  return prev.map(({ range, ...p }) => {
    const low = plus(range?.low ?? p.cents, e.low);
    const high = plus(range?.high ?? p.cents, e.high);
    const next = { ...p, cents: plus(p.cents, e.point) };
    return low === high ? next : { ...next, range: { low, high } };
  });
}
const named = (ps: HistoricalPrediction[], prefix: string): HistoricalPrediction[] =>
  ps.map((p) => ({ ...p, id: `${prefix}_${p.id}` }));

const idOf = (ps: HistoricalPrediction[], metric: HistoricalMetric): string =>
  ps.find((p) => p.metric === metric)?.id ?? fail(`no ${metric} prediction`);

/** The saved baseline must be exactly what the frozen bridge inputs produce; a label is not enough. */
function checkBaseline(
  args: QuarterScenarioArgs,
  scenario: HistoricalScenarioInput,
  bridge: QuarterBridge,
  run: HistoricalRun,
  currency: string,
): void {
  const cutoff = args.bridge.knowledgeCutoff;
  if (run.branch.kind !== "baseline") fail("baseline is not a baseline run");
  if (run.id !== scenario.baselineRunId) fail("baseline id differs from the scenario");
  if (run.knowledgeCutoff !== cutoff || scenario.knowledgeCutoff !== cutoff)
    fail("baseline cutoff differs from the bridge or scenario");
  if (run.originBalanceDate !== args.bridge.originBalanceDate)
    fail("baseline origin differs from the bridge");
  if (canon(run.method) !== canon(QUARTER_BRIDGE_METHOD))
    fail("baseline method differs from the quarterly bridge");
  if (canon(run.inputs) !== canon(bridge.inputs))
    fail("baseline inputs differ from the frozen bridge");
  if (canon(sorted(run.predictions)) !== canon(sorted([...bridge.nowcast, ...bridge.forecast])))
    fail("baseline predictions differ from the frozen bridge");
  if (scenario.currency !== currency) fail("scenario currency differs from the case");
  if (scenario.targetDate !== bridge.targetDate) fail("scenario target is not the quarter end");
}

/** The response assumption, its dependencies and the cutoff-safe facts they rest on. */
function responseRefs(c: HistoricalCase, id: string): Ref[] {
  const chain = new Map<string, HistoricalAssumption>();
  const visit = (x: string): void => {
    if (chain.has(x)) return;
    const a = c.assumptions.find((y) => y.id === x) ?? fail(`assumption ${x} not found`);
    chain.set(x, a);
    a.dependsOn.forEach(visit);
  };
  visit(id);
  const all = [...chain.values()];
  // Hindsight basis is later evidence by definition; citing it would leak the future into the graph.
  const facts = new Set(all.filter((a) => a.label !== "hindsight").flatMap((a) => a.basisFactIds));
  return [
    ...all.map((a): Ref => ({ kind: "assumption", id: a.id })),
    ...[...facts].map((f): Ref => ({ kind: "fact", id: f })),
  ];
}

function responseFor(
  args: QuarterScenarioArgs,
  bridge: QuarterBridge,
  c: HistoricalCase,
  id: string,
  selected: boolean,
  eventBranch: HistoricalPrediction[],
): Response {
  if (bridge.inputs.assumptionIds.includes(id))
    fail(`assumption ${id} is already a baseline input`);
  // Reuses A1's cost, lag, closure checks and post-hoc status; nothing is recomputed here.
  const alt = quarterAlternative(args.bridge, id);
  const a = c.assumptions.find((x) => x.id === id) ?? fail(`assumption ${id} not found`);
  if (a.label === "synthetic" || !a.oneTimeCost || a.benefitLagDays === undefined)
    fail(`assumption ${id} is not a costed decision`);
  return {
    assumptionId: a.id,
    label: a.label,
    effectiveFrom: a.effectiveFrom,
    oneTimeCost: a.oneTimeCost,
    benefitLagDays: a.benefitLagDays,
    benefitStart: alt.benefitStart,
    benefitDays: alt.benefitDays,
    feasibleAtCutoff: a.feasibleAtCutoff,
    effectCents: alt.effectCents,
    postHoc: alt.postHoc || selected,
    predictions: named(shift(eventBranch, alt.effectCents), "response"),
  };
}

function responseText(r: Response): string {
  const start = `Pays the upfront cost on ${r.effectiveFrom}.`;
  const benefit =
    r.benefitDays === 0
      ? `Its benefit would start ${r.benefitStart}, after the quarter end, so no benefit is counted inside the quarter and cash is lower by the cost.`
      : `Assumed, not observed: the benefit starts ${r.benefitStart} and runs ${r.benefitDays} days to the quarter end.`;
  const hindsight = r.postHoc ? " Chosen or labelled with hindsight, so it is post-hoc." : "";
  return `${start} ${benefit} Feasibility at the cutoff: ${r.feasibleAtCutoff}.${hindsight}`;
}

/** Every edge states how it is justified and cites only records that exist in the result or case. */
function impactGraph(
  args: QuarterScenarioArgs,
  c: HistoricalCase,
  event: HistoricalScenarioInput["event"],
  currency: string,
  base: HistoricalPrediction[],
  eventBranch: HistoricalPrediction[],
  res: Response | undefined,
): HistoricalScenarioResult["impact"] {
  const T = "cash_including_restricted";
  const U = "cash_and_equivalents";
  const [baseTotal, eventTotal, eventUsable] = [
    idOf(base, T),
    idOf(eventBranch, T),
    idOf(eventBranch, U),
  ];
  const evt: Ref = { kind: "event", id: event.id };
  const pred = (id: string): Ref => ({ kind: "prediction", id });
  const balances: Ref[] = [
    { kind: "fact", id: args.bridge.totalCashFactId },
    { kind: "fact", id: args.bridge.usableCashFactId },
  ];
  const usableText =
    "Usable cash is total cash minus the restricted cash at the last reported balance. The outflow does not change restricted cash.";
  const range = event.additionalOutflowCents;
  const nodes: Node[] = [
    {
      id: "n_event",
      kind: "event",
      refId: event.id,
      label: "Hypothetical extra operating outflow",
    },
    {
      id: "n_base_total",
      kind: "prediction",
      refId: baseTotal,
      label: "Baseline cash including restricted at quarter end",
    },
    {
      id: "n_event_total",
      kind: "prediction",
      refId: eventTotal,
      label: "Cash including restricted after the outflow",
    },
    {
      id: "n_event_usable",
      kind: "prediction",
      refId: eventUsable,
      label: "Usable cash after the outflow",
    },
  ];
  const edges: Edge[] = [
    {
      id: "e_event",
      from: "n_event",
      to: "n_event_total",
      basis: "hypothesis",
      explanation: `Follows only if the hypothetical event happened. Assumption: it adds a total operating outflow of ${range.low} to ${range.high} cents (${currency}) between ${event.effectiveFrom} and ${event.effectiveThrough}, counted once. ${event.uncertainty}`,
      refs: [evt],
    },
    {
      id: "e_base",
      from: "n_base_total",
      to: "n_event_total",
      basis: "deterministic",
      explanation:
        "Baseline quarter-end cash plus the stated outflow range, applied once to the total.",
      refs: [pred(baseTotal), evt],
    },
    {
      id: "e_event_usable",
      from: "n_event_total",
      to: "n_event_usable",
      basis: "deterministic",
      explanation: usableText,
      refs: [pred(eventTotal), ...balances],
    },
  ];
  if (res) {
    const [respTotal, respUsable] = [idOf(res.predictions, T), idOf(res.predictions, U)];
    nodes.push(
      {
        id: "n_resp",
        kind: "response",
        refId: res.assumptionId,
        label: `Response: ${c.assumptions.find((a) => a.id === res.assumptionId)?.description ?? res.assumptionId}`,
      },
      {
        id: "n_resp_total",
        kind: "prediction",
        refId: respTotal,
        label: "Cash including restricted after the response",
      },
      {
        id: "n_resp_usable",
        kind: "prediction",
        refId: respUsable,
        label: "Usable cash after the response",
      },
    );
    edges.push(
      {
        id: "e_resp",
        from: "n_resp",
        to: "n_resp_total",
        basis: "assumption",
        explanation: responseText(res),
        refs: responseRefs(c, res.assumptionId),
      },
      {
        id: "e_event_resp",
        from: "n_event_total",
        to: "n_resp_total",
        basis: "deterministic",
        explanation: "Cash after the outflow plus the response effect, applied once.",
        refs: [pred(eventTotal), { kind: "assumption", id: res.assumptionId }],
      },
      {
        id: "e_resp_usable",
        from: "n_resp_total",
        to: "n_resp_usable",
        basis: "deterministic",
        explanation: usableText,
        refs: [pred(respTotal), ...balances],
      },
    );
  }
  return { nodes, edges };
}

/**
 * Baseline -> hypothetical event -> optional costed response, at the target quarter end.
 * Throws on any mismatch between the saved baseline, the frozen bridge inputs and the scenario.
 */
export function quarterScenario(args: QuarterScenarioArgs): HistoricalScenarioResult {
  const scenario = HistoricalScenarioInputSchema.parse(args.scenario);
  const bridge = quarterBridge(args.bridge);
  const { case: c, run } = HistoricalRunContextSchema.parse({
    case: args.bridge.case,
    run: args.baseline,
  });
  checkBaseline(args, scenario, bridge, run, c.currency);

  const selected = scenario.selectedAfterReveal === true;
  const nowcast = run.predictions.filter((p) => p.kind === "nowcast");
  const baselinePredictions = run.predictions.filter((p) => p.kind === "forecast");
  const effectCents = eventEffect(scenario.event.additionalOutflowCents);
  const eventBranch = shift(baselinePredictions, effectCents);
  const response =
    scenario.responseAssumptionId === undefined
      ? undefined
      : responseFor(args, bridge, c, scenario.responseAssumptionId, selected, eventBranch);
  const eventPredictions = named(eventBranch, "event");
  return HistoricalScenarioResultSchema.parse({
    input: scenario,
    method: { ...QUARTER_SCENARIO_METHOD },
    nowcast,
    baselinePredictions,
    event: { effectCents, postHoc: selected, predictions: eventPredictions },
    ...(response ? { response } : {}),
    postHoc: selected || response?.postHoc === true,
    impact: impactGraph(
      args,
      c,
      scenario.event,
      c.currency,
      baselinePredictions,
      eventPredictions,
      response,
    ),
  });
}
