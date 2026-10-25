import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "./api";
import { fixtureGraph, fixtureRoot, fixtureRules, fixtureScenario } from "./fixtures";
import {
  ForecastSaveGuard,
  acceptedSelection,
  consumeForecast,
  forecastReadyToReveal,
  queueForecast,
} from "./forecastReveal";

const entry = (runId: string, parentRunId = fixtureRoot.runId): CatalogEntry => ({
  ...fixtureGraph[0]!,
  runId,
  parentRunId,
  kind: "scenario",
});

describe("accepted forecast visibility", () => {
  it("requests the saved scenario and its parents before the family subscription catches up", () => {
    const next = acceptedSelection(
      [],
      "incoming",
      fixtureScenario.runId,
      fixtureGraph,
      fixtureRoot.runId,
    );
    expect(next.ids).toContain("incoming");
    expect(next.ids).toContain(fixtureScenario.runId);
    expect(next.ids).toContain(fixtureRules.runId);
    expect(next.ids).not.toContain(fixtureRoot.runId);
    expect(next.omittedAncestors).toBe(0);
  });

  it("prioritizes a newly accepted branch when all six comparison slots are occupied", () => {
    const old = Array.from({ length: 6 }, (_, i) => `old-${i}`);
    const next = acceptedSelection(
      old,
      "incoming",
      fixtureScenario.runId,
      [...fixtureGraph, ...old.map((id) => entry(id))],
      fixtureRoot.runId,
    );
    expect(next.ids).toHaveLength(6);
    expect(next.ids).toContain("incoming");
    expect(next.ids).toContain(fixtureScenario.runId);
    expect(next.ids).toContain(fixtureRules.runId);
    expect(next.omittedAncestors).toBe(0);
  });

  it("reports deep-chain overflow explicitly and keeps the newest curve plus nearest parents", () => {
    const chain = Array.from({ length: 7 }, (_, i) =>
      entry(`parent-${i}`, i ? `parent-${i - 1}` : fixtureRoot.runId),
    );
    const next = acceptedSelection(
      chain.map((e) => e.runId),
      "incoming",
      "parent-6",
      [...fixtureGraph, ...chain],
      fixtureRoot.runId,
    );
    expect(next.ids).toEqual([
      "parent-2",
      "parent-3",
      "parent-4",
      "parent-5",
      "parent-6",
      "incoming",
    ]);
    expect(next.omittedAncestors).toBe(2);
  });
});

describe("saved data arrival", () => {
  const saved = { runId: fixtureScenario.runId, parentRunId: fixtureScenario.parentRunId! };
  it("waits through delayed/missing/error reads and reveals only the validated expected child", () => {
    for (const state of ["loading", "missing", "error", "unusable"] as const)
      expect(forecastReadyToReveal(saved, fixtureRoot, { state })).toBe(false);
    expect(forecastReadyToReveal(saved, fixtureRoot, undefined)).toBe(false);
    expect(
      forecastReadyToReveal(saved, fixtureRoot, { state: "ready", value: fixtureScenario }),
    ).toBe(true);
    expect(
      forecastReadyToReveal({ ...saved, parentRunId: fixtureRoot.runId }, fixtureRoot, {
        state: "ready",
        value: fixtureScenario,
      }),
    ).toBe(false);
  });

  it("rejects data from another source or with mismatched weeks even after a save receipt", () => {
    expect(
      forecastReadyToReveal(saved, fixtureRoot, {
        state: "ready",
        value: { ...fixtureScenario, companyId: "other" },
      }),
    ).toBe(false);
    expect(
      forecastReadyToReveal(saved, fixtureRoot, {
        state: "ready",
        value: { ...fixtureScenario, baselineRunId: "other" },
      }),
    ).toBe(false);
    const other = structuredClone(fixtureScenario);
    other.forecast.weeks[0]!.weekStart = "2026-01-01";
    expect(forecastReadyToReveal(saved, fixtureRoot, { state: "ready", value: other })).toBe(false);
  });

  it("does not animate the same saved run twice after retries, toggles or subscription refreshes", () => {
    const queued = queueForecast({}, saved.runId);
    expect(queueForecast(queued, saved.runId)).toBe(queued);
    const consumed = consumeForecast(queued, saved.runId);
    expect(consumed[saved.runId]).toBe("shown");
    expect(queueForecast(consumed, saved.runId)).toBe(consumed);
    expect(consumeForecast(consumed, saved.runId)).toBe(consumed);
    expect(queueForecast({}, saved.runId)[saved.runId]).toBe("waiting");
    // Saved-run replay does not queue anything: the live write callback is the only producer.
    expect(consumeForecast({}, saved.runId)).toEqual({});
  });
});

describe("save screen ownership", () => {
  it("rejects late completions after switching run/company, navigating away and back, or unmounting", () => {
    const guard = new ForecastSaveGuard();
    const first = { companyId: "a", runId: "source" };
    guard.setContext(first);
    const token = guard.capture();
    guard.setContext(first);
    expect(guard.allows(token)).toBe(true);
    guard.setContext({ ...first, runId: "other" });
    expect(guard.allows(token)).toBe(false);
    guard.setContext(first);
    expect(guard.allows(token)).toBe(false);
    const current = guard.capture();
    guard.setContext({ ...first, companyId: "b" });
    expect(guard.allows(current)).toBe(false);
    guard.dispose();
    expect(guard.matches({ ...first, companyId: "b" })).toBe(false);
    guard.activate();
    expect(guard.allows(current)).toBe(false);
  });
});
