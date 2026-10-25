import { describe, expect, it } from "vitest";
import {
  type AnalystDigest,
  type FindingRecord,
  buildCounterpartyCreaoPrompt,
  counterpartyProfileVersion,
} from "./fieldAi";
import {
  type CoordinatorInput,
  FieldCreaoRejected,
  acceptCoordinatorPlan,
  buildFieldCreaoPrompt,
  checkCoordinatorPlan,
  coordinatorCreaoJob,
  counterpartyCreaoJob,
  explainCreaoJob,
  fieldCreaoProfileVersion,
  runFieldCreaoJob,
  summaryCreaoJob,
} from "./fieldCreao";
import { RESULT_END, RESULT_START } from "./prompts";
import { fakeRuntime, json } from "./test-support";

const env = {
  CREAO_HISTORICAL_EVIDENCE_ANALYST_APP_ID: "app_field",
  CREAO_HISTORICAL_EVIDENCE_ANALYST_API_KEY: "test-key",
};
const findings: FindingRecord[] = [
  {
    findingId: "f-high",
    kind: "duplicate",
    severity: "high",
    summary: "Invoice inv_7 for $4,200 appears twice",
    refs: ["inv_7", "inv_7b"],
  },
];
const digest: AnalystDigest = {
  asOf: "2026-11-02",
  snapshotVersion: 3,
  baseline: { survives: true, lowPoint: "$410K" },
  failedForecasters: 0,
  focusScenario: 0,
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
      bestFix: null,
    },
  ],
};
const input: CoordinatorInput = {
  company: "Kestrel Analytics",
  asOf: "2026-11-02",
  snapshotVersion: 3,
  snapshot: {
    baseline: { survives: true, lowPoint: "$410K" },
    openFlags: 2,
    openEscalations: 1,
    failingScenarios: 1,
    scenarios: 1,
  },
  flags: [
    {
      findingId: "f-high",
      kind: "duplicate",
      severity: "high",
      summary: "inv_7 twice",
      escalated: true,
    },
    {
      findingId: "f-mid",
      kind: "unusual_amount",
      severity: "medium",
      summary: "big bill",
      escalated: false,
    },
  ],
  scenarios: digest.scenarios,
  counterparties: [{ name: "Halcyon Freight", role: "customer", rank: 1 }],
};
const goodPlan = {
  summary: "Review the duplicate first, then the customer loss that breaks the lender's limit.",
  actions: [
    {
      action: "escalate_flag",
      findingId: "f-mid",
      reason: "Unusual bill size near the low point.",
    },
    {
      action: "focus_scenario",
      scenarioIndex: 0,
      reason: "Only failing scenario; low point -$120K.",
    },
    {
      action: "research_counterparty",
      counterparty: "Halcyon Freight",
      reason: "Largest customer.",
    },
  ],
};
const delimited = (value: unknown) => `${RESULT_START}\n${JSON.stringify(value)}\n${RESULT_END}`;

describe("field CREAO jobs", () => {
  it("has stable, distinct profile versions per role", async () => {
    const versions = await Promise.all(
      (["explain", "summary", "coordinator"] as const).map(fieldCreaoProfileVersion),
    );
    expect(versions[0]).toMatch(/^field_explain@creao-[0-9a-f]{12}$/);
    expect(versions[1]).toMatch(/^field_summary@creao-[0-9a-f]{12}$/);
    expect(versions[2]).toMatch(/^field_coordinator@creao-[0-9a-f]{12}$/);
    expect(new Set([...versions, await counterpartyProfileVersion()]).size).toBe(4);
    expect(await fieldCreaoProfileVersion("explain")).toBe(versions[0]);
  });

  it("sends a self-contained explain job on the app-scoped route and validates the answer", async () => {
    const answer = {
      explanations: [
        {
          findingId: "f-high",
          explanation: "A duplicate $4,200 invoice would overstate cash coming in.",
          suggestedCheck: "Open inv_7 in the billing tool and void the copy.",
        },
      ],
    };
    const { runtime, calls } = fakeRuntime((_call, i) =>
      i === 0
        ? json({ id: "run_7", status: "queued" }, 201)
        : json({ id: "run_7", status: "completed", result: { chatText: delimited(answer) } }),
    );
    const out = await runFieldCreaoJob(env, explainCreaoJob(findings), runtime);
    expect(out).toEqual({ runId: "run_7", value: answer.explanations });
    expect(calls[0]?.url).toBe("https://agent.creao.ai/api/v1/apps/app_field/runs");
    const prompt = JSON.parse(JSON.parse(calls[0]?.body ?? "{}").inputs.prompt);
    expect(prompt.task).toBe("fieldExplainFlags");
    expect(prompt.rules.join(" ")).toMatch(/Never calculate/);
    expect(prompt.outputFormat).toContain(RESULT_START);
    expect(prompt.outputSchema.properties.explanations.items.properties.findingId.enum).toEqual([
      "f-high",
    ]);
    expect(prompt.data.findings[0].findingId).toBe("f-high");
  });

  it("reports invalid_output for a summary that invents money, and config without the app", async () => {
    const bad = {
      recommendation: "It fails. It costs $2M. Act now.",
      rationale: "Big loss.",
      citedScenarios: [0],
    };
    const { runtime } = fakeRuntime((_call, i) =>
      i === 0
        ? json({ id: "run_8", status: "queued" }, 201)
        : json({ id: "run_8", status: "completed", result: { chatText: delimited(bad) } }),
    );
    await expect(runFieldCreaoJob(env, summaryCreaoJob(digest), runtime)).rejects.toMatchObject({
      category: "invalid_output",
    });
    const none = fakeRuntime(() => json({}));
    await expect(runFieldCreaoJob({}, summaryCreaoJob(digest), none.runtime)).rejects.toMatchObject(
      { category: "config" },
    );
    expect(none.calls).toHaveLength(0);
  });
});

describe("coordinator plan", () => {
  it("accepts allowlisted actions on known ids and amounts already in the input", () => {
    expect(acceptCoordinatorPlan(input, goodPlan)).toEqual({
      summary: goodPlan.summary,
      escalate: [{ findingId: "f-mid", reason: "Unusual bill size near the low point." }],
      focus: { scenarioIndex: 0, reason: "Only failing scenario; low point -$120K." },
      research: { counterparty: "Halcyon Freight", reason: "Largest customer." },
    });
    const schema = coordinatorCreaoJob(input).outputSchema as {
      properties: { actions: { items: { anyOf: unknown[] } } };
    };
    expect(schema.properties.actions.items.anyOf).toHaveLength(3);
  });

  it("rejects an unknown action", () => {
    const plan = {
      ...goodPlan,
      actions: [...goodPlan.actions, { action: "pay_vendor", vendor: "Northwind", reason: "x" }],
    };
    expect(acceptCoordinatorPlan(input, plan)).toBeUndefined();
  });

  it("removes invented amounts from plan text and strips extra fields instead of rejecting", () => {
    const plan = acceptCoordinatorPlan(input, {
      ...goodPlan,
      summary: "Cash falls by $9,999 next week.",
      priority: "high",
      actions: [
        { action: "focus_scenario", scenarioIndex: "0", reason: "Drawing $250K fixes it." },
        { action: "escalate_flag", findingId: "f-mid", reason: "Big.", amount: 25_000 },
      ],
    });
    expect(plan).toEqual({
      summary: "Cash falls by [amount removed] next week.",
      escalate: [{ findingId: "f-mid", reason: "Big." }],
      focus: { scenarioIndex: 0, reason: "Drawing [amount removed] fixes it." },
      research: null,
    });
    // An engine amount from the input stays.
    expect(acceptCoordinatorPlan(input, goodPlan)?.focus?.reason).toContain("-$120K");
  });

  it("rejects unknown ids and conflicting picks with reasons; tolerates repeats and extras", () => {
    const esc = (findingId: string) => ({ action: "escalate_flag", findingId, reason: "Check." });
    const unknown = checkCoordinatorPlan(input, { ...goodPlan, actions: [esc("f-nope")] });
    expect(unknown).toEqual({
      ok: false,
      issues: ['actions.0.findingId: unknown id "f-nope"; use one of f-high, f-mid'],
    });
    expect(
      acceptCoordinatorPlan(input, { ...goodPlan, actions: [esc("f-mid"), esc("f-mid")] }),
    ).toMatchObject({ escalate: [{ findingId: "f-mid" }] });
    const four = {
      ...input,
      flags: ["a", "b", "c", "d"].map((id) => ({ ...input.flags[0]!, findingId: id })),
    };
    expect(
      acceptCoordinatorPlan(four, { ...goodPlan, actions: ["a", "b", "c", "d"].map(esc) })
        ?.escalate,
    ).toHaveLength(3);
    expect(
      checkCoordinatorPlan(input, {
        ...goodPlan,
        actions: [{ action: "focus_scenario", scenarioIndex: 5, reason: "x" }],
      }),
    ).toEqual({ ok: false, issues: ["actions.0.scenarioIndex: unknown index 5; use one of 0"] });
    expect(
      checkCoordinatorPlan(input, {
        ...goodPlan,
        actions: [{ action: "research_counterparty", counterparty: "Acme", reason: "x" }],
      }),
    ).toMatchObject({ ok: false, issues: [expect.stringMatching(/unknown name "Acme"/)] });
    const two = { ...input, scenarios: [...input.scenarios, { ...input.scenarios[0]!, index: 1 }] };
    expect(
      checkCoordinatorPlan(two, {
        ...goodPlan,
        actions: [
          { action: "focus_scenario", scenarioIndex: 0, reason: "x" },
          { action: "focus_scenario", scenarioIndex: 1, reason: "y" },
        ],
      }),
    ).toEqual({ ok: false, issues: ["actions.1: a second focus_scenario; pick exactly one"] });
    const action = checkCoordinatorPlan(input, {
      ...goodPlan,
      actions: [{ action: "pay_vendor", vendor: "Northwind", reason: "x" }],
    });
    expect(action).toMatchObject({
      ok: false,
      issues: [expect.stringMatching(/^actions\.0\.action: Invalid discriminator/)],
    });
    // A wrapped plan and a missing reason are harmless.
    expect(
      acceptCoordinatorPlan(input, {
        result: {
          summary: "Look at scenario 1.",
          actions: [{ action: "focus_scenario", scenarioIndex: 0 }],
        },
      }),
    ).toMatchObject({ focus: { scenarioIndex: 0, reason: "" } });
  });

  it("lists the allowed ids and an example plan in the output schema", () => {
    const schema = coordinatorCreaoJob(input).outputSchema as {
      description: string;
      examples: { actions: { action: string; findingId?: string }[] }[];
    };
    expect(schema.description).toContain("findingId: f-high, f-mid");
    expect(schema.description).toContain("counterparty: Halcyon Freight");
    expect(schema.examples[0]?.actions.map((a) => a.action)).toEqual([
      "escalate_flag",
      "focus_scenario",
      "research_counterparty",
    ]);
    expect(acceptCoordinatorPlan(input, schema.examples[0])).toBeDefined();
  });
});

describe("rejections and repair", () => {
  const plan = (answer: unknown, id: string) =>
    fakeRuntime((_call, i) =>
      i === 0
        ? json({ id, status: "queued" }, 201)
        : json({ id, status: "completed", result: { chatText: delimited(answer) } }),
    );

  it("reports the exact validation issues and the rejected answer", async () => {
    const bad = { summary: "x", actions: [{ action: "focus_scenario", scenarioIndex: 4 }] };
    const { runtime } = plan(bad, "run_9");
    const error = await runFieldCreaoJob(env, coordinatorCreaoJob(input), runtime).catch((e) => e);
    expect(error).toBeInstanceOf(FieldCreaoRejected);
    expect(error).toMatchObject({
      category: "invalid_output",
      issues: ["actions.0.scenarioIndex: unknown index 4; use one of 0"],
      detail: "actions.0.scenarioIndex: unknown index 4; use one of 0",
      output: bad,
    });
  });

  it("sends a repair run with the issues and the previous answer", async () => {
    const { runtime, calls } = plan(goodPlan, "run_10");
    const repair = {
      issues: ["actions.0.scenarioIndex: unknown index 4"],
      previousOutput: { a: 1 },
    };
    const out = await runFieldCreaoJob(env, coordinatorCreaoJob(input), { ...runtime, repair });
    expect(out.runId).toBe("run_10");
    const prompt = JSON.parse(JSON.parse(calls[0]?.body ?? "{}").inputs.prompt);
    expect(prompt.repair).toEqual(repair);
    expect(prompt.rules.join(" ")).toMatch(/repair\.issues/);
    expect(buildFieldCreaoPrompt(coordinatorCreaoJob(input))).not.toContain('"repair"');
  });

  it("runs counterparty research as the research role with the same prompt and profile", async () => {
    const job = {
      company: "Kestrel Analytics",
      asOf: "2026-11-02",
      counterparties: [
        { name: "Halcyon Freight", role: "customer" as const, rank: 1, facts: ["Rank 1"] },
      ],
    };
    expect(buildFieldCreaoPrompt(counterpartyCreaoJob(job))).toBe(
      buildCounterpartyCreaoPrompt(job),
    );
    expect(await fieldCreaoProfileVersion("research")).toBe(await counterpartyProfileVersion());
    expect(
      counterpartyCreaoJob(job).check({
        notes: [{ counterparty: "Acme", risk: "low", note: "x" }],
      }),
    ).toEqual({ ok: false, issues: ['notes.0.counterparty: unknown name "Acme"'] });
  });
});

describe("field CREAO transport retries", () => {
  const answer = {
    explanations: [
      { findingId: "f-high", explanation: "Counted twice.", suggestedCheck: "Void the copy." },
    ],
  };
  const artifactUrl = (id: string) =>
    `https://agent.creao.ai/api/v1/apps/app_field/runs/${id}/artifacts/download?artifactId=a1`;
  const completedWithArtifact = (id: string) =>
    json({
      id,
      status: "completed",
      result: {
        chatText: "Ready.",
        artifacts: [
          { id: "a1", title: "result.json", type: "application/json", url: artifactUrl(id) },
        ],
      },
    });

  it("reposts once after a 429, waiting Retry-After, and reports a second 429", async () => {
    const ok = fakeRuntime((call, i) =>
      i === 0
        ? new Response('{"error":"busy"}', { status: 429, headers: { "retry-after": "3" } })
        : call.method === "POST"
          ? json({ id: "run_1", status: "queued" }, 201)
          : json({ id: "run_1", status: "completed", result: { chatText: delimited(answer) } }),
    );
    const out = await runFieldCreaoJob(env, explainCreaoJob(findings), ok.runtime);
    expect(out.runId).toBe("run_1");
    expect(ok.calls.filter((c) => c.method === "POST")).toHaveLength(2);
    expect(ok.sleeps[0]).toBe(3_000);

    const twice = fakeRuntime(
      () =>
        new Response('{"message":"Too many runs"}', {
          status: 429,
          headers: { "retry-after": "1" },
        }),
    );
    await expect(
      runFieldCreaoJob(env, explainCreaoJob(findings), twice.runtime),
    ).rejects.toMatchObject({ category: "http_status", httpStatus: 429, detail: "Too many runs" });
    expect(twice.calls).toHaveLength(2);
  });

  it("retries a late artifact with backoff and logs each retry", async () => {
    let downloads = 0;
    const { runtime, sleeps } = fakeRuntime((call, i) => {
      if (i === 0) return json({ id: "run_2", status: "queued" }, 201);
      if (call.url.includes("/artifacts/download")) {
        downloads++;
        return downloads < 3 ? new Response("no", { status: 403 }) : json(answer);
      }
      return completedWithArtifact("run_2");
    });
    const retries: number[] = [];
    const out = await runFieldCreaoJob(env, explainCreaoJob(findings), {
      ...runtime,
      onResultRetry: ({ attempt }) => {
        retries.push(attempt);
      },
    });
    expect(out.value).toEqual(answer.explanations);
    expect(retries).toEqual([1, 2]);
    expect(sleeps).toEqual(expect.arrayContaining([2_000, 4_000]));
  });

  it("gives up after three result retries, and never retries an invalid answer", async () => {
    const missing = fakeRuntime((call, i) =>
      i === 0
        ? json({ id: "run_3", status: "queued" }, 201)
        : call.url.includes("/artifacts/download")
          ? new Response("no", { status: 404 })
          : completedWithArtifact("run_3"),
    );
    await expect(
      runFieldCreaoJob(env, explainCreaoJob(findings), missing.runtime),
    ).rejects.toMatchObject({ category: "http_status", httpStatus: 404 });
    expect(missing.calls.filter((c) => c.url.includes("/artifacts/download"))).toHaveLength(4);

    const bad = { explanations: [{ findingId: "nope", explanation: "x", suggestedCheck: "y" }] };
    const invalid = fakeRuntime((_call, i) =>
      i === 0
        ? json({ id: "run_4", status: "queued" }, 201)
        : json({ id: "run_4", status: "completed", result: { chatText: delimited(bad) } }),
    );
    await expect(
      runFieldCreaoJob(env, explainCreaoJob(findings), invalid.runtime),
    ).rejects.toMatchObject({ category: "invalid_output" });
    expect(invalid.calls).toHaveLength(2);
  });
});

describe("observed CREAO output quirks", () => {
  it("accepts a start marker glued to prose, but still never accepts prose alone", async () => {
    const glued = `I'll start by reading the skill manifest.${RESULT_START}\n${JSON.stringify({
      explanations: [
        { findingId: "f-high", explanation: "Counted twice.", suggestedCheck: "Void the copy." },
      ],
    })}\n${RESULT_END}`;
    const reply = (chatText: string) =>
      fakeRuntime((_call, i) =>
        i === 0
          ? json({ id: "run_g", status: "queued" }, 201)
          : json({ id: "run_g", status: "completed", result: { chatText } }),
      ).runtime;
    const out = await runFieldCreaoJob(env, explainCreaoJob(findings), reply(glued));
    expect(out.value[0]?.findingId).toBe("f-high");
    await expect(
      runFieldCreaoJob(
        env,
        explainCreaoJob(findings),
        reply("f-high is counted twice; void the copy."),
      ),
    ).rejects.toMatchObject({ category: "no_result" });
  });

  it("treats thousands separators as the same engine amount, not a new one", () => {
    const withCommas = {
      ...goodPlan,
      actions: [
        { action: "escalate_flag", findingId: "f-mid", reason: "Bill is $42,000.00 vs $9,500.00." },
      ],
    };
    const flags = input.flags.map((f) =>
      f.findingId === "f-mid" ? { ...f, summary: "bill is $42000.00, usual $9500.00" } : f,
    );
    expect(acceptCoordinatorPlan({ ...input, flags }, withCommas)?.escalate[0]?.reason).toBe(
      "Bill is $42,000.00 vs $9,500.00.",
    );
    expect(acceptCoordinatorPlan(input, withCommas)?.escalate[0]?.reason).toBe(
      "Bill is [amount removed] vs [amount removed].",
    );
  });
});
