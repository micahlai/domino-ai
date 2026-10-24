/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashInput } from "../../../../packages/agents/src/hash";
import {
  historicalCreaoOutputFormat,
  historicalSystemPrompt,
} from "../../../../packages/agents/src/historical";
import { api, internal } from "../_generated/api";
import { CASE, CUTOFF } from "../historical";
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

  it("default CREAO mode with the verification gate off fails honestly; tool outputs stay inspectable", async () => {
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
    expect(analyst!.error).toMatchObject({ code: "provider_unverified" });
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
    devMode();
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
    devMode();
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

  it("public historical writes cannot prepopulate, reveal or branch a conversation-owned run", async () => {
    const t = setup();
    const { conversationId, operationIds } = await ask(t);
    // The old internal key was public-shaped; claiming it now only makes an unrelated public run.
    const squatted = await t.mutation(h.saveBaseline, {
      requestId: `inv-${operationIds[1]}`,
      caseId,
    });
    await expect(
      t.mutation(h.saveBaseline, { requestId: `inv:${operationIds[1]}`, caseId }),
    ).rejects.toThrow(/requestId/);
    await drain(t);
    const owned = (await opOf(t, conversationId, "forecast")).outputRef!.id;
    expect(owned).not.toBe(squatted.runId);
    await expect(
      t.mutation(h.reveal, { requestId: "outside-reveal", runId: owned }),
    ).rejects.toThrow(/OWNED|conversation/);
    await expect(
      t.mutation(h.computeAlternative, { requestId: "outside-alt-1", baselineRunId: owned }),
    ).rejects.toThrow(/OWNED|conversation/);
    expect((await t.query(h.getCase, { caseId, runId: owned })).revealed).toBe(false);
    expect(await t.query(h.getReveal, { runId: owned })).toBeNull();
    // Legacy public runs keep working, and the conversation's own reveal still does.
    await t.mutation(h.reveal, { requestId: "outside-reveal", runId: squatted.runId });
    await t.mutation(inv.revealInvestigation, { requestId: "req-rev-1", conversationId });
    await drain(t);
    expect((await opOf(t, conversationId, "reveal")).status).toBe("succeeded");
    expect((await t.query(h.getCase, { caseId, runId: owned })).revealed).toBe(true);
  });

  it("a stored profile that differs from the dispatched prompt fails with no call", async () => {
    devMode();
    for (const patch of [
      { instructions: "Prior deployed instructions." },
      { version: "evidence_analyst@old" },
    ]) {
      const t = setup();
      const { fetch } = claude();
      const { conversationId } = await ask(t);
      await t.run(async (ctx) => {
        const row = (await ctx.db.query("investigationOperations").collect()).find(
          (r) => r.role === "evidence_analyst",
        )!;
        const old = { ...row.profile, ...patch };
        if (patch.instructions)
          old.version = `evidence_analyst@${(await hashInput(old.instructions)).slice(0, 12)}`;
        await ctx.db.patch(row._id, { profile: old });
      });
      await drain(t);
      const analyst = await opOf(t, conversationId, "specialist");
      expect([analyst.status, analyst.error?.code]).toEqual(["failed", "profile_mismatch"]);
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("an expired lease never claims or bills, and an expired running call ends unknown", async () => {
    devMode();
    const t = setup();
    const { fetch } = claude();
    const { conversationId } = await ask(t);
    // Deadline cleanup has not run: the claim itself must refuse.
    vi.setSystemTime(Date.now() + 181_000);
    await t.action(internal.investigation.runTurn, { conversationId });
    expect(fetch).not.toHaveBeenCalled();
    const s = await state(t, conversationId);
    expect(s.operations.map((o) => [o.status, o.error?.code])).toEqual([
      ["failed", "deadline"],
      ["failed", "deadline"],
      ["failed", "deadline"],
    ]);

    const t2 = setup();
    const c2 = (await ask(t2, "req-inv-2")).conversationId;
    const step = () =>
      t2.mutation(internal.investigation.step, { conversationId: c2, providerMode: "claude-dev" });
    await step();
    await step();
    const claimed = (await step())!;
    vi.setSystemTime(Date.now() + 181_000);
    expect(
      await t2.mutation(internal.investigation.finishSpecialist, {
        operationId: claimed.operationId,
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
    const late = await opOf(t2, c2, "specialist");
    expect([late.status, late.error?.code, late.output]).toEqual([
      "unknown",
      "outcome_unknown",
      undefined,
    ]);
  });

  it("source drift between load and forecast fails before any forecast is saved", async () => {
    devMode();
    const t = setup();
    const { fetch } = claude();
    const { conversationId } = await ask(t);
    await t.mutation(internal.investigation.step, { conversationId, providerMode: "claude-dev" });
    const visible = CASE.sources.find((s) => s.publishedAt <= CUTOFF)!;
    const before = structuredClone(visible);
    try {
      visible.title = "Revised disclosure version";
      visible.contentHash = "b".repeat(64);
      await t.action(internal.investigation.runTurn, { conversationId });
    } finally {
      Object.assign(visible, before);
    }
    const s = await state(t, conversationId);
    expect(s.operations.map((o) => [o.status, o.error?.code])).toEqual([
      ["succeeded", undefined],
      ["failed", "CASE_CHANGED"],
      ["failed", "dependency_failed"],
    ]);
    expect(await t.run((ctx) => ctx.db.query("historicalRuns").collect())).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
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

// ---------- CREAO (default mode), offline fakes only ----------

type Prompt = {
  rules: string[];
  outputFormat: string;
  data: { case: { sources: { id: string }[] }; run: { id: string } };
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const answer = (p: Prompt) =>
  `<<<DOMINO_RESULT>>>\n${JSON.stringify({
    assessment: "The disclosure shows cash falling and the weeks after the cutoff are unobserved.",
    citations: [
      { kind: "source", id: p.data.case.sources[0]!.id },
      { kind: "engine", id: p.data.run.id },
    ],
    uncertainties: ["Quarterly filings cannot show weekly timing."],
  })}\n<<<END_DOMINO_RESULT>>>`;

/** Fake app-scoped CREAO: POST creates run-1, each GET polls it. Records method, url and auth. */
function creao(
  opts: {
    post?: () => Response | Promise<Response>;
    poll?: (p: Prompt) => Response | Promise<Response>;
  } = {},
) {
  const calls: { method: string; url: string; auth: string }[] = [];
  let prompt: Prompt | undefined;
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    calls.push({ method, url, auth: new Headers(init.headers).get("authorization") ?? "" });
    if (method === "POST") {
      prompt = JSON.parse(JSON.parse(String(init.body)).inputs.prompt) as Prompt;
      return opts.post ? opts.post() : json({ id: "run-1", status: "queued" });
    }
    return opts.poll
      ? opts.poll(prompt!)
      : json({ id: "run-1", status: "completed", result: { chatText: answer(prompt!) } });
  });
  vi.stubGlobal("fetch", fetch);
  return {
    fetch,
    calls,
    posts: () => calls.filter((c) => c.method === "POST").length,
    prompt: () => prompt,
  };
}

const creaoConfig = () => {
  vi.stubEnv("CREAO_HISTORICAL_EVIDENCE_ANALYST_APP_ID", "app-analyst");
  vi.stubEnv("CREAO_HISTORICAL_EVIDENCE_ANALYST_API_KEY", "capi-analyst-not-real");
  vi.stubEnv("CREAO_HISTORICAL_SCENARIO_REVIEWER_APP_ID", "app-reviewer");
  vi.stubEnv("CREAO_HISTORICAL_SCENARIO_REVIEWER_API_KEY", "capi-reviewer-not-real");
  // Present but must never be read or sent.
  vi.stubEnv("CREAO_ACCOUNT_API_KEY", "account-key-not-real");
  vi.stubEnv("CREAO_API_KEY", "legacy-key-not-real");
};
/** Open the server-side gate for exactly the stored analyst app and profile version. */
const verify = async (t: T, conversationId: string) => {
  const { profile } = await opOf(t, conversationId, "specialist");
  const p = profile as { appId: string; version: string };
  vi.stubEnv("DOMINO_CREAO_VERIFIED_PROFILES", `${p.appId}/${p.version}`);
};
/** Like drain, but advances fake time so the adapter's poll sleeps resolve. */
const drainPolls = async (t: T) => {
  vi.advanceTimersByTime(1);
  let done = false;
  const p = t.finishInProgressScheduledFunctions().finally(() => {
    done = true;
  });
  for (let i = 0; i < 400 && !done; i++) await vi.advanceTimersByTimeAsync(500);
  await p;
};
const row = async (t: T, operationId: string) =>
  (await rows(t)).find((r) => r.operationId === operationId)!;

describe("CREAO specialist dispatch", () => {
  it("snapshots the per-run CREAO rules, distinct from the unknown remote instructions", async () => {
    const t = setup();
    const { conversationId } = await ask(t);
    const { profile, providerMode } = await opOf(t, conversationId, "specialist");
    const p = profile as {
      provider: string;
      version: string;
      instructions: string;
      instructionsScope: string;
    };
    expect(providerMode).toBe("creao");
    expect(p.provider).toBe("creao");
    expect(p.version).toBe(
      `evidence_analyst@creao-${(await hashInput(p.instructions)).slice(0, 12)}`,
    );
    expect(p.instructions).toContain("in the data field");
    expect(p.instructions).not.toContain("<domino_input>");
    expect(p.instructions.endsWith(historicalCreaoOutputFormat)).toBe(true);
    expect(p.instructionsScope).toMatch(/own instructions, skills and memory/);
    expect(p).not.toHaveProperty("appId");
  });

  it("verification binds to the frozen app: a swapped or unverified app gets zero calls", async () => {
    creaoConfig();
    const t = setup();
    const f = creao();
    const { conversationId } = await ask(t);
    expect((await opOf(t, conversationId, "specialist")).profile).toMatchObject({
      appId: "app-analyst",
    });
    await verify(t, conversationId);
    vi.stubEnv("CREAO_HISTORICAL_EVIDENCE_ANALYST_APP_ID", "app-b");
    await drain(t);
    const swapped = await opOf(t, conversationId, "specialist");
    expect([swapped.status, swapped.error?.code]).toEqual(["failed", "app_changed"]);

    // Queued on app B while only app A's binding for the same version is verified.
    const t2 = setup();
    const c2 = (await ask(t2, "req-inv-2")).conversationId;
    const { version } = (await opOf(t2, c2, "specialist")).profile as { version: string };
    vi.stubEnv("DOMINO_CREAO_VERIFIED_PROFILES", `app-analyst/${version},${version}`);
    await drain(t2);
    const unverified = await opOf(t2, c2, "specialist");
    expect([unverified.status, unverified.error?.code]).toEqual(["failed", "provider_unverified"]);
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("gate off or missing app config: zero calls, honest failure", async () => {
    creaoConfig();
    const t = setup();
    const f = creao();
    const { conversationId } = await ask(t);
    await drain(t);
    const off = await opOf(t, conversationId, "specialist");
    expect([off.status, off.error?.code]).toEqual(["failed", "provider_unverified"]);

    vi.unstubAllEnvs();
    vi.stubEnv("CREAO_ACCOUNT_API_KEY", "account-key-not-real");
    vi.stubEnv("CREAO_API_KEY", "legacy-key-not-real");
    const t2 = setup();
    const c2 = (await ask(t2, "req-inv-2")).conversationId;
    const { version } = (await opOf(t2, c2, "specialist")).profile as { version: string };
    vi.stubEnv("DOMINO_CREAO_VERIFIED_PROFILES", `app-analyst/${version}`);
    await drain(t2);
    const missing = await opOf(t2, c2, "specialist");
    expect([missing.status, missing.error?.code]).toEqual(["failed", "config"]);
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("success: one create, run identity persisted before the first poll, no model or usage", async () => {
    creaoConfig();
    const t = setup();
    const { conversationId } = await ask(t);
    await verify(t, conversationId);
    const { operationId } = await opOf(t, conversationId, "specialist");
    const seenAtPoll: (string | undefined)[] = [];
    const f = creao({
      poll: async (p) => {
        seenAtPoll.push((await row(t, operationId)).remoteRunId);
        return json({ id: "run-1", status: "completed", result: { chatText: answer(p) } });
      },
    });
    await drainPolls(t);
    expect(seenAtPoll).toEqual(["run-1"]);
    expect(f.calls.map((c) => [c.method, c.url, c.auth])).toEqual([
      [
        "POST",
        "https://agent.creao.ai/api/v1/apps/app-analyst/runs",
        "Bearer capi-analyst-not-real",
      ],
      [
        "GET",
        "https://agent.creao.ai/api/v1/apps/app-analyst/runs/run-1",
        "Bearer capi-analyst-not-real",
      ],
    ]);
    const analyst = await opOf(t, conversationId, "specialist");
    expect(analyst).toMatchObject({
      status: "succeeded",
      provider: "creao",
      providerMode: "creao",
    });
    expect(analyst.model).toBeUndefined();
    expect(analyst.usage).toBeUndefined();
    expect(analyst).not.toHaveProperty("remoteRunId");
    expect((analyst.profile as { instructions: string }).instructions).toBe(
      [...f.prompt()!.rules, f.prompt()!.outputFormat].join("\n"),
    );
    expect((await row(t, operationId)).remoteRunId).toBe("run-1");
    const s = await state(t, conversationId);
    expect(s.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
    expect(JSON.stringify(s)).not.toMatch(/not-real|run-1/);
    // Reload never redispatches.
    await t.action(internal.investigation.runTurn, { conversationId });
    expect(f.fetch).toHaveBeenCalledTimes(2);
  });

  it("a failed record stops before polling; a late callback or expired lease cannot record", async () => {
    creaoConfig();
    const t = setup();
    const { conversationId, operationIds } = await ask(t);
    await verify(t, conversationId);
    const f = creao({
      // The deadline lands between create and the callback.
      post: async () => {
        await t.mutation(internal.investigation.expireTurn, { operationIds });
        return json({ id: "run-1", status: "queued" });
      },
    });
    await drainPolls(t);
    expect(f.calls.map((c) => c.method)).toEqual(["POST"]);
    const analyst = await opOf(t, conversationId, "specialist");
    expect([analyst.status, analyst.error?.code]).toEqual(["unknown", "outcome_unknown"]);
    expect((await row(t, analyst.operationId)).remoteRunId).toBeUndefined();

    // Guard: only the live claim of a running CREAO op, once, inside its lease.
    const t2 = setup();
    const c2 = (await ask(t2, "req-inv-2")).conversationId;
    const step = () =>
      t2.mutation(internal.investigation.step, { conversationId: c2, providerMode: "creao" });
    await step();
    await step();
    const claimed = (await step())!;
    const record = (claimedAt: string, runId = "run-1") =>
      t2.mutation(internal.investigation.recordRemoteRun, {
        operationId: claimed.operationId,
        claimedAt,
        runId,
        status: "queued",
      });
    expect(await record("other-claim")).toBe(false);
    expect(await record(claimed.claimedAt!)).toBe(true);
    expect(await record(claimed.claimedAt!, "run-2")).toBe(false);
    expect((await row(t2, claimed.operationId)).remoteRunId).toBe("run-1");
    // A result for another run is not accepted as success.
    expect(
      await t2.mutation(internal.investigation.finishSpecialist, {
        operationId: claimed.operationId,
        result: {
          ok: true,
          provider: "creao",
          runId: "run-2",
          output: {
            assessment: "a",
            citations: [{ kind: "source", id: "S7" }],
            uncertainties: ["u"],
          },
        },
      }),
    ).toBe(false);
    expect((await opOf(t2, c2, "specialist")).error?.code).toBe("run_unrecorded");

    const t3 = setup();
    const c3 = (await ask(t3, "req-inv-3")).conversationId;
    const step3 = () =>
      t3.mutation(internal.investigation.step, { conversationId: c3, providerMode: "creao" });
    await step3();
    await step3();
    const c = (await step3())!;
    vi.setSystemTime(Date.now() + 181_000);
    expect(
      await t3.mutation(internal.investigation.recordRemoteRun, {
        operationId: c.operationId,
        claimedAt: c.claimedAt!,
        runId: "run-1",
        status: "queued",
      }),
    ).toBe(false);
  });

  it("uncertain create or deadline ends unknown with one create and no retry", async () => {
    creaoConfig();
    const t = setup();
    const { conversationId } = await ask(t);
    await verify(t, conversationId);
    const f = creao({
      post: () => {
        throw new TypeError("socket closed");
      },
    });
    await drainPolls(t);
    const lost = await opOf(t, conversationId, "specialist");
    expect([lost.status, lost.error?.code]).toEqual(["unknown", "network"]);
    await t.action(internal.investigation.runTurn, { conversationId });
    expect(f.posts()).toBe(1);

    // The provider deadline sits inside the lease: 100 s in, the run gets 70 s, not 150 s.
    const t2 = setup();
    const c2 = (await ask(t2, "req-inv-2")).conversationId;
    await verify(t2, c2);
    const f2 = creao({ poll: () => json({ id: "run-1", status: "running" }) });
    vi.setSystemTime(Date.now() + 100_000);
    await drainPolls(t2);
    const hung = await opOf(t2, c2, "specialist");
    expect([hung.status, hung.error?.code]).toEqual(["unknown", "deadline"]);
    expect(f2.posts()).toBe(1);
    expect((await row(t2, hung.operationId)).remoteRunId).toBe("run-1");

    // Too little lease left: nothing is created.
    const t3 = setup();
    const c3 = (await ask(t3, "req-inv-3")).conversationId;
    await verify(t3, c3);
    const f3 = creao();
    vi.setSystemTime(Date.now() + 150_000);
    await drain(t3);
    const late = await opOf(t3, c3, "specialist");
    expect([late.status, late.error?.code]).toEqual(["failed", "deadline"]);
    expect(f3.fetch).not.toHaveBeenCalled();
  });

  it("a provider switch after queueing fails with no call", async () => {
    creaoConfig();
    const t = setup();
    const { fetch } = claude();
    const { conversationId } = await ask(t);
    devMode();
    await drain(t);
    const analyst = await opOf(t, conversationId, "specialist");
    expect([analyst.status, analyst.error?.code]).toEqual(["failed", "provider_changed"]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
