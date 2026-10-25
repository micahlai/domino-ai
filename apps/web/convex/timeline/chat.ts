import { canonicalJson } from "@domino/contracts";
import { v } from "convex/values";
import { z } from "zod";
import type { Doc } from "../_generated/dataModel";
import { type MutationCtx, type QueryCtx, mutation, query } from "../_generated/server";
import { DraftSchema, GREETING, advance, emptyDraft, validateProposal } from "./chat/draft";
import { CHAT_METHOD, type ChatReceipt, DateOnly, Id, exactReceipt } from "./chat/receipt";
import { checkPinned, checkSelection, source } from "./chat/source";
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
): ChatReceipt {
  if (receipt.turns.length >= 42)
    reject("CHAT_LIMIT", "This chat has reached 42 messages. Start a new chat to continue.");
  return {
    ...receipt,
    turns: [
      ...receipt.turns,
      { id: `${receipt.conversationId}:${receipt.turns.length}`, role, text, createdAt: now },
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
    const next = advance(run, draft, args.text, receipt.conversationId, receipt.selectedItemId);
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
    updated = append(append(updated, "user", args.text, now), "assistant", next.answer, now);
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
