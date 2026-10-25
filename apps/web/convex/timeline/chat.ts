import { canonicalJson } from "@domino/contracts";
import { v } from "convex/values";
import { z } from "zod";
import type { Doc } from "../_generated/dataModel";
import {
  type MutationCtx,
  type QueryCtx,
  internalMutation,
  mutation,
  query,
} from "../_generated/server";
import { groundingIssue } from "./assistant/grounding";
import {
  type Result as DraftResult,
  DraftSchema,
  GREETING,
  advance,
  emptyDraft,
  evaluateIntents,
  validateProposal,
} from "./chat/draft";
import {
  CHAT_METHOD,
  type ChatChoice,
  type ChatReceipt,
  DateOnly,
  Id,
  exactReceipt,
} from "./chat/receipt";
import { checkPinned, checkSelection, source } from "./chat/source";
import { IntentSchema } from "./questions/intent";
import type { Citation } from "./questions/resolve";
import { branchFloor } from "./workspace";
import { checkRequestId, checkRowSize, reject, sha256Hex } from "./workspaceInput";
import { workspaceRefs } from "./workspaceRefs";

const KeySchema = z.object({ companyId: Id, conversationId: Id }).strict();
const WriteSchema = KeySchema.extend({
  requestId: z.string(),
  expectedRevision: z.number().int().nonnegative().safe(),
}).strict();
const RowSchema = z.object({ receipt: z.unknown(), draft: DraftSchema }).strict();
type Row = Doc<"timelineChats">;
type Ctx = MutationCtx | QueryCtx;
function parse<S extends z.ZodTypeAny>(schema: S, raw: unknown): z.output<S> {
  const out = schema.safeParse(raw);
  if (!out.success || canonicalJson(out.data) !== canonicalJson(raw))
    reject(
      "INVALID_INPUT",
      "Use valid chat identifiers, dates and values within the displayed limits.",
    );
  return out.data;
}
const rowOf = (ctx: Ctx, companyId: string, conversationId: string) =>
  ctx.db
    .query("timelineChats")
    .withIndex("by_company_and_conversationId", (q) =>
      q.eq("companyId", companyId).eq("conversationId", conversationId),
    )
    .unique();
async function read(ctx: Ctx, row: Row) {
  const data = parse(RowSchema, row.data);
  const receipt = exactReceipt(data.receipt);
  if (
    receipt.companyId !== row.companyId ||
    receipt.runId !== row.runId ||
    receipt.conversationId !== row.conversationId
  )
    reject("CHAT_INTEGRITY", "The saved chat identity is invalid.");
  const run = await source(ctx, receipt.companyId, receipt.runId);
  checkPinned(run, receipt);
  if (receipt.proposal) validateProposal(run, receipt.proposal);
  if (data.draft.pending && !data.draft.intents[data.draft.pending.index])
    reject("CHAT_INTEGRITY", "The saved pending draft is invalid.");
  return { receipt, draft: data.draft, run };
}
async function request(
  ctx: MutationCtx,
  op: string,
  args: { companyId: string; requestId: string },
) {
  checkRequestId(args.requestId);
  const hash = await sha256Hex(canonicalJson({ method: CHAT_METHOD, op, args }));
  const prior = await ctx.db
    .query("timelineChatRequests")
    .withIndex("by_company_and_requestId", (q) =>
      q.eq("companyId", args.companyId).eq("requestId", args.requestId),
    )
    .unique();
  if (!prior) return { hash, receipt: null };
  if (prior.requestHash !== hash)
    reject("REQUEST_CONFLICT", "This request key was already used for different chat inputs.");
  const receipt = exactReceipt(prior.data);
  const row = await rowOf(ctx, receipt.companyId, receipt.conversationId);
  if (!row || prior.companyId !== receipt.companyId)
    reject("CHAT_INTEGRITY", "The accepted chat request could not be verified.");
  const current = await read(ctx, row);
  checkPinned(current.run, receipt);
  if (receipt.proposal) validateProposal(current.run, receipt.proposal);
  return { hash, receipt };
}
async function accept(
  ctx: MutationCtx,
  args: { companyId: string; requestId: string },
  hash: string,
  receipt: ChatReceipt,
) {
  const exact = exactReceipt(receipt);
  const row = {
    companyId: args.companyId,
    requestId: args.requestId,
    requestHash: hash,
    data: exact,
  };
  checkRowSize(row);
  await ctx.db.insert("timelineChatRequests", row);
  return exact;
}
function append(
  receipt: ChatReceipt,
  role: "user" | "assistant",
  text: string,
  now: string,
  choices?: ChatChoice[],
  citations?: Citation[],
): ChatReceipt {
  if (receipt.turns.length >= 42)
    reject("CHAT_LIMIT", "This chat has reached 42 messages. Start a new chat to continue.");
  return {
    ...receipt,
    turns: [
      ...receipt.turns,
      {
        id: `${receipt.conversationId}:${receipt.turns.length}`,
        role,
        text,
        createdAt: now,
        ...(choices?.length ? { choices } : {}),
        ...(citations?.length ? { citations: citations.slice(0, 12) } : {}),
      },
    ],
  };
}
async function current(ctx: MutationCtx, args: z.infer<typeof WriteSchema>) {
  const row = await rowOf(ctx, args.companyId, args.conversationId);
  if (!row) reject("CHAT_NOT_FOUND", "This chat was not found for this company.");
  const data = await read(ctx, row);
  if (data.receipt.revision !== args.expectedRevision)
    reject(
      "STALE_REVISION",
      "This chat has changed. Reload its latest messages before trying again.",
    );
  if (data.receipt.status === "saved")
    reject("CHAT_SAVED", "This chat already saved a result. Start a new chat for another change.");
  return { ...data, row };
}
const keyArgs = { companyId: v.string(), conversationId: v.string() };
const writeArgs = { ...keyArgs, requestId: v.string(), expectedRevision: v.number() };
export const begin = mutation({
  args: {
    companyId: v.string(),
    runId: v.string(),
    requestId: v.string(),
    selectedWeek: v.optional(v.string()),
    selectedItemId: v.optional(v.string()),
  },
  handler: async (ctx, raw): Promise<ChatReceipt> => {
    const args = parse(
      z
        .object({
          companyId: Id,
          runId: Id,
          requestId: z.string(),
          selectedWeek: DateOnly.optional(),
          selectedItemId: Id.optional(),
        })
        .strict(),
      raw,
    );
    const prior = await request(ctx, "begin", args);
    if (prior.receipt) return prior.receipt;
    const run = await source(ctx, args.companyId, args.runId);
    checkSelection(run, args.selectedWeek ?? null, args.selectedItemId ?? null);
    const now = new Date().toISOString();
    const conversationId = `timeline:chat/${await sha256Hex(canonicalJson([args.companyId, args.requestId]))}`;
    let receipt: ChatReceipt = {
      schemaVersion: 1,
      methodVersion: CHAT_METHOD,
      companyId: args.companyId,
      conversationId,
      runId: args.runId,
      inputHash: run.inputHash,
      constraintVersion: run.constraintVersion,
      revision: 0,
      status: "collecting",
      selectedWeek: args.selectedWeek ?? null,
      selectedItemId: args.selectedItemId ?? null,
      createdAt: now,
      updatedAt: now,
      turns: [],
      proposal: null,
      linkedRunId: null,
      pendingField: null,
    };
    receipt = append(receipt, "assistant", GREETING, now);
    const row = {
      companyId: args.companyId,
      conversationId,
      runId: args.runId,
      data: { receipt, draft: emptyDraft() },
    };
    checkRowSize(row);
    await ctx.db.insert("timelineChats", row);
    return accept(ctx, args, prior.hash, receipt);
  },
});
export const send = mutation({
  args: { ...writeArgs, text: v.string() },
  handler: async (ctx, raw): Promise<ChatReceipt> => {
    const args = parse(
      WriteSchema.extend({
        text: z
          .string()
          .min(1)
          .max(1000)
          .refine((s) => s.trim().length > 0),
      }).strict(),
      raw,
    );
    const prior = await request(ctx, "send", args);
    if (prior.receipt) return prior.receipt;
    const { row, receipt, draft, run } = await current(ctx, args);
    if (
      receipt.turns.filter((t) => t.role === "user").length >= 20 ||
      receipt.turns.length + 2 > 42
    )
      reject(
        "CHAT_LIMIT",
        "This chat has reached 20 user turns or 42 messages. Start a new chat to continue.",
      );
    const floor = await branchFloor(ctx, run.companyId, run.runId, run.baseline.seed.snapshot);
    const next = advance(
      run,
      draft,
      args.text,
      receipt.conversationId,
      receipt.selectedItemId,
      floor,
    );
    const unchangedReady =
      receipt.status === "ready" &&
      !next.draft.pending &&
      canonicalJson(next.draft.intents) === canonicalJson(draft.intents);
    const proposal = next.proposal ?? (unchangedReady ? receipt.proposal : null);
    const now = new Date().toISOString();
    let updated: ChatReceipt = {
      ...receipt,
      revision: receipt.revision + 1,
      status: proposal ? "ready" : "collecting",
      proposal,
      pendingField: proposal ? null : next.pendingField,
      updatedAt: now,
    };
    updated = append(
      append(updated, "user", args.text, now),
      "assistant",
      next.answer,
      now,
      undefined,
      next.citations,
    );
    checkRowSize({ receipt: updated, draft: next.draft });
    await ctx.db.patch(row._id, { data: { receipt: exactReceipt(updated), draft: next.draft } });
    return accept(ctx, args, prior.hash, updated);
  },
});
export const reset = mutation({
  args: writeArgs,
  handler: async (ctx, raw): Promise<ChatReceipt> => {
    const args = parse(WriteSchema, raw);
    const prior = await request(ctx, "reset", args);
    if (prior.receipt) return prior.receipt;
    const { row, receipt } = await current(ctx, args);
    const now = new Date().toISOString();
    const updated = append(
      {
        ...receipt,
        status: "collecting",
        proposal: null,
        pendingField: null,
        revision: receipt.revision + 1,
        updatedAt: now,
      },
      "assistant",
      `Started over. The earlier messages remain saved; the previous draft is cleared. ${GREETING}`,
      now,
    );
    await ctx.db.patch(row._id, { data: { receipt: exactReceipt(updated), draft: emptyDraft() } });
    return accept(ctx, args, prior.hash, updated);
  },
});
export const confirm = mutation({
  args: { ...writeArgs, reviewed: v.boolean() },
  handler: async (ctx, raw): Promise<ChatReceipt> => {
    const args = parse(WriteSchema.extend({ reviewed: z.literal(true) }).strict(), raw);
    const prior = await request(ctx, "confirm", args);
    if (prior.receipt) return prior.receipt;
    const { row, receipt, draft, run } = await current(ctx, args);
    const proposal = receipt.proposal;
    if (receipt.status !== "ready" || !proposal)
      reject("CHAT_NOT_READY", "Answer the missing details before reviewing and saving.");
    if (receipt.turns.length >= 42)
      reject("CHAT_LIMIT", "This chat has reached 42 messages. Start a new chat to continue.");
    validateProposal(run, proposal);
    // A nested mutation and this receipt update commit in one transaction. Nothing is saved
    // if any later validation/write fails, and retries use the original request snapshot.
    const requestId = `chat-${(await sha256Hex(canonicalJson([args.companyId, args.conversationId, args.requestId]))).slice(0, 64)}`;
    const saved = proposal.changes.length
      ? await ctx.runMutation(workspaceRefs.simulate, {
          companyId: receipt.companyId,
          parentRunId: receipt.runId,
          requestId,
          label: proposal.label,
          changesJson: canonicalJson(proposal.changes),
          reviewed: true,
          ...(proposal.constraints
            ? {
                constraintsJson: canonicalJson(proposal.constraints),
                constraintNote: proposal.constraintNote ?? "Rules reviewed in Timeline chat",
              }
            : {}),
        })
      : await ctx.runMutation(workspaceRefs.reviseConstraints, {
          companyId: receipt.companyId,
          parentRunId: receipt.runId,
          requestId,
          constraintsJson: canonicalJson(proposal.constraints),
          note: proposal.constraintNote ?? "Rules reviewed in Timeline chat",
          reviewed: true,
        });
    const now = new Date().toISOString();
    const updated = append(
      {
        ...receipt,
        status: "saved",
        linkedRunId: saved.runId,
        revision: receipt.revision + 1,
        updatedAt: now,
      },
      "assistant",
      "Saved and calculated this reviewed proposal as a new timeline. Open the saved result to inspect its cash forecast and rule checks.",
      now,
    );
    await ctx.db.patch(row._id, { data: { receipt: exactReceipt(updated), draft } });
    return accept(ctx, args, prior.hash, updated);
  },
});
const AssistantInputSchema = WriteSchema.extend({
  text: z
    .string()
    .min(1)
    .max(1000)
    .refine((s) => s.trim().length > 0),
}).strict();
type AssistantInput = z.infer<typeof AssistantInputSchema>;
const assistantArgs = { ...writeArgs, text: v.string() };
const ASSISTANT_LEASE_MS = 140_000;

/** The request key binds only original inputs, never generated output or attempt metadata. */
async function assistantRequest(ctx: MutationCtx, args: AssistantInput) {
  checkRequestId(args.requestId);
  const hash = await sha256Hex(canonicalJson({ method: CHAT_METHOD, op: "assistant", args }));
  const prior = await ctx.db
    .query("timelineChatRequests")
    .withIndex("by_company_and_requestId", (q) =>
      q.eq("companyId", args.companyId).eq("requestId", args.requestId),
    )
    .unique();
  if (!prior) return { hash, prior, receipt: null };
  if (prior.requestHash !== hash) {
    // Old assistant rows did not fingerprint their inputs. Recover only the exact accepted
    // turn from its immutable receipt; different text, conversation or revision still rejects.
    const oldAssistant = await sha256Hex(
      canonicalJson({
        method: CHAT_METHOD,
        op: "assistant",
        args: { companyId: args.companyId, requestId: args.requestId },
      }),
    );
    const oldGrammar = await sha256Hex(canonicalJson({ method: CHAT_METHOD, op: "send", args }));
    const oldReceipt =
      !prior.assistant && (prior.requestHash === oldAssistant || prior.requestHash === oldGrammar)
        ? exactReceipt(prior.data)
        : null;
    if (
      !oldReceipt ||
      oldReceipt.conversationId !== args.conversationId ||
      oldReceipt.revision !== args.expectedRevision + 1 ||
      oldReceipt.turns.at(-2)?.role !== "user" ||
      oldReceipt.turns.at(-2)?.text !== args.text
    )
      reject("REQUEST_CONFLICT", "This request key was already used for different chat inputs.");
  }
  if (prior.assistant && prior.assistant.status !== "accepted")
    return { hash, prior, receipt: null };
  const receipt = exactReceipt(prior.data);
  const row = await rowOf(ctx, args.companyId, receipt.conversationId);
  if (!row || receipt.companyId !== args.companyId)
    reject("CHAT_INTEGRITY", "The accepted chat request could not be verified.");
  const current = await read(ctx, row);
  checkPinned(current.run, receipt);
  if (receipt.proposal) validateProposal(current.run, receipt.proposal);
  return { hash, prior, receipt };
}

/** Preflight and reserve one request atomically before any provider call. */
export const claimAssistantTurn = internalMutation({
  args: assistantArgs,
  handler: async (ctx, raw) => {
    const args = parse(AssistantInputSchema, raw);
    const prior = await assistantRequest(ctx, args);
    if (prior.receipt) return { kind: "accepted" as const, receipt: prior.receipt };
    const now = Date.now();
    if (prior.prior?.assistant?.status === "running" && prior.prior.assistant.leaseUntil > now)
      // The original revision deliberately fails the client's accepted-turn check. It keeps
      // the request unconfirmed, without pretending a turn was saved or making another call.
      return { kind: "running" as const, receipt: exactReceipt(prior.prior.data) };
    const { receipt, draft, run } = await current(ctx, args);
    if (
      receipt.turns.filter((t) => t.role === "user").length >= 20 ||
      receipt.turns.length + 2 > 42
    )
      reject(
        "CHAT_LIMIT",
        "This chat has reached 20 user turns or 42 messages. Start a new chat to continue.",
      );
    const attempt = (prior.prior?.assistant?.attempt ?? 0) + 1;
    const claim = {
      companyId: args.companyId,
      requestId: args.requestId,
      requestHash: prior.hash,
      data: receipt,
      assistant: { status: "running" as const, attempt, leaseUntil: now + ASSISTANT_LEASE_MS },
    };
    checkRowSize(claim);
    if (prior.prior) await ctx.db.patch(prior.prior._id, claim);
    else await ctx.db.insert("timelineChatRequests", claim);
    const floor = await branchFloor(ctx, run.companyId, run.runId, run.baseline.seed.snapshot);
    return { kind: "claimed" as const, receipt, draft, run, attempt, floor };
  },
});

/** Release a failed attempt; a later exact retry may claim again. Late attempts cannot commit. */
export const failAssistantTurn = internalMutation({
  args: { ...assistantArgs, attempt: v.number() },
  handler: async (ctx, { attempt, ...raw }): Promise<ChatReceipt | null> => {
    const args = parse(AssistantInputSchema, raw);
    const prior = await assistantRequest(ctx, args);
    if (prior.receipt) return prior.receipt;
    const claim = prior.prior?.assistant;
    if (prior.prior && claim?.status === "running" && claim.attempt === attempt)
      await ctx.db.patch(prior.prior._id, { assistant: { ...claim, status: "failed" } });
    return null;
  },
});

/** Save only a deterministic checked reply and proposal against the claimed source revision. */
export const saveAssistantTurn = internalMutation({
  args: { ...assistantArgs, attempt: v.number(), intentsJson: v.union(v.string(), v.null()) },
  handler: async (ctx, { attempt, intentsJson, ...raw }): Promise<ChatReceipt> => {
    const args = parse(AssistantInputSchema, raw);
    const prior = await assistantRequest(ctx, args);
    if (prior.receipt) return prior.receipt;
    const claim = prior.prior?.assistant;
    if (
      !prior.prior ||
      !claim ||
      claim.status !== "running" ||
      claim.attempt !== attempt ||
      claim.leaseUntil <= Date.now()
    )
      reject(
        "ASSISTANT_EXPIRED",
        "This reply expired. Retry the same message or reopen the saved conversation.",
      );
    const { row, receipt, draft, run } = await current(ctx, args);
    const intents =
      intentsJson === null ? null : z.array(IntentSchema).max(4).parse(JSON.parse(intentsJson));
    // Existing supplied slots are changed only by the deterministic pending-field/correction
    // path. A model cannot silently replace them or pull values from an earlier reset draft.
    // Enforce the original wording even when no model ran or returned no usable intents.
    // A rejection cannot fall through to the weaker fixed grammar or retain a ready proposal.
    const sourceIssue = groundingIssue(args.text, []);
    const floor = await branchFloor(ctx, run.companyId, run.runId, run.baseline.seed.snapshot);
    // Questions are always answered by the deterministic resolver, never by model wording.
    const asksOnly = intents?.length && intents.every((i) => i.kind === "question");
    const next: DraftResult = sourceIssue
      ? { draft, answer: sourceIssue, proposal: null, pendingField: receipt.pendingField }
      : draft.intents.length || intents === null || asksOnly
        ? advance(run, draft, args.text, receipt.conversationId, receipt.selectedItemId, floor)
        : evaluateIntents(
            run,
            intents,
            receipt.conversationId,
            args.text,
            receipt.selectedItemId,
            floor,
          );
    const unchangedReady =
      !sourceIssue &&
      receipt.status === "ready" &&
      !next.draft.pending &&
      canonicalJson(next.draft.intents) === canonicalJson(draft.intents);
    const proposal = next.proposal ?? (unchangedReady ? receipt.proposal : null);
    const now = new Date().toISOString();
    let updated: ChatReceipt = {
      ...receipt,
      revision: receipt.revision + 1,
      status: proposal ? "ready" : "collecting",
      proposal,
      pendingField: proposal ? null : next.pendingField,
      updatedAt: now,
    };
    updated = append(
      append(updated, "user", args.text, now),
      "assistant",
      next.answer,
      now,
      undefined,
      next.citations,
    );
    checkRowSize({ receipt: updated, draft: next.draft });
    await ctx.db.patch(row._id, { data: { receipt: exactReceipt(updated), draft: next.draft } });
    await ctx.db.patch(prior.prior._id, {
      data: exactReceipt(updated),
      assistant: { ...claim, status: "accepted" },
    });
    return updated;
  },
});
export const get = query({
  args: keyArgs,
  handler: async (ctx, raw): Promise<ChatReceipt | null> => {
    const args = parse(KeySchema, raw);
    const row = await rowOf(ctx, args.companyId, args.conversationId);
    return row ? (await read(ctx, row)).receipt : null;
  },
});
export const list = query({
  args: { companyId: v.string(), runId: v.string() },
  handler: async (ctx, raw): Promise<ChatReceipt[]> => {
    const args = parse(z.object({ companyId: Id, runId: Id }).strict(), raw);
    await source(ctx, args.companyId, args.runId);
    const rows = await ctx.db
      .query("timelineChats")
      .withIndex("by_company_and_runId", (q) =>
        q.eq("companyId", args.companyId).eq("runId", args.runId),
      )
      .order("desc")
      .take(20);
    const result: ChatReceipt[] = [];
    for (const row of rows) result.push((await read(ctx, row)).receipt);
    return result;
  },
});
