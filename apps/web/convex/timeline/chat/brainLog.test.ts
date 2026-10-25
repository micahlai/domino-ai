/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { WeeklySeedV1Schema, contentHashPreimage } from "@domino/contracts";
import { weeklyBoundaryFixtures } from "@domino/contracts/fixtures";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id as DocId } from "../../_generated/dataModel";
import schema from "../../schema";
import type { Intent } from "../questions/intent";
import { baselineRefs } from "../refs";
import { sha256Hex } from "../workspaceInput";
import { workspaceRefs } from "../workspaceRefs";
import { CHAT_AGENT_ID, CLAUDE_TOOL, SAVE_TOOL, timelineRunRef } from "./brainLog";
import { statement } from "./draft";
import type { ChatReceipt } from "./receipt";
import { chatRefs } from "./refs";

// Ask Domino writes its activity to the linked Field company's agent log (the Brain map).

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
const rid = () => `brain-log-test-${++serial}`;

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
const failTurn = makeFunctionReference<
  "mutation",
  {
    companyId: string;
    conversationId: string;
    requestId: string;
    expectedRevision: number;
    text: string;
    attempt: number;
    failure: "unavailable" | "rejected" | "failed";
  },
  ChatReceipt | null
>("timeline/chat:failAssistantTurn");

function scriptClaude(replies: { content: unknown[]; stop_reason: string }[]) {
  const spy = vi.fn(async () => {
    const next = replies.shift();
    if (!next) throw new Error("unexpected Claude call");
    return new Response(
      JSON.stringify({
        id: "msg_1",
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
  return spy;
}
const toolUse = (name: string, input: unknown) => ({
  content: [{ type: "tool_use", id: `toolu_${name}`, name, input }],
  stop_reason: "tool_use",
});
const final = (json: unknown) => ({
  content: [{ type: "text", text: JSON.stringify(json) }],
  stop_reason: "end_turn",
});
const atlas: Intent = {
  kind: "cash_change",
  direction: "out",
  amountText: "$50,000",
  dateText: "2026-11-17",
  counterpartyText: "Atlas Legal",
} as Intent;

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
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A Field company plus the verified Timeline link resolveFieldSource accepts. */
async function linked(t: T, link = true) {
  const seed = WeeklySeedV1Schema.parse(weeklyBoundaryFixtures.validKestrelWeeklySeed);
  const fieldId = await t.run((ctx) =>
    ctx.db.insert("companies", {
      name: "Kestrel Field",
      profile: "kestrel",
      currentWeek: 0,
      today: seed.snapshot.asOf,
      status: "ready",
    }),
  );
  const other = await t.run((ctx) =>
    ctx.db.insert("companies", {
      name: "Kestrel replica",
      profile: "kestrel",
      currentWeek: 0,
      today: seed.snapshot.asOf,
      status: "ready",
    }),
  );
  seed.id = `field:weekly_seed/${fieldId}-v1`;
  seed.contentHash = await sha256Hex(contentHashPreimage(seed));
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
  const src = { companyId: seed.company.id, runId: opened.runId };
  if (link)
    await t.run((ctx) =>
      ctx.db.insert("timelineLinks", {
        companyId: fieldId,
        timelineCompanyId: src.companyId,
        seedId: seed.id,
        seedHash: seed.contentHash,
        asOf: seed.asOf,
        snapshotVersion: 1,
        baselineRunId: saved.runId,
        runId: src.runId,
        resultRef: "unused",
        analysisId: null,
        analysisError: null,
        savedAt: "2026-10-25T15:00:00.000Z",
      }),
    );
  return { src, fieldId, other };
}
const logOf = (t: T, companyId: DocId<"companies">) =>
  t.run((ctx) =>
    ctx.db
      .query("log")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .collect(),
  );
const key = (r: ChatReceipt) => ({ companyId: r.companyId, conversationId: r.conversationId });
const turn = (r: ChatReceipt, text: string, requestId = rid()) => ({
  ...key(r),
  requestId,
  expectedRevision: r.revision,
  text,
});

describe("Ask Domino on the Brain map", () => {
  it("logs a turn, its tool calls and the Claude call to the linked Field company, once", async () => {
    const t = setup();
    const { src, fieldId, other } = await linked(t);
    const r = await t.mutation(chatRefs.begin, { ...src, requestId: rid() });
    expect(await logOf(t, fieldId)).toEqual([]);
    scriptClaude([
      toolUse("lookup_forecast", { topic: "low_point", weekText: null, itemText: null }),
      final({ reply: "The saved forecast shows the low point; we can look at it together." }),
    ]);
    const args = turn(r, "When is cash lowest?");
    const answered = await t.action(assistantSend, args);
    const rows = await logOf(t, fieldId);
    expect(rows.map((x) => [x.action, x.tool ?? null, x.status ?? null])).toEqual([
      ["chat.tool", "lookup_forecast", null],
      ["chat.claude", CLAUDE_TOOL, "done"],
      ["chat.turn", null, "done"],
    ]);
    expect(rows.every((x) => x.agentId === CHAT_AGENT_ID && x.agent === CHAT_AGENT_ID)).toBe(true);
    expect(new Set(rows.map((x) => x.runId)).size).toBe(1);
    // Plain code-built summaries, never the person's text.
    expect(JSON.stringify(rows)).not.toContain("When is cash lowest");
    expect(await logOf(t, other)).toEqual([]);
    // An exact retry replays the accepted turn and writes nothing more.
    noProvider();
    expect((await t.action(assistantSend, args)).revision).toBe(answered.revision);
    expect(await logOf(t, fieldId)).toHaveLength(3);
  });

  it("logs a saved scenario with a link back to its Timeline run and the engine's result", async () => {
    const t = setup();
    const { src, fieldId } = await linked(t);
    let r = await t.mutation(chatRefs.begin, { ...src, requestId: rid() });
    scriptClaude([
      toolUse("update_draft", { request: statement(atlas), intents: [atlas] }),
      final({ reply: "Let’s review the request together." }),
    ]);
    r = await t.action(assistantSend, turn(r, "pay $50,000 to Atlas Legal on 2026-11-17"));
    expect(r.status).toBe("ready");
    const turnRow = (await logOf(t, fieldId)).find((x) => x.action === "chat.turn");
    expect(turnRow?.summary).toContain("Drafted a proposal for review");
    const confirm = { ...key(r), requestId: rid(), expectedRevision: r.revision, reviewed: true };
    const saved = await t.mutation(chatRefs.confirm, confirm);
    expect(saved.linkedRunId).toBeTruthy();
    const rows = (await logOf(t, fieldId)).filter(
      (x) => x.action.startsWith("chat.s") || x.event === "message",
    );
    const ref = timelineRunRef(src.companyId, saved.linkedRunId ?? "");
    expect(rows.map((x) => [x.action, x.tool ?? null, x.toAgentId ?? null])).toEqual([
      ["chat.saved", SAVE_TOOL, null],
      ["chat.message", null, "engine"],
    ]);
    expect(rows[0]?.summary).toBe(`Saved scenario: ${r.proposal?.label}`);
    expect(rows[0]?.refs).toEqual([ref]);
    expect(rows[1]?.summary).toMatch(/^Engine computed the scenario: lowest cash /);
    // A retried confirm returns the accepted receipt and logs nothing more.
    const before = (await logOf(t, fieldId)).length;
    await t.mutation(chatRefs.confirm, confirm);
    expect(await logOf(t, fieldId)).toHaveLength(before);
  });

  it("logs each failed attempt once, as waiting for an AI key when none is set", async () => {
    const t = setup();
    const { src, fieldId } = await linked(t);
    const r = await t.mutation(chatRefs.begin, { ...src, requestId: rid() });
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    noProvider();
    const args = turn(r, "What is our runway?");
    await expect(t.action(assistantSend, args)).rejects.toThrow();
    let rows = await logOf(t, fieldId);
    expect(rows.map((x) => [x.action, x.status, x.step])).toEqual([["chat.failed", "failed", 1]]);
    expect(rows[0]?.summary).toContain("language model not configured");
    // The same attempt failing again (a late duplicate) writes nothing.
    await t.mutation(failTurn, { ...args, attempt: 1, failure: "unavailable" });
    expect(await logOf(t, fieldId)).toHaveLength(1);
    // An exact retry is a new attempt: one more row.
    await expect(t.action(assistantSend, args)).rejects.toThrow();
    rows = await logOf(t, fieldId);
    expect(rows.map((x) => x.step)).toEqual([1, 2]);
  });

  it("logs a rejected Claude reply as a failed Claude call", async () => {
    const t = setup();
    const { src, fieldId } = await linked(t);
    const r = await t.mutation(chatRefs.begin, { ...src, requestId: rid() });
    scriptClaude([
      final({ reply: "Cash drops to $999,999,999 next week." }),
      final({ reply: "Cash drops to $999,999,999 next week." }),
    ]);
    await expect(t.action(assistantSend, turn(r, "What happens next week?"))).rejects.toThrow();
    const rows = await logOf(t, fieldId);
    expect(rows.map((x) => [x.action, x.tool ?? null, x.status])).toEqual([
      ["chat.claude", CLAUDE_TOOL, "failed"],
      ["chat.failed", null, "failed"],
    ]);
    expect(JSON.stringify(rows)).not.toContain("999");
  });

  it("writes nothing when the Timeline books have no verified Field link", async () => {
    const t = setup();
    const { src, fieldId, other } = await linked(t, false);
    const r = await t.mutation(chatRefs.begin, { ...src, requestId: rid() });
    scriptClaude([final({ reply: "There is no Brain output linked to these books." })]);
    await t.action(assistantSend, turn(r, "What did the Brain find?"));
    expect(await logOf(t, fieldId)).toEqual([]);
    expect(await logOf(t, other)).toEqual([]);
  });
});

function noProvider() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("Provider must not run");
    }),
  );
}
