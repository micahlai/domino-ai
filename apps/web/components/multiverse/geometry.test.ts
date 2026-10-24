import { fixtures } from "@domino/contracts/fixtures";
import { describe, expect, it } from "vitest";
import { futureKey, timelineGeometry } from "./geometry";

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
