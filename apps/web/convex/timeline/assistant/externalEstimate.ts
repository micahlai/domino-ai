import {
  EXTERNAL_EVENT_PARAMS,
  type ExternalEventKind,
  type ExternalParamName,
} from "@domino/engine/src/external-events";
import { z } from "zod";
import {
  type MacroEstimate,
  MacroEstimateSchema,
  detectExternalEvent,
  missingParams,
  typedParams,
} from "../chat/externalEvent";
import type { WorkspaceRun } from "../questions/context";
import { moneyTokens } from "../questions/parse";
import { runStructured } from "./claude";

/**
 * One small Claude call for an outside event the person described without numbers: a whole
 * number per missing parameter, inside the engine's bounds, and a one-line reason. Claude sees
 * only counts and payment habits, never amounts, and may not write amounts; the engine clamps
 * every value again and computes all cash. Null when nothing is missing or the call fails, so
 * the stated defaults apply.
 */
const ESTIMATE_TIMEOUT_MS = 25_000;
const SYSTEM = `You estimate how an outside event changes a B2B software company's cash timing, for a 13-week cash forecast. Return one whole number per requested parameter, inside its bounds, and one plain sentence (under 200 characters) saying why, grounded in the event wording and the company facts. Use typical, moderate values unless the wording says the event is severe or mild. Never write money amounts, dollar figures or forecasts; the engine computes all cash.`;

export async function estimateExternalEvent(
  run: WorkspaceRun,
  text: string,
): Promise<MacroEstimate | null> {
  const kind = detectExternalEvent(text);
  if (!kind) return null;
  const missing = missingParams(kind, typedParams(kind, text));
  if (!missing.length) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Kept short so the estimate plus the main reply stay inside the turn's lease.
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("ESTIMATE_TIMEOUT")), ESTIMATE_TIMEOUT_MS);
    });
    const call = runStructured({
      system: SYSTEM,
      schema: schemaFor(missing),
      maxSteps: 1,
      check: (value) => issueOf(kind, missing, value),
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            event: text.slice(0, 500),
            eventKind: kind,
            parameters: Object.fromEntries(missing.map((n) => [n, EXTERNAL_EVENT_PARAMS[kind][n]])),
            company: facts(run),
          }),
        },
      ],
    });
    return parse(kind, missing, await Promise.race([call, timeout]));
  } catch (error) {
    console.warn(
      `external event estimate failed, using defaults: ${error instanceof Error ? error.message : error}`,
    );
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function schemaFor(missing: ExternalParamName[]): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["values", "reason"],
    properties: {
      values: {
        type: "object",
        additionalProperties: false,
        required: missing,
        properties: Object.fromEntries(missing.map((n) => [n, { type: "integer" }])),
      },
      reason: { type: "string" },
    },
  };
}

const ReplySchema = z
  .object({
    values: z.record(z.string(), z.number().int()),
    reason: z.string().trim().min(1).max(240),
  })
  .strict();

function issueOf(kind: ExternalEventKind, missing: ExternalParamName[], value: unknown) {
  const reply = ReplySchema.safeParse(value);
  if (!reply.success)
    return 'return {"values": {...whole numbers...}, "reason": "one sentence under 200 characters"}.';
  for (const n of missing) {
    const bound = EXTERNAL_EVENT_PARAMS[kind][n];
    const v = reply.data.values[n];
    if (!bound || v === undefined) return `give a whole number for ${n}.`;
    if (v < bound.min || v > bound.max)
      return `${n} must be between ${bound.min} and ${bound.max}.`;
  }
  if (moneyTokens(reply.data.reason).length || /\$/.test(reply.data.reason))
    return "the reason may not contain money amounts. Explain the behavior in words.";
  return null;
}

function parse(kind: ExternalEventKind, missing: ExternalParamName[], raw: unknown) {
  if (issueOf(kind, missing, raw)) return null;
  const reply = ReplySchema.parse(raw);
  const values = Object.fromEntries(missing.map((n) => [n, reply.values[n]]));
  return MacroEstimateSchema.parse({ kind, values, reason: reply.reason });
}

/** Counts and payment habits only; no amounts reach the model. */
function facts(run: WorkspaceRun) {
  const { snapshot } = run.baseline.seed;
  const delays = Object.values(run.baseline.model.customerDelayDays).filter((d) => d.samples > 0);
  const terms = snapshot.customers.map((c) => c.paymentTermsDays).sort((a, b) => a - b);
  return {
    name: run.baseline.companyName,
    customers: snapshot.customers.length,
    customersOnRecurringPlans: new Set((snapshot.billingPlans ?? []).map((p) => p.customerId)).size,
    signedDealsNotYetInvoiced: snapshot.deals.filter(
      (d) => d.stage === "won" && d.signed && d.invoiceId === null,
    ).length,
    typicalPaymentTermsDays: terms[Math.floor(terms.length / 2)] ?? null,
    averageLearnedLateDays: delays.length
      ? Math.round(delays.reduce((s, d) => s + d.mean, 0) / delays.length)
      : null,
  };
}
