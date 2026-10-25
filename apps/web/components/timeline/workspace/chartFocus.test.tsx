import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkspaceChart } from "./WorkspaceChart";
import { type FocusCurve, nearestCurveAt, pointOnCurve } from "./chartFocus";
import { fixtureBaseline, fixtureScenario } from "./fixtures";

const base: FocusCurve = {
  runId: "base",
  label: "Base forecast",
  points: [
    { slot: 0, x: 10, y: 100 },
    { slot: 1, x: 30, y: 80 },
    { slot: 2, x: 50, y: 60 },
  ],
};
const branch: FocusCurve = {
  runId: "branch",
  label: "Payment delay",
  color: "#aabbcc",
  points: [
    { slot: 1, x: 30, y: 80 },
    { slot: 2, x: 50, y: 140 },
  ],
};

describe("timeline branch focus", () => {
  it("selects the nearest curve at the exact clicked time rather than the nearest saved week", () => {
    const hit = nearestCurveAt([base, branch], 1.25, 96, "base");
    expect(hit?.curve.runId).toBe("branch");
    expect(hit?.point).toEqual({ slot: 1.25, x: 35, y: 95 });
    expect(nearestCurveAt([base, branch], 1.25, 76)?.curve.runId).toBe("base");
  });

  it("excludes a branch before its fork even when it is the preferred curve", () => {
    expect(pointOnCurve(branch.points, 0.999)).toBeNull();
    expect(nearestCurveAt([base, branch], 0.5, 90, "branch")?.curve.runId).toBe("base");
    expect(nearestCurveAt([branch], 0.5, 90, "branch")).toBeNull();
    expect(nearestCurveAt([base, branch], 2.001, 140)).toBeNull();
    expect(nearestCurveAt([{ ...branch, points: [] }], 1, 80)).toBeNull();
  });

  it("retains the focused or open branch where drawn curves overlap", () => {
    expect(nearestCurveAt([base, branch], 1, 80, "branch")?.curve.runId).toBe("branch");
    expect(nearestCurveAt([branch, base], 1, 80, "base")?.curve.runId).toBe("base");
  });

  it("reprojects fractional focus from current geometry without mutating saved inputs", () => {
    const original = JSON.stringify(branch);
    const resized = branch.points.map((point) => ({ ...point, x: point.x * 2, y: point.y + 10 }));
    expect(pointOnCurve(resized, 1.25)).toEqual({ slot: 1.25, x: 70, y: 105 });
    expect(pointOnCurve(branch.points, 2)).toEqual(branch.points[1]);
    expect(JSON.stringify(branch)).toBe(original);
  });

  const chart = (initialFocusRunId: string, fromIndex: number | null = 0, show = true) =>
    renderToStaticMarkup(
      <WorkspaceChart
        history={fixtureBaseline.history}
        forecast={fixtureBaseline.forecast}
        forecastRunId="base"
        forecastLabel="Base forecast"
        initialFocusRunId={initialFocusRunId}
        comparisons={
          show
            ? [
                {
                  runId: "branch",
                  label: "Payment delay",
                  color: "#aabbcc",
                  forecast: fixtureScenario.forecast,
                  href: "/branch",
                  fromIndex,
                },
              ]
            : []
        }
        items={[]}
        limits={[]}
        selectedWeek={fixtureBaseline.forecast.weeks[1]!.weekStart}
        onSelectWeek={() => undefined}
      />,
    );

  it("initially focuses the open drawn scenario with its own color, identity and accessible date", () => {
    const html = chart("branch");
    const marker = html.match(/<circle[^>]*data-testid="chart-focus-point"[^>]*>/)?.[0];
    expect(marker).toContain('fill="#aabbcc"');
    expect(marker).toContain('data-run-id="branch"');
    expect(marker).toContain("Chart focus: Payment delay");
    expect(marker).toContain("week of Nov 9, 2026");
    expect(html).toContain("Week details use the open scenario");
  });

  it("falls back to base when the open branch is unchecked or has no distinct drawn segment", () => {
    for (const html of [chart("branch", 0, false), chart("branch", null), chart("unknown")]) {
      expect(html.match(/<circle[^>]*data-testid="chart-focus-point"[^>]*>/)?.[0]).toContain(
        'data-run-id="base"',
      );
    }
  });

  it("hides the dot before the selected branch fork rather than inventing an earlier segment", () => {
    expect(chart("branch", 3)).not.toContain('data-testid="chart-focus-point"');
  });
});
