import type { Branch, Change, FixCandidate, RiskEvent, Universe } from "@domino/contracts";

// Object property order is storage noise; array order is meaningful, so it is kept.
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
            .map(([key, entry]) => [key, canonical(entry)]),
        )
      : value;
const changesKey = (changes: Change[]) => JSON.stringify(canonical(changes));

const sameRiskSet = (left: string[], right: string[]) =>
  left.length === right.length && right.every((id) => left.includes(id));

/** Only one candidate is a match; two equally good ones mean we would be guessing. */
const onlyOne = <T>(items: T[]) => (items.length === 1 ? items[0] : undefined);

/**
 * Branches saved before riskIds existed: trust the changes only for an event sitting directly
 * under one empty base, in the same order the risks were selected.
 */
function legacyEventBranch(changes: Change[], branches: Branch[]) {
  if (!changes.length) return undefined;
  const key = changesKey(changes);
  return onlyOne(
    branches.filter((branch) => {
      if (branch.kind !== "event" || branch.riskIds || changesKey(branch.changes) !== key) {
        return false;
      }
      const parents = branches.filter((candidate) => candidate.id === branch.parentId);
      const parent = parents.length === 1 ? parents[0] : undefined;
      return parent?.kind === "base" && !parent.changes.length && !parent.riskIds?.length;
    }),
  );
}

/**
 * A combination must match in full; never show a single-risk chain for a different future.
 * Explicit cumulative riskIds decide first and a mismatch never falls back to changes.
 */
export function matchingEventBranch(future: Universe, risks: RiskEvent[], branches: Branch[]) {
  if (!future.riskIds.length) return branches.find((branch) => branch.kind === "base");
  if (new Set(future.riskIds).size !== future.riskIds.length) return undefined;
  const selected = future.riskIds.map((id) => risks.find((risk) => risk.id === id));
  if (selected.some((risk) => !risk)) return undefined;

  const explicit = branches.filter(
    (branch) =>
      branch.kind === "event" && branch.riskIds && sameRiskSet(branch.riskIds, future.riskIds),
  );
  if (explicit.length) return onlyOne(explicit);

  return legacyEventBranch(
    selected.flatMap((risk) => risk?.changes ?? []),
    branches,
  );
}

export function matchingFixBranch(parent: Branch, fix: FixCandidate, branches: Branch[]) {
  return branches.find(
    (branch) =>
      branch.kind === "fix" &&
      branch.parentId === parent.id &&
      JSON.stringify(branch.changes) === JSON.stringify(fix.changes),
  );
}

export function weekOf(dateISO: string) {
  const date = new Date(`${dateISO}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
