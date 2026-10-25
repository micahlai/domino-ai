import type { Forecast } from "@domino/contracts";
import { scenarioStart } from "../../../convex/timeline/scenarioStart";
import type { CatalogEntry, Read, WorkspaceRun } from "./api";
import { readRun } from "./api";

export const MAX_COMPARISONS = 6;
/**
 * One color per shown scenario, readable on light and dark cards. A scenario keeps its color
 * while shown, so lines never swap colors when another one is hidden.
 */
export const SCENARIO_COLORS = [
  "#2f6fde",
  "#d9822b",
  "#8b5cf6",
  "#14a37f",
  "#d6457a",
  "#0ea5c6",
] as const;
export type ScenarioComparisons = {
  ids: string[];
  reads: Record<string, Read<WorkspaceRun>>;
  onChange: (ids: string[]) => void;
  /** Color slot per shown scenario; missing slots fall back to selection order. */
  colors?: Record<string, number>;
};

/** Selection is unique and bounded. The base run is always drawn, so it is never selectable. */
export function comparisonIds(ids: string[], base: string): string[] {
  return [...new Set(ids)].filter((id) => id !== base).slice(0, MAX_COMPARISONS);
}

/** Ancestors of a run, nearest last, stopping at the always-drawn base. */
export function ancestorsOf(id: string, entries: CatalogEntry[], baseRunId: string): string[] {
  const byId = new Map(entries.map((e) => [e.runId, e]));
  const chain: string[] = [];
  const seen = new Set([id]);
  let parent = byId.get(id)?.parentRunId ?? null;
  while (parent && parent !== baseRunId && !seen.has(parent) && byId.has(parent)) {
    chain.unshift(parent);
    seen.add(parent);
    parent = byId.get(parent)?.parentRunId ?? null;
  }
  return chain;
}

/**
 * Show a scenario with every scenario it builds on, so a branch is always drawn leaving a
 * visible parent. Returns null when that would pass the limit of shown lines.
 */
export function showWithAncestors(
  ids: string[],
  id: string,
  entries: CatalogEntry[],
  baseRunId: string,
): string[] | null {
  const next = [...ids];
  for (const run of [...ancestorsOf(id, entries, baseRunId), id])
    if (run !== baseRunId && !next.includes(run)) next.push(run);
  return next.length > MAX_COMPARISONS ? null : next;
}

/** Hide a scenario and everything built on it: a child cannot be shown without its parent. */
export function hideWithDescendants(ids: string[], id: string, entries: CatalogEntry[]): string[] {
  const children = new Map<string, string[]>();
  for (const e of entries)
    if (e.parentRunId)
      children.set(e.parentRunId, [...(children.get(e.parentRunId) ?? []), e.runId]);
  const drop = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const run = stack.pop() as string;
    if (drop.has(run)) continue;
    drop.add(run);
    stack.push(...(children.get(run) ?? []));
  }
  return ids.filter((x) => !drop.has(x));
}

/** Tick or untick one scenario under the parent-first rule; null when it cannot be shown. */
export function toggleShown(
  ids: string[],
  id: string,
  entries: CatalogEntry[],
  baseRunId: string,
): string[] | null {
  return ids.includes(id)
    ? hideWithDescendants(ids, id, entries)
    : showWithAncestors(ids, id, entries, baseRunId);
}

/** Keep existing color slots, give each newly shown scenario the lowest free one. */
export function assignColors(
  previous: Record<string, number>,
  ids: string[],
): Record<string, number> {
  const next: Record<string, number> = {};
  for (const id of ids) if (previous[id] !== undefined) next[id] = previous[id];
  const used = new Set(Object.values(next));
  for (const id of ids) {
    if (next[id] !== undefined) continue;
    let slot = 0;
    while (used.has(slot)) slot++;
    next[id] = slot;
    used.add(slot);
  }
  return next;
}

export const colorFor = (comparisons: ScenarioComparisons, id: string): string => {
  const slot = comparisons.colors?.[id] ?? Math.max(0, comparisons.ids.indexOf(id));
  return SCENARIO_COLORS[slot % SCENARIO_COLORS.length] ?? SCENARIO_COLORS[0];
};

/**
 * Where a shown scenario forks on the chart: the nearest shown ancestor, else the base. Its
 * line starts at the last week it still equals that anchor, so a branch visibly leaves its
 * parent's line instead of the base's.
 */
export function forkOf(
  id: string,
  entries: CatalogEntry[],
  shown: Set<string>,
  baseRunId: string,
): string {
  const byId = new Map(entries.map((e) => [e.runId, e]));
  const seen = new Set([id]);
  let parent = byId.get(id)?.parentRunId ?? null;
  while (parent && !seen.has(parent)) {
    if (parent === baseRunId || shown.has(parent)) return parent;
    seen.add(parent);
    parent = byId.get(parent)?.parentRunId ?? null;
  }
  return baseRunId;
}

/** First forecast week where two saved curves differ, or -1 when they never do. */
export function firstDifference(a: Forecast, b: Forecast): number {
  return a.weeks.findIndex((week, i) => week.usable !== b.weeks[i]?.usable);
}

/**
 * Earliest date a new child of `runId` may start: the start of the nearest run in its
 * ancestry (itself included) that changes events. Mirrors the server's branch check.
 */
export function branchStart(runId: string, entries: CatalogEntry[]): string | null {
  const byId = new Map(entries.map((e) => [e.runId, e]));
  const seen = new Set<string>();
  let current: string | null = runId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const entry = byId.get(current);
    if (!entry) return null;
    if (entry.startsOn) return entry.startsOn;
    current = entry.parentRunId;
  }
  return null;
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

/** Saved scenarios built from the open run's books, always including the open run. */
export function familyEntries(run: WorkspaceRun, graph: Read<CatalogEntry[]>): CatalogEntry[] {
  const entries =
    graph.state === "ready"
      ? graph.value.filter(
          (entry) => entry.companyId === run.companyId && entry.baselineRunId === run.baselineRunId,
        )
      : [];
  // A capped family read may omit the current node; its saved record is already available.
  if (!entries.some((entry) => entry.runId === run.runId))
    entries.push({
      runId: run.runId,
      companyId: run.companyId,
      baselineRunId: run.baselineRunId,
      parentRunId: run.parentRunId,
      kind: run.kind,
      label: run.label,
      savedAt: run.savedAt,
      lowPointCents: run.forecast.lowPoint.usable,
      lowPointWeek: run.forecast.lowPoint.weekStart,
      constraintVersion: run.constraintVersion,
      startsOn: scenarioStart(run.ownChanges, run.baseline.seed.snapshot),
    });
  return entries;
}
