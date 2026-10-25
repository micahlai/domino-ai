import type { Intent } from "../questions/intent";
import { meaningIssue } from "../questions/meaning";
import { findDateText } from "../questions/parse";
import { copiedFromPrompt } from "../questions/provider";

const QUALIFIER =
  /\b(not|never|don['’]?t|doesn['’]?t|do not|avoid|cancel|instead of|rather than|if|unless|except|excluding|including|provided|conditional|contingent|before|after|between|through|without|only|across|accounts?|discount|tax|percent|daily|intraday|every|each|monthly|recurring|per month|per week|maximum|max|at most|less than|below|under|until|starting|ending|or|either)\b/i;
/** Wording with a negation, condition, range or limit that a one-event draft cannot keep. */
export const hasQualifier = (text: string) =>
  QUALIFIER.test(text.replace(/\s+/g, " ").replace(/\bwhat if\b/gi, " "));

/** Validate the actual user wording, never a sentence manufactured from model slots. */
export function groundingIssue(prompt: string, intents: Intent[], selected: string[] = []) {
  if (hasQualifier(prompt))
    return "Negations, conditions, recurring events, ranges, daily or upper limits need clarification. State one unconditional event on an exact date, or a supported weekly minimum rule.";
  if (
    intents.some((i) => i.kind === "min_cash_rule" || i.kind === "runway_rule") &&
    findDateText(prompt)
  )
    return "Time-limited rules need clarification. State an unconditional weekly minimum rule.";
  if (!copiedFromPrompt(intents, prompt, selected))
    return "I could not verify every suggested value against your words. State the exact amount, date and counterparty, or the rule and its limit. Nothing was calculated.";
  return meaningIssue(prompt, intents);
}
