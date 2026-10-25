/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { WeeklySeedV1Schema } from "@domino/contracts";
import { weeklyBoundaryFixtures } from "@domino/contracts/fixtures";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import type { QuestionReceipt } from "../questions/receipt";
import { baselineRefs } from "../refs";
import { workspaceRefs } from "../workspaceRefs";
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
  { companyId: string; runId: string; requestId: string; prompt: string },
  QuestionReceipt
>("timeline/questions:ask");

async function source(t: T) {
  const seed = WeeklySeedV1Schema.parse(weeklyBoundaryFixtures.validKestrelWeeklySeed);
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

beforeEach(() => vi.stubEnv("ANTHROPIC_API_KEY", "test-key"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Claude Timeline chat", () => {
  it("normalizes sloppy wording into the same proposal the fixed grammar builds", async () => {
    const t = setup();
    const src = await source(t);
    const { bodies } = scriptClaude([
      toolUse("update_draft", { intents: [atlas] }),
      final({
        reply: "Paying Atlas Legal $50,000 on Nov 17. Review and confirm below.",
        choices: [],
      }),
    ]);
    let r = await t.mutation(chatRefs.begin, { ...src, requestId: rid() });
    r = await t.action(assistantSend, {
      ...key(r),
      requestId: rid(),
      expectedRevision: r.revision,
      text: "what if we pay 50000 to atlas legal on nov 17",
    });
    expect(r.status).toBe("ready");
    expect(r.turns.at(-2)?.text).toBe("what if we pay 50000 to atlas legal on nov 17");
    expect(r.turns.at(-1)?.text).toMatch(/Atlas Legal/);
    // Claude sees company data, and the tool result carries Domino's own check.
    expect(String(bodies[0]?.system)).toMatch(/openInvoices/);
    expect(JSON.stringify(bodies[1]?.messages)).toMatch(/\\"status\\":\\"ready\\"/);

    let g = await t.mutation(chatRefs.begin, { ...src, requestId: rid() });
    g = await t.mutation(chatRefs.send, {
      ...key(g),
      requestId: rid(),
      expectedRevision: g.revision,
      text: "pay $50,000 to Atlas Legal on 2026-11-17",
    });
    expect(g.status).toBe("ready");
    expect(r.proposal).toEqual(g.proposal);
  });

  it("saves offered choices and asks for a value Domino's checks reject", async () => {
    const t = setup();
    scriptClaude([
      toolUse("update_draft", { intents: [{ ...atlas, dateText: null }] }),
      final({
        reply: "Which date should the payment go out?",
        choices: [
          { label: "Nov 17", value: "2026-11-17" },
          { label: "Nov 24", value: "2026-11-24" },
        ],
      }),
    ]);
    let r = await t.mutation(chatRefs.begin, { ...(await source(t)), requestId: rid() });
    r = await t.action(assistantSend, {
      ...key(r),
      requestId: rid(),
      expectedRevision: r.revision,
      text: "pay atlas legal 50k",
    });
    expect(r.status).toBe("collecting");
    expect(r.pendingField).toBe("date");
    expect(r.turns.at(-1)?.choices).toEqual([
      { label: "Nov 17", value: "2026-11-17" },
      { label: "Nov 24", value: "2026-11-24" },
    ]);
  });

  it("keeps the draft and turn count when Claude fails", async () => {
    const t = setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    const r = await t.mutation(chatRefs.begin, { ...(await source(t)), requestId: rid() });
    await expect(
      t.action(assistantSend, {
        ...key(r),
        requestId: rid(),
        expectedRevision: r.revision,
        text: "pay atlas",
      }),
    ).rejects.toThrow(/Claude could not answer/);
    const after = await t.query(chatRefs.get, key(r));
    expect(after?.revision).toBe(r.revision);
  });

  it("uses the fixed grammar without a key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const t = setup();
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    let r = await t.mutation(chatRefs.begin, { ...(await source(t)), requestId: rid() });
    r = await t.action(assistantSend, {
      ...key(r),
      requestId: rid(),
      expectedRevision: r.revision,
      text: "pay $50,000 to Atlas Legal on 2026-11-17",
    });
    expect(r.status).toBe("ready");
    expect(network).not.toHaveBeenCalled();
  });
});

describe("one chat for questions and what-ifs", () => {
  it("answers a plain question with its sources and leaves the draft alone, without a key", async () => {
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

  it("saves the sources behind Claude's answer on its reply", async () => {
    const t = setup();
    scriptClaude([
      toolUse("answer_question", {
        intents: [{ kind: "question", topic: "low_point", weekText: null, itemText: null }],
      }),
      final({ reply: "Cash is lowest in the week of Nov 16.", choices: [] }),
    ]);
    let r = await t.mutation(chatRefs.begin, { ...(await source(t)), requestId: rid() });
    r = await t.action(assistantSend, {
      ...key(r),
      requestId: rid(),
      expectedRevision: r.revision,
      text: "when do we bottom out",
    });
    expect(r.turns.at(-1)?.text).toBe("Cash is lowest in the week of Nov 16.");
    expect(r.turns.at(-1)?.citations?.length).toBeGreaterThan(0);
    expect(r.proposal).toBeNull();
  });
});

describe("Claude Ask a question", () => {
  it("keeps the resolver's proposal and citations and uses Claude's answer text", async () => {
    const t = setup();
    const src = await source(t);
    scriptClaude([
      toolUse("check_request", { intents: [atlas] }),
      final({ answer: "Paying Atlas Legal $50,000 on Nov 17 is ready to review." }),
    ]);
    const viaClaude = await t.action(ask, {
      ...src,
      requestId: rid(),
      prompt: "what if we pay 50000 to atlas legal on nov 17",
    });
    expect(viaClaude.status).toBe("proposal");
    expect(viaClaude.answer).toBe("Paying Atlas Legal $50,000 on Nov 17 is ready to review.");

    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const viaGrammar = await t.action(ask, {
      ...src,
      requestId: rid(),
      prompt: "What if we pay $50,000 to Atlas Legal on 2026-11-17?",
    });
    expect(viaGrammar.status).toBe("proposal");
    expect(viaClaude.proposal?.changes).toEqual(viaGrammar.proposal?.changes);
  });

  it("answers broader questions from context without a proposal", async () => {
    const t = setup();
    scriptClaude([final({ answer: "Cash is lowest because two large bills land that week." })]);
    const r = await t.action(ask, {
      ...(await source(t)),
      requestId: rid(),
      prompt: "why does cash dip so much?",
    });
    expect(r).toMatchObject({ status: "answered", proposal: null, citations: [] });
  });
});
