import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { type Infer, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { type QueryCtx, query } from "./_generated/server";
import { CASE, fail } from "./historical";

/**
 * S2: read-only catalog of saved investigations for the curated case, newest first. It reads
 * conversations, their operations and the historical rows those operations claim to have saved;
 * it never writes, schedules or calls a provider. Each item is an exact allowlist: no input,
 * output, packet, profile, remote run identity, error text or money.
 *
 * Status precedence (first match wins):
 * 1. operations past the read bound, or none at all -> unknown. The fixed workflow inserts its
 *    operations with the conversation, so an empty list is not a valid in-progress state.
 * 2. any queued or running -> running
 * 3. any unknown, or a succeeded output step whose saved row cannot be proven -> unknown, even
 *    when other steps failed
 * 4. all succeeded -> completed
 * 5. some failed with a proven saved forecast -> partial; otherwise -> failed
 */

type Op = Doc<"investigationOperations">;
type Conversation = Doc<"investigationConversations">;

const MAX_PAGE_ITEMS = 25;
// The fixed workflow holds at most 6 operations; investigation's own step loop stops at 8.
const MAX_OPERATIONS = 8;

const catalogStatus = v.union(
  v.literal("running"),
  v.literal("unknown"),
  v.literal("partial"),
  v.literal("failed"),
  v.literal("completed"),
);

const catalogItem = v.object({
  conversationId: v.string(),
  question: v.string(),
  createdAt: v.string(),
  status: catalogStatus,
  // false when the operation list was past the read bound; everything below is then withheld.
  operationsComplete: v.boolean(),
  currentOperation: v.union(
    v.null(),
    v.object({
      title: v.string(),
      kind: v.union(
        v.literal("source_load"),
        v.literal("forecast"),
        v.literal("specialist"),
        v.literal("reveal"),
        v.literal("alternative"),
      ),
      status: v.union(
        v.literal("queued"),
        v.literal("running"),
        v.literal("succeeded"),
        v.literal("failed"),
        v.literal("unknown"),
      ),
    }),
  ),
  forecastRunId: v.union(v.null(), v.string()),
  alternativeRunId: v.union(v.null(), v.string()),
  revealed: v.boolean(),
});

export type CatalogItem = Infer<typeof catalogItem>;

/** The single succeeded operation of a kind; none or several prove nothing. */
function onlySucceeded(ops: Op[], kind: Op["kind"]) {
  const done = ops.filter((o) => o.kind === kind && o.status === "succeeded");
  return done.length === 1 ? done[0]! : null;
}

const refId = (op: Op | null, kind: string) =>
  op?.outputRef?.kind === kind && op.outputRef.id.length > 0 ? op.outputRef.id : null;

/** One run row with this id, owned by this conversation on its case, or null. */
async function ownedRun(ctx: QueryCtx, c: Conversation, runId: string) {
  const rows = await ctx.db
    .query("historicalRuns")
    .withIndex("by_runId", (q) => q.eq("runId", runId))
    .take(2);
  const row = rows.length === 1 ? rows[0]! : null;
  return row && row.caseId === c.caseId && row.owner === c.conversationId ? row : null;
}

/** Saved ids, each proven by a succeeded operation's typed ref and the row it points to. */
async function proveOutputs(ctx: QueryCtx, c: Conversation, ops: Op[]) {
  const forecastOp = onlySucceeded(ops, "forecast");
  const alternativeOp = onlySucceeded(ops, "alternative");
  const revealOp = onlySucceeded(ops, "reveal");

  const forecastRef = refId(forecastOp, "run");
  const forecast = forecastRef ? await ownedRun(ctx, c, forecastRef) : null;
  const forecastRunId = forecast?.kind === "baseline" ? forecast.runId : null;

  const altRef = forecastRunId ? refId(alternativeOp, "run") : null;
  const alt = altRef ? await ownedRun(ctx, c, altRef) : null;
  const alternativeRunId =
    alt?.kind === "alternative" && alt.baselineRunId === forecastRunId ? alt.runId : null;

  // A reveal op points at its baseline run; the reveal row is keyed by that run.
  const revealRef = forecastRunId ? refId(revealOp, "reveal") : null;
  const reveals =
    revealRef && revealRef === forecastRunId
      ? await ctx.db
          .query("historicalReveals")
          .withIndex("by_runId", (q) => q.eq("runId", revealRef))
          .take(2)
      : [];
  const revealed = reveals.length === 1;

  // Any succeeded output step counts, so duplicates that prove nothing still read as unresolved.
  const claims = (kind: Op["kind"]) => ops.some((o) => o.kind === kind && o.status === "succeeded");
  const unproven =
    (claims("forecast") && forecastRunId === null) ||
    (claims("alternative") && alternativeRunId === null) ||
    (claims("reveal") && !revealed);
  return { forecastRunId, alternativeRunId, revealed, unproven };
}

function statusOf(ops: Op[], unproven: boolean, hasForecast: boolean) {
  if (ops.length === 0) return "unknown" as const;
  if (ops.some((o) => o.status === "queued" || o.status === "running")) return "running" as const;
  if (unproven || ops.some((o) => o.status === "unknown")) return "unknown" as const;
  if (ops.every((o) => o.status === "succeeded")) return "completed" as const;
  return hasForecast ? ("partial" as const) : ("failed" as const);
}

/** The step a reader most needs to see: active, then unresolved, then failed, else the last. */
function currentOf(ops: Op[]) {
  const order: Op["status"][] = ["running", "queued", "unknown", "failed"];
  const op = order.map((s) => ops.find((o) => o.status === s)).find(Boolean) ?? ops.at(-1);
  return op ? { title: op.title, kind: op.kind, status: op.status } : null;
}

async function itemOf(ctx: QueryCtx, c: Conversation): Promise<CatalogItem> {
  const identity = {
    conversationId: c.conversationId,
    question: c.question,
    createdAt: c.createdAt,
  };
  // One sentinel past the bound: a longer list may hide active or failed steps, so fail closed.
  const ops = await ctx.db
    .query("investigationOperations")
    .withIndex("by_conversation", (q) => q.eq("conversationId", c.conversationId))
    .take(MAX_OPERATIONS + 1);
  if (ops.length > MAX_OPERATIONS)
    return {
      ...identity,
      status: "unknown",
      operationsComplete: false,
      currentOperation: null,
      forecastRunId: null,
      alternativeRunId: null,
      revealed: false,
    };
  const { unproven, ...saved } = await proveOutputs(ctx, c, ops);
  return {
    ...identity,
    status: statusOf(ops, unproven, saved.forecastRunId !== null),
    operationsComplete: true,
    currentOperation: currentOf(ops),
    ...saved,
  };
}

/** Saved investigations of one curated case, newest first. 1-25 items per page. */
export const list = query({
  args: { caseId: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(catalogItem),
  handler: async (ctx, { caseId, paginationOpts }) => {
    if (caseId !== CASE.id) fail("NOT_FOUND", "Unknown case");
    const n = paginationOpts.numItems;
    if (!Number.isInteger(n) || n < 1 || n > MAX_PAGE_ITEMS)
      fail("INVALID_REQUEST", `numItems must be an integer from 1 to ${MAX_PAGE_ITEMS}`);
    const result = await ctx.db
      .query("investigationConversations")
      .withIndex("by_case_createdAt", (q) => q.eq("caseId", caseId))
      .order("desc")
      .paginate(paginationOpts);
    // A native endCursor sets the page boundary and ignores numItems, so the bound is
    // rechecked here, before any per-conversation reads. Rows are never sliced off.
    if (result.page.length > MAX_PAGE_ITEMS)
      fail("INVALID_REQUEST", `A page may hold at most ${MAX_PAGE_ITEMS} items; narrow endCursor`);
    return { ...result, page: await Promise.all(result.page.map((c) => itemOf(ctx, c))) };
  },
});
