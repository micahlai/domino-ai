/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob(["../**/*.ts", "../_generated/*.js", "!./**"]);
const newBackend = () => convexTest(schema, modules);
type T = ReturnType<typeof newBackend>;

afterEach(() => vi.useRealTimers());

async function drain(t: T, rounds = 1) {
  for (let i = 0; i < rounds; i++) {
    vi.runOnlyPendingTimers();
    await t.finishInProgressScheduledFunctions();
  }
}

const scheduled = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).map((f) => f.name),
  );

async function code(p: Promise<unknown>) {
  try {
    await p;
  } catch (error) {
    if (error instanceof ConvexError) return (error.data as { code: string }).code;
    throw error;
  }
  throw new Error("expected the call to fail");
}

const snapshots = (t: T, companyId: Id<"companies">) =>
  t.run((ctx) =>
    ctx.db
      .query("snapshots")
      .withIndex("by_company_asOf", (q) => q.eq("companyId", companyId))
      .collect(),
  );

describe("fieldAgents", { timeout: 60_000 }, () => {
  it("ensure creates an idle company without scheduling any agent work", async () => {
    vi.useFakeTimers();
    const t = newBackend();
    const { companyId } = await t.mutation(api.fieldOperating.ensure, {
      company: "asana-current",
      scenario: "baseline",
    });
    expect(await scheduled(t)).toEqual([]);
    const state = await t.query(api.fieldAgents.state, { companyId });
    expect(state).toMatchObject({ started: false, startedAt: null, phase: "idle" });
    expect(state?.tools.length).toBeGreaterThan(0);
    // Company, connections, world and source rows exist for the header.
    expect(await t.query(api.field.status, { companyId })).toMatchObject({ snapshotVersion: 0 });
    expect((await t.query(api.connections.list, { companyId }))?.tools.length).toBeGreaterThan(0);
    await drain(t, 5);
    expect(await snapshots(t, companyId)).toEqual([]);
  });

  it("start schedules the first ingest once and is idempotent", async () => {
    vi.useFakeTimers();
    const t = newBackend();
    const { companyId } = await t.mutation(api.fieldOperating.ensure, {
      company: "2u",
      scenario: "baseline",
    });
    const first = await t.mutation(api.fieldAgents.start, { companyId });
    expect(first).toMatchObject({ started: true, scheduled: true });
    const again = await t.mutation(api.fieldAgents.start, { companyId });
    expect(again).toEqual({ started: true, scheduled: false, startedAt: first.startedAt });
    expect(await scheduled(t)).toEqual(["fieldJobs:ingestRun"]);
    expect((await t.query(api.fieldAgents.state, { companyId }))?.phase).toBe("reading");
    await drain(t);
    expect(await snapshots(t, companyId)).toHaveLength(1);
    expect((await t.query(api.fieldAgents.state, { companyId }))?.phase).toBe("ready");
  });

  it("guards clock, ingest, auto checks, analyst, judge changes and webhooks while idle", async () => {
    vi.useFakeTimers();
    const t = newBackend();
    const { companyId } = await t.mutation(api.fieldOperating.ensure, {
      company: "2u",
      scenario: "late-payments",
    });
    expect(await code(t.mutation(api.fieldClock.play, { companyId }))).toBe("AGENTS_IDLE");
    expect(await code(t.mutation(api.fieldClock.jump, { companyId }))).toBe("AGENTS_IDLE");
    expect(await code(t.mutation(api.field.ingestNow, { companyId }))).toBe("AGENTS_IDLE");
    expect(await code(t.mutation(api.field.setAutoIngest, { companyId, enabled: true }))).toBe(
      "AGENTS_IDLE",
    );
    expect(await code(t.mutation(api.fieldAnalyst.run, { companyId }))).toBe("AGENTS_IDLE");
    const hook = await t.mutation(internal.fieldWebhooks.receive, {
      companyId,
      vendor: "stripe",
      eventId: "evt_idle",
      type: "invoice.created",
      summary: "idle",
      refs: [],
      transport: "internal",
    });
    expect(hook).toEqual({ duplicate: false, status: "agents_idle" });
    // A stray queued ingest reads nothing either.
    await t.action(internal.fieldJobs.ingestRun, { companyId, trigger: "manual" });
    expect(await snapshots(t, companyId)).toEqual([]);
    expect(await scheduled(t)).toEqual([]);

    const judge = await t.mutation(api.fieldJudge.start, {});
    expect(await scheduled(t)).toEqual([]);
    expect(
      (await t.query(api.fieldJudge.state, { companyId: judge.companyId }))?.agentsStarted,
    ).toBe(false);
    expect(
      await code(
        t.mutation(api.fieldJudge.surprise, {
          companyId: judge.companyId,
          preset: "unexpected_bill",
        }),
      ),
    ).toBe("AGENTS_IDLE");

    await t.mutation(api.fieldAgents.start, { companyId });
    await drain(t);
    await t.mutation(api.fieldClock.play, { companyId });
    await t.mutation(api.fieldClock.pause, { companyId });
  });

  it("treats existing companies with a snapshot as started", async () => {
    vi.useFakeTimers();
    const t = newBackend();
    const { companyId } = await t.mutation(api.fieldOperating.ensure, {
      company: "2u",
      scenario: "baseline",
    });
    await t.mutation(api.fieldAgents.start, { companyId });
    await drain(t);
    // An older row: no agentsStartedAt, but it already saved books.
    await t.run((ctx) => ctx.db.patch("companies", companyId, { agentsStartedAt: undefined }));
    const state = await t.query(api.fieldAgents.state, { companyId });
    expect(state).toMatchObject({ started: true, startedAt: null, phase: "ready" });
    expect(await t.mutation(api.fieldAgents.start, { companyId })).toEqual({
      started: true,
      scheduled: false,
      startedAt: null,
    });
    // Legacy field.setup companies start at once, as before.
    const legacy = await t.mutation(api.field.setup, { profile: "kestrel" });
    expect((await t.query(api.fieldAgents.state, { companyId: legacy.companyId }))?.started).toBe(
      true,
    );
  });
});
