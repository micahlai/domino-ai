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
import { engine, rankFixes } from "@domino/engine";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  type Computation,
  type Inputs,
  type RankedCandidate,
  appliesTo,
  calculate,
  canonical,
  eventBranchId,
  isComputed,
  matchRisk,
  reject,
  runEngine,
  uniqueProposals,
} from "./computed";
import { Cents, parse } from "./parse";
import { branchRecord, candidateRecord, missing, requireCompany } from "./records";

type Ctx = Pick<MutationCtx, "db">;
type Reader = Pick<QueryCtx, "db">;
type BranchRow = Doc<"branches">;
type Stored = { row: BranchRow; data: Branch };

const decided = (branch: Branch) => branch.status === "approved" || branch.status === "rejected";

/** Latest snapshot, highest model version and every constraint; nothing is invented. */
export async function loadInputs(ctx: Reader, companyId: Id<"companies">): Promise<Inputs> {
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

async function companyBranches(ctx: Reader, companyId: Id<"companies">): Promise<Stored[]> {
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

async function branchFixes(ctx: Reader, companyId: Id<"companies">, branchId: string) {
  const rows = await ctx.db
    .query("fixes")
    .withIndex("by_branch", (q) => q.eq("branchId", branchId))
    .collect();
  return rows.filter((row) => row.companyId === companyId);
}

/** Proposals already saved on this company's computed futures. */
async function storedProposals(ctx: Reader, companyId: Id<"companies">, branches: Stored[]) {
  const proposals: FixCandidate[] = [];
  for (const branch of branches)
    for (const row of await branchFixes(ctx, companyId, branch.data.id))
      proposals.push(parse(FixCandidateSchema, row.data));
  return proposals;
}

/**
 * Source order of the useful proposals. Fix rows are stored in per-future display rank, so the
 * order the stress test applies proposals in lives in its own log entry instead.
 */
const ORDER = "engine.proposal-order";

/**
 * Reads only this company's order rows (index by_company_and_action), never the whole log: the
 * old filtered scan grew with every ingest and collided with the agents writing log rows.
 */
async function savedOrder(ctx: Reader, companyId: Id<"companies">) {
  const row = await ctx.db
    .query("log")
    .withIndex("by_company_and_action", (q) => q.eq("companyId", companyId).eq("action", ORDER))
    .order("desc")
    .first();
  return row?.refs ?? null;
}

/**
 * Saved proposals in their recorded order, then genuinely new explicit ones in caller order.
 * Missing order, missing payloads and conflicting payloads are refused, never guessed.
 */
async function proposalPool(
  ctx: Reader,
  companyId: Id<"companies">,
  existing: Stored[],
  explicit: FixCandidate[],
) {
  const saved = uniqueProposals(await storedProposals(ctx, companyId, existing));
  const order = await savedOrder(ctx, companyId);
  if (order === null && saved.length > 0)
    reject("LEGACY_DATA", "Saved proposals have no recorded order; they need a reviewed backfill");
  const ids = order ?? [];
  const byId = new Map(saved.map((fix) => [fix.id, fix]));
  if (new Set(ids).size !== ids.length || saved.some((fix) => !ids.includes(fix.id)))
    reject("INVALID_DATA", "The recorded proposal order does not match the saved proposals");
  const ordered = ids.map(
    (id) => byId.get(id) ?? reject("INVALID_DATA", `Saved proposal ${id} is missing`),
  );
  return { order, pool: uniqueProposals([...ordered, ...explicit]) };
}

export type RecomputeOptions = {
  /** Explicit extra proposals (the demo seed); saved ones are always included. */
  proposals?: FixCandidate[];
  action: RecomputeAction;
  /** Runs on the fresh computation before any write; throwing leaves the database unchanged. */
  check?: (computation: Computation) => void;
};
export type RecomputeAction = "engine.recompute" | "engine.addEvent";

/**
 * A run is split into load (query) -> calculate (action) -> write (mutation), because the
 * engine alone can exceed Convex's 1 s query/mutation limit on the larger companies. The write
 * commits only if the rows the load read are byte-identical; `stamp` fingerprints them.
 */
export type RecomputeLoad = {
  inputs: Inputs;
  pool: FixCandidate[];
  order: string[] | null;
  stamp: string;
};
export type RecomputePlan = {
  computation: Computation;
  /** The useful proposal IDs in pool order: the next engine.proposal-order entry. */
  nextOrder: string[];
};

/** Every row a recompute's result depends on: inputs, saved proposals and their order. */
async function recomputeRows(ctx: Reader, companyId: Id<"companies">) {
  const snapshot = await ctx.db
    .query("snapshots")
    .withIndex("by_company_asOf", (q) => q.eq("companyId", companyId))
    .order("desc")
    .first();
  const model = await ctx.db
    .query("models")
    .withIndex("by_company_version", (q) => q.eq("companyId", companyId))
    .order("desc")
    .first();
  const constraints = await ctx.db
    .query("constraints")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .collect();
  const branches = await ctx.db
    .query("branches")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .collect();
  const fixes = [];
  for (const branch of branches)
    fixes.push(...(await branchFixes(ctx, companyId, (branch.data as Branch).id)));
  const order = await ctx.db
    .query("log")
    .withIndex("by_company_and_action", (q) => q.eq("companyId", companyId).eq("action", ORDER))
    .order("desc")
    .first();
  return [snapshot, model, constraints, fixes, order];
}

/** Convex returns object keys sorted, so equal rows always stringify equally. */
async function stampOf(rows: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(rows));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Load: the exact inputs and proposal pool, validated, plus the fingerprint of their rows. */
export async function loadRecompute(
  ctx: Reader,
  companyId: Id<"companies">,
  proposals: FixCandidate[] = [],
): Promise<RecomputeLoad> {
  const inputs = await loadInputs(ctx, companyId);
  const existing = await companyBranches(ctx, companyId);
  const { order, pool } = await proposalPool(ctx, companyId, existing, proposals);
  return { inputs, pool, order, stamp: await stampOf(await recomputeRows(ctx, companyId)) };
}

/** Calculate: pure engine work, no database. `check` throwing stops the run before any write. */
export function planRecompute(
  companyId: Id<"companies">,
  { inputs, pool }: RecomputeLoad,
  check?: (computation: Computation) => void,
): RecomputePlan {
  const computation = calculate(companyId, inputs, pool);
  check?.(computation);
  const useful = new Set([...computation.candidates.values()].flat().map((c) => c.fix.id));
  return { computation, nextOrder: pool.filter((fix) => useful.has(fix.id)).map((f) => f.id) };
}

/**
 * Write: publish only if the loaded rows are unchanged ({ stale: true } otherwise, nothing
 * written). Readers never see a mix of two runs and a refused run changes nothing.
 */
export async function writeRecompute(
  ctx: MutationCtx,
  companyId: Id<"companies">,
  load: Pick<RecomputeLoad, "order" | "stamp">,
  { computation, nextOrder }: RecomputePlan,
  action: RecomputeAction,
): Promise<{ stale: true } | { stale: false; changed: boolean }> {
  await requireCompany(ctx, companyId);
  if ((await stampOf(await recomputeRows(ctx, companyId))) !== load.stamp) return { stale: true };
  const existing = await companyBranches(ctx, companyId);
  await guardDecisions(ctx, companyId, existing, computation);
  let changed = await publish(ctx, companyId, existing, computation);
  if (canonical(nextOrder) !== canonical(load.order ?? [])) {
    await log(ctx, companyId, ORDER, nextOrder);
    changed = true;
  }
  const base = computation.branches[0];
  if (changed && base) await log(ctx, companyId, action, [base.id]);
  return { stale: false, changed };
}

/**
 * The whole run in one mutation (seed and tests; small companies only). Production entry
 * points (engine.ts, ingest) use the same three steps across query/action/mutation instead.
 */
export async function recomputeCompany(
  ctx: MutationCtx,
  companyId: Id<"companies">,
  options: RecomputeOptions,
) {
  const load = await loadRecompute(ctx, companyId, options.proposals ?? []);
  const plan = planRecompute(companyId, load, options.check);
  const result = await writeRecompute(ctx, companyId, load, plan, options.action);
  if (result.stale) reject("INVALID_DATA", "Inputs changed inside one transaction");
  return { computation: plan.computation, changed: result.changed };
}

/** Computation crosses function boundaries as plain values: a Map is not a Convex value. */
export type WireComputation = Omit<Computation, "candidates"> & {
  candidates: [string, RankedCandidate[]][];
};
export const toWire = (computation: Computation): WireComputation => ({
  ...computation,
  candidates: [...computation.candidates],
});
export const fromWire = (wire: WireComputation): Computation => ({
  ...wire,
  candidates: new Map(wire.candidates),
});

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

/**
 * engine.addEvent: identify the exact current risk on the fresh computation, before any write.
 * `found` is filled by `check`; a risk with no built future is refused, so nothing is saved.
 */
export function eventCheck(companyId: Id<"companies">, label: string, changes: Change[]) {
  const input = parse(ChangeSchema.array().min(1), changes);
  const found = { riskId: "", branchId: "" };
  const check = (fresh: Computation) => {
    const riskId = matchRisk(fresh.risks, label, input).id;
    const branchId = eventBranchId(companyId, fresh.asOf, [riskId]);
    if (!fresh.branches.some((b) => b.id === branchId))
      reject("ENGINE_REJECTED", `No future was built for risk ${riskId}`);
    found.riskId = riskId;
    found.branchId = branchId;
  };
  return { check, found };
}

/** engine.addEvent in one mutation (tests); production runs it through the split steps. */
export async function addEventToCompany(
  ctx: MutationCtx,
  companyId: Id<"companies">,
  label: string,
  changes: Change[],
) {
  const { check, found } = eventCheck(companyId, label, changes);
  await recomputeCompany(ctx, companyId, { action: "engine.addEvent", check });
  return { ...found };
}

type RawFix = { data: unknown; gain: unknown };

/** Everything engine.simulateFix reads, validated, plus the fingerprint of those rows. */
export type SimulateFixLoad = {
  companyId: Id<"companies">;
  fixId: string;
  parent: Branch;
  /** Root-to-parent ancestors, excluding the parent. */
  ancestors: Branch[];
  candidate: { fix: FixCandidate; gain: number };
  inputs: Inputs;
  pool: FixCandidate[];
  /** Saved fix rows under each chain branch, for rebuilding futures nested below the map. */
  chainFixes: [string, RawFix[]][];
  storedRisks: unknown[];
  stamp: string;
};

/** Rows a simulation depends on beyond a recompute's: the chain and the saved risks. */
async function simulateRows(ctx: Reader, companyId: Id<"companies">, chainIds: string[]) {
  const chain = [];
  for (const id of chainIds)
    chain.push(
      await ctx.db
        .query("branches")
        .withIndex("by_branchId", (q) => q.eq("branchId", id))
        .unique(),
    );
  const risks = await ctx.db
    .query("risks")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .collect();
  return [await recomputeRows(ctx, companyId), chain, risks];
}

/**
 * Load for engine.simulateFix: the saved candidate under its parent, the complete
 * root-to-parent chain and the current inputs. Refusals keep the original order.
 */
export async function loadSimulateFix(
  ctx: Reader,
  branchId: string,
  fixId: string,
): Promise<SimulateFixLoad> {
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
  const existing = await companyBranches(ctx, companyId);
  const { pool } = await proposalPool(ctx, companyId, existing, []);
  const chainIds = [...ancestors.map((b) => b.id), parent.data.id];
  const chainFixes: [string, RawFix[]][] = [];
  for (const id of chainIds)
    chainFixes.push([
      id,
      (await branchFixes(ctx, companyId, id)).map((row) => ({ data: row.data, gain: row.gain })),
    ]);
  const riskRows = await ctx.db
    .query("risks")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .collect();
  return {
    companyId,
    fixId,
    parent: parent.data,
    ancestors,
    candidate: { fix: candidate.fix, gain: candidate.gain },
    inputs,
    pool,
    chainFixes,
    storedRisks: riskRows.filter((row) => row.asOf === inputs.snapshot.asOf).map((r) => r.data),
    stamp: await stampOf(await simulateRows(ctx, companyId, chainIds)),
  };
}

/**
 * Calculate for engine.simulateFix: rebuild the current context, refuse a stale chain,
 * candidate or risk set, then score the candidate under its parent. Pure; no database.
 */
export function planSimulateFix(load: SimulateFixLoad): Branch {
  const { parent, ancestors, candidate, inputs } = load;
  const ancestorChanges = ancestors.flatMap((b) => b.changes);
  checkContext(load, [...ancestors, parent]);
  if (!appliesTo(candidate.fix, parent.riskIds ?? []))
    reject("INVALID_PROPOSAL", "This fix does not target the risks in this future");
  const { snapshot, model, constraints } = inputs;
  const context = parent.parentId === null ? undefined : { ancestorChanges };
  return parse(
    BranchSchema,
    runEngine("scoreFix", () =>
      engine.scoreFix(parent, candidate.fix, snapshot, model, constraints, context),
    ),
  );
}

/** Write for engine.simulateFix; { stale: true } (nothing written) if any loaded row moved. */
export async function writeSimulateFix(
  ctx: MutationCtx,
  load: Pick<SimulateFixLoad, "companyId" | "fixId" | "parent" | "ancestors" | "stamp">,
  branch: Branch,
): Promise<{ stale: true } | { stale: false; branchId: string; changed: boolean }> {
  const { companyId, fixId } = load;
  await requireCompany(ctx, companyId);
  const chainIds = [...load.ancestors.map((b) => b.id), load.parent.id];
  if ((await stampOf(await simulateRows(ctx, companyId, chainIds))) !== load.stamp)
    return { stale: true };
  const prior = await foreign(ctx, companyId, branch.id);
  if (prior && decided(prior.data)) {
    if (canonical({ ...branch, status: prior.data.status }) !== canonical(prior.data))
      changedDecision(branch.id);
    return { stale: false, branchId: branch.id, changed: false };
  }
  if (prior && canonical(prior.data) === canonical(branch))
    return { stale: false, branchId: branch.id, changed: false };
  if (prior) await ctx.db.replace(prior.row._id, branchFields(companyId, branch));
  else await ctx.db.insert("branches", branchFields(companyId, branch));
  await log(ctx, companyId, "engine.simulateFix", [fixId, branch.id]);
  return { stale: false, branchId: branch.id, changed: true };
}

/** engine.simulateFix in one mutation (tests); production runs it through the split steps. */
export async function simulateFixForBranch(ctx: MutationCtx, branchId: string, fixId: string) {
  const load = await loadSimulateFix(ctx, branchId, fixId);
  const result = await writeSimulateFix(ctx, load, planSimulateFix(load));
  if (result.stale) reject("INVALID_DATA", "Inputs changed inside one transaction");
  return { branchId: result.branchId, changed: result.changed };
}

/** Root-to-parent ancestors (excluding the parent), all present, same company, acyclic. */
async function loadAncestors(ctx: Reader, companyId: Id<"companies">, parent: Stored) {
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

/**
 * Rebuild the whole current context once and require the stored root-to-parent chain, the
 * parent's candidate and the risks to match it. Rules and risk odds can change without moving
 * cash, so a forecast check alone would score a new fix beneath an old assessment. Fixes nested
 * below the generated map are rebuilt level by level from their rebuilt parent, never trusted.
 */
function checkContext(load: SimulateFixLoad, chain: Branch[]) {
  const { companyId, inputs, pool, candidate } = load;
  const stale = () =>
    reject("STALE_FUTURE", "This future is out of date; recompute the forecast first");
  const computation = calculate(companyId, inputs, pool);
  const fresh = nextBranches(computation);
  const savedFixes = new Map(load.chainFixes);
  let parent: Branch | undefined;
  const before: Change[] = [];
  for (const branch of chain) {
    const next =
      fresh.get(branch.id) ??
      (parent && rebuildNested(inputs, savedFixes.get(parent.id) ?? [], parent, before, branch.id));
    if (!next || canonical({ ...next, status: branch.status }) !== canonical(branch)) stale();
    if (parent) before.push(...parent.changes);
    parent = next;
  }
  if (!parent) return stale();
  const ranked = computation.candidates.get(parent.id);
  const scored = ranked?.find((c) => c.fix.id === candidate.fix.id);
  if (ranked) {
    if (
      !scored ||
      canonical([scored.fix, scored.gain]) !== canonical([candidate.fix, candidate.gain])
    )
      stale();
  } else if (!scoreSaved(inputs, parent, before, candidate)) stale();
  const stored = load.storedRisks as { id: string }[];
  if (canonical(byRiskId(stored)) !== canonical(byRiskId(computation.risks))) stale();
}

/** The one saved candidate under `parent` whose engine branch ID is `branchId`, rebuilt. */
function rebuildNested(
  inputs: Inputs,
  saved: RawFix[],
  parent: Branch,
  before: Change[],
  branchId: string,
) {
  const matches = saved
    .map((row) => ({ fix: parse(FixCandidateSchema, row.data), gain: parse(Cents, row.gain) }))
    .filter((c) => `${parent.id}__${c.fix.id}` === branchId);
  if (matches.length > 1) reject("INVALID_DATA", `Future ${branchId} has two saved candidates`);
  const [match] = matches;
  if (!match || !appliesTo(match.fix, parent.riskIds ?? [])) return undefined;
  return scoreSaved(inputs, parent, before, match);
}

/**
 * Engine branch for a saved candidate under a nested parent (`before` = the parent's
 * ancestors' changes, root first), only if the engine still ranks it with the saved gain.
 */
function scoreSaved(
  { snapshot, model, constraints }: Inputs,
  parent: Branch,
  before: Change[],
  { fix, gain }: { fix: FixCandidate; gain: number },
) {
  const context = parent.parentId === null ? undefined : { ancestorChanges: before };
  const branch = runEngine("scoreFix", () =>
    engine.scoreFix(parent, fix, snapshot, model, constraints, context),
  );
  const [ranked] = runEngine("rankFixes", () =>
    rankFixes(parent, [{ fix, branch }], snapshot, model, constraints, context),
  );
  return ranked?.gain === gain ? parse(BranchSchema, branch) : undefined;
}

const byRiskId = (risks: { id: string }[]) =>
  [...risks].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
