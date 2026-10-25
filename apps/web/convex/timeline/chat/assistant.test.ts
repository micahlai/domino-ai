/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { WeeklySeedV1Schema, canonicalJson, contentHashPreimage } from "@domino/contracts";
import { weeklyBoundaryFixtures } from "@domino/contracts/fixtures";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureWorkerContext } from "../../../components/timeline/chat/workerFixture";
import { FieldTraceSchema } from "../../../lib/field-trace-contract";
import schema from "../../schema";
import { ASSISTANT_TOTAL_TIMEOUT_MS, runStructured } from "../assistant/claude";
import type { Intent } from "../questions/intent";
import type { QuestionReceipt } from "../questions/receipt";
import { baselineRefs } from "../refs";
import { sha256Hex } from "../workspaceInput";
import { workspaceRefs } from "../workspaceRefs";
import { statement } from "./draft";
import type { ChatReceipt } from "./receipt";
import { chatRefs } from "./refs";

const modules = Object.fromEntries(
  Object.entries(
    import.meta.glob([
      "../../**/*.ts",
      "../../_generated/*.js",
      "!../../**/*.test.ts",
      "!../../**/*.test-support.ts",
    ]),
  ).map(([path, load]) => [
    path.startsWith("../../")
      ? path
      : path.startsWith("../")
        ? `../../timeline/${path.slice(3)}`
        : `../../timeline/chat/${path.slice(2)}`,
    load,
  ]),
);
const setup = () => convexTest(schema, modules);
type T = ReturnType<typeof setup>;
let serial = 0;
const rid = () => `assistant-test-${++serial}`;

const assistantSend = makeFunctionReference<
  "action",
  {
    companyId: string;
    conversationId: string;
    requestId: string;
    expectedRevision: number;
    text: string;
  },
  ChatReceipt
>("timeline/chatAssistant:send");
const ask = makeFunctionReference<
  "action",
  { companyId: string; runId: string; requestId: string; prompt: string; selectedWeek?: string },
  QuestionReceipt
>("timeline/questions:ask");

async function source(
  t: T,
  seed = WeeklySeedV1Schema.parse(weeklyBoundaryFixtures.validKestrelWeeklySeed),
) {
  const saved = await t.mutation(baselineRefs.save, {
    requestId: rid(),
    seedJson: JSON.stringify(seed),
    modelJson: JSON.stringify({ version: 0, customerDelayDays: {}, recurringSpend: [], rules: [] }),
    constraintsJson: "[]",
    assumptionNote: "Labelled synthetic Kestrel fixture",
    reviewed: true,
  });
  const opened = await t.mutation(workspaceRefs.open, {
    companyId: seed.company.id,
    baselineRunId: saved.runId,
    requestId: rid(),
  });
  return { companyId: seed.company.id, runId: opened.runId };
}
const key = (r: ChatReceipt) => ({ companyId: r.companyId, conversationId: r.conversationId });

/** Scripted Messages API: each call returns the next reply; request bodies are recorded. */
function scriptClaude(replies: { content: unknown[]; stop_reason: string }[]) {
  const bodies: Record<string, unknown>[] = [];
  const spy = vi.fn(async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const next = replies.shift();
    if (!next) throw new Error("unexpected Claude call");
    return new Response(
      JSON.stringify({
        id: `msg_${bodies.length}`,
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
        ...next,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", spy);
  return { spy, bodies };
}
const toolUse = (name: string, input: unknown) => ({
  content: [{ type: "tool_use", id: `toolu_${name}`, name, input }],
  stop_reason: "tool_use",
});
const final = (json: unknown) => ({
  content: [{ type: "text", text: JSON.stringify(json) }],
  stop_reason: "end_turn",
});
const atlas = {
  kind: "cash_change",
  direction: "out",
  amountText: "$50,000",
  dateText: "2026-11-17",
  counterpartyText: "Atlas Legal",
};

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("Unscripted provider request");
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const exactText = "pay $50,000 to Atlas Legal on 2026-11-17";
const turn = (r: ChatReceipt, text = exactText) => ({
  ...key(r),
  requestId: rid(),
  expectedRevision: r.revision,
  text,
});
const claimTurn = makeFunctionReference<
  "mutation",
  ReturnType<typeof turn>,
  { kind: string; receipt: ChatReceipt; attempt?: number }
>("timeline/chat:claimAssistantTurn");
const saveTurn = makeFunctionReference<
  "mutation",
  ReturnType<typeof turn> & { attempt: number; intentsJson: string | null },
  ChatReceipt
>("timeline/chat:saveAssistantTurn");
const failTurn = makeFunctionReference<
  "mutation",
  ReturnType<typeof turn> & { attempt: number },
  ChatReceipt | null
>("timeline/chat:failAssistantTurn");
const done = () => final({ reply: "Let’s review the request together." });
const classify = (intents: unknown[]) =>
  scriptClaude([
    toolUse("update_draft", { request: (intents as Intent[]).map(statement).join("; "), intents }),
    done(),
  ]);
const noNetwork = () => {
  const spy = vi.fn(async () => {
    throw new Error("Provider must not run");
  });
  vi.stubGlobal("fetch", spy);
  return spy;
};

describe("Claude Timeline chat safety", () => {
  it("saves checked user spans and the actual model reply", async () => {
    const t = setup();
    const src = await source(t);
    const { bodies } = classify([atlas]);
    const r = await t.mutation(chatRefs.begin, { ...src, requestId: rid() });
    const saved = await t.action(assistantSend, turn(r));
    expect(saved.status).toBe("ready");
    expect(saved.turns.at(-2)?.text).toBe(exactText);
    expect(saved.turns.at(-1)?.text).toBe("Let’s review the request together.");
    expect(JSON.stringify(bodies[0]?.messages)).toMatch(/openInvoices/);
    const g = await t.mutation(chatRefs.begin, { ...src, requestId: rid() });
    const grammar = await t.mutation(chatRefs.send, turn(g));
    expect(saved.proposal).toEqual(grammar.proposal);
  });

  it("uses the provider for pending fields and corrections while keeping grounded values", async () => {
    const t = setup();
    classify([{ ...atlas, dateText: null }]);
    const r = await t.mutation(chatRefs.begin, { ...(await source(t)), requestId: rid() });
    const pending = await t.action(assistantSend, turn(r, "pay $50,000 to Atlas Legal"));
    expect(pending.pendingField).toBe("date");
    const first = classify([atlas]);
    const ready = await t.action(assistantSend, turn(pending, "2026-11-17"));
    expect(first.spy).toHaveBeenCalledTimes(2);
    const second = classify([{ ...atlas, amountText: "$80,000" }]);
    expect(ready.status).toBe("ready");
    const corrected = await t.action(assistantSend, turn(ready, "change amount to $80,000"));
    expect(corrected.proposal?.changes[0]).toMatchObject({ amount: 8_000_000 });
    expect(second.spy).toHaveBeenCalledTimes(2);
  });

  it("replays an accepted turn without a provider even after later turns or configuration changes", async () => {
    const t = setup();
    classify([atlas]);
    const r = await t.mutation(chatRefs.begin, { ...(await source(t)), requestId: rid() });
    const input = turn(r);
    const accepted = await t.action(assistantSend, input);
    await t.mutation(chatRefs.reset, {
      ...key(accepted),
      requestId: rid(),
      expectedRevision: accepted.revision,
    });
    const spy = noNetwork();
    expect(await t.action(assistantSend, input)).toEqual(accepted);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await t.action(assistantSend, input)).toEqual(accepted);
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects reused request keys for changed text, revision or conversation before provider", async () => {
    const t = setup();
    classify([atlas]);
    const src = await source(t);
    const r = await t.mutation(chatRefs.begin, { ...src, requestId: rid() });
    const other = await t.mutation(chatRefs.begin, { ...src, requestId: rid() });
    const input = turn(r);
    await t.action(assistantSend, input);
    const spy = noNetwork();
    for (const changed of [
      { ...input, text: "another message" },
      { ...input, expectedRevision: 1 },
      { ...input, conversationId: other.conversationId },
    ])
      await expect(t.action(assistantSend, changed)).rejects.toThrow(/different chat inputs/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("claims concurrent exact retries once and returns an unconfirmed original revision", async () => {
    const t = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi.fn(async () => {
      await gate;
      return new Response(
        JSON.stringify({
          id: "msg_one",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          usage: { input_tokens: 1, output_tokens: 1 },
          ...done(),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", spy);
    const r = await t.mutation(chatRefs.begin, { ...(await source(t)), requestId: rid() });
    const input = turn(r);
    const first = t.action(assistantSend, input);
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const duplicate = await t.action(assistantSend, input);
    expect(duplicate).toEqual(r);
    expect(spy).toHaveBeenCalledTimes(1);
    release();
    const accepted = await first;
    expect(accepted.revision).toBe(1);
    expect(await t.action(assistantSend, input)).toEqual(accepted);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("recovers a committed turn after an uncertain response and ignores regenerated output", async () => {
    const t = setup();
    const r = await t.mutation(chatRefs.begin, { ...(await source(t)), requestId: rid() });
    const input = turn(r);
    const claim = await t.mutation(claimTurn, input);
    const attempt = claim.attempt as number;
    const accepted = await t.mutation(saveTurn, {
      ...input,
      attempt,
      intentsJson: JSON.stringify([atlas]),
    });
    // Simulate the action's recovery after the save committed but its response was lost.
    expect(await t.mutation(failTurn, { ...input, attempt })).toEqual(accepted);
    expect(
      await t.mutation(saveTurn, { ...input, attempt, intentsJson: "invalid regenerated JSON" }),
    ).toEqual(accepted);
    const spy = noNetwork();
    expect(await t.action(assistantSend, input)).toEqual(accepted);
    expect(spy).not.toHaveBeenCalled();
    expect((await t.query(chatRefs.get, key(r)))?.turns).toHaveLength(3);
  });

  it("reclaims abandoned requests while excluding a late earlier attempt", async () => {
    const t = setup();
    const r = await t.mutation(chatRefs.begin, { ...(await source(t)), requestId: rid() });
    const input = turn(r);
    const first = await t.mutation(claimTurn, input);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 140_001);
    const second = await t.mutation(claimTurn, input);
    expect(second.attempt).toBe((first.attempt as number) + 1);
    await expect(
      t.mutation(saveTurn, {
        ...input,
        attempt: first.attempt as number,
        intentsJson: JSON.stringify([atlas]),
      }),
    ).rejects.toThrow(/reply expired/);
    expect(await t.mutation(failTurn, { ...input, attempt: first.attempt as number })).toBeNull();
    const accepted = await t.mutation(saveTurn, {
      ...input,
      attempt: second.attempt as number,
      intentsJson: JSON.stringify([atlas]),
    });
    expect(accepted.status).toBe("ready");
    expect(accepted.revision).toBe(1);
  });

  it("rejects a provider result if its source revision changed while it was running", async () => {
    const t = setup();
    const r = await t.mutation(chatRefs.begin, { ...(await source(t)), requestId: rid() });
    const input = turn(r);
    const claim = await t.mutation(claimTurn, input);
    const reset = await t.mutation(chatRefs.reset, {
      ...key(r),
      expectedRevision: r.revision,
      requestId: rid(),
    });
    await expect(
      t.mutation(saveTurn, {
        ...input,
        attempt: claim.attempt as number,
        intentsJson: JSON.stringify([atlas]),
      }),
    ).rejects.toThrow(/chat has changed/);
    expect(await t.query(chatRefs.get, key(r))).toEqual(reset);
  });

  it("checks stale, saved and turn-limit states before provider", async () => {
    const t = setup();
    const src = await source(t);
    const r = await t.mutation(chatRefs.begin, { ...src, requestId: rid() });
    const ready = await t.mutation(chatRefs.send, turn(r));
    const spy = noNetwork();
    await expect(t.action(assistantSend, turn(r))).rejects.toThrow(/chat has changed/);
    const saved = await t.mutation(chatRefs.confirm, {
      ...key(ready),
      requestId: rid(),
      expectedRevision: ready.revision,
      reviewed: true,
    });
    scriptClaude([final({ reply: "We can discuss the saved result." })]);
    const discussed = await t.action(assistantSend, turn(saved, "Explain the saved result"));
    expect(discussed.status).toBe("saved");
    expect(discussed.linkedRunId).toBe(saved.linkedRunId);
    let full = await t.mutation(chatRefs.begin, { ...src, requestId: rid() });
    for (let i = 0; i < 20; i++) full = await t.mutation(chatRefs.send, turn(full, "hello"));
    await expect(t.action(assistantSend, turn(full))).rejects.toThrow(/20 user turns/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("releases definite provider failure for an exact retry without changing the conversation", async () => {
    const t = setup();
    scriptClaude([final({ wrong: true })]);
    const r = await t.mutation(chatRefs.begin, { ...(await source(t)), requestId: rid() });
    const input = turn(r);
    await expect(t.action(assistantSend, input)).rejects.toThrow(/could not finish/);
    expect(await t.query(chatRefs.get, key(r))).toEqual(r);
    classify([atlas]);
    expect((await t.action(assistantSend, input)).status).toBe("ready");
  });

  it("replays pre-repair assistant and grammar receipts but rejects legacy conflicting inputs", async () => {
    const t = setup();
    const src = await source(t);
    for (const legacy of ["assistant", "send"]) {
      const r = await t.mutation(chatRefs.begin, { ...src, requestId: rid() });
      const input = turn(r);
      const accepted = await t.mutation(chatRefs.send, input);
      if (legacy === "assistant")
        await t.run(async (ctx) => {
          const row = await ctx.db
            .query("timelineChatRequests")
            .withIndex("by_company_and_requestId", (q) =>
              q.eq("companyId", input.companyId).eq("requestId", input.requestId),
            )
            .unique();
          if (!row) throw new Error("missing fixture request");
          await ctx.db.patch(row._id, {
            requestHash: await sha256Hex(
              canonicalJson({
                method: "timeline_chat@1",
                op: "assistant",
                args: { companyId: input.companyId, requestId: input.requestId },
              }),
            ),
          });
        });
      const spy = noNetwork();
      expect(await t.action(assistantSend, input)).toEqual(accepted);
      await expect(t.action(assistantSend, { ...input, text: "different" })).rejects.toThrow(
        /different chat inputs/,
      );
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("fails retryably without a key instead of bypassing the model", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const t = setup();
    const spy = noNetwork();
    const r = await t.mutation(chatRefs.begin, { ...(await source(t)), requestId: rid() });
    await expect(t.action(assistantSend, turn(r))).rejects.toThrow(/unavailable or not configured/);
    expect(await t.query(chatRefs.get, key(r))).toEqual(r);
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    "do not pay $50,000 to Atlas Legal on 2026-11-17",
    "pay $50,000 to Atlas Legal on 2026-11-17 if Acme pays",
    "keep usable cash above $50,000 daily",
    "keep usable cash at most $50,000",
  ])(
    "discusses qualified requests through the provider without creating a proposal: %s",
    async (text) => {
      const t = setup();
      const { spy } = scriptClaude([
        final({ reply: "Let’s clarify that assumption before making a change." }),
      ]);
      const r = await t.mutation(chatRefs.begin, { ...(await source(t)), requestId: rid() });
      const after = await t.action(assistantSend, turn(r, text));
      expect(after.proposal).toBeNull();
      expect(spy).toHaveBeenCalledTimes(1);
    },
  );

  it("checks qualified draft tool calls against the person's actual words", async () => {
    const t = setup();
    const src = await source(t);
    for (const text of [
      "pay $50,000 to Atlas Legal on 2026-11-17 daily",
      "pay at most $50,000 to Atlas Legal on 2026-11-17",
      "pay at   most $50,000 to Atlas Legal on 2026-11-17",
    ]) {
      const initial = await t.mutation(chatRefs.begin, { ...src, requestId: rid() });
      const { spy } = classify([atlas]);
      const after = await t.action(assistantSend, turn(initial, text));
      expect(after.proposal).toBeNull();
      expect(after.status).toBe("collecting");
      expect(spy).toHaveBeenCalledTimes(2);
    }
  });

  it("keeps internal grammar integrity for malformed explicit years or signs", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const t = setup();
    const src = await source(t);
    const spy = noNetwork();
    for (const date of ["Nov 17,2027", "Nov 17, 27", "-2026-11-17"]) {
      const text = `pay $50,000 to Atlas Legal on ${date}`;
      const r = await t.mutation(chatRefs.begin, { ...src, requestId: rid() });
      expect((await t.mutation(chatRefs.send, turn(r, text))).proposal).toBeNull();
      const question = await t.action(ask, { ...src, requestId: rid(), prompt: text });
      expect(question.status).toBe("clarification");
      expect(question.proposal).toBeNull();
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects a truncated explicit year in both chat and question proposals", async () => {
    const t = setup();
    const src = await source(t);
    const text = "pay $50,000 to Atlas Legal on Nov 17, 2027";
    const shortened = { ...atlas, dateText: "Nov 17" };
    classify([shortened]);
    const r = await t.mutation(chatRefs.begin, { ...src, requestId: rid() });
    const chat = await t.action(assistantSend, turn(r, text));
    expect(chat.proposal).toBeNull();
    expect(chat.turns.at(-1)?.text).toBe("Let’s review the request together.");
    scriptClaude([
      toolUse("check_request", { intents: [shortened] }),
      final({ answer: "Checked" }),
    ]);
    const question = await t.action(ask, { ...src, requestId: rid(), prompt: text });
    expect(question.status).toBe("clarification");
    expect(question.proposal).toBeNull();
    expect(question.answer).toMatch(/verify every suggested value/);
  });

  it("rejects a missing model date when the original chat already specifies a year", async () => {
    const t = setup();
    classify([{ ...atlas, dateText: null }]);
    const r = await t.mutation(chatRefs.begin, { ...(await source(t)), requestId: rid() });
    const after = await t.action(
      assistantSend,
      turn(r, "pay $50,000 to Atlas Legal on Nov 17, 2027"),
    );
    expect(after.proposal).toBeNull();
    expect(after.pendingField).toBeNull();
    expect(after.turns.at(-1)?.text).toBe("Let’s review the request together.");
  });

  it("does not borrow a whole date from another cash clause to drop an explicit year", async () => {
    const t = setup();
    const src = await source(t);
    const text = "pay $50,000 to Atlas Legal on Nov 17, 2027. Receive $10,000 from Acme on Nov 17";
    const intents = [
      { ...atlas, dateText: "Nov 17" },
      {
        ...atlas,
        direction: "in",
        amountText: "$10,000",
        dateText: "Nov 17",
        counterpartyText: "Acme",
      },
    ];
    classify(intents);
    const r = await t.mutation(chatRefs.begin, { ...src, requestId: rid() });
    const chat = await t.action(assistantSend, turn(r, text));
    expect(chat.status).toBe("collecting");
    expect(chat.proposal).toBeNull();
    scriptClaude([toolUse("check_request", { intents }), final({ answer: "Checked" })]);
    const question = await t.action(ask, { ...src, requestId: rid(), prompt: text });
    expect(question.status).toBe("clarification");
    expect(question.proposal).toBeNull();
  });

  it.each([
    { ...atlas, amountText: "$999M" },
    { ...atlas, dateText: "2026-11-24" },
    { ...atlas, counterpartyText: "Invented Vendor" },
  ])("rejects invented model slots: %j", async (intent) => {
    const t = setup();
    classify([intent]);
    const r = await t.mutation(chatRefs.begin, { ...(await source(t)), requestId: rid() });
    const after = await t.action(assistantSend, turn(r));
    expect(after.proposal).toBeNull();
    expect(after.turns.at(-1)?.text).toBe("Let’s review the request together.");
  });
});

describe("one chat for questions and what-ifs", () => {
  it("keeps the internal deterministic resolver independently testable", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const t = setup();
    let r = await t.mutation(chatRefs.begin, { ...(await source(t)), requestId: rid() });
    r = await t.mutation(chatRefs.send, {
      ...key(r),
      requestId: rid(),
      expectedRevision: r.revision,
      text: "When is the low point?",
    });
    expect(r.status).toBe("collecting");
    expect(r.proposal).toBeNull();
    expect(r.turns.at(-1)?.citations?.length).toBeGreaterThan(0);
  });

  it("answers a question in the assistant chat with the checked answer and sources", async () => {
    const t = setup();
    const src = await source(t);
    scriptClaude([
      toolUse("lookup_forecast", { topic: "low_point", weekText: null, itemText: null }),
      final({ reply: "The saved low point is shown in your forecast; its sources are attached." }),
    ]);
    let r = await t.mutation(chatRefs.begin, { ...src, requestId: rid() });
    r = await t.action(assistantSend, turn(r, "When is the low point?"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    let g = await t.mutation(chatRefs.begin, { ...src, requestId: rid() });
    g = await t.mutation(chatRefs.send, { ...turn(g, "When is the low point?") });
    expect(r.proposal).toBeNull();
    expect(r.turns.at(-1)?.text).toBe(
      "The saved low point is shown in your forecast; its sources are attached.",
    );
    expect(r.turns.at(-1)?.citations).toEqual(g.turns.at(-1)?.citations);
    expect(r.turns.at(-1)?.citations?.length).toBeGreaterThan(0);
  });
});

describe("conversational context and required LLM", () => {
  it("discusses the exact lawsuit message and resolves its meaning across turns", async () => {
    const t = setup();
    let r = await t.mutation(chatRefs.begin, { ...(await source(t)), requestId: rid() });
    const question =
      "Do you mean a $40M cash payment on Dec 7, 2026, or a possible liability? A lawsuit does not automatically mean cash leaves then.";
    const first = scriptClaude([final({ reply: question })]);
    r = await t.action(assistantSend, turn(r, "what if $40M lawsuit dec 7 2026"));
    expect(r.turns.at(-1)?.text).toBe(question);
    expect(r.proposal).toBeNull();
    expect(first.spy).toHaveBeenCalledTimes(1);
    const second = classify([
      { ...atlas, amountText: "$40M", dateText: "dec 7 2026", counterpartyText: "lawsuit" },
    ]);
    r = await t.action(assistantSend, turn(r, "Treat it as a cash payment"));
    expect(r.proposal?.changes[0]).toMatchObject({
      kind: "remove_cash",
      amount: 4_000_000_000,
      date: "2026-12-07",
    });
    const messages = second.bodies[0]?.messages as { role: string; content: string }[];
    expect(messages).toContainEqual({ role: "user", content: "what if $40M lawsuit dec 7 2026" });
    expect(messages).toContainEqual({ role: "assistant", content: question });
    expect(messages.at(-1)?.content).toBe("Treat it as a cash payment");
    expect(r.linkedRunId).toBeNull();
  });

  it("keeps a pending draft during a separate question and sends all transcript turns", async () => {
    const t = setup();
    let r = await t.mutation(chatRefs.begin, { ...(await source(t)), requestId: rid() });
    classify([{ ...atlas, dateText: null }]);
    r = await t.action(assistantSend, turn(r, "pay $50,000 to Atlas Legal"));
    const { bodies } = scriptClaude([
      toolUse("lookup_forecast", { topic: "rules", weekText: null, itemText: null }),
      final({ reply: "We can inspect the saved rules before choosing a date." }),
    ]);
    const prior = r;
    r = await t.action(assistantSend, turn(r, "Why do you need a date?"));
    expect(r.pendingField).toBe("date");
    const messages = bodies[0]?.messages as { role: string; content: string }[];
    expect(messages.slice(1, -1)).toEqual(
      prior.turns.map((x) => ({ role: x.role, content: x.text })),
    );
    classify([atlas]);
    r = await t.action(assistantSend, turn(r, "2026-11-17"));
    expect(r.proposal?.changes[0]).toMatchObject({ amount: 5_000_000 });
  });

  it("will not ignore a newly supplied amount in favor of an older draft", async () => {
    const t = setup();
    let r = await t.mutation(chatRefs.begin, { ...(await source(t)), requestId: rid() });
    classify([atlas]);
    r = await t.action(assistantSend, turn(r));
    classify([atlas]);
    r = await t.action(assistantSend, turn(r, "Make that $80,000"));
    expect(r.proposal).toBeNull();
  });

  it("keeps old turns for discussion after reset but cannot reuse their draft values", async () => {
    const t = setup();
    let r = await t.mutation(chatRefs.begin, { ...(await source(t)), requestId: rid() });
    classify([atlas]);
    r = await t.action(assistantSend, turn(r));
    r = await t.mutation(chatRefs.reset, {
      ...key(r),
      requestId: rid(),
      expectedRevision: r.revision,
    });
    const { bodies } = classify([atlas]);
    r = await t.action(assistantSend, turn(r, "Use the old one"));
    expect(r.proposal).toBeNull();
    expect(JSON.stringify(bodies[0]?.messages)).toContain(exactText);
    const context = JSON.parse((bodies[0]?.messages as { content: string }[])[0]!.content);
    expect(context.activeUserMessages).toEqual([
      { turn: r.turns.length - 2, text: "Use the old one" },
    ]);
  });

  it.each(["hello", "2026-11-17", "do not pay", "How could a recurring payment work?"])(
    "never falls back without a model: %s",
    async (text) => {
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      const t = setup();
      const r = await t.mutation(chatRefs.begin, { ...(await source(t)), requestId: rid() });
      const input = turn(r, text);
      await expect(t.action(assistantSend, input)).rejects.toThrow(/unavailable or not configured/);
      expect(await t.query(chatRefs.get, key(r))).toEqual(r);
      vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
      scriptClaude([final({ reply: "We can talk through the assumptions together." })]);
      const retried = await t.action(assistantSend, input);
      expect(retried.revision).toBe(1);
    },
  );

  it("rejects fabricated money narration and leaves the turn retryable", async () => {
    const t = setup();
    const r = await t.mutation(chatRefs.begin, { ...(await source(t)), requestId: rid() });
    scriptClaude([final({ reply: "The cash forecast is $999M." })]);
    await expect(t.action(assistantSend, turn(r, "How are we doing?"))).rejects.toThrow(
      /could not finish/,
    );
    expect(await t.query(chatRefs.get, key(r))).toEqual(r);
  });

  async function withBrain(t: T) {
    const seed = WeeklySeedV1Schema.parse(weeklyBoundaryFixtures.validKestrelWeeklySeed);
    const at = "2026-10-25T15:00:00.000Z";
    const ids = await t.run(async (ctx) => {
      const companyId = await ctx.db.insert("companies", {
        name: "Kestrel actual Brain",
        profile: "kestrel",
        currentWeek: 0,
        today: seed.snapshot.asOf,
        status: "ready",
      });
      const snapshotId = await ctx.db.insert("snapshots", {
        companyId,
        asOf: seed.snapshot.asOf,
        data: seed.snapshot,
      });
      await ctx.db.insert("models", {
        companyId,
        version: 1,
        data: fixtureWorkerContext.inputs.model.data,
      });
      await ctx.db.insert("feeds", {
        companyId,
        auto: false,
        autoGeneration: 0,
        autoTicksLeft: 0,
        week: 0,
        snapshotVersion: 2,
        lastSnapshotId: snapshotId,
        lastSnapshotHash: null,
        lastSnapshotAt: at,
        lastIngestAt: at,
        lastIngestStatus: "ok",
        lastError: null,
        recordCounts: { invoices: seed.snapshot.invoices.length },
      });
      await ctx.db.insert("findings", {
        companyId,
        findingId: "brain-flag",
        snapshotId,
        version: 2,
        kind: "unusual_timing",
        severity: "high",
        summary: "Brain found Acme payment timing changed",
        refs: [seed.snapshot.invoices[0]!.id],
        detectedAt: at,
        escalated: true,
        status: "open",
      });
      const trace = FieldTraceSchema.parse({
        schemaVersion: 1,
        readOnly: true,
        run: {
          companyId,
          runId: "brain-run",
          snapshotId,
          snapshotVersion: 2,
          asOf: seed.snapshot.asOf,
          trigger: "manual",
          status: "done",
          startedAt: at,
          finishedAt: at,
          summary: "Brain saved cash-risk results",
        },
        selection: { scenarioId: null, fixKind: null },
        evidence: "frozen",
        frozenAt: at,
        inputs: {
          ...fixtureWorkerContext.inputs,
          company: { ...fixtureWorkerContext.inputs.company, id: companyId },
          snapshot: {
            ...fixtureWorkerContext.inputs.snapshot,
            id: snapshotId,
            companyId: seed.company.id,
            version: 2,
          },
        },
        scenarios: [fixtureWorkerContext.scenario],
        candidates: [fixtureWorkerContext.candidate],
        operations: [],
        providers: [],
        aiSummary: null,
        coordinator: null,
        limitations: [],
        truncation: { operations: false, providers: false, scenarios: false, candidates: false },
      });
      await ctx.db.insert("analystRuns", {
        companyId,
        runId: "brain-run",
        snapshotId,
        snapshotVersion: 2,
        asOf: seed.snapshot.asOf,
        trigger: "manual",
        status: "done",
        paceMs: 0,
        children: 0,
        reported: 0,
        startedAt: at,
        finishedAt: at,
        traceReceipt: JSON.stringify(trace),
        aiSummary: {
          status: "done",
          recommendation: "Brain recommends checking collection timing",
          rationale: "Based on saved scenario evidence",
          at,
        },
        coordinator: { status: "done", summary: "Coordinator prioritizes the late customer", at },
        research: [
          {
            name: "Counterparty risk",
            input: "Acme",
            items: ["Research found a payment review signal"],
            provider: "creao",
            remoteRunId: "NEVER-SEND-RAW-PROVIDER-ID",
          },
        ],
      });
      return { companyId, snapshotId };
    });
    seed.id = `field:weekly_seed/${ids.companyId}-v1`;
    seed.contentHash = await sha256Hex(contentHashPreimage(seed));
    const src = await source(t, seed);
    const run = await t.query(workspaceRefs.get, src);
    if (!run) throw new Error("Missing test run");
    await t.run((ctx) =>
      ctx.db.insert("timelineLinks", {
        companyId: ids.companyId,
        timelineCompanyId: src.companyId,
        seedId: seed.id,
        seedHash: seed.contentHash,
        asOf: seed.asOf,
        snapshotVersion: 1,
        baselineRunId: run.baselineRunId,
        runId: src.runId,
        resultRef: "unused",
        analysisId: null,
        analysisError: null,
        savedAt: at,
      }),
    );
    return { src, ids, seed };
  }

  it("sends real linked Brain outputs, research, company books and invoice detail in an ordinary chat", async () => {
    const t = setup();
    const { src, seed } = await withBrain(t);
    const r = await t.mutation(chatRefs.begin, {
      ...src,
      requestId: rid(),
      selectedItemId: seed.snapshot.invoices[0]!.id,
    });
    const { bodies } = scriptClaude([
      final({
        reply: "The Brain found a timing concern; its evidence is newer than this saved timeline.",
      }),
    ]);
    await t.action(assistantSend, turn(r, "Explain what the Brain found about this invoice"));
    const payload = JSON.stringify(bodies[0]?.messages);
    expect(payload).toContain("Brain found Acme payment timing changed");
    expect(payload).toContain("Brain recommends checking collection timing");
    expect(payload).toContain("Coordinator prioritizes the late customer");
    expect(payload).toContain("Research found a payment review signal");
    expect(payload).toContain(fixtureWorkerContext.candidate.fix.label);
    expect(payload).toContain(seed.snapshot.invoices[0]!.id);
    expect(payload).toContain("newer than this Timeline");
    expect(payload).toContain("learnedModel");
    expect(payload).not.toContain("NEVER-SEND-RAW-PROVIDER-ID");
    expect(payload).not.toContain("unavailable");
  });

  it("does not attach Brain output from an unverified or mismatched company link", async () => {
    const t = setup();
    const { src } = await withBrain(t);
    await t.run(async (ctx) => {
      const links = await ctx.db.query("timelineLinks").collect();
      for (const link of links) await ctx.db.patch(link._id, { seedHash: "0".repeat(64) });
      await ctx.db.insert("companies", {
        name: "Kestrel actual Brain",
        profile: "kestrel",
        currentWeek: 0,
        today: "2026-10-30",
        status: "ready",
      });
    });
    const r = await t.mutation(chatRefs.begin, { ...src, requestId: rid() });
    const { bodies } = scriptClaude([
      final({ reply: "There is no verified Brain output linked to these books." }),
    ]);
    await t.action(assistantSend, turn(r, "What did the Brain find?"));
    const payload = JSON.stringify(bodies[0]?.messages);
    expect(payload).toContain("No verified Field link matches");
    expect(payload).not.toContain("Brain found Acme payment timing changed");
  });
});

describe("Claude question grounding", () => {
  it("uses checked financial answers and citations even if the model says $999m", async () => {
    const t = setup();
    const src = await source(t);
    scriptClaude([
      toolUse("check_request", {
        intents: [{ kind: "question", topic: "low_point", weekText: null, itemText: null }],
      }),
      final({ answer: "Cash is $999m and there is no risk." }),
    ]);
    const viaClaude = await t.action(ask, {
      ...src,
      requestId: rid(),
      prompt: "What is the cash low point?",
    });
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const grammar = await t.action(ask, {
      ...src,
      requestId: rid(),
      prompt: "What is the cash low point?",
    });
    expect(viaClaude.answer).toBe(grammar.answer);
    expect(viaClaude.citations).toEqual(grammar.citations);
    expect(viaClaude.citations.length).toBeGreaterThan(0);
    expect(viaClaude.answer).not.toMatch(/999|no risk/);
  });

  it("requires a full explicit year for a question week", async () => {
    const t = setup();
    scriptClaude([
      toolUse("check_request", {
        intents: [{ kind: "question", topic: "week", weekText: "Nov 17", itemText: null }],
      }),
      final({ answer: "Checked" }),
    ]);
    const r = await t.action(ask, {
      ...(await source(t)),
      requestId: rid(),
      prompt: "What happens in the week of Nov 17, 2027?",
    });
    expect(r.status).toBe("clarification");
    expect(r.citations).toEqual([]);
    expect(r.answer).toMatch(/verify every suggested value/);
  });

  it("cannot replace an omitted explicit date with the selected week", async () => {
    const t = setup();
    const src = await source(t);
    scriptClaude([
      toolUse("check_request", {
        intents: [{ kind: "question", topic: "week", weekText: null, itemText: null }],
      }),
      final({ answer: "Checked" }),
    ]);
    const r = await t.action(ask, {
      ...src,
      requestId: rid(),
      prompt: "What happens in the week of Nov 17, 2027?",
      selectedWeek: "2026-11-16",
    });
    expect(r.status).toBe("clarification");
    expect(r.citations).toEqual([]);
    expect(r.answer).toMatch(/verify every suggested value|complete date/);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const spy = noNetwork();
    const fallback = await t.action(ask, {
      ...src,
      requestId: rid(),
      prompt: "What happens in the week of Nov 17, 2027?",
      selectedWeek: "2026-11-16",
    });
    expect(fallback.status).toBe("clarification");
    expect(fallback.citations).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects recurring cash in no-key fallback while retaining weekly minimum rules", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const t = setup();
    const src = await source(t);
    const spy = noNetwork();
    const r = await t.action(ask, {
      ...src,
      requestId: rid(),
      prompt: "pay $50,000 to Atlas Legal on 2026-11-17 weekly",
    });
    expect(r.status).toBe("clarification");
    expect(r.proposal).toBeNull();
    expect(r.answer).toMatch(/Recurring cash events/);
    const minimum = await t.action(ask, {
      ...src,
      requestId: rid(),
      prompt: "keep usable cash above $50,000 weekly",
    });
    expect(minimum.status).toBe("proposal");
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not accept unverified quantitative or qualitative financial narrative", async () => {
    const t = setup();
    scriptClaude([final({ answer: "Cash is $999m because two huge bills are due." })]);
    const receipt = await t.action(ask, {
      ...(await source(t)),
      requestId: rid(),
      prompt: "Why does cash dip?",
    });
    expect(receipt.status).toBe("clarification");
    expect(receipt.citations).toEqual([]);
    expect(receipt.answer).not.toMatch(/999|huge bills/);
  });

  it("uses the original question to reject invented values and unsupported qualifiers", async () => {
    const t = setup();
    const src = await source(t);
    scriptClaude([
      toolUse("check_request", { intents: [{ ...atlas, amountText: "$999M" }] }),
      final({ answer: "Ready" }),
    ]);
    const invented = await t.action(ask, { ...src, requestId: rid(), prompt: exactText });
    expect(invented.status).toBe("clarification");
    expect(invented.proposal).toBeNull();
    const spy = noNetwork();
    for (const prompt of [
      `do not ${exactText}`,
      `${exactText} if Acme pays`,
      "keep usable cash above $50,000 daily",
      "keep usable cash at most $50,000",
    ])
      expect((await t.action(ask, { ...src, requestId: rid(), prompt })).status).toBe(
        "clarification",
      );
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("shared provider deadline", () => {
  it("aborts the whole multi-step loop at 110 seconds instead of resetting the budget per call", async () => {
    vi.useFakeTimers();
    let aborted = 0;
    const spy = vi.fn(
      async (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(
            () =>
              resolve(
                new Response(
                  JSON.stringify({
                    id: "msg_deadline",
                    type: "message",
                    role: "assistant",
                    model: "claude-opus-5-5",
                    usage: { input_tokens: 1, output_tokens: 1 },
                    ...toolUse("check", {}),
                  }),
                  { status: 200, headers: { "content-type": "application/json" } },
                ),
              ),
            40_000,
          );
          init?.signal?.addEventListener(
            "abort",
            () => {
              aborted++;
              clearTimeout(timer);
              reject(new Error("aborted"));
            },
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", spy);
    const result = runStructured({
      system: "test",
      messages: [{ role: "user", content: "test" }],
      schema: { type: "object" },
      tools: [
        {
          name: "check",
          description: "test",
          input_schema: { type: "object" },
          run: () => ({ ok: true }),
        },
      ],
    }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(ASSISTANT_TOTAL_TIMEOUT_MS);
    expect(await result).toMatchObject({ message: "PROVIDER_TIMEOUT" });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(aborted).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
