import {
  type ActivityEvent,
  ActivityEventSchema,
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
export const CASE: HistoricalCase = HistoricalCaseSchema.parse(caseJson);
export const CUTOFF = protocol.knowledgeCutoff;
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
/** The next publication after a run's cutoff. Server-owned so the client never names it. */
const revealThrough = (cutoff: string) =>
  CASE.sources
    .map((s) => s.publishedAt)
    .filter((p) => at(p) > at(cutoff))
    .sort((a, b) => at(a) - at(b))[0];

export function fail(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

/** Sources, facts and assumptions available by `through`. Hindsight assumptions never show. */
export function visibleCase(through: string): HistoricalCase {
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

export function requireRequestId(requestId: string) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestId))
    fail("INVALID_REQUEST", "requestId must be 8-64 letters, digits, _ or -");
}

function requireCase(caseId: string) {
  if (caseId !== CASE.id) fail("NOT_FOUND", "Unknown case");
}

const rowHash = (row: Pick<Doc<"historicalRuns">, "run" | "snapshot" | "summary">) =>
  hashInput({ run: row.run, snapshot: row.snapshot, summary: row.summary });

const ids = (items: { id: string }[]) => items.map((item) => item.id);
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

/**
 * Load a saved run and check it against its own frozen snapshot, never the current CASE:
 * a later case edit must not make a saved run unreadable. Drift only blocks new computations.
 */
export async function loadRun(
  ctx: QueryCtx,
  runId: string,
  caseId?: string,
): Promise<{
  row: Doc<"historicalRuns">;
  run: HistoricalRun;
  snapshot: Snapshot;
  /** The case rebuilt from the frozen snapshot only: the run's own fact base. */
  frozenCase: HistoricalCase;
  baseline: HistoricalRun | undefined;
}> {
  const row = await ctx.db
    .query("historicalRuns")
    .withIndex("by_runId", (q) => q.eq("runId", runId))
    .unique();
  if (!row || (caseId !== undefined && row.caseId !== caseId)) fail("NOT_FOUND", "Unknown run");
  const run = HistoricalRunSchema.parse(row.run);
  const snapshot = row.snapshot as Snapshot;
  const linked =
    run.id === row.runId &&
    run.caseId === row.caseId &&
    snapshot.caseId === row.caseId &&
    run.branch.kind === row.kind &&
    (run.branch.kind === "alternative" ? run.branch.baselineRunId : undefined) ===
      row.baselineRunId &&
    same(snapshot.method, run.method) &&
    snapshot.roles.knowledgeCutoff === run.knowledgeCutoff &&
    snapshot.roles.originBalanceDate === run.originBalanceDate &&
    same(ids(snapshot.sources), run.inputs.sourceIds) &&
    same(ids(snapshot.facts), run.inputs.factIds) &&
    same(ids(snapshot.assumptions), run.inputs.assumptionIds) &&
    same((row.summary as { run: unknown }).run, run);
  if (
    !linked ||
    (await rowHash(row)) !== row.rowHash ||
    (await hashInput(snapshot)) !== run.inputHash
  )
    fail("INTEGRITY", "Stored run failed its integrity check");
  const baseline: HistoricalRun | undefined =
    run.branch.kind === "alternative"
      ? (await loadRun(ctx, run.branch.baselineRunId)).run
      : undefined;
  // The frozen inputs alone must still form a valid run context (cutoff, closure, origin).
  const frozenCase = {
    ...CASE,
    id: snapshot.caseId,
    currency: snapshot.currency,
    sources: snapshot.sources,
    facts: snapshot.facts,
    assumptions: snapshot.assumptions,
  };
  if (!HistoricalRunContextSchema.safeParse({ case: frozenCase, run, baseline }).success)
    fail("INTEGRITY", "Stored run failed its integrity check");
  return { row, run, snapshot, frozenCase, baseline };
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

/** Case as known at the cutoff, or the evidence view frozen at a run's reveal. */
export const getCase = query({
  args: { caseId: v.string(), runId: v.optional(v.string()) },
  handler: async (ctx, { caseId, runId }) => {
    requireCase(caseId);
    // A saved run's own cutoff, origin and method; today's protocol only without a run.
    let saved: Pick<HistoricalRun, "knowledgeCutoff" | "originBalanceDate" | "method"> = {
      knowledgeCutoff: CUTOFF,
      originBalanceDate: protocol.originBalanceDate,
      method: { ...QUARTER_BRIDGE_METHOD },
    };
    let reveal: Doc<"historicalReveals"> | null = null;
    if (runId) {
      const { run } = await loadRun(ctx, runId, caseId);
      saved = run;
      reveal = await loadReveal(ctx, run);
    }
    const cutoff = saved.knowledgeCutoff;
    const through = reveal?.revealedThrough ?? cutoff;
    return {
      // Available evidence: after reveal, the view frozen with the comparisons, never a
      // re-filter of today's CASE. A saved forecast's own inputs are getRun().inputSnapshot.
      case: reveal ? (reveal.view as HistoricalCase) : visibleCase(cutoff),
      knowledgeCutoff: cutoff,
      originBalanceDate: saved.originBalanceDate,
      visibleThrough: through,
      revealed: reveal !== null,
      disclosure: protocol.disclosure,
      method: saved.method,
      projectionAssumptions: PROJECTION_ASSUMPTIONS,
      riskRules: [],
      riskRulesNote: RISK_RULES_NOTE,
    };
  },
});

/**
 * Stored summary of a saved run plus the exact frozen inputs it was computed from (the
 * hashed snapshot behind run.inputHash). Evidence for a saved forecast comes from
 * inputSnapshot, never from the current case. Read-only.
 */
export const getRun = query({
  args: { caseId: v.string(), runId: v.string() },
  handler: async (ctx, { caseId, runId }) => {
    const { row, snapshot } = await loadRun(ctx, runId, caseId);
    return { ...row.summary, inputSnapshot: snapshot };
  },
});

/** Server computes and saves the baseline from the cutoff view. Idempotent on requestId. */
export const saveBaseline = mutation({
  args: { requestId: v.string(), caseId: v.string() },
  handler: (ctx, { requestId, caseId }) => saveBaselineIn(ctx, requestId, caseId),
});

/** saveBaseline's body, shared with server-owned investigation operations. */
export async function saveBaselineIn(ctx: MutationCtx, requestId: string, caseId: string) {
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
  await emit(ctx, run.id, {
    id: `evt-saved-${run.id}`,
    occurredAt: run.createdAt,
    runId: run.id,
    kind: "run_saved",
    entity: { kind: "run", id: run.id },
    label: "Baseline forecast saved",
    evidenceIds: run.inputs.sourceIds,
    outputId: run.id,
  });
  return summary;
}

/** Server computes the cost-only A1 alternative against a saved baseline. Idempotent on requestId. */
export const computeAlternative = mutation({
  args: { requestId: v.string(), baselineRunId: v.string() },
  handler: (ctx, { requestId, baselineRunId }) =>
    computeAlternativeIn(ctx, requestId, baselineRunId),
});

/** computeAlternative's body, shared with server-owned investigation operations. */
export async function computeAlternativeIn(
  ctx: MutationCtx,
  requestId: string,
  baselineRunId: string,
) {
  requireRequestId(requestId);
  const prior = await priorRun(ctx, requestId);
  if (prior) {
    if (prior.kind !== "alternative" || prior.baselineRunId !== baselineRunId)
      fail("CONFLICT", "requestId already used for a different request");
    return (await loadRun(ctx, prior.runId)).row.summary;
  }
  const { run: baseline, snapshot: frozen } = await loadRun(ctx, baselineRunId);
  if (baseline.branch.kind !== "baseline")
    fail("INVALID_BRANCH", "An alternative must start from a baseline run");
  // A new alternative is computed from the current cutoff view, so it needs the baseline's
  // frozen inputs and method to still match. Old runs stay readable; only this call refuses.
  if (!same(snapshotOf(baseline.inputs), frozen) || baseline.knowledgeCutoff !== CUTOFF)
    fail("CASE_CHANGED", "The case changed since this baseline was saved; save a new baseline");
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
  // Alternative inputs are cutoff-only (HistoricalRunContextSchema above), so safe pre-reveal.
  await emit(ctx, baselineRunId, {
    id: `evt-alt-${run.id}`,
    occurredAt: run.createdAt,
    runId: run.id,
    kind: "alternative_computed",
    entity: { kind: "run", id: run.id },
    label: "Alternative computed",
    evidenceIds: run.inputs.sourceIds,
    outputId: run.id,
  });
  return summary;
}

type NewEvent = Omit<ActivityEvent, "sequence" | "caseId" | "status">;

/**
 * Append one success event to a baseline's feed inside the mutation that commits the outcome,
 * so a rollback drops it too. Callers emit only on the first-write path; retries return before
 * it, so one outcome has one event. Reading the feed's last row makes concurrent writers to the
 * same feed conflict and retry, so a sequence is never shared.
 */
async function emit(ctx: MutationCtx, baselineRunId: string, e: NewEvent) {
  const last = await ctx.db
    .query("historicalActivity")
    .withIndex("by_feed", (q) => q.eq("baselineRunId", baselineRunId))
    .order("desc")
    .first();
  const sequence = (last?.sequence ?? 0) + 1;
  const event = ActivityEventSchema.parse({ ...e, sequence, caseId: CASE.id, status: "succeeded" });
  await ctx.db.insert("historicalActivity", { baselineRunId, sequence, event });
}

const ACTIVITY_LIMIT = 50;

/**
 * A baseline's feed: its save, its alternatives and its own reveal, oldest first, the latest
 * ACTIVITY_LIMIT events. Read-only; never writes an event.
 */
export const getActivity = query({
  args: { caseId: v.string(), baselineRunId: v.string() },
  handler: async (ctx, { caseId, baselineRunId }) => {
    requireCase(caseId);
    const { run } = await loadRun(ctx, baselineRunId, caseId);
    if (run.branch.kind !== "baseline")
      fail("INVALID_BRANCH", "Activity is listed per baseline run");
    // ponytail: latest 50 only, add afterSequence paging if a feed ever outgrows it.
    const rows = await ctx.db
      .query("historicalActivity")
      .withIndex("by_feed", (q) => q.eq("baselineRunId", baselineRunId))
      .order("desc")
      .take(ACTIVITY_LIMIT);
    return rows.reverse().map((r) => {
      const e = ActivityEventSchema.parse(r.event);
      if (e.caseId !== caseId || e.sequence !== r.sequence)
        fail("INTEGRITY", "Stored activity failed its integrity check");
      return e;
    });
  },
});

async function revealFor(ctx: QueryCtx, runId: string) {
  return ctx.db
    .query("historicalReveals")
    .withIndex("by_runId", (q) => q.eq("runId", runId))
    .unique();
}

type RevealFields = Pick<
  Doc<"historicalReveals">,
  "runId" | "revealedThrough" | "revealedAt" | "comparisons" | "view"
>;
const revealHash = (r: RevealFields) =>
  hashInput({
    runId: r.runId,
    revealedThrough: r.revealedThrough,
    revealedAt: r.revealedAt,
    comparisons: r.comparisons,
    view: r.view,
  });

/** Reveal record for a run, checked against its hash and the run it belongs to. */
async function loadReveal(ctx: QueryCtx, run: HistoricalRun) {
  const r = await revealFor(ctx, run.id);
  if (!r) return null;
  const comparisons = r.comparisons as { runId: string }[];
  const view = r.view as HistoricalCase | undefined;
  // Rows saved before the evidence view was frozen have no hash and fail closed.
  if (
    !r.revealHash ||
    (await revealHash(r)) !== r.revealHash ||
    view?.id !== run.caseId ||
    comparisons.length !== run.predictions.length ||
    comparisons.some((c) => c.runId !== run.id)
  )
    fail("INTEGRITY", "Stored reveal failed its integrity check");
  return r;
}

const revealView = (r: Doc<"historicalReveals">) => ({
  runId: r.runId,
  revealedThrough: r.revealedThrough,
  revealedAt: r.revealedAt,
  comparisons: r.comparisons,
});

/** Receipt for a reveal requestId, binding it to its original runId. */
async function revealReceipt(ctx: QueryCtx, requestId: string) {
  return ctx.db
    .query("historicalRevealReceipts")
    .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
    .unique();
}

/**
 * Reveal the next publication for a baseline and freeze actual-minus-forecast plus the
 * evidence view once per run. Every accepted requestId gets a receipt bound to its runId.
 */
export const reveal = mutation({
  args: { requestId: v.string(), runId: v.string() },
  handler: (ctx, { requestId, runId }) => revealIn(ctx, requestId, runId),
});

/** reveal's body, shared with the explicit investigation reveal. */
export async function revealIn(ctx: MutationCtx, requestId: string, runId: string) {
  requireRequestId(requestId);
  // Pre-receipt rows recorded only the first requestId on the reveal itself.
  const bound =
    (await revealReceipt(ctx, requestId)) ??
    (await ctx.db
      .query("historicalReveals")
      .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
      .unique());
  if (bound && bound.runId !== runId)
    fail("CONFLICT", "requestId already used for a different request");
  const { run } = await loadRun(ctx, runId);
  if (run.branch.kind !== "baseline")
    fail("INVALID_BRANCH", "Only a baseline run is compared with disclosures");
  const existing = await loadReveal(ctx, run);
  if (!bound) await ctx.db.insert("historicalRevealReceipts", { requestId, runId });
  if (existing) return revealView(existing);
  const through = revealThrough(run.knowledgeCutoff);
  if (!through) fail("NOTHING_TO_REVEAL", "No later publication in this case");
  // Saved predictions against the observations published by `through`; the run is not recomputed.
  const fields = {
    runId,
    revealedThrough: through,
    revealedAt: new Date().toISOString(),
    comparisons: compareRun(CASE, run, through),
    view: visibleCase(through),
  };
  const id = await ctx.db.insert("historicalReveals", {
    ...fields,
    requestId,
    revealHash: await revealHash(fields),
  });
  // Only this baseline's feed gets the newly visible sources; other baselines never see them.
  const before = new Set(visibleCase(run.knowledgeCutoff).sources.map((s) => s.id));
  await emit(ctx, runId, {
    id: `evt-reveal-${runId}`,
    occurredAt: fields.revealedAt,
    runId,
    kind: "disclosure_revealed",
    entity: { kind: "comparison", id: runId },
    label: "Next disclosure revealed",
    evidenceIds: fields.view.sources.map((s) => s.id).filter((s) => !before.has(s)),
  });
  return revealView((await ctx.db.get(id))!);
}

/** Stored comparisons for a run, or null before reveal. */
export const getReveal = query({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    const { run } = await loadRun(ctx, runId);
    const r = await loadReveal(ctx, run);
    return r ? revealView(r) : null;
  },
});
