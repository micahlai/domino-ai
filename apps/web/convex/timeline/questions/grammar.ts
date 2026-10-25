import type { RecordRef } from "./context";
import { namedIn } from "./context";
import { type Intent, MAX_INTENTS } from "./intent";
import { MONTH_WORD, findDateText, findDaysText, findMoneyText, findMonthsText } from "./parse";

/**
 * Fixed question grammar (method "grammar"). Documented in questions.ts. It recognizes a
 * small set of plainly worded requests and returns null for anything else, so wording it
 * does not know is never guessed at. One clause per request part, split on "and", ";",
 * "." or a comma that is not part of a date.
 */
export const GRAMMAR_VERSION = "timeline_question_grammar@1";

const SCENARIO = /\b(what if|suppose|imagine|let'?s say|simulate|scenario|assume)\b/i;
const QUESTION_START =
  /^\s*(what|when|which|why|how|is|are|does|do|will|show|tell|where|explain)\b/i;
const DAILY = /\b(daily|every day|each day|any day|intraday|at all times|at any time)\b/i;
const HEADCOUNT = /\b(head ?count|hiring budget|hire|hires|hiring|new roles?|staffing budget)\b/i;
const CASH_WORD = /\b(cash|balance|buffer|bank)\b/i;
const FLOOR_WORD =
  /\b(keep|stay|stays|maintain|hold|never|don'?t let|do not let|at least|above|over|minimum|min|floor|below|under|drop)\b/i;
const LATE = /\b(late|delay(?:ed|s)?|slips?|slipped|overdue|later)\b/i;
const PAY_ON_TIME =
  /\b(on time|by (?:its|the) due date|by due date|within \d+ days|no later than \d+ days|no more than \d+ days late)\b/i;
const OUT =
  /\b(pay|pays|paying|spend|spending|expense|buy|purchase|cost|fee|wire|send|refund to)\b/i;
const IN = /\b(receive|collect|raise|get|inflow|deposit|grant|investment|loan of)\b/i;
const PAYROLL_CHANGE = /\b(payroll|salar(?:y|ies))\b/i;
const VAGUE_RULE = /\b(healthy|safe|comfortable|enough|reasonable|good)\b/i;

/** Split on clause words without breaking "Nov 18, 2026" or "$80,000". */
function clauses(prompt: string): string[] {
  return prompt
    .replace(/,(?!\s*\d)/g, " ; ")
    .split(/\s*(?:;|\.(?!\d)|\?|!|\band then\b|\band also\b|\band\b|\bplus\b)\s*/i)
    .map((c) => c.trim())
    .filter((c) => /[a-z0-9]/i.test(c));
}

/** "to Atlas Legal" -> "Atlas Legal": capitalized words after to/from, months excluded. */
function counterpartyIn(clause: string, word: "to" | "from"): string | null {
  const m = new RegExp(`\\b${word}\\s+((?:[A-Z][\\w&.'-]*)(?:\\s+[A-Z][\\w&.'-]*)*)`).exec(clause);
  if (!m?.[1]) return null;
  const parts = m[1].split(/\s+/);
  const cut = parts.findIndex((p) => MONTH_WORD.test(p));
  const name = (cut === -1 ? parts : parts.slice(0, cut)).join(" ").replace(/[.]$/, "");
  return name.length ? name : null;
}

function scenarioClause(clause: string, records: RecordRef[]): Intent | null {
  const named = namedIn(clause, records)[0] ?? null;
  if (DAILY.test(clause) && (CASH_WORD.test(clause) || FLOOR_WORD.test(clause)))
    return { kind: "unsupported", reason: "daily_cash_floor" };
  if (HEADCOUNT.test(clause)) return { kind: "unsupported", reason: "headcount_budget" };
  if (/\brunway\b/i.test(clause))
    return { kind: "runway_rule", monthsText: findMonthsText(clause) };
  if (PAY_ON_TIME.test(clause))
    return {
      kind: "pay_by_date_rule",
      itemText: named,
      daysText: /on time|due date/i.test(clause) ? null : findDaysText(clause),
    };
  if (LATE.test(clause) && !CASH_WORD.test(clause))
    return { kind: "late_invoice", itemText: named, daysText: findDaysText(clause) };
  if (CASH_WORD.test(clause) && FLOOR_WORD.test(clause)) {
    const amountText = findMoneyText(clause);
    if (!amountText && !VAGUE_RULE.test(clause) && !/\b(keep|maintain)\b/i.test(clause))
      return null;
    return { kind: "min_cash_rule", amountText };
  }
  if (PAYROLL_CHANGE.test(clause)) return { kind: "unsupported", reason: "other" };
  const direction = IN.test(clause) ? "in" : OUT.test(clause) ? "out" : null;
  if (direction)
    return {
      kind: "cash_change",
      direction,
      amountText: findMoneyText(clause),
      dateText: findDateText(clause),
      counterpartyText: counterpartyIn(clause, direction === "in" ? "from" : "to"),
    };
  return null;
}

function questionIntent(
  prompt: string,
  records: RecordRef[],
  selected: { week: boolean; item: boolean },
): Intent | null {
  const weekText = findDateText(prompt);
  const itemText = namedIn(prompt, records)[0] ?? null;
  if (/\b(lowest|low point|tightest|bottom|minimum cash|least cash)\b/i.test(prompt))
    return { kind: "question", topic: "low_point", weekText: null, itemText: null };
  if (/\b(rules?|limits?|breach(?:es|ed)?|lender)\b/i.test(prompt))
    return { kind: "question", topic: "rules", weekText: null, itemText: null };
  if (/\b(why|domino(?:es)?|chain|knock-?on)\b/i.test(prompt))
    return { kind: "question", topic: "dominoes", weekText: null, itemText: null };
  const aboutItem = /\b(when|due|status|paid|owed?|amount|about|details?)\b/i.test(prompt);
  if (itemText && aboutItem) return { kind: "question", topic: "item", weekText: null, itemText };
  if (weekText || (selected.week && /\b(week|this|then|that)\b/i.test(prompt)))
    return { kind: "question", topic: "week", weekText, itemText: null };
  if (selected.item && /\b(this|it|that|item)\b/i.test(prompt))
    return { kind: "question", topic: "item", weekText: null, itemText: null };
  return null;
}

/**
 * Intents for a prompt, or null when the grammar does not recognize every part of it.
 * A clause it can only half read (for example a rule with no amount) still returns an
 * intent with null words, so the resolver asks for exactly the missing piece.
 */
export function readWithGrammar(
  prompt: string,
  records: RecordRef[],
  selected: { week: boolean; item: boolean },
): Intent[] | null {
  const isScenario =
    SCENARIO.test(prompt) || (!QUESTION_START.test(prompt) && !prompt.trim().endsWith("?"));
  if (!isScenario) {
    const q = questionIntent(prompt, records, selected);
    return q ? [q] : null;
  }
  const parts = clauses(prompt.replace(SCENARIO, " "));
  if (parts.length === 0 || parts.length > MAX_INTENTS) return null;
  const intents: Intent[] = [];
  for (const part of parts) {
    const intent = scenarioClause(part, records);
    if (!intent) return null;
    intents.push(intent);
  }
  return intents;
}
