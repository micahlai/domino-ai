import { fixtures } from "@domino/contracts/fixtures";
import { describe, expect, it } from "vitest";
import { createAgentRuntime, createAgents } from "./agents";
import { RESULT_END, RESULT_START } from "./prompts";
import { AgentJobError, type AttemptDiagnostic } from "./router";
import { type RecordedCall, fakeRuntime, json } from "./test-support";

const env = {
  ANTHROPIC_API_KEY: "sk-secret-claude",
  ANTHROPIC_MODEL: "claude-test-model",
  CREAO_API_KEY: "capi_secret_creao",
  CREAO_AGENT_ID_MAPSOURCE: "agent-map",
  CREAO_AGENT_ID_CONSTRAINTS: "agent-constraints",
  CREAO_AGENT_ID_BRIEF: "agent-brief",
};
const mapping = {
  source: "stripe",
  entity: "invoices",
  fields: { amount: "amount_due" },
  transforms: [],
  endpoint: "/v1/invoices",
};
const wireMapping = { ...mapping, fields: [{ canonical: "amount", source: "amount_due" }] };
const branch = fixtures.branches[1]!;

const isClaude = (call: RecordedCall) => call.url.startsWith("https://api.anthropic.com/");
const claudeMessage = (output: unknown, stop = "end_turn") =>
  json({
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: JSON.stringify(output) }],
    stop_reason: stop,
  });

function setup(
  creao: (call: RecordedCall) => Response,
  claude: (call: RecordedCall) => Response,
  overrides: Record<string, string | undefined> = {},
) {
  const fake = fakeRuntime((call) => (isClaude(call) ? claude(call) : creao(call)));
  const diagnostics: AttemptDiagnostic[] = [];
  const runtime = createAgentRuntime(
    { ...env, ...overrides },
    { ...fake.runtime, onAttempt: (d) => diagnostics.push(d), creao: { pollIntervalMs: 10 } },
  );
  const count = () => ({
    creao: fake.calls.filter((call) => !isClaude(call)).length,
    claude: fake.calls.filter(isClaude).length,
  });
  return { ...runtime, ...fake, diagnostics, count };
}

const creaoRun = (status: string, result?: unknown) => (call: RecordedCall) =>
  call.method === "POST"
    ? json({ id: "run_9", status: "pending" }, 202)
    : json({ id: "run_9", status, result });

function expectSafe(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(/secret|capi_|sk-|https?:|agent-map|run_9/);
  expect(String(value)).not.toMatch(/secret|capi_|sk-|https?:|agent-map|run_9/);
}

describe("createAgents with real transports", () => {
  it("answers from CREAO and reports the backend", async () => {
    const chatText = `${RESULT_START}\n${JSON.stringify({ result: [mapping] })}\n${RESULT_END}`;
    const { runJob, count, diagnostics } = setup(creaoRun("completed", { chatText }), () =>
      claudeMessage({ result: [wireMapping] }),
    );
    await expect(runJob("mapSource", { apiDocs: "docs", samples: [] })).resolves.toEqual({
      value: [mapping],
      backend: "creao",
    });
    expect(count()).toEqual({ creao: 2, claude: 0 });
    expect(diagnostics).toEqual([
      { job: "mapSource", backend: "creao", attempt: 1, outcome: "ok" },
    ]);
  });

  it("falls back to Claude after two failed CREAO runs, with safe diagnostics", async () => {
    const { runJob, count, diagnostics } = setup(creaoRun("failed"), () =>
      claudeMessage({ result: [wireMapping] }),
    );
    await expect(runJob("mapSource", { apiDocs: "docs", samples: [] })).resolves.toEqual({
      value: [mapping],
      backend: "claude",
    });
    expect(count()).toEqual({ creao: 4, claude: 1 });
    expect(diagnostics).toEqual([
      {
        job: "mapSource",
        backend: "creao",
        attempt: 1,
        outcome: "provider_error",
        category: "run_failed",
      },
      {
        job: "mapSource",
        backend: "creao",
        attempt: 2,
        outcome: "provider_error",
        category: "run_failed",
      },
      { job: "mapSource", backend: "claude", attempt: 3, outcome: "ok" },
    ]);
    expectSafe(diagnostics);
  });

  it("bounds total work at two CREAO runs and two Claude calls", async () => {
    const { agents, count } = setup(
      () => json({ error: "capi_secret_creao" }, 500),
      () => json({ error: "sk-secret-claude" }, 529),
    );
    const error = await agents.readConstraints([{ name: "a", text: "b" }]).catch((cause) => cause);
    expect(error).toBeInstanceOf(AgentJobError);
    expect(error).toMatchObject({
      attemptedBackends: ["creao", "creao", "claude", "claude"],
      failures: [
        { backend: "creao", category: "http_status", httpStatus: 500 },
        { backend: "creao", category: "http_status", httpStatus: 500 },
        { backend: "claude", category: "http_status", httpStatus: 529 },
        { backend: "claude", category: "http_status", httpStatus: 529 },
      ],
    });
    expect(count()).toEqual({ creao: 2, claude: 2 });
    expectSafe(error);
    expectSafe((error as AgentJobError).failures);
  });

  it("treats missing CREAO credentials as a provider failure and still falls back", async () => {
    const { agents, count, diagnostics } = setup(
      creaoRun("completed", {}),
      () => claudeMessage({ text: "Cash was close to plan." }),
      { CREAO_API_KEY: undefined },
    );
    await expect(
      agents.weeklyBrief({ grade: { errorPct: 1, misses: [] }, model: fixtures.model }),
    ).resolves.toBe("Cash was close to plan.");
    expect(count()).toEqual({ creao: 0, claude: 1 });
    expect(diagnostics.map((d) => d.category)).toEqual(["config", "config", undefined]);
  });

  it("never sends Claude-primary jobs to CREAO", async () => {
    const { agents, count } = setup(creaoRun("completed", {}), () =>
      claudeMessage({ text: "x" }, "refusal"),
    );
    const error = await agents.explain(branch).catch((cause) => cause);
    expect(error).toMatchObject({
      attemptedBackends: ["claude", "claude"],
      failures: [{ category: "refusal" }, { category: "refusal" }],
    });
    expect(count()).toEqual({ creao: 0, claude: 2 });
  });

  it("honours AGENT_BACKEND overrides through the real transports", async () => {
    const { runJob, count } = setup(
      creaoRun("completed", {}),
      () => claudeMessage({ result: [wireMapping] }),
      { AGENT_BACKEND_MAPSOURCE: "claude" },
    );
    await expect(runJob("mapSource", { apiDocs: "docs", samples: [] })).resolves.toEqual({
      value: [mapping],
      backend: "claude",
    });
    expect(count()).toEqual({ creao: 0, claude: 1 });
  });

  it("reads no credentials until a job runs", async () => {
    const fake = fakeRuntime(() => claudeMessage({ text: "x" }));
    const agents = createAgents({}, fake.runtime);
    expect(fake.calls).toHaveLength(0);
    await expect(agents.explain(branch)).rejects.toBeInstanceOf(AgentJobError);
    expect(fake.calls).toHaveLength(0);
  });

  it("ignores a throwing diagnostic hook", async () => {
    const fake = fakeRuntime(() => claudeMessage({ text: "Fine." }));
    const agents = createAgents(env, {
      ...fake.runtime,
      onAttempt: () => {
        throw new Error("logger down");
      },
    });
    await expect(agents.explain(branch)).resolves.toBe("Fine.");
  });
});
