import { describe, expect, it } from "vitest";
import { RESULT_END, RESULT_START } from "./prompts";
import { SMOKE_CONFIRMATION, runSmoke, smokeInputs } from "./smoke";
import { fakeRuntime, json } from "./test-support";

const env = {
  SMOKE_CONFIRM: SMOKE_CONFIRMATION,
  ANTHROPIC_API_KEY: "sk-secret-claude",
  ANTHROPIC_MODEL: "claude-test-model",
  CREAO_API_KEY: "capi_secret_creao",
  CREAO_AGENT_ID_CONSTRAINTS: "agent-constraints",
};
const constraint = {
  id: "con_min",
  label: "Lender's minimum",
  kind: "min_cash",
  limit: 300_000_000,
  evidence: {
    source: "document",
    ref: "synthetic-loan.txt#7.2",
    quote: "Borrower shall maintain Unrestricted Cash of not less than $3,000,000 at all times.",
    note: "The loan needs at least $3M of unrestricted cash.",
  },
};

describe("manual smoke", () => {
  it("refuses to run without an explicit job, backend and confirmation", async () => {
    const fake = fakeRuntime(() => json({}));
    for (const partial of [
      { SMOKE_JOB: "explain" },
      { SMOKE_BACKEND: "claude" },
      { SMOKE_JOB: "explain", SMOKE_BACKEND: "claude", SMOKE_CONFIRM: "yes" },
      { SMOKE_JOB: "everything", SMOKE_BACKEND: "claude" },
    ]) {
      await expect(
        runSmoke({ ...env, SMOKE_CONFIRM: undefined, ...partial }, fake.runtime),
      ).resolves.toEqual({
        ok: false,
        reason: "usage",
      });
    }
    expect(fake.calls).toHaveLength(0);
  });

  it("reports a CREAO failure as CREAO and never calls Claude", async () => {
    const fake = fakeRuntime((call) =>
      call.method === "POST" && call.url.includes("creao")
        ? json({ id: "r", status: "pending" }, 202)
        : json({ id: "r", status: "failed" }),
    );
    const report = await runSmoke(
      { ...env, SMOKE_JOB: "readConstraints", SMOKE_BACKEND: "creao" },
      { ...fake.runtime, creao: { pollIntervalMs: 1 } },
    );
    expect(report).toEqual({
      ok: false,
      job: "readConstraints",
      backend: "creao",
      reason: "provider_error",
      category: "run_failed",
      durationMs: 1,
    });
    expect(fake.calls.every((call) => call.url.startsWith("https://agent.creao.ai/"))).toBe(true);
    expect(fake.calls).toHaveLength(2);
  });

  it("summarizes a validated synthetic result without credentials", async () => {
    const chatText = `${RESULT_START}\n${JSON.stringify({ result: [constraint] })}\n${RESULT_END}`;
    const fake = fakeRuntime((call) =>
      call.method === "POST"
        ? json({ id: "r", status: "pending" }, 202)
        : json({ id: "r", status: "completed", result: { chatText } }),
    );
    const report = await runSmoke(
      { ...env, SMOKE_JOB: "readConstraints", SMOKE_BACKEND: "creao" },
      { ...fake.runtime, creao: { pollIntervalMs: 1 } },
    );
    expect(report).toEqual({
      ok: true,
      job: "readConstraints",
      backend: "creao",
      durationMs: 1,
      summary: { items: 1 },
    });
    expect(JSON.stringify(report)).not.toMatch(/secret|capi_|sk-|http/);
    const prompt = JSON.parse(JSON.parse(fake.calls[0]!.body!).inputs.prompt);
    expect(prompt.data).toEqual(smokeInputs.readConstraints);
  });

  it("reports Claude configuration failures without a network call", async () => {
    const fake = fakeRuntime(() => json({}));
    await expect(
      runSmoke(
        { ...env, ANTHROPIC_MODEL: undefined, SMOKE_JOB: "explain", SMOKE_BACKEND: "claude" },
        fake.runtime,
      ),
    ).resolves.toMatchObject({ ok: false, backend: "claude", category: "config" });
    expect(fake.calls).toHaveLength(0);
  });
});
