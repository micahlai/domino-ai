import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import { z } from "zod";
import { action } from "../_generated/server";
import { AssistantUnavailable, assistantConfig, runStructured } from "./assistant/claude";
import { companyContext } from "./assistant/context";
import { type Draft, evaluateIntents } from "./chat/draft";
import { type ChatReceipt, MAX_CHOICES } from "./chat/receipt";
import { type WorkspaceRun, projectRun, workspaceGet } from "./questions/context";
import { INTENTS_JSON_SCHEMA, type Intent, IntentSchema, IntentsSchema } from "./questions/intent";
import { type Citation, resolve } from "./questions/resolve";

// Claude-backed Timeline chat. Claude converses with the company's saved run as context and
// fills draft slots with normalized values ("$50,000", "2026-11-02", exact invoice ids).
// Every draft goes through the fixed validator and resolver (chat/draft.ts evaluateIntents),
// both inside the tool loop and again when saved, so proposals match the grammar path.
// Without ANTHROPIC_API_KEY this forwards to the fixed-grammar timeline/chat:send.

type TurnArgs = {
  companyId: string;
  conversationId: string;
  requestId: string;
  expectedRevision: number;
};
const refs = {
  state: makeFunctionReference<
    "query",
    { companyId: string; conversationId: string },
    { receipt: ChatReceipt; draft: Draft; floor: string | null }
  >("timeline/chat:assistantState"),
  save: makeFunctionReference<
    "mutation",
    TurnArgs & {
      text: string;
      reply: string;
      choicesJson: string;
      citationsJson: string;
      intentsJson: string | null;
    },
    ChatReceipt
  >("timeline/chat:saveAssistantTurn"),
  grammarSend: makeFunctionReference<"mutation", TurnArgs & { text: string }, ChatReceipt>(
    "timeline/chat:send",
  ),
};

const SYSTEM = `You are Domino, an FP&A analyst helping a finance lead explore "what if" changes to a saved 13-week cash forecast.

You answer questions and draft what-ifs in one conversation.

Answering questions: for the low point, a week, a bill, invoice or payroll item, the rules or the dominoes, call answer_question first. It returns Domino's own answer and the saved records it comes from; base your reply on it and keep its facts. Broader questions (why, compare, what should we watch) you answer from the context directly. Answering never changes the draft.

You can talk freely about the company using the context provided: its forecast, cash low point, open invoices and bills, rules (lender's limits, runway, bill deadlines), dominoes (the chain of problems a risk causes), and scenario changes already in this run. Quote numbers only from that context. Never add, subtract, net or project money yourself; the engine calculates every result after the person saves.

The changes you can draft:
- cash_change: a one-time payment out ("out") or receipt in ("in") on one date, with one counterparty.
- late_invoice: an open invoice paid N days late.
- min_cash_rule: keep usable cash above an amount.
- runway_rule: keep at least N months of runway.
- pay_by_date_rule: pay an unpaid bill within N late days (0 days = on time).
Anything else (recurring events, hiring plans, conditions, ranges) is not supported yet. Say so plainly and suggest the closest supported change.

Call update_draft whenever the person describes or corrects a change. Always send the complete draft (every change being built, at most 4), not only the new part. Normalize values:
- amountText: dollars with "$" and commas, like "$50,000" or "$3M". A bare number such as 50000 means dollars.
- dateText: "YYYY-MM-DD", inside the forecast window. Fill in a missing year from the window. Fix sloppy dates like 2026-11-2 to 2026-11-02.
- counterpartyText: a clean proper name made of letters only, like "Atlas Legal". Capitalize it. No digits.
- itemText: the exact invoice or bill id from the context. Pick it from the customer or vendor the person names.
- daysText: like "14 days". monthsText: like "4.5 months".
Use null for anything the person has not told you. Never invent amounts, dates or names.

Every what-if branches off the scenario that is open, and its timeline line starts where its first change starts. When earliestAllowedStart is set, the open scenario starts then: every change must start on or after that date (an invoice or bill change starts on the record's due date). If the person has not said when a change starts, ask, and offer a few valid dates as choices.
To clear the draft (the person wants to start over), call update_draft with an empty list.

update_draft returns the result of Domino's checks:
- "ready": the proposal is complete. Briefly restate it and tell the person to review and confirm below to save and calculate it. Nothing has run yet.
- "needs_value": ask for the missing value in one short, friendly question.
- "cannot_use": explain the problem in plain words and how to fix it.

Offer choices whenever the person must pick from a known list or answer a small closed question: for example the open invoices to make late (label "Acme Logistics · INV-104 · $82,000 due Nov 18", value "INV-104"), bills for a deadline rule, dates or yes/no confirmations. Each value is sent back as the person's reply. Give at most ${MAX_CHOICES} choices, and an empty list when free text fits better.

Write in plain words, short sentences, no jargon ("lender's limit", not "covenant"). Keep replies under 120 words. Reply with JSON only, matching the schema.`;

const REPLY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "choices"],
  properties: {
    reply: { type: "string" },
    choices: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "value"],
        properties: { label: { type: "string" }, value: { type: "string" } },
      },
    },
  },
};
const ReplySchema = z.object({
  reply: z.string().trim().min(1),
  choices: z.array(z.object({ label: z.string().trim().min(1), value: z.string().trim().min(1) })),
});
const DraftInput = z.object({ intents: z.array(IntentSchema).max(4) }).strict();

function draftState(draft: Draft, receipt: ChatReceipt) {
  return {
    intents: draft.intents,
    status: receipt.status,
    proposal: receipt.proposal,
    pendingField: receipt.pendingField,
  };
}

function checkDraft(
  run: WorkspaceRun,
  intents: Intent[],
  conversationId: string,
  floor: string | null,
) {
  const result = evaluateIntents(run, intents, conversationId, floor);
  return {
    status: result.proposal ? "ready" : result.pendingField ? "needs_value" : "cannot_use",
    message: result.answer,
    missing: result.pendingField,
    proposal: result.proposal,
  };
}

async function askClaude(
  run: WorkspaceRun,
  receipt: ChatReceipt,
  draft: Draft,
  text: string,
  floor: string | null,
): Promise<{
  reply: string;
  choices: { label: string; value: string }[];
  intents: Intent[] | null;
  citations: Citation[];
}> {
  let intents: Intent[] | null = null;
  let citations: Citation[] = [];
  const transcript = receipt.turns.map((t) => ({
    role: t.role,
    text: t.text,
    ...(t.choices ? { offeredChoices: t.choices.map((c) => c.value) } : {}),
  }));
  const raw = await runStructured({
    system: `${SYSTEM}\n\nCompany context (JSON):\n${JSON.stringify(companyContext(run))}`,
    schema: REPLY_SCHEMA,
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          conversationSoFar: transcript,
          currentDraft: draftState(draft, receipt),
          selectedWeek: receipt.selectedWeek,
          selectedItemId: receipt.selectedItemId,
          // This what-if branches off the open scenario; nothing may start before it does.
          earliestAllowedStart: floor,
          newMessage: text,
        }),
      },
    ],
    tools: [
      {
        name: "answer_question",
        description:
          "Answer a factual question about the saved run. Send question intents only (topic low_point, week, item, rules or dominoes; weekText as the Monday YYYY-MM-DD, itemText as an exact record id). Returns Domino's answer and its sources. Does not change the draft.",
        input_schema: INTENTS_JSON_SCHEMA as never,
        run: (input) => {
          const asked = IntentsSchema.parse(input).intents;
          if (!asked.every((i) => i.kind === "question"))
            throw new Error("Only question intents here. Use update_draft for changes.");
          const outcome = resolve(run, asked, {
            questionId: receipt.conversationId,
            prompt: "question about the saved run",
            selectedWeek: receipt.selectedWeek,
            selectedItemId: receipt.selectedItemId,
          });
          citations = outcome.citations.slice(0, 12);
          return { answer: outcome.answer, sources: outcome.citations };
        },
      },
      {
        name: "update_draft",
        description:
          "Replace the whole draft with these changes (normalized values, null for unknown) and run Domino's checks. Returns ready, needs_value or cannot_use.",
        input_schema: INTENTS_JSON_SCHEMA as never,
        run: (input) => {
          const parsed = DraftInput.parse(input);
          intents = parsed.intents;
          return parsed.intents.length
            ? checkDraft(run, parsed.intents, receipt.conversationId, floor)
            : { status: "cleared", message: "The draft is empty." };
        },
      },
    ],
  });
  const reply = ReplySchema.parse(raw);
  return {
    reply: reply.reply.slice(0, 2000),
    choices: reply.choices.slice(0, MAX_CHOICES).map((c) => ({
      label: c.label.slice(0, 120),
      value: c.value.slice(0, 200),
    })),
    intents,
    citations,
  };
}

/** Same arguments and receipt as timeline/chat:send, answered by Claude when configured. */
export const send = action({
  args: {
    companyId: v.string(),
    conversationId: v.string(),
    requestId: v.string(),
    expectedRevision: v.number(),
    text: v.string(),
  },
  handler: async (ctx, args): Promise<ChatReceipt> => {
    if (!assistantConfig()) return ctx.runMutation(refs.grammarSend, args);
    const text = args.text.trim();
    if (!text || text.length > 1000)
      throw new ConvexError({ code: "INVALID_INPUT", message: "Use 1 to 1,000 characters." });
    const { receipt, draft, floor } = await ctx.runQuery(refs.state, {
      companyId: args.companyId,
      conversationId: args.conversationId,
    });
    const run = projectRun(
      await ctx.runQuery(workspaceGet, { companyId: args.companyId, runId: receipt.runId }),
      args.companyId,
      receipt.runId,
    );
    if (run === null || run === "invalid")
      throw new ConvexError({ code: "RUN_NOT_FOUND", message: "The saved run could not be read." });
    let answer: Awaited<ReturnType<typeof askClaude>>;
    try {
      answer = await askClaude(run, receipt, draft, text, floor);
    } catch (error) {
      if (error instanceof AssistantUnavailable) return ctx.runMutation(refs.grammarSend, args);
      // Raw provider errors can carry request text; only a short message is surfaced.
      throw new ConvexError({
        code: "ASSISTANT_FAILED",
        message: "Claude could not answer just now. Nothing was changed. Send your message again.",
      });
    }
    return ctx.runMutation(refs.save, {
      ...args,
      text: args.text,
      reply: answer.reply,
      choicesJson: JSON.stringify(answer.choices),
      citationsJson: JSON.stringify(answer.citations),
      intentsJson: answer.intents === null ? null : JSON.stringify(answer.intents),
    });
  },
});
