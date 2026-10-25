import { canonicalJson } from "@domino/contracts";
import { z } from "zod";
import { INTENTS_JSON_SCHEMA, type Intent, IntentsSchema, wordsOf } from "./intent";
import { countTokens, moneyTokens } from "./parse";

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

/** Complete numeric phrases only: "$80" cannot be copied out of "-$80" or "$80,00". */
function copiedFromPrompt(intents: Intent[], prompt: string, selected: string[]): boolean {
  const complete = (word: string) => {
    let start = prompt.indexOf(word);
    while (start !== -1) {
      const before = prompt[start - 1] ?? "";
      const after = prompt[start + word.length] ?? "";
      if (!/[\w]/.test(before) && !/[\w]/.test(after)) return true;
      start = prompt.indexOf(word, start + 1);
    }
    return false;
  };
  const amounts = moneyTokens(prompt);
  const counts = countTokens(prompt);
  return intents.every((i) => {
    if (!wordsOf(i).every((w) => complete(w) || selected.includes(w))) return false;
    if (
      (i.kind === "cash_change" || i.kind === "min_cash_rule") &&
      i.amountText !== null &&
      !amounts.includes(i.amountText)
    )
      return false;
    if (
      (i.kind === "late_invoice" || i.kind === "pay_by_date_rule") &&
      i.daysText !== null &&
      !counts.includes(i.daysText)
    )
      return false;
    if (i.kind === "runway_rule" && i.monthsText !== null && !counts.includes(i.monthsText))
      return false;
    return true;
  });
}

/** Count received UTF8 bytes before decoding or retaining a response body. */
async function boundedText(response: Response): Promise<string | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_REPLY_BYTES) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
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
  let text: string | null;
  try {
    const res = await config.fetch(ENDPOINT, {
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify(body),
      signal: abort.signal,
    });
    if (!res.ok) return { ok: false, code: "PROVIDER_ERROR" };
    text = await boundedText(res);
  } catch {
    return { ok: false, code: abort.signal.aborted ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR" };
  } finally {
    clearTimeout(timer);
  }
  if (text === null) return { ok: false, code: "PROVIDER_MALFORMED" };
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
