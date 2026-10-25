import { type Change, type Constraint, canonicalJson } from "@domino/contracts";
import { forecast } from "@domino/engine/src/forecast";
import {
  buildPredictions,
  predictionCatalog,
  predictionTag,
  resolvePredictions,
} from "@domino/engine/src/predictions";
import { ConvexError } from "convex/values";
import { z } from "zod";
import { type WorkspaceRun, recordsOf } from "../questions/context";
import { IntentSchema } from "../questions/intent";
import { addDays, dateTokens, moneyTokens, parseMoneyText } from "../questions/parse";
import type { QuestionProposal } from "../questions/receipt";
import { type Citation, resolve } from "../questions/resolve";
import { compactMoney, shortDate } from "../recordNames";
import { MAX_TOTAL_CHANGES, checkEffects } from "../workspaceInput";
import {
  MAX_DRAFT_INTENTS,
  type Result,
  advance,
  emptyDraft,
  evaluateIntents,
  plannedChange,
  validateProposal,
} from "./draft";
import { type MacroEstimate, MacroEstimateSchema, detectExternalEvent } from "./externalEvent";
import { looseDate, planRequest } from "./planChanges";
import {
  PREDICTED_EXTERNAL,
  type PredictionSet,
  PredictionSetSchema,
  type ProposalPart,
  eventTone,
  personalNumbers,
} from "./predicted";
import type { ChatReceipt } from "./receipt";

/**
 * Pure checks for one conversational turn. Claude writes every visible reply; these functions
 * decide which draft values may enter a reviewable proposal and which amounts a reply may quote.
 */
export const REPLY_MAX = 1500;
/** Parts of one compound plan, and the changes the whole plan may add. */
export const MAX_PLAN_ITEMS = 12;
export const MAX_PLAN_CHANGES = 40;
/** Plain sub-requests Claude extracted from the conversation, one change each. */
export const PlanItemsSchema = z
  .array(z.string().trim().min(1).max(300))
  .min(1)
  .max(MAX_PLAN_ITEMS);
const Words = z.string().min(1).max(200).nullable();
export const LookupSchema = z
  .object({
    topic: z.enum(["low_point", "week", "item", "rules", "dominoes"]),
    weekText: Words,
    itemText: Words,
  })
  .strict();
export const DraftUpdateSchema = z
  .object({ request: z.string().max(1000), intents: z.array(IntentSchema).max(MAX_DRAFT_INTENTS) })
  .strict();
export type DraftUpdate = z.infer<typeof DraftUpdateSchema>;
/** What the action hands to the save mutation. The mutation re-checks all of it. */
export const TurnPlanSchema = z
  .object({
    reply: z.string().trim().min(1).max(REPLY_MAX),
    draft: DraftUpdateSchema.nullable(),
    questions: z.array(LookupSchema).max(8),
    recordIds: z.array(z.string().min(1).max(240)).max(24),
    /** The previewed plan's parts; the save re-runs every one of them. */
    planItems: PlanItemsSchema.nullable().optional(),
    /** Bounded AI estimate for an outside event in the plan; the save re-checks and clamps it. */
    macro: MacroEstimateSchema.nullable().optional(),
    /** Predicted consequences per event part; the save clamps and rebuilds them. */
    predictions: z.array(PredictionSetSchema).max(MAX_PLAN_ITEMS).optional(),
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
  update: Pick<DraftUpdate, "intents">,
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

const PLAN_QUALIFIER =
  /\b(not|never|don['’]?t|avoid|cancel|unless|except|excluding|including|provided|conditional|contingent|if|before|after|between|through|until|only|without|either|or|daily|tax|maximum|max|at most|at least|monthly|per month)\b/i;
/** Plans that read their own start date. */
const DATED_PLAN =
  /\b(hire|lose|losing|churns?|leaves?|cancels?|lay(?:ing)?\s*offs?|laid\s+off|payroll|headcount|downsiz\w*)\b/i;
const PLAN_DETAILS =
  "That part needs more details. State the vendor and percentage, the number of hires, cost and start date, the customer you lose, the share of payroll cut, a one-time payment or receipt with amount, counterparty and date, or an outside event such as a Fed rate hike, bad press, a recession or positive press.";

/**
 * One part of a plan: an outside event, a plan computation (spend %, hires, layoffs, prices,
 * lost customers), or a one-time payment, receipt, late invoice or rule read by the fixed
 * grammar. Conditions and date ranges a plan cannot keep are refused, never dropped. `predict`
 * marks an event in words (press, sentiment, launch, investment, competitor news) whose
 * consequences are predicted instead.
 */
export function checkPlanItem(
  run: WorkspaceRun,
  text: string,
  floor: string | null,
  estimate: MacroEstimate | null,
  s: { conversationId: string; selectedItemId: string | null },
): Result & { predict: boolean } {
  const none = (answer: string, predict: boolean) => ({
    draft: emptyDraft(),
    answer,
    proposal: null,
    pendingField: null,
    predict,
  });
  const kind = detectExternalEvent(text);
  if (kind && PREDICTED_EXTERNAL.has(kind)) return none(PLAN_DETAILS, true);
  // Outside events read their own dates and wording ("if the Fed hikes 50 bp in December").
  if (kind) {
    const external = plannedChange(run, emptyDraft(), text, floor, estimate);
    if (external) return { ...external, predict: false };
  }
  const guarded =
    PLAN_QUALIFIER.test(text.replace(/\bwhat if\b/gi, " ")) ||
    (!DATED_PLAN.test(text) && dateTokens(text).length > 0);
  const planned = guarded ? null : plannedChange(run, emptyDraft(), text, floor);
  if (planned) return { ...planned, predict: false };
  // A plan shape whose condition the guard refused never falls through to another reader.
  const shaped = planRequest(run, text, floor) !== null;
  if (!shaped) {
    const once = advance(run, emptyDraft(), text, s.conversationId, s.selectedItemId, floor);
    if (once.proposal) return { ...once, predict: false };
    if (eventTone(text)) return none(PLAN_DETAILS, true);
    if (once.pendingField) return { ...once, predict: false };
  }
  return none(
    guarded
      ? "The plan cannot preserve that condition or date range. Clarify the assumption before creating a proposal."
      : PLAN_DETAILS,
    !guarded && !shaped,
  );
}

/** "A + B + C", or "A + B + 3 more" when the parts do not fit a 200-character label. */
function planLabel(labels: string[]): string {
  const all = labels.join(" + ");
  if (all.length <= 200) return all;
  for (let k = labels.length - 1; k >= 1; k--) {
    const text = `${labels.slice(0, k).join(" + ")} + ${labels.length - k} more`;
    if (text.length <= 200) return text;
  }
  return `${labels.length} changes: ${labels[0] ?? ""}`.slice(0, 200);
}

export type PlanItemOutcome = {
  item: string;
  modeled: boolean;
  note: string;
  /** An event in words whose consequences need a prediction (none was supplied yet) */
  predict?: boolean;
};
export type CompoundResult = Result & { items: PlanItemOutcome[] };

const errorText = (e: unknown) =>
  e instanceof ConvexError
    ? String((e.data as { message?: unknown } | null)?.message ?? "invalid change")
    : e instanceof Error
      ? e.message
      : "invalid change";
const closing =
  /\s*(Domino effects run automatically once you confirm\.\s*)?Check the details below, then confirm\b.*$/s;

/**
 * Several plan parts as ONE proposal the engine computes as one scenario. Every part goes
 * through checkPlanItem; its values must be the person's own (never only in reference data
 * such as a Worker note), and the merged changes are validated together, part by part, so a
 * part that cannot be modeled or conflicts with an earlier one is reported while the others
 * still proceed. An event in words uses its stored predictions (each predicted consequence is
 * its own droppable part). Deterministic: the save re-runs it on the same parts.
 */
export function checkCompound(
  run: WorkspaceRun,
  items: string[],
  floor: string | null,
  estimate: MacroEstimate | null,
  s: {
    conversationId: string;
    selectedItemId: string | null;
    userTexts: string[];
    referenceText: string | null;
  },
  predictions: ReadonlyMap<string, PredictionSet> = new Map(),
): CompoundResult {
  const list = PlanItemsSchema.parse(items);
  const snapshot = run.baseline.seed.snapshot;
  const model = run.baseline.model;
  const horizon = {
    asOf: snapshot.asOf,
    firstWeek: run.forecast.weeks[0]?.weekStart ?? "",
    end: addDays(run.forecast.weeks[12]?.weekStart ?? "", 6),
  };
  const cents = (texts: string[]) =>
    new Set(texts.flatMap((t) => moneyTokens(t).map(parseMoneyText)).filter((c) => c !== null));
  const typed = cents(s.userTexts);
  const referenced = cents([s.referenceText ?? ""]);
  const used = new Set(run.changes.flatMap((c) => ("label" in c ? [c.label] : [])));
  const outcomes: PlanItemOutcome[] = [];
  const labels: string[] = [];
  const notes: string[] = [];
  const parts: ProposalPart[] = [];
  let changes: Change[] = [];
  let constraints: Constraint[] | null = null;
  /** The planner's own full answer, kept when the plan is one plain part. */
  let single: string | null = null;
  const skip = (item: string, note: string, predict = false) =>
    outcomes.push({ item, modeled: false, note, ...(predict ? { predict } : {}) });
  /** Add one part's changes after the earlier ones, or say why it cannot be combined. */
  const add = (
    proposed: Change[],
    newRules: Constraint[] | null,
    part: Omit<ProposalPart, "changes">,
  ): string | null => {
    // A customer lost twice, or slipping twice, would stack; the first part already covers it.
    const taken = new Set(
      [...run.changes, ...changes].flatMap((c) =>
        c.kind === "churn" || c.kind === "delay_customer" ? [`${c.kind}:${c.customerId}`] : [],
      ),
    );
    const own = proposed
      .filter((c) => !("customerId" in c) || !taken.has(`${c.kind}:${c.customerId}`))
      .map((c) => {
        if (!("label" in c)) return c;
        let label = c.label;
        for (let n = 2; used.has(label); n++)
          label = `${c.label.slice(0, 200 - ` (${n})`.length)} (${n})`;
        return { ...c, label } as Change;
      });
    if (!own.length && !newRules) return "An earlier part of this plan already covers it.";
    if (
      changes.length + own.length > MAX_PLAN_CHANGES ||
      run.changes.length + changes.length + own.length > MAX_TOTAL_CHANGES
    )
      return `This plan is full (${MAX_PLAN_CHANGES} changes at most). Model this part in a follow-up branch after saving.`;
    const base: Constraint[] = constraints ?? run.constraints;
    const rules: Constraint[] | null = newRules
      ? [
          ...base,
          ...newRules.filter((r) => !base.some((b) => canonicalJson(b) === canonicalJson(r))),
        ]
      : constraints;
    const next = [...changes, ...own];
    try {
      validateProposal(run, {
        label: "plan",
        changes: next,
        constraints: rules,
        constraintNote: null,
      });
      checkEffects(
        [...run.changes, ...next],
        snapshot,
        model,
        horizon,
        run.changes.length + changes.length,
      );
    } catch (e) {
      return `It cannot combine with the earlier parts of this plan: ${errorText(e)}`;
    }
    for (const c of own) if ("label" in c) used.add(c.label);
    changes = next;
    constraints = rules;
    parts.push({ ...part, changes: own.length });
    return null;
  };
  const eventStart = (item: string) => {
    const from = floor && floor > snapshot.asOf ? floor : addDays(snapshot.asOf, 1);
    const date = looseDate(item, snapshot.asOf);
    return date && date > from ? date : from;
  };
  for (const item of list) {
    // A part's money must be what the person said; Claude may only normalize it ("90k").
    const foreign = moneyTokens(item).find((t) => {
      const c = parseMoneyText(t);
      return c !== null && !typed.has(c);
    });
    if (foreign) {
      const fromReference = referenced.has(parseMoneyText(foreign) ?? -1);
      skip(
        item,
        fromReference
          ? `The amount ${foreign} comes from reference data, not from your messages. Say it yourself if you want it modeled.`
          : `${foreign} is not an amount the person gave. Use their own number, or ask for it.`,
      );
      continue;
    }
    const result = checkPlanItem(run, item, floor, estimate, s);
    const proposal = result.proposal;
    if (!proposal && result.predict) {
      const set = predictions.get(item);
      if (!set) {
        skip(item, "This event needs a prediction of its consequences.", true);
        continue;
      }
      const prior = [...run.changes, ...changes];
      const catalog = predictionCatalog(snapshot, model, prior);
      const choices = resolvePredictions(
        catalog,
        { consequences: set.choices },
        personalNumbers(item),
      );
      if (!choices) {
        skip(item, "No predicted consequence fits this company's books.");
        continue;
      }
      const lines: string[] = [];
      let kept = 0;
      for (const c of buildPredictions(
        snapshot,
        model,
        prior,
        choices,
        eventStart(item),
        set.source,
      )) {
        const tag = predictionTag(set.source, c.choice.probability);
        const yours = c.choice.personal?.length ? " (your number)" : "";
        const issue = c.changes.length
          ? add(c.changes, null, {
              label: `${tag}: ${c.title}`.slice(0, 200),
              prediction: { item, source: set.source, choice: c.choice },
            })
          : "it would not move cash inside these 13 weeks";
        if (issue) lines.push(`${tag}: ${c.effect}${yours}. Left out: ${issue.replace(/\.$/, "")}`);
        else {
          kept++;
          lines.push(
            `${tag}: ${c.effect}${yours}, because ${c.choice.reason.replace(/[.\s]+$/, "")}`,
          );
        }
      }
      if (kept) labels.push(`Predicted: ${item}`.slice(0, 120));
      outcomes.push({
        item,
        modeled: kept > 0,
        note: `Predicted consequences of "${item}": ${lines.join("; ")}.`,
      });
      continue;
    }
    if (!proposal) {
      skip(item, result.answer);
      continue;
    }
    const copied = copiedFromReference(result.draft, s.userTexts, s.referenceText ?? "");
    if (copied) {
      skip(item, `${copied} comes from reference data, not from your messages.`);
      continue;
    }
    const issue = add(proposal.changes, proposal.constraints, {
      label: proposal.label,
      prediction: null,
    });
    if (issue) {
      skip(item, issue);
      continue;
    }
    labels.push(proposal.label);
    if (proposal.constraintNote) notes.push(proposal.constraintNote);
    single = result.answer;
    // The one-time reader's answer names no values; the proposal label does.
    const note = result.answer
      .replace(/^Ready to model this\./, `Ready to model ${proposal.label}.`)
      .replace(closing, "");
    outcomes.push({ item, modeled: true, note });
  }
  const failed = outcomes.filter((o) => !o.modeled);
  if (!labels.length) {
    // One part keeps the planner's own question; several list each part's reason.
    const answer =
      outcomes.length === 1
        ? (outcomes[0]?.note ?? PLAN_DETAILS)
        : `Nothing could be modeled yet. ${outcomes.map((o, i) => `${i + 1}. ${o.item}: ${o.note}`).join(" ")}`;
    return { draft: emptyDraft(), answer, proposal: null, pendingField: null, items: outcomes };
  }
  const predicted = parts.some((p) => p.prediction !== null);
  const plan: QuestionProposal = {
    label: planLabel(labels),
    changes,
    constraints,
    constraintNote: notes.length ? notes.join(" ").slice(0, 500) : null,
    // One plain part keeps the proposal exactly as before; otherwise each part can be dropped.
    ...(parts.length > 1 || predicted ? { parts } : {}),
  };
  if (outcomes.length === 1 && !predicted && single)
    return {
      draft: emptyDraft(),
      answer: single,
      proposal: plan,
      pendingField: null,
      items: outcomes,
    };
  const after = forecast(snapshot, model, [...run.changes, ...changes]);
  const delta = after.lowPoint.usable - run.forecast.lowPoint.usable;
  const answer = [
    `Ready to model ${labels.length} of ${outcomes.length} parts together as one scenario.`,
    ...outcomes.map((o, i) => `${i + 1}. ${o.modeled ? "" : `Not modeled (${o.item}): `}${o.note}`),
    `Together, the engine puts the lowest usable cash at ${compactMoney(after.lowPoint.usable)} (week of ${shortDate(after.lowPoint.weekStart)}), ${delta === 0 ? "the same as now" : `${compactMoney(Math.abs(delta))} ${delta < 0 ? "lower" : "higher"} than now`}.`,
    failed.length ? "The parts not modeled are left out of the proposal." : "",
    predicted
      ? "Predictions are estimates; the person can untick any predicted part before saving."
      : "",
    "Domino effects run automatically once you confirm. Check the details below, then confirm.",
  ]
    .filter(Boolean)
    .join(" ");
  return { draft: emptyDraft(), answer, proposal: plan, pendingField: null, items: outcomes };
}
