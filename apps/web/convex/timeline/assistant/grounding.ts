import type { Intent } from "../questions/intent";
import { meaningIssue } from "../questions/meaning";
import { findDateText } from "../questions/parse";
import { copiedFromPrompt } from "../questions/provider";

/** Validate the actual user wording, never a sentence manufactured from model slots. */
export function groundingIssue(prompt: string, intents: Intent[], selected: string[] = []) {
  if (
    /\b(not|never|don['’]?t|doesn['’]?t|do not|avoid|cancel|instead of|rather than|if|unless|except|excluding|including|provided|conditional|contingent|before|after|between|through|without|only|across|accounts?|discount|tax|percent|daily|intraday|every|each|monthly|recurring|per month|per week|maximum|max|at most|less than|below|under|until|starting|ending|or|either)\b/i.test(
      prompt.replace(/\s+/g, " ").replace(/\bwhat if\b/gi, " "),
    )
  )
    return "Negations, conditions, recurring events, ranges, daily or upper limits need clarification. State one unconditional event on an exact date, or a supported weekly minimum rule.";
  if (intents.some((i) => i.kind === "cash_change") && /\bweekly\b/i.test(prompt))
    return "Recurring cash events are unsupported. Give one payment or receipt on one exact date.";
  if (
    intents.some((i) => i.kind === "min_cash_rule" || i.kind === "runway_rule") &&
    findDateText(prompt)
  )
    return "Time-limited rules need clarification. State an unconditional weekly minimum rule.";
  if (!copiedFromPrompt(intents, prompt, selected))
    return "I could not verify every suggested value against your words. State the exact amount, date and counterparty, or the rule and its limit. Nothing was calculated.";
  return meaningIssue(prompt, intents);
}
