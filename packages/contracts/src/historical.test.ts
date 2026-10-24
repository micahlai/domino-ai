import { describe, expect, it } from "vitest";
import { historicalFixtures as fx } from "./fixtures";
import {
  ActivityEventSchema,
  type HistoricalCase,
  HistoricalCaseSchema,
  HistoricalComparisonContextSchema,
  HistoricalFactSchema,
  type HistoricalRun,
  HistoricalRunContextSchema,
  HistoricalRunSchema,
  HistoricalSourceSchema,
} from "./index";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const messages = (result: {
  success: boolean;
  error?: { issues: { message: string }[] };
}): string[] => (result.success ? [] : result.error!.issues.map((i) => i.message));

const runCtx = (
  run: HistoricalRun = fx.baselineRun,
  c: HistoricalCase = fx.historicalCase,
  baseline?: HistoricalRun,
) => HistoricalRunContextSchema.safeParse({ case: c, run, baseline });
const cmpCtx = (
  patch: Partial<Record<string, unknown>> = {},
  revealedThrough = fx.revealedThrough,
) =>
  HistoricalComparisonContextSchema.safeParse({
    case: fx.historicalCase,
    run: fx.baselineRun,
    revealedThrough,
    comparisons: [{ ...fx.comparison, ...patch }],
  });

describe("synthetic historical fixture", () => {
  it("is labelled synthetic and round trips every boundary", () => {
    expect(fx.historicalCase.provenance).toBe("synthetic_fixture");
    expect(HistoricalCaseSchema.parse(clone(fx.historicalCase))).toEqual(fx.historicalCase);
    expect(runCtx().success).toBe(true);
    expect(runCtx(fx.alternativeRun, fx.historicalCase, fx.baselineRun).success).toBe(true);
    expect(cmpCtx().success).toBe(true);
    expect(fx.activity.every((e) => ActivityEventSchema.safeParse(e).success)).toBe(true);
  });
});

describe("availability", () => {
  it("fails closed when a source has no publication instant or offset", () => {
    const { publishedAt: _drop, ...noDate } = fx.historicalCase.sources[0]!;
    expect(HistoricalSourceSchema.safeParse(noDate).success).toBe(false);
    const naive = { ...fx.historicalCase.sources[0]!, publishedAt: "2031-11-09T16:45:46" };
    expect(HistoricalSourceSchema.safeParse(naive).success).toBe(false);
  });

  it("rejects a run input published after the cutoff", () => {
    const run = clone(fx.baselineRun);
    run.inputs.sourceIds.push("src_fy");
    run.inputs.factIds.push("f_cash_fy");
    expect(messages(runCtx(run))).toEqual([
      "source published after the cutoff",
      "fact available after the cutoff",
    ]);
  });

  it("does not let a period end stand in for availability", () => {
    const c = clone(fx.historicalCase);
    c.facts[0]!.availableAt = "2031-09-30T23:59:59-04:00";
    expect(messages(HistoricalCaseSchema.safeParse(c))).toContain(
      "a reported fact is available when its source is published",
    );
  });

  it("makes a derived fact inherit its latest input, including a later amendment", () => {
    const c = clone(fx.historicalCase);
    c.sources.push({
      ...c.sources[0]!,
      id: "src_q3_amend",
      publishedAt: "2031-12-01T09:00:00-05:00",
      amends: "src_q3",
      contentHash: "e".repeat(64),
    });
    c.facts[1] = {
      ...c.facts[1]!,
      kind: "reported",
      sourceId: "src_q3_amend",
      availableAt: "2031-12-01T09:00:00-05:00",
    } as (typeof c.facts)[number];
    expect(messages(HistoricalCaseSchema.safeParse(c))).toEqual([
      "a derived fact inherits the latest input availability",
    ]);
    c.facts[2]!.availableAt = "2031-12-01T09:00:00-05:00";
    expect(HistoricalCaseSchema.safeParse(c).success).toBe(true);
    // The baseline now reads a fact that was not public at the cutoff.
    expect(messages(runCtx(fx.baselineRun, c))).toContain("fact available after the cutoff");
  });

  it("orders amendments after the original", () => {
    const c = clone(fx.historicalCase);
    c.sources.push({
      ...c.sources[0]!,
      id: "src_bad",
      amends: "src_q3",
      publishedAt: "2031-11-01T00:00:00Z",
    });
    expect(messages(HistoricalCaseSchema.safeParse(c))).toContain(
      "an amendment must be published after the original",
    );
  });
});

describe("periods and units", () => {
  const fact = fx.historicalCase.facts[0]!;
  it.each([
    [
      "balance with a duration",
      { period: { kind: "duration", start: "2031-07-01", end: "2031-09-30" } },
    ],
    ["flow with an instant", { metric: "operating_cash_flow" }],
    [
      "end before start",
      {
        metric: "operating_cash_flow",
        period: { kind: "duration", start: "2031-09-30", end: "2031-07-01" },
      },
    ],
    ["impossible date", { period: { kind: "instant", date: "2031-02-30" } }],
    ["negative cash", { cents: -1 }],
    ["fractional cents", { cents: 1.5 }],
    ["lowercase currency", { currency: "usd" }],
    ["unknown scale", { reportedScale: "billions" }],
  ])("rejects %s", (_name, patch) => {
    expect(HistoricalFactSchema.safeParse({ ...fact, ...patch }).success).toBe(false);
  });

  it("rejects a fact in another currency than the case", () => {
    const c = clone(fx.historicalCase);
    c.facts[3]!.currency = "EUR";
    expect(messages(HistoricalCaseSchema.safeParse(c))).toEqual([
      "fact currency differs from the case",
    ]);
  });
});

describe("runs", () => {
  it("keeps the stale balance date distinct from the cutoff", () => {
    const run = clone(fx.baselineRun);
    run.originBalanceDate = "2031-11-10";
    expect(messages(runCtx(run))).toContain("no input balance fact at the origin balance date");
    expect(messages(runCtx(run))).toContain(
      "a nowcast ends after the origin balance and by the cutoff",
    );
  });

  it("requires forecasts to end after the cutoff", () => {
    const run = clone(fx.baselineRun);
    run.predictions[1]!.period = { kind: "instant", date: "2031-11-10" };
    expect(HistoricalRunSchema.safeParse(run).success).toBe(false);
  });

  it("requires disclosed thresholds to cite run inputs", () => {
    const run = clone(fx.baselineRun);
    run.riskRules[0]!.basis = "disclosed_term";
    expect(messages(runCtx(run))).toEqual(["a disclosed term needs a source"]);
  });

  it("makes alternatives share the baseline cutoff, origin and nowcast", () => {
    expect(messages(runCtx(fx.alternativeRun))).toEqual(["alternative needs its baseline run"]);
    const alt = clone(fx.alternativeRun);
    alt.predictions[0]!.cents += 1;
    expect(messages(runCtx(alt, fx.historicalCase, fx.baselineRun))).toEqual([
      "alternative must share the baseline nowcast",
    ]);
  });

  it("labels hindsight and post-reveal choices post-hoc", () => {
    const c = clone(fx.historicalCase);
    c.assumptions[0]!.selectedAfterReveal = true;
    expect(messages(runCtx(fx.alternativeRun, c, fx.baselineRun))).toEqual([
      "hindsight or post-reveal choices are post-hoc",
    ]);
    const alt = clone(fx.alternativeRun);
    if (alt.branch.kind === "alternative") alt.branch.postHoc = true;
    expect(runCtx(alt, c, fx.baselineRun).success).toBe(true);
  });
});

describe("comparisons", () => {
  it("does not score before the observation is revealed", () => {
    expect(messages(cmpCtx({}, "2032-01-01T00:00:00Z"))).toEqual([
      "observation is not revealed yet",
    ]);
  });

  it("rejects an observation that was already an input", () => {
    expect(
      messages(
        cmpCtx({
          observationFactId: "f_cash_q3",
          observedCents: 70_00_000_000,
          errorCents: 22_00_000_000,
          absErrorCents: 22_00_000_000,
          ruleOutcomes: [],
        }),
      ),
    ).toEqual([
      "observation was available at the cutoff",
      "observation does not match the prediction metric, period and currency",
    ]);
  });

  it("checks exact signed and absolute error", () => {
    expect(messages(cmpCtx({ errorCents: -4_00_000_000 }))).toEqual([
      "error must be observed minus predicted",
    ]);
  });

  it("checks rule outcomes against the threshold", () => {
    expect(
      messages(
        cmpCtx({
          ruleOutcomes: [{ ruleId: "r_min", predictedBreach: false, observedBreach: false }],
        }),
      ),
    ).toEqual(["rule outcome does not follow the threshold"]);
  });

  it("leaves unscored comparisons without numbers", () => {
    const unscored = {
      id: "cmp_q4",
      runId: "run_base",
      predictionId: "p_q4",
      status: "unscored",
      reason: "no_observation",
    };
    expect(
      HistoricalComparisonContextSchema.safeParse({
        ...{ case: fx.historicalCase, run: fx.baselineRun, revealedThrough: fx.revealedThrough },
        comparisons: [unscored],
      }).success,
    ).toBe(true);
  });
});

describe("activity events", () => {
  const event = fx.activity[0]!;
  it("has no invented running stage for instant operations", () => {
    expect(ActivityEventSchema.safeParse({ ...event, status: "started" }).success).toBe(false);
    expect(
      ActivityEventSchema.safeParse({ ...event, kind: "tool_invoked", status: "started" }).success,
    ).toBe(true);
  });

  it("requires a runtime timestamp with an offset", () => {
    expect(ActivityEventSchema.safeParse({ ...event, occurredAt: "2031-11-10" }).success).toBe(
      false,
    );
  });
});
