import { describe, expect, it } from "vitest";
import { historicalFixtures as fx } from "./fixtures";
import {
  HistoricalRunSchema,
  HistoricalScenarioInputSchema,
  HistoricalScenarioResultSchema,
} from "./index";

// Invented numbers for schema tests only; not reported data and not a claim about any company.
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
// biome-ignore lint/suspicious/noExplicitAny: mutators deliberately corrupt deep, invalid shapes
type Json = Record<string, any>;
const messages = (result: {
  success: boolean;
  error?: { issues: { message: string }[] };
}): string[] => (result.success ? [] : result.error!.issues.map((i) => i.message));

const input = {
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
  kind: string,
  metric: string,
  date: string,
  cents: number,
  range?: number[],
) => ({
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

const result = (): Json => ({
  input: clone(input),
  method: { id: "quarterly_event_bridge", version: "0.1.0" },
  nowcast: [pred("nowcast_total", "nowcast", "cash_including_restricted", "2023-11-09", 9e10)],
  baselinePredictions: [total("base", 100e9, 90e9, 110e9), usable("base", 80e9, 70e9, 90e9)],
  event: {
    effectCents: { low: -600e6, point: -500e6, high: -400e6 },
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

const badInput = (mutate: (i: Json) => void): string[] => {
  const i = clone(input) as Json;
  mutate(i);
  return messages(HistoricalScenarioInputSchema.safeParse(i));
};
const bad = (mutate: (r: Json) => void): string[] => {
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
    const outflow = (patch: Json) =>
      badInput((i) => Object.assign(i.event.additionalOutflowCents, patch));
    expect(outflow({ low: -1 })).not.toEqual([]);
    expect(outflow({ low: 1.5 })).not.toEqual([]);
    expect(outflow({ high: Number.MAX_SAFE_INTEGER + 1 })).not.toEqual([]);
    expect(outflow({ low: 700_000_000 })).toContain("low is above high");
    expect(outflow({ unit: "days" })).not.toEqual([]);
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
        i.observedFactIds = ["f1"];
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
    expect(
      badInput((i) => {
        i.responseAssumptionId = undefined;
        i.selectedAfterReveal = true;
      }),
    ).toContain("selected-after-reveal needs a response");
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
        r.response.assumptionId = "a2";
      }),
    ).toContain("response is not the requested assumption");
  });

  it("checks prediction kinds, periods, currency and unique ids", () => {
    expect(
      bad((r) => {
        r.nowcast[0].period.date = "2023-11-10";
      }),
    ).toContain("a nowcast must end by the cutoff local date");
    expect(
      bad((r) => {
        r.baselinePredictions[0].period.date = "2023-12-30";
      }),
    ).toContain("a branch forecast must end on the target date");
    expect(
      bad((r) => {
        r.event.predictions[0].currency = "EUR";
      }),
    ).toContain("prediction currency differs from the scenario");
    expect(
      bad((r) => {
        r.nowcast[0].kind = "forecast";
      }),
    ).toContain("expected a nowcast prediction");
    expect(
      bad((r) => {
        r.event.predictions[0].id = "base_total";
      }),
    ).toContain("duplicate prediction id");
    expect(
      bad((r) => {
        r.baselinePredictions[0].range = { low: 1.1e11, high: 2e11 };
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
        r.event.predictions[0].cents = 99e9;
        r.event.predictions[0].range = { low: 88.8e9, high: 109.2e9 };
      }),
    ).toContain(twice);
    expect(
      bad((r) => {
        r.event.predictions[1].range.high += 1;
      }),
    ).toContain(twice);
    expect(
      bad((r) => {
        r.response.predictions[1].cents -= 1;
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
        r.response.effectiveFrom = "2023-11-09";
      }),
    ).toContain("response must take effect after the cutoff, inside the target quarter");
    expect(
      bad((r) => {
        r.response.effectiveFrom = "2024-01-02";
      }),
    ).toContain("response must take effect after the cutoff, inside the target quarter");
    expect(
      bad((r) => {
        r.response.benefitStart = "2024-01-02";
      }),
    ).toContain("benefit start is effectiveFrom plus the lag");
    expect(
      bad((r) => {
        r.response.benefitDays = 3;
      }),
    ).toContain("benefit days must run from benefit start to the target");
    expect(
      bad((r) => {
        r.response.effectCents.low = -250e6;
      }),
    ).toContain("with no benefit inside the quarter the effect is the negated cost range");
    expect(
      bad((r) => {
        r.response.label = "synthetic";
      }),
    ).not.toEqual([]);
    expect(
      bad((r) => {
        r.response.feasibleAtCutoff = "maybe";
      }),
    ).not.toEqual([]);
    const postHoc = "hindsight or post-reveal choices are post-hoc";
    expect(
      bad((r) => {
        r.response.label = "hindsight";
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
        r.response.postHoc = true;
      }),
    ).toEqual([]);
  });

  it("accepts a benefit that starts inside the quarter without constraining its size", () => {
    expect(
      bad((r) => {
        r.response.benefitLagDays = 10;
        r.response.benefitStart = "2023-12-11";
        r.response.benefitDays = 21; // Dec 11..Dec 31 inclusive
        r.response.effectCents = { low: -150e6, point: 0, high: 900e6 };
        r.response.predictions = [
          total("resp", 99.5e9, 89.25e9, 110.5e9),
          usable("resp", 79.5e9, 69.25e9, 90.5e9),
        ];
      }),
    ).toEqual([]);
  });

  it("rejects bad graph structure and references", () => {
    expect(
      bad((r) => {
        r.impact.nodes[1].id = "n_event";
      }),
    ).toContain("duplicate node id");
    expect(
      bad((r) => {
        r.impact.edges[1].id = "e1";
      }),
    ).toContain("duplicate edge id");
    expect(
      bad((r) => {
        r.impact.edges[0].to = "ghost";
      }),
    ).toContain("edge node not found");
    expect(
      bad((r) => {
        r.impact.edges[0].from = "ghost";
      }),
    ).toContain("edge node not found");
    expect(
      bad((r) => {
        r.impact.nodes[1].refId = "nope";
      }),
    ).toContain("prediction node does not match the result");
    expect(
      bad((r) => {
        r.impact.nodes[0].refId = "other";
      }),
    ).toContain("event node does not match the result");
    expect(
      bad((r) => {
        r.impact.nodes[3].refId = "a2";
      }),
    ).toContain("response node does not match the result");
    expect(
      bad((r) => {
        r.impact.nodes[2].refId = "base_total";
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
        r.impact.edges[1].refs = [];
      }),
    ).not.toEqual([]);
    expect(
      bad((r) => {
        r.impact.edges[1].explanation = " ";
      }),
    ).toContain("must not be blank");
    expect(
      bad((r) => {
        r.impact.edges[1].basis = "guess";
      }),
    ).not.toEqual([]);
    expect(
      bad((r) => {
        r.impact.edges[1].refs = [{ kind: "metric", id: "x" }];
      }),
    ).not.toEqual([]);
  });

  it("checks typed edge refs and the ref each basis needs", () => {
    expect(
      bad((r) => {
        r.impact.edges[0].refs = [{ kind: "event", id: "other" }];
      }),
    ).toContain("event ref does not match the result");
    expect(
      bad((r) => {
        r.impact.edges[1].refs = [{ kind: "prediction", id: "nope" }];
      }),
    ).toContain("prediction ref does not match the result");
    expect(
      bad((r) => {
        r.impact.edges[0].refs = [{ kind: "fact", id: "f1" }];
      }),
    ).toContain("a hypothesis edge must cite a event ref");
    expect(
      bad((r) => {
        r.impact.edges[3].refs = [{ kind: "fact", id: "f1" }];
      }),
    ).toContain("a assumption edge must cite a assumption ref");
    expect(
      bad((r) => {
        r.impact.edges[3].basis = "rule";
      }),
    ).toContain("a rule edge must cite a rule ref");
    // Fact, assumption and rule refs are structural here; the engine proves they exist.
    expect(
      bad((r) => {
        r.impact.edges[3].basis = "rule";
        r.impact.edges[3].refs = [{ kind: "rule", id: "analyst_floor" }];
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
        r.minCashCents = 0;
      }),
    ).not.toEqual([]);
    expect(
      bad((r) => {
        r.insolvent = false;
      }),
    ).not.toEqual([]);
    expect(
      bad((r) => {
        r.impact.nodes[0].severity = "high";
      }),
    ).not.toEqual([]);
    expect(
      bad((r) => {
        r.response.thresholdCents = 1;
      }),
    ).not.toEqual([]);
  });
});

describe("existing contracts stay closed to scenarios", () => {
  it("does not widen the historical run branch union", () => {
    const run = { ...clone(fx.baselineRun), branch: { kind: "event" } };
    expect(HistoricalRunSchema.safeParse(run).success).toBe(false);
    expect(HistoricalRunSchema.safeParse(fx.baselineRun).success).toBe(true);
  });
});
