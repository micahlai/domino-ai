import {
  type Branch,
  BranchSchema,
  type Change,
  type CompanyModel,
  type Constraint,
  type FixCandidate,
  FixCandidateSchema,
  type HistoryWeek,
  HistoryWeekSchema,
  type PastEvent,
  PastEventSchema,
  type ResilienceReport,
  ResilienceReportSchema,
  type RiskEvent,
  RiskEventSchema,
  type Snapshot,
} from "@domino/contracts";
import { engine, rankFixes } from "@domino/engine";
import { ConvexError } from "convex/values";
import { Cents, parse } from "./parse";

/** Weeks of real history shown on the past side of the timeline (build-spec §3). */
export const HISTORY_WEEKS = 26;

export function reject(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

/**
 * Computed IDs embed the Convex company ID, so a computed company never collides with the
 * fixture IDs (br_*, fix_*) or with another company in the global by_branchId index.
 */
export const computedPrefix = (companyId: string) => `c_${companyId}_`;
const scope = (companyId: string, asOf: string) => `${computedPrefix(companyId)}${asOf}_`;
export const baseBranchId = (companyId: string, asOf: string) => `${scope(companyId, asOf)}base`;

/** Canonical sorted risk set; encoding keeps the join injective for any risk ID. */
export function eventBranchId(companyId: string, asOf: string, riskIds: string[]) {
  const ids = [...riskIds].sort().map(encodeURIComponent).join(",");
  return `${scope(companyId, asOf)}event_${ids}`;
}

export const isComputed = (companyId: string, branchId: string) =>
  branchId.startsWith(computedPrefix(companyId));
export const inSnapshot = (companyId: string, asOf: string, branchId: string) =>
  branchId.startsWith(scope(companyId, asOf));

/** Key-order independent JSON, so equal payloads compare equal however they were built. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/** Run a pure engine call; engine input errors become a clear, typed rejection. */
export function runEngine<T>(step: string, call: () => T): T {
  try {
    return call();
  } catch (error) {
    if (error instanceof ConvexError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    reject("ENGINE_REJECTED", `${step}: ${detail}`);
  }
}

export type Inputs = { snapshot: Snapshot; model: CompanyModel; constraints: Constraint[] };
export type RankedCandidate = { fix: FixCandidate; gain: number; branch: Branch };
export type Computation = {
  asOf: string;
  risks: RiskEvent[];
  /** Base first, then event branches in stress-test generation order. */
  branches: Branch[];
  /** Ranked useful candidates per base/event branch ID, engine order. */
  candidates: Map<string, RankedCandidate[]>;
  reports: { without: ResilienceReport; with: ResilienceReport };
  history: { weeks: HistoryWeek[]; pastEvents: PastEvent[] };
};

/** Deduplicate by ID in first-seen order; one ID with two different payloads is ambiguous. */
export function uniqueProposals(proposals: FixCandidate[]): FixCandidate[] {
  const seen = new Map<string, FixCandidate>();
  for (const proposal of proposals) {
    const fix = parse(FixCandidateSchema, proposal);
    const prior = seen.get(fix.id);
    if (prior && canonical(prior) !== canonical(fix))
      reject("INVALID_PROPOSAL", `Two different proposals share the ID ${fix.id}`);
    if (!prior) seen.set(fix.id, fix);
  }
  return [...seen.values()];
}

function checkTargets(proposals: FixCandidate[], risks: RiskEvent[]) {
  const known = new Set(risks.map((risk) => risk.id));
  for (const fix of proposals) {
    if (!fix.targetRiskIds)
      reject("LEGACY_DATA", `Proposal ${fix.id} does not say which risks it targets`);
    const unknown = fix.targetRiskIds.find((id) => !known.has(id));
    if (unknown) reject("INVALID_PROPOSAL", `Proposal ${fix.id} targets unknown risk ${unknown}`);
  }
}

/** [] targets every future; otherwise any listed risk must be in the branch (OR matching). */
export const appliesTo = (fix: FixCandidate, riskIds: string[]) =>
  fix.targetRiskIds !== undefined &&
  (fix.targetRiskIds.length === 0 || fix.targetRiskIds.some((id) => riskIds.includes(id)));

/**
 * Pure E3/E4 run for one company snapshot. Nothing here reads fixtures or the clock: the
 * branch graph, gains, reports and history all come from the engine on the given inputs.
 */
export function calculate(
  companyId: string,
  { snapshot, model, constraints }: Inputs,
  sourceProposals: FixCandidate[],
): Computation {
  const asOf = snapshot.asOf;
  const risks = runEngine("scanRisks", () => engine.scanRisks(snapshot, model, constraints));
  const proposals = uniqueProposals(sourceProposals);
  checkTargets(proposals, risks);
  const without = runEngine("stressTest", () =>
    engine.stressTest(snapshot, model, constraints, risks, []),
  );
  const base = baseBranch(companyId, { snapshot, model, constraints });
  const events = without.universes
    .filter((u) => u.riskIds.length > 0)
    .map((u) => eventBranch(companyId, { snapshot, model, constraints }, base, risks, u.riskIds));
  const branches = [base, ...events];
  const candidates = new Map<string, RankedCandidate[]>();
  for (const branch of branches)
    candidates.set(branch.id, rankFor(branch, proposals, { snapshot, model, constraints }));
  const useful = new Set([...candidates.values()].flat().map((c) => c.fix.id));
  const selected = proposals.filter((fix) => useful.has(fix.id));
  const withFixes = runEngine("stressTest with fixes", () =>
    engine.stressTest(snapshot, model, constraints, risks, selected),
  );
  return validate({
    asOf,
    risks,
    branches,
    candidates,
    reports: { without, with: withFixes },
    history: {
      weeks: runEngine("history", () => engine.history(snapshot, HISTORY_WEEKS)),
      pastEvents: runEngine("pastEvents", () => engine.pastEvents(snapshot, model)),
    },
  });
}

function baseBranch(companyId: string, { snapshot, model, constraints }: Inputs): Branch {
  const forecast = runEngine("forecast", () => engine.forecast(snapshot, model, []));
  return {
    id: baseBranchId(companyId, snapshot.asOf),
    parentId: null,
    kind: "base",
    label: "Base forecast",
    changes: [],
    forecast,
    dominoes: runEngine("dominoes", () =>
      engine.dominoes(forecast, constraints, snapshot, { model, changes: [] }),
    ),
    status: "draft",
    riskIds: [],
  };
}

/** Every event branch parents the base and carries its whole risk set's changes once. */
function eventBranch(
  companyId: string,
  { snapshot, model, constraints }: Inputs,
  base: Branch,
  risks: RiskEvent[],
  riskIds: string[],
): Branch {
  const chosen = riskIds.map((id) => {
    const risk = risks.find((r) => r.id === id);
    if (!risk) reject("ENGINE_REJECTED", `Stress test returned unknown risk ${id}`);
    return risk;
  });
  const changes = chosen.flatMap((risk) => risk.changes);
  const forecast = runEngine("forecast", () => engine.forecast(snapshot, model, changes));
  return {
    id: eventBranchId(companyId, snapshot.asOf, riskIds),
    parentId: base.id,
    kind: "event",
    label: chosen.map((risk) => risk.label).join(" + "),
    probability: chosen.reduce((p, risk) => p * risk.probability, 1),
    changes,
    forecast,
    dominoes: runEngine("dominoes", () =>
      engine.dominoes(forecast, constraints, snapshot, {
        model,
        changes,
        baseline: base.forecast,
      }),
    ),
    status: "draft",
    riskIds: [...riskIds],
  };
}

/** Base is the root; an event's only ancestor is the base, which has no changes. */
function rankFor(parent: Branch, proposals: FixCandidate[], inputs: Inputs): RankedCandidate[] {
  const { snapshot, model, constraints } = inputs;
  const context = parent.parentId === null ? undefined : { ancestorChanges: [] };
  const matching = proposals.filter((fix) => appliesTo(fix, parent.riskIds ?? []));
  const scored = matching.map((fix) => ({
    fix,
    branch: runEngine(`scoreFix ${fix.id}`, () =>
      engine.scoreFix(parent, fix, snapshot, model, constraints, context),
    ),
  }));
  return runEngine("rankFixes", () =>
    rankFixes(parent, scored, snapshot, model, constraints, context),
  ).map(({ fix, gain, branch }) => ({ fix, gain, branch }));
}

function validate(result: Computation): Computation {
  const branch = (b: Branch) => parse(BranchSchema, b);
  const candidates = new Map(
    [...result.candidates].map(([id, rows]) => [
      id,
      rows.map((row) => ({
        fix: parse(FixCandidateSchema, row.fix),
        gain: parse(Cents, row.gain),
        branch: branch(row.branch),
      })),
    ]),
  );
  return {
    asOf: result.asOf,
    risks: result.risks.map((risk) => parse(RiskEventSchema, risk)),
    branches: result.branches.map(branch),
    candidates,
    reports: {
      without: parse(ResilienceReportSchema, result.reports.without),
      with: parse(ResilienceReportSchema, result.reports.with),
    },
    history: {
      weeks: parse(HistoryWeekSchema.array(), result.history.weeks),
      pastEvents: parse(PastEventSchema.array(), result.history.pastEvents),
    },
  };
}

/**
 * The event input carries no probability, so it must name a risk the engine already found:
 * exact ordered changes, with the label only breaking ties. Never invents a chance.
 */
export function matchRisk(risks: RiskEvent[], label: string, changes: Change[]): RiskEvent {
  const key = canonical(changes);
  const same = risks.filter((risk) => canonical(risk.changes) === key);
  const matches = same.length > 1 ? same.filter((risk) => risk.label === label) : same;
  if (matches.length === 0) {
    if (same.length > 1) reject("EVENT_AMBIGUOUS", "Several current risks match this event");
    reject("EVENT_NOT_FOUND", "This event does not match a current risk");
  }
  if (matches.length > 1) reject("EVENT_AMBIGUOUS", "Several current risks match this event");
  return matches[0] as RiskEvent;
}
