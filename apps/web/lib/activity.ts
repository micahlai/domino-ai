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
  /** Distinct (id, content) variants that contradict the retained copy. The first copy wins. */
  conflicts: number;
  /** The variants behind `conflicts`, so a redelivery is not counted twice. Bounded by MAX_CONFLICTS. */
  conflictKeys: ReadonlySet<string>;
  /** Entity keys in the order each was first seen. Later or earlier events never move a row. */
  order: readonly string[];
}

export const DEFAULT_CAP = 200;
/** Past this many distinct variants new ones are not tracked (the count saturates, shown as "N+"). */
export const MAX_CONFLICTS = 50;
export const emptyActivity: ActivityState = {
  events: [],
  floor: -1,
  fresh: new Set(),
  conflicts: 0,
  conflictKeys: new Set(),
  order: [],
};

export const entityKey = (e: ActivityEvent) => `${e.entity.kind}:${e.entity.id}`;

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

/** Idempotent: redelivering events already seen, in any order, returns the same state object. Row
 * order is the order entities were first seen (a batch is sorted by sequence), so it depends on
 * arrival, but never changes once an entity has a row. */
export function ingestActivity(
  state: ActivityState,
  incoming: readonly ActivityEvent[],
  scope: ActivityScope,
  { quiet = false, cap = DEFAULT_CAP }: { quiet?: boolean; cap?: number } = {},
): ActivityState {
  const known = new Map(state.events.map((e) => [e.id, e]));
  const added: ActivityEvent[] = [];
  let conflictKeys = state.conflictKeys;
  for (const e of incoming) {
    if (!inScope(e, scope)) continue;
    const have = known.get(e.id);
    if (have) {
      const print = fingerprint(e);
      const variant = `${e.id}\n${print}`;
      if (
        print !== fingerprint(have) &&
        !conflictKeys.has(variant) &&
        conflictKeys.size < MAX_CONFLICTS
      )
        conflictKeys = new Set(conflictKeys).add(variant);
      continue;
    }
    if (e.sequence <= state.floor) continue;
    known.set(e.id, e);
    added.push(e);
  }
  if (!added.length && conflictKeys === state.conflictKeys) return state;

  const sorted = [...known.values()].sort(byOrder);
  const dropped = sorted.length > cap ? sorted.slice(0, sorted.length - cap) : [];
  const events = dropped.length ? sorted.slice(dropped.length) : sorted;
  const floor = dropped.reduce((m, e) => Math.max(m, e.sequence), state.floor);
  const kept = new Set(events.map((e) => e.id));
  const fresh = added.length
    ? new Set(quiet ? [] : added.filter((e) => kept.has(e.id)).map((e) => e.id))
    : state.fresh;
  // Keep first-seen order; append new entities (oldest sequence first); forget ones the cap emptied.
  const live = new Set(events.map(entityKey));
  const order = state.order.filter((k) => live.has(k));
  const placed = new Set(order);
  for (const e of events) {
    const k = entityKey(e);
    if (!placed.has(k)) {
      placed.add(k);
      order.push(k);
    }
  }
  return { events, floor, fresh, conflicts: conflictKeys.size, conflictKeys, order };
}

export interface ActivityRow {
  key: string;
  entity: ActivityEvent["entity"];
  /** What the row shows. The latest event by sequence, except that a retry start never hides an
   * unresolved failure: the failure stays until a later success. An older start never wins. */
  latest: ActivityEvent;
  /** A start that came after the failure shown in `latest`. Not progress, only "a retry began". */
  retry?: ActivityEvent;
  history: readonly ActivityEvent[];
}

/** One row per entity, in first-seen order, so an update changes a row in place and never
 * re-sorts the list under the pointer. */
export function activityRows(state: ActivityState): ActivityRow[] {
  const groups = new Map<string, ActivityEvent[]>();
  for (const e of state.events) {
    const key = entityKey(e);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return state.order.flatMap((key) => {
    const history = groups.get(key);
    if (!history) return [];
    const last = history[history.length - 1] as ActivityEvent;
    const settled = history.filter((e) => e.status !== "started");
    const lastSettled = settled[settled.length - 1];
    const retrying = last.status === "started" && lastSettled?.status === "failed";
    return [
      {
        key,
        entity: last.entity,
        latest: retrying ? lastSettled : last,
        retry: retrying ? last : undefined,
        history,
      },
    ];
  });
}
