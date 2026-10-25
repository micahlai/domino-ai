import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkspaceView } from "./WorkspaceView";
import type { Read, WorkspaceRun } from "./api";
import { fixtureEntryGraph, fixtureOpenedResponse } from "./entryFixture";
import { fixtureGraph, fixtureRoot, fixtureRules, fixtureScenario } from "./fixtures";
import { acceptedSelection, openedForecastReady } from "./forecastReveal";
import { firstDifference, forkOf, readComparison } from "./scenarioComparisons";

const ready = (value: WorkspaceRun): Read<WorkspaceRun> => ({ state: "ready", value });
const ids = [fixtureRules.runId, fixtureScenario.runId];
const reads = {
  [fixtureRoot.runId]: ready(fixtureRoot),
  [fixtureRules.runId]: ready(fixtureRules),
  [fixtureScenario.runId]: ready(fixtureScenario),
};
const graph = { state: "ready" as const, value: fixtureGraph };

describe("opened saved scenario arrival", () => {
  it("requires independently validated direct parent even when the base is not selected", () => {
    expect(
      openedForecastReady(
        fixtureRules,
        graph,
        { [fixtureRules.runId]: ready(fixtureRules) },
        [fixtureRules.runId],
        fixtureRoot.runId,
      ),
    ).toBe(false);
    expect(
      openedForecastReady(fixtureRules, graph, reads, [fixtureRules.runId], fixtureRoot.runId),
    ).toBe(true);
    expect(openedForecastReady(fixtureRoot, graph, reads, [], fixtureRoot.runId)).toBe(false);
  });
  it("waits for delayed ancestors and refuses failed, malformed, foreign or wrong-parent data", () => {
    for (const state of ["loading", "error", "missing", "unusable"] as const) {
      expect(openedForecastReady(fixtureScenario, { state }, reads, ids, fixtureRoot.runId)).toBe(
        false,
      );
      expect(
        openedForecastReady(
          fixtureScenario,
          graph,
          { ...reads, [fixtureRules.runId]: { state } },
          ids,
          fixtureRoot.runId,
        ),
      ).toBe(false);
    }
    for (const parent of [
      { ...fixtureRules, companyId: "foreign" },
      { ...fixtureRules, parentRunId: fixtureScenario.runId },
      { ...fixtureRules, baselineRunId: "foreign" },
    ])
      expect(
        openedForecastReady(
          fixtureScenario,
          graph,
          { ...reads, [fixtureRules.runId]: ready(parent) },
          ids,
          fixtureRoot.runId,
        ),
      ).toBe(false);
    const mismatch = {
      ...graph,
      value: graph.value.map((entry) =>
        entry.runId === fixtureScenario.runId
          ? { ...entry, parentRunId: fixtureRoot.runId }
          : entry,
      ),
    };
    expect(openedForecastReady(fixtureScenario, mismatch, reads, ids, fixtureRoot.runId)).toBe(
      false,
    );
    expect(openedForecastReady(fixtureScenario, graph, reads, ids, fixtureRoot.runId)).toBe(true);
  });
  it("prioritizes opened child and its real parent over six old selections", () => {
    const old = Array.from({ length: 6 }, (_, i) => `old${i}`);
    const selected = acceptedSelection(
      old,
      fixtureScenario.runId,
      fixtureRules.runId,
      fixtureGraph,
      fixtureRoot.runId,
    ).ids;
    expect(selected).toContain(fixtureScenario.runId);
    expect(selected).toContain(fixtureRules.runId);
    expect(selected.length).toBeLessThanOrEqual(6);
    expect(forkOf(fixtureScenario.runId, fixtureGraph, new Set(selected), fixtureRoot.runId)).toBe(
      fixtureRules.runId,
    );
  });
  it("validates the distinct risk parent and forks the restored response from that line", () => {
    const child = fixtureOpenedResponse;
    const childReads = { ...reads, [child.runId]: ready(child) };
    const selected = [fixtureRules.runId, fixtureScenario.runId, child.runId];
    expect(readComparison(child, fixtureRoot, child.runId).state).toBe("ready");
    expect(
      openedForecastReady(
        child,
        { state: "ready", value: fixtureEntryGraph },
        childReads,
        selected,
        fixtureRoot.runId,
      ),
    ).toBe(true);
    expect(
      openedForecastReady(
        child,
        { state: "ready", value: fixtureEntryGraph },
        { ...childReads, [fixtureScenario.runId]: { state: "loading" } },
        selected,
        fixtureRoot.runId,
      ),
    ).toBe(false);
    const anchor = forkOf(child.runId, fixtureEntryGraph, new Set(selected), fixtureRoot.runId);
    expect(anchor).toBe(fixtureScenario.runId);
    expect(firstDifference(child.forecast, fixtureScenario.forecast)).toBe(5);
    const forkWeek = 4;
    expect(child.forecast.weeks[forkWeek]!.usable).toBe(
      fixtureScenario.forecast.weeks[forkWeek]!.usable,
    );
    expect(child.forecast.weeks[forkWeek]!.usable).not.toBe(
      fixtureRoot.forecast.weeks[forkWeek]!.usable,
    );
    expect(firstDifference(child.forecast, fixtureRoot.forecast)).toBe(3);
  });
  it("withholds the child before parent arrival, then mounts directly with the reveal signal", () => {
    const markup = (waiting: boolean) =>
      renderToStaticMarkup(
        <WorkspaceView
          run={fixtureScenario}
          parent={ready(fixtureRules)}
          graph={graph}
          baseRunId={fixtureRoot.runId}
          questions={{ state: "ready", value: [] }}
          resultRef={{ state: "missing" }}
          comparisons={{
            ids,
            reads,
            waitingRunIds: waiting ? [fixtureScenario.runId] : [],
            revealRunIds: waiting ? [] : [fixtureScenario.runId],
            onChange: () => undefined,
          }}
          actions={{
            catalogHref: "#",
            hrefFor: () => "#",
            simulate: async () => ({ ok: false, message: "Fixture" }),
            reviseRules: async () => ({ ok: false, message: "Fixture" }),
            confirmProposal: async () => ({ ok: false, message: "Fixture" }),
            relink: async () => ({ ok: false, message: "Fixture" }),
          }}
        />,
      );
    expect(markup(true)).not.toContain(`data-run-id="${fixtureScenario.runId}" pointer-events`);
    expect(markup(true)).not.toContain('data-testid="comparison-line"');
    expect(markup(false)).toContain('data-testid="forecast-reveal"');
    expect(markup(false).match(/<path[^>]*data-testid="forecast-reveal"[^>]*>/)?.[0]).toContain(
      'stroke-dasharray="0 1"',
    );
  });
});
