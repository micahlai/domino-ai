import { fixtures } from "@domino/contracts/fixtures";
import { describe, expect, it } from "vitest";
import { timelineGeometry, timestamp } from "./geometry";
import { inspectionCash, inspectionPoints, nearestInspectionIndex } from "./inspection";

describe("weekly timeline inspection", () => {
  it("reads exact supplied history and forecast values without inventing a Today value", () => {
    const future = fixtures.resilience.universes[1];
    const points = inspectionPoints(fixtures.history, future);
    expect(points).toHaveLength(fixtures.history.length + 13);
    expect(points.filter((point) => point.recorded).map((point) => point.usable)).toEqual(
      fixtures.history.map((week) => week.usable),
    );
    expect(points.filter((point) => !point.recorded).map((point) => point.usable)).toEqual(
      future?.forecast.weeks.map((week) => week.usable),
    );
    expect(points.some((point) => point.date === fixtures.snapshot.asOf)).toBe(false);
    const fixed = inspectionPoints(fixtures.history, fixtures.resilienceWithFixes.universes[1]);
    expect(fixed.filter((point) => point.recorded)).toEqual(
      points.filter((point) => point.recorded),
    );
    expect(fixed.filter((point) => !point.recorded).map((point) => point.usable)).toEqual(
      fixtures.resilienceWithFixes.universes[1]?.forecast.weeks.map((week) => week.usable),
    );
  });

  it("snaps in chart space across the compressed history and expanded forecast", () => {
    const graph = timelineGeometry(
      fixtures.history,
      fixtures.snapshot.asOf,
      fixtures.resilience,
      undefined,
      300_000_000,
      1000,
    );
    const points = inspectionPoints(fixtures.history, fixtures.resilience.universes[0]);
    const position = (date: string) => graph.x(timestamp(date));
    points.forEach((point, index) => {
      expect(nearestInspectionIndex(points, position(point.date), position)).toBe(index);
    });
    expect(nearestInspectionIndex(points, -1000, position)).toBe(0);
    expect(nearestInspectionIndex(points, 5000, position)).toBe(points.length - 1);
    expect(nearestInspectionIndex([], 0)).toBe(-1);
  });

  it("formats exact cents including negatives, pennies and safe integer limits", () => {
    expect(inspectionCash(290_000_001)).toBe("$2,900,000.01");
    expect(inspectionCash(-101)).toBe("-$1.01");
    expect(inspectionCash(0)).toBe("$0.00");
    expect(inspectionCash(Number.MAX_SAFE_INTEGER)).toBe("$90,071,992,547,409.91");
  });
});
