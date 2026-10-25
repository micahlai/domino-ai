import { CASH_WORD, DAILY, FLOOR_WORD, HEADCOUNT, IN, OUT, SCENARIO, clauses } from "./grammar";
import type { Intent } from "./intent";
import {
  countTokens,
  dateTokens,
  findDateText,
  moneyTokens,
  parseDaysText,
  parseMoneyText,
  parseMonthsText,
} from "./parse";

/** Both intent readers pass this check. Unsupported qualifiers must never disappear. */
export function meaningIssue(prompt: string, intents: Intent[]): string | null {
  const dates = dateTokens(prompt);
  for (const intent of intents) {
    const date =
      intent.kind === "cash_change"
        ? intent.dateText
        : intent.kind === "question"
          ? intent.weekText
          : null;
    if (date !== null && dates.length && !dates.includes(date))
      return "Give the complete date, including its year. I cannot drop part of a date or replace an explicit date with the selected week.";
  }
  const proposals = intents.filter(
    (i) => i.kind !== "question" && i.kind !== "unsupported" && i.kind !== "unclear",
  );
  if (
    intents.some((i) => i.kind === "question") &&
    (SCENARIO.test(prompt) || /^\s*(?:do not|don['’]?t|never|avoid|cancel)\b/i.test(prompt))
  )
    return "You described a possible change. Please state the event, amount and date, or ask a factual question about the saved run.";
  if (!proposals.length) return null;
  if (DAILY.test(prompt) && (CASH_WORD.test(prompt) || FLOOR_WORD.test(prompt)))
    return 'Rules are checked on each week\'s closing usable cash, not day by day. Ask for a weekly minimum instead, for example "keep usable cash above $3M".';
  if (HEADCOUNT.test(prompt))
    return "Headcount and hiring budgets are not a supported rule. Supported rules: minimum usable cash, months of runway, or paying a bill on time.";
  if (
    /\b(not|never|don['’]?t|doesn['’]?t|do not|without|avoid|cancel|instead of|rather than)\b/i.test(
      prompt,
    )
  )
    return "I need clarification of the negation or exception before proposing a change. State the event or minimum rule you want to add.";
  const amounts = moneyTokens(prompt);
  const counts = countTokens(prompt);
  if (amounts.some((s) => parseMoneyText(s) === null))
    return "I could not read the complete exact amount in positive cents. Use a value such as $80,000; signed or malformed amounts need clarification.";
  const parts = clauses(prompt.replace(SCENARIO, " "));
  const unassignedAmounts = [...amounts];
  for (const i of proposals) {
    if ((i.kind === "cash_change" || i.kind === "min_cash_rule") && i.amountText !== null) {
      const index = unassignedAmounts.indexOf(i.amountText);
      if (index === -1)
        return "Please state each amount once with the event or rule it belongs to.";
      unassignedAmounts.splice(index, 1);
      const scope = parts.find((part) => {
        if (!moneyTokens(part).includes(i.amountText ?? "")) return false;
        if (i.kind === "min_cash_rule")
          return /\busable\s+cash\b/i.test(part) && FLOOR_WORD.test(part);
        return (
          (i.dateText === null || dateTokens(part).includes(i.dateText)) &&
          (i.counterpartyText === null || part.includes(i.counterpartyText))
        );
      });
      if (!scope || moneyTokens(scope).length !== 1)
        return "Please separate each event and rule into its own sentence, with one amount per sentence. I cannot safely match these amounts to the requested changes.";
      if (i.kind === "cash_change") {
        if ((IN.test(scope) && OUT.test(scope)) || !(i.direction === "in" ? IN : OUT).test(scope))
          return "Please separate money received and money paid into distinct events. I cannot safely match each amount to its direction.";
        const date = findDateText(scope);
        if (date && findDateText(scope.replace(date, " ")))
          return "Please state one date for each cash event; I cannot choose between multiple dates.";
      }
    }
  }
  if (unassignedAmounts.length)
    return "I could not match every amount to a supported event or rule. Please state each event or rule in its own sentence; clarify fees and extra amounts before proceeding.";
  const unassignedCounts = [...counts];
  for (const i of proposals) {
    const word =
      i.kind === "runway_rule"
        ? i.monthsText
        : i.kind === "late_invoice" || i.kind === "pay_by_date_rule"
          ? i.daysText
          : null;
    if (word === null) continue;
    const index = unassignedCounts.indexOf(word);
    if (index === -1)
      return "Please state each delay or runway count once with the event or rule it belongs to.";
    unassignedCounts.splice(index, 1);
    const scope = parts.find((part) => {
      if (!countTokens(part).includes(word)) return false;
      if (i.kind === "runway_rule") return /\brunway\b/i.test(part);
      return (
        (i.kind === "late_invoice" || i.kind === "pay_by_date_rule") &&
        (i.itemText === null || part.includes(i.itemText))
      );
    });
    if (!scope || countTokens(scope).length !== 1)
      return "Please separate each timing change or runway rule into its own sentence, naming its item and one day, week or month count. I cannot safely match these counts to the requested changes.";
  }
  if (unassignedCounts.length)
    return "I could not match every day, week or month count to a supported event or rule. Please state each timing change or runway rule in its own sentence.";
  for (const i of proposals) {
    if (i.kind === "late_invoice" || i.kind === "pay_by_date_rule") {
      if (counts.some((s) => /(?:days?|weeks?)$/i.test(s) && parseDaysText(s) === null))
        return "Use a whole number of days or weeks; fractional or signed delays need clarification.";
      if (i.daysText !== null && !counts.includes(i.daysText))
        return "Please state the complete number of days or weeks; I cannot use part of a number.";
    }
    if (i.kind === "runway_rule") {
      if (/\b(below|under|less than|at most|maximum)\b/i.test(prompt))
        return "Only minimum runway rules are supported. Did you mean a minimum number of months?";
      if (counts.some((s) => /months?$/i.test(s) && parseMonthsText(s) === null))
        return "Please give an exact positive number of months of runway.";
      if (i.monthsText !== null && !counts.includes(i.monthsText))
        return "Please state the complete number of months; I cannot use part of a number.";
    }
    if (i.kind === "min_cash_rule") {
      // Do not silently choose usable cash when the person said only cash or total cash.
      if (!/\busable\s+cash\b/i.test(prompt))
        return "Which cash basis do you mean? Give the minimum usable cash amount; total cash rules are not supported here.";
      if (/\b(below|under|less than|at most|maximum)\b/i.test(prompt))
        return "Only a minimum usable cash rule is supported. An upper cash limit cannot be changed into a minimum. Please clarify.";
      if (!/\b(above|over|at least|minimum|min|floor)\b/i.test(prompt) && i.amountText !== null)
        return "Did you mean a minimum usable cash rule? State the minimum amount explicitly.";
    }
    if (
      (i.kind === "cash_change" || i.kind === "min_cash_rule") &&
      i.amountText !== null &&
      !amounts.includes(i.amountText)
    )
      return "Please state the complete amount; I cannot use part of a signed or malformed number.";
    if (i.kind === "cash_change") {
      const incoming =
        /\b(receive|collect|raise|get|inflow|deposit|grant|investment|loan of)\b/i.test(prompt);
      const outgoing =
        /\b(pay|pays|paying|payment|spend|spending|expense|buy|purchase|cost|fee|wire|send|refund to)\b/i.test(
          prompt,
        );
      if ((i.direction === "in" && !incoming) || (i.direction === "out" && !outgoing))
        return "Please clarify whether this event receives cash or pays cash. I cannot reverse its direction.";
    }
    if (i.kind === "cash_change" && /\b(existing|already scheduled|bill|invoice)\b/i.test(prompt))
      return "Is this a new payment or a change to an existing bill or invoice? I cannot add a second cash event for an existing record. Name the record and the timing change.";
  }
  return null;
}
