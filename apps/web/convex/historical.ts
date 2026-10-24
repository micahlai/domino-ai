import {
  type HistoricalCase,
  HistoricalCaseSchema,
  type HistoricalRun,
  HistoricalRunContextSchema,
  HistoricalRunSchema,
} from "@domino/contracts";
import {
  QUARTER_BRIDGE_METHOD,
  type QuarterBridgeInput,
  compareRun,
  quarterAlternative,
  quarterBridge,
} from "@domino/engine";
import { ConvexError, v } from "convex/values";
import caseJson from "../../../data/historical/2u/case.json";
import protocol from "../../../data/historical/2u/protocol.json";
import { canonicalJson, hashInput } from "../../../packages/agents/src/hash";
import type { Doc } from "./_generated/dataModel";
import { type MutationCtx, type QueryCtx, mutation, query } from "./_generated/server";

/**
 * Curated 2U cash-only case. The full case (including later disclosures) stays in this
 * server module; every payload goes through visibleCase() so later evidence leaves only
 * after an explicit reveal. Inputs, method and decision are server-owned: clients send
 * only IDs, never predictions, hashes or case data.
 */
const CASE: HistoricalCase = HistoricalCaseSchema.parse(caseJson);
const CUTOFF = protocol.knowledgeCutoff;
const DECISION = "A1";
// The bridge applies restricted-cash-held-flat by method but lists only F02; record the assumption.
const METHOD_ASSUMPTIONS = ["AS-RESTRICTED"];
const ROLES = {
  knowledgeCutoff: CUTOFF,
  originBalanceDate: protocol.originBalanceDate,
  usableCashFactId: "F01",
  totalCashFactId: "F03",
  operatingYtdFactId: "F05",
  investingYtdFactId: "F06",
  financingAssumptionId: "AS-FIN0",
  fxAssumptionId: "AS-FX0",
} satisfies Omit<QuarterBridgeInput, "case">;
const PROJECTION_ASSUMPTIONS = [
  "Uniform daily flow across the quarter",
  "Financing and exchange-rate effect are zero (AS-FIN0, AS-FX0)",
  "Restricted cash held flat (AS-RESTRICTED), so cash outside it is modeled",
];
const RISK_RULES_NOTE = "No verified threshold, so no risk rule is applied. Risk is unknown.";

const at = (ts: string) => Date.parse(ts);
/** The next publication after the cutoff. Server-owned so the client never names it. */
const REVEAL_THROUGH = CASE.sources
  .map((s) => s.publishedAt)
  .filter((p) => at(p) > at(CUTOFF))
  .sort((a, b) => at(a) - at(b))[0];

function fail(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

/** Sources, facts and assumptions available by `through`. Hindsight assumptions never show. */
function visibleCase(through: string): HistoricalCase {
  const facts = CASE.facts.filter((f) => at(f.availableAt) <= at(through));
  const factIds = new Set(facts.map((f) => f.id));
  return HistoricalCaseSchema.parse({
    ...CASE,
    sources: CASE.sources.filter((s) => at(s.publishedAt) <= at(through)),
    facts,
    assumptions: CASE.assumptions.filter(
      (a) => a.label !== "hindsight" && a.basisFactIds.every((id) => factIds.has(id)),
    ),
  });
}

const inCaseOrder = (ids: string[]) =>
  CASE.assumptions.map((a) => a.id).filter((id) => ids.includes(id));

/** Frozen copy of everything the run read. Its hash is the run's inputHash. */
function snapshotOf(inputs: HistoricalRun["inputs"]) {
  const pick = <T extends { id: string }>(items: T[], ids: string[]) =>
    items.filter((item) => ids.includes(item.id));
  return {
    caseId: CASE.id,
    currency: CASE.currency,
    method: { ...QUARTER_BRIDGE_METHOD },
    roles: ROLES,
    sources: pick(CASE.sources, inputs.sourceIds),
    facts: pick(CASE.facts, inputs.factIds),
    assumptions: pick(CASE.assumptions, inputs.assumptionIds),
  };
}
type Snapshot = ReturnType<typeof snapshotOf>;

function requireRequestId(requestId: string) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestId))
    fail("INVALID_REQUEST", "requestId must be 8-64 letters, digits, _ or -");
}

function requireCase(caseId: string) {
  if (caseId !== CASE.id) fail("NOT_FOUND", "Unknown case");
}

const rowHash = (row: Pick<Doc<"historicalRuns">, "run" | "snapshot" | "summary">) =>
  hashInput({ run: row.run, snapshot: row.snapshot, summary: row.summary });

/** Load a run, re-check its integrity and that the case it was built from has not drifted. */
async function loadRun(ctx: QueryCtx, runId: string) {
  const row = await ctx.db
    .query("historicalRuns")
    .withIndex("by_runId", (q) => q.eq("runId", runId))
    .unique();
  if (!row) fail("NOT_FOUND", "Unknown run");
  const run = HistoricalRunSchema.parse(row.run);
  const snapshot = row.snapshot as Snapshot;
  if (
    (await rowHash(row)) !== row.rowHash ||
    (await hashInput(snapshot)) !== run.inputHash ||
    run.id !== row.runId ||
    run.caseId !== CASE.id
  )
    fail("INTEGRITY", "Stored run failed its integrity check");
  const current = snapshotOf(run.inputs);
  if (canonicalJson(current) !== canonicalJson(snapshot))
    fail("CASE_CHANGED", "The case changed since this run was saved; save a new run");
  return { row, run };
}

async function insertRun(
  ctx: MutationCtx,
  fields: Omit<Doc<"historicalRuns">, "_id" | "_creationTime" | "rowHash">,
) {
  await ctx.db.insert("historicalRuns", { ...fields, rowHash: await rowHash(fields) });
}

async function priorRun(ctx: QueryCtx, requestId: string) {
  return ctx.db
    .query("historicalRuns")
    .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
    .unique();
}

async function newRun(
  kind: "baseline" | "alternative",
  requestId: string,
  inputs: HistoricalRun["inputs"],
  rest: Pick<HistoricalRun, "predictions" | "branch">,
) {
  const snapshot = snapshotOf(inputs);
  const run = HistoricalRunSchema.parse({
    id: `${kind}-${(await hashInput({ kind, requestId })).slice(0, 16)}`,
    caseId: CASE.id,
    createdAt: new Date().toISOString(),
    knowledgeCutoff: CUTOFF,
    originBalanceDate: protocol.originBalanceDate,
    inputs,
    inputHash: await hashInput(snapshot),
    method: { ...QUARTER_BRIDGE_METHOD },
    riskRules: [],
    ...rest,
  });
  return { run, snapshot };
}

/** Case as known at the cutoff, or through a run's reveal. */
export const getCase = query({
  args: { caseId: v.string(), runId: v.optional(v.string()) },
  handler: async (ctx, { caseId, runId }) => {
    requireCase(caseId);
    let through = CUTOFF;
    if (runId) {
      await loadRun(ctx, runId);
      const reveal = await revealFor(ctx, runId);
      if (reveal) through = reveal.revealedThrough;
    }
    return {
      case: visibleCase(through),
      knowledgeCutoff: CUTOFF,
      originBalanceDate: protocol.originBalanceDate,
      visibleThrough: through,
      revealed: through !== CUTOFF,
      disclosure: protocol.disclosure,
      method: { ...QUARTER_BRIDGE_METHOD },
      projectionAssumptions: PROJECTION_ASSUMPTIONS,
      riskRules: [],
      riskRulesNote: RISK_RULES_NOTE,
    };
  },
});

/** Server computes and saves the baseline from the cutoff view. Idempotent on requestId. */
export const saveBaseline = mutation({
  args: { requestId: v.string(), caseId: v.string() },
  handler: async (ctx, { requestId, caseId }) => {
    requireRequestId(requestId);
    requireCase(caseId);
    const prior = await priorRun(ctx, requestId);
    if (prior) {
      if (prior.kind !== "baseline" || prior.caseId !== caseId)
        fail("CONFLICT", "requestId already used for a different request");
      return (await loadRun(ctx, prior.runId)).row.summary;
    }
    const known = visibleCase(CUTOFF);
    const bridge = quarterBridge({ ...ROLES, case: known });
    const inputs = {
      ...bridge.inputs,
      assumptionIds: inCaseOrder([...bridge.inputs.assumptionIds, ...METHOD_ASSUMPTIONS]),
    };
    const { run, snapshot } = await newRun("baseline", requestId, inputs, {
      predictions: [...bridge.nowcast, ...bridge.forecast],
      branch: { kind: "baseline" },
    });
    HistoricalRunContextSchema.parse({ case: known, run });
    const summary = { runId: run.id, run, riskRulesNote: RISK_RULES_NOTE };
    await insertRun(ctx, {
      runId: run.id,
      requestId,
      caseId,
      kind: "baseline",
      run,
      snapshot,
      summary,
    });
    return summary;
  },
});

/** Server computes the cost-only A1 alternative against a saved baseline. Idempotent on requestId. */
export const computeAlternative = mutation({
  args: { requestId: v.string(), baselineRunId: v.string() },
  handler: async (ctx, { requestId, baselineRunId }) => {
    requireRequestId(requestId);
    const prior = await priorRun(ctx, requestId);
    if (prior) {
      if (prior.kind !== "alternative" || prior.baselineRunId !== baselineRunId)
        fail("CONFLICT", "requestId already used for a different request");
      return (await loadRun(ctx, prior.runId)).row.summary;
    }
    const { run: baseline } = await loadRun(ctx, baselineRunId);
    if (baseline.branch.kind !== "baseline")
      fail("INVALID_BRANCH", "An alternative must start from a baseline run");
    const known = visibleCase(CUTOFF);
    const alt = quarterAlternative({ ...ROLES, case: known }, DECISION);
    const inputs = {
      ...alt.inputs,
      assumptionIds: inCaseOrder([...alt.inputs.assumptionIds, ...METHOD_ASSUMPTIONS]),
    };
    const { run, snapshot } = await newRun("alternative", requestId, inputs, {
      predictions: [...alt.nowcast, ...alt.forecast],
      branch: {
        kind: "alternative",
        baselineRunId,
        decisionAssumptionIds: [DECISION],
        // Authors knew the outcome when choosing A1, so the protocol label wins.
        postHoc: alt.postHoc || protocol.response.postHoc,
      },
    });
    HistoricalRunContextSchema.parse({ case: known, run, baseline });
    const summary = {
      runId: run.id,
      run,
      // Alternative minus saved baseline at the target. Not scored against disclosures.
      costRelativeToBaseline: alt.effectCents,
      benefit: { start: alt.benefitStart, daysInWindow: alt.benefitDays, afterTarget: "unknown" },
      postHoc: run.branch.kind === "alternative" && run.branch.postHoc,
      postHocReason: protocol.response.postHocReason,
      caveats: [protocol.response.unmodeledNote, protocol.response.pointNote],
    };
    await insertRun(ctx, {
      runId: run.id,
      requestId,
      caseId: CASE.id,
      kind: "alternative",
      baselineRunId,
      run,
      snapshot,
      summary,
    });
    return summary;
  },
});

async function revealFor(ctx: QueryCtx, runId: string) {
  return ctx.db
    .query("historicalReveals")
    .withIndex("by_runId", (q) => q.eq("runId", runId))
    .unique();
}

const revealView = (r: Doc<"historicalReveals">) => ({
  runId: r.runId,
  revealedThrough: r.revealedThrough,
  revealedAt: r.revealedAt,
  comparisons: r.comparisons,
});

/** Reveal the next publication for a baseline and store actual-minus-forecast once. */
export const reveal = mutation({
  args: { requestId: v.string(), runId: v.string() },
  handler: async (ctx, { requestId, runId }) => {
    requireRequestId(requestId);
    const prior = await ctx.db
      .query("historicalReveals")
      .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
      .unique();
    if (prior) {
      if (prior.runId !== runId) fail("CONFLICT", "requestId already used for a different request");
      return revealView(prior);
    }
    const { run } = await loadRun(ctx, runId);
    if (run.branch.kind !== "baseline")
      fail("INVALID_BRANCH", "Only a baseline run is compared with disclosures");
    const existing = await revealFor(ctx, runId);
    if (existing) return revealView(existing);
    if (!REVEAL_THROUGH) fail("NOTHING_TO_REVEAL", "No later publication in this case");
    const comparisons = compareRun(CASE, run, REVEAL_THROUGH);
    const id = await ctx.db.insert("historicalReveals", {
      runId,
      requestId,
      revealedThrough: REVEAL_THROUGH,
      revealedAt: new Date().toISOString(),
      comparisons,
    });
    return revealView((await ctx.db.get(id))!);
  },
});

/** Stored comparisons for a run, or null before reveal. */
export const getReveal = query({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    await loadRun(ctx, runId);
    const r = await revealFor(ctx, runId);
    return r ? revealView(r) : null;
  },
});
