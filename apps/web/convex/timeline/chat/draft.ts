import { BOUNDARY_INTEGER_MAX, canonicalJson } from "@domino/contracts";
import { z } from "zod";
import { type WorkspaceRun, matchRecords, recordsOf } from "../questions/context";
import { IN, OUT, SCENARIO, clauses, readWithGrammar } from "../questions/grammar";
import { type Intent, IntentSchema } from "../questions/intent";
import { meaningIssue } from "../questions/meaning";
import {
  addDays,
  findDateText,
  parseDateText,
  parseDaysText,
  parseMoneyText,
  parseMonthsText,
} from "../questions/parse";
import type { QuestionProposal } from "../questions/receipt";
import { resolve } from "../questions/resolve";
import { startsBefore } from "../scenarioStart";
import { checkChanges, checkConstraints, checkMoneyBound, reject } from "../workspaceInput";

const FieldSchema = z.enum([
  "amountText",
  "dateText",
  "counterpartyText",
  "itemText",
  "daysText",
  "monthsText",
]);
type Field = z.infer<typeof FieldSchema>;
export const DraftSchema = z
  .object({
    intents: z.array(IntentSchema).max(4),
    pending: z
      .object({ index: z.number().int().min(0).max(3), field: FieldSchema })
      .strict()
      .nullable(),
  })
  .strict();
export type Draft = z.infer<typeof DraftSchema>;
export const emptyDraft = (): Draft => ({ intents: [], pending: null });
export type Result = {
  draft: Draft;
  answer: string;
  proposal: QuestionProposal | null;
  pendingField: string | null;
};
const intro =
  "Describe a one-time payment or receipt, a late invoice, or a rule for minimum usable cash, runway, or a bill deadline. I will ask for missing details. Nothing runs until you review and save.";
export const GREETING = intro;
const fieldWords: Record<Field, string> = {
  amountText: "amount",
  dateText: "date",
  counterpartyText: "counterparty",
  itemText: "record",
  daysText: "late days",
  monthsText: "months of runway",
};
function fields(i: Intent): Field[] {
  switch (i.kind) {
    case "cash_change":
      return ["amountText", "dateText", "counterpartyText"];
    case "late_invoice":
      return ["itemText", "daysText"];
    case "min_cash_rule":
      return ["amountText"];
    case "runway_rule":
      return ["monthsText"];
    case "pay_by_date_rule":
      return ["itemText", "daysText"];
    default:
      return [];
  }
}
function value(i: Intent, field: Field): string | null {
  return field in i ? (i as unknown as Record<Field, string | null>)[field] : null;
}
function set(i: Intent, field: Field, word: string | null): Intent {
  return IntentSchema.parse({ ...i, [field]: word });
}
function question(i: Intent, field: Field): string {
  switch (field) {
    case "amountText":
      return i.kind === "min_cash_rule"
        ? "What minimum usable cash amount should the rule require? For example, $3M."
        : "What is the exact amount? For example, $80,000.";
    case "dateText":
      return "On what date should this event happen? Use a date such as 2026-11-17.";
    case "counterpartyText":
      return i.kind === "cash_change" && i.direction === "in"
        ? "Who does the cash come from? Give one counterparty name."
        : "Who is paid? Give one counterparty name, such as Atlas Legal.";
    case "itemText":
      return i.kind === "late_invoice"
        ? "Which open invoice? Give the customer name or exact invoice id."
        : "Which unpaid bill should this deadline rule apply to? Give the vendor or exact bill id.";
    case "daysText":
      return i.kind === "pay_by_date_rule"
        ? "How many late days may this bill allow? Use 0 days for on time, or up to 180 days."
        : "How many days late? Use a whole count from 1 to 180 days, such as 14 days.";
    case "monthsText":
      return "How many months of runway should the rule require? Use 1 to 120 months, such as 4.5 months.";
  }
}

/** Validate one typed slot. A short reply is never reparsed as an unrelated financial intent. */
function fieldIssue(run: WorkspaceRun, i: Intent, field: Field, word: string): string | null {
  if (!word.trim() || word.length > 200) return "Use a value of at most 200 characters.";
  if (field === "amountText") {
    const cents = parseMoneyText(word);
    return cents === null ||
      cents > BOUNDARY_INTEGER_MAX ||
      cents < (i.kind === "cash_change" ? 1 : 0)
      ? "Use one exact, unsigned amount in safe integer cents, such as $3M or $80,000. Fractional cents and multiple amounts need clarification."
      : null;
  }
  if (field === "dateText") {
    const first = run.forecast.weeks[0]?.weekStart ?? "";
    const end = addDays(run.forecast.weeks[12]?.weekStart ?? "", 6);
    const date = parseDateText(word, first);
    return !date || date < first || date > end
      ? `Choose one real date within the saved forecast, ${first} through ${end}.`
      : null;
  }
  if (field === "daysText") {
    const n = parseDaysText(word);
    return n === null || n < (i.kind === "late_invoice" ? 1 : 0) || n > 180
      ? question(i, field)
      : null;
  }
  if (field === "monthsText") {
    const n = parseMonthsText(word);
    return n === null || n < 1 || n > 120 ? question(i, field) : null;
  }
  if (field === "itemText") {
    const kind = i.kind === "late_invoice" ? "invoice" : "bill";
    const hits = matchRecords(
      word,
      recordsOf(run).filter((r) => r.kind === kind),
    );
    if (hits.length !== 1)
      return hits.length
        ? `That matches ${hits.length} ${kind}s. Give one exact ${kind} id.`
        : `I could not find one open ${kind} named "${word}". Give its exact id or counterparty name.`;
    if (hits[0]?.paid)
      return `That ${kind} is already paid. Observed history cannot change. Name an unpaid ${kind}.`;
    return null;
  }
  // A name can be new, but financial instructions or alternatives are not a single name.
  return !/^[\p{L}\p{N}][\p{L}\p{N} &'’.()_-]*$/u.test(word) ||
    /\b(or|and|instead|change|pay|receive|minimum|scenario|ignore|instructions)\b/i.test(word) ||
    /\d/.test(word)
    ? "Give just one counterparty name. To change the event or its direction, choose Start over."
    : null;
}

/** Build a statement from typed slots, not transcript concatenation. All values are retained
 * user words; fixed connective words only allow the existing resolver's meaning guard to run. */
export function statement(i: Intent): string {
  switch (i.kind) {
    case "cash_change":
      return `${i.direction === "in" ? "receive" : "pay"} ${i.amountText} ${i.direction === "in" ? "from" : "to"} ${i.counterpartyText} on ${i.dateText}`;
    case "late_invoice":
      return `${i.itemText} pays ${i.daysText} late`;
    case "min_cash_rule":
      return `keep usable cash above ${i.amountText}`;
    case "runway_rule":
      return `keep at least ${i.monthsText} of runway`;
    case "pay_by_date_rule":
      return `pay ${i.itemText} within ${i.daysText}`;
    default:
      return "";
  }
}
export function validateProposal(run: WorkspaceRun, proposal: QuestionProposal) {
  const snapshot = run.baseline.seed.snapshot;
  const rules = proposal.constraints ?? run.constraints;
  if (
    proposal.constraints &&
    !run.constraints.every((old) => rules.some((r) => canonicalJson(r) === canonicalJson(old)))
  )
    reject("CHAT_INTEGRITY", "The proposal changed an existing rule. Start a new chat.");
  checkConstraints(rules, snapshot);
  checkChanges([...run.changes, ...proposal.changes], snapshot, {
    asOf: snapshot.asOf,
    firstWeek: run.forecast.weeks[0]?.weekStart ?? "",
    end: addDays(run.forecast.weeks[12]?.weekStart ?? "", 6),
  });
  checkMoneyBound(snapshot, run.baseline.model, rules, [...run.changes, ...proposal.changes]);
}
/** Cash schedules key events by label. Distinguish each new payment without
 * relabeling ancestor events or changing any financial input. */
function distinctCashLabels(run: WorkspaceRun, proposal: QuestionProposal): QuestionProposal {
  const used = new Set(run.changes.flatMap((change) => ("label" in change ? [change.label] : [])));
  const changes = proposal.changes.map((change) => {
    if (change.kind !== "add_cash" && change.kind !== "remove_cash") {
      if ("label" in change) used.add(change.label);
      return change;
    }
    let label = change.label;
    for (let ordinal = 1; used.has(label); ordinal++) {
      const suffix = ` (${change.date}${ordinal > 1 ? ` #${ordinal}` : ""})`;
      label = `${change.label.slice(0, 200 - suffix.length)}${suffix}`;
    }
    used.add(label);
    return { ...change, label };
  });
  return { ...proposal, changes };
}
/**
 * Check a whole draft that Claude wrote (normalized slot values) with the same field
 * validation and resolver as the fixed grammar, so proposals are identical either way.
 */
export function evaluateIntents(
  run: WorkspaceRun,
  intents: Intent[],
  conversationId: string,
  floor: string | null = null,
): Result {
  return finish(run, DraftSchema.parse({ intents, pending: null }), conversationId, floor);
}
function finish(
  run: WorkspaceRun,
  draft: Draft,
  conversationId: string,
  floor: string | null,
): Result {
  for (const [index, intent] of draft.intents.entries()) {
    for (const field of fields(intent)) {
      const word = value(intent, field);
      const issue = word === null ? null : fieldIssue(run, intent, field, word);
      if (word === null || issue) {
        draft.intents[index] = set(intent, field, null);
        draft.pending = { index, field };
        return {
          draft,
          answer: issue ?? question(intent, field),
          proposal: null,
          pendingField: fieldWords[field],
        };
      }
    }
  }
  const prompt = draft.intents.map(statement).join("; ");
  const outcome = resolve(run, draft.intents, {
    questionId: conversationId,
    prompt,
    selectedWeek: null,
    selectedItemId: null,
  });
  draft.pending = null;
  if (outcome.status !== "proposal" || !outcome.proposal)
    return {
      draft,
      answer: `${outcome.answer} Choose Start over to revise this request.`,
      proposal: null,
      pendingField: null,
    };
  const proposal = distinctCashLabels(run, outcome.proposal);
  // A branch forks from its parent's start; an earlier event would fork from the base.
  const early = startsBefore(proposal.changes, run.baseline.seed.snapshot, floor)[0];
  if (early)
    return {
      draft,
      answer: `This what-if builds on a scenario that starts ${floor}, but this change starts ${early.date}. Choose a date on or after ${floor}, or start from an earlier scenario.`,
      proposal: null,
      pendingField: null,
    };
  try {
    validateProposal(run, proposal);
  } catch {
    return {
      draft,
      answer:
        "These values cannot form a supported change to this saved run. Choose Start over and describe another event or rule. Nothing was calculated.",
      proposal: null,
      pendingField: null,
    };
  }
  return {
    draft,
    answer:
      "Here is the complete proposal. Review the event details and full rule set, then confirm to save and calculate. Nothing has run yet.",
    proposal,
    pendingField: null,
  };
}

const correctionFields: Record<string, Field> = {
  amount: "amountText",
  date: "dateText",
  counterparty: "counterpartyText",
  invoice: "itemText",
  bill: "itemText",
  days: "daysText",
  months: "monthsText",
};
export function advance(
  run: WorkspaceRun,
  previous: Draft,
  text: string,
  conversationId: string,
  selectedItemId: string | null,
  floor: string | null = null,
): Result {
  const draft = DraftSchema.parse(previous);
  // The fixed grammar only models unconditional events on one exact date. Keep
  // conditions and relative timing visible instead of discarding their meaning.
  if (
    /\b(if|unless|except|excluding|including|provided|conditional|contingent|before|after|between|through|with|without|in|for|only|across|account|accounts|discount|tax|percent)\b/i.test(
      text.replace(SCENARIO, " "),
    )
  )
    return {
      draft,
      answer:
        "Conditions, exceptions, date ranges and relative dates are unsupported. The draft is unchanged. Give just the requested value, or describe an unconditional event on one exact date or a supported weekly rule.",
      proposal: null,
      pendingField: draft.pending ? fieldWords[draft.pending.field] : null,
    };
  const correction = /^change (amount|date|counterparty|invoice|bill|days|months) to (.+)$/i.exec(
    text.trim(),
  );
  if (correction && draft.intents.length) {
    const field = correctionFields[correction[1]?.toLowerCase() ?? ""] as Field;
    const matches = draft.intents
      .map((i, n) => (fields(i).includes(field) ? n : -1))
      .filter((n) => n >= 0);
    if (matches.length !== 1)
      return {
        draft,
        answer:
          "That field belongs to more than one request, or none. Choose Start over and describe the corrected requests together.",
        proposal: null,
        pendingField: draft.pending ? fieldWords[draft.pending.field] : null,
      };
    draft.pending = { index: matches[0] as number, field };
    const intent = draft.intents[draft.pending.index] as Intent;
    draft.intents[draft.pending.index] = set(intent, field, null);
    return fill(run, draft, correction[2] ?? "", conversationId, floor);
  }
  if (draft.pending) return fill(run, draft, text, conversationId, floor);
  if (draft.intents.length)
    return {
      draft,
      answer:
        "This draft is already complete. Review and save it, or use Start over before describing a different request. To correct one field, say “change amount to $80,000”, “change date to 2026-11-17”, or “change days to 14 days”.",
      proposal: null,
      pendingField: null,
    };
  const records = recordsOf(run);
  const parsed = readWithGrammar(text, records, { week: false, item: selectedItemId !== null });
  if (!parsed || parsed.some((i) => i.kind === "question" || i.kind === "unclear"))
    return {
      draft,
      answer: `I could not safely read every part of that request. ${intro}`,
      proposal: null,
      pendingField: null,
    };
  const temporalRule = parsed.some(
    (i, n) =>
      ["min_cash_rule", "runway_rule"].includes(i.kind) &&
      (findDateText(clauses(text)[n] ?? text) !== null ||
        /\b(until|starting|ending|after|before|from|during|only|except|by)\b/i.test(
          clauses(text)[n] ?? text,
        )),
  );
  if (temporalRule)
    return {
      draft,
      answer:
        "Time-limited rules are not supported. State an unconditional weekly rule, or choose Start over to describe a different request.",
      proposal: null,
      pendingField: null,
    };
  const unsupported = parsed.some((i) => i.kind === "unsupported");
  const issue = meaningIssue(text, parsed);
  const parts = clauses(text);
  const ambiguous =
    /\b(or|either|every|each|monthly|weekly|recurring|per month|per week)\b/i.test(text) ||
    parsed.some((i, n) => {
      const part = parts[n] ?? text;
      const date = findDateText(part);
      return (
        i.kind === "cash_change" &&
        ((IN.test(part) && OUT.test(part)) ||
          (date !== null && findDateText(part.replace(date, " ")) !== null))
      );
    });
  if (ambiguous)
    return {
      draft,
      answer:
        "I need one exact date, direction and value for each one-time event. Alternatives and recurring events need clarification. Describe each supported request separately, with no alternatives.",
      proposal: null,
      pendingField: null,
    };
  if (unsupported || issue) {
    const answer =
      issue ??
      resolve(run, parsed, {
        questionId: conversationId,
        prompt: text,
        selectedWeek: null,
        selectedItemId: null,
      }).answer;
    return { draft, answer, proposal: null, pendingField: null };
  }
  draft.intents = parsed.map((parsedIntent, index) => {
    let i = parsedIntent;
    if (
      (i.kind === "late_invoice" || i.kind === "pay_by_date_rule") &&
      !i.itemText &&
      selectedItemId
    )
      i = { ...i, itemText: selectedItemId };
    if (
      i.kind === "pay_by_date_rule" &&
      !i.daysText &&
      /on time|due date/i.test(clauses(text)[index] ?? "")
    )
      i = { ...i, daysText: "0 days" };
    return i;
  });
  return finish(run, draft, conversationId, floor);
}
function fill(
  run: WorkspaceRun,
  draft: Draft,
  text: string,
  conversationId: string,
  floor: string | null,
): Result {
  const pending = draft.pending;
  if (!pending) throw new Error("Missing typed pending field");
  const intent = draft.intents[pending.index];
  if (!intent || !fields(intent).includes(pending.field))
    reject("CHAT_INTEGRITY", "Invalid pending draft");
  const word =
    pending.field === "dateText"
      ? text.trim().replace(/^on\s+/i, "")
      : pending.field === "counterpartyText"
        ? text.trim().replace(/^(?:to|from)\s+/i, "")
        : text.trim();
  const issue = fieldIssue(run, intent, pending.field, word);
  if (issue)
    return { draft, answer: issue, proposal: null, pendingField: fieldWords[pending.field] };
  draft.intents[pending.index] = set(intent, pending.field, word);
  draft.pending = null;
  return finish(run, draft, conversationId, floor);
}
