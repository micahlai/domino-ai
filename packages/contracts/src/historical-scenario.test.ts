import { describe, expect, it } from "vitest";
import { historicalFixtures as fx } from "./fixtures";
import {
  HistoricalRunSchema,
  type HistoricalScenarioInput,
  HistoricalScenarioInputSchema,
  type HistoricalScenarioResult,
  HistoricalScenarioResultSchema,
  type StoredHistoricalScenario,
  StoredHistoricalScenarioSchema,
  type StoredScenarioSnapshot,
  StoredScenarioSnapshotSchema,
} from "./index";

// Invented numbers for schema tests only; not reported data and not a claim about any company.
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
type Result = HistoricalScenarioResult;
type Prediction = Result["nowcast"][number];
/** Localized invalid value: the one place a test says "this is deliberately the wrong type". */
const wrong = <T>(value: unknown): T => value as T;
/** Indexed access that fails loudly, so mutators stay typed under noUncheckedIndexedAccess. */
const at = <T>(list: T[], i: number): T => {
  const item = list[i];
  if (item === undefined) throw new Error(`fixture has no item ${i}`);
  return item;
};
const resp = (r: Result) => {
  if (!r.response) throw new Error("fixture has no response");
  return r.response;
};
const node = (r: Result, i: number) => at(r.impact.nodes, i);
const edge = (r: Result, i: number) => at(r.impact.edges, i);
const evt = (r: Result, i: number) => at(r.event.predictions, i);
/** Predictions in the fixture are instants; this narrows the period union. */
const day = (p: Prediction) => {
  if (p.period.kind !== "instant") throw new Error("fixture period is not an instant");
  return p.period;
};
const bandOf = (p: Prediction) => {
  if (!p.range) throw new Error("fixture prediction has no range");
  return p.range;
};
const messages = (result: {
  success: boolean;
  error?: { issues: { message: string }[] };
}): string[] => (result.success ? [] : result.error!.issues.map((i) => i.message));

const input: HistoricalScenarioInput = {
  baselineRunId: "base_run",
  knowledgeCutoff: "2023-11-09T16:45:46-05:00",
  targetDate: "2023-12-31",
  currency: "USD",
  event: {
    id: "evt1",
    description: "Hypothetical extra operating outflow",
    additionalOutflowCents: { unit: "cents", low: 400_000_000, high: 600_000_000 },
    effectiveFrom: "2023-11-20",
    effectiveThrough: "2023-12-15",
    uncertainty: "Amount and timing are invented for this test.",
  },
  responseAssumptionId: "a1",
};

const pred = (
  id: string,
  kind: Prediction["kind"],
  metric: Prediction["metric"],
  date: string,
  cents: number,
  range?: [number, number],
): Prediction => ({
  id,
  kind,
  metric,
  period: { kind: "instant", date },
  currency: "USD",
  cents,
  ...(range ? { range: { low: range[0], high: range[1] } } : {}),
});
const total = (p: string, c: number, lo: number, hi: number) =>
  pred(`${p}_total`, "forecast", "cash_including_restricted", "2023-12-31", c, [lo, hi]);
const usable = (p: string, c: number, lo: number, hi: number) =>
  pred(`${p}_usable`, "forecast", "cash_and_equivalents", "2023-12-31", c, [lo, hi]);

const result = (): Result => ({
  input: clone(input),
  method: { id: "quarterly_event_bridge", version: "0.1.0" },
  postHoc: false,
  nowcast: [pred("nowcast_total", "nowcast", "cash_including_restricted", "2023-11-09", 9e10)],
  baselinePredictions: [total("base", 100e9, 90e9, 110e9), usable("base", 80e9, 70e9, 90e9)],
  event: {
    effectCents: { low: -600e6, point: -500e6, high: -400e6 },
    postHoc: false,
    predictions: [total("event", 99.5e9, 89.4e9, 109.6e9), usable("event", 79.5e9, 69.4e9, 89.6e9)],
  },
  response: {
    assumptionId: "a1",
    label: "counterfactual",
    effectiveFrom: "2023-12-01",
    oneTimeCost: { unit: "cents", low: 100e6, high: 200e6 },
    benefitLagDays: 31,
    benefitStart: "2024-01-01",
    benefitDays: 0,
    feasibleAtCutoff: "unknown",
    effectCents: { low: -200e6, point: -150e6, high: -100e6 },
    postHoc: false,
    predictions: [total("resp", 99.35e9, 89.2e9, 109.5e9), usable("resp", 79.35e9, 69.2e9, 89.5e9)],
  },
  impact: {
    nodes: [
      { id: "n_event", kind: "event", refId: "evt1", label: "Extra outflow" },
      { id: "n_base", kind: "prediction", refId: "base_total", label: "Baseline cash" },
      { id: "n_evt", kind: "prediction", refId: "event_total", label: "Cash with outflow" },
      { id: "n_resp", kind: "response", refId: "a1", label: "Cost action" },
      { id: "n_out", kind: "prediction", refId: "resp_total", label: "Cash after action" },
    ],
    edges: [
      {
        id: "e1",
        from: "n_event",
        to: "n_evt",
        basis: "hypothesis",
        explanation: "Only if the outflow happened.",
        refs: [{ kind: "event", id: "evt1" }],
      },
      {
        id: "e2",
        from: "n_base",
        to: "n_evt",
        basis: "deterministic",
        explanation: "Baseline plus the stated outflow.",
        refs: [{ kind: "prediction", id: "base_total" }],
      },
      {
        id: "e3",
        from: "n_evt",
        to: "n_out",
        basis: "deterministic",
        explanation: "Event cash plus response effect.",
        refs: [{ kind: "prediction", id: "event_total" }],
      },
      {
        id: "e4",
        from: "n_resp",
        to: "n_out",
        basis: "assumption",
        explanation: "Upfront cost from the case assumption.",
        refs: [{ kind: "assumption", id: "a1" }],
      },
    ],
  },
});

const badInput = (mutate: (i: HistoricalScenarioInput) => void): string[] => {
  const i = clone(input);
  mutate(i);
  return messages(HistoricalScenarioInputSchema.safeParse(i));
};
const bad = (mutate: (r: Result) => void): string[] => {
  const r = result();
  mutate(r);
  return messages(HistoricalScenarioResultSchema.safeParse(r));
};

describe("scenario input", () => {
  it("accepts a valid input and round trips it", () => {
    expect(HistoricalScenarioInputSchema.parse(input)).toEqual(input);
    const { responseAssumptionId: _, ...noResponse } = input;
    expect(HistoricalScenarioInputSchema.safeParse(noResponse).success).toBe(true);
  });

  it("rejects impossible dates and interval order", () => {
    expect(
      badInput((i) => {
        i.event.effectiveFrom = "2023-02-30";
      }),
    ).toContain("expected a real calendar date");
    expect(
      badInput((i) => {
        i.targetDate = "2023-13-01";
      }),
    ).toContain("expected a real calendar date");
    expect(
      badInput((i) => {
        i.knowledgeCutoff = "2023-11-09";
      }),
    ).toContain("expected an ISO timestamp with an explicit offset");
    expect(
      badInput((i) => {
        i.event.effectiveThrough = "2023-11-19";
      }),
    ).toContain("event ends before it starts");
    expect(
      badInput((i) => {
        i.event.effectiveThrough = "2024-01-01";
      }),
    ).toContain("event must end by the target date");
  });

  it("starts strictly after the cutoff local date, not the UTC date", () => {
    const late = (from: string) =>
      badInput((i) => {
        i.knowledgeCutoff = "2023-11-09T23:30:00-05:00"; // already Nov 10 in UTC
        i.event.effectiveFrom = from;
      });
    expect(late("2023-11-09")).toContain("event must start after the cutoff local date");
    expect(late("2023-11-10")).toEqual([]);
    expect(
      badInput((i) => {
        i.event.effectiveFrom = "2023-11-09";
      }),
    ).toContain("event must start after the cutoff local date");
    // A single-day event on the target date is allowed.
    expect(
      badInput((i) => {
        i.event.effectiveFrom = "2023-12-31";
        i.event.effectiveThrough = "2023-12-31";
      }),
    ).toEqual([]);
  });

  it("requires safe integer nonnegative ordered cents", () => {
    const outflow = (patch: Partial<HistoricalScenarioInput["event"]["additionalOutflowCents"]>) =>
      badInput((i) => Object.assign(i.event.additionalOutflowCents, patch));
    expect(outflow({ low: -1 })).not.toEqual([]);
    expect(outflow({ low: 1.5 })).not.toEqual([]);
    expect(outflow({ high: Number.MAX_SAFE_INTEGER + 1 })).not.toEqual([]);
    expect(outflow({ low: 700_000_000 })).toContain("low is above high");
    expect(outflow({ unit: wrong("days") })).not.toEqual([]);
    expect(outflow({ low: 0, high: 0 })).toEqual([]);
  });

  it("refuses observed facts and extra fields as event input", () => {
    for (const extra of [
      { factIds: ["f1"] },
      { observedCents: 5 },
      { thresholdCents: 1 },
      { cents: 5 },
    ])
      expect(badInput((i) => Object.assign(i.event, extra))).toContain(
        `Unrecognized key(s) in object: '${Object.keys(extra)[0]}'`,
      );
    expect(
      badInput((i) => {
        Object.assign(i, { observedFactIds: ["f1"] });
      }),
    ).not.toEqual([]);
  });

  it("rejects blank text and selected-after-reveal without a response", () => {
    expect(
      badInput((i) => {
        i.event.description = "  ";
      }),
    ).toContain("must not be blank");
    expect(
      badInput((i) => {
        i.event.uncertainty = "";
      }),
    ).toContain("must not be blank");
    // An event-only hypothetical can also be chosen after a reveal.
    expect(
      badInput((i) => {
        i.responseAssumptionId = undefined;
        i.selectedAfterReveal = true;
      }),
    ).toEqual([]);
    expect(
      badInput((i) => {
        i.currency = "usd";
      }),
    ).not.toEqual([]);
  });
});

describe("scenario result", () => {
  it("accepts a valid result with and without a response, and round trips it", () => {
    const parsed = HistoricalScenarioResultSchema.parse(result());
    expect(parsed).toEqual(result());
    expect(
      bad((r) => {
        r.input.responseAssumptionId = undefined;
        r.response = undefined;
        r.impact.nodes.splice(3, 2);
        r.impact.edges.splice(2, 2);
      }),
    ).toEqual([]);
  });

  it("requires the response exactly when requested", () => {
    const msg = "response must be present exactly when the input requests one";
    expect(
      bad((r) => {
        r.response = undefined;
      }),
    ).toContain(msg);
    expect(
      bad((r) => {
        r.input.responseAssumptionId = undefined;
      }),
    ).toContain(msg);
    expect(
      bad((r) => {
        resp(r).assumptionId = "a2";
      }),
    ).toContain("response is not the requested assumption");
  });

  it("checks prediction kinds, periods, currency and unique ids", () => {
    expect(
      bad((r) => {
        day(at(r.nowcast, 0)).date = "2023-11-10";
      }),
    ).toContain("a nowcast must end by the cutoff local date");
    expect(
      bad((r) => {
        day(at(r.baselinePredictions, 0)).date = "2023-12-30";
      }),
    ).toContain("a branch forecast must end on the target date");
    expect(
      bad((r) => {
        evt(r, 0).currency = "EUR";
      }),
    ).toContain("prediction currency differs from the scenario");
    expect(
      bad((r) => {
        at(r.nowcast, 0).kind = "forecast";
      }),
    ).toContain("expected a nowcast prediction");
    expect(
      bad((r) => {
        evt(r, 0).id = "base_total";
      }),
    ).toContain("duplicate prediction id");
    expect(
      bad((r) => {
        at(r.baselinePredictions, 0).range = { low: 1.1e11, high: 2e11 };
      }),
    ).toContain("range must contain the point value");
  });

  it("counts the event effect once, exactly", () => {
    const eventEffect = "event effect must be the negated outflow range";
    expect(
      bad((r) => {
        r.event.effectCents.low = -600e6 - 1;
      }),
    ).toContain(eventEffect);
    expect(
      bad((r) => {
        r.event.effectCents.high = -399e6;
      }),
    ).toContain(eventEffect);
    // Subtracting the outflow twice in the event branch is caught against the baseline.
    const twice = "prediction is not the previous branch plus the stated effect";
    expect(
      bad((r) => {
        evt(r, 0).cents = 99e9;
        evt(r, 0).range = { low: 88.8e9, high: 109.2e9 };
      }),
    ).toContain(twice);
    expect(
      bad((r) => {
        bandOf(evt(r, 1)).high += 1;
      }),
    ).toContain(twice);
    expect(
      bad((r) => {
        at(resp(r).predictions, 1).cents -= 1;
      }),
    ).toContain(twice);
    expect(bad((r) => r.event.predictions.pop())).toContain(
      "a branch must predict the same metrics and periods as the one it follows",
    );
    expect(
      bad((r) => {
        r.event.effectCents.point = 0;
      }),
    ).toContain(twice);
    expect(
      bad((r) => {
        r.event.effectCents.point = -700e6;
      }),
    ).toContain("effect must satisfy low <= point <= high");
  });

  it("checks response timing, cost, and post-hoc status", () => {
    expect(
      bad((r) => {
        resp(r).effectiveFrom = "2023-11-09";
      }),
    ).toContain("response must take effect after the cutoff, inside the target quarter");
    expect(
      bad((r) => {
        resp(r).effectiveFrom = "2024-01-02";
      }),
    ).toContain("response must take effect after the cutoff, inside the target quarter");
    expect(
      bad((r) => {
        resp(r).benefitStart = "2024-01-02";
      }),
    ).toContain("benefit start is effectiveFrom plus the lag");
    expect(
      bad((r) => {
        resp(r).benefitDays = 3;
      }),
    ).toContain("benefit days must run from benefit start to the target");
    expect(
      bad((r) => {
        resp(r).effectCents.low = -250e6;
      }),
    ).toContain("with no benefit inside the quarter the effect is the negated cost range");
    expect(
      bad((r) => {
        resp(r).label = wrong("synthetic");
      }),
    ).not.toEqual([]);
    expect(
      bad((r) => {
        resp(r).feasibleAtCutoff = wrong("maybe");
      }),
    ).not.toEqual([]);
    const postHoc = "hindsight or post-reveal choices are post-hoc";
    expect(
      bad((r) => {
        resp(r).label = "hindsight";
      }),
    ).toContain(postHoc);
    expect(
      bad((r) => {
        r.input.selectedAfterReveal = true;
      }),
    ).toContain(postHoc);
    expect(
      bad((r) => {
        r.input.selectedAfterReveal = true;
        r.event.postHoc = true;
        resp(r).postHoc = true;
        r.postHoc = true;
      }),
    ).toEqual([]);
  });

  it("marks an event-only choice after the reveal as post-hoc", () => {
    const eventOnly = (r: Result) => {
      r.input.responseAssumptionId = undefined;
      r.response = undefined;
      r.impact.nodes.splice(3, 2);
      r.impact.edges.splice(2, 2);
      r.input.selectedAfterReveal = true;
    };
    expect(bad(eventOnly)).toContain("an event chosen after the reveal is post-hoc");
    expect(
      bad((r) => {
        eventOnly(r);
        r.event.postHoc = true;
      }),
    ).toContain("scenario post-hoc must be true exactly when the event or response is");
    expect(
      bad((r) => {
        eventOnly(r);
        r.event.postHoc = true;
        r.postHoc = true;
      }),
    ).toEqual([]);
    // A post-hoc response taints the scenario even when the event is not post-hoc.
    expect(
      bad((r) => {
        resp(r).label = "hindsight";
        resp(r).postHoc = true;
      }),
    ).toContain("scenario post-hoc must be true exactly when the event or response is");
    expect(
      bad((r) => {
        resp(r).label = "hindsight";
        resp(r).postHoc = true;
        r.postHoc = true;
      }),
    ).toEqual([]);
  });

  it("accepts a benefit that starts inside the quarter without constraining its size", () => {
    expect(
      bad((r) => {
        resp(r).benefitLagDays = 10;
        resp(r).benefitStart = "2023-12-11";
        resp(r).benefitDays = 21; // Dec 11..Dec 31 inclusive
        resp(r).effectCents = { low: -150e6, point: 0, high: 900e6 };
        resp(r).predictions = [
          total("resp", 99.5e9, 89.25e9, 110.5e9),
          usable("resp", 79.5e9, 69.25e9, 90.5e9),
        ];
      }),
    ).toEqual([]);
  });

  it("rejects bad graph structure and references", () => {
    expect(
      bad((r) => {
        node(r, 1).id = "n_event";
      }),
    ).toContain("duplicate node id");
    expect(
      bad((r) => {
        edge(r, 1).id = "e1";
      }),
    ).toContain("duplicate edge id");
    expect(
      bad((r) => {
        edge(r, 0).to = "ghost";
      }),
    ).toContain("edge node not found");
    expect(
      bad((r) => {
        edge(r, 0).from = "ghost";
      }),
    ).toContain("edge node not found");
    expect(
      bad((r) => {
        node(r, 1).refId = "nope";
      }),
    ).toContain("prediction node does not match the result");
    expect(
      bad((r) => {
        node(r, 0).refId = "other";
      }),
    ).toContain("event node does not match the result");
    expect(
      bad((r) => {
        node(r, 3).refId = "a2";
      }),
    ).toContain("response node does not match the result");
    expect(
      bad((r) => {
        node(r, 2).refId = "base_total";
      }),
    ).toContain("two nodes for the same record");
    expect(
      bad((r) =>
        r.impact.nodes.push({ id: "n_event2", kind: "event", refId: "evt1", label: "Again" }),
      ),
    ).toContain("the graph needs exactly one event node");
    expect(bad((r) => r.impact.nodes.splice(0, 1))).toContain(
      "the graph needs exactly one event node",
    );
    expect(
      bad((r) => {
        edge(r, 1).refs = [];
      }),
    ).not.toEqual([]);
    expect(
      bad((r) => {
        edge(r, 1).explanation = " ";
      }),
    ).toContain("must not be blank");
    expect(
      bad((r) => {
        edge(r, 1).basis = wrong("guess");
      }),
    ).not.toEqual([]);
    expect(
      bad((r) => {
        edge(r, 1).refs = [{ kind: wrong("metric"), id: "x" }];
      }),
    ).not.toEqual([]);
  });

  it("checks typed edge refs and the ref each basis needs", () => {
    expect(
      bad((r) => {
        edge(r, 0).refs = [{ kind: "event", id: "other" }];
      }),
    ).toContain("event ref does not match the result");
    expect(
      bad((r) => {
        edge(r, 1).refs = [{ kind: "prediction", id: "nope" }];
      }),
    ).toContain("prediction ref does not match the result");
    expect(
      bad((r) => {
        edge(r, 0).refs = [{ kind: "fact", id: "f1" }];
      }),
    ).toContain("a hypothesis edge must cite a event ref");
    expect(
      bad((r) => {
        edge(r, 3).refs = [{ kind: "fact", id: "f1" }];
      }),
    ).toContain("a assumption edge must cite a assumption ref");
    expect(
      bad((r) => {
        edge(r, 3).basis = "rule";
      }),
    ).toContain("a rule edge must cite a rule ref");
    // Fact, assumption and rule refs are structural here; the engine proves they exist.
    expect(
      bad((r) => {
        edge(r, 3).basis = "rule";
        edge(r, 3).refs = [{ kind: "rule", id: "analyst_floor" }];
      }),
    ).toEqual([]);
  });

  it("rejects cycles and self loops", () => {
    const cycle = "impact graph has a cycle";
    expect(
      bad((r) =>
        r.impact.edges.push({
          id: "back",
          from: "n_out",
          to: "n_base",
          basis: "deterministic",
          explanation: "Loops back.",
          refs: [{ kind: "prediction", id: "resp_total" }],
        }),
      ),
    ).toContain(cycle);
    expect(
      bad((r) =>
        r.impact.edges.push({
          id: "self",
          from: "n_evt",
          to: "n_evt",
          basis: "deterministic",
          explanation: "Itself.",
          refs: [{ kind: "prediction", id: "event_total" }],
        }),
      ),
    ).toContain(cycle);
    expect(bad(() => {})).toEqual([]);
  });

  it("has no threshold, default or insolvency fields, and rejects extras", () => {
    expect(
      bad((r) => {
        Object.assign(r, { minCashCents: 0 });
      }),
    ).not.toEqual([]);
    expect(
      bad((r) => {
        Object.assign(r, { insolvent: false });
      }),
    ).not.toEqual([]);
    expect(
      bad((r) => {
        Object.assign(node(r, 0), { severity: "high" });
      }),
    ).not.toEqual([]);
    expect(
      bad((r) => {
        Object.assign(resp(r), { thresholdCents: 1 });
      }),
    ).not.toEqual([]);
  });
});

describe("dirty money values fail without throwing", () => {
  // Zod still runs result-level checks on values that failed the safe-integer checks.
  const fails = (mutate: (r: Result) => void) => {
    const r = result();
    mutate(r);
    expect(() => HistoricalScenarioResultSchema.safeParse(r)).not.toThrow();
    expect(HistoricalScenarioResultSchema.safeParse(r).success).toBe(false);
  };

  it.each([1.5, Number.POSITIVE_INFINITY])("rejects %s in baseline cents", (bad) => {
    fails((r) => {
      at(r.baselinePredictions, 0).cents = bad;
    });
  });

  it.each([1.5, Number.POSITIVE_INFINITY])("rejects %s in the event effect point", (bad) => {
    fails((r) => {
      r.event.effectCents.point = bad;
    });
  });

  it.each([1.5, Number.POSITIVE_INFINITY])("rejects %s in a forecast range", (bad) => {
    fails((r) => {
      bandOf(at(r.baselinePredictions, 0)).low = bad;
    });
    fails((r) => {
      bandOf(evt(r, 0)).high = bad;
    });
  });

  it.each([1.5, Number.POSITIVE_INFINITY])("rejects %s in the response effect", (bad) => {
    fails((r) => {
      resp(r).effectCents.high = bad;
    });
  });
});

describe("existing contracts stay closed to scenarios", () => {
  it("does not widen the historical run branch union", () => {
    const run = { ...clone(fx.baselineRun), branch: { kind: "event" } };
    expect(HistoricalRunSchema.safeParse(run).success).toBe(false);
    expect(HistoricalRunSchema.safeParse(fx.baselineRun).success).toBe(true);
  });
});

describe("stored scenario envelope", () => {
  const sha = (c: string) => c.repeat(64);
  const stored = (): StoredHistoricalScenario => ({
    schemaVersion: 1,
    id: "scn_resp",
    caseId: "case1",
    createdAt: "2026-10-24T12:00:00-07:00",
    baselineRunId: "base_run",
    parentRunId: "scn_event",
    baselineRowHash: sha("a"),
    baselineInputHash: sha("b"),
    scenarioInputHash: sha("c"),
    scenarioInput: clone(input),
    result: result(),
    taint: {
      eventSelectedAfterReveal: false,
      responseSelectedAfterReveal: false,
      protocolResponsePostHoc: false,
      assumptionPostHoc: false,
    },
  });
  const badStored = (mutate: (s: StoredHistoricalScenario) => void): string[] => {
    const s = stored();
    mutate(s);
    return messages(StoredHistoricalScenarioSchema.safeParse(s));
  };

  it("accepts a response envelope and an event-only envelope", () => {
    expect(StoredHistoricalScenarioSchema.safeParse(stored()).success).toBe(true);
    expect(
      badStored((s) => {
        s.scenarioInput.responseAssumptionId = undefined;
        s.result = { ...s.result, input: clone(s.scenarioInput) };
        s.result.response = undefined;
        s.result.impact.nodes = s.result.impact.nodes.slice(0, 3);
        s.result.impact.edges = s.result.impact.edges.slice(0, 2);
        s.parentRunId = "base_run";
        s.id = "scn_event";
      }),
    ).toEqual([]);
  });

  it("pins lineage: input, baseline and parent", () => {
    expect(
      badStored((s) => {
        s.result.input.targetDate = "2023-12-30";
      }),
    ).toContain("result input differs from the stored scenario input");
    expect(
      badStored((s) => {
        s.baselineRunId = "other";
      }),
    ).toContain("scenario input names another baseline");
    expect(
      badStored((s) => {
        s.parentRunId = "base_run";
      }),
    ).toContain("an event's parent is the baseline; a response's parent is its event scenario");
    expect(
      badStored((s) => {
        s.baselineRowHash = "x";
      }),
    ).toContain("expected a lowercase sha256 hex digest");
  });

  it("taint elevates post-hoc and needs a reason", () => {
    expect(
      badStored((s) => {
        s.taint.protocolResponsePostHoc = true;
        s.taint.reason = "A1 is post-hoc by protocol.";
      }),
    ).toContain("response taint must mark the response post-hoc");
    expect(
      badStored((s) => {
        s.taint.eventSelectedAfterReveal = true;
        s.taint.reason = "Chosen after reveal.";
      }),
    ).toContain("event taint must mark the event post-hoc");
    expect(
      badStored((s) => {
        s.taint.assumptionPostHoc = true;
      }),
    ).toContain("a set taint flag needs a reason");
    expect(
      badStored((s) => {
        s.taint.protocolResponsePostHoc = true;
        s.taint.reason = "A1 is post-hoc by protocol.";
        resp(s.result).postHoc = true;
        s.result.postHoc = true;
      }),
    ).toEqual([]);
  });

  it("a response inherits the parent event taint", () => {
    expect(
      badStored((s) => {
        s.taint.eventSelectedAfterReveal = true;
        s.taint.reason = "Event chosen after reveal.";
        s.result.event.postHoc = true;
        s.result.postHoc = true;
      }),
    ).toContain("event taint must mark the response post-hoc");
  });

  it("does not parse as a legacy run", () => {
    expect(HistoricalRunSchema.safeParse(stored()).success).toBe(false);
  });

  const snap = (): StoredScenarioSnapshot => ({
    baselineSnapshot: { any: "baseline bytes" },
    baselineSnapshotHash: sha("d"),
    responseExtension: {
      sources: clone(fx.historicalCase.sources),
      facts: clone(fx.historicalCase.facts),
      assumptions: clone(fx.historicalCase.assumptions),
      selectedAssumptionId: at(fx.historicalCase.assumptions, 0).id,
      contentHash: sha("e"),
    },
    protocolSnapshot: {
      protocolId: "p1",
      protocolHash: sha("f"),
      responsePostHoc: true,
      responsePostHocReason: "Response chosen with hindsight.",
      caveats: {
        method: "Uniform daily flow.",
        cost: "Cost is a range.",
        unknownDownside: "Downside unknown.",
      },
    },
    knowledgeVersionIds: [],
    legacyKnowledge: true,
  });
  const badSnap = (mutate: (s: StoredScenarioSnapshot) => void): string[] => {
    const s = snap();
    mutate(s);
    return messages(StoredScenarioSnapshotSchema.safeParse(s));
  };

  it("rejects cyclic or self-dependent extension assumptions", () => {
    const a0 = at(fx.historicalCase.assumptions, 0).id;
    expect(
      badSnap((s) => {
        at(s.responseExtension!.assumptions, 0).dependsOn = [a0];
      }),
    ).toContain("an assumption may depend only on assumptions listed before it");
  });

  it("accepts a pinned snapshot and rejects broken closure or untagged empty knowledge", () => {
    expect(badSnap(() => {})).toEqual([]);
    expect(
      badSnap((s) => {
        s.legacyKnowledge = false;
      }),
    ).toContain("knowledge versions are empty exactly when tagged legacy");
    expect(
      badSnap((s) => {
        s.responseExtension!.sources = [];
      }),
    ).toContain("fact source missing from closure");
    expect(
      badSnap((s) => {
        s.responseExtension!.selectedAssumptionId = "nope";
      }),
    ).toContain("selected assumption is not in the extension");
    expect(
      badSnap((s) => {
        s.protocolSnapshot.responsePostHocReason = undefined;
      }),
    ).toContain("a post-hoc protocol response needs a reason, and only it has one");
    expect(
      badSnap((s) => {
        (s as Partial<StoredScenarioSnapshot>).baselineSnapshot = undefined;
      }).length,
    ).toBeGreaterThan(0);
  });
});
