import {
  type Change,
  type Constraint,
  type Domino,
  DominoSchema,
  type Forecast,
  ForecastSchema,
  type OperationSummaryV1,
  OperationSummaryV1Schema,
  type WeeklyResultRefV1,
  canonicalJson,
  parseWeeklyResultRefJson,
} from "@domino/contracts";
import { engine } from "@domino/engine";
import { makeFunctionReference, paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { z } from "zod";
import type { Doc } from "../_generated/dataModel";
import { type MutationCtx, type QueryCtx, mutation, query } from "../_generated/server";
import type { SavedBaseline } from "./baselines";
import { baselineRefs } from "./refs";
import { scenarioStart, startsBefore } from "./scenarioStart";
import {
  ChangesSchema,
  ConstraintsSchema,
  MAX_DEPTH,
  MAX_LABEL,
  MAX_NOTE,
  MAX_TOTAL_CHANGES,
  addDays,
  checkChanges,
  checkConstraints,
  checkEffects,
  checkMoneyBound,
  checkRequestId,
  checkRowSize,
  parseExactJson,
  reject,
  requiredText,
  sha256Hex,
} from "./workspaceInput";
import { type RuleReceipt, RuleReceiptSchema, ruleReceipts } from "./workspaceRules";

// TL1C/TL2/TL4 Timeline workspace: immutable saved runs on top of one TL1 baseline.
// Interface: kb/features/timeline/TL2-TL5-interface.md. A run is never rewritten: editing
// rules or adding an event saves a child run, and every child freezes its complete rules,
// complete ordered changes and engine outputs. The seed lives once, on the baseline row.

/** Frozen calculation method. Bump when the engine call sequence or stored outputs change. */
export const WORKSPACE_METHOD_VERSION = "timeline_workspace@1.0.0";
const MAX_CATALOG_PAGE = 100;
const MAX_GRAPH = 100;

type Kind = "baseline" | "rules" | "scenario";
type Comparison = {
  parentRunId: string;
  weekly: { weekStart: string; usableDelta: number }[];
  lowPointDelta: number;
};
export type WorkspaceRun = {
  runId: string;
  companyId: string;
  baselineRunId: string;
  parentRunId: string | null;
  kind: Kind;
  label: string;
  savedAt: string;
  inputHash: string;
  methodVersion: string;
  constraintVersion: string;
  constraintNote: string;
  constraints: Constraint[];
  ownChanges: Change[];
  changes: Change[];
  forecast: Forecast;
  dominoes: Domino[];
  receipts: RuleReceipt[];
  comparison: Comparison | null;
  baseline: SavedBaseline;
  operation: OperationSummaryV1;
};
export type CatalogEntry = {
  runId: string;
  companyId: string;
  baselineRunId: string;
  parentRunId: string | null;
  kind: Kind;
  label: string;
  savedAt: string;
  lowPointCents: number;
  lowPointWeek: string;
  constraintVersion: string;
  /** First date this run's own changes move cash; null when it changes no events. */
  startsOn: string | null;
};
export type WorkspaceResult = { companyId: string; runId: string; created: boolean };

const hash40 = async (parts: unknown[]) => (await sha256Hex(canonicalJson(parts))).slice(0, 40);
const rootRunId = async (companyId: string, baselineRunId: string) =>
  `timeline:workspace/${await hash40(["root", companyId, baselineRunId])}`;
const childRunId = async (companyId: string, requestId: string) =>
  `timeline:workspace/${await hash40(["run", companyId, requestId])}`;

/** Content version of a rule set (and of one rule): equal rules share a version. */
const rulesVersion = async (rules: Constraint[]) =>
  `rules/${(await sha256Hex(canonicalJson(rules))).slice(0, 16)}`;
async function ruleVersions(rules: Constraint[]) {
  const versions = new Map<string, string>();
  for (const c of rules)
    versions.set(c.id, `rule/${(await sha256Hex(canonicalJson(c))).slice(0, 16)}`);
  return (c: Constraint) => versions.get(c.id) ?? "";
}

async function loadBaseline(
  ctx: QueryCtx | MutationCtx,
  companyId: string,
  baselineRunId: string,
): Promise<SavedBaseline | null> {
  const baseline = await ctx.runQuery(baselineRefs.get, { companyId, runId: baselineRunId });
  if (baseline && (baseline.companyId !== companyId || baseline.runId !== baselineRunId))
    reject("INTEGRITY", "Saved baseline is for another company or run");
  return baseline;
}

const runRow = (ctx: QueryCtx | MutationCtx, companyId: string, runId: string) =>
  ctx.db
    .query("timelineRuns")
    .withIndex("by_company_and_runId", (q) => q.eq("companyId", companyId).eq("runId", runId))
    .unique();

/**
 * Same request: return the saved run. Same id, different inputs or operation: reject. Else null.
 * Every accepted request has a receipt, including an `open` that reused an existing root, so
 * no accepted key can later be spent on something else.
 */
async function priorRequest(
  ctx: MutationCtx,
  companyId: string,
  requestId: string,
  inputHash: string,
): Promise<WorkspaceResult | null> {
  const prior = await ctx.db
    .query("timelineRunRequests")
    .withIndex("by_company_and_requestId", (q) =>
      q.eq("companyId", companyId).eq("requestId", requestId),
    )
    .unique();
  // Runs saved before the receipt table was introduced retain their original binding.
  if (!prior) {
    const legacy = await ctx.db
      .query("timelineRuns")
      .withIndex("by_company_and_requestId", (q) =>
        q.eq("companyId", companyId).eq("requestId", requestId),
      )
      .unique();
    if (!legacy) return null;
    if (legacy.inputHash !== inputHash)
      reject("REQUEST_CONFLICT", "This requestId was already used with different inputs");
    await bindRequest(ctx, { companyId, requestId, inputHash, runId: legacy.runId });
    return { companyId, runId: legacy.runId, created: false };
  }
  if (prior.inputHash !== inputHash)
    reject("REQUEST_CONFLICT", "This requestId was already used with different inputs");
  return { companyId, runId: prior.runId, created: false };
}

/** Bind an accepted request to its run, in the same transaction as any run it created. */
const bindRequest = (
  ctx: MutationCtx,
  args: { companyId: string; requestId: string; inputHash: string; runId: string },
) => ctx.db.insert("timelineRunRequests", { ...args, acceptedAt: new Date().toISOString() });

const horizonOf = (baseline: SavedBaseline) => {
  const weeks = baseline.forecast.weeks;
  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  if (!first || !last) reject("INTEGRITY", "Saved baseline has no forecast weeks");
  return {
    asOf: baseline.seed.snapshot.asOf,
    firstWeek: first.weekStart,
    end: addDays(last.weekStart, 6),
  };
};

function exactDelta(a: number, b: number) {
  const d = a - b;
  if (!Number.isSafeInteger(d))
    reject("UNSAFE_MONEY", "A difference is too large to state exactly");
  return d;
}

function compare(parentRunId: string, forecast: Forecast, parent: Forecast): Comparison {
  return {
    parentRunId,
    weekly: forecast.weeks.map((w, i) => {
      const p = parent.weeks[i];
      if (!p || p.weekStart !== w.weekStart) reject("INTEGRITY", "Forecast weeks do not line up");
      return { weekStart: w.weekStart, usableDelta: exactDelta(w.usable, p.usable) };
    }),
    lowPointDelta: exactDelta(forecast.lowPoint.usable, parent.lowPoint.usable),
  };
}

function operationFor(args: {
  runId: string;
  title: string;
  evidence: string[];
  at: string;
}): OperationSummaryV1 {
  const parsed = OperationSummaryV1Schema.safeParse({
    schemaVersion: 1,
    id: args.runId.replace(/^timeline:workspace\//, "timeline:operation/"),
    ownerDomain: "timeline",
    status: "succeeded",
    title: args.title.slice(0, 200),
    dependencies: [],
    evidenceRefs: [...new Set(args.evidence)].map((id) => ({ kind: "domain", id })),
    outputRefs: [args.runId],
    createdAt: args.at,
    startedAt: args.at,
    finishedAt: args.at,
    updatedAt: args.at,
  });
  if (!parsed.success) reject("INTEGRITY", "Operation summary failed its contract check");
  return parsed.data;
}

/** Run the engine; a refusal becomes a clear rejection, never a partial save. */
function calculate<T>(what: string, run: () => T): T {
  try {
    return run();
  } catch (e) {
    const detail = e instanceof Error ? `: ${e.message}` : "";
    return reject("UNSUPPORTED_INPUT", `The engine could not ${what}${detail}`.slice(0, 500));
  }
}

type ParentNode = {
  runId: string;
  depth: number;
  constraints: Constraint[];
  constraintNote: string;
  changes: Change[];
  forecast: Forecast;
};

function parentNode(row: Doc<"timelineRuns">): ParentNode {
  const constraints = ConstraintsSchema.safeParse(row.constraints);
  const changes = ChangesSchema.safeParse(row.changes);
  const forecast = ForecastSchema.safeParse(row.forecast);
  if (!constraints.success || !changes.success || !forecast.success)
    reject("INTEGRITY", "Saved run failed its integrity check");
  return {
    runId: row.runId,
    depth: row.depth,
    constraints: constraints.data,
    constraintNote: row.constraintNote,
    changes: changes.data,
    forecast: forecast.data,
  };
}

/**
 * Validate, calculate and freeze one child run of `parent`. The complete change list is the
 * parent's complete list plus this run's own changes, applied once to the original snapshot.
 */
async function saveChild(
  ctx: MutationCtx,
  args: {
    companyId: string;
    requestId: string;
    inputHash: string;
    kind: "rules" | "scenario";
    label: string;
    baseline: SavedBaseline;
    parent: ParentNode;
    constraints: Constraint[];
    constraintNote: string;
    ownChanges: Change[];
  },
): Promise<WorkspaceResult> {
  const { baseline, parent, constraints, ownChanges } = args;
  const snapshot = baseline.seed.snapshot;
  const model = baseline.model;
  const depth = parent.depth + 1;
  if (depth > MAX_DEPTH)
    reject(
      "TOO_DEEP",
      `A plan can build on at most ${MAX_DEPTH} earlier steps; start from an earlier one`,
    );
  const changes = [...parent.changes, ...ownChanges];
  if (changes.length > MAX_TOTAL_CHANGES)
    reject("TOO_MANY_CHANGES", `A plan can hold at most ${MAX_TOTAL_CHANGES} changes in total`);
  const horizon = horizonOf(baseline);
  checkConstraints(constraints, snapshot);
  checkChanges(changes, snapshot, horizon);
  checkMoneyBound(snapshot, model, constraints, changes);
  checkEffects(changes, snapshot, model, horizon);

  const forecast = ForecastSchema.parse(
    calculate("forecast this plan", () => engine.forecast(snapshot, model, changes)),
  );
  // Rule-only edits leave cash unchanged, so no counterfactual (and no causal claim) is given.
  const context =
    args.kind === "scenario" ? { model, changes, baseline: parent.forecast } : { model, changes };
  const dominoes = z
    .array(DominoSchema)
    .parse(
      calculate("check the rules", () => engine.dominoes(forecast, constraints, snapshot, context)),
    );
  const receipts = ruleReceipts({
    snapshot,
    model,
    rules: constraints,
    versionOf: await ruleVersions(constraints),
    plan: { forecast, changes },
    parent: { forecast: parent.forecast, changes: parent.changes },
    ownChanges: args.kind === "scenario" ? ownChanges : [],
    horizonEnd: horizon.end,
  });
  const runId = await childRunId(args.companyId, args.requestId);
  const savedAt = new Date().toISOString();
  const row = {
    runId,
    companyId: args.companyId,
    requestId: args.requestId,
    inputHash: args.inputHash,
    baselineRunId: baseline.runId,
    parentRunId: parent.runId,
    kind: args.kind,
    label: args.label,
    depth,
    seedId: baseline.seed.id,
    seedHash: baseline.seedHash,
    methodVersion: WORKSPACE_METHOD_VERSION,
    constraintVersion: await rulesVersion(constraints),
    constraintNote: args.constraintNote,
    constraints,
    ownChanges,
    changes,
    forecast,
    dominoes,
    receipts,
    comparison: compare(parent.runId, forecast, parent.forecast),
    lowPointCents: forecast.lowPoint.usable,
    lowPointWeek: forecast.lowPoint.weekStart,
    operation: operationFor({
      runId,
      title: args.kind === "rules" ? `Rules updated: ${args.label}` : `Scenario: ${args.label}`,
      evidence: [baseline.runId, parent.runId],
      at: savedAt,
    }),
    savedAt,
  };
  checkRowSize(row);
  await ctx.db.insert("timelineRuns", row);
  await bindRequest(ctx, {
    companyId: args.companyId,
    requestId: args.requestId,
    inputHash: args.inputHash,
    runId,
  });
  return { companyId: args.companyId, runId, created: true };
}

async function loadParent(ctx: MutationCtx, companyId: string, parentRunId: string) {
  const row = await runRow(ctx, companyId, parentRunId);
  if (!row) reject("NOT_FOUND", "No saved run with that id for this company");
  const baseline = await loadBaseline(ctx, companyId, row.baselineRunId);
  if (!baseline || baseline.seedHash !== row.seedHash)
    reject("INTEGRITY", "The saved baseline behind this run is missing or changed");
  return { row, node: parentNode(row), baseline };
}

/** Create (or reuse) the immutable workspace root for one saved TL1 baseline. */
export const open = mutation({
  args: { companyId: v.string(), baselineRunId: v.string(), requestId: v.string() },
  handler: async (ctx, args): Promise<WorkspaceResult> => {
    checkRequestId(args.requestId);
    const { companyId, baselineRunId } = args;
    const inputHash = await sha256Hex(
      canonicalJson({ op: "open", baselineRunId, methodVersion: WORKSPACE_METHOD_VERSION }),
    );
    const prior = await priorRequest(ctx, companyId, args.requestId, inputHash);
    if (prior) return prior;
    const runId = await rootRunId(companyId, baselineRunId);
    // One root per baseline, whichever request opened it first; later keys are bound to it.
    if (await runRow(ctx, companyId, runId)) {
      await bindRequest(ctx, { companyId, requestId: args.requestId, inputHash, runId });
      return { companyId, runId, created: false };
    }

    const baseline = await loadBaseline(ctx, companyId, baselineRunId);
    if (!baseline) reject("NOT_FOUND", "No saved baseline with that id for this company");
    const snapshot = baseline.seed.snapshot;
    const constraints = baseline.constraints;
    const horizon = horizonOf(baseline);
    const savedAt = new Date().toISOString();
    const receipts = ruleReceipts({
      snapshot,
      model: baseline.model,
      rules: constraints,
      versionOf: await ruleVersions(constraints),
      plan: { forecast: baseline.forecast, changes: [] },
      parent: null,
      ownChanges: [],
      horizonEnd: horizon.end,
    });
    const row = {
      runId,
      companyId,
      requestId: args.requestId,
      inputHash,
      baselineRunId,
      parentRunId: null,
      kind: "baseline" as const,
      label: `Saved forecast for ${baseline.companyName}`.slice(0, MAX_LABEL),
      depth: 0,
      seedId: baseline.seed.id,
      seedHash: baseline.seedHash,
      methodVersion: WORKSPACE_METHOD_VERSION,
      constraintVersion: await rulesVersion(constraints),
      constraintNote: baseline.assumptionNote,
      constraints,
      ownChanges: [],
      changes: [],
      // The root reuses the baseline's frozen outputs; nothing is recalculated.
      forecast: baseline.forecast,
      dominoes: baseline.dominoes,
      receipts,
      comparison: null,
      lowPointCents: baseline.forecast.lowPoint.usable,
      lowPointWeek: baseline.forecast.lowPoint.weekStart,
      operation: operationFor({
        runId,
        title: "Workspace opened from a saved forecast",
        evidence: [baselineRunId],
        at: savedAt,
      }),
      savedAt,
    };
    checkRowSize(row);
    await ctx.db.insert("timelineRuns", row);
    await bindRequest(ctx, { companyId, requestId: args.requestId, inputHash, runId });
    return { companyId, runId, created: true };
  },
});

/** Replace the rules (full set) as a new run. Older runs keep their own rules and results. */
export const reviseConstraints = mutation({
  args: {
    companyId: v.string(),
    parentRunId: v.string(),
    requestId: v.string(),
    constraintsJson: v.string(),
    note: v.string(),
    reviewed: v.boolean(),
  },
  handler: async (ctx, args): Promise<WorkspaceResult> => {
    checkRequestId(args.requestId);
    if (!args.reviewed) reject("NOT_REVIEWED", "Confirm the rules before saving them");
    const note = requiredText("Rule note", args.note, MAX_NOTE);
    const constraints = parseExactJson("Rules", ConstraintsSchema, args.constraintsJson);
    const inputHash = await sha256Hex(
      canonicalJson({
        op: "reviseConstraints",
        parentRunId: args.parentRunId,
        constraints,
        note,
        methodVersion: WORKSPACE_METHOD_VERSION,
      }),
    );
    const prior = await priorRequest(ctx, args.companyId, args.requestId, inputHash);
    if (prior) return prior;
    const { node, baseline } = await loadParent(ctx, args.companyId, args.parentRunId);
    if (canonicalJson(constraints) === canonicalJson(node.constraints))
      reject("NO_CHANGE", "These rules are the same as the current ones; nothing to save");
    return saveChild(ctx, {
      companyId: args.companyId,
      requestId: args.requestId,
      inputHash,
      kind: "rules",
      label: `Rules: ${note}`.slice(0, MAX_LABEL),
      baseline,
      parent: node,
      constraints,
      constraintNote: note,
      ownChanges: [],
    });
  },
});

// By name, so this module does not import the Field cascade module (and its api types).
const autoCascadeRef = makeFunctionReference<"action", { companyId: string; runId: string }, null>(
  "fieldCascade:auto",
);

/** Simulate confirmed future changes (optionally with confirmed new rules) as one new run. */
export const simulate = mutation({
  args: {
    companyId: v.string(),
    parentRunId: v.string(),
    requestId: v.string(),
    label: v.string(),
    changesJson: v.string(),
    reviewed: v.boolean(),
    constraintsJson: v.optional(v.string()),
    constraintNote: v.optional(v.string()),
    /** Automated responses may act before the scenario they answer; people's what-ifs may not. */
    allowEarlierStart: v.optional(v.boolean()),
    /** Also compute and save this scenario's domino effects as child runs (scheduled once). */
    autoCascade: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<WorkspaceResult> => {
    checkRequestId(args.requestId);
    if (!args.reviewed) reject("NOT_REVIEWED", "Confirm the scenario before simulating it");
    const label = requiredText("Scenario label", args.label, MAX_LABEL);
    const ownChanges = parseExactJson("Changes", ChangesSchema, args.changesJson);
    if (ownChanges.length === 0) reject("INVALID_INPUT", "Add at least one change to simulate");
    if ((args.constraintsJson === undefined) !== (args.constraintNote === undefined))
      reject("INVALID_INPUT", "New rules need a rule note, and a rule note needs rules");
    const rules =
      args.constraintsJson === undefined
        ? null
        : {
            constraints: parseExactJson("Rules", ConstraintsSchema, args.constraintsJson),
            note: requiredText("Rule note", args.constraintNote ?? "", MAX_NOTE),
          };
    const inputHash = await sha256Hex(
      canonicalJson({
        op: "simulate",
        parentRunId: args.parentRunId,
        label,
        changes: ownChanges,
        rules,
        methodVersion: WORKSPACE_METHOD_VERSION,
      }),
    );
    const prior = await priorRequest(ctx, args.companyId, args.requestId, inputHash);
    if (prior) return prior;
    const { node, baseline } = await loadParent(ctx, args.companyId, args.parentRunId);
    const snapshot = baseline.seed.snapshot;
    const floor = args.allowEarlierStart
      ? null
      : await branchFloor(ctx, args.companyId, args.parentRunId, snapshot);
    const early = startsBefore(ownChanges, snapshot, floor)[0];
    if (early)
      reject(
        "STARTS_BEFORE_PARENT",
        `This change starts ${early.date}, before the scenario it builds on starts (${floor}). Date it on or after ${floor}, or build it on an earlier scenario.`,
      );
    const saved = await saveChild(ctx, {
      companyId: args.companyId,
      requestId: args.requestId,
      inputHash,
      kind: "scenario",
      label,
      baseline,
      parent: node,
      constraints: rules ? rules.constraints : node.constraints,
      constraintNote: rules ? rules.note : node.constraintNote,
      ownChanges,
    });
    // Cascade children are saved through this mutation too; they never cascade again here.
    if (args.autoCascade && saved.created && !args.requestId.startsWith("cascade."))
      await ctx.scheduler.runAfter(0, autoCascadeRef, {
        companyId: args.companyId,
        runId: saved.runId,
      });
    return saved;
  },
});

const KindSchema = z.enum(["baseline", "rules", "scenario"]);
const ComparisonSchema = z
  .object({
    parentRunId: z.string(),
    weekly: z
      .array(z.object({ weekStart: z.string(), usableDelta: z.number().int() }).strict())
      .length(13),
    lowPointDelta: z.number().int(),
  })
  .strict()
  .nullable();

/** Saved run exactly as frozen: every payload re-parsed and its scope cross-checked. */
function projectRun(row: Doc<"timelineRuns">, baseline: SavedBaseline): WorkspaceRun {
  const kind = KindSchema.safeParse(row.kind);
  const constraints = ConstraintsSchema.safeParse(row.constraints);
  const ownChanges = ChangesSchema.safeParse(row.ownChanges);
  const changes = ChangesSchema.safeParse(row.changes);
  const forecast = ForecastSchema.safeParse(row.forecast);
  const dominoes = z.array(DominoSchema).safeParse(row.dominoes);
  const receipts = z.array(RuleReceiptSchema).safeParse(row.receipts);
  const comparison = ComparisonSchema.safeParse(row.comparison);
  const operation = OperationSummaryV1Schema.safeParse(row.operation);
  if (
    !kind.success ||
    !constraints.success ||
    !ownChanges.success ||
    !changes.success ||
    !forecast.success ||
    !dominoes.success ||
    !receipts.success ||
    !comparison.success ||
    !operation.success ||
    baseline.runId !== row.baselineRunId ||
    baseline.companyId !== row.companyId ||
    baseline.seedHash !== row.seedHash ||
    (row.parentRunId === null) !== (kind.data === "baseline") ||
    (comparison.data?.parentRunId ?? null) !== row.parentRunId ||
    !operation.data.outputRefs.includes(row.runId)
  )
    reject("INTEGRITY", "Saved run failed its integrity check");
  return {
    runId: row.runId,
    companyId: row.companyId,
    baselineRunId: row.baselineRunId,
    parentRunId: row.parentRunId,
    kind: kind.data,
    label: row.label,
    savedAt: row.savedAt,
    inputHash: row.inputHash,
    methodVersion: row.methodVersion,
    constraintVersion: row.constraintVersion,
    constraintNote: row.constraintNote,
    constraints: constraints.data,
    ownChanges: ownChanges.data,
    changes: changes.data,
    forecast: forecast.data,
    dominoes: dominoes.data,
    receipts: receipts.data,
    comparison: comparison.data,
    baseline,
    operation: operation.data,
  };
}

function catalogEntry(row: Doc<"timelineRuns">, baseline: SavedBaseline | null): CatalogEntry {
  const own = ChangesSchema.safeParse(row.ownChanges);
  return {
    runId: row.runId,
    companyId: row.companyId,
    baselineRunId: row.baselineRunId,
    parentRunId: row.parentRunId,
    kind: row.kind,
    label: row.label,
    savedAt: row.savedAt,
    lowPointCents: row.lowPointCents,
    lowPointWeek: row.lowPointWeek,
    constraintVersion: row.constraintVersion,
    startsOn: own.success && baseline ? scenarioStart(own.data, baseline.seed.snapshot) : null,
  };
}

/** Catalog entries with each run's start, reading every baseline behind them once. */
async function catalogEntries(ctx: QueryCtx, companyId: string, rows: Doc<"timelineRuns">[]) {
  const baselines = new Map<string, SavedBaseline | null>();
  const out: CatalogEntry[] = [];
  for (const row of rows) {
    if (!baselines.has(row.baselineRunId))
      baselines.set(row.baselineRunId, await loadBaseline(ctx, companyId, row.baselineRunId));
    out.push(catalogEntry(row, baselines.get(row.baselineRunId) ?? null));
  }
  return out;
}

/**
 * The branch point a new child must respect: the start of the nearest run in its ancestry
 * that changes events. Before that date the child's forecast is its parent's, so an earlier
 * event would fork it from the base instead of from the parent.
 */
export async function branchFloor(
  ctx: QueryCtx | MutationCtx,
  companyId: string,
  parentRunId: string,
  snapshot: SavedBaseline["seed"]["snapshot"],
): Promise<string | null> {
  let runId: string | null = parentRunId;
  for (let hops = 0; runId && hops < 64; hops++) {
    const row = await runRow(ctx, companyId, runId);
    if (!row) return null;
    const own = ChangesSchema.safeParse(row.ownChanges);
    const start = own.success ? scenarioStart(own.data, snapshot) : null;
    if (start) return start;
    runId = row.parentRunId;
  }
  return null;
}

/** One saved run under its company, or null. Reads saved outputs only; never runs the engine. */
export const get = query({
  args: { companyId: v.string(), runId: v.string() },
  handler: async (ctx, args): Promise<WorkspaceRun | null> => {
    const row = await runRow(ctx, args.companyId, args.runId);
    if (!row) return null;
    const baseline = await loadBaseline(ctx, args.companyId, row.baselineRunId);
    if (!baseline) reject("INTEGRITY", "The saved baseline behind this run is missing");
    return projectRun(row, baseline);
  },
});

/** Company-scoped saved runs, newest first. */
export const catalog = query({
  args: { companyId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { numItems } = args.paginationOpts;
    if (!Number.isInteger(numItems) || numItems < 1 || numItems > MAX_CATALOG_PAGE)
      reject("INVALID_INPUT", `Page size must be 1-${MAX_CATALOG_PAGE}`);
    const result = await ctx.db
      .query("timelineRuns")
      .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
      .order("desc")
      .paginate({ numItems, cursor: args.paginationOpts.cursor });
    return {
      page: await catalogEntries(ctx, args.companyId, result.page),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/** Every saved run on one baseline, oldest first; at most 100 (a full list may be truncated). */
export const graph = query({
  args: { companyId: v.string(), baselineRunId: v.string() },
  handler: async (ctx, args): Promise<CatalogEntry[]> => {
    const rows = await ctx.db
      .query("timelineRuns")
      .withIndex("by_company_and_baselineRunId", (q) =>
        q.eq("companyId", args.companyId).eq("baselineRunId", args.baselineRunId),
      )
      .take(MAX_GRAPH);
    return catalogEntries(ctx, args.companyId, rows);
  },
});

/** Canonical WeeklyResultRefV1 JSON pointing at one saved run, or null. */
export const resultRef = query({
  args: { companyId: v.string(), runId: v.string() },
  handler: async (ctx, args): Promise<string | null> => {
    const row = await runRow(ctx, args.companyId, args.runId);
    if (!row) return null;
    const ref: WeeklyResultRefV1 = {
      seedId: row.seedId,
      seedHash: row.seedHash,
      kind: row.kind === "baseline" ? "forecast" : "scenario",
      branchIds: [row.runId],
      route: `/c/${encodeURIComponent(row.companyId)}/timeline?runId=${encodeURIComponent(row.runId)}`,
    };
    const text = canonicalJson(ref);
    if (!parseWeeklyResultRefJson(text).success)
      reject("INTEGRITY", "This run cannot be described as a weekly result reference");
    return text;
  },
});
