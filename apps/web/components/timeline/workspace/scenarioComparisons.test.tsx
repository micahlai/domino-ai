import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScenarioSidebar } from "./ScenarioSidebar";
import { WorkspaceChart } from "./WorkspaceChart";
import { fixtureGraph, fixtureRoot, fixtureRules, fixtureScenario } from "./fixtures";
import { comparisonIds, readComparison, scenarioDepth } from "./scenarioComparisons";

const clone = <T,>(value: T): T => structuredClone(value);

describe("saved scenario comparisons", () => {
  it("bounds reads to three distinct saved nodes, excluding the open scenario", () => {
    expect(comparisonIds(["open", "a", "a", "b", "c", "d"], "open")).toEqual(["a", "b", "c"]);
    expect(comparisonIds([], "open")).toEqual([]);
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
    expect(html).toContain("Checked against different rules");
    expect(html).toContain("Saved curve unavailable; it is not drawn.");
    expect(html).toContain(">Clear</button>");
    expect(html).toContain("1 of 3 on chart");
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

  it("draws at most three optional saved curves, with links and a compact legend", () => {
    const comparisons = Array.from({ length: 4 }, (_, i) => ({
      runId: `saved${i}`,
      label: `Saved ${i}`,
      forecast: fixtureRules.forecast,
      href: `/open/saved${i}`,
    }));
    const html = renderToStaticMarkup(
      <WorkspaceChart
        history={fixtureRoot.baseline.history}
        forecast={fixtureScenario.forecast}
        comparisons={comparisons}
        items={[]}
        limits={[]}
        selectedWeek={null}
        onSelectWeek={() => undefined}
      />,
    );
    expect(html.match(/data-testid="comparison-line"/g)).toHaveLength(3);
    expect(html).not.toContain("Saved 3");
    expect(html).toContain('aria-label="Open saved scenario: Saved 0"');
    expect(html).toContain('data-testid="forecast-line"');
  });
});
