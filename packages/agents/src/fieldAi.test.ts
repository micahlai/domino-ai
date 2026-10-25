import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  type AnalystDigest,
  type CounterpartyJob,
  FIELD_FALLBACK_BETA,
  FIELD_MODEL,
  type FindingRecord,
  type SendMessage,
  acceptAnalystSummary,
  acceptCounterpartyNotes,
  buildCounterpartyCreaoPrompt,
  counterpartyProfileVersion,
  explainFindings,
  newMoneyMentions,
  pickFindingsToExplain,
  runCreaoCounterpartyResearch,
  summarizeScenarios,
} from "./fieldAi";
import { RESULT_END, RESULT_START } from "./prompts";
import { fakeRuntime, json } from "./test-support";

type Body = Parameters<SendMessage>[0];
type Message = Awaited<ReturnType<SendMessage>>;

/** A stub Messages client: records every request, answers with one canned message. */
function stub(reply: Partial<Message> | Error) {
  const calls: Body[] = [];
  const send: SendMessage = async (body) => {
    calls.push(body);
    if (reply instanceof Error) throw reply;
    return {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: FIELD_MODEL,
      content: [],
      stop_reason: "end_turn",
      stop_details: null,
      usage: { input_tokens: 120, output_tokens: 80 },
      ...reply,
    } as unknown as Message;
  };
  return { send, calls };
}
const text = (value: unknown) =>
  ({
    content: [{ type: "text", text: JSON.stringify(value), citations: null }],
  }) as unknown as Partial<Message>;

const findings: FindingRecord[] = [
  {
    findingId: "f-low",
    kind: "unusual_timing",
    severity: "low",
    summary: "Bill b1 paid 9 days early",
    refs: ["b1"],
  },
  {
    findingId: "f-high",
    kind: "duplicate",
    severity: "high",
    summary: "Invoice inv_7 for $4,200 appears twice",
    refs: ["inv_7", "inv_7b"],
  },
];

describe("audit explainer", () => {
  it("builds one batched, bounded request from the finding records only", async () => {
    const { send, calls } = stub(
      text({
        explanations: [
          {
            findingId: "f-high",
            explanation: "A duplicate $4,200 invoice would overstate cash coming in.",
            suggestedCheck: "Open inv_7 in Stripe and void the copy.",
          },
        ],
      }),
    );
    const out = await explainFindings(send, findings);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value[0]?.findingId).toBe("f-high");
      expect(out.usage).toEqual({ inputTokens: 120, outputTokens: 80 });
    }
    expect(calls).toHaveLength(1);
    const body = calls[0] as Body;
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.betas).toEqual([FIELD_FALLBACK_BETA]);
    expect(body.fallbacks).toBe("default");
    expect(body.output_config?.effort).toBe("low");
    expect(body.output_config?.format?.type).toBe("json_schema");
    expect(body).not.toHaveProperty("thinking");
    expect(body).not.toHaveProperty("temperature");
    const user = JSON.stringify(body.messages);
    expect(user).toContain("inv_7");
    expect(user).toContain("f-low");
    // High severity first in the prompt.
    expect(user.indexOf("f-high")).toBeLessThan(user.indexOf("f-low"));
  });

  it("caps the batch at 8 findings", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...findings[0],
      findingId: `f${i.toString().padStart(2, "0")}`,
    })) as FindingRecord[];
    expect(pickFindingsToExplain(many)).toHaveLength(8);
  });

  it("rejects unknown ids, duplicates and invented money", async () => {
    for (const bad of [
      { explanations: [{ findingId: "nope", explanation: "x", suggestedCheck: "y" }] },
      {
        explanations: [
          { findingId: "f-high", explanation: "x", suggestedCheck: "y" },
          { findingId: "f-high", explanation: "x", suggestedCheck: "y" },
        ],
      },
      {
        explanations: [
          { findingId: "f-high", explanation: "Costs about $9,999.", suggestedCheck: "y" },
        ],
      },
      { explanations: [{ findingId: "f-high", explanation: "x" }] },
    ]) {
      const out = await explainFindings(stub(text(bad)).send, findings);
      expect(out).toMatchObject({ ok: false, reason: "invalid_output" });
    }
  });

  it("handles a refusal before reading content", async () => {
    const out = await explainFindings(
      stub({
        stop_reason: "refusal",
        stop_details: { type: "refusal", category: "cyber", explanation: null },
        content: [{ type: "text", text: "not json", citations: null }],
      } as unknown as Partial<Message>).send,
      findings,
    );
    expect(out).toMatchObject({ ok: false, reason: "refusal", detail: "declined (cyber)" });
    expect(out.usage).toEqual({ inputTokens: 120, outputTokens: 80 });
  });

  it("maps truncation and typed SDK errors without retrying", async () => {
    const cut = await explainFindings(stub({ stop_reason: "max_tokens" }).send, findings);
    expect(cut).toMatchObject({ ok: false, reason: "truncated" });
    const limited = stub(new Anthropic.RateLimitError(429, {}, "slow down", new Headers()));
    expect(await explainFindings(limited.send, findings)).toMatchObject({
      ok: false,
      reason: "rate_limited",
    });
    expect(limited.calls).toHaveLength(1);
    const down = stub(new Anthropic.InternalServerError(503, {}, "down", new Headers()));
    expect(await explainFindings(down.send, findings)).toMatchObject({
      ok: false,
      reason: "api_error",
      detail: "HTTP 503",
    });
    const offline = stub(new Anthropic.APIConnectionError({ message: "offline" }));
    expect(await explainFindings(offline.send, findings)).toMatchObject({
      ok: false,
      reason: "network",
    });
  });
});

const digest: AnalystDigest = {
  asOf: "2026-11-02",
  snapshotVersion: 3,
  baseline: { survives: true, lowPoint: "$410K" },
  failedForecasters: 0,
  scenarios: [
    {
      index: 0,
      title: "Halcyon Freight leaves",
      basis: "largest customer",
      survives: false,
      breaksWeek: 8,
      brokenRule: "min_cash",
      lowPoint: "-$120K",
      lowWeek: 9,
      worstWeekVsBase: "-$530K",
      worstWeek: 9,
      bestFix: {
        label: "Draw the credit line",
        gain: "$600K",
        survivesWithFix: true,
        risk: "low",
        costNote: "interest",
      },
    },
    {
      index: 1,
      title: "Big customers pay 30 days late",
      basis: "payment history",
      survives: true,
      breaksWeek: null,
      brokenRule: null,
      lowPoint: "$150K",
      lowWeek: 6,
      worstWeekVsBase: "-$260K",
      worstWeek: 6,
      bestFix: null,
    },
  ],
};

describe("analyst summary", () => {
  const good = {
    recommendation:
      "One of two scenarios fails: if Halcyon Freight leaves, cash breaks the lender's limit in week 8. The worst week is -$530K against the base forecast. Look first at drawing the credit line, which scores $600K and survives.",
    rationale: "The customer loss is the only failing case and the fix clears it.",
    citedScenarios: [0],
  };

  it("sends engine results and accepts a three-sentence summary", async () => {
    const { send, calls } = stub(text(good));
    const out = await summarizeScenarios(send, digest);
    expect(out).toMatchObject({ ok: true, value: good });
    const user = JSON.stringify(calls[0]?.messages);
    expect(user).toContain("Halcyon Freight leaves");
    expect(user).toContain("-$530K");
    expect(user).toContain("Draw the credit line");
  });

  it("rejects more than three sentences, unknown scenarios and new amounts", () => {
    expect(
      acceptAnalystSummary(digest, { ...good, recommendation: "One. Two. Three. Four." }),
    ).toBeUndefined();
    expect(acceptAnalystSummary(digest, { ...good, citedScenarios: [7] })).toBeUndefined();
    expect(
      acceptAnalystSummary(digest, { ...good, rationale: "It saves about $1.1M overall." }),
    ).toBeUndefined();
    expect(acceptAnalystSummary(digest, { ...good, extra: true })).toBeUndefined();
  });

  it("detects money not present in the input", () => {
    expect(newMoneyMentions("lost $530K and $12", "-$530K")).toEqual(["$12"]);
    expect(newMoneyMentions("no money here", "")).toEqual([]);
  });
});

const job: CounterpartyJob = {
  company: "Kestrel Analytics",
  asOf: "2026-11-02",
  counterparties: [
    { name: "Halcyon Freight", role: "customer", rank: 1, facts: ["2 open invoices"] },
    { name: "Northwind Cloud", role: "vendor", rank: 1, facts: ["critical vendor"] },
  ],
};
const creaoEnv = {
  CREAO_HISTORICAL_EVIDENCE_ANALYST_APP_ID: "app_research",
  CREAO_HISTORICAL_EVIDENCE_ANALYST_API_KEY: "test-key",
};
const notes = {
  notes: [
    { counterparty: "Halcyon Freight", risk: "high", note: "Largest customer; watch renewal." },
  ],
};

describe("CREAO counterparty research", () => {
  it("is unavailable without config and sends nothing", async () => {
    const { runtime, calls } = fakeRuntime(() => json({}));
    await expect(runCreaoCounterpartyResearch({}, job, runtime)).rejects.toMatchObject({
      category: "config",
    });
    expect(calls).toHaveLength(0);
  });

  it("runs one app-scoped job and validates the delimited answer", async () => {
    const chatText = `Here you go\n${RESULT_START}\n${JSON.stringify(notes)}\n${RESULT_END}`;
    const { runtime, calls } = fakeRuntime((call, i) =>
      i === 0
        ? json({ id: "run_42", status: "queued" }, 201)
        : json({ id: "run_42", status: "completed", result: { chatText } }),
    );
    const created: string[] = [];
    const out = await runCreaoCounterpartyResearch(creaoEnv, job, {
      ...runtime,
      // The callback races a deadline sleep; the fake clock would jump past it at once.
      sleep: (ms) => (ms > 10_000 ? new Promise<void>(() => {}) : runtime.sleep(ms)),
      onRunCreated: ({ runId }) => {
        created.push(runId);
      },
    });
    expect(out.runId).toBe("run_42");
    expect(out.notes[0]?.risk).toBe("high");
    expect(created).toEqual(["run_42"]);
    expect(calls[0]?.url).toBe("https://agent.creao.ai/api/v1/apps/app_research/runs");
    const prompt = JSON.parse(JSON.parse(calls[0]?.body ?? "{}").inputs.prompt);
    expect(prompt.task).toBe("fieldCounterpartyRisk");
    expect(prompt.data.counterparties.map((c: { name: string }) => c.name)).toEqual([
      "Halcyon Freight",
      "Northwind Cloud",
    ]);
  });

  it("returns no result (not a canned one) when the answer fails validation", async () => {
    const bad = { notes: [{ counterparty: "Someone else", risk: "low", note: "fine" }] };
    const chatText = `${RESULT_START}\n${JSON.stringify(bad)}\n${RESULT_END}`;
    const { runtime } = fakeRuntime((call, i) =>
      i === 0
        ? json({ id: "run_9", status: "queued" }, 201)
        : json({ id: "run_9", status: "completed", result: { chatText } }),
    );
    await expect(runCreaoCounterpartyResearch(creaoEnv, job, runtime)).rejects.toMatchObject({
      category: "invalid_output",
    });
  });

  it("rejects money in notes and keeps a stable profile version", async () => {
    expect(
      acceptCounterpartyNotes(job, {
        notes: [{ counterparty: "Halcyon Freight", risk: "high", note: "Owes $50K" }],
      }),
    ).toBeUndefined();
    expect(buildCounterpartyCreaoPrompt(job)).toContain('"outputSchema"');
    expect(await counterpartyProfileVersion()).toMatch(/^field_counterparty@creao-[0-9a-f]{12}$/);
  });
});
