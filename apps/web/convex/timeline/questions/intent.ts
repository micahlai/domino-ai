import { z } from "zod";

/**
 * What a person asked for, before any record is looked up. Both the fixed grammar and the
 * optional provider produce this shape; one resolver then checks it against the saved run.
 * Every `*Text` field is the person's own words copied from the prompt (checked), so the
 * provider never supplies a number, date or name we did not see typed.
 */
const Words = z.string().min(1).max(200).nullable();

export const IntentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("question"),
      topic: z.enum(["low_point", "week", "item", "rules", "dominoes"]),
      weekText: Words,
      itemText: Words,
    })
    .strict(),
  z.object({ kind: z.literal("late_invoice"), itemText: Words, daysText: Words }).strict(),
  z
    .object({
      kind: z.literal("cash_change"),
      direction: z.enum(["in", "out"]),
      amountText: Words,
      dateText: Words,
      counterpartyText: Words,
    })
    .strict(),
  z.object({ kind: z.literal("min_cash_rule"), amountText: Words }).strict(),
  z.object({ kind: z.literal("runway_rule"), monthsText: Words }).strict(),
  z.object({ kind: z.literal("pay_by_date_rule"), itemText: Words, daysText: Words }).strict(),
  z
    .object({
      kind: z.literal("unsupported"),
      reason: z.enum(["daily_cash_floor", "headcount_budget", "other"]),
    })
    .strict(),
  z.object({ kind: z.literal("unclear") }).strict(),
]);
export type Intent = z.infer<typeof IntentSchema>;

export const MAX_INTENTS = 4;
export const IntentsSchema = z
  .object({ intents: z.array(IntentSchema).min(1).max(MAX_INTENTS) })
  .strict();
export type Intents = z.infer<typeof IntentsSchema>;

/** Text fields of an intent, so the caller can check each was copied from the prompt. */
export function wordsOf(intent: Intent): string[] {
  const out: (string | null)[] = [];
  switch (intent.kind) {
    case "question":
      out.push(intent.weekText, intent.itemText);
      break;
    case "late_invoice":
      out.push(intent.itemText, intent.daysText);
      break;
    case "cash_change":
      out.push(intent.amountText, intent.dateText, intent.counterpartyText);
      break;
    case "min_cash_rule":
      out.push(intent.amountText);
      break;
    case "runway_rule":
      out.push(intent.monthsText);
      break;
    case "pay_by_date_rule":
      out.push(intent.itemText, intent.daysText);
      break;
    default:
      break;
  }
  return out.filter((w): w is string => w !== null);
}

// JSON Schema for the provider's structured output; mirrors IntentsSchema exactly.
const words = { type: ["string", "null"] };
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
export const INTENTS_JSON_SCHEMA = obj({
  intents: {
    type: "array",
    items: {
      anyOf: [
        obj({
          kind: { const: "question" },
          topic: { enum: ["low_point", "week", "item", "rules", "dominoes"] },
          weekText: words,
          itemText: words,
        }),
        obj({ kind: { const: "late_invoice" }, itemText: words, daysText: words }),
        obj({
          kind: { const: "cash_change" },
          direction: { enum: ["in", "out"] },
          amountText: words,
          dateText: words,
          counterpartyText: words,
        }),
        obj({ kind: { const: "min_cash_rule" }, amountText: words }),
        obj({ kind: { const: "runway_rule" }, monthsText: words }),
        obj({ kind: { const: "pay_by_date_rule" }, itemText: words, daysText: words }),
        obj({
          kind: { const: "unsupported" },
          reason: { enum: ["daily_cash_floor", "headcount_budget", "other"] },
        }),
        obj({ kind: { const: "unclear" } }),
      ],
    },
  },
});
