/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob(["../**/*.ts", "../_generated/*.js", "!./**"]);
const newBackend = () => convexTest(schema, modules);
type T = ReturnType<typeof newBackend>;

afterEach(() => {
  vi.useRealTimers();
});

async function drain(t: T) {
  vi.runOnlyPendingTimers();
  await t.finishInProgressScheduledFunctions();
}

async function company(t: T) {
  const { companyId } = await t.mutation(api.field.setup, {});
  await drain(t);
  return companyId;
}

/** A new week with a card spike at the usual merchant, then ingest and audit. */
async function spikeWeek(t: T, companyId: Id<"companies">) {
  await t.mutation(api.field.advanceFeed, { companyId, anomaly: "unusual_amount" });
  await t.mutation(api.field.ingestNow, { companyId });
  await drain(t);
}

const spikes = async (t: T, companyId: Id<"companies">, status?: "open" | "rejected") =>
  (await t.query(api.field.findings, { companyId, ...(status && { status }) })).filter(
    (f) => f.kind === "unusual_amount",
  );

describe("field learning loop", () => {
  it("dismissal with a reason -> next ingest not flagged with a receipt -> undo restores", async () => {
    vi.useFakeTimers();
    const t = newBackend();
    const a = await company(t);
    const b = await company(t);
    await spikeWeek(t, a);
    const [first] = await spikes(t, a);
    expect(first).toBeDefined();
    await t.mutation(api.field.decide, {
      companyId: a,
      findingId: first?.findingId as string,
      decision: "rejected",
      note: "This vendor always bills twice a month",
    });
    const learned = await t.query(api.fieldLearning.list, { companyId: a });
    expect(learned.rules).toMatchObject([
      {
        version: 1,
        active: true,
        reason: "This vendor always bills twice a month",
        source: "You dismissed a flag",
        applied: 0,
      },
    ]);

    // Next week the same pattern is not flagged; it keeps a visible receipt.
    vi.advanceTimersByTime(60_000);
    await spikeWeek(t, a);
    expect(await spikes(t, a, "open")).toEqual([]);
    const hidden = (await spikes(t, a, "rejected")).filter((f) => f.learned);
    expect(hidden).toHaveLength(1);
    expect(hidden[0]?.learned?.text).toMatch(
      /^Not flagged: learned from your dismissal on \w{3} \d+ \(rule v1\)$/,
    );
    const after = await t.query(api.fieldLearning.list, { companyId: a });
    expect(after.rules[0]).toMatchObject({ applied: 1, lastEffect: hidden[0]?.learned?.text });
    // The Learning agent logged its work for the brain map.
    const log = await t.run((ctx) => ctx.db.query("log").collect());
    expect(log.some((r) => r.agentId === "learning#1" && r.companyId === a)).toBe(true);

    // Another company is unaffected.
    await spikeWeek(t, b);
    expect((await spikes(t, b, "open")).length).toBeGreaterThan(0);
    expect((await t.query(api.fieldLearning.list, { companyId: b })).rules).toEqual([]);

    // Undo: the hidden flag returns to review and later spikes are flagged again.
    const undo = await t.mutation(api.fieldLearning.undo, {
      companyId: a,
      ruleId: learned.rules[0]?.ruleId as string,
    });
    expect(undo.reopened).toBe(1);
    expect(await spikes(t, a, "open")).toHaveLength(1);
    expect((await t.query(api.fieldLearning.list, { companyId: a })).rules[0]).toMatchObject({
      active: false,
    });
    vi.advanceTimersByTime(60_000);
    await spikeWeek(t, a);
    expect(await spikes(t, a, "open")).toHaveLength(2);
  }, 120_000);

  it("a dismissal without a reason learns nothing", async () => {
    vi.useFakeTimers();
    const t = newBackend();
    const a = await company(t);
    await spikeWeek(t, a);
    const [first] = await spikes(t, a);
    await t.mutation(api.field.decide, {
      companyId: a,
      findingId: first?.findingId as string,
      decision: "rejected",
    });
    expect((await t.query(api.fieldLearning.list, { companyId: a })).rules).toEqual([]);
  }, 60_000);
});
