import { z } from "zod";
import { hasQualifier } from "../assistant/grounding";
import { type WorkspaceRun, recordsOf } from "../questions/context";
import { IN, OUT } from "../questions/grammar";
import { type Intent, IntentSchema } from "../questions/intent";
import { countTokens, dateTokens, moneyTokens, parseMoneyText } from "../questions/parse";
import { type Citation, resolve } from "../questions/resolve";
import { type Draft, type Result, emptyDraft, evaluateIntents, plannedChange } from "./draft";
import type { ChatReceipt } from "./receipt";

/**
 * Pure checks for one conversational turn. Claude writes every visible reply; these functions
 * decide which draft values may enter a reviewable proposal and which amounts a reply may quote.
 */
export const REPLY_MAX = 1500;
const Words = z.string().min(1).max(200).nullable();
export const LookupSchema = z
  .object({
    topic: z.enum(["low_point", "week", "item", "rules", "dominoes"]),
    weekText: Words,
    itemText: Words,
  })
  .strict();
export const DraftUpdateSchema = z
  .object({ request: z.string().max(500), intents: z.array(IntentSchema).max(4) })
  .strict();
export type DraftUpdate = z.infer<typeof DraftUpdateSchema>;
/** What the action hands to the save mutation. The mutation re-checks all of it. */
export const TurnPlanSchema = z
  .object({
    reply: z.string().trim().min(1).max(REPLY_MAX),
    draft: DraftUpdateSchema.nullable(),
    questions: z.array(LookupSchema).max(8),
    recordIds: z.array(z.string().min(1).max(240)).max(24),
    planText: z.string().min(1).max(1000).nullable().optional(),
  })
  .strict();
export type TurnPlan = z.infer<typeof TurnPlanSchema>;

/** A Start over marks where the active request begins. Older rows recorded it only as text. */
export function segmentStartOf(turns: ChatReceipt["turns"], saved: number | undefined): number {
  if (saved !== undefined) return saved;
  for (let i = turns.length - 1; i >= 0; i--)
    if (turns[i]?.role === "assistant" && turns[i]?.text.startsWith("Started over.")) return i;
  return 0;
}
export type UserTurn = { turn: number; text: string };
/** Messages the person sent since the last Start over, including the new one. */
export function activeUserTurns(
  receipt: ChatReceipt,
  segmentStart: number,
  newText: string,
): UserTurn[] {
  const turns = receipt.turns
    .map((t, turn) => ({ turn, role: t.role, text: t.text }))
    .filter((t) => t.turn >= segmentStart && t.role === "user")
    .map(({ turn, text }) => ({ turn, text }));
  return [...turns, { turn: receipt.turns.length, text: newText }];
}

type Field =
  | "amountText"
  | "dateText"
  | "counterpartyText"
  | "itemText"
  | "daysText"
  | "monthsText";
function slots(i: Intent): [Field, string][] {
  const all = Object.entries(i).filter(
    ([key, value]) => key.endsWith("Text") && typeof value === "string",
  );
  return all as [Field, string][];
}
const complete = (word: string, text: string) => {
  for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1))
    if (!/\w/.test(text[at - 1] ?? "") && !/\w/.test(text[at + word.length] ?? "")) return true;
  return false;
};
/** Whole numeric and date phrases only: "$80" cannot be taken from "$800" or "-$80". */
function typedIn(field: Field, word: string, text: string): boolean {
  if (field === "amountText") return moneyTokens(text).includes(word);
  if (field === "dateText") return dateTokens(text).includes(word);
  if (field === "daysText" || field === "monthsText") return countTokens(text).includes(word);
  return complete(word, text);
}
export type Provenance = { change: number; field: string; value: string; from: string };
const quote = (text: string) =>
  `your message "${text.length > 80 ? `${text.slice(0, 77)}...` : text}"`;

/**
 * Check one proposed replacement draft. Every value must be typed by the person in an active
 * message or kept unchanged from the current checked draft; the existing resolver then
 * validates the plain restatement. Rejections clear the draft so no stale proposal survives.
 */
export function checkDraft(
  run: WorkspaceRun,
  update: DraftUpdate,
  s: {
    draft: Draft;
    userTurns: UserTurn[];
    selectedItemId: string | null;
    conversationId: string;
    floor: string | null;
  },
): { result: Result; provenance: Provenance[] } {
  const rejected = (answer: string) => ({
    result: { draft: emptyDraft(), answer, proposal: null, pendingField: null },
    provenance: [],
  });
  if (!update.intents.length) return rejected("The draft is cleared. Nothing will be calculated.");
  if (update.intents.some((i) => ["question", "unsupported", "unclear"].includes(i.kind)))
    return rejected(
      "A draft holds only changes Domino can calculate: a one-time payment or receipt, a late invoice, or a minimum cash, runway or bill deadline rule. Nothing was drafted.",
    );
  const latest = s.userTurns.at(-1)?.text ?? "";
  const cash = update.intents.filter((i) => i.kind === "cash_change");
  if (
    cash.length === 1 &&
    ((IN.test(latest) && !OUT.test(latest) && cash[0]?.direction !== "in") ||
      (OUT.test(latest) && !IN.test(latest) && cash[0]?.direction !== "out"))
  )
    return rejected(
      "The draft did not keep the cash direction in your latest message. Please clarify whether this is paid or received. Nothing was drafted.",
    );
  const supplied = update.intents.flatMap((i) => slots(i).map(([, word]) => word));
  if (
    [...moneyTokens(latest), ...dateTokens(latest), ...countTokens(latest)].some(
      (word) => !supplied.includes(word),
    )
  )
    return rejected(
      "The draft did not keep every new amount or date you supplied. Please clarify the intended change. Nothing was drafted.",
    );
  const provenance: Provenance[] = [];
  const evidence = new Set<string>([s.userTurns.at(-1)?.text ?? ""]);
  for (const [change, intent] of update.intents.entries()) {
    const prior = s.draft.intents[change];
    const own: string[] = [];
    for (const [field, value] of slots(intent)) {
      const kept =
        prior?.kind === intent.kind && (prior as Record<string, unknown>)[field] === value;
      if (kept) {
        provenance.push({ change, field, value, from: "the current draft" });
        continue;
      }
      if (field === "itemText" && value === s.selectedItemId) {
        provenance.push({ change, field, value, from: "the selected item" });
        continue;
      }
      const hit = [...s.userTurns].reverse().find((t) => typedIn(field, value, t.text));
      if (!hit)
        return rejected(
          `"${value}" does not appear as typed in your messages since the last Start over. Please state it. Nothing was drafted.`,
        );
      own.push(hit.text);
      evidence.add(hit.text);
      provenance.push({ change, field, value, from: quote(hit.text) });
    }
    // The direction of cash must be the person's words, never a model assumption.
    if (
      intent.kind === "cash_change" &&
      !(prior?.kind === "cash_change" && prior.direction === intent.direction) &&
      ![s.userTurns.at(-1)?.text ?? "", ...own].some((t) =>
        (intent.direction === "in" ? IN : OUT).test(t),
      )
    )
      return rejected(
        "Your messages do not say whether this cash is paid out or received, or whether it moves cash at all. Please say which. Nothing was drafted.",
      );
  }
  if ([...evidence].some(hasQualifier))
    return rejected(
      "That wording includes a condition, negation, range, recurrence or limit that a calculated draft cannot keep. Please state one unconditional event or minimum rule. Nothing was drafted.",
    );
  const result = evaluateIntents(
    run,
    update.intents,
    s.conversationId,
    update.request,
    s.selectedItemId,
    s.floor,
  );
  return { result, provenance };
}

/** Checked sources for the answers and records a reply relied on. */
export function citationsFor(
  run: WorkspaceRun,
  plan: Pick<TurnPlan, "questions" | "recordIds">,
  ask: { conversationId: string; selectedWeek: string | null; selectedItemId: string | null },
): Citation[] {
  const out: Citation[] = [];
  for (const q of plan.questions)
    out.push(
      ...resolve(run, [{ kind: "question", ...q }], {
        questionId: ask.conversationId,
        prompt: "",
        selectedWeek: ask.selectedWeek,
        selectedItemId: ask.selectedItemId,
      }).citations,
    );
  for (const r of recordsOf(run))
    if (plan.recordIds.includes(r.id))
      out.push({
        ref: `record:${r.kind}/${r.id}`,
        label: `${r.name} ${r.kind} ${r.id}`.slice(0, 200),
      });
  const seen = new Set<string>();
  return out.filter((c) => !seen.has(c.ref) && seen.add(c.ref)).slice(0, 12);
}

const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6 };
const BIG: Record<string, number> = { b: 1e9, bn: 1e9, billion: 1e9 };
/** Cents for a written amount and how far rounding for readability may move it. */
function readAmount(token: string): { cents: number; tolerance: number } | null {
  const plain = token.replace(/^[-+−]\s*/, "").replace(/\$\s*[-+]\s*/, "$");
  const cents = parseMoneyText(plain);
  if (cents === null) return null;
  const m = /(?:\.(\d+))?\s*(billion|million|thousand|bn|mm|k|m|b)?(?:\s*(?:dollars|usd))?$/i.exec(
    plain,
  );
  const unit = (m?.[2] ?? "").toLowerCase();
  const scale = SCALE[unit] ?? BIG[unit] ?? 1;
  const decimals = m?.[1]?.length ?? 0;
  return { cents, tolerance: Math.max(0, Math.floor((100 * scale) / 10 ** decimals / 2)) };
}
const MONEY_KEYS = new Set([
  "cents",
  "amount",
  "cashOnHand",
  "restrictedCash",
  "opening",
  "inflow",
  "outflow",
  "closing",
  "usable",
  "baseLow",
  "low",
  "cashImpact",
  "gain",
  "lowPointDelta",
  "impactLowPoint",
  "lowPoint",
  "cost",
  "monthlyCost",
  "usableDelta",
]);
function centsIn(value: unknown, out: Set<number>) {
  if (Array.isArray(value)) for (const v of value) centsIn(v, out);
  else if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    for (const [key, v] of Object.entries(row)) {
      const money =
        MONEY_KEYS.has(key) ||
        (key === "limit" && row.kind === "min_cash") ||
        (["value", "shortfall"].includes(key) && row.unit === "cents");
      if (money && typeof v === "number" && Number.isSafeInteger(v)) out.add(Math.abs(v));
      else if (typeof v === "object") centsIn(v, out);
    }
  }
}
/**
 * Amounts in a reply that match nothing saved or said, allowing only display rounding.
 * Saved integers are cents; amounts typed in the conversation are read the same way.
 */
export function unverifiedAmounts(reply: string, saved: unknown[], texts: string[]): string[] {
  const known = new Set<number>([0]);
  for (const value of saved) centsIn(value, known);
  for (const text of texts)
    for (const token of moneyTokens(text)) {
      const read = readAmount(token);
      if (read) known.add(read.cents);
    }
  const values = [...known];
  return moneyTokens(reply).filter((token) => {
    const read = readAmount(token);
    if (!read) return !texts.some((t) => t.includes(token));
    return !values.some((v) => Math.abs(v - read.cents) <= read.tolerance);
  });
}

/** Existing plan computations run only as an LLM-requested, checked tool. */
export function checkPlan(run: WorkspaceRun, text: string, floor: string | null): Result {
  const unsupported =
    /\b(not|never|don['’]?t|avoid|cancel|unless|except|excluding|including|provided|conditional|contingent|if|before|after|between|through|until|only|without|either|or|daily|tax|maximum|max|at most|at least|monthly|per month)\b/i.test(
      text.replace(/\bwhat if\b/gi, " "),
    );
  const timedNonHire = !/\bhire\b/i.test(text) && dateTokens(text).length > 0;
  if (unsupported || timedNonHire)
    return {
      draft: emptyDraft(),
      answer:
        "The plan cannot preserve that condition or date range. Clarify the assumption before creating a proposal.",
      proposal: null,
      pendingField: null,
    };
  return (
    plannedChange(run, emptyDraft(), text, floor) ?? {
      draft: emptyDraft(),
      answer:
        "That plan needs more details. State the vendor and percentage, or the number of hires, cost and start date.",
      proposal: null,
      pendingField: null,
    }
  );
}
