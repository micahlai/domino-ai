import Anthropic from "@anthropic-ai/sdk";

/**
 * Shared Claude access for Timeline chat and questions. Credentials are read when called,
 * never at import, so a deployment without a key keeps the fixed-grammar behavior.
 */
export const DEFAULT_ASSISTANT_MODEL = "claude-opus-5-5";
export const ASSISTANT_TIMEOUT_MS = 60_000;
/** Whole loop, including SDK retries. Keep below the durable 150-second question lease. */
export const ASSISTANT_TOTAL_TIMEOUT_MS = 110_000;
const MAX_TOKENS = 16_000;

export type ClaudeTool = {
  name: string;
  description: string;
  input_schema: Anthropic.Beta.BetaTool.InputSchema;
  /** Runs locally (may await, for example a bounded estimate); the JSON goes back to Claude. */
  run: (input: unknown) => unknown | Promise<unknown>;
};

export class AssistantUnavailable extends Error {}

export function assistantConfig(): { client: Anthropic; model: string } | null {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  // TIMELINE_ASSISTANT=off keeps the earlier one-shot reader and fixed grammar.
  if (!apiKey || process.env.TIMELINE_ASSISTANT === "off") return null;
  return {
    client: new Anthropic({ apiKey, timeout: ASSISTANT_TIMEOUT_MS, maxRetries: 1 }),
    model: process.env.TIMELINE_ASSISTANT_MODEL?.trim() || DEFAULT_ASSISTANT_MODEL,
  };
}

/**
 * Manual tool loop that ends in one structured JSON reply. Tools run in order against the
 * saved run; Claude never sees anything outside the context and tool results we pass.
 */
export async function runStructured(opts: {
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  schema: Record<string, unknown>;
  tools?: ClaudeTool[];
  maxSteps?: number;
  /** Returns a correction for an unusable final reply, or null. One correction is sent back. */
  check?: (value: unknown) => string | null;
}): Promise<unknown> {
  const config = assistantConfig();
  if (!config) throw new AssistantUnavailable("ANTHROPIC_API_KEY is not set");
  const tools = opts.tools ?? [];
  const messages = [...opts.messages];
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort.abort();
      reject(new Error("PROVIDER_TIMEOUT"));
    }, ASSISTANT_TOTAL_TIMEOUT_MS);
  });
  let repairs = opts.check ? 1 : 0;
  // The repair turn gets its own step so a tool-heavy reply can still be corrected.
  const steps = (opts.maxSteps ?? 5) + repairs;
  try {
    for (let step = 0; step < steps; step++) {
      if (abort.signal.aborted) throw new Error("PROVIDER_TIMEOUT");
      const response = await Promise.race([
        config.client.beta.messages.create(
          {
            model: config.model,
            max_tokens: MAX_TOKENS,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            output_config: { effort: "low", format: { type: "json_schema", schema: opts.schema } },
            system: opts.system,
            ...(tools.length
              ? {
                  tools: tools.map(({ name, description, input_schema }) => ({
                    name,
                    description,
                    input_schema,
                  })),
                }
              : {}),
            messages,
          },
          { signal: abort.signal },
        ),
        deadline,
      ]);
      if (response.stop_reason === "refusal") throw new Error("PROVIDER_REFUSED");
      if (response.stop_reason === "max_tokens") throw new Error("PROVIDER_TRUNCATED");
      // Append the full content (thinking blocks included) so the next turn stays valid.
      messages.push({ role: "assistant", content: response.content });
      if (response.stop_reason === "tool_use") {
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type !== "tool_use") continue;
          const tool = tools.find((t) => t.name === block.name);
          let content: string;
          let isError = false;
          try {
            if (!tool) throw new Error(`Unknown tool ${block.name}`);
            content = JSON.stringify(await tool.run(block.input));
          } catch (error) {
            isError = true;
            content = error instanceof Error ? error.message : "Tool failed";
          }
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content,
            ...(isError ? { is_error: true } : {}),
          });
        }
        messages.push({ role: "user", content: results });
        continue;
      }
      if (response.stop_reason !== "end_turn") throw new Error("PROVIDER_MALFORMED");
      const text = response.content.find((b) => b.type === "text");
      if (!text || text.type !== "text") throw new Error("PROVIDER_MALFORMED");
      const value: unknown = JSON.parse(text.text);
      const issue = opts.check?.(value) ?? null;
      if (!issue) return value;
      if (repairs === 0) throw new Error(`PROVIDER_REPLY_REJECTED: ${issue}`);
      repairs = 0;
      messages.push({ role: "user", content: `Your reply was not accepted: ${issue}` });
    }
    throw new Error("PROVIDER_MALFORMED");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
