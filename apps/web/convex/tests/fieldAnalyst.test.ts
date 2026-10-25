/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob(["../**/*.ts", "../_generated/*.js", "!./**"]);
const newBackend = () => convexTest(schema, modules);
type T = ReturnType<typeof newBackend>;

// These runs never reach Apify; fieldApify.test.ts covers live searches with recorded responses.
Reflect.deleteProperty(process.env, "APIFY_TOKEN");

afterEach(() => {
  vi.useRealTimers();
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
    paginationOpts: { numItems: 500, cursor: null },
  });
  return page.page;
}

describe("field analyst", () => {
  it("spawns parallel forecasters on kestrel-crunch, logs the agent web and aggregates", async () => {
    vi.useFakeTimers();
    const t = newBackend();
    const { companyId } = await t.mutation(api.field.setup, { profile: "kestrel-crunch" });
    await drain(t); // first ingest; the analyst is scheduled after recompute
    await drain(t, 12); // afterIngest -> forecasters/research steps -> aggregate

    const result = await t.query(api.fieldAnalyst.latest, { companyId });
    expect(result?.status).toBe("done");
    expect(result?.trigger).toBe("ingest");
    const scenarios = result?.scenarios ?? [];
    expect(scenarios.length).toBeGreaterThanOrEqual(6);
    expect(scenarios.length).toBeLessThanOrEqual(10);
    expect(scenarios.every((s) => s.status === "done")).toBe(true);
    const failing = scenarios.filter((s) => s.survives === false);
    expect(failing.length).toBeGreaterThan(0);
    expect(failing[0]?.breaksWeek).toBeGreaterThan(0);
    expect(failing[0]?.bestFix?.label).toBeTruthy();
    for (const s of scenarios) {
      expect(Number.isInteger(s.low)).toBe(true);
      expect(Number.isInteger(s.cashImpact)).toBe(true);
    }
    // No APIFY_TOKEN in tests: no actor runs, no canned stand-in (fieldApify.test.ts has runs).
    expect(result?.research.length).toBe(0);

    const rows = (await logRows(t, companyId)).filter((r) => r.runId === result?.runId);
    const spawned = rows.filter((r) => r.event === "status" && r.status === "spawned");
    expect(spawned.length).toBe(scenarios.length + 1);
    expect(spawned.every((r) => r.parentAgentId === "analyst#1")).toBe(true);
    const messages = rows.filter((r) => r.event === "message");
    expect(
      messages.some((r) => r.fromAgentId === "analyst#1" && r.toAgentId === "forecaster#1"),
    ).toBe(true);
    expect(
      messages.some((r) => r.fromAgentId === "forecaster#1" && r.toAgentId === "analyst#1"),
    ).toBe(true);
    expect(messages.some((r) => r.fromAgentId === "research#1")).toBe(true);
    const working = rows.filter((r) => r.status === "working" && r.agentId === "forecaster#2");
    expect(working.map((r) => r.currentTask)).toContainEqual(
      expect.stringMatching(/week 8 of 13$/),
    );
    expect(working.every((r) => r.agentKind === "domino" && r.steps === 6)).toBe(true);
    expect(rows.some((r) => r.toolCategory === "apify")).toBe(false);
    expect(rows.map((r) => r.summary)).toContainEqual(
      expect.stringMatching(/^Apify not configured/),
    );
    expect(rows.filter((r) => r.toolCategory === "engine").map((r) => r.tool)).toEqual(
      expect.arrayContaining(["engine.forecast", "engine.stressTest", "engine.scoreFix"]),
    );
    expect(rows.find((r) => r.agentId === "analyst#1" && r.status === "done")).toBeTruthy();
  }, 120_000);

  it("runs on demand, refuses overlap, and the auto loop is bounded per generation", async () => {
    vi.useFakeTimers();
    const t = newBackend();
    const { companyId } = await t.mutation(api.field.setup, { profile: "kestrel" });
    await drain(t);
    await drain(t, 12);
    const first = await t.mutation(api.fieldAnalyst.run, { companyId, paceMs: 0 });
    expect(first.skipped).toBe(false);
    const again = await t.mutation(api.fieldAnalyst.run, { companyId, paceMs: 0 });
    expect(again).toEqual({ runId: first.runId, skipped: true });
    await drain(t, 12);
    expect((await t.query(api.fieldAnalyst.latest, { companyId }))?.runId).toBe(first.runId);

    await t.mutation(api.field.setAutoIngest, { companyId, enabled: true });
    await t.mutation(internal.fieldAnalyst.afterIngest, { companyId, changed: false });
    const loop = await t.run((ctx) => ctx.db.query("analystLoops").first());
    expect(loop).toMatchObject({ generation: 1, ticksLeft: 120 });
    await t.mutation(api.field.setAutoIngest, { companyId, enabled: false });
    await t.mutation(internal.fieldAnalyst.tick, { companyId, generation: 1 });
    const stopped = await t.run((ctx) => ctx.db.query("analystLoops").first());
    expect(stopped).toMatchObject({ ticksLeft: 0 });
    const actions = (await logRows(t, companyId)).map((r) => r.action);
    expect(actions).toContain("analyst.loopStopped");
  }, 120_000);
});
