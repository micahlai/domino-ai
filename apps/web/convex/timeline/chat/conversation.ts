import { z } from "zod";
import { type WorkspaceRun, recordsOf } from "../questions/context";
import { IntentSchema } from "../questions/intent";
import { dateTokens, moneyTokens, parseMoneyText } from "../questions/parse";
import { type Citation, resolve } from "../questions/resolve";
import { type Result, emptyDraft, evaluateIntents, plannedChange } from "./draft";
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

/**
 * Check one replacement draft. Claude reads the whole conversation and fills the draft with
 * standard values; the parser is the final check: each value must be valid, inside the
 * forecast and resolvable, and the plain restatement must match the draft. The person then
 * reviews the proposal before anything is calculated. Rejections clear the draft.
 */
export function checkDraft(
  run: WorkspaceRun,
  update: DraftUpdate,
  s: {
    selectedItemId: string | null;
    conversationId: string;
    floor: string | null;
    /** Active user messages and reference-only text such as a Worker note. */
    userTexts?: string[];
    referenceText?: string | null;
  },
): Result {
  const copied = copiedFromReference(update, s.userTexts ?? [], s.referenceText ?? "");
  if (copied)
    return {
      draft: emptyDraft(),
      answer: `${copied} comes from reference data, not from your messages. Say it yourself if you want it modeled. Nothing was drafted.`,
      proposal: null,
      pendingField: null,
    };
  if (!update.intents.length)
    return {
      draft: emptyDraft(),
      answer: "The draft is cleared. Nothing will be calculated.",
      proposal: null,
      pendingField: null,
    };
  if (update.intents.some((i) => ["question", "unsupported", "unclear"].includes(i.kind)))
    return {
      draft: emptyDraft(),
      answer:
        "A draft holds only changes Domino can calculate: a one-time payment or receipt, a late invoice, or a minimum cash, runway or bill deadline rule. Nothing was drafted.",
      proposal: null,
      pendingField: null,
    };
  return evaluateIntents(
    run,
    update.intents,
    s.conversationId,
    update.request,
    s.selectedItemId,
    s.floor,
  );
}

/**
 * Claude may normalize what the person typed ("90k" -> $90,000), but a value it can only have
 * read in reference data (a Worker note, saved books) is never a draft value. Returns the first
 * such value, or null.
 */
function copiedFromReference(
  update: DraftUpdate,
  userTexts: string[],
  reference: string,
): string | null {
  if (!reference.trim()) return null;
  const amounts = (texts: string[]) =>
    new Set(texts.flatMap((t) => moneyTokens(t).map(parseMoneyText)).filter((c) => c !== null));
  const typed = amounts(userTexts);
  const referenced = amounts([reference]);
  const user = userTexts.join("\n").toLowerCase();
  const ref = reference.toLowerCase();
  const dates = new Set(userTexts.flatMap(dateTokens));
  for (const intent of update.intents) {
    const i = intent as Record<string, unknown>;
    const amount = typeof i.amountText === "string" ? parseMoneyText(i.amountText) : null;
    if (amount !== null && !typed.has(amount) && referenced.has(amount))
      return `The amount ${i.amountText}`;
    const party = typeof i.counterpartyText === "string" ? i.counterpartyText.toLowerCase() : "";
    if (party && ref.includes(party) && !user.includes(party))
      return `The counterparty ${i.counterpartyText}`;
    const date = typeof i.dateText === "string" ? i.dateText : "";
    if (date && ref.includes(date) && !dates.has(date) && !user.includes(date.toLowerCase()))
      return `The date ${date}`;
  }
  return null;
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
