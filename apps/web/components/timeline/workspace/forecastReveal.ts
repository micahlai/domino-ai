import type { CatalogEntry, Read, RunKey, WorkspaceRun } from "./api";
import {
  MAX_COMPARISONS,
  ancestorsOf,
  readComparison,
  showWithAncestors,
} from "./scenarioComparisons";

/** A successful save has priority over older comparisons, including when all slots are full. */
export function acceptedSelection(
  ids: string[],
  resultRunId: string,
  parentRunId: string,
  entries: CatalogEntry[],
  baseRunId: string,
): { ids: string[]; omittedAncestors: number } {
  const required = [...ancestorsOf(parentRunId, entries, baseRunId), parentRunId, resultRunId];
  // Very deep families retain the nearest parents within the chart's six-line budget.
  const chain = [...new Set(required)].filter((id) => id !== baseRunId);
  let next = chain.slice(-MAX_COMPARISONS);
  for (const id of ids) next = showWithAncestors(next, id, entries, baseRunId) ?? next;
  return { ids: next, omittedAncestors: Math.max(0, chain.length - MAX_COMPARISONS) };
}

export type SavedForecasts = Record<string, "waiting" | "shown">;
export function queueForecast(current: SavedForecasts, runId: string): SavedForecasts {
  return current[runId] ? current : { ...current, [runId]: "waiting" };
}
export function consumeForecast(current: SavedForecasts, runId: string): SavedForecasts {
  return current[runId] === "waiting" ? { ...current, [runId]: "shown" } : current;
}

export type SavedForecast = { runId: string; parentRunId: string };

/** Receipts only queue a reveal. The independently validated saved curve must arrive first. */
export function forecastReadyToReveal(
  saved: SavedForecast,
  source: WorkspaceRun,
  read: Read<WorkspaceRun> | undefined,
): boolean {
  if (read?.state !== "ready" || read.value.parentRunId !== saved.parentRunId) return false;
  return readComparison(read.value, source, saved.runId).state === "ready";
}

/** Prevent a late save from changing a different company/run or a screen that has unmounted. */
export class ForecastSaveGuard {
  private context = "";
  private active = true;
  private revision = 0;
  setContext(key: RunKey) {
    const next = JSON.stringify([key.companyId, key.runId]);
    if (next !== this.context) this.revision++;
    this.context = next;
  }
  activate() {
    this.active = true;
  }
  dispose() {
    this.active = false;
    this.revision++;
  }
  matches(key: RunKey) {
    return this.active && this.context === JSON.stringify([key.companyId, key.runId]);
  }
  capture() {
    return `${this.revision}:${this.context}`;
  }
  allows(context: string) {
    return this.active && context === this.capture();
  }
}
