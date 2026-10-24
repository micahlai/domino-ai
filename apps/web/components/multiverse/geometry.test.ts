import { fixtures } from "@domino/contracts/fixtures";
import { describe, expect, it } from "vitest";
import { futureKey, timelineGeometry, timestamp } from "./geometry";

const today = fixtures.snapshot.asOf;
const limit = 300_000_000;
const makeGeometry = (withFixes: boolean) =>
  timelineGeometry(
    fixtures.history,
    today,
    withFixes ? fixtures.resilienceWithFixes : fixtures.resilience,
    withFixes ? fixtures.resilience : fixtures.resilienceWithFixes,
    limit,
    1000,
  );

describe("timeline geometry", () => {
  it("keeps cash and date coordinates stable when fixes are toggled", () => {
    const before = makeGeometry(false);
    const after = makeGeometry(true);
    expect(before.y.domain()).toEqual(after.y.domain());
    expect(before.x.domain()).toEqual(after.x.domain());
    for (const future of fixtures.resilience.universes) {
      expect(before.points(future)[0]).toEqual(before.origin);
      expect(before.path(before.points(future))).not.toMatch(/NaN|Infinity/);
    }
  });

  it("scales time and cash pixel spacing independently without changing supplied values", () => {
    const base = makeGeometry(false);
    const wide = timelineGeometry(
      fixtures.history,
      today,
      fixtures.resilience,
      fixtures.resilienceWithFixes,
      limit,
      1806,
    );
    const tall = timelineGeometry(
      fixtures.history,
      today,
      fixtures.resilience,
      fixtures.resilienceWithFixes,
      limit,
      1000,
      688,
    );
    expect(wide.x.domain()).toEqual(base.x.domain());
    expect(wide.y.domain()).toEqual(base.y.domain());
    expect(tall.x.domain()).toEqual(base.x.domain());
    expect(tall.y.domain()).toEqual(base.y.domain());
    const start = base.past[0];
    const end = base.past.at(-1);
    if (!start || !end) throw new Error("Missing history fixture");
    expect(wide.x(timestamp(end.date)) - wide.x(timestamp(start.date))).toBeCloseTo(
      2 * (base.x(timestamp(end.date)) - base.x(timestamp(start.date))),
    );
    expect(tall.y(end.usable) - tall.y(start.usable)).toBeCloseTo(
      2 * (base.y(end.usable) - base.y(start.usable)),
    );
    expect(tall.past).toEqual(base.past);
    for (const future of fixtures.resilience.universes) {
      expect(tall.points(future)).toEqual(base.points(future));
    }
  });

  it("matches futures by risk combination even when IDs and risk ordering change", () => {
    for (const future of fixtures.resilience.universes) {
      const matched = fixtures.resilienceWithFixes.universes.find(
        (candidate) => futureKey(candidate) === futureKey(future),
      );
      expect(matched).toBeDefined();
      expect(futureKey({ ...future, id: "changed", riskIds: [...future.riskIds].reverse() })).toBe(
        futureKey(future),
      );
    }
  });

  it("renders empty history and futures without invalid coordinates", () => {
    const empty = { ...fixtures.resilience, universes: [] };
    const graph = timelineGeometry([], today, empty, undefined, limit, 860);
    expect(graph.origin).toEqual({ date: today, usable: limit });
    expect(graph.ticks).toHaveLength(4);
    expect(graph.ticks.every(Number.isFinite)).toBe(true);
    for (const tick of graph.ticks) {
      expect(graph.y(tick)).toBeGreaterThanOrEqual(graph.top - 0.001);
      expect(graph.y(tick)).toBeLessThanOrEqual(graph.bottom + 0.001);
    }
    expect(graph.pastPath).toBe("");
  });

  it("generates finite paths for a 30-future stress fixture", () => {
    const sample = fixtures.resilience.universes[0];
    if (!sample) throw new Error("Missing base fixture");
    const universes = Array.from({ length: 30 }, (_, index) => ({
      ...sample,
      id: `stress-${index}`,
      riskIds: [`stress-risk-${index}`],
    }));
    const report = { ...fixtures.resilience, universes };
    const graph = timelineGeometry(fixtures.history, today, report, undefined, limit, 1280);
    for (const future of universes) {
      const path = graph.path(graph.points(future));
      expect(path).toMatch(/^M/);
      expect(path).not.toMatch(/NaN|Infinity/);
    }
  });
});
