/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { AUDIT_CHECKERS } from "@domino/engine";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { websiteCacheKey } from "../fieldTools";
import { APIFY_LIMITS, apifyDailyCap } from "../lib/apify";
import { parseStore, searchStore } from "../lib/apifyStore";
import schema from "../schema";

const modules = import.meta.glob(["../**/*.ts", "../_generated/*.js", "!./**"]);
const newBackend = () => convexTest(schema, modules);
type T = ReturnType<typeof newBackend>;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function company(t: T, name: string) {
  return t.run(async (ctx) => {
    const companyId = await ctx.db.insert("companies", {
      name,
      profile: "kestrel",
      currentWeek: 0,
      today: "2026-10-25",
      status: "ready",
    });
    const snapshotId = await ctx.db.insert("snapshots", {
      companyId,
      asOf: "2026-10-25",
      data: {},
    });
    await ctx.db.insert("feeds", {
      companyId,
      auto: false,
      autoGeneration: 0,
      autoTicksLeft: 0,
      week: 0,
      snapshotVersion: 1,
      lastSnapshotId: snapshotId,
      lastSnapshotHash: null,
      lastSnapshotAt: null,
      lastIngestAt: null,
      lastIngestStatus: null,
      lastError: null,
      recordCounts: null,
    });
    await ctx.db.insert("analystRuns", {
      companyId,
      runId: `run-${companyId}`,
      trigger: "test",
      snapshotId,
      snapshotVersion: 1,
      asOf: "2026-10-25",
      status: "running",
      paceMs: 0,
      children: 0,
      reported: 0,
      startedAt: "2026-10-25T00:00:00.000Z",
    });
    return companyId;
  });
}

const item = {
  kind: "delay_bill" as const,
  fix: {
    id: "fix-bill",
    label: "Delay a bill",
    costNote: "Ask the vendor",
    risk: "medium" as const,
    changes: [],
  },
  effect: {
    lowPoint: 1_200_000,
    lowWeekStart: "2026-11-02",
    survives: true,
    gain: 300_000,
  },
};

async function saveSuggestion(
  t: T,
  companyId: Id<"companies">,
  scenarioId: string,
  runId = `run-${companyId}`,
  snapshotVersion = 1,
) {
  return t.mutation(internal.fieldAdvisor.store, {
    companyId,
    runId,
    snapshotVersion,
    scenarioId,
    scenarioTitle: `Stress ${scenarioId}`,
    scenarioLow: 900_000,
    lenderMinimum: 1_000_000,
    items: [item],
  });
}

async function startRun(t: T, companyId: Id<"companies">, runId: string, snapshotVersion: number) {
  await t.run(async (ctx) => {
    const feed = await ctx.db
      .query("feeds")
      .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
      .unique();
    if (!feed?.lastSnapshotId) throw new Error("Missing test snapshot");
    await ctx.db.insert("analystRuns", {
      companyId,
      runId,
      trigger: "test",
      snapshotId: feed.lastSnapshotId,
      snapshotVersion,
      asOf: "2026-10-25",
      status: "running",
      paceMs: 0,
      children: 0,
      reported: 0,
      startedAt: new Date().toISOString(),
    });
  });
}

describe("suggestion records", () => {
  it("lists engine effects, isolates companies, and records a decision without changing cash", async () => {
    const t = newBackend();
    const first = await company(t, "First");
    const second = await company(t, "Second");
    expect(await saveSuggestion(t, first, "stress-a")).toEqual(["stress-a:delay_bill"]);
    await saveSuggestion(t, second, "stress-b");

    const before = await t.query(api.fieldSuggestions.list, { companyId: first });
    expect(before).toMatchObject([
      {
        id: "stress-a:delay_bill",
        scenarioId: "stress-a",
        status: "open",
        fix: { id: "fix-bill", kind: "delay_bill", label: "Delay a bill" },
        effect: {
          lowPoint: 1_200_000,
          lowWeekStart: "2026-11-02",
          survives: true,
          gain: 300_000,
          scenarioLow: 900_000,
          lenderMinimum: 1_000_000,
        },
        recommended: false,
        recommendation: null,
      },
    ]);
    await expect(
      t.mutation(api.fieldSuggestions.decide, {
        companyId: second,
        id: before[0]!.id,
        expectedRunId: before[0]!.runId,
        expectedSnapshotVersion: before[0]!.snapshotVersion,
        decision: "accepted",
      }),
    ).rejects.toThrow();

    const feedBefore = await t.run((ctx) => ctx.db.query("feeds").collect());
    expect(
      await t.mutation(api.fieldSuggestions.decide, {
        companyId: first,
        id: before[0]!.id,
        expectedRunId: before[0]!.runId,
        expectedSnapshotVersion: before[0]!.snapshotVersion,
        decision: "accepted",
        note: "  Review with finance  ",
      }),
    ).toEqual({ id: before[0]!.id, status: "accepted" });
    await expect(
      t.mutation(api.fieldSuggestions.decide, {
        companyId: first,
        id: before[0]!.id,
        expectedRunId: before[0]!.runId,
        expectedSnapshotVersion: before[0]!.snapshotVersion,
        decision: "declined",
      }),
    ).rejects.toThrow();

    expect(await t.query(api.fieldSuggestions.list, { companyId: first, status: "open" })).toEqual(
      [],
    );
    expect(
      await t.query(api.fieldSuggestions.list, { companyId: first, status: "accepted" }),
    ).toMatchObject([{ id: before[0]!.id, status: "accepted", note: "Review with finance" }]);
    expect(await t.query(api.fieldSuggestions.list, { companyId: second })).toMatchObject([
      { id: "stress-b:delay_bill", status: "open" },
    ]);
    expect(await t.run((ctx) => ctx.db.query("feeds").collect())).toEqual(feedBefore);
    expect(await t.run((ctx) => ctx.db.query("approvals").take(1))).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("snapshots").collect())).toHaveLength(2);
    const logs = await t.run((ctx) => ctx.db.query("log").collect());
    // The decision, then the Learning agent's rows for the fix preference it learned.
    expect(logs).toMatchObject([
      { companyId: first, action: "suggestion.accepted", actor: "person" },
      { companyId: first, action: "agent.working", agentId: "learning#1" },
      { companyId: first, action: "learning.tool", agentId: "learning#1" },
      { companyId: first, action: "agent.done", agentId: "learning#1" },
    ]);
    expect(await t.query(api.fieldLearning.list, { companyId: first })).toMatchObject({
      rules: [{ active: true, source: "You approved a suggestion" }],
    });
    expect((await t.query(api.fieldLearning.list, { companyId: second })).rules).toEqual([]);
  });

  it("returns the newest 50 suggestions even when their ids sort last", async () => {
    const t = newBackend();
    const companyId = await company(t, "Many suggestions");
    vi.useFakeTimers();
    for (let i = 0; i < 51; i++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 9, 25, 0, i)));
      await saveSuggestion(t, companyId, `stress-${String(50 - i).padStart(2, "0")}`);
    }
    const listed = await t.query(api.fieldSuggestions.list, { companyId });
    expect(listed).toHaveLength(50);
    expect(listed[0]?.id).toBe("stress-00:delay_bill");
    expect(listed.some((s) => s.id === "stress-50:delay_bill")).toBe(false);
  });

  it("rejects older advisor writes and decisions after a newer run or snapshot", async () => {
    const t = newBackend();
    const companyId = await company(t, "Changing scenario");
    const oldRun = `run-${companyId}`;
    const id = "stress:delay_bill";
    await saveSuggestion(t, companyId, "stress");
    await startRun(t, companyId, "newer-run", 1);
    expect(await saveSuggestion(t, companyId, "stress", "newer-run")).toEqual([id]);
    expect(await saveSuggestion(t, companyId, "stress", oldRun)).toEqual([]);
    expect(
      await t.mutation(internal.fieldAdvisor.recommend, {
        companyId,
        suggestionId: id,
        runId: oldRun,
        snapshotVersion: 1,
        text: "Old advice",
        remoteRunId: "creao-old",
      }),
    ).toBe(false);
    await expect(
      t.mutation(api.fieldSuggestions.decide, {
        companyId,
        id,
        expectedRunId: oldRun,
        expectedSnapshotVersion: 1,
        decision: "accepted",
      }),
    ).rejects.toThrow();

    await t.run(async (ctx) => {
      const feed = await ctx.db
        .query("feeds")
        .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
        .unique();
      if (!feed) throw new Error("Missing feed");
      const snapshotId = await ctx.db.insert("snapshots", {
        companyId,
        asOf: "2026-11-01",
        data: {},
      });
      await ctx.db.patch("feeds", feed._id, { snapshotVersion: 2, lastSnapshotId: snapshotId });
    });
    await startRun(t, companyId, "version-two-run", 2);
    expect(await saveSuggestion(t, companyId, "stress", "version-two-run", 2)).toEqual([id]);
    expect(await saveSuggestion(t, companyId, "stress", "newer-run", 1)).toEqual([]);
    expect(
      await t.mutation(internal.fieldAdvisor.recommend, {
        companyId,
        suggestionId: id,
        runId: "newer-run",
        snapshotVersion: 1,
        text: "Stale rationale",
        remoteRunId: "creao-stale",
      }),
    ).toBe(false);
    await expect(
      t.mutation(api.fieldSuggestions.decide, {
        companyId,
        id,
        expectedRunId: "newer-run",
        expectedSnapshotVersion: 1,
        decision: "accepted",
      }),
    ).rejects.toThrow();
    expect(await t.query(api.fieldSuggestions.list, { companyId })).toMatchObject([
      { id, runId: "version-two-run", snapshotVersion: 2, status: "open", recommendation: null },
    ]);
  });
});

describe("audit swarm", () => {
  it("records one independent checker lifecycle and report per audit check", async () => {
    vi.useFakeTimers();
    const t = newBackend();
    const { companyId } = await t.mutation(api.field.setup, { profile: "kestrel" });
    vi.runOnlyPendingTimers();
    await t.finishInProgressScheduledFunctions();
    const page = await t.query(api.field.log, {
      companyId,
      paginationOpts: { numItems: 250, cursor: null },
    });
    const audit = page.page.filter((r) => r.runId?.endsWith(".audit"));
    for (const checker of AUDIT_CHECKERS) {
      const agentId = `audit.${checker}`;
      const rows = audit.filter((r) => r.agentId === agentId);
      expect(rows.map((r) => r.status)).toEqual(
        expect.arrayContaining(["spawned", "working", "done"]),
      );
      expect(rows.every((r) => r.parentAgentId === "field.audit")).toBe(true);
      expect(rows.some((r) => r.event === "tool" && r.tool === `engine.audit.${checker}`)).toBe(
        true,
      );
      expect(rows.some((r) => r.event === "message" && r.toAgentId === "field.audit")).toBe(true);
    }
    expect(page.page.some((r) => r.action === "audit.completed")).toBe(true);
  }, 60_000);

  it("keeps a failed audit pending, retries it before a newer snapshot, then resumes ingest", async () => {
    vi.useFakeTimers();
    const t = newBackend();
    const { companyId } = await t.mutation(api.field.setup, { profile: "kestrel" });
    vi.runOnlyPendingTimers();
    await t.finishInProgressScheduledFunctions();
    const before = await t.run(async (ctx) => {
      const feed = await ctx.db
        .query("feeds")
        .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
        .unique();
      if (!feed?.lastSnapshotId) throw new Error("Missing first snapshot");
      const snapshot = await ctx.db.get("snapshots", feed.lastSnapshotId);
      if (!snapshot) throw new Error("Missing first snapshot");
      await ctx.db.patch("feeds", feed._id, {
        auditPending: {
          snapshotId: snapshot._id,
          version: feed.snapshotVersion,
          tieOut: [],
          phase: "audit",
          newFindings: 0,
        },
        lastIngestStatus: "failed",
      });
      await ctx.db.patch("snapshots", snapshot._id, { data: {} });
      return { snapshotId: snapshot._id, data: snapshot.data };
    });
    await t.mutation(api.field.advanceFeed, { companyId });
    await t.mutation(api.field.ingestNow, { companyId });
    vi.runOnlyPendingTimers();
    await t.finishInProgressScheduledFunctions();
    const failed = await t.run((ctx) =>
      ctx.db
        .query("feeds")
        .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
        .unique(),
    );
    expect(failed).toMatchObject({
      snapshotVersion: 1,
      lastIngestStatus: "failed",
      auditPending: { phase: "audit" },
    });

    await t.run((ctx) => ctx.db.patch("snapshots", before.snapshotId, { data: before.data }));
    await t.mutation(api.field.ingestNow, { companyId });
    vi.runOnlyPendingTimers();
    await t.finishInProgressScheduledFunctions();
    const resumed = await t.run((ctx) =>
      ctx.db
        .query("feeds")
        .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
        .unique(),
    );
    expect(resumed).toMatchObject({ snapshotVersion: 1, lastIngestStatus: "ok" });
    expect(resumed?.auditPending).toBeUndefined();
    await t.mutation(api.field.ingestNow, { companyId });
    vi.runOnlyPendingTimers();
    await t.finishInProgressScheduledFunctions();
    const next = await t.run((ctx) =>
      ctx.db
        .query("feeds")
        .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
        .unique(),
    );
    expect(next).toMatchObject({ snapshotVersion: 2, lastIngestStatus: "ok" });
  }, 60_000);
});

describe("Apify toolbox boundaries", () => {
  it("skips malformed Store entries and sends only a listing request", async () => {
    const body = {
      data: {
        total: 4,
        items: [
          null,
          7,
          { username: "apify", name: "crawler", stats: null, currentPricingInfo: null },
          { username: "", name: "bad" },
        ],
      },
    };
    expect(parseStore(body)).toMatchObject({
      total: 4,
      actors: [{ actorId: "apify/crawler", users: 0 }],
    });
    const fetch = vi.fn(
      async (_input: string, _init?: RequestInit) => new Response(JSON.stringify(body)),
    );
    expect((await searchStore("website content crawler", { fetch })).actors).toHaveLength(1);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toContain("/v2/store?");
    expect(fetch.mock.calls[0]?.[1]).not.toHaveProperty("method", "POST");
  });

  it("uses one lowered daily cap across different toolbox actors", async () => {
    expect(apifyDailyCap({ FIELD_APIFY_RUNS_PER_DAY: "0" })).toBe(0);
    expect(apifyDailyCap({ FIELD_APIFY_RUNS_PER_DAY: "999" })).toBe(APIFY_LIMITS.runsPerDay);
    vi.stubEnv("FIELD_APIFY_RUNS_PER_DAY", "1");
    const t = newBackend();
    const one = await t.mutation(internal.fieldApify.reserve, {
      key: "site:one",
      counterparty: "One",
      query: "https://one.example/",
      actorId: "apify/website-content-crawler",
    });
    expect(one.ok).toBe(true);
    const two = await t.mutation(internal.fieldApify.reserve, {
      key: "news:two",
      counterparty: "Two",
      query: "Two news",
      actorId: "apify/google-search-scraper",
    });
    expect(two).toMatchObject({ ok: false, reason: expect.stringContaining("daily cap of 1") });
    expect(await t.run((ctx) => ctx.db.query("apifyRuns").collect())).toHaveLength(1);
  });

  it("does not reuse a website crawl across URL, actor, or company", async () => {
    const t = newBackend();
    const first = await company(t, "First website");
    const second = await company(t, "Second website");
    const key = websiteCacheKey(first, "apify/website-content-crawler", "https://acme.example/");
    expect(key).not.toBe(
      websiteCacheKey(first, "apify/website-content-crawler", "https://acme.io/"),
    );
    expect(key).not.toBe(websiteCacheKey(first, "another/crawler", "https://acme.example/"));
    expect(key).not.toBe(
      websiteCacheKey(second, "apify/website-content-crawler", "https://acme.example/"),
    );
  });
});
