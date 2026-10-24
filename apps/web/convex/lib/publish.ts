import {
  type Branch,
  BranchSchema,
  type Change,
  ChangeSchema,
  CompanyModelSchema,
  ConstraintSchema,
  type FixCandidate,
  FixCandidateSchema,
  SnapshotSchema,
} from "@domino/contracts";
import { engine } from "@domino/engine";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  type Computation,
  type Inputs,
  type RankedCandidate,
  appliesTo,
  calculate,
  canonical,
  eventBranchId,
  inSnapshot,
  isComputed,
  matchRisk,
  reject,
  runEngine,
} from "./computed";
import { Cents, parse } from "./parse";
import { branchRecord, candidateRecord, missing, requireCompany } from "./records";

type Ctx = Pick<MutationCtx, "db">;
type BranchRow = Doc<"branches">;
type Stored = { row: BranchRow; data: Branch };

const decided = (branch: Branch) => branch.status === "approved" || branch.status === "rejected";

/** Latest snapshot, highest model version and every constraint; nothing is invented. */
export async function loadInputs(ctx: Ctx, companyId: Id<"companies">): Promise<Inputs> {
  await requireCompany(ctx, companyId);
  const snapshotRow = await ctx.db
    .query("snapshots")
    .withIndex("by_company_asOf", (q) => q.eq("companyId", companyId))
    .order("desc")
    .first();
  const modelRow = await ctx.db
    .query("models")
    .withIndex("by_company_version", (q) => q.eq("companyId", companyId))
    .order("desc")
    .first();
  if (!snapshotRow || !modelRow)
    reject("MISSING_INPUT", "This company needs a snapshot and a model before forecasting");
  const snapshot = parse(SnapshotSchema, snapshotRow.data);
  if (snapshot.asOf !== snapshotRow.asOf)
    reject("INVALID_DATA", "Snapshot date does not match its record");
  const constraintRows = await ctx.db
    .query("constraints")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .collect();
  const inputs = {
    snapshot,
    model: parse(CompanyModelSchema, modelRow.data),
    constraints: constraintRows.map((row) => parse(ConstraintSchema, row.data)),
  };
  checkLinks(inputs);
  return inputs;
}

/** C1: unknown legacy relationships are refused here rather than guessed by the engine. */
function checkLinks({ snapshot, constraints }: Inputs) {
  const deal = snapshot.deals.find((d) => d.invoiceId === undefined || d.kind === undefined);
  if (deal) reject("LEGACY_DATA", `Deal ${deal.id} needs its invoice link and kind`);
  const rule = constraints.find((c) => c.kind === "pay_by_date" && c.billId === undefined);
  if (rule) reject("LEGACY_DATA", `Rule ${rule.id} needs the bill it applies to`);
}

async function companyBranches(ctx: Ctx, companyId: Id<"companies">): Promise<Stored[]> {
  const rows = await ctx.db
    .query("branches")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .collect();
  const stored = rows.map((row) => ({ row, data: parse(BranchSchema, row.data) }));
  const legacy = stored.find((b) => !isComputed(companyId, b.data.id));
  if (legacy)
    reject(
      "LEGACY_DATA",
      "This company has illustrative or legacy futures; it needs a reviewed backfill first",
    );
  return stored;
}

async function branchFixes(ctx: Ctx, companyId: Id<"companies">, branchId: string) {
  const rows = await ctx.db
    .query("fixes")
    .withIndex("by_branch", (q) => q.eq("branchId", branchId))
    .collect();
  return rows.filter((row) => row.companyId === companyId);
}

/** Proposals already saved on this company's computed futures. */
async function storedProposals(ctx: Ctx, companyId: Id<"companies">, branches: Stored[]) {
  const proposals: FixCandidate[] = [];
  for (const branch of branches)
    for (const row of await branchFixes(ctx, companyId, branch.data.id))
      proposals.push(parse(FixCandidateSchema, row.data));
  return proposals;
}

/**
 * Proposal ID order is the canonical source order: saved rows come back in rank order per
 * future, so sorting keeps the first run and every rerun applying fixes identically.
 */
const byId = (a: FixCandidate, b: FixCandidate) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export type RecomputeOptions = {
  /** Explicit extra proposals (the demo seed); saved ones are always included. */
  proposals?: FixCandidate[];
  action: "engine.recompute" | "engine.addEvent";
  /** Runs on the fresh computation before any write; throwing leaves the database unchanged. */
  check?: (computation: Computation) => void;
};

/**
 * Load, calculate and publish in one mutation, so readers never see a mix of two runs and a
 * failed run changes nothing. Returns whether anything was written.
 */
export async function recomputeCompany(
  ctx: MutationCtx,
  companyId: Id<"companies">,
  options: RecomputeOptions,
) {
  const inputs = await loadInputs(ctx, companyId);
  const existing = await companyBranches(ctx, companyId);
  const saved = await storedProposals(ctx, companyId, existing);
  const pool = [...saved, ...(options.proposals ?? [])].sort(byId);
  const computation = calculate(companyId, inputs, pool);
  options.check?.(computation);
  await guardDecisions(ctx, companyId, existing, computation);
  const changed = await publish(ctx, companyId, existing, computation);
  const base = computation.branches[0];
  if (changed && base) await log(ctx, companyId, options.action, [base.id]);
  return { computation, changed };
}

/**
 * Fixed-snapshot rule: a decided fix branch, its ancestors and the candidate it was decided
 * on must come back byte-for-byte. Otherwise the run is refused instead of rewriting history.
 */
async function guardDecisions(
  ctx: Ctx,
  companyId: Id<"companies">,
  existing: Stored[],
  computation: Computation,
) {
  const byId = new Map(existing.map((b) => [b.data.id, b]));
  const next = nextBranches(computation);
  for (const fix of existing.filter((b) => decided(b.data))) {
    const chain = ancestry(byId, fix.data);
    for (const branch of [fix.data, ...chain]) {
      const fresh = next.get(branch.id);
      if (!fresh || canonical({ ...fresh, status: branch.status }) !== canonical(branch))
        changedDecision(fix.data.id);
    }
    const parentId = fix.data.parentId ?? "";
    const before = (await branchFixes(ctx, companyId, parentId))
      .map((row) => ({ fix: parse(FixCandidateSchema, row.data), gain: row.gain }))
      .find((c) => `${parentId}__${c.fix.id}` === fix.data.id);
    const after = computation.candidates.get(parentId)?.find((c) => c.branch.id === fix.data.id);
    if (!before || !after || canonical(before) !== canonical({ fix: after.fix, gain: after.gain }))
      changedDecision(fix.data.id);
  }
}

function changedDecision(branchId: string): never {
  reject(
    "DECIDED_CHANGED",
    `The inputs changed under the decided future ${branchId}. This prototype keeps decisions fixed to one snapshot, so nothing was saved.`,
  );
}

function ancestry(byId: Map<string, Stored>, branch: Branch): Branch[] {
  const chain: Branch[] = [];
  const seen = new Set([branch.id]);
  let parentId = branch.parentId;
  while (parentId !== null) {
    const parent = byId.get(parentId);
    if (!parent || seen.has(parentId))
      reject("INVALID_ANCESTRY", `Future ${branch.id} has a broken chain`);
    seen.add(parentId);
    chain.push(parent.data);
    parentId = parent.data.parentId;
  }
  return chain;
}

function nextBranches(computation: Computation): Map<string, Branch> {
  const all = [
    ...computation.branches,
    ...[...computation.candidates.values()].flat().map((c) => c.branch),
  ];
  return new Map(all.map((b) => [b.id, b]));
}

async function publish(
  ctx: Ctx,
  companyId: Id<"companies">,
  existing: Stored[],
  computation: Computation,
): Promise<boolean> {
  let changed = await publishBranches(ctx, companyId, existing, computation);
  for (const branch of computation.branches)
    changed =
      (await publishCandidates(
        ctx,
        companyId,
        branch.id,
        computation.candidates.get(branch.id) ?? [],
      )) || changed;
  changed = (await publishRisks(ctx, companyId, computation)) || changed;
  changed = (await publishReports(ctx, companyId, computation)) || changed;
  return (await publishHistory(ctx, companyId, computation)) || changed;
}

/** Upsert the graph; decided branches keep their status; stale undecided ones are removed. */
async function publishBranches(
  ctx: Ctx,
  companyId: Id<"companies">,
  existing: Stored[],
  computation: Computation,
) {
  let changed = false;
  const next = nextBranches(computation);
  const current = new Map(existing.map((b) => [b.data.id, b]));
  for (const branch of next.values()) {
    const prior = current.get(branch.id) ?? (await foreign(ctx, companyId, branch.id));
    if (!prior) {
      await ctx.db.insert("branches", branchFields(companyId, branch));
      changed = true;
    } else if (!decided(prior.data) && canonical(prior.data) !== canonical(branch)) {
      await ctx.db.replace(prior.row._id, branchFields(companyId, branch));
      changed = true;
    }
  }
  for (const stale of existing.filter((b) => !next.has(b.data.id))) {
    for (const row of await branchFixes(ctx, companyId, stale.data.id))
      await ctx.db.delete(row._id);
    await ctx.db.delete(stale.row._id);
    changed = true;
  }
  return changed;
}

/** A computed ID found under another company is corrupt data, never something to overwrite. */
async function foreign(ctx: Ctx, companyId: Id<"companies">, branchId: string) {
  const other = await branchRecord(ctx, branchId);
  if (other && other.row.companyId !== companyId)
    reject("CROSS_COMPANY", `Future ${branchId} belongs to another company`);
  return other;
}

const branchFields = (companyId: Id<"companies">, branch: Branch) => ({
  companyId,
  branchId: branch.id,
  parentId: branch.parentId,
  kind: branch.kind,
  data: branch,
});

/**
 * Rows are kept in engine rank order (clears every rule, then gain, risk, ID), which
 * fixes.forBranch returns as-is for computed futures. Rewritten only when anything differs.
 */
async function publishCandidates(
  ctx: Ctx,
  companyId: Id<"companies">,
  branchId: string,
  ranked: RankedCandidate[],
) {
  const rows = await branchFixes(ctx, companyId, branchId);
  const before = rows.map((row) => ({ fix: row.data, gain: row.gain }));
  const after = ranked.map(({ fix, gain }) => ({ fix, gain }));
  if (canonical(before) === canonical(after)) return false;
  for (const row of rows) await ctx.db.delete(row._id);
  for (const { fix, gain } of after)
    await ctx.db.insert("fixes", { companyId, branchId, data: fix, gain: parse(Cents, gain) });
  return true;
}

async function publishRisks(ctx: Ctx, companyId: Id<"companies">, computation: Computation) {
  const rows = (
    await ctx.db
      .query("risks")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .collect()
  ).filter((row) => row.asOf === computation.asOf);
  let changed = false;
  const kept = new Set<string>();
  for (const risk of computation.risks) {
    const row = rows.find((r) => r.data?.id === risk.id && !kept.has(r._id));
    if (row) {
      kept.add(row._id);
      if (canonical(row.data) !== canonical(risk)) {
        await ctx.db.patch(row._id, { data: risk });
        changed = true;
      }
    } else {
      await ctx.db.insert("risks", { companyId, asOf: computation.asOf, data: risk });
      changed = true;
    }
  }
  for (const row of rows.filter((r) => !kept.has(r._id))) {
    await ctx.db.delete(row._id);
    changed = true;
  }
  return changed;
}

async function publishReports(ctx: Ctx, companyId: Id<"companies">, computation: Computation) {
  let changed = false;
  for (const withFixes of [false, true]) {
    const data = withFixes ? computation.reports.with : computation.reports.without;
    const rows = (
      await ctx.db
        .query("resilience")
        .withIndex("by_company_withFixes", (q) =>
          q.eq("companyId", companyId).eq("withFixes", withFixes),
        )
        .collect()
    ).filter((row) => row.asOf === computation.asOf);
    const [first, ...extra] = rows;
    for (const row of extra) await ctx.db.delete(row._id);
    if (!first)
      await ctx.db.insert("resilience", { companyId, asOf: computation.asOf, withFixes, data });
    else if (canonical(first.data) !== canonical(data)) await ctx.db.patch(first._id, { data });
    changed = changed || extra.length > 0 || !first || canonical(first.data) !== canonical(data);
  }
  return changed;
}

async function publishHistory(ctx: Ctx, companyId: Id<"companies">, computation: Computation) {
  const rows = await ctx.db
    .query("history")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .collect();
  const [first, ...extra] = rows;
  for (const row of extra) await ctx.db.delete(row._id);
  const fields = computation.history;
  if (!first) await ctx.db.insert("history", { companyId, ...fields });
  else if (canonical({ weeks: first.weeks, pastEvents: first.pastEvents }) !== canonical(fields))
    await ctx.db.patch(first._id, fields);
  else return extra.length > 0;
  return true;
}

async function log(ctx: Ctx, companyId: Id<"companies">, action: string, refs: string[]) {
  await ctx.db.insert("log", {
    companyId,
    actor: "engine",
    action,
    refs,
    at: new Date().toISOString(),
  });
}

/** engine.addEvent: identify the exact current risk, then publish the same consistent run. */
export async function addEventToCompany(
  ctx: MutationCtx,
  companyId: Id<"companies">,
  label: string,
  changes: Change[],
) {
  const input = parse(ChangeSchema.array().min(1), changes);
  let riskId = "";
  const { computation } = await recomputeCompany(ctx, companyId, {
    action: "engine.addEvent",
    check: (fresh) => {
      riskId = matchRisk(fresh.risks, label, input).id;
    },
  });
  const branchId = eventBranchId(companyId, computation.asOf, [riskId]);
  if (!computation.branches.some((b) => b.id === branchId))
    reject("ENGINE_REJECTED", `No future was built for risk ${riskId}`);
  return { riskId, branchId };
}

/**
 * engine.simulateFix: score one saved candidate under its parent using the complete
 * root-to-parent chain. Never touches external systems; decided branches are preserved.
 */
export async function simulateFixForBranch(ctx: MutationCtx, branchId: string, fixId: string) {
  const parent = await branchRecord(ctx, branchId);
  if (!parent) missing("Future not found");
  const companyId = parent.row.companyId;
  await requireCompany(ctx, companyId);
  if (!isComputed(companyId, parent.data.id))
    reject("LEGACY_DATA", "Illustrative futures cannot be simulated; use the computed company");
  const candidate = await candidateRecord(ctx, branchId, fixId);
  if (!candidate || candidate.row.companyId !== companyId) missing("Fix not found for this future");
  const ancestors = await loadAncestors(ctx, companyId, parent);
  const inputs = await loadInputs(ctx, companyId);
  const ancestorChanges = ancestors.flatMap((b) => b.changes);
  checkCurrent(companyId, inputs, parent.data, ancestorChanges);
  if (!appliesTo(candidate.fix, parent.data.riskIds ?? []))
    reject("INVALID_PROPOSAL", "This fix does not target the risks in this future");
  const { snapshot, model, constraints } = inputs;
  const context = parent.data.parentId === null ? undefined : { ancestorChanges };
  const branch = parse(
    BranchSchema,
    runEngine("scoreFix", () =>
      engine.scoreFix(parent.data, candidate.fix, snapshot, model, constraints, context),
    ),
  );
  const prior = await foreign(ctx, companyId, branch.id);
  if (prior && decided(prior.data)) {
    if (canonical({ ...branch, status: prior.data.status }) !== canonical(prior.data))
      changedDecision(branch.id);
    return { branchId: branch.id, changed: false };
  }
  if (prior && canonical(prior.data) === canonical(branch))
    return { branchId: branch.id, changed: false };
  if (prior) await ctx.db.replace(prior.row._id, branchFields(companyId, branch));
  else await ctx.db.insert("branches", branchFields(companyId, branch));
  await log(ctx, companyId, "engine.simulateFix", [fixId, branch.id]);
  return { branchId: branch.id, changed: true };
}

/** Root-to-parent ancestors (excluding the parent), all present, same company, acyclic. */
async function loadAncestors(ctx: Ctx, companyId: Id<"companies">, parent: Stored) {
  const chain: Branch[] = [];
  const seen = new Set([parent.data.id]);
  let next = parent.data.parentId;
  while (next !== null) {
    if (seen.has(next)) reject("INVALID_ANCESTRY", `Future ${parent.data.id} has a cycle`);
    seen.add(next);
    const branch = await branchRecord(ctx, next);
    if (!branch) reject("INVALID_ANCESTRY", `Future ${parent.data.id} is missing an ancestor`);
    if (branch.row.companyId !== companyId)
      reject("CROSS_COMPANY", `An ancestor of ${parent.data.id} belongs to another company`);
    chain.unshift(branch.data);
    next = branch.data.parentId;
  }
  return chain;
}

/** The parent must belong to the latest snapshot and still match the engine's forecast. */
function checkCurrent(
  companyId: string,
  inputs: Inputs,
  parent: Branch,
  ancestorChanges: Change[],
) {
  const { snapshot, model } = inputs;
  const stale = () =>
    reject("STALE_FUTURE", "This future is out of date; recompute the forecast first");
  if (!inSnapshot(companyId, snapshot.asOf, parent.id)) stale();
  const forecast = runEngine("forecast", () =>
    engine.forecast(snapshot, model, [...ancestorChanges, ...parent.changes]),
  );
  if (canonical(forecast) !== canonical(parent.forecast)) stale();
}
