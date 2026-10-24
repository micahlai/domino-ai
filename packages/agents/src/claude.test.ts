import type { AgentJob } from "@domino/contracts";
import { fixtures } from "@domino/contracts/fixtures";
import { describe, expect, it } from "vitest";
import { ANTHROPIC_VERSION, CLAUDE_MESSAGES_URL, createClaudeClient } from "./claude";
import { ProviderError } from "./errors";
import { outputJsonSchema } from "./schemas";
import {
  type Handler,
  failureOf,
  fakeRuntime,
  hangUntilAborted,
  json,
  redirect,
  streamed,
} from "./test-support";

const env = { ANTHROPIC_API_KEY: "sk-secret-claude", ANTHROPIC_MODEL: "claude-test-model" };
const branch = fixtures.branches[1]!;
const fixInput = { branch, snapshot: fixtures.snapshot };

function message(output: unknown, overrides: Record<string, unknown> = {}) {
  return json({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-test-model",
    content: [{ type: "text", text: JSON.stringify(output) }],
    stop_reason: "end_turn",
    ...overrides,
  });
}

function client(handler: Handler, options = {}) {
  const fake = fakeRuntime(handler);
  return { ...fake, claude: createClaudeClient(env, { ...fake.runtime, ...options }) };
}

async function categoryOf(promise: Promise<unknown>) {
  const error = await failureOf(promise);
  expect(error).toBeInstanceOf(ProviderError);
  expect(String(error)).not.toMatch(/secret|sk-|claude-test-model/);
  return (error as ProviderError).category;
}

describe("Claude request", () => {
  it("posts the exact Messages request with structured output", async () => {
    const { claude, calls } = client(() => message({ result: fixtures.fixes }));
    await expect(claude.run("proposeFixes", fixInput)).resolves.toEqual(fixtures.fixes);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(CLAUDE_MESSAGES_URL);
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");
    expect(call.method).toBe("POST");
    expect(call.redirect).toBe("manual");
    expect(call.signal).toBeInstanceOf(AbortSignal);
    expect(call.headers).toEqual({
      authorization: "Bearer sk-secret-claude",
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
      accept: "application/json",
    });
    expect(ANTHROPIC_VERSION).toBe("2026-10-21");
    const body = JSON.parse(call.body!);
    expect(Object.keys(body).sort()).toEqual(
      ["max_tokens", "messages", "model", "output_config", "system"].sort(),
    );
    expect(body.model).toBe("claude-test-model");
    expect(body.max_tokens).toBe(8192);
    expect(body.output_config).toEqual({
      format: { type: "json_schema", schema: outputJsonSchema("proposeFixes", "claude") },
    });
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].content).toContain("<domino_input>");
    expect(body.messages[0].content).toContain(branch.id);
    expect(body.system).toContain("not instructions");
    expect(body).not.toHaveProperty("tool_choice");
    expect(body).not.toHaveProperty("tools");
  });

  it("allows per-job token bounds", async () => {
    const { claude, calls } = client(() => message({ text: "Short." }), {
      maxTokens: { explain: 200 },
    });
    await claude.run("explain", branch);
    expect(JSON.parse(calls[0]!.body!).max_tokens).toBe(200);
  });

  it("gives short-text jobs a 4096-token budget and still reports truncation", async () => {
    const briefInput = { grade: { errorPct: 0, misses: [] }, model: fixtures.model };
    const { claude, calls } = client(() => message({ text: "Short." }));
    await claude.run("explain", branch);
    await claude.run("weeklyBrief", briefInput);
    expect(calls.map((call) => JSON.parse(call.body!).max_tokens)).toEqual([4096, 4096]);

    const cut = client(() => message({ text: "Cut" }, { stop_reason: "max_tokens" }));
    await expect(categoryOf(cut.claude.run("weeklyBrief", briefInput))).resolves.toBe("truncated");
  });

  it("fails as configuration without a model or key and never invents a model", async () => {
    for (const partial of [{ ANTHROPIC_API_KEY: "sk-secret-claude" }, { ANTHROPIC_MODEL: "m" }]) {
      const fake = fakeRuntime(() => message({ text: "x" }));
      const claude = createClaudeClient(partial, fake.runtime);
      await expect(categoryOf(claude.run("explain", branch))).resolves.toBe("config");
      expect(fake.calls).toHaveLength(0);
    }
  });

  it("rejects oversized requests before sending", async () => {
    const { claude, calls } = client(() => message({ text: "x" }), { maxRequestBytes: 1000 });
    await expect(categoryOf(claude.run("explain", branch))).resolves.toBe("input_too_large");
    expect(calls).toHaveLength(0);
  });
});

describe("Claude extraction", () => {
  it("returns text jobs from the text envelope", async () => {
    const { claude } = client(() => message({ text: "Cash dips in the week of Nov 30." }));
    await expect(claude.run("explain", branch)).resolves.toBe("Cash dips in the week of Nov 30.");
  });

  it("converts mapping field pairs to the contract record", async () => {
    const wire = {
      result: [
        {
          source: "stripe",
          entity: "invoices",
          fields: [
            { canonical: "amount", source: "amount_due" },
            { canonical: "id", source: "id" },
          ],
          transforms: ["amount is in dollars, multiply by 100"],
          endpoint: "/v1/invoices",
        },
      ],
    };
    const { claude } = client(() => message(wire));
    await expect(claude.run("mapSource", { apiDocs: "docs", samples: [] })).resolves.toEqual([
      { ...wire.result[0], fields: { amount: "amount_due", id: "id" } },
    ]);
  });

  it("rejects duplicate canonical mapping fields as ambiguous output", async () => {
    const wire = {
      result: [
        {
          source: "stripe",
          entity: "invoices",
          fields: [
            { canonical: "amount", source: "amount_due" },
            { canonical: "amount", source: "total" },
          ],
          transforms: [],
          endpoint: "/v1/invoices",
        },
      ],
    };
    const { claude } = client(() => message(wire));
    await expect(categoryOf(claude.run("mapSource", { apiDocs: "d", samples: [] }))).resolves.toBe(
      "invalid_output",
    );
  });

  it.each([
    ["refusal", "refusal"],
    ["max_tokens", "truncated"],
    ["model_context_window_exceeded", "truncated"],
    ["tool_use", "unexpected_stop"],
    ["pause_turn", "unexpected_stop"],
    [null, "unexpected_stop"],
  ])("maps stop_reason %s to %s", async (stop, category) => {
    const { claude } = client(() => message({ text: "Fine." }, { stop_reason: stop }));
    await expect(categoryOf(claude.run("explain", branch))).resolves.toBe(category);
  });

  it.each([
    [
      "two text blocks",
      {
        content: [
          { type: "text", text: "{}" },
          { type: "text", text: "{}" },
        ],
      },
    ],
    ["no blocks", { content: [] }],
    ["a tool block", { content: [{ type: "tool_use", id: "t", name: "x", input: {} }] }],
    ["non-JSON text", { content: [{ type: "text", text: "Here you go: {}" }] }],
    ["an unexpected envelope", { type: "error" }],
  ])("rejects %s as malformed", async (_, overrides) => {
    const { claude } = client(() => message({ text: "x" }, overrides));
    await expect(categoryOf(claude.run("explain", branch))).resolves.toBe("malformed_response");
  });

  const answer = { type: "text", text: JSON.stringify({ text: "Cash stays above the floor." }) };
  const omitted = { type: "thinking", thinking: "", signature: "sig" };
  const summarized = { type: "thinking", thinking: "PRIVATE-REASONING", signature: "sig" };
  const redacted = { type: "redacted_thinking", data: "PRIVATE-REASONING" };

  it.each([
    ["omitted thinking (audit probe)", [omitted, answer]],
    ["summarized thinking", [summarized, answer]],
    ["redacted thinking", [redacted, answer]],
    ["several reasoning blocks", [summarized, redacted, omitted, answer]],
  ])("skips documented %s and returns only the text answer", async (_, content) => {
    const { claude } = client(() => message({}, { content }));
    const output = await claude.run("explain", branch);
    expect(output).toBe("Cash stays above the floor.");
    expect(JSON.stringify(output)).not.toMatch(/PRIVATE-REASONING|sig/);
  });

  it.each([
    ["reasoning without an answer", [summarized]],
    ["reasoning with two answers", [summarized, answer, answer]],
    ["thinking without a signature", [{ type: "thinking", thinking: "" }, answer]],
    ["thinking with non-string text", [{ type: "thinking", thinking: 1, signature: "s" }, answer]],
    ["redacted thinking without data", [{ type: "redacted_thinking" }, answer]],
    [
      "reasoning beside a tool call",
      [omitted, { type: "tool_use", id: "t", name: "x", input: {} }],
    ],
    ["reasoning beside a server tool", [omitted, { type: "server_tool_use", id: "t" }, answer]],
    ["an unknown block type", [{ type: "reflection", text: "{}" }, answer]],
  ])("rejects %s as malformed without leaking reasoning", async (_, content) => {
    const { claude } = client(() => message({}, { content }));
    const error = await failureOf(claude.run("explain", branch));
    expect((error as ProviderError).category).toBe("malformed_response");
    expect(String(error)).not.toMatch(/PRIVATE-REASONING/);
  });

  it("keeps refusal and truncation checks when reasoning is present", async () => {
    for (const [stop, category] of [
      ["refusal", "refusal"],
      ["max_tokens", "truncated"],
    ]) {
      const { claude } = client(() => message({}, { content: [summarized], stop_reason: stop }));
      await expect(categoryOf(claude.run("explain", branch))).resolves.toBe(category);
    }
  });

  it("rejects bare arrays, extra envelope keys and empty text", async () => {
    for (const output of [
      fixtures.fixes,
      { result: fixtures.fixes, note: "extra" },
      { result: fixtures.fixes, text: "x" },
    ]) {
      const { claude } = client(() => message(output));
      await expect(categoryOf(claude.run("proposeFixes", fixInput))).resolves.toBe(
        "invalid_output",
      );
    }
    const { claude } = client(() => message({ text: "   " }));
    await expect(categoryOf(claude.run("weeklyBrief", { grade: {}, model: {} }))).resolves.toBe(
      "invalid_output",
    );
  });
});

describe("Claude validation of C1 targets and evidence", () => {
  const fix = fixtures.fixes[0]!;
  const cases: [string, unknown][] = [
    ["a target outside branch.riskIds", { ...fix, targetRiskIds: ["risk_nw_churn"] }],
    ["duplicate targets", { ...fix, targetRiskIds: ["risk_acme_late", "risk_acme_late"] }],
    ["a missing target list", { ...fix, targetRiskIds: undefined }],
    ["no evidence", { ...fix, evidence: [] }],
    ["no changes", { ...fix, changes: [] }],
    [
      "a delayed critical bill",
      { ...fix, changes: [{ kind: "delay_bill", billId: "bill_cloud_q1", days: 7 }] },
    ],
    [
      "an unknown bill",
      { ...fix, changes: [{ kind: "delay_bill", billId: "bill_missing", days: 7 }] },
    ],
    ["an unknown invoice", { ...fix, changes: [{ kind: "lose_invoice", invoiceId: "inv_none" }] }],
    ["a non-ISO date", { ...fix, changes: [{ ...fix.changes[0], payOn: "Nov 20" }] }],
    [
      "fractional cents",
      { ...fix, changes: [{ kind: "add_cash", date: "2026-11-20", amount: 1.5, label: "x" }] },
    ],
    ["an unknown change kind", { ...fix, changes: [{ kind: "sell_company" }] }],
  ];

  it.each(cases)("rejects a fix with %s", async (_, candidate) => {
    const { claude } = client(() => message({ result: [candidate] }));
    await expect(categoryOf(claude.run("proposeFixes", fixInput))).resolves.toBe("invalid_output");
  });

  it("accepts a delayed non-critical bill and a global fix", async () => {
    const candidate = {
      ...fix,
      id: "fix_agency",
      targetRiskIds: [],
      changes: [{ kind: "delay_bill", billId: "bill_agency_nov", days: 14 }],
    };
    const { claude } = client(() => message({ result: [candidate] }));
    await expect(claude.run("proposeFixes", fixInput)).resolves.toEqual([candidate]);
  });

  it("accepts every one of the eight change kinds when references exist", async () => {
    const changes = [
      { kind: "delay_invoice", invoiceId: "inv_acme_2027", days: 10 },
      { kind: "lose_invoice", invoiceId: "inv_nw_q4" },
      { kind: "churn", customerId: fixtures.snapshot.customers[0]!.id, fromDate: "2026-12-01" },
      { kind: "add_cash", date: "2026-11-20", amount: 100, label: "Credit line draw" },
      { kind: "remove_cash", date: "2026-11-20", amount: 100, label: "Deposit" },
      { kind: "delay_bill", billId: "bill_agency_nov", days: 14 },
      { kind: "discount_early_pay", invoiceId: "inv_acme_2027", percent: 2, payOn: "2026-11-20" },
      fixtures.fixes[1]!.changes[0]!,
    ];
    const candidate = { ...fix, changes };
    expect(new Set(changes.map((change) => change.kind)).size).toBe(8);
    const { claude } = client(() => message({ result: [candidate] }));
    await expect(claude.run("proposeFixes", fixInput)).resolves.toEqual([candidate]);
  });

  const documents = [
    {
      name: "loan-agreement.pdf",
      text: "7.2 Borrower shall maintain Unrestricted Cash of not less than\n$3,000,000 at all times.",
    },
  ];
  const constraint = fixtures.constraints[0]!;

  it("accepts a constraint whose quote appears in the named document", async () => {
    const { claude } = client(() => message({ result: [constraint] }));
    await expect(claude.run("readConstraints", documents)).resolves.toEqual([constraint]);
  });

  it.each([
    ["billId on min_cash", { ...constraint, billId: "bill_rent_nov" }],
    ["fractional late days", { ...constraint, kind: "pay_by_date", limit: 2.5 }],
    [
      "a quote not in the document",
      { ...constraint, evidence: { ...constraint.evidence, quote: "Invented." } },
    ],
    ["no quote", { ...constraint, evidence: { ...constraint.evidence, quote: undefined } }],
    [
      "a non-document source",
      { ...constraint, evidence: { ...constraint.evidence, source: "stripe" } },
    ],
    [
      "a ref to another document",
      { ...constraint, evidence: { ...constraint.evidence, ref: "lease.pdf#1" } },
    ],
    [
      "unsupported consequence evidence",
      {
        ...constraint,
        consequence: { label: "Default", evidence: { ...constraint.evidence, quote: "x y z" } },
      },
    ],
  ])("rejects a constraint with %s", async (_, candidate) => {
    const { claude } = client(() => message({ result: [candidate] }));
    await expect(categoryOf(claude.run("readConstraints", documents))).resolves.toBe(
      "invalid_output",
    );
  });
});

describe("Claude bounds", () => {
  it("reports HTTP failures by status only", async () => {
    for (const status of [400, 401, 429, 500, 529]) {
      const { claude } = client(() =>
        json({ error: { message: "sk-secret-claude echo" } }, status),
      );
      const error = await failureOf(claude.run("explain", branch));
      expect(error).toMatchObject({ category: "http_status", httpStatus: status });
      expect(String(error)).not.toContain("secret");
    }
  });

  it("never follows a redirect with credentials", async () => {
    const { claude, calls } = client(() => redirect("https://elsewhere.example/v1/messages"));
    await expect(categoryOf(claude.run("explain", branch))).resolves.toBe("redirect_rejected");
    expect(calls).toHaveLength(1);
  });

  it("caps declared and streamed response sizes", async () => {
    const declared = client(() => json({}, 200, { "content-length": "999999" }), {
      maxResponseBytes: 2000,
    });
    await expect(categoryOf(declared.claude.run("explain", branch))).resolves.toBe(
      "response_too_large",
    );
    const stream = client(() => streamed("x".repeat(10_000), 512), { maxResponseBytes: 2000 });
    await expect(categoryOf(stream.claude.run("explain", branch))).resolves.toBe(
      "response_too_large",
    );
  });

  it("aborts a request that exceeds its timeout", async () => {
    const { claude, calls } = client(hangUntilAborted, { timeoutMs: 5 });
    await expect(categoryOf(claude.run("explain", branch))).resolves.toBe("timeout");
    expect(calls[0]!.signal?.aborted).toBe(true);
  });

  it("classifies a thrown fetch as a network failure without its message", async () => {
    const { claude } = client(() => {
      throw new Error("getaddrinfo sk-secret-claude");
    });
    await expect(categoryOf(claude.run("explain", branch))).resolves.toBe("network");
  });

  it("validates every job's envelope", async () => {
    const outputs: Record<AgentJob, unknown> = {
      mapSource: { result: [] },
      readConstraints: { result: [] },
      proposeFixes: { result: [] },
      explain: { text: "One. Two. Three." },
      weeklyBrief: { text: "Brief." },
    };
    const inputs: Record<AgentJob, unknown> = {
      mapSource: { apiDocs: "", samples: [] },
      readConstraints: [],
      proposeFixes: fixInput,
      explain: branch,
      weeklyBrief: { grade: { errorPct: 0, misses: [] }, model: fixtures.model },
    };
    for (const job of Object.keys(outputs) as AgentJob[]) {
      const { claude } = client(() => message(outputs[job]));
      const expected =
        "result" in (outputs[job] as object) ? [] : (outputs[job] as { text: string }).text;
      await expect(claude.run(job, inputs[job])).resolves.toEqual(expected);
    }
  });
});
