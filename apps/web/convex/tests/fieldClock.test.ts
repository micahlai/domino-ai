/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { computedRefs } from "../lib/refs";
import schema from "../schema";

const modules = import.meta.glob(["../**/*.ts", "../_generated/*.js", "!./**"]);
const newBackend = () => convexTest(schema, modules);
type T = ReturnType<typeof newBackend>;

afterEach(() => {
  vi.useRealTimers();
});

async function drain(t: T, rounds = 1) {
  for (let i = 0; i < rounds; i++) {
    vi.runOnlyPendingTimers();
    await t.finishInProgressScheduledFunctions();
  }
}

async function company(t: T, profile: "kestrel" | "kestrel-crunch") {
  const { companyId } = await t.mutation(api.field.setup, { profile });
  await drain(t, 20); // first ingest and its analyst run
  return companyId;
}

/** Plays until the clock reaches `day` (each round runs the pending tick and its agents). */
async function playTo(t: T, companyId: Id<"companies">, day: number) {
  await t.mutation(api.fieldClock.play, { companyId, speed: 20 });
  for (let i = 0; i < day * 4; i++) {
    const s = await t.query(api.fieldClock.status, { companyId });
    if ((s?.day ?? 0) >= day) break;
    await drain(t);
  }
  await t.mutation(api.fieldClock.pause, { companyId });
  await drain(t, 20); // let the agents the last days started finish
}

async function rows(t: T, companyId: Id<"companies">) {
  return t.run((ctx) =>
    ctx.db
      .query("log")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .collect(),
  );
}

const clockRow = (t: T, companyId: Id<"companies">) =>
  t.run((ctx) =>
    ctx.db
      .query("simClocks")
      .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
      .unique(),
  );

describe("simulated clock", () => {
  it("plays day by day, ingests right away and fires Kestrel's day-11 duplicate bill", async () => {
    vi.useFakeTimers();
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    const t = newBackend();
    const companyId = await company(t, "kestrel");
    await playTo(t, companyId, 11);

    const status = await t.query(api.fieldClock.status, { companyId });
    expect(status).toMatchObject({ day: 11, date: "2026-11-10", status: "paused" });
    expect(status?.fired.map((f) => f.day)).toEqual([11]);
    expect(status?.nextEvent).toBeNull();

    const log = await rows(t, companyId);
    const days = log.filter((r) => r.action === "clock.day");
    expect(days).toHaveLength(11);
    // Event driven: one clock ingest per simulated day with entries, no polling.
    const ingests = log.filter((r) => r.action === "ingest.started" && r.refs[0] === "clock");
    expect(ingests).toHaveLength(11);
    expect(log.some((r) => r.action === "ingest.recomputeFailed")).toBe(false);
    expect(log.filter((r) => r.action === "clock.event")).toHaveLength(1);

    const flags = await t.query(api.field.findings, { companyId, escalatedOnly: true });
    expect(
      flags.some((f) => f.kind === "duplicate" && f.refs.some((r) => r.endsWith("_resent"))),
    ).toBe(true);
    const asked = log.filter((r) => r.action.startsWith("clock.analyst"));
    expect(asked.some((r) => /scripted event/.test(r.summary ?? ""))).toBe(true);

    // Routine days are marked quiet and refused any model call; the event day's version is not.
    const clock = await clockRow(t, companyId);
    const quiet = clock?.quietScopes ?? [];
    expect(quiet.length).toBeGreaterThan(5);
    const feed = await t.query(api.field.status, { companyId });
    const eventScope = `v${feed?.snapshotVersion}`;
    expect(quiet).not.toContain(eventScope);
    const reserve = (scope: string) =>
      t.mutation(internal.fieldAi.reserve, {
        companyId,
        kind: "analyst",
        provider: "claude",
        scope,
      });
    for (const scope of quiet)
      expect(await reserve(scope)).toMatchObject({
        ok: false,
        reason: expect.stringMatching(/routine/),
      });
    expect(await reserve(eventScope)).toMatchObject({ ok: true });
    // The analyst's catch-up after a run defers to the clock: routine days get no extra run.
    const runs = await t.run((ctx) =>
      ctx.db
        .query("analystRuns")
        .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
        .collect(),
    );
    expect(runs.filter((r) => r.trigger === "catch-up")).toEqual([]);
    // No key on this backend: the analyst's model step says so instead of calling anything.
    expect(log.some((r) => /ANTHROPIC_API_KEY not set/.test(r.summary ?? ""))).toBe(true);
  }, 300_000);

  it("is deterministic: two backends playing the same days reach the same world", async () => {
    vi.useFakeTimers();
    const worlds = [];
    for (let i = 0; i < 2; i++) {
      const t = newBackend();
      const companyId = await company(t, "kestrel-crunch");
      await playTo(t, companyId, 3);
      worlds.push(
        await t.run(async (ctx) => {
          const row = await ctx.db
            .query("feedWorlds")
            .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
            .unique();
          return { world: row?.world, overlay: row?.overlay };
        }),
      );
    }
    expect(worlds[0]).toEqual(worlds[1]);
  }, 300_000);

  it("jumps to the day before Osprey's notice; the notice day flags lost billing", async () => {
    vi.useFakeTimers();
    const t = newBackend();
    const companyId = await company(t, "kestrel-crunch");
    const jumped = await t.mutation(api.fieldClock.jump, { companyId });
    expect(jumped).toEqual({ day: 8, jumped: 8 });
    await drain(t, 20);
    const before = await t.query(api.fieldClock.status, { companyId });
    expect(before?.nextEvent).toMatchObject({ day: 9, inDays: 1 });
    await playTo(t, companyId, 9);
    const flags = await t.query(api.field.findings, { companyId, escalatedOnly: true });
    expect(flags.some((f) => f.kind === "missing_expected" && /Halcyon/.test(f.summary))).toBe(
      true,
    );
    const log = await rows(t, companyId);
    expect(log.find((r) => r.action === "clock.event")?.summary).toMatch(/gives notice/);
  }, 300_000);

  it("pauses itself after 13 simulated weeks or 60 minutes of wall time", async () => {
    vi.useFakeTimers();
    const t = newBackend();
    const companyId = await company(t, "kestrel");
    await t.mutation(api.fieldClock.play, { companyId, speed: 20 });
    const clock = await clockRow(t, companyId);
    await t.run((ctx) => ctx.db.patch("simClocks", clock!._id, { sessionStartDay: -91 }));
    await drain(t);
    expect(await t.query(api.fieldClock.status, { companyId })).toMatchObject({
      status: "paused",
      pausedReason: "13 simulated weeks played",
      day: 0,
    });

    await t.mutation(api.fieldClock.play, { companyId, speed: 20 });
    await t.run((ctx) =>
      ctx.db.patch("simClocks", clock!._id, { playStartedAt: Date.now() - 61 * 60_000 }),
    );
    await drain(t);
    expect(await t.query(api.fieldClock.status, { companyId })).toMatchObject({
      status: "paused",
      pausedReason: "60 minutes of wall time",
    });
  }, 120_000);

  it("runs one tick at a time: a tick holding the lease blocks another", async () => {
    vi.useFakeTimers();
    const t = newBackend();
    const companyId = await company(t, "kestrel");
    await t.mutation(api.fieldClock.play, { companyId, speed: 20 });
    const clock = await clockRow(t, companyId);
    await t.run((ctx) => ctx.db.patch("simClocks", clock!._id, { tickStartedAt: Date.now() }));
    const claim = await t.mutation(internal.fieldClock.claimTick, {
      companyId,
      generation: clock!.generation,
    });
    expect(claim).toBeNull();
  }, 120_000);
});

describe("recompute after ingest", () => {
  it("reads the saved proposal order by index and runs before the analyst", async () => {
    vi.useFakeTimers();
    const t = newBackend();
    const companyId = await company(t, "kestrel-crunch");
    // Many newer log rows (the agents' traffic) between the order row and now.
    await t.run(async (ctx) => {
      for (let i = 0; i < 1500; i++)
        await ctx.db.insert("log", {
          companyId,
          actor: "engine",
          action: "analyst.tool",
          refs: [],
          at: new Date().toISOString(),
        });
    });
    const again = await t.mutation(computedRefs.recompute, { companyId });
    expect(again.changed).toBe(false);

    const log = (await rows(t, companyId)).sort((a, b) => a._creationTime - b._creationTime);
    const recomputed = log.findIndex((r) => r.action === "ingest.recomputed");
    const analyst = log.findIndex((r) => r.action === "analyst.working");
    expect(recomputed).toBeGreaterThanOrEqual(0);
    expect(analyst).toBeGreaterThan(recomputed);
  }, 120_000);
});
