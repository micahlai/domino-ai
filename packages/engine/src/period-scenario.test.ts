import {
  type HistoricalCase,
  type HistoricalPrediction,
  type HistoricalRun,
  type HistoricalScenarioInput,
  HistoricalScenarioResultSchema,
} from "@domino/contracts";
import { historicalFixtures as fx } from "@domino/contracts/fixtures";
import { describe, expect, it } from "vitest";
import { quarterBridge } from "./period";
import { type QuarterScenarioArgs, quarterScenario } from "./period-scenario";

/**
 * SYNTHETIC ONLY: the fictional 2031 fixture company, same case as period.test.ts, and an
 * invented hypothetical outflow. Nothing here is evidence about a real company.
 * Hand math, M = $1m = 100_000_000 cents. Baseline at 12/31 (from period.test.ts):
 * total 64M (63M..65M), usable 59M (58M..60M), restricted 5M. Nowcast is 11/10.
 * Event 5M point: total 59M (58M..60M), usable 54M (53M..55M).
 */
const M = (m: number) => m * 100_000_000;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const q3 = fx.historicalCase.sources[0]!.publishedAt;

function synthCase(): HistoricalCase {
  const c = clone(fx.historicalCase);
  const ytd = { kind: "duration", start: "2031-01-01", end: "2031-09-30" } as const;
  const flow = { kind: "reported", currency: "USD", availableAt: q3, sourceId: "src_q3" } as const;
  c.facts.push(
    {
      ...flow,
      id: "f_ocf_ytd",
      metric: "operating_cash_flow",
      period: ytd,
      cents: M(-27),
      locator: "Cash flow statement, operating",
      reportedScale: "thousands",
    },
    {
      ...flow,
      id: "f_icf_ytd",
      metric: "investing_cash_flow",
      period: ytd,
      cents: M(-3),
      locator: "Cash flow statement, investing",
      reportedScale: "thousands",
    },
  );
  const common = {
    basisFactIds: [] as string[],
    dependsOn: [] as string[],
    effectiveFrom: "2031-10-01",
    feasibleAtCutoff: "yes" as const,
    selectedAfterReveal: false,
  };
  c.assumptions.push(
    {
      ...common,
      id: "a_fin",
      label: "synthetic",
      description: "Financing per quarter, unknown",
      value: { unit: "cents", low: M(-2), high: 0 },
    },
    {
      ...common,
      id: "a_fx",
      label: "synthetic",
      description: "FX per quarter, none expected",
      value: { unit: "cents", low: 0, high: 0 },
    },
  );
  return c;
}

const bridgeOf = (c: HistoricalCase) => ({
  case: c,
  knowledgeCutoff: fx.cutoff,
  originBalanceDate: "2031-09-30",
  usableCashFactId: "f_cash_q3",
  totalCashFactId: "f_total_q3",
  operatingYtdFactId: "f_ocf_ytd",
  investingYtdFactId: "f_icf_ytd",
  financingAssumptionId: "a_fin",
  fxAssumptionId: "a_fx",
});

const outflow = (low: number, high: number) => ({ unit: "cents" as const, low, high });
const scenarioOf = (over: Partial<HistoricalScenarioInput> = {}): HistoricalScenarioInput => ({
  baselineRunId: "run_base",
  knowledgeCutoff: fx.cutoff,
  targetDate: "2031-12-31",
  currency: "USD",
  event: {
    id: "evt_hyp",
    description: "Hypothetical extra operating outflow (invented)",
    additionalOutflowCents: outflow(M(5), M(5)),
    effectiveFrom: "2031-11-20",
    effectiveThrough: "2031-12-15",
    uncertainty: "Invented amount and timing; no such event is claimed.",
  },
  ...over,
});

function args(
  mutate: (c: HistoricalCase) => void = () => {},
  scenario: HistoricalScenarioInput = scenarioOf(),
): QuarterScenarioArgs {
  const c = synthCase();
  mutate(c);
  const bridge = bridgeOf(c);
  const b = quarterBridge(bridge);
  const baseline: HistoricalRun = {
    ...fx.baselineRun,
    id: "run_base",
    inputs: b.inputs,
    predictions: [...b.nowcast, ...b.forecast],
  };
  return { bridge, baseline, scenario };
}

/** A1 as in the real case: costs 1M..2M, benefit starts after the target quarter, feasibility unknown. */
const a1 = (c: HistoricalCase) => {
  const a = c.assumptions.find((x) => x.id === "a_cut")!;
  a.benefitLagDays = 60;
  a.feasibleAtCutoff = "unknown";
};
const withResponse = scenarioOf({ responseAssumptionId: "a_cut" });
const edit =
  (id: string, f: (a: HistoricalCase["assumptions"][number]) => void) => (c: HistoricalCase) =>
    f(c.assumptions.find((x) => x.id === id)!);

const find = (ps: HistoricalPrediction[], id: string) => ps.find((p) => p.id === id)!;
const cashOf = (ps: HistoricalPrediction[], p: string) => [
  find(ps, `${p}_total`),
  find(ps, `${p}_usable`),
];
const restricted = (t: HistoricalPrediction, u: HistoricalPrediction) => ({
  point: t.cents - u.cents,
  low: t.range!.low - u.range!.low,
  high: t.range!.high - u.range!.high,
});

describe("quarterScenario event", () => {
  it("is the identity for a zero outflow", () => {
    const a = args(
      () => {},
      scenarioOf({
        event: { ...scenarioOf().event, additionalOutflowCents: outflow(0, 0) },
      }),
    );
    const r = quarterScenario(a);
    expect(r.event.effectCents).toEqual({ low: 0, point: 0, high: 0 });
    expect(r.event.predictions).toEqual(
      r.baselinePredictions.map((p) => ({ ...p, id: `event_${p.id}` })),
    );
    expect(r.response).toBeUndefined();
    expect([r.postHoc, r.event.postHoc]).toEqual([false, false]);
  });

  it("subtracts a $5M hypothetical outflow once and keeps restricted cash apart", () => {
    const r = quarterScenario(args());
    expect(r.event.effectCents).toEqual({ low: -M(5), point: -M(5), high: -M(5) });
    expect(find(r.event.predictions, "event_target_total")).toMatchObject({
      kind: "forecast",
      cents: M(59),
      range: { low: M(58), high: M(60) },
    });
    expect(find(r.event.predictions, "event_target_usable")).toMatchObject({
      cents: M(54),
      range: { low: M(53), high: M(55) },
    });
    // Restricted cash is 5M at the point and at both ends, as in the baseline.
    const [t, u] = cashOf(r.event.predictions, "event_target");
    const [bt, bu] = cashOf(r.baselinePredictions, "target");
    expect(restricted(t!, u!)).toEqual({ point: M(5), low: M(5), high: M(5) });
    expect(restricted(t!, u!)).toEqual(restricted(bt!, bu!));
    // Event minus baseline is the stated amount, not amount times days.
    expect(t!.cents - bt!.cents).toBe(-M(5));
  });

  it("keeps the saved nowcast and baseline predictions exactly", () => {
    const a = args();
    const r = quarterScenario(a);
    expect(r.nowcast).toEqual(a.baseline.predictions.filter((p) => p.kind === "nowcast"));
    expect(find(r.nowcast, "nowcast_total").cents).toBe(7_009_782_609);
    expect(r.baselinePredictions).toEqual(
      a.baseline.predictions.filter((p) => p.kind === "forecast"),
    );
  });

  it("does not depend on the interval length inside the quarter", () => {
    const one = quarterScenario(
      args(() => {}, scenarioOf({ event: { ...scenarioOf().event, effectiveFrom: "2031-12-15" } })),
    );
    const long = quarterScenario(
      args(
        () => {},
        scenarioOf({
          event: {
            ...scenarioOf().event,
            effectiveFrom: "2031-11-11",
            effectiveThrough: "2031-12-31",
          },
        }),
      ),
    );
    expect(one.event).toEqual(long.event);
  });

  it("puts the low end at the highest outflow and rounds the midpoint half toward positive", () => {
    // 1..4 cents: point -2.5 rounds to -2. Total 6_400_000_000 (6_300_000_000..6_500_000_000).
    const r = quarterScenario(
      args(
        () => {},
        scenarioOf({ event: { ...scenarioOf().event, additionalOutflowCents: outflow(1, 4) } }),
      ),
    );
    expect(r.event.effectCents).toEqual({ low: -4, point: -2, high: -1 });
    expect(find(r.event.predictions, "event_target_total")).toMatchObject({
      cents: 6_399_999_998,
      range: { low: 6_299_999_996, high: 6_499_999_999 },
    });
    // 0..1 cents: point -0.5 rounds to 0 (never -0); the point value is unchanged.
    const z = quarterScenario(
      args(
        () => {},
        scenarioOf({ event: { ...scenarioOf().event, additionalOutflowCents: outflow(0, 1) } }),
      ),
    );
    expect(Object.is(z.event.effectCents.point, 0)).toBe(true);
    expect(find(z.event.predictions, "event_target_total")).toMatchObject({
      cents: 6_400_000_000,
      range: { low: 6_299_999_999, high: 6_500_000_000 },
    });
  });

  it("marks an event chosen after the reveal as post-hoc even without a response", () => {
    const r = quarterScenario(args(() => {}, scenarioOf({ selectedAfterReveal: true })));
    expect([r.event.postHoc, r.postHoc]).toEqual([true, true]);
  });
});

describe("quarterScenario response", () => {
  it("composes A1 cost with no benefit in the quarter as a harmful response", () => {
    const r = quarterScenario(args(a1, withResponse));
    const res = r.response!;
    // Lag 60 from 11/11 starts 2032-01-10, after the 12/31 target: cost only, 1M..2M.
    expect([res.benefitStart, res.benefitDays]).toEqual(["2032-01-10", 0]);
    expect(res.effectCents).toEqual({ low: -M(2), point: -M(1.5), high: -M(1) });
    // Event branch 59M (58M..60M) plus the effect, not the baseline.
    expect(find(res.predictions, "response_target_total")).toMatchObject({
      cents: 5_750_000_000,
      range: { low: 5_600_000_000, high: 5_900_000_000 },
    });
    expect(find(res.predictions, "response_target_usable")).toMatchObject({
      cents: 5_250_000_000,
      range: { low: 5_100_000_000, high: 5_400_000_000 },
    });
    // Unknown feasibility is preserved, not turned into yes; no hindsight anywhere.
    expect([res.feasibleAtCutoff, res.label, res.postHoc, r.postHoc]).toEqual([
      "unknown",
      "counterfactual",
      false,
      false,
    ]);
    expect(res.oneTimeCost).toEqual({ unit: "cents", low: M(1), high: M(2) });
  });

  it("reports a beneficial synthetic response with its assumed in-quarter benefit", () => {
    // Fixture a_cut: benefit from 12/11 for 21 of 92 days, value 20M..60M per quarter, cost 1M..2M.
    // low 2e9*21/92 - 2e8 = 256_521_739.13; point 4e9*21/92 - 1.5e8 = 763_043_478.26;
    // high 6e9*21/92 - 1e8 = 1_269_565_217.39.
    const r = quarterScenario(
      args(
        edit("a_cut", (a) => {
          a.value = { unit: "cents", low: M(20), high: M(60) };
        }),
        withResponse,
      ),
    );
    const res = r.response!;
    expect([res.benefitStart, res.benefitDays]).toEqual(["2031-12-11", 21]);
    expect(res.effectCents).toEqual({ low: 256_521_739, point: 763_043_478, high: 1_269_565_217 });
    expect(find(res.predictions, "response_target_total")).toMatchObject({
      cents: 6_663_043_478,
      range: { low: 6_056_521_739, high: 7_269_565_217 },
    });
    expect(find(res.predictions, "response_target_usable").cents).toBe(6_163_043_478);
    const why = r.impact.edges.find((e) => e.id === "e_resp")!.explanation;
    expect(why).toContain("Assumed, not observed");
  });

  it("keeps A1's own post-hoc status and a hindsight label, and never cites later facts", () => {
    const after = quarterScenario(
      args(
        edit("a_cut", (a) => {
          a.selectedAfterReveal = true;
        }),
        withResponse,
      ),
    );
    expect([after.event.postHoc, after.response!.postHoc, after.postHoc]).toEqual([
      false,
      true,
      true,
    ]);

    const hind = quarterScenario(
      args(
        edit("a_cut", (a) => {
          a.label = "hindsight";
          a.basisFactIds = ["f_cash_fy"];
        }),
        withResponse,
      ),
    );
    expect([hind.response!.label, hind.response!.postHoc, hind.postHoc]).toEqual([
      "hindsight",
      true,
      true,
    ]);
    const refs = hind.impact.edges.flatMap((e) => e.refs.map((x) => x.id));
    expect(refs).not.toContain("f_cash_fy");

    const reveal = quarterScenario(args(() => {}, { ...withResponse, selectedAfterReveal: true }));
    expect([reveal.event.postHoc, reveal.response!.postHoc, reveal.postHoc]).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("rejects responses that are unknown, unsupported or leak later evidence", () => {
    const run = (m: (c: HistoricalCase) => void, id = "a_cut") =>
      quarterScenario(args(m, scenarioOf({ responseAssumptionId: id })));
    expect(() => run(() => {}, "a_missing")).toThrow(/assumption a_missing not found/);
    expect(() => run(() => {}, "a_fin")).toThrow(/already a baseline input/);
    expect(() =>
      run(
        edit("a_cut", (a) => {
          a.label = "synthetic";
        }),
      ),
    ).toThrow(/counterfactual or hindsight/);
    expect(() =>
      run(
        edit("a_cut", (a) => {
          a.oneTimeCost = undefined;
        }),
      ),
    ).toThrow(/needs cost and lag/);
    expect(() =>
      run(
        edit("a_cut", (a) => {
          a.effectiveFrom = "2031-11-10";
        }),
      ),
    ).toThrow(/after the cutoff/);
    expect(() =>
      run(
        edit("a_cut", (a) => {
          a.basisFactIds = ["f_cash_fy"];
        }),
      ),
    ).toThrow(/basis f_cash_fy is late/);
    expect(() =>
      run(
        edit("a_cut", (a) => {
          a.dependsOn = ["a_nope"];
        }),
      ),
    ).toThrow();
  });

  it("refuses a branch that would leave safe integer cents", () => {
    const huge = Number.MAX_SAFE_INTEGER;
    const s = scenarioOf({
      responseAssumptionId: "a_cut",
      event: { ...scenarioOf().event, additionalOutflowCents: outflow(huge, huge) },
    });
    expect(() =>
      quarterScenario(
        args(
          edit("a_cut", (a) => {
            a.oneTimeCost = { unit: "cents", low: huge, high: huge };
          }),
          s,
        ),
      ),
    ).toThrow(/outside safe integer cents/);
    const unsafe = scenarioOf({
      event: { ...scenarioOf().event, additionalOutflowCents: outflow(0, huge + 1) },
    });
    expect(() => quarterScenario(args(() => {}, unsafe))).toThrow();
  });
});

describe("quarterScenario inputs", () => {
  it("rejects a saved baseline that is not what the frozen bridge produces", () => {
    const bad = (m: (b: HistoricalRun) => void, s = scenarioOf()) => {
      const a = args(() => {}, s);
      m(a.baseline);
      return () => quarterScenario(a);
    };
    expect(
      bad((b) => {
        b.id = "run_other";
      }),
    ).toThrow(/baseline id differs/);
    expect(
      bad((b) => {
        b.knowledgeCutoff = "2031-11-10T22:00:00-05:00";
      }),
    ).toThrow(/cutoff differs/);
    expect(
      bad((b) => {
        b.method = { ...b.method, version: "9.9.9" };
      }),
    ).toThrow(/method differs/);
    expect(
      bad((b) => {
        b.inputs.factIds = b.inputs.factIds.filter((f) => f !== "f_icf_ytd");
      }),
    ).toThrow(/inputs differ/);
    expect(
      bad((b) => {
        b.predictions.find((p) => p.id === "target_total")!.cents += 1;
      }),
    ).toThrow(/predictions differ/);
    expect(
      bad((b) => {
        b.predictions.find((p) => p.id === "nowcast_total")!.cents += 1;
      }),
    ).toThrow(/predictions differ/);
    expect(bad((b) => b.predictions.pop())).toThrow(/predictions differ/);
    expect(
      bad((b) => {
        b.originBalanceDate = "2031-09-29";
      }),
    ).toThrow();
    expect(
      bad((b) => {
        b.branch = {
          kind: "alternative",
          baselineRunId: "x",
          decisionAssumptionIds: ["a_cut"],
          postHoc: false,
        };
      }),
    ).toThrow();
    expect(bad(() => {}, scenarioOf({ baselineRunId: "run_other" }))).toThrow(
      /baseline id differs/,
    );
  });

  it("accepts the same baseline saved with keys in another order", () => {
    const a = args();
    // Reverse every object's key order, as a store that reorders keys would.
    const flip = (_: string, x: unknown) =>
      x && typeof x === "object" && !Array.isArray(x)
        ? Object.fromEntries(Object.entries(x).reverse())
        : x;
    a.baseline = JSON.parse(JSON.stringify(a.baseline, flip)) as HistoricalRun;
    expect(Object.keys(a.baseline)[0]).not.toBe(Object.keys(args().baseline)[0]);
    expect(() => quarterScenario(a)).not.toThrow();
  });

  it("rejects wrong currency, target, cutoff, impossible dates and window leakage", () => {
    const run =
      (s: Partial<HistoricalScenarioInput>, event = {}) =>
      () =>
        quarterScenario(
          args(() => {}, scenarioOf({ ...s, event: { ...scenarioOf().event, ...event } })),
        );
    expect(run({ currency: "EUR" })).toThrow(/currency differs/);
    expect(run({ targetDate: "2031-12-30" })).toThrow(/not the quarter end/);
    expect(run({ knowledgeCutoff: "2031-11-10T23:59:58-05:00" })).toThrow(/cutoff differs/);
    expect(run({}, { effectiveFrom: "2031-11-10" })).toThrow(/after the cutoff local date/);
    expect(run({}, { effectiveThrough: "2032-01-01" })).toThrow(/end by the target date/);
    expect(run({}, { effectiveFrom: "2031-02-30" })).toThrow(/real calendar date/);
    expect(run({}, { effectiveThrough: "2031-11-19" })).toThrow(/ends before it starts/);
    // Strict input: smuggled thresholds or observed values are rejected, not dropped.
    expect(run({ ...({ thresholdCents: M(50) } as object) })).toThrow();
  });

  it("is deterministic and never edits what it was given", () => {
    const freeze = <T>(v: T): T => {
      if (v && typeof v === "object") for (const x of Object.values(v)) freeze(x);
      return Object.freeze(v);
    };
    const a = args(a1, withResponse);
    const before = JSON.stringify(a);
    const one = quarterScenario(freeze(a));
    expect(JSON.stringify(a)).toBe(before);
    expect(quarterScenario(a)).toEqual(one);
  });
});

describe("quarterScenario impact graph", () => {
  const r = quarterScenario(args(a1, withResponse));
  const c = synthCase();

  it("passes the frozen result contract", () => {
    expect(HistoricalScenarioResultSchema.safeParse(r).success).toBe(true);
    expect(r.method).toEqual({ id: "quarterly_event_bridge", version: "0.1.0" });
  });

  it("states a basis for every link and cites only records that exist at the cutoff", () => {
    const bases = Object.fromEntries(r.impact.edges.map((e) => [e.id, e.basis]));
    expect(bases).toEqual({
      e_event: "hypothesis",
      e_base: "deterministic",
      e_event_usable: "deterministic",
      e_resp: "assumption",
      e_event_resp: "deterministic",
      e_resp_usable: "deterministic",
    });
    const refs = r.impact.edges.flatMap((e) => e.refs);
    for (const x of refs.filter((y) => y.kind === "fact")) {
      const f = c.facts.find((y) => y.id === x.id)!;
      expect(Date.parse(f.availableAt)).toBeLessThanOrEqual(Date.parse(fx.cutoff));
    }
    expect(
      refs
        .filter((y) => y.kind === "assumption")
        .every((y) => c.assumptions.some((a) => a.id === y.id)),
    ).toBe(true);
    const resp = r.impact.edges.find((e) => e.id === "e_resp")!;
    expect(resp.refs).toEqual([
      { kind: "assumption", id: "a_cut" },
      { kind: "fact", id: "f_cash_q3" },
    ]);
    expect(r.impact.edges.find((e) => e.id === "e_event")!.refs).toEqual([
      { kind: "event", id: "evt_hyp" },
    ]);
  });

  it("keeps every dependency of the response in its edge", () => {
    const dep = quarterScenario(
      args((cc) => {
        cc.assumptions.unshift({
          ...cc.assumptions.find((x) => x.id === "a_fx")!,
          id: "a_dep",
          label: "counterfactual",
          basisFactIds: ["f_restricted_q3"],
        });
        edit("a_cut", (a) => {
          a.dependsOn = ["a_dep"];
        })(cc);
      }, withResponse),
    );
    expect(dep.impact.edges.find((e) => e.id === "e_resp")!.refs).toEqual([
      { kind: "assumption", id: "a_cut" },
      { kind: "assumption", id: "a_dep" },
      { kind: "fact", id: "f_cash_q3" },
      { kind: "fact", id: "f_restricted_q3" },
    ]);
  });

  it("says the amount is an assumption and invents no rule, default or invoice", () => {
    const text = JSON.stringify(r.impact);
    expect(r.impact.edges.find((e) => e.id === "e_event")!.explanation).toMatch(
      /Assumption: it adds a total operating outflow of 500000000 to 500000000 cents/,
    );
    expect(r.impact.edges.some((e) => e.refs.some((x) => x.kind === "rule"))).toBe(false);
    expect(text).not.toMatch(/bankrupt|default|threshold|invoice|insolven/i);
    expect(r.impact.nodes.map((n) => n.kind)).toEqual([
      "event",
      "prediction",
      "prediction",
      "prediction",
      "response",
      "prediction",
      "prediction",
    ]);
  });
});
