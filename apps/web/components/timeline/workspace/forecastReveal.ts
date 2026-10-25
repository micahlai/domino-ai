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

/** An opened node must wait for its actual saved parent and every visible parent curve. */
export function openedForecastReady(
  run: WorkspaceRun,
  graph: Read<CatalogEntry[]>,
  reads: Record<string, Read<WorkspaceRun>>,
  ids: string[],
  baseRunId: string | null,
): boolean {
  if (!run.parentRunId || run.kind === "baseline" || graph.state !== "ready" || !baseRunId)
    return false;
  const parent = reads[run.parentRunId];
  if (
    !parent ||
    parent.state !== "ready" ||
    readComparison(parent.value, run, run.parentRunId).state !== "ready"
  )
    return false;
  const entries = new Map(graph.value.map((entry) => [entry.runId, entry]));
  let child = run;
  const seen = new Set<string>([run.runId]);
  while (child.runId !== baseRunId) {
    const parentId = child.parentRunId;
    if (!parentId || seen.has(parentId)) return false;
    seen.add(parentId);
    const entry = entries.get(child.runId);
    if (entry && entry.parentRunId !== parentId) return false;
    const read = reads[parentId];
    if (read?.state === "ready") {
      if (readComparison(read.value, run, parentId).state !== "ready") return false;
      child = read.value;
    } else {
      // Ancestors beyond the six-line window remain saved; graph identity must still be complete.
      if (ids.includes(parentId)) return false;
      const ancestor = entries.get(parentId);
      if (
        !ancestor ||
        ancestor.companyId !== run.companyId ||
        ancestor.baselineRunId !== run.baselineRunId
      )
        return false;
      if (parentId === baseRunId)
        return ancestor.kind === "baseline" && ancestor.parentRunId === null;
      let next = ancestor.parentRunId;
      while (next && next !== baseRunId && !seen.has(next)) {
        seen.add(next);
        const above = entries.get(next);
        if (
          !above ||
          above.companyId !== run.companyId ||
          above.baselineRunId !== run.baselineRunId
        )
          return false;
        next = above.parentRunId;
      }
      return next === baseRunId;
    }
  }
  return child.kind === "baseline" && child.parentRunId === null;
}
