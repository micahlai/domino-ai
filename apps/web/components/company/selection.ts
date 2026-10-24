import type { Branch, Change, FixCandidate, RiskEvent, Universe } from "@domino/contracts";

const changeKey = (change: Change) =>
  JSON.stringify(Object.entries(change).sort(([left], [right]) => left.localeCompare(right)));
const changesKey = (changes: Change[]) => changes.map(changeKey).sort().join("\n");

/** A combination must match in full; never show a single-risk chain for a different future. */
export function matchingEventBranch(future: Universe, risks: RiskEvent[], branches: Branch[]) {
  if (!future.riskIds.length) return branches.find((branch) => branch.kind === "base");
  const selected = future.riskIds.map((id) => risks.find((risk) => risk.id === id));
  if (selected.some((risk) => !risk)) return undefined;
  const changes = selected.flatMap((risk) => risk?.changes ?? []);
  return branches.find(
    (branch) => branch.kind === "event" && changesKey(branch.changes) === changesKey(changes),
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
