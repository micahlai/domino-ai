/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { AI_CALLS_PER_HOUR } from "../fieldAi";
import schema from "../schema";

const modules = import.meta.glob(["../**/*.ts", "../_generated/*.js", "!./**"]);
const newBackend = () => convexTest(schema, modules);
type T = ReturnType<typeof newBackend>;

const ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "CREAO_HISTORICAL_EVIDENCE_ANALYST_APP_ID",
  "CREAO_HISTORICAL_EVIDENCE_ANALYST_API_KEY",
  "DOMINO_CREAO_VERIFIED_PROFILES",
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
        expect.stringMatching(/^Claude explanations unavailable/),
        expect.stringMatching(/^CREAO unavailable \(app not configured\)/),
        expect.stringMatching(/^Claude summary unavailable/),
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
});
