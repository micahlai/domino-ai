import type { CatalogEntry, Read, WorkspaceRun } from "./api";
import { readRun } from "./api";

export const MAX_COMPARISONS = 3;
export type ScenarioComparisons = {
  ids: string[];
  reads: Record<string, Read<WorkspaceRun>>;
  onChange: (ids: string[]) => void;
};

/** Selection never duplicates the open scenario and keeps reads bounded. */
export function comparisonIds(ids: string[], current: string): string[] {
  return [...new Set(ids)].filter((id) => id !== current).slice(0, MAX_COMPARISONS);
}

/** A saved curve must share the imported data and exact forecast weeks. */
export function readComparison(
  raw: unknown,
  source: WorkspaceRun,
  runId: string,
): Read<WorkspaceRun> {
  const read = readRun(raw, { companyId: source.companyId, runId });
  if (read.state !== "ready") return read;
  const other = read.value;
  if (
    other.baselineRunId !== source.baselineRunId ||
    other.baseline.seedHash !== source.baseline.seedHash ||
    other.forecast.weeks.some((week, i) => week.weekStart !== source.forecast.weeks[i]?.weekStart)
  )
    return { state: "unusable" };
  return read;
}

/** Bounded parent hints stay readable even with missing parents or cycles. */
export function scenarioDepth(entry: CatalogEntry, entries: CatalogEntry[]): number {
  const byId = new Map(entries.map((row) => [row.runId, row]));
  const seen = new Set([entry.runId]);
  let parent = entry.parentRunId;
  let depth = 0;
  while (parent && depth < 3 && !seen.has(parent)) {
    seen.add(parent);
    const row = byId.get(parent);
    if (!row) break;
    depth += 1;
    parent = row.parentRunId;
  }
  return depth;
}
