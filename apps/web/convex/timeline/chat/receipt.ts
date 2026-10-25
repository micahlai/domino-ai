import { canonicalJson } from "@domino/contracts";
import { z } from "zod";
import { QuestionProposalSchema } from "../questions/receipt";
import { isCalendarDate, reject } from "../workspaceInput";

export const CHAT_METHOD = "timeline_chat@1";
export const Id = z.string().trim().min(1).max(240);
export const DateOnly = z.string().refine(isCalendarDate, "Use a real YYYY-MM-DD date");
const Timestamp = z.string().datetime();
/** A tappable reply Claude offers, such as an open invoice to pick. `value` is sent as text. */
export const ChatChoiceSchema = z
  .object({ label: z.string().min(1).max(120), value: z.string().min(1).max(200) })
  .strict();
export type ChatChoice = z.infer<typeof ChatChoiceSchema>;
export const MAX_CHOICES = 12;
export const ChatTurnSchema = z
  .object({
    id: Id,
    role: z.enum(["user", "assistant"]),
    text: z.string().min(1).max(2000),
    createdAt: Timestamp,
    choices: z.array(ChatChoiceSchema).min(1).max(MAX_CHOICES).optional(),
  })
  .strict()
  .superRefine((turn, ctx) => {
    if (turn.role === "user" && turn.text.length > 1000)
      ctx.addIssue({ code: "custom", message: "User messages are at most 1,000 characters" });
    if (turn.role === "user" && turn.choices)
      ctx.addIssue({ code: "custom", message: "Only assistant messages offer choices" });
  });
export const ChatReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    methodVersion: z.literal(CHAT_METHOD),
    companyId: Id,
    conversationId: Id,
    runId: Id,
    inputHash: z.string().regex(/^[a-f0-9]{64}$/),
    constraintVersion: Id,
    revision: z.number().int().nonnegative().safe(),
    status: z.enum(["collecting", "ready", "saved"]),
    selectedWeek: DateOnly.nullable(),
    selectedItemId: Id.nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    turns: z.array(ChatTurnSchema).min(1).max(42),
    proposal: QuestionProposalSchema.nullable(),
    linkedRunId: Id.nullable(),
    pendingField: z.string().min(1).max(200).nullable(),
  })
  .strict()
  .superRefine((r, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    if ((r.status !== "collecting") !== (r.proposal !== null)) issue("Proposal/status mismatch");
    if ((r.status === "saved") !== (r.linkedRunId !== null)) issue("Saved result/status mismatch");
    if (r.status !== "collecting" && r.pendingField !== null)
      issue("Completed draft has a pending field");
    if (r.turns.filter((t) => t.role === "user").length > 20) issue("At most 20 user turns");
    if (new Set(r.turns.map((t) => t.id)).size !== r.turns.length) issue("Repeated turn identity");
    if (r.createdAt > r.updatedAt) issue("Invalid chat timestamps");
  });
export type ChatReceipt = z.infer<typeof ChatReceiptSchema>;
export function exactReceipt(raw: unknown): ChatReceipt {
  const parsed = ChatReceiptSchema.safeParse(raw);
  if (!parsed.success || canonicalJson(parsed.data) !== canonicalJson(raw))
    reject("CHAT_INTEGRITY", "This saved chat could not be verified. Start a new chat.");
  return parsed.data;
}
