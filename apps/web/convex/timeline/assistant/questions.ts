import { z } from "zod";
import { statement } from "../chat/draft";
import type { WorkspaceRun } from "../questions/context";
import { INTENTS_JSON_SCHEMA, type Intent, IntentsSchema } from "../questions/intent";
import { type Outcome, resolve } from "../questions/resolve";
import { runStructured } from "./claude";
import { companyContext } from "./context";

export const ASSISTANT_QUESTIONS_VERSION = "timeline_question_assistant@1";

const SYSTEM = `You are Domino, an FP&A analyst answering one question about a company's saved 13-week cash forecast.

Use the company context: forecast weeks, cash low point, open invoices and bills, rules (lender's limits, runway, bill deadlines), rule checks, dominoes (the chain of problems a risk causes), past events and scenario changes. Quote numbers only from that context or from check_request results. Never add, subtract, net or project money yourself.

When the question is about the low point, a week, an item, the rules or the dominoes, or asks "what if" for a supported change, call check_request first. Supported changes:
- cash_change: one-time payment out or receipt in, one date, one counterparty.
- late_invoice: an open invoice paid N days late.
- min_cash_rule, runway_rule, pay_by_date_rule: new rules.
Normalize values: amountText like "$50,000" (a bare number means dollars), dateText "YYYY-MM-DD" inside the forecast window, counterpartyText a capitalized name with letters only, itemText the exact invoice or bill id, weekText the Monday "YYYY-MM-DD" of the week, daysText like "14 days", monthsText like "4.5 months". Use null for anything not given. Never invent values.

check_request returns Domino's own answer, citations and, for a change, a proposal the person can confirm. Base your answer on it: keep its facts, explain them clearly, and if it is a proposal tell the person to review and confirm it to calculate. If the question is broader (why, compare, explain), answer from the context directly.

Plain words, short sentences, no jargon ("lender's limit", not "covenant"). Under 150 words. Reply with JSON only, matching the schema.`;

const ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer"],
  properties: { answer: { type: "string" } },
};
const AnswerSchema = z.object({ answer: z.string().trim().min(1) });

/**
 * Claude reads the question with company context and writes the answer text. Status,
 * citations and any proposal come only from the fixed resolver for the last intents Claude
 * checked, so a proposal is the same one the grammar path would build.
 */
export async function answerWithAssistant(
  run: WorkspaceRun,
  ask: {
    questionId: string;
    prompt: string;
    selectedWeek: string | null;
    selectedItemId: string | null;
  },
): Promise<Outcome> {
  let checked: Outcome | null = null;
  const raw = await runStructured({
    system: `${SYSTEM}\n\nCompany context (JSON):\n${JSON.stringify(companyContext(run))}`,
    schema: ANSWER_SCHEMA,
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          question: ask.prompt,
          selectedWeek: ask.selectedWeek,
          selectedItemId: ask.selectedItemId,
        }),
      },
    ],
    tools: [
      {
        name: "check_request",
        description:
          "Classify the question into intents (normalized values, null for unknown) and get Domino's answer, citations and any proposal from the saved run.",
        input_schema: INTENTS_JSON_SCHEMA as never,
        run: (input) => {
          const intents: Intent[] = IntentsSchema.parse(input).intents;
          // The meaning guard compares slots with the wording, so resolve against a
          // statement built from Claude's normalized slots (as Timeline chat does).
          const built = intents.map(statement).filter(Boolean).join("; ");
          checked = resolve(run, intents, {
            ...ask,
            prompt: built || "question about the saved run",
          });
          return checked;
        },
      },
    ],
  });
  const answer = AnswerSchema.parse(raw).answer.slice(0, 2000);
  const outcome = checked as Outcome | null;
  if (!outcome) return { status: "answered", answer, citations: [] };
  return { ...outcome, answer };
}
