import {
  type EventTone,
  MAX_PREDICTIONS,
  MAX_START_DAYS,
  type PredictionParamName,
} from "@domino/engine/src/predictions";
import { z } from "zod";
import { moneyTokens, parseMoneyText } from "../questions/parse";
import { detectExternalEvent } from "./externalEvent";

/**
 * Events described in words become predicted consequences (engine catalog in
 * packages/engine/src/predictions.ts). This module is pure: the tone that picks rule defaults,
 * the numbers the person gave (they override any estimate), and the stored prediction shape a
 * save re-checks. The Claude call lives in assistant/predict.ts.
 */
const PARAM_NAMES = [
  "count",
  "avgMonthlyBilling",
  "percent",
  "amount",
  "days",
  "headcount",
  "costPerHead",
] as const satisfies readonly PredictionParamName[];
export const PredictionChoiceSchema = z
  .object({
    kind: z.enum([
      "new_customers",
      "billing_growth",
      "funding_round",
      "pipeline_acceleration",
      "hiring_wave",
      "churn_increase",
      "slower_collections",
      "pipeline_slowdown",
      "one_time_cost",
    ]),
    params: z.record(z.enum(PARAM_NAMES), z.number().int().safe()),
    startInDays: z.number().int().min(0).max(MAX_START_DAYS),
    probability: z.number().gt(0).max(1),
    reason: z.string().min(1).max(200),
    personal: z.array(z.enum(PARAM_NAMES)).max(PARAM_NAMES.length).optional(),
  })
  .strict();
/** One plan part's predicted consequences, as stored with the plan for the save's re-check. */
export const PredictionSetSchema = z
  .object({
    item: z.string().min(1).max(300),
    source: z.enum(["ai", "rule"]),
    choices: z.array(PredictionChoiceSchema).min(1).max(MAX_PREDICTIONS),
  })
  .strict();
export type PredictionSet = z.infer<typeof PredictionSetSchema>;

/** Press, sentiment and outside events with no own numbers are predicted, not parsed. */
export const PREDICTED_EXTERNAL = new Set(["good_press", "bad_press"]);

const FUNDING =
  /\b(invest(?:ment|ments|or|ors|s|ed)?|funding|fund-?rais\w*|seed round|series [a-e]|venture capital|vcs?|term sheet|raises? (?:a |our )?(?:round|seed|series))\b/i;
const NEGATIVE =
  /\b(bad|negative|terrible|awful) (press|pr|publicity|coverage|reviews?)\b|\b(backlash|scandal|lawsuit|sued|breach|hacked|hack|recall|strike|boycott\w*|price war|headwinds?)\b|\bcompetitors? (?:launch\w*|undercuts?|cuts? (?:its |their )?prices?|enters?|raises?)\b|\bsentiment (?:is |turns |goes )?(?:down|sour\w*|negative)\b/i;
const POSITIVE =
  /\bcompetitors? (?:collapses?|collapsed|fails?|failed|goes under|went under|shuts? down|exits?|goes bankrupt|bankrupt)\b|\b(launch\w*|sentiment|viral|buzz|hype|awards?|partnerships?|tailwinds?|momentum|boom|surge\w*|record (?:month|quarter|sales|demand))\b|\bdemand (?:is |goes )?(?:up|surges?|spikes?|grows?)\b|\b(positive|good|great|glowing) (press|pr|publicity|coverage|reviews?)\b/i;

/** Good news, bad news or new money, for the rule defaults; null when the words say neither. */
export function eventTone(text: string): EventTone | null {
  if (FUNDING.test(text)) return "funding";
  const press = detectExternalEvent(text);
  if (press === "bad_press" || NEGATIVE.test(text)) return "negative";
  if (press === "good_press" || POSITIVE.test(text)) return "positive";
  return null;
}

/** Numbers the person typed in this part, in the engine's units. They win over estimates. */
export function personalNumbers(text: string): Partial<Record<PredictionParamName, number>> {
  const out: Partial<Record<PredictionParamName, number>> = {};
  const cents = moneyTokens(text)
    .map(parseMoneyText)
    .find((c) => c !== null && c > 0);
  if (cents) out.amount = cents;
  const n = (re: RegExp) => {
    const m = re.exec(text);
    const v = m?.[1] ? Number(m[1]) : 0;
    return Number.isSafeInteger(v) && v > 0 ? v : null;
  };
  const customers = n(/\b(\d{1,3})\s+(?:new\s+)?(?:customers|clients|accounts|logos)\b/i);
  if (customers) out.count = customers;
  const hires = n(
    /\b(\d{1,3})\s+(?:new\s+)?(?:hires|engineers|people|employees|staff|salespeople|reps)\b/i,
  );
  if (hires) out.headcount = hires;
  const pct = n(/\b(\d{1,2})\s*(?:%|percent\b)/i);
  if (pct) out.percent = pct;
  const days = n(/\b(\d{1,2})\s+days?\b/i);
  if (days) out.days = days;
  return out;
}

/**
 * One droppable part of a proposal: the next `changes` changes, in order. A predicted part
 * carries its prediction so a later turn reuses it instead of predicting again.
 */
export const ProposalPartSchema = z
  .object({
    label: z.string().min(1).max(200),
    changes: z.number().int().min(0).max(64),
    prediction: z
      .object({
        item: z.string().min(1).max(300),
        source: z.enum(["ai", "rule"]),
        choice: PredictionChoiceSchema,
      })
      .strict()
      .nullable(),
  })
  .strict();
export type ProposalPart = z.infer<typeof ProposalPartSchema>;
export const MAX_PROPOSAL_PARTS = 80;

type WithParts<P> = P & {
  label: string;
  changes: unknown[];
  constraints: unknown[] | null;
  parts?: ProposalPart[];
};
/**
 * The proposal without the parts at `drop` (indexes into parts). Only parts with changes can
 * be dropped; null when nothing would remain or the parts do not describe the changes.
 */
export function withoutParts<P extends WithParts<object>>(proposal: P, drop: number[]): P | null {
  if (!drop.length) return proposal;
  const parts = proposal.parts ?? [];
  if (parts.reduce((s, p) => s + p.changes, 0) !== proposal.changes.length) return null;
  const gone = new Set(drop);
  if ([...gone].some((i) => !Number.isInteger(i) || !parts[i] || parts[i].changes === 0))
    return null;
  const changes: unknown[] = [];
  const kept: ProposalPart[] = [];
  let at = 0;
  parts.forEach((part, i) => {
    const own = proposal.changes.slice(at, at + part.changes);
    at += part.changes;
    if (gone.has(i)) return;
    changes.push(...own);
    kept.push(part);
  });
  if (!changes.length && !proposal.constraints) return null;
  const suffix = ` (${gone.size} part${gone.size === 1 ? "" : "s"} dropped)`;
  return {
    ...proposal,
    label: `${proposal.label.slice(0, 200 - suffix.length)}${suffix}`,
    changes,
    parts: kept,
  };
}

/** Earlier predictions in a proposal, by plan part, so the same event is not predicted again. */
export function predictionsIn(parts: ProposalPart[] | undefined): Map<string, PredictionSet> {
  const out = new Map<string, PredictionSet>();
  for (const p of parts ?? []) {
    if (!p.prediction) continue;
    const set = out.get(p.prediction.item) ?? {
      item: p.prediction.item,
      source: p.prediction.source,
      choices: [],
    };
    if (set.choices.length < MAX_PREDICTIONS) set.choices.push(p.prediction.choice);
    out.set(p.prediction.item, set);
  }
  return out;
}
