import { z } from "zod";
import type { WorkspaceRun } from "../questions/context";
import { INTENTS_JSON_SCHEMA, type Intent, IntentsSchema } from "../questions/intent";
import { type Outcome, resolve } from "../questions/resolve";
import { runStructured } from "./claude";
import { companyContext } from "./context";
import { groundingIssue } from "./grounding";

export const ASSISTANT_QUESTIONS_VERSION = "timeline_question_assistant@2";

const SYSTEM = `Classify one question about Domino's saved 13-week cash forecast.
Call check_request for the low point, a week, an item, rules, dominoes, or a supported scenario/rule proposal.
Every *Text field must copy the person's words exactly, or be null. Do not normalize or invent amounts, dates, names or counts. A selected week or item may be used only for references to that selection.
Negations, conditions, ranges, recurring events, daily floors, maximums and hiring budgets need clarification, never conversion to a simpler request.
Do not compute money or write financial narrative. The local resolver supplies the answer and citations. If this question is broader than supported evidence, use unclear.
Finish with JSON {"answer":"Checked"}; this text is not displayed.`;

const ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer"],
  properties: { answer: { type: "string" } },
};
const AnswerSchema = z.object({ answer: z.string().trim().min(1) }).strict();

/**
 * Claude extracts original user spans. Every visible answer, citation and proposal comes
 * from the fixed resolver. Free-form provider prose is never saved as financial evidence.
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
  const unsupported = groundingIssue(ask.prompt, []);
  if (unsupported) return { status: "clarification", answer: unsupported, citations: [] };
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
          "Classify the question into intents (exact user value spans, null for unknown) and get Domino's answer, citations and any proposal from the saved run.",
        input_schema: INTENTS_JSON_SCHEMA as never,
        run: (input) => {
          checked = null;
          const intents: Intent[] = IntentsSchema.parse(input).intents;
          const issue = groundingIssue(
            ask.prompt,
            intents,
            [ask.selectedWeek, ask.selectedItemId].filter(
              (value): value is string => value !== null,
            ),
          );
          checked = issue
            ? { status: "clarification", answer: issue, citations: [] }
            : resolve(run, intents, ask);
          return checked;
        },
      },
    ],
  });
  AnswerSchema.parse(raw);
  // Model prose is never evidence. Even a valid JSON answer cannot replace checked facts.
  return (
    checked ?? {
      status: "clarification",
      answer:
        "I could not verify an answer from this saved run. Ask about one week, item, cash low point, rule or supported scenario.",
      citations: [],
    }
  );
}
