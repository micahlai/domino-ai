import type { AgentJob } from "@domino/contracts";
import { z } from "zod";
import { failer } from "./errors";
import { acceptCandidate } from "./extract";
import { type TransportRuntime, boundedFetch, byteLength, runtimeFrom } from "./http";
import { buildClaudeRequest, defaultMaxTokens } from "./prompts";
import type { ProviderClient } from "./types";

export const CLAUDE_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2026-10-21";

export interface ClaudeOptions extends Partial<TransportRuntime> {
  /** Per request, covering headers and body. */
  timeoutMs?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  maxTokens?: Partial<Record<AgentJob, number>>;
}

export const claudeDefaults = {
  timeoutMs: 120_000,
  maxRequestBytes: 512 * 1024,
  maxResponseBytes: 1024 * 1024,
};

const messageSchema = z.object({
  type: z.literal("message"),
  role: z.literal("assistant"),
  content: z.array(z.object({ type: z.string() }).passthrough()),
  stop_reason: z.string().nullable(),
});
const textBlock = z.object({ type: z.literal("text"), text: z.string() }).passthrough();

/** Wire shape for FieldMapping.fields under Claude's closed-object schema dialect. */
const wireMapping = z
  .object({ fields: z.array(z.object({ canonical: z.string(), source: z.string() }).strict()) })
  .passthrough();

/**
 * Claude Messages transport. Reads credentials when called, never at import, so a missing
 * key fails only this provider and the router can still fall back.
 */
export function createClaudeClient(
  env: Record<string, string | undefined>,
  options: ClaudeOptions = {},
): ProviderClient {
  const runtime = runtimeFrom(options);
  const timeoutMs = options.timeoutMs ?? claudeDefaults.timeoutMs;
  const maxRequestBytes = options.maxRequestBytes ?? claudeDefaults.maxRequestBytes;
  const maxResponseBytes = options.maxResponseBytes ?? claudeDefaults.maxResponseBytes;

  return {
    async run(job, input) {
      const fail = failer("claude", job);
      const apiKey = env.ANTHROPIC_API_KEY?.trim();
      const model = env.ANTHROPIC_MODEL?.trim();
      // No invented default model: the deployment must choose one it is entitled to.
      if (!apiKey || !model) throw fail("config");

      const maxTokens = options.maxTokens?.[job] ?? defaultMaxTokens[job];
      const body = JSON.stringify(buildClaudeRequest(job, input, model, maxTokens));
      if (byteLength(body) > maxRequestBytes) throw fail("input_too_large");

      const response = await boundedFetch(
        runtime,
        CLAUDE_MESSAGES_URL,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
            accept: "application/json",
          },
          body,
        },
        { timeoutMs, maxBytes: maxResponseBytes },
        fail,
      );
      if (response.status >= 300 && response.status < 400) throw fail("redirect_rejected");
      if (response.status !== 200) throw fail("http_status", response.status);

      const message = messageSchema.safeParse(parseJson(response.text));
      if (!message.success) throw fail("malformed_response");
      const stop = message.data.stop_reason;
      if (stop === "refusal") throw fail("refusal");
      if (stop === "max_tokens" || stop === "model_context_window_exceeded") {
        throw fail("truncated");
      }
      if (stop !== "end_turn") throw fail("unexpected_stop");

      // Structured output arrives as exactly one text block; anything else is unexpected.
      const [only, ...rest] = message.data.content;
      const block = textBlock.safeParse(only);
      if (rest.length > 0 || !block.success) throw fail("malformed_response");
      const json = parseJson(block.data.text);
      if (json === undefined) throw fail("malformed_response");

      const contractJson = job === "mapSource" ? mappingFromWire(json) : json;
      if (contractJson === undefined) throw fail("invalid_output");
      const accepted = acceptCandidate(job, input, { json: contractJson }, { bareArray: false });
      if (!accepted) throw fail("invalid_output");
      return accepted.value;
    },
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** {result: [{fields: [{canonical, source}]}]} -> contract records; duplicate keys fail. */
function mappingFromWire(json: unknown): unknown {
  const envelope = z
    .object({ result: z.array(wireMapping) })
    .strict()
    .safeParse(json);
  if (!envelope.success) return undefined;
  const result: unknown[] = [];
  for (const mapping of envelope.data.result) {
    const fields: Record<string, string> = {};
    for (const pair of mapping.fields) {
      if (pair.canonical === "__proto__" || Object.hasOwn(fields, pair.canonical)) {
        return undefined;
      }
      fields[pair.canonical] = pair.source;
    }
    result.push({ ...mapping, fields });
  }
  return { result };
}
