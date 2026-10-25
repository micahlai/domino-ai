/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { counterpartyProfileVersion } from "../../../../packages/agents/src/fieldAi";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { APIFY_ACTOR, APIFY_LIMITS } from "../lib/apify";
import schema from "../schema";
import itemsEmpty from "./fixtures/apify/items-empty.json";
import runSucceeded from "./fixtures/apify/run-succeeded.json";

const modules = import.meta.glob(["../**/*.ts", "../_generated/*.js", "!./**"]);
const newBackend = () => convexTest(schema, modules);
type T = ReturnType<typeof newBackend>;

const ENV_KEYS = [
  "APIFY_TOKEN",
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

/** Advances fake time in small steps so sleeps inside actions (CREAO polls) resolve. */
async function drain(t: T, rounds = 1) {
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

async function logRows(t: T, companyId: Id<"companies">) {
  const page = await t.query(api.field.log, {
    companyId,
    paginationOpts: { numItems: 800, cursor: null },
  });
  return page.page;
}

const RUN = (runSucceeded as { data: Record<string, unknown> }).data;

/**
 * Offline Apify API in the recorded shapes (run object and Google Search Results Scraper items).
 * The first searched name gets one result that mentions it; every other name gets the recorded
 * "Acme Logistics" page, whose ten results mention none of them. Optionally a CREAO app that
 * answers the counterparty job and keeps the job it was sent.
 */
function stubApify(opts: { creao?: boolean } = {}) {
  const searched: string[] = [];
  const datasets = new Map<string, string>();
  const creaoJobs: { data: { counterparties: { name: string; facts: string[] }[] } }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    const method = init?.method ?? "GET";
    if (href.startsWith("https://api.apify.com/v2/")) {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer apify-test");
      const start = /\/acts\/apify~google-search-scraper\/runs\?/.test(href) && method === "POST";
      if (start) {
        const name = /^"([^"]+)"/.exec(JSON.parse(String(init?.body)).queries)?.[1] ?? "";
        searched.push(name);
        const n = searched.length;
        datasets.set(`ds-${n}`, name);
        return new Response(
          JSON.stringify({
            data: { ...RUN, id: `run-${n}`, defaultDatasetId: `ds-${n}`, usageTotalUsd: 0 },
          }),
          { status: 201 },
        );
      }
      const items = /\/datasets\/([^/]+)\/items/.exec(href);
      if (items) {
        const name = datasets.get(items[1] ?? "") ?? "";
        const body =
          name === searched[0]
            ? [
                {
                  organicResults: [
                    {
                      title: `${name} announces layoffs and a new CEO`,
                      url: "https://news.example.com/a",
                      description: "Oct 1, 2026 — Restructuring.",
                    },
                  ],
                },
              ]
            : itemsEmpty;
        return new Response(JSON.stringify(body));
      }
      const run = /\/actor-runs\/([^/?]+)$/.exec(href);
      if (run) return new Response(JSON.stringify({ data: { ...RUN, id: run[1] } }));
      return new Response("unexpected", { status: 404 });
    }
    if (opts.creao && href.startsWith("https://agent.creao.ai/")) {
      if (method === "POST") {
        const job = JSON.parse(JSON.parse(String(init?.body)).inputs.prompt);
        creaoJobs.push(job);
        return new Response(JSON.stringify({ id: "creao-1", status: "queued" }), { status: 201 });
      }
      const job = creaoJobs.at(-1);
      const value = {
        notes: [
          { counterparty: job?.data.counterparties[0]?.name, risk: "medium", note: "Watch." },
        ],
      };
      return new Response(
        JSON.stringify({
          id: "creao-1",
          status: "completed",
          result: {
            chatText: `Done.\n<<<DOMINO_RESULT>>>\n${JSON.stringify(value)}\n<<<END_DOMINO_RESULT>>>`,
          },
        }),
      );
    }
    throw new Error(`unexpected fetch ${href}`);
  });
  vi.stubGlobal("fetch", fetch);
  return { searched, creaoJobs };
}

async function setup(t: T) {
  const { companyId } = await t.mutation(api.field.setup, { profile: "kestrel-crunch" });
  await drain(t, 20);
  return companyId;
}

const apifyResearch = (r: unknown[] | undefined) =>
  (r ?? []).filter((e) => (e as { provider?: string }).provider === "apify") as {
    input: string;
    remoteRunId: string;
    cached: boolean;
    items: string[];
    signals: { title: string; url: string; source: string; kinds: string[] }[];
  }[];

describe("Apify public signals", () => {
  it("without APIFY_TOKEN makes no request, stores nothing and says Apify is not configured", async () => {
    vi.useFakeTimers();
    for (const k of ENV_KEYS) delete process.env[k];
    const fetch = vi.fn(async () => new Response("no", { status: 500 }));
    vi.stubGlobal("fetch", fetch);
    const t = newBackend();
    const companyId = await setup(t);
    const latest = await t.query(api.fieldAnalyst.latest, { companyId });
    expect(latest?.status).toBe("done");
    expect(apifyResearch(latest?.research)).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    const rows = await logRows(t, companyId);
    expect(rows.some((r) => r.toolCategory === "apify")).toBe(false);
    expect(rows.map((r) => r.summary)).toContainEqual(
      expect.stringMatching(/^Apify not configured \(APIFY_TOKEN missing\)/),
    );
    expect(rows.some((r) => /demo actor|canned/.test(r.summary ?? ""))).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("apifyRuns").collect())).toEqual([]);
  }, 120_000);

  it("runs real searches within the cap, logs run ids, then answers from the 24 h cache", async () => {
    vi.useFakeTimers();
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.APIFY_TOKEN = "apify-test";
    const { searched } = stubApify();
    const t = newBackend();
    const companyId = await setup(t);

    const first = await t.query(api.fieldAnalyst.latest, { companyId });
    expect(first?.status).toBe("done");
    expect(searched.length).toBeGreaterThan(0);
    expect(searched.length).toBeLessThanOrEqual(APIFY_LIMITS.runsPerAnalystRun);
    // Category names from the books ("Operations vendors") are never searched.
    expect(searched.some((n) => /vendors|provider|landlord/.test(n))).toBe(false);
    const research = apifyResearch(first?.research);
    expect(research.map((r) => r.remoteRunId)).toEqual(searched.map((_, i) => `run-${i + 1}`));
    expect(research.every((r) => !r.cached)).toBe(true);
    // One mention -> one signal with provenance; the rest honestly empty.
    expect(research[0]?.signals).toEqual([
      expect.objectContaining({
        url: "https://news.example.com/a",
        source: "news.example.com",
        kinds: ["layoffs", "leadership"],
      }),
    ]);
    for (const r of research.slice(1))
      expect(r.items).toEqual([`No public signals found for ${r.input}`]);

    const rows = await logRows(t, companyId);
    const tools = rows.filter((r) => r.toolCategory === "apify");
    expect(tools).toHaveLength(searched.length);
    for (const r of tools) {
      expect(r).toMatchObject({
        tool: APIFY_ACTOR.id,
        toolLabel: APIFY_ACTOR.name,
        source: "apify",
      });
      expect(r.refs[0]).toMatch(/^run-\d+$/);
      expect(r.summary).toMatch(/cost \$0\.0045/);
    }
    const stored = await t.run((ctx) => ctx.db.query("apifyRuns").collect());
    expect(stored.every((r) => r.status === "ok" && r.usageUsd === RUN.usageTotalUsd)).toBe(true);

    // Second ingest within 24 h: names searched before come from the cache (same run ids); only
    // names the cap left out get a live run, and no name is searched twice.
    const n1 = searched.length;
    const rerun = async () => {
      await t.mutation(api.fieldAnalyst.run, { companyId, paceMs: 0 });
      await drain(t, 20);
      return t.query(api.fieldAnalyst.latest, { companyId });
    };
    const second = await rerun();
    expect(second?.runId).not.toBe(first?.runId);
    const again = apifyResearch(second?.research);
    for (const r of research)
      expect(again.find((e) => e.input === r.input)).toMatchObject({
        cached: true,
        remoteRunId: r.remoteRunId,
      });
    expect(searched.length - n1).toBeLessThanOrEqual(APIFY_LIMITS.runsPerAnalystRun);
    expect(new Set(searched).size).toBe(searched.length);
    expect(again.filter((e) => !e.cached)).toHaveLength(searched.length - n1);

    // Third ingest: every searchable name is cached now, so no actor run at all.
    const n2 = searched.length;
    const third = await rerun();
    expect(searched.length).toBe(n2);
    expect(apifyResearch(third?.research).every((r) => r.cached)).toBe(true);

    // After 24 h the cache expires and names are searched again.
    vi.setSystemTime(Date.now() + APIFY_LIMITS.cacheMs + 60_000);
    await rerun();
    expect(searched.length).toBeGreaterThan(n2);
  }, 240_000);

  it("enforces the per-ingest and the daily run caps atomically", async () => {
    vi.useFakeTimers();
    const t = newBackend();
    const reserve = (n: number, analystRunId?: string) =>
      t.mutation(internal.fieldApify.reserve, {
        key: `name ${n}`,
        counterparty: `Name ${n}`,
        query: `"Name ${n}"`,
        ...(analystRunId && { analystRunId }),
      });
    for (let i = 0; i < APIFY_LIMITS.runsPerAnalystRun; i++)
      expect((await reserve(i, "analyst-a")).ok).toBe(true);
    expect(await reserve(9, "analyst-a")).toEqual({
      ok: false,
      reason: `cap of ${APIFY_LIMITS.runsPerAnalystRun} Apify runs per ingest reached`,
    });
    let n = APIFY_LIMITS.runsPerAnalystRun;
    while (n < APIFY_LIMITS.runsPerDay) expect((await reserve(n++)).ok).toBe(true);
    expect(await reserve(99, "analyst-b")).toEqual({
      ok: false,
      reason: `daily cap of ${APIFY_LIMITS.runsPerDay} Apify runs reached`,
    });
    // A new UTC day opens the cap again.
    vi.setSystemTime(Date.now() + 24 * 60 * 60_000);
    expect((await reserve(100, "analyst-b")).ok).toBe(true);
  });

  it("at the daily cap, logs the skip and starts no actor run", async () => {
    vi.useFakeTimers();
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.APIFY_TOKEN = "apify-test";
    const { searched } = stubApify();
    const t = newBackend();
    const day = new Date().toISOString().slice(0, 10);
    await t.run(async (ctx) => {
      for (let i = 0; i < APIFY_LIMITS.runsPerDay; i++)
        await ctx.db.insert("apifyRuns", {
          key: `old ${i}`,
          counterparty: `Old ${i}`,
          query: "q",
          actorId: APIFY_ACTOR.id,
          day,
          at: new Date().toISOString(),
          status: "failed",
        });
    });
    const companyId = await setup(t);
    expect(searched).toEqual([]);
    const rows = await logRows(t, companyId);
    expect(rows.map((r) => r.summary)).toContainEqual(
      expect.stringMatching(/skipped for .+: daily cap of 20 Apify runs reached; no signals$/),
    );
    expect(rows.some((r) => r.toolCategory === "apify")).toBe(false);
  }, 120_000);

  it("passes the signals to the CREAO counterparty job as facts", async () => {
    vi.useFakeTimers();
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.APIFY_TOKEN = "apify-test";
    process.env.CREAO_HISTORICAL_EVIDENCE_ANALYST_APP_ID = "app_field";
    process.env.CREAO_HISTORICAL_EVIDENCE_ANALYST_API_KEY = "creao-test";
    // Only the counterparty profile is verified, so it is the one CREAO run.
    process.env.DOMINO_CREAO_VERIFIED_PROFILES = `app_field/${await counterpartyProfileVersion()}`;
    const { searched, creaoJobs } = stubApify({ creao: true });
    const t = newBackend();
    await setup(t);
    expect(creaoJobs).toHaveLength(1);
    const facts = new Map(creaoJobs[0]?.data.counterparties.map((c) => [c.name, c.facts]));
    const top = searched[0] ?? "";
    expect(facts.get(top)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^Public web search \(Apify run run-1, \d{4}-\d{2}-\d{2}\): 1 results/,
        ),
        `Headline (layoffs, leadership): ${top} announces layoffs and a new CEO (news.example.com, Oct 1, 2026)`,
      ]),
    );
    // The others searched (the stub names them by search name) carry an honest empty result.
    const withSearch = [...facts].filter(([, f]) => f.some((x) => x.startsWith("Public web")));
    expect(withSearch).toHaveLength(searched.length);
    for (const [name, f] of withSearch)
      if (name !== top) expect(f).toContainEqual(expect.stringMatching(/no public signals found$/));
    expect(JSON.stringify(creaoJobs[0])).not.toContain("apify-test");
  }, 180_000);
});
