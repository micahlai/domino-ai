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
  if (hasQualifier(prompt)) return unsupportedReply(prompt);
  if (
    intents.some((i) => i.kind === "min_cash_rule" || i.kind === "runway_rule") &&
    findDateText(prompt)
  )
    return 'Cash rules apply to every week, so I could not add one with a date range. For example, "Keep at least $2,000,000 in cash" works.';
  if (!copiedFromPrompt(intents, prompt, selected))
    return "I could not verify every suggested value against your words. State the exact amount, date and counterparty, or the rule and its limit. Nothing was calculated.";
  return meaningIssue(prompt, intents);
}

/** One or two plain sentences, naming what could not be modeled, with one example that works. */
export function unsupportedReply(prompt: string): string {
  if (/%|\bpercent\b/i.test(prompt))
    return 'I need the dollar amount and date for a percentage change. For example, "Receive $40,000 from Marketing savings on 2026-11-17" works.';
  if (/\b(daily|intraday|every day|each day)\b/i.test(prompt))
    return 'Cash is checked at each weekly close, so I cannot hold a daily limit. For example, "Keep at least $3,000,000 in cash" works.';
  if (/\b(maximum|max|at most|less than|below|under)\b/i.test(prompt))
    return 'I can set a minimum cash level, not an upper limit or a cap. For example, "Keep at least $3,000,000 in cash" or "Pay $50,000 to Atlas Legal on Nov 17" works.';
  return 'I can model one change at a time on a specific date, so I could not run that one as written. For example, "Northwind pays its invoice 14 days late" or "Pay $250,000 for a roof repair on Nov 17" works.';
}
