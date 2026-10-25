/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { counterpartyProfileVersion } from "../../../../packages/agents/src/fieldAi";
import { fieldCreaoProfileVersion } from "../../../../packages/agents/src/fieldCreao";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { AI_CALLS_PER_HOUR, hourlyCap } from "../fieldAi";
import schema from "../schema";

const modules = import.meta.glob(["../**/*.ts", "../_generated/*.js", "!./**"]);
const newBackend = () => convexTest(schema, modules);
type T = ReturnType<typeof newBackend>;

const ENV_KEYS = [
  "APIFY_TOKEN",
  "ANTHROPIC_API_KEY",
  "CREAO_HISTORICAL_EVIDENCE_ANALYST_APP_ID",
  "CREAO_HISTORICAL_EVIDENCE_ANALYST_API_KEY",
  "DOMINO_CREAO_VERIFIED_PROFILES",
  "FIELD_AI_HOURLY_CAP",
];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function drain(t: T, rounds = 1) {
  for (let i = 0; i < rounds; i++) {
    vi.runOnlyPendingTimers();
    await t.finishInProgressScheduledFunctions();
  }
}

async function logRows(t: T, companyId: Id<"companies">) {
  const page = await t.query(api.field.log, {
    companyId,
    paginationOpts: { numItems: 800, cursor: null },
  });
  return page.page;
}

/** Ingest once, plant a duplicate, ingest again: new findings plus a finished analyst run. */
async function companyWithFindings(t: T) {
  const { companyId } = await t.mutation(api.field.setup, { profile: "kestrel-crunch" });
  await drain(t, 20);
  await t.mutation(api.field.advanceFeed, { companyId, advance: false, anomaly: "duplicate" });
  await t.mutation(api.field.ingestNow, { companyId });
  await drain(t, 20);
  return companyId;
}

type Captured = { system: string; schema: Record<string, unknown> };

/** Offline stand-in for the Messages API: answers from the request's own schema enums. */
function stubClaude() {
  const calls: Captured[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (!href.startsWith("https://api.anthropic.com/")) throw new Error(`unexpected ${href}`);
    const body = JSON.parse(String(init?.body));
    const schemaJson = body.output_config.format.schema;
    calls.push({ system: body.system, schema: schemaJson });
    const explain = schemaJson.properties.explanations;
    const answer = explain
      ? {
          explanations: (explain.items.properties.findingId.enum as string[]).map((id) => ({
            findingId: id,
            explanation: "This entry looks recorded twice, which would overstate cash coming in.",
            suggestedCheck: "Open both entries in the billing tool and void the copy.",
          })),
        }
      : {
          recommendation:
            "Several scenarios break the lender's limit. The earliest failure deserves attention first. Review the best scored fix before deciding.",
          rationale: "The engine results show failures concentrated in one scenario.",
          citedScenarios: [schemaJson.properties.citedScenarios.items.enum[0]],
        };
    return new Response(
      JSON.stringify({
        id: `msg_${calls.length}`,
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: JSON.stringify(answer) }],
        stop_reason: "end_turn",
        stop_details: null,
        usage: { input_tokens: 500, output_tokens: 200 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, calls };
}

describe("field AI agents", () => {
  it("without keys sends nothing, stores no AI output and logs honest unavailable rows", async () => {
    vi.useFakeTimers();
    for (const k of ENV_KEYS) delete process.env[k];
    const fetch = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    const t = newBackend();
    const companyId = await companyWithFindings(t);

    expect(fetch).not.toHaveBeenCalled();
    const findings = await t.query(api.field.findings, { companyId });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.explanation === undefined)).toBe(true);
    const latest = await t.query(api.fieldAnalyst.latest, { companyId });
    expect(latest?.status).toBe("done");
    expect(latest?.aiSummary).toMatchObject({ status: "unavailable" });
    expect(latest?.research.every((r) => (r as { provider?: string }).provider !== "creao")).toBe(
      true,
    );

    const rows = await logRows(t, companyId);
    expect(rows.some((r) => r.agentKind === "claude" || r.agentKind === "creao")).toBe(false);
    expect(rows.map((r) => r.summary)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^Flag explanations unavailable \(CREAO app not configured; ANTHROPIC_API_KEY not set\)/,
        ),
        expect.stringMatching(/^CREAO unavailable \(app not configured\)/),
        expect.stringMatching(/^CREAO coordinator unavailable \(app not configured\)/),
        expect.stringMatching(/^AI summary unavailable/),
      ]),
    );
    expect(await t.run((ctx) => ctx.db.query("aiCalls").collect())).toEqual([]);
  }, 120_000);

  it("CREAO with an unverified profile sends nothing", async () => {
    vi.useFakeTimers();
    process.env.CREAO_HISTORICAL_EVIDENCE_ANALYST_APP_ID = "app_x";
    process.env.CREAO_HISTORICAL_EVIDENCE_ANALYST_API_KEY = "creao-test";
    process.env.DOMINO_CREAO_VERIFIED_PROFILES = "app_x/some_other_profile";
    Reflect.deleteProperty(process.env, "ANTHROPIC_API_KEY");
    const fetch = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    const t = newBackend();
    const { companyId } = await t.mutation(api.field.setup, { profile: "kestrel-crunch" });
    await drain(t, 20);
    expect(fetch).not.toHaveBeenCalled();
    const rows = await logRows(t, companyId);
    expect(rows.map((r) => r.summary)).toContainEqual(
      expect.stringMatching(
        /^CREAO unavailable \(profile field_counterparty@creao-\w+ not verified\)/,
      ),
    );
  }, 120_000);

  it("with Claude: explains flags, summarizes once per version and labels the real agents", async () => {
    vi.useFakeTimers();
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.ANTHROPIC_API_KEY = "test-key";
    const { fetch, calls } = stubClaude();
    const t = newBackend();
    const companyId = await companyWithFindings(t);

    const findings = await t.query(api.field.findings, { companyId });
    const explained = findings.filter((f) => f.explanation);
    expect(explained.length).toBeGreaterThan(0);
    expect(explained.length).toBeLessThanOrEqual(8);
    expect(explained[0]?.explanation?.model).toBe("claude-opus-5-5");
    expect(calls.some((c) => c.system.includes("audit engine flagged"))).toBe(true);

    const latest = await t.query(api.fieldAnalyst.latest, { companyId });
    expect(latest?.aiSummary).toMatchObject({
      status: "done",
      inputTokens: 500,
      outputTokens: 200,
    });
    expect(latest?.aiSummary?.recommendation).toMatch(/lender's limit/);

    const rows = await logRows(t, companyId);
    const claude = rows.filter((r) => r.agentKind === "claude");
    expect(new Set(claude.map((r) => r.agentId))).toEqual(
      new Set(["flag-explainer#1", "scenario-summarizer#1"]),
    );
    expect(claude.find((r) => r.tool === "claude.explainFlags")).toMatchObject({
      toolLabel: "Claude: explain flags",
      parentAgentId: "field.audit",
    });
    expect(claude.find((r) => r.tool === "claude.summarizeScenarios")?.summary).toMatch(
      /500 in \/ 200 out tokens/,
    );
    // Built-in deterministic agents keep their kind.
    expect(
      rows
        .filter((r) => ["analyst#1", "research#1"].includes(r.agentId ?? ""))
        .every((r) => r.agentKind === "domino"),
    ).toBe(true);
    // Forecasters -> analyst -> Claude summarizer -> analyst.
    const messages = rows.filter((r) => r.event === "message");
    expect(messages.some((r) => r.toAgentId === "scenario-summarizer#1")).toBe(true);
    expect(messages.some((r) => r.fromAgentId === "scenario-summarizer#1")).toBe(true);

    // A second run on the same snapshot version makes no new model call.
    const before = fetch.mock.calls.length;
    await t.mutation(api.fieldAnalyst.run, { companyId, paceMs: 0 });
    await drain(t, 20);
    expect(fetch.mock.calls.length).toBe(before);
    const again = await t.query(api.fieldAnalyst.latest, { companyId });
    expect(again?.runId).not.toBe(latest?.runId);
    expect(again?.aiSummary).toMatchObject({ status: "done", runId: latest?.aiSummary?.runId });
  }, 120_000);

  it("caps model calls: one per kind per version, and an hourly total", async () => {
    const t = newBackend();
    const companyId = await t.run((ctx) =>
      ctx.db.insert("companies", {
        name: "Budget test",
        profile: "kestrel",
        currentWeek: 1,
        today: "2026-11-02",
        status: "ready",
      }),
    );
    const reserve = (scope: string, kind: "audit" | "analyst" = "audit") =>
      t.mutation(internal.fieldAi.reserve, { companyId, kind, provider: "claude", scope });
    expect((await reserve("v1")).ok).toBe(true);
    expect(await reserve("v1")).toMatchObject({ ok: false, reason: expect.stringMatching(/once/) });
    expect((await reserve("v1", "analyst")).ok).toBe(true);
    for (let i = 2; i < AI_CALLS_PER_HOUR; i++) expect((await reserve(`v${i}`)).ok).toBe(true);
    expect(await reserve("v999")).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/hourly cap/),
    });
  }, 120_000);

  it("allows one CREAO and one Claude fallback per kind per version, within one hourly cap", async () => {
    const t = newBackend();
    const companyId = await t.run((ctx) =>
      ctx.db.insert("companies", {
        name: "Budget test",
        profile: "kestrel",
        currentWeek: 1,
        today: "2026-11-02",
        status: "ready",
      }),
    );
    /** Reserve, then settle a CREAO run so it no longer counts as in flight. */
    const reserve = async (
      scope: string,
      provider: "claude" | "creao",
      kind: "audit" | "coordinator" = "audit",
    ) => {
      const r = await t.mutation(internal.fieldAi.reserve, { companyId, kind, provider, scope });
      if (r.ok && provider === "creao")
        await t.mutation(internal.fieldAi.settle, { callId: r.callId, status: "ok" });
      return r;
    };
    expect((await reserve("v1", "creao")).ok).toBe(true);
    expect((await reserve("v1", "claude")).ok).toBe(true);
    expect((await reserve("v1", "creao")).ok).toBe(false);
    expect((await reserve("v1", "claude")).ok).toBe(false);
    expect((await reserve("v1", "creao", "coordinator")).ok).toBe(true);
    expect((await reserve("v1", "creao", "coordinator")).ok).toBe(false);
    // The hourly cap counts both providers together.
    for (let i = 3; i < AI_CALLS_PER_HOUR; i++)
      expect((await reserve(`v${i + 1}`, i % 2 ? "creao" : "claude")).ok).toBe(true);
    expect(await reserve("v999", "creao")).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/hourly cap/),
    });
  }, 120_000);

  it("holds one CREAO run at a time per company until the in-flight run settles", async () => {
    const t = newBackend();
    const company = () =>
      t.run((ctx) =>
        ctx.db.insert("companies", {
          name: "Serial test",
          profile: "kestrel",
          currentWeek: 1,
          today: "2026-11-02",
          status: "ready",
        }),
      );
    const a = await company();
    const b = await company();
    const reserve = (companyId: typeof a, kind: "audit" | "coordinator", provider = "creao") =>
      t.mutation(internal.fieldAi.reserve, {
        companyId,
        kind,
        provider: provider as "creao" | "claude",
        scope: "v1",
      });
    const first = await reserve(a, "audit");
    expect(first.ok).toBe(true);
    expect(await reserve(a, "coordinator")).toMatchObject({ ok: false, busy: true });
    // Claude and other companies are not blocked.
    expect((await reserve(a, "coordinator", "claude")).ok).toBe(true);
    expect((await reserve(b, "coordinator")).ok).toBe(true);
    if (first.ok)
      await t.mutation(internal.fieldAi.settle, { callId: first.callId, status: "failed" });
    expect((await reserve(a, "coordinator")).ok).toBe(true);
  }, 120_000);
});

const RESULT = (value: unknown) =>
  `Done.\n<<<DOMINO_RESULT>>>\n${JSON.stringify(value)}\n<<<END_DOMINO_RESULT>>>`;

type Job = {
  task: string;
  outputSchema: Record<string, unknown>;
  data: Record<string, unknown>;
  repair?: unknown;
};

/** Answers a CREAO job from its own schema enums and data, the way the app's SKILL is told to. */
function creaoAnswer(job: Job): unknown {
  const data = job.data as {
    findings?: { findingId: string }[];
    scenarios?: { index: number }[];
    flags?: { findingId: string; escalated: boolean }[];
    counterparties?: { name: string }[];
  };
  switch (job.task) {
    case "fieldExplainFlags":
      return {
        explanations: (data.findings ?? []).map((f) => ({
          findingId: f.findingId,
          explanation: "This entry looks recorded twice, which would overstate cash coming in.",
          suggestedCheck: "Open both entries in the billing tool and void the copy.",
        })),
      };
    case "fieldScenarioSummary":
      return {
        recommendation:
          "Several scenarios break the lender's limit. The coordinator's focus fails first. Review its best scored fix before deciding.",
        rationale: "The engine results show failures concentrated in one scenario.",
        citedScenarios: [data.scenarios?.[0]?.index ?? 0],
      };
    case "fieldCoordinatorPlan": {
      const flag = data.flags?.find((f) => !f.escalated) ?? data.flags?.[0];
      const last = data.scenarios?.[data.scenarios.length - 1];
      return {
        summary:
          "Escalate the unreviewed flag, look at the last scenario, research the top customer.",
        actions: [
          ...(flag
            ? [{ action: "escalate_flag", findingId: flag.findingId, reason: "Not reviewed yet." }]
            : []),
          ...(last
            ? [{ action: "focus_scenario", scenarioIndex: last.index, reason: "Largest risk." }]
            : []),
          {
            action: "research_counterparty",
            counterparty: data.counterparties?.[0]?.name,
            reason: "Largest open receivables.",
          },
        ],
      };
    }
    case "fieldCounterpartyRisk":
      return {
        notes: [
          { counterparty: data.counterparties?.[0]?.name, risk: "medium", note: "Watch renewal." },
        ],
      };
    default:
      throw new Error(`unexpected task ${job.task}`);
  }
}

/**
 * Offline CREAO (app-scoped runs) plus the offline Claude stub. Records the most CREAO runs in
 * flight at once. `failTasks` end in status "failed"; `answer` can replace any answer;
 * `artifactTasks` answer through a JSON artifact whose first `artifactMisses` downloads return
 * 403; `rateLimitOnce` tasks get one 429 (Retry-After: 1) on create.
 */
function stubProviders(
  opts: {
    failTasks?: string[];
    answer?: (job: Job) => unknown;
    artifactTasks?: string[];
    artifactMisses?: number;
    rateLimitOnce?: string[];
  } = {},
) {
  const claude = stubClaude();
  const jobs = new Map<string, Job>();
  const posts: string[] = [];
  const limited = new Set<string>();
  const open = new Set<string>();
  let maxInFlight = 0;
  let misses = opts.artifactMisses ?? 0;
  const claudeFetch = claude.fetch.getMockImplementation()!;
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (!href.startsWith("https://agent.creao.ai/")) return claudeFetch(url, init);
    if ((init?.method ?? "GET") === "POST") {
      const job = JSON.parse(JSON.parse(String(init?.body)).inputs.prompt) as Job;
      if (opts.rateLimitOnce?.includes(job.task) && !limited.has(job.task)) {
        limited.add(job.task);
        return new Response(JSON.stringify({ error: { message: "Too many concurrent runs" } }), {
          status: 429,
          headers: { "retry-after": "1" },
        });
      }
      const id = `run-${posts.length + 1}`;
      posts.push(job.task);
      jobs.set(id, job);
      open.add(id);
      maxInFlight = Math.max(maxInFlight, open.size);
      return new Response(JSON.stringify({ id, status: "queued" }), { status: 201 });
    }
    const id = decodeURIComponent(/\/runs\/([^/?]+)/.exec(href)?.[1] ?? "");
    const job = jobs.get(id)!;
    const answer = () => (opts.answer ?? creaoAnswer)(job);
    if (href.includes("/artifacts/download")) {
      if (misses > 0) {
        misses--;
        return new Response("not yet", { status: 403 });
      }
      return new Response(JSON.stringify(answer()));
    }
    open.delete(id);
    if (opts.failTasks?.includes(job.task))
      return new Response(JSON.stringify({ id, status: "failed" }));
    const result = opts.artifactTasks?.includes(job.task)
      ? {
          chatText: "The plan is ready for review.",
          artifacts: [
            {
              id: "a1",
              title: "result.json",
              type: "application/json",
              url: `https://agent.creao.ai/api/v1/apps/app_field/runs/${id}/artifacts/download?artifactId=a1`,
            },
          ],
        }
      : { chatText: RESULT(answer()) };
    return new Response(JSON.stringify({ id, status: "completed", result }));
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, posts, claudeCalls: claude.calls, maxInFlight: () => maxInFlight };
}

async function verifyAll(appId = "app_field") {
  process.env.CREAO_HISTORICAL_EVIDENCE_ANALYST_APP_ID = appId;
  process.env.CREAO_HISTORICAL_EVIDENCE_ANALYST_API_KEY = "creao-test";
  const versions = [
    await counterpartyProfileVersion(),
    await fieldCreaoProfileVersion("explain"),
    await fieldCreaoProfileVersion("summary"),
    await fieldCreaoProfileVersion("coordinator"),
  ];
  process.env.DOMINO_CREAO_VERIFIED_PROFILES = versions.map((v) => `${appId}/${v}`).join(",");
}

/**
 * drain() that advances fake time in small steps so CREAO poll sleeps inside actions resolve.
 * runOnlyPendingTimers would jump the clock past the run deadline.
 */
async function drainLive(t: T, rounds = 1) {
  for (let i = 0; i < rounds; i++) {
    await vi.advanceTimersByTimeAsync(1_000);
    let done = false;
    const p = t.finishInProgressScheduledFunctions().finally(() => {
      done = true;
    });
    for (let k = 0; k < 400 && !done; k++) await vi.advanceTimersByTimeAsync(500);
    await p;
  }
}

async function liveCompanyWithFindings(t: T) {
  const { companyId } = await t.mutation(api.field.setup, { profile: "kestrel-crunch" });
  await drainLive(t, 20);
  await t.mutation(api.field.advanceFeed, { companyId, advance: false, anomaly: "duplicate" });
  await t.mutation(api.field.ingestNow, { companyId });
  await drainLive(t, 20);
  return companyId;
}

describe("CREAO-first field agents", () => {
  it("runs explain, coordinator and summary on CREAO, executes the plan and never calls Claude", async () => {
    vi.useFakeTimers();
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.ANTHROPIC_API_KEY = "test-key";
    await verifyAll();
    const { posts, claudeCalls, maxInFlight } = stubProviders();
    const t = newBackend();
    const companyId = await liveCompanyWithFindings(t);

    expect(claudeCalls).toEqual([]);
    // One CREAO run at a time, in the queue order explain -> coordinator -> summary -> research.
    expect(maxInFlight()).toBe(1);
    const order = [
      "fieldExplainFlags",
      "fieldCoordinatorPlan",
      "fieldScenarioSummary",
      "fieldCounterpartyRisk",
    ];
    const last = order.map((task) => posts.lastIndexOf(task));
    expect(last.every((i) => i >= 0)).toBe(true);
    expect([...last].sort((x, y) => x - y)).toEqual(last);
    const findings = await t.query(api.field.findings, { companyId });
    const explained = findings.filter((f) => f.explanation);
    expect(explained.length).toBeGreaterThan(0);
    expect(explained[0]?.explanation).toMatchObject({
      model: "creao",
      provider: "creao",
      remoteRunId: expect.stringMatching(/^run-\d+$/),
    });

    const latest = await t.query(api.fieldAnalyst.latest, { companyId });
    expect(latest?.aiSummary).toMatchObject({
      status: "done",
      provider: "creao",
      remoteRunId: expect.stringMatching(/^run-\d+$/),
    });
    expect(latest?.coordinator).toMatchObject({
      status: "done",
      focus: { scenarioIndex: expect.any(Number) },
      research: { counterparty: expect.any(String) },
    });
    const escalated = latest?.coordinator?.escalate?.[0]?.findingId;
    expect(escalated).toBeTruthy();
    expect(findings.find((f) => f.findingId === escalated)?.escalated).toBe(true);

    const rows = await logRows(t, companyId);
    for (const agentId of ["flag-explainer#1", "scenario-summarizer#1", "coordinator#1"]) {
      const mine = rows.filter((r) => r.agentId === agentId);
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.every((r) => r.agentKind === "creao")).toBe(true);
      const statuses = mine.filter((r) => r.event === "status").map((r) => r.status);
      expect(statuses).toEqual(expect.arrayContaining(["spawned", "working", "done"]));
      expect(mine.map((r) => r.summary)).toContainEqual(
        expect.stringMatching(/^Waiting for CREAO run run-\d+/),
      );
    }
    expect(rows.some((r) => r.agentKind === "claude")).toBe(false);
    // research#1 itself runs on CREAO: no separate Domino hand-off helper.
    const research = rows.filter((r) => r.agentId === "research#1" && r.agentKind === "creao");
    expect(research.map((r) => r.status ?? r.tool)).toEqual(
      expect.arrayContaining(["spawned", "working", "creao.counterpartyRisk", "done"]),
    );
    expect(research.find((r) => r.tool === "creao.counterpartyRisk")).toMatchObject({
      parentAgentId: "analyst#1",
      source: "creao",
    });
    expect(rows.some((r) => r.agentId === "counterparty-research#1")).toBe(false);
    const fromCoordinator = rows
      .filter((r) => r.event === "message" && r.fromAgentId === "coordinator#1")
      .map((r) => r.toAgentId);
    expect(fromCoordinator).toEqual(
      expect.arrayContaining(["field.audit", "research#1", "scenario-summarizer#1"]),
    );
    expect(fromCoordinator.some((id) => id?.startsWith("forecaster#"))).toBe(true);

    const calls = await t.run((ctx) => ctx.db.query("aiCalls").collect());
    expect(calls.every((c) => c.provider === "creao" && c.status === "ok" && c.remoteRunId)).toBe(
      true,
    );
    expect(new Set(calls.map((c) => c.kind))).toEqual(
      new Set(["audit", "analyst", "research", "coordinator"]),
    );
  }, 180_000);

  it("falls back to Claude when the CREAO run fails, and logs both providers honestly", async () => {
    vi.useFakeTimers();
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.ANTHROPIC_API_KEY = "test-key";
    await verifyAll();
    const { claudeCalls } = stubProviders({
      failTasks: ["fieldExplainFlags", "fieldScenarioSummary"],
    });
    const t = newBackend();
    const companyId = await liveCompanyWithFindings(t);

    expect(claudeCalls.length).toBeGreaterThanOrEqual(2);
    const explained = (await t.query(api.field.findings, { companyId })).filter(
      (f) => f.explanation,
    );
    expect(explained[0]?.explanation).toMatchObject({
      model: "claude-opus-5-5",
      provider: "claude",
    });
    const latest = await t.query(api.fieldAnalyst.latest, { companyId });
    expect(latest?.aiSummary).toMatchObject({ status: "done", provider: "claude" });

    const rows = await logRows(t, companyId);
    const explainer = rows.filter((r) => r.agentId === "flag-explainer#1");
    expect(explainer.find((r) => r.status === "failed")).toMatchObject({
      agentKind: "creao",
      summary: expect.stringMatching(/^CREAO run failed \(run_failed\); falling back to Claude/),
    });
    expect(explainer.find((r) => r.tool === "claude.explainFlags")?.agentKind).toBe("claude");
    const calls = await t.run((ctx) => ctx.db.query("aiCalls").collect());
    const audit = calls.filter(
      (c) => c.kind === "audit" && c.scope === `v${explained[0]?.version}`,
    );
    expect(audit.map((c) => [c.provider, c.status]).sort()).toEqual([
      ["claude", "ok"],
      ["creao", "failed"],
    ]);
  }, 180_000);

  it("uses Claude without any CREAO request when the profiles are not verified", async () => {
    vi.useFakeTimers();
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.ANTHROPIC_API_KEY = "test-key";
    await verifyAll();
    process.env.DOMINO_CREAO_VERIFIED_PROFILES = "app_field/some_other_profile";
    const { posts, claudeCalls } = stubProviders();
    const t = newBackend();
    const companyId = await liveCompanyWithFindings(t);

    expect(posts).toEqual([]);
    expect(claudeCalls.length).toBeGreaterThanOrEqual(2);
    const latest = await t.query(api.fieldAnalyst.latest, { companyId });
    expect(latest?.aiSummary).toMatchObject({ status: "done", provider: "claude" });
    expect(latest?.coordinator).toMatchObject({
      status: "unavailable",
      reason: expect.stringMatching(/^profile field_coordinator@creao-\w+ not verified$/),
    });
    const rows = await logRows(t, companyId);
    expect(rows.some((r) => r.agentKind === "creao")).toBe(false);
  }, 180_000);

  it("rejects a coordinator plan with an unknown action: nothing is executed", async () => {
    vi.useFakeTimers();
    for (const k of ENV_KEYS) delete process.env[k];
    await verifyAll();
    const { claudeCalls } = stubProviders({
      answer: (job) =>
        job.task === "fieldCoordinatorPlan"
          ? {
              summary: "Pay the vendor now.",
              actions: [{ action: "pay_vendor", vendor: "Northwind", reason: "Owed $9,999." }],
            }
          : creaoAnswer(job),
    });
    const t = newBackend();
    const companyId = await liveCompanyWithFindings(t);

    expect(claudeCalls).toEqual([]);
    const latest = await t.query(api.fieldAnalyst.latest, { companyId });
    const why = /^actions\.0\.action: Invalid discriminator value/;
    expect(latest?.coordinator?.status).toBe("failed");
    expect(latest?.coordinator?.reason).toMatch(
      /^CREAO run failed \(invalid_output: actions\.0\.action: Invalid discriminator value.*; repair run failed: invalid_output: actions\.0\.action: Invalid discriminator/,
    );
    const rows = await logRows(t, companyId);
    expect(rows.some((r) => r.fromAgentId === "coordinator#1")).toBe(false);
    const coordinator = rows.filter((r) => r.agentId === "coordinator#1");
    expect(coordinator.find((r) => r.status === "failed")?.summary).toMatch(
      /^CREAO run failed \(invalid_output: actions\.0\.action: Invalid discriminator value.*\); no plan/,
    );
    expect(coordinator.map((r) => r.summary)).toContainEqual(
      expect.stringMatching(
        /^CREAO plan rejected \(invalid_output: actions\.0\.action: .*\); asking CREAO for a corrected plan \(one repair run\)$/,
      ),
    );
    // The first run and the one repair run both failed, each with its precise reason.
    const scope = `v${latest?.snapshotVersion}`;
    const calls = (await t.run((ctx) => ctx.db.query("aiCalls").collect())).filter(
      (c) => c.kind === "coordinator" && c.scope.split(":")[0] === scope,
    );
    expect(calls.map((c) => [c.scope.endsWith(":repair"), c.status])).toEqual([
      [false, "failed"],
      [true, "failed"],
    ]);
    for (const c of calls) expect(c.detail?.replace(/^invalid_output: /, "")).toMatch(why);
  }, 180_000);

  it("repairs a rejected coordinator plan with one more CREAO run and executes it", async () => {
    vi.useFakeTimers();
    for (const k of ENV_KEYS) delete process.env[k];
    await verifyAll();
    const prompts: Job[] = [];
    const { posts, claudeCalls } = stubProviders({
      answer: (job) => {
        if (job.task !== "fieldCoordinatorPlan") return creaoAnswer(job);
        prompts.push(job);
        const good = creaoAnswer(job) as { summary: string; actions: Record<string, unknown>[] };
        if (job.repair) return good;
        // 1-based scenario numbers instead of the index field, as a model might write them.
        return {
          ...good,
          actions: good.actions.map((a) =>
            a.action === "focus_scenario" ? { ...a, scenarioIndex: 99 } : a,
          ),
        };
      },
    });
    const t = newBackend();
    const companyId = await liveCompanyWithFindings(t);

    expect(claudeCalls).toEqual([]);
    expect(posts.filter((p) => p === "fieldCoordinatorPlan").length).toBeGreaterThanOrEqual(2);
    const repair = prompts.find((p) => p.repair)?.repair as {
      issues: string[];
      previousOutput: { actions: { scenarioIndex?: number }[] };
    };
    expect(repair.issues[0]).toMatch(/scenarioIndex: unknown index 99; use one of \d/);
    expect(repair.previousOutput.actions.some((a) => a.scenarioIndex === 99)).toBe(true);
    const latest = await t.query(api.fieldAnalyst.latest, { companyId });
    expect(latest?.coordinator).toMatchObject({
      status: "done",
      focus: { scenarioIndex: expect.any(Number) },
    });
    const rows = await logRows(t, companyId);
    const mine = rows.filter((r) => r.agentId === "coordinator#1").map((r) => r.summary);
    expect(mine).toContainEqual(
      expect.stringMatching(
        /^CREAO plan rejected \(invalid_output: actions\.\d\.scenarioIndex: unknown index 99; use one of [\d, ]+\); asking CREAO for a corrected plan/,
      ),
    );
    expect(mine).toContainEqual(expect.stringMatching(/^Waiting for CREAO repair run run-\d+/));
    expect(mine).toContainEqual(expect.stringMatching(/^CREAO run run-\d+ \(repaired\): /));
    expect(rows.some((r) => r.fromAgentId === "coordinator#1")).toBe(true);
    const calls = await t.run((ctx) => ctx.db.query("aiCalls").collect());
    const v = `v${latest?.snapshotVersion}`;
    const coordinatorCalls = calls
      .filter((c) => c.kind === "coordinator" && c.scope.split(":")[0] === v)
      .map((c) => [c.scope, c.status]);
    expect(coordinatorCalls).toEqual([
      [v, "failed"],
      [`${v}:repair`, "ok"],
    ]);
    expect(calls.find((c) => c.kind === "coordinator" && c.status === "failed")?.detail).toMatch(
      /^invalid_output: actions\.\d\.scenarioIndex: unknown index 99/,
    );
  }, 180_000);

  it("skips the repair when its budget is used, and says so", async () => {
    vi.useFakeTimers();
    for (const k of ENV_KEYS) delete process.env[k];
    await verifyAll();
    stubProviders({
      answer: (job) =>
        job.task === "fieldCoordinatorPlan" ? { summary: "x", actions: [] } : creaoAnswer(job),
    });
    const t = newBackend();
    const { companyId } = await t.mutation(api.field.setup, { profile: "kestrel-crunch" });
    await drainLive(t, 20);
    const version = (await t.query(api.fieldAnalyst.latest, { companyId }))?.snapshotVersion ?? 0;
    // The next version's repair call is already spent.
    await t.run((ctx) =>
      ctx.db.insert("aiCalls", {
        companyId,
        kind: "coordinator",
        provider: "creao",
        scope: `v${version + 1}:repair`,
        hour: Math.floor(Date.now() / 3_600_000),
        at: new Date().toISOString(),
        status: "ok",
      }),
    );
    await t.mutation(api.field.advanceFeed, { companyId, advance: false, anomaly: "duplicate" });
    await t.mutation(api.field.ingestNow, { companyId });
    await drainLive(t, 20);
    const latest = await t.query(api.fieldAnalyst.latest, { companyId });
    expect(latest?.snapshotVersion).toBe(version + 1);
    expect(latest?.coordinator?.reason).toBe(
      `CREAO run failed (invalid_output: actions: Array must contain at least 1 element(s); repair skipped: already ran once for v${version + 1}:repair (one per ingest))`,
    );
  }, 180_000);

  it("logs a repeated skip once per version, not on every analyst run", async () => {
    vi.useFakeTimers();
    for (const k of ENV_KEYS) delete process.env[k];
    await verifyAll();
    const { posts } = stubProviders();
    const t = newBackend();
    const companyId = await liveCompanyWithFindings(t);
    const before = posts.length;
    for (let i = 0; i < 4; i++) {
      await t.mutation(api.fieldAnalyst.run, { companyId, paceMs: 0 });
      await drainLive(t, 10);
    }
    expect(posts.length).toBe(before);
    const rows = await logRows(t, companyId);
    const count = (action: string) =>
      rows.filter((r) => r.action === action && /already ran once/.test(r.summary ?? "")).length;
    expect(count("analyst.coordinatorSkipped")).toBe(1);
    expect(count("research.creaoSkipped")).toBe(1);
    expect(count("analyst.aiSummarySkipped")).toBe(1);
    expect(rows.filter((r) => r.action === "analyst.done").length).toBeGreaterThanOrEqual(5);
  }, 240_000);

  it("reads the hourly cap from FIELD_AI_HOURLY_CAP", async () => {
    expect(hourlyCap({})).toBe(AI_CALLS_PER_HOUR);
    expect(hourlyCap({ FIELD_AI_HOURLY_CAP: "200" })).toBe(200);
    for (const bad of ["0", "-5", "abc", "2.5", "5000", ""])
      expect(hourlyCap({ FIELD_AI_HOURLY_CAP: bad })).toBe(AI_CALLS_PER_HOUR);
    process.env.FIELD_AI_HOURLY_CAP = "3";
    const t = newBackend();
    const companyId = await t.run((ctx) =>
      ctx.db.insert("companies", {
        name: "Cap test",
        profile: "kestrel",
        currentWeek: 1,
        today: "2026-11-02",
        status: "ready",
      }),
    );
    const reserve = (scope: string) =>
      t.mutation(internal.fieldAi.reserve, { companyId, kind: "audit", provider: "claude", scope });
    for (const scope of ["v1", "v2", "v3"]) expect((await reserve(scope)).ok).toBe(true);
    expect(await reserve("v4")).toMatchObject({
      ok: false,
      reason: "hourly cap of 3 model calls reached",
    });
  });
  it("waits for a late artifact and reposts once after a 429 with Retry-After", async () => {
    vi.useFakeTimers();
    for (const k of ENV_KEYS) delete process.env[k];
    await verifyAll();
    const { fetch, posts, claudeCalls } = stubProviders({
      artifactTasks: ["fieldCoordinatorPlan"],
      artifactMisses: 2,
      rateLimitOnce: ["fieldScenarioSummary"],
    });
    const t = newBackend();
    const companyId = await liveCompanyWithFindings(t);

    expect(claudeCalls).toEqual([]);
    // Every POST for the summary task: the runs created plus exactly one 429 that was reposted.
    const summaryPosts = fetch.mock.calls.filter(
      ([url, init]) =>
        String(url).startsWith("https://agent.creao.ai/") &&
        init?.method === "POST" &&
        String(init.body).includes("fieldScenarioSummary"),
    );
    expect(summaryPosts.length).toBe(posts.filter((p) => p === "fieldScenarioSummary").length + 1);
    const latest = await t.query(api.fieldAnalyst.latest, { companyId });
    expect(latest?.coordinator).toMatchObject({ status: "done" });
    expect(latest?.aiSummary).toMatchObject({ status: "done", provider: "creao" });
    const rows = await logRows(t, companyId);
    const waits = rows.filter(
      (r) => r.agentId === "coordinator#1" && /^Waiting for CREAO result/.test(r.summary ?? ""),
    );
    expect(waits.map((r) => r.summary).sort()).toEqual([
      "Waiting for CREAO result (retry 1)",
      "Waiting for CREAO result (retry 2)",
    ]);
  }, 180_000);

  it("logs the HTTP status, stage and sanitized reason when a create fails", async () => {
    vi.useFakeTimers();
    for (const k of ENV_KEYS) delete process.env[k];
    await verifyAll();
    stubProviders();
    const base = vi.mocked(globalThis.fetch).getMockImplementation()!;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
        (init?.method ?? "GET") === "POST" && String(url).startsWith("https://agent.creao.ai/")
          ? new Response(
              JSON.stringify({ message: "Run limit hit for key capi_abcdefghijklmnopqrstuvwxyz" }),
              { status: 503 },
            )
          : base(url, init),
      ),
    );
    const t = newBackend();
    const companyId = await liveCompanyWithFindings(t);
    const rows = await logRows(t, companyId);
    const failed = rows.find((r) => r.agentId === "coordinator#1" && r.status === "failed");
    expect(failed?.summary).toBe(
      "CREAO run failed (http_status 503 at create: Run limit hit for key [redacted]); no plan, agents keep their default order",
    );
  }, 180_000);
});
