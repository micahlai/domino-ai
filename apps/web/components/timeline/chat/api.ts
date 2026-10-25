import { ChangeSchema, ConstraintSchema, canonicalJson } from "@domino/contracts";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";
import { ScenarioBriefSchema } from "../../../convex/timeline/chat/brief";
import { WorkerChatContextSchema } from "../../../lib/worker-chat-context";
import type { Read, RunKey, WorkspaceRun } from "../workspace/api";

const Id = z.string().min(1).max(240);
const Stamp = z.string().datetime({ offset: true });
export const CalendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const n = Date.parse(`${s}T00:00:00Z`);
    return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === s;
  });
const Proposal = z
  .object({
    label: z.string().min(1).max(200),
    changes: z.array(ChangeSchema).max(16),
    constraints: z.array(ConstraintSchema).max(32).nullable(),
    constraintNote: z.string().max(500).nullable(),
  })
  .strict();
const Receipt = z
  .object({
    schemaVersion: z.literal(1),
    methodVersion: z.literal("timeline_chat@1"),
    companyId: Id,
    conversationId: Id,
    runId: Id,
    inputHash: z.string().regex(/^[a-f0-9]{64}$/),
    constraintVersion: z.string().min(1).max(240),
    revision: z.number().int().safe().min(0),
    status: z.enum(["collecting", "ready", "saved"]),
    selectedWeek: CalendarDate.nullable(),
    selectedItemId: Id.nullable(),
    createdAt: Stamp,
    updatedAt: Stamp,
    turns: z
      .array(
        z
          .object({
            id: Id,
            role: z.enum(["user", "assistant"]),
            text: z.string().min(1).max(2000),
            createdAt: Stamp,
            choices: z
              .array(
                z
                  .object({ label: z.string().min(1).max(120), value: z.string().min(1).max(200) })
                  .strict(),
              )
              .min(1)
              .max(12)
              .optional(),
            citations: z
              .array(
                z
                  .object({ ref: z.string().min(1).max(200), label: z.string().min(1).max(200) })
                  .strict(),
              )
              .min(1)
              .max(12)
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(42),
    proposal: Proposal.nullable(),
    linkedRunId: Id.nullable(),
    pendingField: z.string().min(1).max(200).nullable(),
    workerContext: WorkerChatContextSchema.optional(),
    /** The what-if's story Ask Domino recorded; shown nowhere yet, read by predictions. */
    brief: ScenarioBriefSchema.optional(),
  })
  .strict();
export type ChatReceipt = z.infer<typeof Receipt>;
export const ChatReceiptSchema = Receipt.superRefine((r, ctx) => {
  const bad = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if ((r.status !== "collecting") !== (r.proposal !== null)) bad("proposal/status mismatch");
  if ((r.status === "saved") !== (r.linkedRunId !== null)) bad("saved link/status mismatch");
  if (r.status !== "collecting" && r.pendingField !== null) bad("ready pending field");
  if (r.updatedAt < r.createdAt) bad("invalid timestamps");
  if (new Set(r.turns.map((t) => t.id)).size !== r.turns.length) bad("duplicate turn");
  if (r.turns.filter((t) => t.role === "user").length > 20) bad("too many user turns");
  for (const t of r.turns) if (t.role === "user" && t.text.length > 1000) bad("long user turn");
  for (const c of r.proposal?.changes ?? []) {
    if (
      (c.kind === "add_cash" || c.kind === "remove_cash") &&
      (!Number.isSafeInteger(c.amount) || c.amount <= 0 || c.amount > 2 ** 49)
    )
      bad("unsafe cash");
    if (c.kind === "shift_hire" && !Number.isSafeInteger(c.monthlyCost)) bad("unsafe cost");
    for (const [key, value] of Object.entries(c))
      if (
        ["date", "fromDate", "toDate", "payOn"].includes(key) &&
        !CalendarDate.safeParse(value).success
      )
        bad("invalid event date");
  }
  for (const c of r.proposal?.constraints ?? []) {
    if (
      !Number.isFinite(c.limit) ||
      c.limit < 0 ||
      (c.kind === "min_cash" && (!Number.isSafeInteger(c.limit) || c.limit > 2 ** 49))
    )
      bad("unsafe rule");
  }
});
function parse(raw: unknown): ChatReceipt | undefined {
  const p = ChatReceiptSchema.safeParse(raw);
  if (!p.success) return;
  try {
    return canonicalJson(raw) === canonicalJson(p.data) ? p.data : undefined;
  } catch {
    return;
  }
}
export function matchesSource(r: ChatReceipt, run: WorkspaceRun): boolean {
  const context = r.workerContext;
  if (
    context &&
    (context.fixRunId !== run.runId ||
      context.scenarioRunId !== run.parentRunId ||
      context.inputs.snapshot.companyId !== run.companyId ||
      canonicalJson(context.inputs.model.data) !== canonicalJson(run.baseline.model) ||
      canonicalJson(context.inputs.constraints) !== canonicalJson(run.constraints) ||
      canonicalJson(context.candidate.fix.changes) !== canonicalJson(run.ownChanges) ||
      context.candidate.effect.lowPoint !== run.forecast.lowPoint.usable ||
      context.candidate.effect.lowWeekStart !== run.forecast.lowPoint.weekStart ||
      context.candidate.effect.gain !== run.comparison?.lowPointDelta)
  )
    return false;
  const { snapshot, scheduledItems } = run.baseline.seed;
  const recordIds = new Set(
    [...snapshot.invoices, ...snapshot.bills, ...snapshot.payroll].map((record) => record.id),
  );
  const scheduledByRecord = new Map(scheduledItems.map((item) => [item.sourceRef, item.id]));
  const selectedIds = new Set([
    ...recordIds,
    ...[...recordIds]
      .map((id) => scheduledByRecord.get(id))
      .filter((id): id is string => id !== undefined),
  ]);
  return (
    r.companyId === run.companyId &&
    r.runId === run.runId &&
    r.inputHash === run.inputHash &&
    r.constraintVersion === run.constraintVersion &&
    (r.selectedWeek === null ||
      [...run.forecast.weeks, ...run.baseline.history].some(
        (w) => w.weekStart === r.selectedWeek,
      )) &&
    (r.selectedItemId === null || selectedIds.has(r.selectedItemId))
  );
}
export function readChat(
  raw: unknown,
  key: RunKey & { conversationId?: string },
  run?: WorkspaceRun,
): Read<ChatReceipt> {
  if (raw === undefined) return { state: "loading" };
  if (raw instanceof Error) return { state: "error" };
  if (raw === null) return { state: "missing" };
  const r = parse(raw);
  if (
    !r ||
    r.companyId !== key.companyId ||
    r.runId !== key.runId ||
    (key.conversationId && key.conversationId !== r.conversationId) ||
    (run && !matchesSource(r, run))
  )
    return { state: "unusable" };
  return { state: "ready", value: r };
}
export function readChats(raw: unknown, key: RunKey, run?: WorkspaceRun): Read<ChatReceipt[]> {
  if (raw === undefined) return { state: "loading" };
  if (raw instanceof Error) return { state: "error" };
  if (!Array.isArray(raw) || raw.length > 20) return { state: "unusable" };
  const receipts: ChatReceipt[] = [];
  for (const item of raw) {
    const p = readChat(item, key, run);
    if (p.state !== "ready") return { state: "unusable" };
    receipts.push(p.value);
  }
  return new Set(receipts.map((r) => r.conversationId)).size === receipts.length
    ? { state: "ready", value: receipts }
    : { state: "unusable" };
}
/** A delayed query/write result must never replace a newer revision of this conversation. */
export function newerReceipt(a: ChatReceipt | null, b: ChatReceipt): ChatReceipt {
  return a?.conversationId === b.conversationId && a.revision >= b.revision ? a : b;
}
/** A new route must commit before its composer accepts text that a remount could discard. */
export function displayedReceipt(
  local: ChatReceipt | null,
  selected: ChatReceipt | null,
  beginNavigates: boolean,
): ChatReceipt | null {
  return selected ? newerReceipt(local, selected) : beginNavigates ? null : local;
}
export type BeginArgs = RunKey & {
  requestId: string;
  selectedWeek?: string;
  selectedItemId?: string;
};
export type TurnArgs = {
  companyId: string;
  conversationId: string;
  requestId: string;
  expectedRevision: number;
};
export type SendArgs = TurnArgs & { text: string };
export type ConfirmArgs = TurnArgs & { reviewed: true };
export const beginRef = makeFunctionReference<"mutation", BeginArgs, unknown>(
  "timeline/chat:begin",
);
// Claude answers when the deployment has a key; otherwise the action uses the fixed grammar.
export const sendRef = makeFunctionReference<"action", SendArgs, unknown>(
  "timeline/chatAssistant:send",
);
export const resetRef = makeFunctionReference<"mutation", TurnArgs, unknown>("timeline/chat:reset");
export const confirmRef = makeFunctionReference<"mutation", ConfirmArgs, unknown>(
  "timeline/chat:confirm",
);
export const getChatRef = makeFunctionReference<
  "query",
  { companyId: string; conversationId: string },
  unknown
>("timeline/chat:get");
export const listChatsRef = makeFunctionReference<"query", RunKey, unknown>("timeline/chat:list");
export function chatHref(
  companyId: string,
  runId: string,
  conversationId?: string,
  selectedWeek?: string,
  selectedItemId?: string,
): string {
  const p = new URLSearchParams({ runId });
  if (conversationId) p.set("conversationId", conversationId);
  if (selectedWeek) p.set("selectedWeek", selectedWeek);
  if (selectedItemId) p.set("selectedItemId", selectedItemId);
  return `/c/${encodeURIComponent(companyId)}/timeline?${p}#timeline-chat`;
}
