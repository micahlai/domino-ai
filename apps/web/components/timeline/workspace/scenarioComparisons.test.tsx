import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScenarioNav } from "./ScenarioNav";
import { ScenarioSidebar } from "./ScenarioSidebar";
import { WorkspaceChart } from "./WorkspaceChart";
import { fixtureGraph, fixtureRoot, fixtureRules, fixtureScenario } from "./fixtures";
import {
  SCENARIO_COLORS,
  assignColors,
  branchStart,
  colorFor,
  comparisonIds,
  firstDifference,
  forkOf,
  readComparison,
  scenarioDepth,
} from "./scenarioComparisons";

const clone = <T,>(value: T): T => structuredClone(value);

describe("saved scenario comparisons", () => {
  it("bounds reads to six distinct saved nodes; the always-drawn base is never selectable", () => {
    expect(comparisonIds(["base", "a", "a", "b", "c", "d", "e", "f", "g"], "base")).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
    ]);
    expect(comparisonIds([], "base")).toEqual([]);
  });

  it("keeps each shown scenario's color when others are hidden", () => {
    const first = assignColors({}, ["a", "b", "c"]);
    expect(first).toEqual({ a: 0, b: 1, c: 2 });
    const hidden = assignColors(first, ["a", "c"]);
    expect(hidden).toEqual({ a: 0, c: 2 });
    expect(assignColors(hidden, ["a", "c", "d"])).toEqual({ a: 0, c: 2, d: 1 });
    const colors = { ids: ["a", "c"], reads: {}, onChange: () => undefined, colors: hidden };
    expect(colorFor(colors, "c")).toBe(SCENARIO_COLORS[2]);
  });

  it("forks a branch from its nearest shown ancestor, else the base", () => {
    const root = fixtureGraph[0]!;
    const entries = [
      { ...root, runId: "base", parentRunId: null },
      { ...root, runId: "s1", parentRunId: "base", kind: "scenario" as const },
      { ...root, runId: "s2", parentRunId: "s1", kind: "scenario" as const },
    ];
    expect(forkOf("s2", entries, new Set(["s1", "s2"]), "base")).toBe("s1");
    expect(forkOf("s2", entries, new Set(["s2"]), "base")).toBe("base");
    expect(forkOf("s1", entries, new Set(["s1"]), "base")).toBe("base");
  });

  it("finds where two saved curves first differ", () => {
    const a = fixtureRoot.forecast;
    expect(firstDifference(a, a)).toBe(-1);
    const b = clone(a);
    b.weeks[4]!.usable += 100;
    expect(firstDifference(b, a)).toBe(4);
  });

  it("lets a child start no earlier than the nearest ancestor that changes events", () => {
    const root = fixtureGraph[0]!;
    const entries = [
      { ...root, runId: "base", parentRunId: null, startsOn: null },
      { ...root, runId: "s1", parentRunId: "base", startsOn: "2026-11-17" },
      { ...root, runId: "rules", parentRunId: "s1", startsOn: null },
      { ...root, runId: "s2", parentRunId: "rules", startsOn: "2026-12-01" },
    ];
    expect(branchStart("base", entries)).toBeNull();
    expect(branchStart("rules", entries)).toBe("2026-11-17");
    expect(branchStart("s2", entries)).toBe("2026-12-01");
  });

  it("rejects another company, baseline, imported seed or forecast calendar", () => {
    expect(readComparison(fixtureRules, fixtureScenario, fixtureRules.runId).state).toBe("ready");
    const company = clone(fixtureRules);
    company.companyId = "other";
    expect(readComparison(company, fixtureScenario, company.runId).state).toBe("unusable");
    const baseline = clone(fixtureRules);
    baseline.baselineRunId = "other";
    baseline.baseline.runId = "other";
    expect(readComparison(baseline, fixtureScenario, baseline.runId).state).toBe("unusable");
    const seed = clone(fixtureRules);
    seed.baseline.seedHash = "c".repeat(64);
    expect(readComparison(seed, fixtureScenario, seed.runId).state).toBe("unusable");
    const dates = clone(fixtureRules);
    dates.forecast.weeks[0]!.weekStart = "2026-11-09";
    expect(readComparison(dates, fixtureScenario, dates.runId).state).toBe("unusable");
    expect(readComparison(undefined, fixtureScenario, fixtureRules.runId).state).toBe("loading");
    expect(readComparison(null, fixtureScenario, fixtureRules.runId).state).toBe("missing");
  });

  it("caps nesting and stops cycles or missing parents", () => {
    const root = fixtureGraph[0]!;
    const chain = Array.from({ length: 20 }, (_, i) => ({
      ...root,
      runId: `n${i}`,
      parentRunId: i ? `n${i - 1}` : null,
    }));
    expect(scenarioDepth(chain[19]!, chain)).toBe(3);
    expect(scenarioDepth({ ...root, parentRunId: "missing" }, [root])).toBe(0);
    const a = { ...root, runId: "a", parentRunId: "b" };
    const b = { ...root, runId: "b", parentRunId: "a" };
    expect(scenarioDepth(a, [a, b])).toBe(1);
  });

  it("keeps the current saved node visible when the family is capped or unavailable", () => {
    const html = renderToStaticMarkup(
      <ScenarioSidebar
        run={fixtureScenario}
        graph={{
          state: "ready",
          value: Array.from({ length: 100 }, (_, i) => ({ ...fixtureGraph[0]!, runId: `row${i}` })),
        }}
        comparisons={{ ids: [], reads: {}, onChange: () => undefined }}
        hrefFor={(id) => `/open/${id}`}
        catalogHref="/catalog"
      />,
    );
    expect(html).toMatch(/Acme pays 30 days late<\/span><div[^>]*>Open now/);
    // The open run's own saved receipt gives the exact breach week and shortfall.
    expect(html).toContain('data-outcome="below"');
    expect(html).toContain("short $33,000.00");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("first 100 saved scenarios");
    expect(html).toContain('href="/catalog"');
  });

  it("keeps navigation distinct from comparison and discloses different saved rules", () => {
    const html = renderToStaticMarkup(
      <ScenarioSidebar
        run={fixtureRoot}
        graph={{ state: "ready", value: fixtureGraph }}
        comparisons={{
          ids: [fixtureRules.runId],
          reads: { [fixtureRules.runId]: { state: "error" } },
          onChange: () => undefined,
        }}
        hrefFor={(id) => `/open/${id}`}
        catalogHref="/catalog"
      />,
    );
    expect(html).toContain('aria-label="Open Lender&#x27;s limit added"');
    expect(html).toContain('aria-label="Compare Lender&#x27;s limit added"');
    expect(html).toContain(">Show</span>");
    expect(html).toContain("Checked against different rules");
    expect(html).toContain("Saved curve unavailable; it is not drawn.");
    expect(html).toContain(">Clear</button>");
    expect(html).toContain("1 of 6 on chart");
    const longName = "scenario".repeat(40);
    const longHtml = renderToStaticMarkup(
      <ScenarioSidebar
        run={{ ...fixtureRoot, label: longName }}
        graph={{ state: "ready", value: [] }}
        comparisons={{ ids: [], reads: {}, onChange: () => undefined }}
        hrefFor={(id) => id}
        catalogHref="/catalog"
      />,
    );
    expect(longHtml).toContain("[overflow-wrap:anywhere]");
    expect(longHtml).toContain(`title="${longName}"`);
    const duplicateHtml = renderToStaticMarkup(
      <ScenarioSidebar
        run={fixtureRoot}
        graph={{
          state: "ready",
          value: [fixtureGraph[0]!, { ...fixtureGraph[1]!, label: fixtureRoot.label }],
        }}
        comparisons={{ ids: [], reads: {}, onChange: () => undefined }}
        hrefFor={(id) => id}
        catalogHref="/catalog"
      />,
    );
    expect(duplicateHtml).toContain('dateTime="2026-10-24T15:01:00.000Z"');
    expect(duplicateHtml).toContain("Saved 2026-10-24 15:01:00 UTC");
  });

  it("draws up to six colored branches from their fork weeks, without leaving the page", () => {
    const comparisons = Array.from({ length: 7 }, (_, i) => ({
      runId: `saved${i}`,
      label: `Saved ${i}`,
      forecast: fixtureRules.forecast,
      href: `/open/saved${i}`,
      color: SCENARIO_COLORS[i % SCENARIO_COLORS.length],
      fromIndex: 3,
      startsOn: "2026-11-23",
    }));
    const html = renderToStaticMarkup(
      <WorkspaceChart
        history={fixtureRoot.baseline.history}
        forecast={fixtureRoot.forecast}
        forecastLabel="Base forecast (no what-ifs)"
        comparisons={comparisons}
        items={[]}
        limits={[]}
        selectedWeek={null}
        onSelectWeek={() => undefined}
      />,
    );
    expect(html.match(/data-testid="comparison-line"/g)).toHaveLength(6);
    expect(html.match(/data-testid="fork-point"/g)).toHaveLength(6);
    expect(html).not.toContain("Saved 6");
    expect(html).toContain(`stroke="${SCENARIO_COLORS[0]}"`);
    expect(html).toContain("Base forecast (no what-ifs)");
    expect(html).toContain("from Nov 23, 2026");
    // Choosing scenarios never navigates: lines and legend carry no links.
    expect(html).not.toContain("Open saved scenario");
    expect(html).toContain('data-testid="forecast-line"');
  });

  it("offers two-handle time and cash scrollers, axis titles and gridlines", () => {
    const html = renderToStaticMarkup(
      <WorkspaceChart
        history={fixtureRoot.baseline.history}
        forecast={fixtureRoot.forecast}
        items={[]}
        limits={[]}
        selectedWeek={null}
        onSelectWeek={() => undefined}
      />,
    );
    expect(html).toContain("Drag the handles to zoom");
    // A matching vertical scroller zooms and pans the cash axis.
    expect(html).toContain('data-testid="cash-range-top"');
    expect(html).toContain('data-testid="cash-range-bottom"');
    expect(html).toContain('aria-orientation="vertical"');
    // A two-handle range bar scrolls and zooms time; it opens on every week on wide screens.
    expect(html).toContain('data-testid="time-range-start"');
    expect(html).toContain('data-testid="time-range-end"');
    expect(html).toContain('role="scrollbar"');
    expect(html).toContain('aria-valuenow="0"');
    expect(html).toContain('data-testid="time-axis-title"');
    expect(html).toContain("Week starting");
    expect(html).toContain("Usable cash</text>");
    expect(html.match(/data-testid="time-grid"/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("omits a branch that never leaves the line it builds on", () => {
    const html = renderToStaticMarkup(
      <WorkspaceChart
        history={fixtureRoot.baseline.history}
        forecast={fixtureRoot.forecast}
        comparisons={[
          {
            runId: "same",
            label: "Same",
            forecast: fixtureRoot.forecast,
            href: "/same",
            color: SCENARIO_COLORS[0],
            fromIndex: null,
          },
        ]}
        items={[]}
        limits={[]}
        selectedWeek={null}
        onSelectWeek={() => undefined}
      />,
    );
    expect(html).not.toContain('data-testid="comparison-line"');
    expect(html).toContain("same as the line it builds on");
  });

  it("shows the branch tree with colored checkboxes and a build-on action", () => {
    const html = renderToStaticMarkup(
      <ScenarioNav
        run={fixtureRoot}
        graph={{ state: "ready", value: fixtureGraph }}
        baseRunId={fixtureRoot.runId}
        comparisons={{
          ids: [fixtureScenario.runId],
          reads: {},
          onChange: () => undefined,
          colors: { [fixtureScenario.runId]: 1 },
        }}
        buildOn={() => undefined}
        hrefFor={(id) => id}
        catalogHref="/catalog"
      />,
    );
    expect(html).toContain("Base forecast");
    expect(html).toContain(`accent-color:${SCENARIO_COLORS[1]}`);
    expect(html).toContain(`data-testid="scenario-build-${fixtureScenario.runId}"`);
    const baseBox = html.match(
      new RegExp(`<input[^>]*data-testid="scenario-show-${fixtureRoot.runId}"[^>]*>`),
    )?.[0];
    expect(baseBox).toContain('disabled=""');
  });
});
