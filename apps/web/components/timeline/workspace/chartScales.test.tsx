import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkspaceChart } from "./WorkspaceChart";
import { cashScale, dateTicks, formatAxisCash } from "./chartScales";
import { fixtureBaseline, fixtureScenario } from "./fixtures";

describe("timeline scale guides", () => {
  it("keeps negative, positive and zero cash in the plot with safe integer-cent ticks", () => {
    const { scale, ticks } = cashScale([-250_000_000, 0, 360_000_000], [268, 38]);
    expect(scale(-250_000_000)).toBe(268);
    expect(scale(360_000_000)).toBe(38);
    expect(ticks.every(Number.isSafeInteger)).toBe(true);
    expect(ticks.some((tick) => tick < 0)).toBe(true);
    expect(ticks.some((tick) => tick > 0)).toBe(true);
  });

  it.each([0, 1, -1, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER])(
    "expands flat cash %s without unsafe or fractional-cent guide labels",
    (value) => {
      const { scale, ticks } = cashScale([value, value], [268, 38]);
      expect(Number.isFinite(scale(value))).toBe(true);
      expect(scale(value)).toBeGreaterThanOrEqual(38);
      expect(scale(value)).toBeLessThanOrEqual(268);
      expect(ticks.length).toBeGreaterThan(0);
      expect(ticks.every(Number.isSafeInteger)).toBe(true);
      expect(
        ticks.map(formatAxisCash).every((label) => label.startsWith("$") || label.startsWith("-$")),
      ).toBe(true);
    },
  );

  it("formats compact labels exactly without losing small differences in a tight range", () => {
    expect(formatAxisCash(320_000_000)).toBe("$3.2M");
    expect(formatAxisCash(-250_000_000)).toBe("-$2.5M");
    expect(formatAxisCash(125_000)).toBe("$1.25K");
    expect(formatAxisCash(1)).toBe("$0.01");
    expect(formatAxisCash(300_000_001)).toBe("$3.00000001M");
    expect(formatAxisCash(300_000_002)).toBe("$3.00000002M");
    expect(() => formatAxisCash(0.5)).toThrow();
    expect(() => formatAxisCash(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });

  it("samples actual saved weeks with both endpoints and a bounded date-label count", () => {
    const dates = [...fixtureBaseline.history, ...fixtureScenario.forecast.weeks].map(
      (week) => week.weekStart,
    );
    const ticks = dateTicks(dates);
    expect(ticks).toHaveLength(7);
    expect(ticks[0]).toEqual({ index: 0, date: dates[0] });
    expect(ticks.at(-1)).toEqual({ index: dates.length - 1, date: dates.at(-1) });
    expect(ticks.every((tick) => dates[tick.index] === tick.date)).toBe(true);
    expect(new Set(ticks.map((tick) => tick.index)).size).toBe(ticks.length);
    expect(dateTicks([])).toEqual([]);
    expect(dateTicks(["2027-01-04"])).toEqual([{ index: 0, date: "2027-01-04" }]);
  });

  it("renders both labelled axes, actual years, and keeps forecast-start text outside plot labels", () => {
    const html = renderToStaticMarkup(
      <WorkspaceChart
        history={fixtureBaseline.history}
        forecast={fixtureScenario.forecast}
        items={fixtureBaseline.seed.scheduledItems}
        limits={[{ id: "lender", label: "Lender's limit", cents: 315_000_000 }]}
        selectedWeek={fixtureScenario.forecast.weeks[0]!.weekStart}
        onSelectWeek={() => undefined}
      />,
    );
    expect(html).toContain('data-testid="cash-axis"');
    expect(html).toContain("Next 13 weeks");
    expect(html).toContain("Recorded");
    expect(html).toContain('data-testid="date-axis"');
    expect(html).toContain("2026");
    expect(html).toContain("2027");
    expect(html).toMatch(/<figcaption[^>]*>.*Recorded cash.*This scenario.*Cash minimum/);
    expect(html.match(/data-testid="chart-week-/g)).toHaveLength(13);
    expect(html).toContain('data-testid="week-range"');
    expect(html).toContain("Lender&#x27;s limit $3,150,000.00");
    expect(html).not.toMatch(/NaN|Infinity/);
  });
});
