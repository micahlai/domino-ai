import {
  type ActivityEvent,
  ActivityEventSchema,
  HistoricalCaseSchema,
  type HistoricalComparison,
  HistoricalRunSchema,
} from "@domino/contracts";
import { ConvexError } from "convex/values";
import { useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
// Server evidence JSON is read here, in tests only. Client code never imports it.
import rawCase from "../../../../data/historical/2u/case.json";
import protocol from "../../../../data/historical/2u/protocol.json";
import {
  HistoricalJourney,
  HistoricalLive,
  describeError,
  readActivity,
  useHistoricalQueries,
} from "./HistoricalLive";
import { HistoricalReplay } from "./HistoricalReplay";
import {
  type AlternativeData,
  type BaselineData,
  type CaseData,
  type RevealData,
  alternativeIssue,
  buildView,
  mayApplyCompletion,
} from "./live";

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  return { ...actual, useReducedMotion: () => true };
});

const FULL = HistoricalCaseSchema.parse(rawCase);
const cutoffMs = Date.parse(protocol.knowledgeCutoff);
const pickIds = <T extends { id: string }>(items: T[], ids: string[]) =>
  items.filter((i) => ids.includes(i.id));

const baseInputs = {
  sourceIds: protocol.inputs.sourceIds,
  factIds: protocol.inputs.factIds,
  assumptionIds: protocol.inputs.baselineAssumptionIds,
};
const altInputs = { ...baseInputs, assumptionIds: protocol.inputs.responseAssumptionIds };
const snapshotOf = (inputs: typeof baseInputs) => ({
  caseId: FULL.id,
  currency: FULL.currency,
  method: protocol.method,
  sources: pickIds(FULL.sources, inputs.sourceIds),
  facts: pickIds(FULL.facts, inputs.factIds),
  assumptions: pickIds(FULL.assumptions, inputs.assumptionIds),
});

// Reversed and renamed on purpose: the adapter must select by metric and kind, not by id.
const baselinePredictions = [...protocol.nowcast, ...protocol.baselineForecast]
  .reverse()
  .map((p, i) => ({ ...p, id: `pred-${i}` }));
const altPredictions = [...protocol.nowcast, ...protocol.responseForecast]
  .reverse()
  .map((p, i) => ({ ...p, id: `alt-pred-${i}` }));

const BASE_ID = "baseline-0123456789abcdef";
const ALT_ID = "alternative-fedcba9876543210";
const baseRun = HistoricalRunSchema.parse({
  id: BASE_ID,
  caseId: FULL.id,
  createdAt: "2026-10-24T18:00:00.000Z",
  knowledgeCutoff: protocol.knowledgeCutoff,
  originBalanceDate: protocol.originBalanceDate,
  inputs: baseInputs,
  inputHash: "a".repeat(64),
  method: protocol.method,
  riskRules: [],
  predictions: baselinePredictions,
  branch: { kind: "baseline" },
});
const baseline = (over: Partial<BaselineData> = {}): BaselineData => ({
  runId: BASE_ID,
  run: baseRun,
  riskRulesNote: "No verified threshold, so no risk rule is applied. Risk is unknown.",
  inputSnapshot: snapshotOf(baseInputs),
  ...over,
});
const altRun = (baselineRunId = BASE_ID) =>
  HistoricalRunSchema.parse({
    ...baseRun,
    id: ALT_ID,
    inputs: altInputs,
    inputHash: "b".repeat(64),
    predictions: altPredictions,
    branch: { kind: "alternative", baselineRunId, decisionAssumptionIds: ["A1"], postHoc: true },
  });
const alternative = (baselineRunId = BASE_ID): AlternativeData => ({
  runId: ALT_ID,
  run: altRun(baselineRunId),
  inputSnapshot: snapshotOf(altInputs),
  costRelativeToBaseline: { low: -715_000_000, point: -426_250_000, high: -137_500_000 },
  benefit: { start: "2024-02-11", daysInWindow: 0, afterTarget: "unknown" },
  postHoc: true,
  postHocReason: protocol.response.postHocReason,
  caveats: [protocol.response.unmodeledNote, protocol.response.pointNote],
});

const caseData = (revealed: boolean): CaseData => {
  const through = revealed ? Date.parse("2024-02-12T16:01:00-05:00") : cutoffMs;
  const facts = FULL.facts.filter((f) => Date.parse(f.availableAt) <= through);
  const ids = new Set(facts.map((f) => f.id));
  return {
    case: HistoricalCaseSchema.parse({
      ...FULL,
      sources: FULL.sources.filter((s) => Date.parse(s.publishedAt) <= through),
      facts,
      assumptions: FULL.assumptions.filter(
        (a) => a.label !== "hindsight" && a.basisFactIds.every((id) => ids.has(id)),
      ),
    }),
    knowledgeCutoff: protocol.knowledgeCutoff,
    originBalanceDate: protocol.originBalanceDate,
    visibleThrough: revealed ? "2024-02-12T16:01:00-05:00" : protocol.knowledgeCutoff,
    revealed,
    disclosure: protocol.disclosure,
    method: protocol.method,
    projectionAssumptions: ["Uniform daily flow across the quarter"],
    riskRulesNote: "No verified threshold, so no risk rule is applied. Risk is unknown.",
  };
};

const cashTarget = baselinePredictions.find(
  (p) => p.metric === "cash_and_equivalents" && p.kind === "forecast",
);
const cashNow = baselinePredictions.find(
  (p) => p.metric === "cash_and_equivalents" && p.kind === "nowcast",
);
const comparisons: HistoricalComparison[] = baselinePredictions.map((p) =>
  p === cashTarget
    ? {
        id: `cmp-${p.id}`,
        runId: BASE_ID,
        predictionId: p.id,
        status: "scored",
        observationFactId: "H01",
        predictedCents: p.cents,
        observedCents: 6_068_900_000,
        errorCents: 6_068_900_000 - p.cents,
        absErrorCents: 6_068_900_000 - p.cents,
        ruleOutcomes: [],
      }
    : {
        id: `cmp-${p.id}`,
        runId: BASE_ID,
        predictionId: p.id,
        status: "unscored",
        reason: p.kind === "nowcast" ? "no_observation" : "incomparable_scope",
      },
);
const reveal: RevealData = {
  runId: BASE_ID,
  revealedThrough: "2024-02-12T16:01:00-05:00",
  revealedAt: "2026-10-24T18:05:00.000Z",
  comparisons,
};

const html = (props: Partial<Parameters<typeof HistoricalJourney>[0]> = {}) =>
  renderToStaticMarkup(
    <HistoricalJourney
      raw={{}}
      acts={{}}
      onSave={() => {}}
      onReveal={() => {}}
      onAlternative={() => {}}
      {...props}
    />,
  );

describe("adapter: one metric, backend cents", () => {
  const view = buildView({ caseData: caseData(false), baseline: baseline() });

  it("maps cash_and_equivalents only, selecting by metric and kind not by id", () => {
    expect(view.metricLabel).toBe("Cash and equivalents (restricted cash excluded)");
    expect(view.reported).toEqual([
      expect.objectContaining({ date: "2023-09-30", cash: 4_114_100_000 }),
    ]);
    expect(view.nowcast?.cash).toBe(cashNow?.cents);
    expect(view.nowcast?.cash).toBe(3_310_500_000);
    expect(view.projected).toHaveLength(1);
    expect(view.projected[0]).toMatchObject({ date: "2023-12-31", cash: 2_310_900_000 });
    expect(view.dates).toMatchObject({
      knowledgeCutoff: "2023-11-10",
      lastReportedOn: "2023-09-30",
      projectedThrough: "2023-12-31",
    });
    expect(view.comparison).toEqual([]);
  });

  it("reports the signed backend difference without recomputing it", () => {
    const revealed = buildView({
      caseData: caseData(true),
      baseline: baseline(),
      reveal,
    });
    const row = revealed.comparison.find((r) => r.observed !== undefined);
    expect(row).toMatchObject({
      period: "2023-12-31",
      projected: 2_310_900_000,
      observed: 6_068_900_000,
      difference: 3_758_000_000,
      outcome: "differs",
    });
    expect(revealed.comparison.map((r) => r.outcome).sort()).toEqual(["differs", "unscored"]);
    expect(revealed.observed).toEqual([
      expect.objectContaining({
        date: "2023-12-31",
        cash: 6_068_900_000,
        evidenceId: "revealed:H01",
      }),
    ]);
    expect(revealed.dates.revealedOn).toBe("2024-02-12");
    expect(revealed.stage).toBe("observed");
  });
});

describe("no later data before a successful reveal", () => {
  it("hides observations when only the reveal record or only the case flag says revealed", () => {
    for (const input of [
      { caseData: caseData(false), baseline: baseline(), reveal },
      { caseData: caseData(true), baseline: baseline(), reveal: null },
      { caseData: caseData(true), baseline: baseline() },
    ]) {
      const view = buildView(input);
      expect(view.observed).toEqual([]);
      expect(view.comparison.every((r) => r.observed === undefined)).toBe(true);
      expect(view.dates.revealedOn).toBeUndefined();
      expect(view.evidence.some((e) => e.id.startsWith("revealed:"))).toBe(false);
    }
  });

  it("filters the pre-save view to the cutoff even if the payload carried later facts", () => {
    const leaky = { ...caseData(true), revealed: false };
    const view = buildView({ caseData: leaky });
    expect(view.stage).toBe("baseline");
    expect(view.evidence.map((e) => e.id).sort()).not.toContain("case:H01");
    expect(view.evidence.every((e) => e.publishedOn <= "2023-11-10")).toBe(true);
    expect(view.dates.projectedThrough).toBeUndefined();
    expect(view.projected).toEqual([]);
    const markup = renderToStaticMarkup(<div>{JSON.stringify(view)}</div>);
    expect(markup).not.toContain("6068900000");
  });

  it("renders no reported-after-forecast text or S8 link in the saved state", () => {
    const out = html({
      runId: BASE_ID,
      raw: { case: caseData(false), run: baseline(), reveal: null },
    });
    expect(out).not.toContain("Disclosure published");
    expect(out).not.toContain("Saved forecast versus what was reported");
    expect(out).not.toContain("Feb 12, 2024");
    expect(out).toContain("Reveal what was reported");
    expect(out).not.toContain("Compute the alternative");
  });
});

describe("saved inputs come from getRun.inputSnapshot", () => {
  it("uses the frozen F01 even when the case view now holds a different one", () => {
    const current = caseData(false);
    const drifted = {
      ...current,
      case: {
        ...current.case,
        facts: current.case.facts.map((f) => (f.id === "F01" ? { ...f, cents: 4_200_000_000 } : f)),
      },
    };
    const view = buildView({ caseData: drifted, baseline: baseline() });
    expect(view.reported[0]?.cash).toBe(4_114_100_000);
    const f01 = view.evidence.find((e) => e.id === "saved:F01");
    expect(f01?.label).toContain("$41.1M");
    expect(f01?.ids).toBe("Source S7 · Fact F01");
    expect(f01?.url).toMatch(/^https:\/\//);
    expect(f01?.provenance).toBe("reported");
  });

  it("lists exactly the saved fact and assumption ids, labelled by kind", () => {
    const view = buildView({ caseData: caseData(true), baseline: baseline(), reveal });
    const saved = view.evidence.filter((e) => e.id.startsWith("saved:"));
    for (const id of [...baseInputs.factIds, ...baseInputs.assumptionIds])
      expect(saved.map((e) => e.id)).toContain(`saved:${id}`);
    expect(saved.find((e) => e.id === "saved:AS-FIN0")?.provenance).toBe("assumption");
    expect(saved.find((e) => e.id === "saved:forecast")?.note).toContain("a".repeat(64));
    expect(saved.find((e) => e.id === "saved:forecast")?.ids).toContain("facts F01, F02");
    // Observed ancestry is its own revealed item, never merged into the saved inputs.
    expect(view.evidence.find((e) => e.id === "revealed:H01")?.ids).toBe("Source S8 · Fact H01");
    expect(saved.some((e) => e.ids?.includes("H01"))).toBe(false);
    expect(view.run).toMatchObject({ runId: BASE_ID, inputHash: "a".repeat(64) });
  });
});

describe("retrospective and unknown wording", () => {
  const out = html({
    runId: BASE_ID,
    altId: ALT_ID,
    raw: { case: caseData(true), run: baseline(), reveal, alt: alternative() },
  });

  it("says saved before this reveal and states how the case was written", () => {
    expect(out).toContain("saved before this reveal");
    expect(out).not.toMatch(/before (these|the) results were published/);
    expect(out).toContain("Retrospective case study");
    expect(out).toContain("Risk is unknown");
    expect(out).not.toMatch(/bankrupt|prevent|warning|accura(te|cy) of the forecast/i);
  });

  it("shows the alternative as cost-only, ranged, lagged and with unknowns not zeros", () => {
    expect(out).toContain("Post-hoc: chosen with the outcome known");
    expect(out).toContain("-$4.3M");
    expect(out).toContain("Midpoint of the assumed range");
    expect(out).toContain("92 days after the decision");
    expect(out).toContain("Feb 11, 2024");
    expect(out).toContain("Not quantified");
    expect(out).toContain("Not modeled");
    expect(out).toContain("UNMODELED");
    expect(out).not.toMatch(/Downside<\/dt><dd[^>]*>\$0/);
    expect(out).not.toMatch(/Benefit later<\/dt><dd[^>]*>\$0/);
    expect(out).toContain("not compared with what was reported");
  });
});

describe("alternative association", () => {
  it("rejects an alternative computed from another baseline", () => {
    const other = alternative("baseline-ffffffffffffffff");
    expect(alternativeIssue(baseline(), other)?.message).toContain("different baseline");
    const out = html({
      runId: BASE_ID,
      altId: ALT_ID,
      raw: { case: caseData(true), run: baseline(), reveal, alt: other },
    });
    expect(out).toContain("different baseline");
    expect(out).not.toContain("hypothetical, cost only");
    expect(out).not.toContain("Post-hoc");
  });

  it("rejects a baseline id passed as the alternative and an alt id with no baseline", () => {
    const asAlt = { ...alternative(), run: baseRun, runId: BASE_ID };
    expect(alternativeIssue(baseline(), asAlt)?.message).toContain("not an alternative");
    const out = html({ altId: ALT_ID, raw: { case: caseData(false) } });
    expect(out).toContain("baseline it belongs to");
    expect(out).not.toContain("hypothetical, cost only");
  });

  it("does not show an alternative before the reveal", () => {
    const out = html({
      runId: BASE_ID,
      altId: ALT_ID,
      raw: { case: caseData(false), run: baseline(), reveal: null, alt: alternative() },
    });
    expect(out).toContain("only shown after the reveal");
    expect(out).not.toContain("hypothetical, cost only");
  });
});

describe("alternative without a reveal", () => {
  const futureCase = caseData(true);
  const early = buildView({
    caseData: futureCase,
    baseline: baseline(),
    alternative: alternative(),
  });

  it("shows the saved alternative but no observed value, evidence or date, even from a post-reveal case", () => {
    expect(early.alternative).toBeDefined();
    expect(early.stage).toBe("baseline");
    expect(early.observed).toEqual([]);
    expect(early.comparison).toEqual([]);
    expect(early.dates.revealedOn).toBeUndefined();
    expect(early.evidence.some((e) => e.id.startsWith("revealed:"))).toBe(false);
    expect(early.evidence.some((e) => e.id === "alt:forecast")).toBe(true);
    expect(JSON.stringify(early)).not.toContain("6068900000");
  });

  it("never says the shown alternative is not revealed yet, and keeps the other views truthful", () => {
    const out = renderToStaticMarkup(<HistoricalReplay view={early} activity={<span />} />);
    expect(out).toContain("hypothetical, cost only");
    expect(out).toContain("Post-hoc: chosen with the outcome known");
    expect(out).not.toContain("not revealed yet");
    expect(out).toContain("2. What was reported (not available yet)");
    const base = renderToStaticMarkup(
      <HistoricalReplay view={buildView({ caseData: caseData(false), baseline: baseline() })} />,
    );
    expect(base).toContain("3. One alternative (not available yet)");
  });

  it("is unchanged once revealed, and an invalid alternative is still refused by its check", () => {
    const revealed = buildView({
      caseData: futureCase,
      baseline: baseline(),
      reveal,
      alternative: alternative(),
    });
    expect(revealed.stage).toBe("response");
    expect(revealed.dates.revealedOn).toBe("2024-02-12");
    expect(revealed.alternative).toBeDefined();
    expect(alternativeIssue(baseline(), alternative("baseline-ffffffffffffffff"))).toBeDefined();
  });
});

describe("states and recovery", () => {
  it("shows loading until every requested query has answered", () => {
    expect(html()).toContain("Loading");
    expect(html({ runId: BASE_ID, raw: { case: caseData(false), run: baseline() } })).toContain(
      "Loading",
    );
  });

  it("explains a missing run id and offers a way back, without sample data", () => {
    const out = html({
      runId: "nope",
      raw: {
        case: new ConvexError({ code: "NOT_FOUND", message: "Unknown run" }),
        run: undefined,
        reveal: undefined,
      },
    });
    expect(out).toContain('role="alert"');
    expect(out).toContain("was not found");
    expect(out).toContain('href="/historical"');
    expect(out).not.toContain("Example Co");
  });

  it("treats a malformed payload as an error rather than guessing", () => {
    expect(html({ raw: { case: { nope: true } } })).toContain("not in the expected shape");
  });

  it("does not claim a lost response changed nothing, and says a retry reuses the request", () => {
    const text = describeError(new Error("boom"));
    expect(text).not.toContain("Nothing here was changed");
    expect(text).toContain("may or may not have been recorded");
    expect(text).toContain("same request");
  });

  it("describes server codes in plain words", () => {
    expect(describeError(new ConvexError({ code: "CASE_CHANGED", message: "x" }))).toContain(
      "Save a new forecast",
    );
  });

  it("keeps a failed save visible and retryable", () => {
    const out = html({
      raw: { case: caseData(false) },
      acts: { save: { error: "Could not reach the history service." } },
    });
    expect(out).toContain("Could not reach the history service.");
    expect(out).toContain("will not duplicate it");
    expect(out).toContain("Try again: Save forecast");
  });

  it("walks the three steps in order", () => {
    expect(html({ raw: { case: caseData(false) } })).toContain("Save forecast");
    const revealed = html({
      runId: BASE_ID,
      raw: { case: caseData(true), run: baseline(), reveal },
    });
    expect(revealed).toContain("Compute the alternative");
    expect(revealed).not.toContain("Reveal what was reported</button>");
    expect(revealed).toContain("Saved forecast versus what was reported");
  });

  it("stays honestly unavailable with no deployment", () => {
    expect(process.env.NEXT_PUBLIC_CONVEX_URL).toBeUndefined();
    const out = renderToStaticMarkup(<HistoricalLive />);
    expect(out).toContain("not connected to the history service");
    expect(out).toContain("No sample data");
    expect(out).not.toContain("Example Co");
  });

  it("keeps activity unavailable in this phase", () => {
    const out = html({
      runId: BASE_ID,
      raw: { case: caseData(false), run: baseline(), reveal: null },
    });
    expect(out).toContain("Not connected");
  });

  // Regression for React error 301: a fresh query map each render makes useQueries resubscribe
  // and set state during render, forever. Fizz re-runs a component that sets state while
  // rendering, so a second pass here is the closest we can get without a DOM.
  it("keeps the same query map across re-renders and only changes it with its inputs", () => {
    const seen: unknown[] = [];
    function Probe({ runId, altId }: { runId?: string; altId?: string }) {
      const [again, setAgain] = useState(true);
      seen.push(useHistoricalQueries(runId, altId));
      if (again) setAgain(false);
      return null;
    }
    renderToStaticMarkup(<Probe runId={BASE_ID} altId={ALT_ID} />);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(seen[0]);
    expect(Object.keys(seen[0] as object).sort()).toEqual([
      "activity",
      "alt",
      "case",
      "reveal",
      "run",
    ]);
    seen.length = 0;
    renderToStaticMarkup(<Probe />);
    expect(Object.keys(seen[0] as object)).toEqual(["case"]);
  });

  it("asks for the feed of the baseline only, and never without one", () => {
    const seen: Record<string, unknown>[] = [];
    function Probe({ runId, altId }: { runId?: string; altId?: string }) {
      seen.push(useHistoricalQueries(runId, altId) as Record<string, unknown>);
      return null;
    }
    renderToStaticMarkup(<Probe runId={BASE_ID} altId={ALT_ID} />);
    expect(seen[0]?.activity).toMatchObject({ args: { caseId: FULL.id, baselineRunId: BASE_ID } });
    renderToStaticMarkup(<Probe />);
    expect(seen[1]).not.toHaveProperty("activity");
  });
});

describe("live activity", () => {
  const event = (
    id: string,
    sequence: number,
    kind: ActivityEvent["kind"],
    runId: string,
    label: string,
  ) =>
    ActivityEventSchema.parse({
      id,
      sequence,
      occurredAt: `2026-10-24T18:00:0${sequence}Z`,
      caseId: FULL.id,
      runId,
      kind,
      status: "succeeded",
      entity: { kind: "run", id: runId },
      label,
    });
  // Alternatives carry their own run id, so this feed is deliberately not all the baseline's.
  const feed = [
    event("e1", 1, "run_saved", BASE_ID, "Forecast saved for the cutoff"),
    event("e2", 2, "alternative_computed", ALT_ID, "Alternative A1 computed"),
  ];
  const withActivity = (activity?: unknown, runId = BASE_ID) =>
    html({
      runId,
      raw: { case: caseData(false), run: baseline(), reveal: null, activity },
    });

  it("reads unknown, failed, malformed and good answers apart", () => {
    expect(readActivity(undefined)).toEqual({ unavailable: "loading" });
    expect(readActivity(new Error("x"))).toEqual({ unavailable: "failed" });
    expect(readActivity([{ id: "e1" }])).toEqual({ unavailable: "shape" });
    expect(readActivity([])).toEqual({ events: [] });
    expect(readActivity(feed)).toEqual({ events: feed });
  });

  it("does not mount a live feed while loading or after a failure", () => {
    const loading = withActivity(undefined);
    expect(loading).toContain("Loading the activity feed");
    expect(loading).toContain("Not connected");
    expect(loading).not.toContain("No activity yet");
    const failed = withActivity(new Error("boom"));
    expect(failed).toContain("could not be loaded");
    expect(failed).not.toContain("No activity yet");
    expect(withActivity("junk")).toContain("not in the expected shape");
  });

  it("shows the first batch, including the alternative's event, as live history", () => {
    const out = withActivity(feed);
    expect(out).toContain("Live");
    expect(out).toContain("Forecast saved for the cutoff");
    expect(out).toContain("Alternative A1 computed");
    expect(out).toContain("Alternative computed");
    // Static markup is the quiet first mount: nothing starts hidden for an entrance.
    expect(out).not.toContain("opacity:0");
  });

  it("says an empty answered feed is empty, apart from an unknown one", () => {
    expect(withActivity([])).toContain("No activity yet");
  });

  it("keeps the unavailable default without a feed query, and with no baseline", () => {
    expect(withActivity()).toContain("Not connected");
    expect(html({ raw: { case: caseData(false) } })).not.toContain("Activity events");
  });
});

describe("late completion guard", () => {
  const ok = { alive: true, pathname: "/historical", search: "", originRunId: undefined };
  const may = (over: Partial<Parameters<typeof mayApplyCompletion>[0]>) =>
    mayApplyCompletion({ ...ok, ...over });

  it("applies on the same page and run, keeping style and other params", () => {
    expect(may({})).toBe(true);
    expect(may({ search: "?style=2&alt=x" })).toBe(true);
    expect(may({ search: "?run=A&style=2", originRunId: "A" })).toBe(true);
    expect(may({ search: "?run=", originRunId: undefined })).toBe(true);
  });

  it("drops a call that finishes after the run changed", () => {
    expect(may({ search: "?run=B" })).toBe(false); // new -> B
    expect(may({ search: "?run=B", originRunId: "A" })).toBe(false); // A -> B
    expect(may({ search: "", originRunId: "A" })).toBe(false); // A -> new
  });

  it("drops a call that finishes after leaving the route or unmounting", () => {
    expect(may({ pathname: "/playground" })).toBe(false);
    expect(may({ pathname: "/playground", search: "?run=A", originRunId: "A" })).toBe(false);
    expect(may({ alive: false })).toBe(false);
  });
});
