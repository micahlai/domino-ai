import { canonicalJson } from "@domino/contracts";
import { z } from "zod";
import { INTENTS_JSON_SCHEMA, type Intent, IntentsSchema, wordsOf } from "./intent";

/**
 * Optional one-shot intent reader (method "provider"). One Messages API request with a
 * structured-output schema; the reply may only classify the prompt and copy words out of it.
 * It never sees money totals, never writes an answer, and never keeps a conversation.
 * Raw replies and errors are dropped here: callers get intents or a short failure code.
 */
export const PROVIDER_VERSION = "timeline_question_provider@1";
const ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2026-10-21";
export const DEFAULT_MODEL = "claude-opus-5-5";
const MAX_TOKENS = 4_000;
const MAX_REPLY_BYTES = 64 * 1024;
export const PROVIDER_TIMEOUT_MS = 30_000;

export type ProviderConfig = {
  apiKey: string;
  model: string;
  fetch: typeof fetch;
  timeoutMs: number;
};
export type ProviderFailure =
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_ERROR"
  | "PROVIDER_REFUSED"
  | "PROVIDER_TRUNCATED"
  | "PROVIDER_MALFORMED";
export type ProviderResult = { ok: true; intents: Intent[] } | { ok: false; code: ProviderFailure };

/** Context the reader may see: the prompt and names from the selected run only. */
export type ProviderContext = {
  prompt: string;
  selectedWeek: string | null;
  selectedItemId: string | null;
  forecastStart: string;
  forecastEnd: string;
  /** Customer, vendor and record ids of the run's open records, bounded. */
  names: string[];
};

const SYSTEM = [
  "You classify one finance question about a saved 13-week cash forecast into intents.",
  "Return only JSON matching the schema. Do not answer the question or compute anything.",
  "Every *Text field must be copied exactly from the person's words, or null if they did not say it.",
  "Never infer an amount, date, day count, month count or name the person did not type.",
  "Use 'unsupported' for daily cash floors, headcount or hiring budgets, or other changes outside the schema.",
  "Use 'unclear' when the request is too vague to classify.",
].join("\n");

const ReplySchema = z.object({
  stop_reason: z.string().nullable(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()),
});

/** Each copied phrase must appear in the prompt, so the reader cannot invent values. */
function copiedFromPrompt(intents: Intent[], prompt: string, selected: string[]): boolean {
  const p = prompt.toLowerCase();
  return intents.every((i) =>
    wordsOf(i).every((w) => p.includes(w.toLowerCase()) || selected.includes(w)),
  );
}

export async function readWithProvider(
  ctx: ProviderContext,
  config: ProviderConfig,
): Promise<ProviderResult> {
  const body = {
    model: config.model,
    max_tokens: MAX_TOKENS,
    system: SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: INTENTS_JSON_SCHEMA } },
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          prompt: ctx.prompt,
          selectedWeek: ctx.selectedWeek,
          selectedItemId: ctx.selectedItemId,
          forecastWeeks: { from: ctx.forecastStart, to: ctx.forecastEnd },
          knownNames: ctx.names,
        }),
      },
    ],
  };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), config.timeoutMs);
  let text: string;
  try {
    const res = await config.fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify(body),
      signal: abort.signal,
    });
    if (!res.ok) return { ok: false, code: "PROVIDER_ERROR" };
    text = await res.text();
  } catch {
    return { ok: false, code: abort.signal.aborted ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR" };
  } finally {
    clearTimeout(timer);
  }
  if (text.length > MAX_REPLY_BYTES) return { ok: false, code: "PROVIDER_MALFORMED" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, code: "PROVIDER_MALFORMED" };
  }
  const reply = ReplySchema.safeParse(raw);
  if (!reply.success) return { ok: false, code: "PROVIDER_MALFORMED" };
  const stop = reply.data.stop_reason;
  if (stop === "refusal") return { ok: false, code: "PROVIDER_REFUSED" };
  if (stop === "max_tokens") return { ok: false, code: "PROVIDER_TRUNCATED" };
  if (stop !== "end_turn") return { ok: false, code: "PROVIDER_MALFORMED" };
  const texts = reply.data.content.filter((b) => b.type === "text");
  if (texts.length !== 1 || typeof texts[0]?.text !== "string")
    return { ok: false, code: "PROVIDER_MALFORMED" };
  let output: unknown;
  try {
    output = JSON.parse(texts[0].text);
  } catch {
    return { ok: false, code: "PROVIDER_MALFORMED" };
  }
  const intents = IntentsSchema.safeParse(output);
  // Exact: a reply with fields outside the schema is rejected, not silently stripped.
  if (!intents.success || canonicalJson(output) !== canonicalJson(intents.data))
    return { ok: false, code: "PROVIDER_MALFORMED" };
  const selected = [ctx.selectedWeek, ctx.selectedItemId].filter((s): s is string => s !== null);
  if (!copiedFromPrompt(intents.data.intents, ctx.prompt, selected))
    return { ok: false, code: "PROVIDER_MALFORMED" };
  return { ok: true, intents: intents.data.intents };
}
