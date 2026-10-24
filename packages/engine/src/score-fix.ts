import type {
  Branch,
  Change,
  CompanyModel,
  Constraint,
  FixCandidate,
  FixScoreContext,
  Snapshot,
} from "@domino/contracts";
import { dominoes } from "./dominoes";
import { cashSchedule, forecastFromSchedule } from "./forecast";
import { compareIds } from "./funding";
import { evaluateOnSchedule, verifiedSchedule } from "./rules";

/**
 * C1 effective changes: ancestorChanges + parent.changes, each exactly once, root to parent.
 * A non-root parent needs explicit ancestry (even []): its own changes are relative.
 */
function parentChanges(parent: Branch, context?: FixScoreContext): Change[] {
  if (parent.parentId !== null && !context) {
    throw new Error(
      `branch ${parent.id} is not a root branch: scoring a fix under it needs its ancestorChanges (use [] when the ancestors have none)`,
    );
  }
  return [...(context?.ancestorChanges ?? []), ...parent.changes];
}

/**
 * Build-spec §6.4 steps 1-3. Returns a relative fix branch with status "proposed": usefulness is
 * a ranking question (rankFixes), never encoded as approval. A non-improving branch is still
 * returned. riskIds carries the parent's known context; missing stays missing (unknown).
 */
export function scoreFix(
  parent: Branch,
  fix: FixCandidate,
  snapshot: Snapshot,
  model: CompanyModel,
  constraints: Constraint[],
  context?: FixScoreContext,
): Branch {
  const before = parentChanges(parent, context);
  const changes = [...before, ...fix.changes];
  const forecast = forecastFromSchedule(snapshot, cashSchedule(snapshot, model, changes));
  const baseline = forecastFromSchedule(snapshot, cashSchedule(snapshot, model, before));
  return {
    id: `${parent.id}__${fix.id}`,
    parentId: parent.id,
    kind: "fix",
    label: fix.label,
    changes: fix.changes.map((c) => ({ ...c })),
    forecast,
    dominoes: dominoes(forecast, constraints, snapshot, { model, changes, baseline }),
    status: "proposed",
    ...(parent.riskIds ? { riskIds: [...parent.riskIds] } : {}),
  };
}

export type RankedFix = {
  fix: FixCandidate;
  branch: Branch;
  /** Fix low point minus parent low point, in cents */
  gain: number;
  /** No constraint breaks under the fix (shared E3b evaluator) */
  clearsAllRules: boolean;
};

const RISK_ORDER = { low: 0, medium: 1, high: 2 } as const;

/**
 * Build-spec §6.4 steps 4-5. Keeps fixes that raise the parent's low point, then orders by
 * "clears every rule", larger gain, lower risk and fix ID. Rules come from the shared evaluator
 * on each fix's verified schedule, never from domino label text.
 */
export function rankFixes(
  parent: Branch,
  scored: { fix: FixCandidate; branch: Branch }[],
  snapshot: Snapshot,
  model: CompanyModel,
  constraints: Constraint[],
  context?: FixScoreContext,
): RankedFix[] {
  const before = parentChanges(parent, context);
  const parentLow = forecastFromSchedule(snapshot, cashSchedule(snapshot, model, before)).lowPoint;
  const ranked = scored.map(({ fix, branch }) => {
    if (branch.parentId !== parent.id) {
      throw new Error(
        `fix branch ${branch.id} was scored against another parent, not ${parent.id}`,
      );
    }
    const changes = [...before, ...fix.changes];
    const schedule = verifiedSchedule(snapshot, branch.forecast, { model, changes });
    const results = evaluateOnSchedule(snapshot, branch.forecast, constraints, schedule);
    return {
      fix,
      branch,
      gain: branch.forecast.lowPoint.usable - parentLow.usable,
      clearsAllRules: results.every((r) => r.status !== "breached"),
    };
  });
  return ranked
    .filter((r) => r.gain > 0)
    .sort(
      (a, b) =>
        Number(b.clearsAllRules) - Number(a.clearsAllRules) ||
        b.gain - a.gain ||
        RISK_ORDER[a.fix.risk] - RISK_ORDER[b.fix.risk] ||
        compareIds(a.fix.id, b.fix.id),
    );
}
