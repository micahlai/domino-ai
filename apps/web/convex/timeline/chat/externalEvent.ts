import {
  EXTERNAL_EVENT_PARAMS,
  type ExternalEventKind,
  type ExternalEventParams,
  type ExternalParamName,
} from "@domino/engine/src/external-events";
import { z } from "zod";
import { findMoneyText, parseMoneyText } from "../questions/parse";

/**
 * Outside events in plain words ("the Fed hikes 50 bp", "bad press", "a recession", "we go
 * viral"). Pure reading only: which event, and which numbers the person typed. Parameters the
 * person did not give come from a typed, bounded AI estimate or the engine's stated defaults;
 * the engine builds every change and computes all cash.
 */
export const EXTERNAL_KINDS = [
  "rate_hike",
  "bad_press",
  "downturn",
  "good_press",
  "regulatory_fine",
  "vendor_outage",
] as const satisfies readonly ExternalEventKind[];
export const PARAM_NAMES = [
  "rateBps",
  "slowdownDays",
  "churnPercent",
  "billingPercent",
  "pipelineDays",
  "prepayDays",
  "outageDays",
] as const satisfies readonly ExternalParamName[];

/** A model estimate: whole numbers per parameter (clamped again by the engine), one reason. */
export const MacroEstimateSchema = z
  .object({
    kind: z.enum(EXTERNAL_KINDS),
    values: z
      .object(
        Object.fromEntries(PARAM_NAMES.map((n) => [n, z.number().int().optional()])) as Record<
          ExternalParamName,
          z.ZodOptional<z.ZodNumber>
        >,
      )
      .strict(),
    reason: z.string().trim().min(1).max(240),
  })
  .strict();
export type MacroEstimate = z.infer<typeof MacroEstimateSchema>;

const RATE =
  /\b(fed|federal reserve|fomc|central bank|interest rates?|rate (?:hike|hikes|increase|rise)|basis points?|bps?)\b/i;
const RATE_UP =
  /\b(hike[sd]?|hiking|rais(?:e|es|ed|ing)|ris(?:e|es|ing)|rose|increas\w*|up|jump\w*|higher|tighten\w*|bump\w*)\b/i;
const BAD_PRESS =
  /\b(bad|negative|terrible|awful) (press|pr|publicity|coverage|reviews?)\b|\bpr (crisis|disaster|nightmare)\b|\bbacklash\b|\bscandal\b|\breputation(?:al)? (hit|damage|crisis|risk)\b|\b(hurts?|damages?|hit to) (our )?reputation\b|\bboycott\w*\b|\bsocial media (storm|outrage|pile-?on)\b|\bviral (complaint|thread|tweet|post|video) (about|against|attacking)\b|\bgoes viral for the wrong\b|\bdata breach\b|\bshitstorm\b/i;
const DOWNTURN =
  /\b(recession|downturn|depression|bear market|market (crash|crashes|dip|drop|slump|correction|turmoil)|economic (slump|slowdown|crisis|contraction)|economy (tanks|slows|weakens|contracts|crashes)|stock market crash|financial crisis)\b/i;
const GOOD_PRESS =
  /\b(positive|good|great|glowing) (press|pr|publicity|coverage|reviews?)\b|\b(goes|went|go|going) viral\b|\bviral (growth|launch|moment|post|video|hit)\b|\bfeatured (in|on|by)\b|\b(techcrunch|product hunt|hacker news|front page)\b|\bpress coverage\b/i;
const FINE = /\b(regulatory fine|fined|penalty|penalt(?:y|ies)|regulator|fine of)\b/i;
const OUTAGE =
  /\b(outage|goes down|went down|is down|downtime|breaks down)\b.*\b(stripe|processor|payment|vendor|provider|bank|aws|cloud|platform)\b|\b(stripe|processor|payment|vendor|provider|bank|aws|cloud|platform)\b.*\b(outage|goes down|went down|is down|downtime)\b/i;
const NEGATED = /\b(not|never|no|don['’]?t|doesn['’]?t|won['’]?t|didn['’]?t|isn['’]?t|without)\b/i;

/** The outside event a message asks about, or null. A negated event is left to clarify. */
export function detectExternalEvent(text: string): ExternalEventKind | null {
  if (NEGATED.test(text)) return null;
  // Bad press before good press: "a viral complaint about us" is bad news.
  if (BAD_PRESS.test(text)) return "bad_press";
  if (OUTAGE.test(text)) return "vendor_outage";
  if (FINE.test(text) && findMoneyText(text)) return "regulatory_fine";
  if (RATE.test(text) && RATE_UP.test(text)) return "rate_hike";
  if (DOWNTURN.test(text)) return "downturn";
  if (GOOD_PRESS.test(text)) return "good_press";
  return null;
}

const firstNumber = (re: RegExp, text: string): number | null => {
  const m = re.exec(text);
  return m?.[1] ? Number(m[1]) : null;
};
const DAYS = /\b(\d{1,3})\s*-?\s*days?\b/i;
const PERCENT = /\b(\d{1,3}(?:\.\d{1,2})?)\s*(?:%|percent\b)/i;

/** Parameters the person typed for this kind, in the engine's units. */
export function typedParams(kind: ExternalEventKind, text: string): ExternalEventParams {
  const out: ExternalEventParams = {};
  const days = firstNumber(DAYS, text);
  const pct = firstNumber(PERCENT, text);
  switch (kind) {
    case "rate_hike": {
      const bps = firstNumber(/\b(\d{1,3})\s*(?:bps?|basis points?)\b/i, text);
      const points = firstNumber(
        /\b(\d(?:\.\d{1,2})?)\s*(?:%|percent\b|percentage points?\b|points?\b|pts?\b)/i,
        text,
      );
      if (bps !== null) out.rateBps = bps;
      else if (points !== null) out.rateBps = Math.round(points * 100);
      else if (/\bquarter[- ]point\b/i.test(text)) out.rateBps = 25;
      else if (/\bhalf[- ](?:a[- ])?point\b/i.test(text)) out.rateBps = 50;
      else if (/\bfull[- ]point\b|\bone[- ]point\b/i.test(text)) out.rateBps = 100;
      if (days !== null) out.slowdownDays = days;
      break;
    }
    case "bad_press":
      if (pct !== null) out.churnPercent = pct;
      if (days !== null) out.pipelineDays = days;
      break;
    case "downturn":
      if (pct !== null) out.billingPercent = -pct;
      if (days !== null) out.slowdownDays = days;
      break;
    case "good_press":
      if (pct !== null) out.billingPercent = pct;
      if (days !== null) out.pipelineDays = -days;
      break;
    case "regulatory_fine": {
      const money = findMoneyText(text);
      const cents = money ? parseMoneyText(money) : null;
      if (cents !== null && cents > 0) out.amount = cents;
      break;
    }
    case "vendor_outage":
      if (days !== null) out.outageDays = days;
      break;
  }
  return out;
}

/** Parameters of this kind the person did not give, which an estimate may fill. */
export function missingParams(kind: ExternalEventKind, typed: ExternalEventParams) {
  return (Object.keys(EXTERNAL_EVENT_PARAMS[kind]) as ExternalParamName[]).filter(
    (n) => typed[n] === undefined,
  );
}

/** "customers pay 12 days slower", for answers. */
export function paramPhrase(name: ExternalParamName, value: number): string {
  const n = Math.abs(value);
  switch (name) {
    case "rateBps":
      return `rates up ${value} bp`;
    case "slowdownDays":
      return `customers pay ${value} days slower`;
    case "churnPercent":
      return `${value}% of recurring revenue cancels`;
    case "billingPercent":
      return `recurring billing ${value < 0 ? "down" : "up"} ${n}%`;
    case "pipelineDays":
      return value === 0
        ? "no pipeline change"
        : `new deals ${value > 0 ? `close ${n} days later` : `pay ${n} days sooner`}`;
    case "prepayDays":
      return `vendors want payment ${value} days sooner`;
    case "outageDays":
      return `receipts held ${value} days`;
  }
}
