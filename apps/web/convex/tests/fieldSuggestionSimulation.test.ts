/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { constraints, model, snapshot } from "@domino/contracts/fixtures";
import { adviseFix, advisorCandidates } from "@domino/engine";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { forecastScenario } from "../lib/analystScenarios";
import schema from "../schema";
const modules = import.meta.glob(["../**/*.ts", "../_generated/*.js", "!./**"]);
const backend = () => convexTest(schema, modules);
type T = ReturnType<typeof backend>;
afterEach(() => vi.useRealTimers());

async function seed(t: T, name = "Saved company") {
  vi.useFakeTimers();
  const companyId = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert("companies", {
      name,
      profile: "kestrel",
      currentWeek: 0,
      today: snapshot.asOf,
      status: "ready",
    });
    const snapshotId = await ctx.db.insert("snapshots", {
      companyId,
      asOf: snapshot.asOf,
      data: snapshot,
    });
    await ctx.db.insert("models", { companyId, version: model.version, data: model });
    await ctx.db.insert("sources", {
      companyId,
      kind: "books",
      baseUrl: "http://mock/books",
      mappings: {},
      lastPull: snapshot.asOf,
      tieOut: "ok",
      step: "Saved source check",
    });
    for (const data of constraints) await ctx.db.insert("constraints", { companyId, data });
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
    return companyId;
  });
  const { runId } = await t.mutation(api.fieldAnalyst.run, { companyId, paceMs: 0 });
  return { companyId, runId };
}

async function planned(t: T, scope: { companyId: Id<"companies">; runId: string }) {
  await t.action(internal.fieldAnalyst.plan, { runId: scope.runId });
  const trace = await t.query(api.fieldTrace.get, {
    companyId: scope.companyId,
    runId: scope.runId,
  });
  const scenario = trace?.scenarios[0];
  if (!scenario) throw new Error("Fixture has no scenario");
  return scenario;
}
async function finish(t: T, runId: string) {
  await t.mutation(internal.fieldAnalyst.finish, {
    runId,
    summary: "Recorded engine result",
    aiSummary: {
      status: "unavailable",
      reason: "No provider configured",
      at: new Date().toISOString(),
    },
  });
}

async function savedOption(t: T, scenarioId = "top_payers_30_late") {
  const scope = await seed(t);
  await planned(t, scope);
  const sc = (await t.query(api.fieldTrace.get, scope))?.scenarios.find((s) => s.id === scenarioId);
  if (!sc) throw new Error("No selected fixture scenario");
  const inputs = await t.query(internal.fieldAnalyst.inputs, { runId: scope.runId });
  const work = forecastScenario(inputs, {
    id: sc.id,
    title: sc.title,
    basis: sc.basis,
    changes: sc.changes,
  });
  await t.mutation(internal.fieldAnalyst.record, {
    runId: scope.runId,
    index: sc.index,
    rows: [],
    scenario: { status: "done", work, fixes: [] },
  });
  const input = { ...inputs, scenario: { id: sc.id, label: sc.title, changes: sc.changes } };
  const fix = advisorCandidates(input).find((c) => c.fix.changes.length);
  if (!fix) throw new Error("No fixture fix");
  const effect = adviseFix(input, fix);
  const { kind, fixId, ...storedEffect } = effect;
  await t.mutation(internal.fieldAdvisor.store, {
    ...scope,
    snapshotVersion: 1,
    scenarioId: sc.id,
    scenarioTitle: sc.title,
    scenarioLow: work.low,
    lenderMinimum: 1_000_000,
    items: [
      {
        kind: fix.kind,
        fix: {
          id: fix.fix.id,
          label: fix.fix.label,
          costNote: fix.fix.costNote,
          risk: fix.fix.risk,
          changes: fix.fix.changes,
        },
        effect: storedEffect,
      },
    ],
  });
  await finish(t, scope.runId);
  return {
    scope,
    sc,
    inputs,
    fix,
    effect,
    work,
    args: {
      ...scope,
      scenarioId: sc.id,
      fixKind: fix.kind,
      suggestionId: `${sc.id}:${fix.kind}`,
      snapshotVersion: 1,
    },
  };
}
describe("independent saved suggestion action", () => {
  it.each(["top_customer_leaves", "card_spend_spike"])(
    "supports production-planned %s",
    async (scenarioId) => {
      const t = backend();
      const f = await savedOption(t, scenarioId);
      const out = await t.action(api.fieldSuggestionSimulation.simulate, f.args);
      expect(out.scenarioLow.cents).toBe(f.work.low);
      expect(out.fixLow.cents).toBe(f.effect.lowPoint);
    },
  );
  it("saves exact baseline-risk-fix numbers and retries despite latest state drift", async () => {
    const t = backend();
    const f = await savedOption(t);
    const fetch = vi.fn(() => {
      throw new Error("Unexpected provider call");
    });
    vi.stubGlobal("fetch", fetch);
    const out = await t.action(api.fieldSuggestionSimulation.simulate, f.args);
    expect(out.timelineCompanyId).toBe(f.inputs.snapshot.companyId);
    expect(out.timelineCompanyId).not.toBe(f.scope.companyId);
    const get = (runId: string) =>
      t.query(api.timeline.workspace.get, { companyId: out.timelineCompanyId, runId });
    const root = await get(out.rootRunId);
    const risk = await get(out.scenarioRunId);
    const fixed = await get(out.fixRunId);
    expect(root?.parentRunId).toBeNull();
    expect(risk?.parentRunId).toBe(out.rootRunId);
    expect(fixed?.parentRunId).toBe(out.scenarioRunId);
    expect(risk?.ownChanges).toEqual(f.sc.changes);
    expect(fixed?.ownChanges).toEqual(f.fix.fix.changes);
    expect(fixed?.changes).toEqual([...f.sc.changes, ...f.fix.fix.changes]);
    expect(out.scenarioLow.cents).toBe(f.work.low);
    expect(out.fixLow).toEqual({ cents: f.effect.lowPoint, weekStart: f.effect.lowWeekStart });
    expect(fixed?.comparison?.parentRunId).toBe(out.scenarioRunId);
    expect(fixed?.comparison?.lowPointDelta).toBe(f.effect.gain);
    expect(out.scenarioLow.cents).toBe(risk?.forecast.lowPoint.usable);
    expect(out.fixLow.cents).toBe(fixed?.forecast.lowPoint.usable);
    await t.run(async (ctx) => {
      await ctx.db.patch("companies", f.scope.companyId, { name: "Later company label" });
      await ctx.db.insert("models", {
        companyId: f.scope.companyId,
        version: 999,
        data: {
          ...model,
          version: 999,
          recurringSpend: [{ label: "Later spend", amount: 99000000, everyDays: 30 }],
        },
      });
      const feed = await ctx.db.query("feeds").first();
      if (feed) await ctx.db.patch("feeds", feed._id, { snapshotVersion: 99 });
      for (const rule of await ctx.db.query("constraints").collect())
        await ctx.db.patch("constraints", rule._id, { data: { ...rule.data, limit: 99000000 } });
    });
    const again = await t.action(api.fieldSuggestionSimulation.simulate, f.args);
    expect(again).toEqual({ ...out, reused: true });
    expect(out.reused).toBe(false);
    const saved = await t.query(api.timeline.baselines.get, {
      companyId: out.timelineCompanyId,
      runId: out.baselineRunId,
    });
    expect(saved?.companyName).toBe("Saved company");
    expect(saved?.model).toEqual(f.inputs.model);
    expect(saved?.constraints).toEqual(f.inputs.constraints);
    expect(await t.run((ctx) => ctx.db.query("timelineRuns").collect())).toHaveLength(3);
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it("rejects mismatched membership before any Timeline writes", async () => {
    const t = backend();
    const f = await savedOption(t);
    const other = await seed(t, "Other");
    for (const override of [
      { companyId: other.companyId },
      { runId: "missing" },
      { scenarioId: "missing" },
      { fixKind: "not-a-kind" },
      { suggestionId: "missing" },
      { snapshotVersion: 2 },
    ])
      await expect(
        t.action(api.fieldSuggestionSimulation.simulate, { ...f.args, ...override }),
      ).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query("timelineBaselines").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("timelineRuns").collect())).toHaveLength(0);
  });
  it("rejects legacy pins and changed snapshot evidence without latest fallback", async () => {
    const t = backend();
    const f = await savedOption(t);
    const run = await t.run((ctx) => ctx.db.query("analystRuns").first());
    if (!run) throw new Error("No run");
    await t.run((ctx) => ctx.db.patch("analystRuns", run._id, { traceInputs: undefined }));
    await expect(t.action(api.fieldSuggestionSimulation.simulate, f.args)).rejects.toThrow(
      "complete pinned",
    );
    await t.run((ctx) => ctx.db.patch("analystRuns", run._id, { traceInputs: run.traceInputs }));
    await t.run(async (ctx) => {
      const row = await ctx.db.get("snapshots", run.snapshotId);
      if (row)
        await ctx.db.patch("snapshots", row._id, {
          data: { ...row.data, cashOnHand: row.data.cashOnHand + 1 },
        });
    });
    await expect(t.action(api.fieldSuggestionSimulation.simulate, f.args)).rejects.toThrow(
      "no longer matches",
    );
    expect(await t.run((ctx) => ctx.db.query("timelineBaselines").collect())).toHaveLength(0);
  });
});
