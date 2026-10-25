import {
  ChangeSchema,
  ConstraintSchema,
  DominoSchema,
  ForecastSchema,
  ISODateSchema,
  OperationSummaryV1Schema,
  type WeeklyResultRefV1,
  exactBoundarySchema,
  parseWeeklyResultRefJson,
} from "@domino/contracts";
import type { PaginationOptions, PaginationResult } from "convex/server";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";
import { SavedBaselineSchema } from "../baseline/api";

// Frozen local interface: kb/features/timeline/TL2-TL5-interface.md. Typed references by name
// only; the browser never imports the backend modules, and every read is parsed here.

// Type aliases, not interfaces: Convex argument types need an implicit index signature.
export type RunKey = { companyId: string; runId: string };
export type RunResult = { companyId: string; runId: string; created: boolean };
export type OpenArgs = { companyId: string; baselineRunId: string; requestId: string };
export type ReviseArgs = {
  companyId: string;
  parentRunId: string;
  requestId: string;
  constraintsJson: string;
  note: string;
  reviewed: boolean;
};
export type SimulateArgs = {
  companyId: string;
  parentRunId: string;
  requestId: string;
  label: string;
  changesJson: string;
  reviewed: boolean;
  constraintsJson?: string;
  constraintNote?: string;
};
export type CatalogArgs = { companyId: string; paginationOpts: PaginationOptions };
export type GraphArgs = { companyId: string; baselineRunId: string };
export type AskArgs = {
  companyId: string;
  runId: string;
  requestId: string;
  prompt: string;
  selectedWeek?: string;
  selectedItemId?: string;
};
export type LinkArgs = { companyId: string; questionId: string; resultRunId: string };

export const openRef = makeFunctionReference<"mutation", OpenArgs, RunResult>(
  "timeline/workspace:open",
);
export const reviseConstraintsRef = makeFunctionReference<"mutation", ReviseArgs, RunResult>(
  "timeline/workspace:reviseConstraints",
);
export const simulateRef = makeFunctionReference<"mutation", SimulateArgs, RunResult>(
  "timeline/workspace:simulate",
);
export const getRunRef = makeFunctionReference<"query", RunKey, unknown>("timeline/workspace:get");
export const catalogRef = makeFunctionReference<"query", CatalogArgs, PaginationResult<unknown>>(
  "timeline/workspace:catalog",
);
export const graphRef = makeFunctionReference<"query", GraphArgs, unknown>(
  "timeline/workspace:graph",
);
export const resultRefRef = makeFunctionReference<"query", RunKey, unknown>(
  "timeline/workspace:resultRef",
);
export const askRef = makeFunctionReference<"action", AskArgs, unknown>("timeline/questions:ask");
export const listQuestionsRef = makeFunctionReference<"query", RunKey, unknown>(
  "timeline/questions:list",
);
export const linkQuestionRef = makeFunctionReference<"mutation", LinkArgs, unknown>(
  "timeline/questions:link",
);

const Text = z.string().min(1);
const RunKind = z.enum(["baseline", "rules", "scenario"]);
const Timestamp = z.string().datetime({ offset: true });

export const RunResultSchema = z
  .object({ companyId: Text, runId: Text, created: z.boolean() })
  .strict();

export const RuleReceiptSchema = z
  .object({
    constraintId: Text,
    constraintVersion: Text,
    label: Text,
    kind: z.enum(["min_cash", "min_runway_months", "pay_by_date"]),
    status: z.enum(["breached", "clear", "beyond_horizon", "unable"]),
    relation: z.enum(["new", "pre_existing", "resolved", "clear", "outside_horizon", "unable"]),
    limit: z.number(),
    unit: z.enum(["cents", "months", "days"]),
    value: z.number().nullable(),
    shortfall: z.number().nullable(),
    date: ISODateSchema.nullable(),
    weekStart: ISODateSchema.nullable(),
    actionLabels: z.array(z.string()),
    evidence: z.array(z.string()),
  })
  .strict();
export type RuleReceipt = z.infer<typeof RuleReceiptSchema>;

const ComparisonSchema = z
  .object({
    parentRunId: Text,
    weekly: z.array(z.object({ weekStart: ISODateSchema, usableDelta: z.number().int() }).strict()),
    lowPointDelta: z.number().int(),
  })
  .strict();

const WorkspaceRunObject = z
  .object({
    runId: Text,
    companyId: Text,
    baselineRunId: Text,
    parentRunId: Text.nullable(),
    kind: RunKind,
    label: z.string(),
    savedAt: Timestamp,
    inputHash: Text,
    methodVersion: Text,
    constraintVersion: Text,
    constraintNote: z.string(),
    constraints: z.array(ConstraintSchema),
    ownChanges: z.array(ChangeSchema),
    changes: z.array(ChangeSchema),
    forecast: ForecastSchema,
    dominoes: z.array(DominoSchema),
    receipts: z.array(RuleReceiptSchema),
    comparison: ComparisonSchema.nullable(),
    baseline: SavedBaselineSchema,
    operation: OperationSummaryV1Schema,
  })
  .strict();
/** Exact: an unknown or silently stripped field makes the whole record unusable. */
export const WorkspaceRunSchema = exactBoundarySchema(WorkspaceRunObject);
export type WorkspaceRun = z.infer<typeof WorkspaceRunObject>;

const CatalogEntryObject = z
  .object({
    runId: Text,
    companyId: Text,
    baselineRunId: Text,
    parentRunId: Text.nullable(),
    kind: RunKind,
    label: z.string(),
    savedAt: Timestamp,
    lowPointCents: z.number().int(),
    lowPointWeek: ISODateSchema,
    constraintVersion: Text,
  })
  .strict();
export const CatalogEntrySchema = exactBoundarySchema(CatalogEntryObject);
export type CatalogEntry = z.infer<typeof CatalogEntryObject>;

const CatalogPageSchema = z
  .object({
    page: z.array(z.unknown()),
    isDone: z.boolean(),
    continueCursor: z.string(),
  })
  .passthrough(); // Convex may add splitCursor/pageStatus; entries are still parsed exactly.

/** Graph reads are bounded at 100 server-side; a full page may hide older nodes. */
export const GRAPH_LIMIT = 100;

const QuestionProposalSchema = z
  .object({
    label: z.string(),
    changes: z.array(ChangeSchema),
    constraints: z.array(ConstraintSchema).nullable(),
    constraintNote: z.string().nullable(),
  })
  .strict();
export type QuestionProposal = z.infer<typeof QuestionProposalSchema>;

const QuestionReceiptObject = z
  .object({
    id: Text,
    companyId: Text,
    runId: Text,
    requestId: Text,
    prompt: z.string(),
    selectedWeek: ISODateSchema.nullable(),
    selectedItemId: z.string().nullable(),
    status: z.enum(["running", "answered", "proposal", "clarification", "failed"]),
    answer: z.string(),
    citations: z.array(z.object({ ref: Text, label: z.string() }).strict()),
    proposal: QuestionProposalSchema.nullable(),
    errorCode: z.string().nullable(),
    linkedRunId: z.string().nullable(),
    savedAt: Timestamp,
    operation: OperationSummaryV1Schema,
  })
  .strict()
  .superRefine((q, ctx) => {
    // A proposal without a proposal body (or the reverse) cannot be confirmed safely.
    if ((q.status === "proposal") !== (q.proposal !== null))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["proposal"], message: "mismatch" });
  });
export const QuestionReceiptSchema = exactBoundarySchema(QuestionReceiptObject);
export type QuestionReceipt = z.infer<typeof QuestionReceiptObject>;

export type Read<T> =
  | { state: "loading" }
  | { state: "missing" }
  | { state: "unusable" }
  | { state: "error" }
  | { state: "ready"; value: T };

const LOADING = { state: "loading" } as const;
const UNUSABLE = { state: "unusable" } as const;

/** undefined is loading; an Error value (from useQueries) is a failed read, never empty data. */
function pending(raw: unknown): Read<never> | undefined {
  if (raw === undefined) return LOADING;
  if (raw instanceof Error) return { state: "error" };
  return undefined;
}

/** One saved node, accepted only if every identity matches the link it was opened from. */
export function readRun(raw: unknown, key: RunKey): Read<WorkspaceRun> {
  const early = pending(raw);
  if (early) return early;
  if (raw === null) return { state: "missing" };
  const parsed = WorkspaceRunSchema.safeParse(raw);
  if (!parsed.success) return UNUSABLE;
  const r = parsed.data;
  const b = r.baseline;
  if (r.companyId !== key.companyId || r.runId !== key.runId) return UNUSABLE;
  if (b.companyId !== r.companyId || b.runId !== r.baselineRunId) return UNUSABLE;
  if ((r.kind === "baseline") !== (r.parentRunId === null)) return UNUSABLE;
  if (r.comparison && r.comparison.parentRunId !== r.parentRunId) return UNUSABLE;
  if (r.comparison && r.comparison.weekly.length !== r.forecast.weeks.length) return UNUSABLE;
  return { state: "ready", value: r };
}

function entriesFor(raws: unknown[], companyId: string): CatalogEntry[] | undefined {
  const out: CatalogEntry[] = [];
  for (const raw of raws) {
    const e = CatalogEntrySchema.safeParse(raw);
    if (!e.success || e.data.companyId !== companyId) return undefined;
    out.push(e.data);
  }
  return out;
}

export type CatalogPage = { entries: CatalogEntry[]; isDone: boolean; continueCursor: string };

export function readCatalogPage(raw: unknown, companyId: string): Read<CatalogPage> {
  const early = pending(raw);
  if (early) return early;
  const page = CatalogPageSchema.safeParse(raw);
  if (!page.success) return UNUSABLE;
  const entries = entriesFor(page.data.page, companyId);
  if (!entries) return UNUSABLE;
  return {
    state: "ready",
    value: { entries, isDone: page.data.isDone, continueCursor: page.data.continueCursor },
  };
}

export function readGraph(raw: unknown, key: GraphArgs): Read<CatalogEntry[]> {
  const early = pending(raw);
  if (early) return early;
  if (!Array.isArray(raw) || raw.length > GRAPH_LIMIT) return UNUSABLE;
  const entries = entriesFor(raw, key.companyId);
  if (!entries || entries.some((e) => e.baselineRunId !== key.baselineRunId)) return UNUSABLE;
  return { state: "ready", value: entries };
}

export function readQuestions(raw: unknown, key: RunKey): Read<QuestionReceipt[]> {
  const early = pending(raw);
  if (early) return early;
  if (!Array.isArray(raw) || raw.length > 100) return UNUSABLE;
  const out: QuestionReceipt[] = [];
  for (const item of raw) {
    const q = readQuestion(item, key);
    if (!q) return UNUSABLE;
    out.push(q);
  }
  return { state: "ready", value: out };
}

/** One receipt from ask or list, pinned to the run it was asked about. */
export function readQuestion(raw: unknown, key: RunKey): QuestionReceipt | undefined {
  const q = QuestionReceiptSchema.safeParse(raw);
  if (!q.success || q.data.companyId !== key.companyId || q.data.runId !== key.runId)
    return undefined;
  return q.data;
}

export function readResultRef(raw: unknown): Read<WeeklyResultRefV1> {
  const early = pending(raw);
  if (early) return early;
  if (raw === null) return { state: "missing" };
  const parsed = parseWeeklyResultRefJson(raw);
  return parsed.success ? { state: "ready", value: parsed.data } : UNUSABLE;
}

export const LinkResultSchema = z.object({ linkedRunId: Text }).strict();

// ---------- Links ----------

export type WorkspaceLink =
  | { kind: "catalog" }
  | { kind: "run"; runId: string }
  | { kind: "bootstrap"; baselineRunId: string }
  | { kind: "conflict" };

export function workspaceHref(
  companyId: string,
  target: { runId: string } | { baselineRunId: string } | null = null,
): string {
  const base = `/c/${encodeURIComponent(companyId)}/timeline`;
  if (!target) return base;
  const params = new URLSearchParams(target as Record<string, string>);
  return `${base}?${params.toString()}`;
}

/** runId reopens a saved node; baselineRunId offers to start from a saved baseline. Never both. */
export function workspaceLinkFromSearch(search: string): WorkspaceLink {
  const params = new URLSearchParams(search);
  const runId = params.get("runId") ?? "";
  const baselineRunId = params.get("baselineRunId") ?? "";
  if (runId && baselineRunId) return { kind: "conflict" };
  if (runId) return { kind: "run", runId };
  if (baselineRunId) return { kind: "bootstrap", baselineRunId };
  return { kind: "catalog" };
}

// ---------- Ancestry ----------

export type Ancestry = {
  /** Root first, ending at the selected node. Missing links stop the walk honestly. */
  path: CatalogEntry[];
  children: CatalogEntry[];
  /** The graph hit its bound, so older or other nodes may not be listed. */
  truncated: boolean;
  /** The walk reached a parent that is not in the graph. */
  broken: boolean;
};

export function ancestryOf(graph: CatalogEntry[], runId: string): Ancestry {
  const byId = new Map(graph.map((e) => [e.runId, e]));
  const path: CatalogEntry[] = [];
  const seen = new Set<string>();
  let broken = false;
  let at: string | null = runId;
  while (at !== null) {
    const entry = byId.get(at);
    if (!entry || seen.has(at)) {
      broken = true;
      break;
    }
    seen.add(at);
    path.unshift(entry);
    at = entry.parentRunId;
  }
  return {
    path,
    children: graph.filter((e) => e.parentRunId === runId),
    truncated: graph.length >= GRAPH_LIMIT,
    broken,
  };
}
