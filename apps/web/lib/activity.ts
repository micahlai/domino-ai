import type { ActivityEvent } from "@domino/contracts";

// Pure feed state for the activity panel. The caller passes events that are already parsed with
// ActivityEventSchema and already authorized for this viewer; nothing here reads a clock, a
// network or a financial value.

export interface ActivityScope {
  caseId: string;
  /** Without a run, every event of the case is shown. With one, case-level events stay too. */
  runId?: string;
}

export interface ActivityState {
  /** Retained events, ordered by sequence then id. */
  events: readonly ActivityEvent[];
  /** Highest sequence dropped by the cap. Anything at or below it is ignored on redelivery. */
  floor: number;
  /** Ids received by the latest ingest that changed the feed. The first load is quiet. */
  fresh: ReadonlySet<string>;
  /** Same id, different content. The first copy wins; the count is shown, never hidden. */
  conflicts: number;
}

export const DEFAULT_CAP = 200;
export const emptyActivity: ActivityState = {
  events: [],
  floor: -1,
  fresh: new Set(),
  conflicts: 0,
};

const inScope = (e: ActivityEvent, s: ActivityScope) =>
  e.caseId === s.caseId && (s.runId === undefined || e.runId === undefined || e.runId === s.runId);

const fingerprint = (e: ActivityEvent) =>
  JSON.stringify([
    e.sequence,
    e.occurredAt,
    e.caseId,
    e.runId,
    e.kind,
    e.status,
    e.entity.kind,
    e.entity.id,
    e.label,
    e.evidenceIds,
    e.outputId,
  ]);

const byOrder = (a: ActivityEvent, b: ActivityEvent) =>
  a.sequence - b.sequence || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Idempotent: redelivering the same events, in any order, returns the same state object. */
export function ingestActivity(
  state: ActivityState,
  incoming: readonly ActivityEvent[],
  scope: ActivityScope,
  { quiet = false, cap = DEFAULT_CAP }: { quiet?: boolean; cap?: number } = {},
): ActivityState {
  const known = new Map(state.events.map((e) => [e.id, e]));
  const added: ActivityEvent[] = [];
  let conflicts = state.conflicts;
  for (const e of incoming) {
    if (!inScope(e, scope)) continue;
    const have = known.get(e.id);
    if (have) {
      if (fingerprint(have) !== fingerprint(e)) conflicts += 1;
      continue;
    }
    if (e.sequence <= state.floor) continue;
    known.set(e.id, e);
    added.push(e);
  }
  if (!added.length && conflicts === state.conflicts) return state;

  const sorted = [...known.values()].sort(byOrder);
  const dropped = sorted.length > cap ? sorted.slice(0, sorted.length - cap) : [];
  const events = dropped.length ? sorted.slice(dropped.length) : sorted;
  const floor = dropped.reduce((m, e) => Math.max(m, e.sequence), state.floor);
  const kept = new Set(events.map((e) => e.id));
  const fresh = added.length
    ? new Set(quiet ? [] : added.filter((e) => kept.has(e.id)).map((e) => e.id))
    : state.fresh;
  return { events, floor, fresh, conflicts };
}

export interface ActivityRow {
  key: string;
  entity: ActivityEvent["entity"];
  /** Latest event by sequence: a later success replaces a failure, an older start never does. */
  latest: ActivityEvent;
  history: readonly ActivityEvent[];
}

/** One row per entity, in order of first retained event, so an update changes a row in place
 * and never re-sorts the list under the pointer. */
export function activityRows(state: ActivityState): ActivityRow[] {
  const rows = new Map<string, ActivityEvent[]>();
  for (const e of state.events) {
    const key = `${e.entity.kind}:${e.entity.id}`;
    rows.set(key, [...(rows.get(key) ?? []), e]);
  }
  return [...rows.entries()].map(([key, history]) => {
    const latest = history[history.length - 1] as ActivityEvent;
    return { key, entity: latest.entity, latest, history };
  });
}
