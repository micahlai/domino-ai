import { describe, expect, it, vi } from "vitest";
import { type ProviderContext, copiedFromPrompt, readWithProvider } from "./provider";

const ctx: ProviderContext = {
  prompt: "Keep usable cash above $3M",
  selectedWeek: null,
  selectedItemId: null,
  forecastStart: "2026-11-02",
  forecastEnd: "2027-02-07",
  names: ["Acme Logistics"],
};
const ok = (output: unknown, stop = "end_turn", extra: object[] = []) =>
  new Response(
    JSON.stringify({
      stop_reason: stop,
      content: [
        ...extra,
        { type: "text", text: typeof output === "string" ? output : JSON.stringify(output) },
      ],
    }),
  );
const run = (fetchImpl: (...a: Parameters<typeof fetch>) => Promise<Response>, timeoutMs = 1_000) =>
  readWithProvider(ctx, {
    apiKey: "k",
    model: "claude-opus-5-5",
    fetch: fetchImpl as typeof fetch,
    timeoutMs,
  });

describe("question provider adapter", () => {
  it("sends one structured-output request and returns checked intents", async () => {
    const f = vi.fn(async () => ok({ intents: [{ kind: "min_cash_rule", amountText: "$3M" }] }));
    expect(await run(f)).toEqual({
      ok: true,
      intents: [{ kind: "min_cash_rule", amountText: "$3M" }],
    });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers).toMatchObject({ "x-api-key": "k", "anthropic-version": "2026-10-21" });
    expect(init.redirect).toBe("error");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.tools).toBeUndefined();
    expect(body.messages).toHaveLength(1);
  });

  it("ignores thinking blocks around the one text block", async () => {
    const f = async () =>
      ok({ intents: [{ kind: "unclear" }] }, "end_turn", [{ type: "thinking", thinking: "" }]);
    expect(await run(f)).toEqual({ ok: true, intents: [{ kind: "unclear" }] });
  });

  it.each([
    ["refusal", async () => ok({}, "refusal"), "PROVIDER_REFUSED"],
    ["max_tokens", async () => ok('{"intents":[', "max_tokens"), "PROVIDER_TRUNCATED"],
    [
      "pause",
      async () => ok({ intents: [{ kind: "unclear" }] }, "pause_turn"),
      "PROVIDER_MALFORMED",
    ],
    ["http 429", async () => new Response("rate", { status: 429 }), "PROVIDER_ERROR"],
    ["network", async () => Promise.reject(new TypeError("boom")), "PROVIDER_ERROR"],
    ["not json", async () => new Response("<html>"), "PROVIDER_MALFORMED"],
    ["text not json", async () => ok("I think you mean a rule"), "PROVIDER_MALFORMED"],
    [
      "extra field",
      async () => ok({ intents: [{ kind: "unclear" }], answer: "$5M" }),
      "PROVIDER_MALFORMED",
    ],
    [
      "unknown kind",
      async () => ok({ intents: [{ kind: "compute_runway" }] }),
      "PROVIDER_MALFORMED",
    ],
    ["empty intents", async () => ok({ intents: [] }), "PROVIDER_MALFORMED"],
    [
      "too many intents",
      async () => ok({ intents: Array(5).fill({ kind: "unclear" }) }),
      "PROVIDER_MALFORMED",
    ],
    [
      "invented words",
      async () => ok({ intents: [{ kind: "min_cash_rule", amountText: "$4M" }] }),
      "PROVIDER_MALFORMED",
    ],
    [
      "two text blocks",
      async () =>
        new Response(
          JSON.stringify({
            stop_reason: "end_turn",
            content: [
              { type: "text", text: "{}" },
              { type: "text", text: "{}" },
            ],
          }),
        ),
      "PROVIDER_MALFORMED",
    ],
    ["oversized", async () => ok("x".repeat(70_000)), "PROVIDER_MALFORMED"],
  ])("maps %s to a failure code", async (_name, f, code) => {
    expect(await run(f)).toEqual({ ok: false, code });
  });

  it("times out a slow reply", async () => {
    const slow = (_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_res, rej) =>
        init?.signal?.addEventListener("abort", () =>
          rej(new DOMException("aborted", "AbortError")),
        ),
      );
    expect(await run(slow, 5)).toEqual({ ok: false, code: "PROVIDER_TIMEOUT" });
  });

  it("caps received UTF8 bytes before retaining the complete body", async () => {
    let cancelled = false;
    let pulls = 0;
    const bytes = new TextEncoder().encode("界".repeat(11_000));
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(bytes);
      },
      cancel() {
        cancelled = true;
      },
    });
    expect(await run(async () => new Response(stream))).toEqual({
      ok: false,
      code: "PROVIDER_MALFORMED",
    });
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThanOrEqual(3);
  });

  it.each([
    ["Pay -$80 to Atlas on Nov 18", "-$80", "$80"],
    ["Pay $80,00 to Atlas on Nov 18", "$80,00", "$80"],
    ["Pay $80, 000 to Atlas on Nov 18", "$80, 000", "$80"],
    ["Pay $80 000 to Atlas on Nov 18", "$80 000", "$80"],
    ["Pay $80, 00 to Atlas on Nov 18", "$80, 00", "$80"],
    ["Acme pays 1.5 days late", "1.5 days", "5 days"],
  ])("rejects a provider's partial copy from %s", async (prompt, _complete, partial) => {
    const intent = partial.includes("days")
      ? { kind: "late_invoice", itemText: "Acme", daysText: partial }
      : {
          kind: "cash_change",
          direction: "out",
          amountText: partial,
          dateText: "Nov 18",
          counterpartyText: "Atlas",
        };
    expect(
      await readWithProvider(
        { ...ctx, prompt },
        {
          apiKey: "k",
          model: "model",
          timeoutMs: 1_000,
          fetch: async () => ok({ intents: [intent] }),
        },
      ),
    ).toEqual({ ok: false, code: "PROVIDER_MALFORMED" });
  });
  it.each([
    ["Nov 17, 2027", "Nov 17"],
    ["17 Nov 2027", "17 Nov"],
    ["Nov 17,2027", "Nov 17"],
    ["Nov 17, 27", "Nov 17"],
    ["-2026-11-17", "2026-11-17"],
  ])("rejects partial cash and week dates from %s", async (date, partial) => {
    for (const intent of [
      {
        kind: "cash_change",
        direction: "out",
        amountText: "$50,000",
        dateText: partial,
        counterpartyText: "Atlas Legal",
      },
      { kind: "question", topic: "week", weekText: partial, itemText: null },
    ])
      expect(
        await readWithProvider(
          { ...ctx, prompt: `pay $50,000 to Atlas Legal on ${date}` },
          {
            apiKey: "k",
            model: "model",
            timeoutMs: 1_000,
            fetch: async () => ok({ intents: [intent] }),
          },
        ),
      ).toEqual({ ok: false, code: "PROVIDER_MALFORMED" });
  });

  it("accepts whole date phrases and selection only when no explicit date overrides it", () => {
    const date = "Nov 17, 2027";
    const question = {
      kind: "question" as const,
      topic: "week" as const,
      weekText: date,
      itemText: null,
    };
    expect(copiedFromPrompt([question], `What happens on ${date}?`, [])).toBe(true);
    expect(
      copiedFromPrompt([{ ...question, weekText: "2026-11-16" }], "What happens this week?", [
        "2026-11-16",
      ]),
    ).toBe(true);
    expect(
      copiedFromPrompt([{ ...question, weekText: "2026-11-16" }], `What happens on ${date}?`, [
        "2026-11-16",
      ]),
    ).toBe(false);
  });

  it("cannot use a null date span to discard an explicit source date", () => {
    const question = {
      kind: "question" as const,
      topic: "week" as const,
      weekText: null,
      itemText: null,
    };
    expect(
      copiedFromPrompt([question], "What happens in the week of Nov 17, 2027?", ["2026-11-16"]),
    ).toBe(false);
    expect(copiedFromPrompt([question], "What happens this week?", ["2026-11-16"])).toBe(true);
  });
});
