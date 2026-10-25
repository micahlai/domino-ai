import { describe, expect, it } from "vitest";
import {
  APIFY_ACTOR,
  ApifyError,
  actorInput,
  isGenericName,
  parseSearchItems,
  runSignalSearch,
  searchName,
  searchOrder,
  signalFacts,
  signalKey,
  signalLines,
} from "../lib/apify";
import itemsEmpty from "./fixtures/apify/items-empty.json";
import itemsMatch from "./fixtures/apify/items-match.json";
import runSucceeded from "./fixtures/apify/run-succeeded.json";

type Call = { url: string; method: string; body?: unknown; auth?: string };

/** Replays recorded Apify responses by route; records every request. */
function recorded(routes: { match: RegExp; status?: number; body: unknown }[]) {
  const calls: Call[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      method: init?.method ?? "GET",
      ...(init?.body && { body: JSON.parse(String(init.body)) }),
      auth: headers.get("Authorization") ?? undefined,
    });
    const route = routes.find((r) => r.match.test(`${init?.method ?? "GET"} ${url}`));
    if (!route) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200 });
  };
  return { fetch, calls };
}

const RUN = runSucceeded as { data: { id: string; defaultDatasetId: string } };
const runId = RUN.data.id;
const datasetId = RUN.data.defaultDatasetId;
const MATCH_NAME = "Northwind Health";

describe("apify signal search: parsing", () => {
  it("keeps only results that mention the searched name, with source, date and kinds", () => {
    const out = parseSearchItems(itemsMatch, MATCH_NAME);
    expect(out).toMatchObject({ itemCount: 1, resultCount: 10 });
    expect(out.signals.map((s) => s.date).filter(Boolean)[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(out.signals.length).toBeGreaterThan(0);
    expect(out.signals.length).toBeLessThanOrEqual(5);
    for (const s of out.signals) {
      expect(`${s.title} ${s.snippet}`.toLowerCase()).toContain("northwind health");
      expect(s.url).toMatch(/^https:\/\//);
      expect(s.source).not.toMatch(/^www\./);
      expect(s.source.length).toBeGreaterThan(0);
    }
  });

  it("reports no signals honestly when no result mentions the name", () => {
    // Recorded run for "Acme Logistics": ten bankruptcy headlines, none about Acme Logistics.
    const out = parseSearchItems(itemsEmpty, "Acme Logistics");
    expect(out.resultCount).toBe(10);
    expect(out.signals).toEqual([]);
    expect(signalLines("Acme Logistics", out.signals)).toEqual([
      "No public signals found for Acme Logistics",
    ]);
    expect(parseSearchItems([], "Acme Logistics")).toEqual({
      itemCount: 0,
      resultCount: 0,
      signals: [],
    });
    expect(
      signalFacts({ remoteRunId: "r1", fetchedAt: "2026-10-25T10:00:00Z", signals: [] }),
    ).toEqual(["Public web search (Apify run r1, 2026-10-25): no public signals found"]);
  });

  it("strips Google's date prefix from the snippet and tags risk kinds", () => {
    const out = parseSearchItems(
      [
        {
          organicResults: [
            {
              title: "Acme Freight files for Chapter 11 bankruptcy",
              url: "https://www.example-news.com/acme",
              description:
                "Oct 3, 2026 — Acme Freight said it laid off 200 staff and its CEO resigned.",
            },
            { title: "Unrelated freight news", url: "https://example.org/x", description: "None." },
            { title: "", url: "https://broken.example/", description: "Acme Freight" },
          ],
        },
        { searchQuery: { term: "x" } },
      ],
      "Acme Freight",
    );
    expect(out).toMatchObject({ itemCount: 2, resultCount: 2 });
    expect(out.signals).toEqual([
      {
        title: "Acme Freight files for Chapter 11 bankruptcy",
        url: "https://www.example-news.com/acme",
        source: "example-news.com",
        date: "Oct 3, 2026",
        snippet: "Acme Freight said it laid off 200 staff and its CEO resigned.",
        kinds: ["layoffs", "bankruptcy", "leadership"],
      },
    ]);
  });

  it("matches the whole name, not a fragment of another word", () => {
    const items = [
      {
        organicResults: [
          { title: "Rampart Systems raises funding", url: "https://a.example/1", description: "" },
          {
            title: "Ramp cuts 5% of staff in layoffs",
            url: "https://b.example/2",
            description: "",
          },
        ],
      },
    ];
    expect(parseSearchItems(items, "Ramp card statement").signals.map((s) => s.url)).toEqual([
      "https://b.example/2",
    ]);
  });

  it("rejects a dataset that is not a list", () => {
    expect(() => parseSearchItems({ error: "x" }, "A")).toThrow(ApifyError);
  });

  it("searches the business name without the books' descriptive suffix", () => {
    expect(searchName("Stratus Cloud hosting")).toBe("Stratus Cloud");
    expect(searchName("Avalara sales tax remittance")).toBe("Avalara");
    expect(searchName("Corelink hardware equipment (capex)")).toBe("Corelink");
    expect(searchName("Halcyon Freight")).toBe("Halcyon Freight");
    expect(searchName("Software")).toBe("Software");
    expect(signalKey("Ramp card statement")).toBe(signalKey("RAMP"));
    for (const generic of [
      "Operations vendors",
      "Cloud provider",
      "Office landlord",
      "SOFTWARE VENDORS",
    ])
      expect(isGenericName(generic)).toBe(true);
    for (const real of [
      "Northwind Health",
      "Hale & Ward legal services",
      "Ramp card statement",
      "Ardent",
    ])
      expect(isGenericName(real)).toBe(false);
    expect(actorInput("Halcyon Freight")).toMatchObject({
      queries:
        '"Halcyon Freight" (layoffs OR funding OR bankruptcy OR lawsuit OR acquisition OR CEO)',
      maxPagesPerQuery: 1,
      saveHtml: false,
    });
  });

  it("redacts money amounts in CREAO facts and keeps the same-name caveat", () => {
    const facts = signalFacts({
      remoteRunId: "r2",
      fetchedAt: "2026-10-25T10:00:00Z",
      signals: [
        {
          title: "Avalara raises $1.2B in funding",
          url: "https://x.example/a",
          source: "x.example",
          snippet: "",
          kinds: ["funding"],
        },
      ],
    });
    expect(facts[0]).toMatch(/same-name business may be a different company/);
    expect(facts[1]).toBe("Headline (funding): Avalara raises [amount] in funding (x.example)");
    expect(facts.join(" ")).not.toMatch(/\$/);
  });

  it("interleaves top customers and vendors and considers at most six", () => {
    const list = [1, 2, 3, 4].flatMap((rank) => [
      { name: `v${rank}`, role: "vendor" as const, rank },
      { name: `c${rank}`, role: "customer" as const, rank },
    ]);
    expect(searchOrder(list).map((c) => c.name)).toEqual(["c1", "v1", "c2", "v2", "c3", "v3"]);
  });
});

describe("apify signal search: API calls (recorded responses)", () => {
  it("starts one bounded run, reads its dataset and returns run id, counts and cost", async () => {
    const { fetch, calls } = recorded([
      {
        match: /^POST .*\/acts\/apify~google-search-scraper\/runs\?/,
        status: 201,
        body: { data: { ...RUN.data, usageTotalUsd: 0.0001 } },
      },
      { match: new RegExp(`^GET .*/datasets/${datasetId}/items\\?`), body: itemsMatch },
      { match: new RegExp(`^GET .*/actor-runs/${runId}$`), body: RUN },
    ]);
    const run = await runSignalSearch("apify-test-token", MATCH_NAME, { fetch });
    expect(run.remoteRunId).toBe(runId);
    expect(run.itemCount).toBe(1);
    expect(run.signals.length).toBeGreaterThan(0);
    // The settled cost from the follow-up read, not the partial one at finish.
    expect(run.usageUsd).toBeCloseTo(0.00455, 5);
    expect(calls).toHaveLength(3);
    const start = new URL(calls[0]?.url ?? "");
    expect(start.searchParams.get("waitForFinish")).toBe("60");
    expect(Number(start.searchParams.get("timeout"))).toBeLessThanOrEqual(60);
    expect(Number(start.searchParams.get("maxTotalChargeUsd"))).toBeLessThanOrEqual(0.5);
    expect(calls[0]?.body).toMatchObject({
      queries: expect.stringContaining('"Northwind Health"'),
    });
    expect(calls[1]?.url).toContain("limit=5");
    // Token in the header only, never in a URL.
    expect(calls.every((c) => c.auth === "Bearer apify-test-token")).toBe(true);
    expect(calls.some((c) => c.url.includes("apify-test-token"))).toBe(false);
    expect(APIFY_ACTOR.id).toBe("apify/google-search-scraper");
  });

  it("polls a run that is still going once, then aborts it as a timeout", async () => {
    const running = { data: { ...RUN.data, status: "RUNNING" } };
    const { fetch, calls } = recorded([
      { match: /^POST .*\/runs\?/, status: 201, body: running },
      { match: /^GET .*\/actor-runs\//, body: running },
      { match: /^POST .*\/abort$/, body: running },
    ]);
    const error = await runSignalSearch("t", "Acme", { fetch }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApifyError);
    expect(error).toMatchObject({ category: "timeout", remoteRunId: runId });
    expect(calls.map((c) => c.method)).toEqual(["POST", "GET", "POST"]);
  });

  it("maps HTTP failures to categories without echoing the token", async () => {
    for (const [status, category] of [
      [401, "auth"],
      [402, "payment"],
      [429, "rate_limited"],
      [500, "http"],
    ] as const) {
      const { fetch } = recorded([{ match: /^POST /, status, body: { error: { type: "x" } } }]);
      const error = await runSignalSearch("secret-token", "Acme", { fetch }).catch(
        (e: unknown) => e,
      );
      expect(error).toMatchObject({ category });
      expect(String((error as Error).message)).not.toContain("secret-token");
    }
    await expect(runSignalSearch(" ", "Acme")).rejects.toMatchObject({ category: "config" });
  });

  it("reports a failed actor run with its id", async () => {
    const { fetch } = recorded([
      { match: /^POST /, status: 201, body: { data: { ...RUN.data, status: "FAILED" } } },
    ]);
    await expect(runSignalSearch("t", "Acme", { fetch })).rejects.toMatchObject({
      category: "run_failed",
      remoteRunId: runId,
    });
  });
});
