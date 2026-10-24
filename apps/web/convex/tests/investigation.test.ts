/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashInput } from "../../../../packages/agents/src/hash";
import { historicalSystemPrompt } from "../../../../packages/agents/src/historical";
import { api, internal } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob(["../**/*.ts", "../_generated/*.js", "!./**"]);
const inv = api.investigation;
const h = api.historical;
const caseId = "twou-2023-cash-v1";
const LATER = ["S8", "H01", "H03", "D01", "2024-02-12"];
const QUESTION = "What does the latest disclosure show about 2U's cash?";

type Body = {
  system: string;
  messages: { content: string }[];
  output_config: {
    format: {
      schema: {
        properties: {
          citations: {
            items: {
              anyOf: { properties: { kind: { enum: string[] }; id: { enum: string[] } } }[];
            };
          };
        };
      };
    };
  };
};

/** Fake Claude Messages endpoint: cites the first allowed source and engine id it was offered. */
function claude(reply: (body: Body) => Response | Promise<Response> = ok) {
  const bodies: Body[] = [];
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Body;
    bodies.push(body);
    return reply(body);
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, bodies };
}

function ok(body: Body) {
  const refs = body.output_config.format.schema.properties.citations.items.anyOf;
  const pick = (kind: string) =>
    refs.find((r) => r.properties.kind.enum[0] === kind)!.properties.id.enum[0]!;
  const output = {
    assessment: "The disclosure shows cash falling and the weeks after the cutoff are unobserved.",
    citations: [
      { kind: "source", id: pick("source") },
      { kind: "engine", id: pick("engine") },
    ],
    uncertainties: ["Quarterly filings cannot show weekly timing."],
  };
  return message(output);
}

function message(output: unknown) {
  return new Response(
    JSON.stringify({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-reported",
      content: [{ type: "text", text: JSON.stringify(output) }],
      stop_reason: "end_turn",
      usage: { input_tokens: 900, output_tokens: 120 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const setup = () => convexTest(schema, modules);
type T = ReturnType<typeof setup>;
/** Run the turn scheduled now; the 3-minute turn deadline stays pending (tests fire it directly). */
const drain = async (t: T) => {
  vi.advanceTimersByTime(1);
  await t.finishInProgressScheduledFunctions();
};
const ask = (t: T, requestId = "req-inv-1", question = QUESTION) =>
  t.mutation(inv.investigate, { requestId, question });
const state = (t: T, conversationId: string) => t.query(inv.getConversation, { conversationId });
const opOf = async (t: T, conversationId: string, kind: string, role?: string) =>
  (await state(t, conversationId)).operations.find(
    (o) => o.kind === kind && (role === undefined || o.role === role),
  )!;
const rows = (t: T) => t.run((ctx) => ctx.db.query("investigationOperations").collect());

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const devMode = () => {
  vi.stubEnv("DOMINO_SPECIALIST_PROVIDER", "claude-dev");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
  vi.stubEnv("ANTHROPIC_MODEL", "claude-configured");
};

describe("durable investigation (2U)", () => {
  it("retries and concurrent duplicates return the same task; a changed payload conflicts", async () => {
    const t = setup();
    const first = await ask(t);
    expect(first.operationIds).toHaveLength(3);
    expect(await ask(t)).toEqual(first);
    const [a, b] = await Promise.all([ask(t, "req-con-1"), ask(t, "req-con-1")]);
    expect(a).toEqual(b);
    await expect(ask(t, "req-inv-1", "Another question?")).rejects.toThrow(/different request/);
    await expect(
      t.mutation(inv.revealInvestigation, {
        requestId: "req-inv-1",
        conversationId: first.conversationId,
      }),
    ).rejects.toThrow(/different request/);
    expect(await t.run((ctx) => ctx.db.query("investigationConversations").collect())).toHaveLength(
      2,
    );
    expect(await rows(t)).toHaveLength(6);
    await expect(ask(t, "bad")).rejects.toThrow(/requestId/);
    await expect(ask(t, "req-empty-1", "   ")).rejects.toThrow(/question/);
    await expect(ask(t, "req-long-1", "x".repeat(1001))).rejects.toThrow(/question/);
  });

  it("clients cannot supply case data, predictions, instructions or status", async () => {
    const t = setup();
    for (const extra of [
      { caseId },
      { predictions: [] },
      { instructions: "be nice" },
      { status: "succeeded" },
    ])
      await expect(
        t.mutation(inv.investigate, {
          requestId: "req-x-1",
          question: QUESTION,
          ...extra,
        } as never),
      ).rejects.toThrow();
    expect(await rows(t)).toHaveLength(0);
  });

  it("default provider fails the agent task honestly; tool outputs stay inspectable", async () => {
    const t = setup();
    const { fetch } = claude();
    const { conversationId } = await ask(t);
    const queued = await state(t, conversationId);
    expect(queued.operations.map((o) => o.status)).toEqual(["queued", "queued", "queued"]);
    expect(queued.busy).toBe(true);
    await drain(t);
    const s = await state(t, conversationId);
    expect(s.operations.map((o) => [o.kind, o.status])).toEqual([
      ["source_load", "succeeded"],
      ["forecast", "succeeded"],
      ["specialist", "failed"],
    ]);
    const [source, forecast, analyst] = s.operations;
    expect(source!.output).toMatchObject({ origin: "curated_archive" });
    expect(forecast!.dependsOn).toEqual([source!.operationId]);
    expect(analyst!.dependsOn).toEqual([source!.operationId, forecast!.operationId]);
    expect(analyst!.error).toMatchObject({ code: "provider_unavailable" });
    expect(analyst!.providerMode).toBe("creao");
    expect(analyst!.provider).toBeUndefined();
    expect(analyst!.output).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(s.messages.some((m) => m.role === "assistant")).toBe(false);
    // The saved forecast is the existing run record, exactly.
    const run = await t.query(h.getRun, { caseId, runId: forecast!.outputRef!.id });
    expect(forecast!.input).toMatchObject({ hash: run.run.inputHash, sourceIds: ["S7"] });
    expect(s.busy).toBe(false);
    expect(s.canReveal).toBe(true);
    expect(s.canAlternative).toBe(true);
  });

  it("dev Claude mode: one claimed call, metadata recorded, reload and redispatch never rebill", async () => {
    devMode();
    const t = setup();
    const { fetch, bodies } = claude();
    const { conversationId } = await ask(t);
    await drain(t);
    const analyst = await opOf(t, conversationId, "specialist");
    expect(analyst.status).toBe("succeeded");
    expect(analyst).toMatchObject({
      provider: "claude",
      model: "claude-reported",
      providerMode: "claude-dev",
      usage: { inputTokens: 900, outputTokens: 120 },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(bodies[0])).not.toMatch(/S8|H0\d|D0\d|2024-02-12/);
    const s = await state(t, conversationId);
    const said = s.messages.filter((m) => m.role === "assistant");
    expect(said).toHaveLength(1);
    expect(said[0]!.text).toBe((analyst.output as { assessment: string }).assessment);
    // Reconnect: the action runs again and a late duplicate result arrives. Nothing changes.
    await t.action(internal.investigation.runTurn, { conversationId });
    expect(
      await t.mutation(internal.investigation.finishSpecialist, {
        operationId: analyst.operationId,
        result: { ok: false, status: "failed", code: "late", message: "late" },
      }),
    ).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await state(t, conversationId)).toEqual(s);
    // Stored packet hash is what the client sees; the packet itself stays server-side.
    const row = (await rows(t)).find((r) => r.operationId === analyst.operationId)!;
    expect((analyst.input as { hash: string }).hash).toBe(await hashInput(row.packet));
    expect(analyst).not.toHaveProperty("packet");
  });

  it("failed or unknown provider outcomes never become success", async () => {
    devMode();
    for (const [reply, status, code] of [
      [() => new Response("{}", { status: 500 }), "failed", "http_status"],
      [
        () =>
          message({
            assessment: "x",
            citations: [{ kind: "fact", id: "H03" }],
            uncertainties: ["u"],
          }),
        "failed",
        "invalid_output",
      ],
      [
        () => {
          throw new TypeError("socket closed");
        },
        "unknown",
        "network",
      ],
    ] as const) {
      const t = setup();
      claude(reply);
      const { conversationId } = await ask(t);
      await drain(t);
      const s = await state(t, conversationId);
      const analyst = s.operations.find((o) => o.kind === "specialist")!;
      expect([analyst.status, analyst.error?.code]).toEqual([status, code]);
      expect(analyst.output).toBeUndefined();
      expect(s.messages.some((m) => m.role === "assistant")).toBe(false);
      expect(JSON.stringify(s)).not.toContain("test-key-not-real");
    }
  });

  it("claims once; the deadline marks a hung call unknown and a late result cannot overwrite it", async () => {
    const t = setup();
    const { conversationId, operationIds } = await ask(t);
    const step = () =>
      t.mutation(internal.investigation.step, { conversationId, providerMode: "claude-dev" });
    expect((await step())?.packet).toBeUndefined(); // source load
    expect((await step())?.packet).toBeUndefined(); // forecast
    const claimed = await step();
    expect(claimed?.packet?.role).toBe("evidence_analyst");
    expect(await step()).toBeNull(); // running: not claimable again
    await t.mutation(internal.investigation.expireTurn, { operationIds });
    const analyst = await opOf(t, conversationId, "specialist");
    expect([analyst.status, analyst.error?.code]).toEqual(["unknown", "outcome_unknown"]);
    expect(
      await t.mutation(internal.investigation.finishSpecialist, {
        operationId: claimed!.operationId,
        result: {
          ok: true,
          output: {
            assessment: "a",
            citations: [{ kind: "source", id: "S7" }],
            uncertainties: ["u"],
          },
          provider: "claude",
          model: "m",
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      }),
    ).toBe(false);
    expect((await opOf(t, conversationId, "specialist")).status).toBe("unknown");
  });

  it("no S8 before reveal, even after reload; reveal is explicit and earlier inputs stay frozen", async () => {
    devMode();
    const t = setup();
    const { fetch } = claude();
    const { conversationId } = await ask(t);
    await expect(
      t.mutation(inv.revealInvestigation, { requestId: "req-rev-1", conversationId }),
    ).rejects.toThrow(/BUSY|Wait/);
    await drain(t);
    const before = await state(t, conversationId);
    for (const s of LATER) expect(JSON.stringify(before)).not.toContain(s);
    // Reload: a fresh read is identical, and nothing was revealed by reading.
    expect(await state(t, conversationId)).toEqual(before);
    const analystBefore = (await rows(t)).find((r) => r.role === "evidence_analyst")!;

    const r1 = await t.mutation(inv.revealInvestigation, {
      requestId: "req-rev-1",
      conversationId,
    });
    expect(
      await t.mutation(inv.revealInvestigation, { requestId: "req-rev-1", conversationId }),
    ).toEqual(r1);
    await drain(t);
    const after = await state(t, conversationId);
    const forecast = after.operations.find((o) => o.kind === "forecast")!;
    const reveal = after.operations.find((o) => o.kind === "reveal")!;
    expect(reveal.status).toBe("succeeded");
    expect(reveal.outputRef).toEqual({ kind: "reveal", id: forecast.outputRef!.id });
    const stored = await t.query(h.getReveal, { runId: forecast.outputRef!.id });
    expect((reveal.output as { comparisonIds: string[] }).comparisonIds).toEqual(
      stored!.comparisons.map((c: { id: string }) => c.id),
    );
    expect(after.canReveal).toBe(false);
    await expect(
      t.mutation(inv.revealInvestigation, { requestId: "req-rev-2", conversationId }),
    ).rejects.toThrow(/LIMIT|already/);
    // The analyst's frozen input and packet are untouched by the reveal.
    const analystAfter = (await rows(t)).find((r) => r.role === "evidence_analyst")!;
    expect(analystAfter).toEqual(analystBefore);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("costed alternative: exact existing output refs, cutoff-only reviewer, two calls per journey", async () => {
    devMode();
    const t = setup();
    const { fetch, bodies } = claude();
    const { conversationId } = await ask(t);
    await drain(t);
    await t.mutation(inv.revealInvestigation, { requestId: "req-rev-1", conversationId });
    await drain(t);
    const alt = await t.mutation(inv.requestAlternative, {
      requestId: "req-alt-1",
      conversationId,
    });
    expect(
      await t.mutation(inv.requestAlternative, { requestId: "req-alt-1", conversationId }),
    ).toEqual(alt);
    await expect(
      t.mutation(inv.requestAlternative, { requestId: "req-alt-2", conversationId }),
    ).rejects.toThrow(/BUSY|Wait/);
    await drain(t);
    const s = await state(t, conversationId);
    const forecast = s.operations.find((o) => o.kind === "forecast")!;
    const altOp = s.operations.find((o) => o.kind === "alternative")!;
    const reviewer = s.operations.find((o) => o.role === "scenario_reviewer")!;
    expect(altOp.status).toBe("succeeded");
    expect(reviewer.status).toBe("succeeded");
    expect(reviewer.dependsOn).toEqual([altOp.operationId]);
    const altRun = await t.query(h.getRun, { caseId, runId: altOp.outputRef!.id });
    expect(altRun.run.branch).toMatchObject({
      kind: "alternative",
      baselineRunId: forecast.outputRef!.id,
    });
    expect(altRun.costRelativeToBaseline).toEqual({
      low: -715_000_000,
      point: -426_250_000,
      high: -137_500_000,
    });
    expect(reviewer.input).toMatchObject({
      runIds: [altOp.outputRef!.id, forecast.outputRef!.id],
      comparisonIds: [],
      historyTurns: 2,
    });
    // After the reveal the reviewer still reads cutoff-only inputs and no reveal-time messages.
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(bodies[1])).not.toMatch(/S8|H0\d|D0\d|2024-02-12|revealed/);
    expect(s.canAlternative).toBe(false);
    await expect(
      t.mutation(inv.requestAlternative, { requestId: "req-alt-3", conversationId }),
    ).rejects.toThrow(/LIMIT|already/);
    expect(s.operations).toHaveLength(6);
  });

  it("conversations are isolated: one reveal never reaches another baseline", async () => {
    const t = setup();
    const a = await ask(t, "req-conv-a");
    const b = await ask(t, "req-conv-b");
    await drain(t);
    await t.mutation(inv.revealInvestigation, {
      requestId: "req-rev-a",
      conversationId: a.conversationId,
    });
    await drain(t);
    const sb = await state(t, b.conversationId);
    for (const s of LATER) expect(JSON.stringify(sb)).not.toContain(s);
    const runB = sb.operations.find((o) => o.kind === "forecast")!.outputRef!.id;
    const runA = (await opOf(t, a.conversationId, "forecast")).outputRef!.id;
    expect(runA).not.toBe(runB);
    expect(await t.query(h.getReveal, { runId: runB })).toBeNull();
    expect(sb.canReveal).toBe(true);
    await expect(
      t.mutation(inv.revealInvestigation, { requestId: "req-rev-x", conversationId: "conv-nope" }),
    ).rejects.toThrow(/Unknown conversation/);
  });

  it("profiles are versioned snapshots stored on the operation", async () => {
    const t = setup();
    const { conversationId } = await ask(t);
    const analyst = await opOf(t, conversationId, "specialist");
    const instructions = historicalSystemPrompt("evidence_analyst");
    expect(analyst.profile).toMatchObject({
      role: "evidence_analyst",
      instructions,
      version: `evidence_analyst@${(await hashInput(instructions)).slice(0, 12)}`,
      tools: [],
    });
    // A stored snapshot is served as stored, not regenerated from today's prompt.
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("investigationOperations").collect()).find(
        (r) => r.role === "evidence_analyst",
      )!;
      await ctx.db.patch(row._id, { profile: { ...row.profile, version: "evidence_analyst@old" } });
    });
    expect((await opOf(t, conversationId, "specialist")).profile).toMatchObject({
      version: "evidence_analyst@old",
    });
  });

  it("source wake: same version and unknown inputs do zero work", async () => {
    const t = setup();
    const before = await rows(t);
    const s7 = "c1c9486e9a337b4b28b4980a8db86f10ddf8617dc9cbbc90a7209e98daee7e4f";
    const wake = (sourceId: string, contentHash: string) =>
      t.mutation(internal.investigation.sourceWake, { sourceId, contentHash });
    expect(await wake("S7", s7)).toEqual({ status: "unchanged", queued: 0 });
    expect(await wake("S7", s7)).toEqual({ status: "unchanged", queued: 0 });
    expect(await wake("S7", "0".repeat(64))).toEqual({ status: "unverified_version", queued: 0 });
    expect(await wake("S99", s7)).toEqual({ status: "unknown_source", queued: 0 });
    expect(await rows(t)).toEqual(before);
    expect(await t.run((ctx) => ctx.db.query("historicalRuns").collect())).toHaveLength(0);
  });
});
