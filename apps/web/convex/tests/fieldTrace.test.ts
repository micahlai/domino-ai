/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { constraints, model, snapshot } from "@domino/contracts/fixtures";
import { adviseFix, advisorCandidates } from "@domino/engine";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FieldTraceSchema } from "../../lib/field-trace-contract";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { searchReport } from "../fieldApify";
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

const candidate = {
  kind: "delay_bill" as const,
  fix: {
    id: "fix-bill",
    label: "Delay a bill",
    costNote: "Ask the vendor",
    risk: "medium" as const,
    changes: [],
  },
  effect: { lowPoint: 1_200_000, lowWeekStart: "2026-11-02", survives: true, gain: 300_000 },
};
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
async function store(
  t: T,
  scope: { companyId: Id<"companies">; runId: string },
  scenarioId: string,
  gain = candidate.effect.gain,
) {
  return t.mutation(internal.fieldAdvisor.store, {
    companyId: scope.companyId,
    runId: scope.runId,
    snapshotVersion: 1,
    scenarioId,
    scenarioTitle: "Saved stress",
    scenarioLow: 900_000,
    lenderMinimum: 1_000_000,
    items: [{ ...candidate, effect: { ...candidate.effect, gain } }],
  });
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

describe("exact Field calculation evidence", () => {
  it("pins the model, rules, company and observed snapshot before forecast and advisor work", async () => {
    const t = backend();
    const scope = await seed(t);
    const original = await t.query(internal.fieldAnalyst.inputs, { runId: scope.runId });
    const traceAtStart = await t.query(api.fieldTrace.get, scope);
    await t.run(async (ctx) => {
      const old = await ctx.db.query("models").first();
      if (!old) throw new Error("Missing model");
      const changed = {
        ...model,
        version: model.version + 1,
        recurringSpend: [{ label: "New monthly spend", amount: 99_000_000, everyDays: 30 }],
      };
      await ctx.db.patch("models", old._id, { data: changed });
      await ctx.db.insert("models", {
        companyId: scope.companyId,
        version: changed.version,
        data: changed,
      });
      const rule = await ctx.db.query("constraints").first();
      if (rule)
        await ctx.db.patch("constraints", rule._id, { data: { ...rule.data, limit: 999_000_000 } });
      await ctx.db.patch("companies", scope.companyId, {
        name: "Renamed after start",
        today: "2027-01-01",
      });
      const source = await ctx.db.query("sources").first();
      if (source)
        await ctx.db.patch("sources", source._id, {
          step: "Changed after start",
          lastPull: "2027-01-01",
        });
    });
    expect(await t.query(internal.fieldAnalyst.inputs, { runId: scope.runId })).toEqual(original);
    const scenario = await planned(t, scope);
    await t.action(internal.fieldAnalyst.forecasterStep, { runId: scope.runId, index: 0, step: 0 });
    const result = await t.query(api.fieldTrace.get, scope);
    const sc = {
      id: scenario.id,
      title: scenario.title,
      basis: scenario.basis,
      changes: scenario.changes,
    };
    expect(result?.scenarios[0]?.work).toEqual(forecastScenario(original, sc));
    expect(result?.inputs).toEqual(traceAtStart?.inputs);
    expect(result?.inputs?.company.name).toBe("Saved company");
    const input = { ...original, scenario: { id: sc.id, label: sc.title, changes: sc.changes } };
    const fix = advisorCandidates(input)[0];
    expect(fix).toBeDefined();
    if (fix)
      expect(
        await t.action(internal.fieldAdvisor.advise, {
          runId: scope.runId,
          scenarioIndex: 0,
          scenario: input.scenario,
          candidate: fix,
        }),
      ).toEqual({ ok: true, effect: adviseFix(input, fix) });
  });

  it("isolates companies, unique runs, scenario membership and fix membership", async () => {
    const t = backend();
    const a = await seed(t, "A");
    const b = await seed(t, "B");
    expect(a.runId).not.toBe(b.runId);
    expect(
      await t.query(api.fieldTrace.get, { companyId: b.companyId, runId: a.runId }),
    ).toBeNull();
    expect(await t.query(api.fieldTrace.get, { ...a, runId: "missing" })).toBeNull();
    await expect(t.query(api.fieldTrace.get, { ...a, scenarioId: "unknown" })).rejects.toThrow(
      "not recorded",
    );
    const sc = await planned(t, a);
    await store(t, a, sc.id);
    await expect(
      t.query(api.fieldTrace.get, { ...a, scenarioId: sc.id, fixKind: "defer_hires" }),
    ).rejects.toThrow("not recorded");
    await expect(t.query(api.fieldTrace.get, { ...a, fixKind: "delay_bill" })).rejects.toThrow(
      "not recorded",
    );
    const selected = await t.query(api.fieldTrace.get, {
      ...a,
      scenarioId: sc.id,
      fixKind: "delay_bill",
    });
    expect(selected?.selection).toEqual({ scenarioId: sc.id, fixKind: "delay_bill" });
    expect(FieldTraceSchema.safeParse(selected).success).toBe(true);
  });

  it("keeps completed candidates and rationale immutable across open-row replacement and later writes", async () => {
    const t = backend();
    const a = await seed(t);
    const sc = await planned(t, a);
    await store(t, a, sc.id);
    await t.mutation(internal.fieldAdvisor.recommend, {
      ...a,
      snapshotVersion: 1,
      suggestionId: `${sc.id}:delay_bill`,
      text: "Keeps the saved cash minimum",
      remoteRunId: "recorded-provider-run",
    });
    await finish(t, a.runId);
    const before = await t.query(api.fieldTrace.get, {
      ...a,
      scenarioId: sc.id,
      fixKind: "delay_bill",
    });
    expect(before?.evidence).toBe("frozen");
    expect(before?.candidates[0]?.recommendation?.text).toBe("Keeps the saved cash minimum");
    const b = {
      companyId: a.companyId,
      ...(await t.mutation(api.fieldAnalyst.run, { companyId: a.companyId })),
    };
    await planned(t, b);
    await store(t, b, sc.id, 700_000);
    const live = await t.query(api.fieldSuggestions.list, { companyId: a.companyId });
    expect(live[0]?.runId).toBe(b.runId);
    expect(live[0]?.effect.gain).toBe(700_000);
    await t.mutation(internal.fieldAnalyst.record, {
      runId: a.runId,
      rows: [],
      failRun: "late failure",
    });
    await finish(t, a.runId);
    await t.run(async (ctx) => {
      await ctx.db.insert("log", {
        companyId: a.companyId,
        runId: a.runId,
        actor: "engine",
        action: "late.write",
        at: new Date().toISOString(),
        refs: [],
      });
      const row = await ctx.db
        .query("analystScenarios")
        .withIndex("by_runId_and_index", (q) => q.eq("runId", a.runId))
        .first();
      if (row)
        await ctx.db.patch("analystScenarios", row._id, { title: "Changed after completion" });
    });
    expect(
      await t.query(api.fieldTrace.get, { ...a, scenarioId: sc.id, fixKind: "delay_bill" }),
    ).toEqual(before);
  });

  it("retains provider origin on same-snapshot reuse and marks old attribution unknown", async () => {
    const t = backend();
    const a = await seed(t);
    const reservation = await t.mutation(internal.fieldAi.reserve, {
      companyId: a.companyId,
      analystRunId: a.runId,
      kind: "analyst",
      provider: "claude",
      scope: "v1",
    });
    expect(reservation.ok).toBe(true);
    if (!reservation.ok) throw new Error("Reservation failed");
    await t.mutation(internal.fieldAi.settle, {
      callId: reservation.callId,
      status: "ok",
      model: "recorded-model",
      inputTokens: 50,
      outputTokens: 10,
    });
    await finish(t, a.runId);
    const b = {
      companyId: a.companyId,
      ...(await t.mutation(api.fieldAnalyst.run, { companyId: a.companyId })),
    };
    expect(
      await t.mutation(internal.fieldAi.reserve, {
        companyId: b.companyId,
        analystRunId: b.runId,
        kind: "analyst",
        provider: "claude",
        scope: "v1",
      }),
    ).toMatchObject({ ok: false, duplicate: true });
    await t.run(async (ctx) => {
      await ctx.db.insert("aiCalls", {
        companyId: a.companyId,
        kind: "audit",
        provider: "claude",
        scope: "v1",
        hour: 0,
        at: new Date().toISOString(),
        status: "ok",
      });
      const row = await ctx.db
        .query("analystRuns")
        .withIndex("by_runId", (q) => q.eq("runId", b.runId))
        .unique();
      if (row)
        await ctx.db.patch("analystRuns", row._id, {
          research: [
            {
              provider: "apify",
              remoteRunId: "cached-search",
              cached: true,
              fetchedAt: new Date().toISOString(),
              originRunId: a.runId,
            },
          ],
        });
    });
    await finish(t, b.runId);
    const trace = await t.query(api.fieldTrace.get, { companyId: b.companyId, runId: b.runId });
    expect(trace?.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: reservation.callId,
          attribution: "same_snapshot",
          originRunId: a.runId,
        }),
        expect.objectContaining({ kind: "audit", attribution: "unknown", originRunId: null }),
        expect.objectContaining({ provider: "apify", attribution: "cached", originRunId: a.runId }),
      ]),
    );
    expect((await t.query(api.fieldTrace.get, a))?.providers).toMatchObject([
      { attribution: "this_run", originRunId: a.runId },
    ]);
    expect(
      await t.mutation(internal.fieldAi.reserve, {
        companyId: a.companyId,
        analystRunId: a.runId,
        kind: "advisor",
        provider: "creao",
        scope: "v1",
      }),
    ).toMatchObject({ ok: false, reason: "analyst run is no longer active" });
    await expect(
      t.mutation(internal.fieldAi.reserve, {
        companyId: a.companyId,
        analystRunId: b.runId,
        kind: "advisor",
        provider: "creao",
        scope: "v2",
      }),
    ).rejects.toThrow("must match");
  });

  it("labels legacy gaps without borrowing current models or rerunning work", async () => {
    const t = backend();
    const scope = await seed(t);
    await planned(t, scope);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("analystRuns").first();
      if (row)
        await ctx.db.patch("analystRuns", row._id, {
          status: "done",
          finishedAt: new Date().toISOString(),
          traceInputs: undefined,
          traceCandidates: undefined,
        });
    });
    const before = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    const trace = await t.query(api.fieldTrace.get, {
      companyId: scope.companyId,
      runId: scope.runId,
    });
    expect(trace?.evidence).toBe("legacy");
    expect(trace?.inputs).toBeNull();
    expect(trace?.limitations.join(" ")).toContain("not pinned");
    expect(await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).toEqual(
      before,
    );
    await expect(t.query(internal.fieldAnalyst.inputs, { runId: scope.runId })).rejects.toThrow(
      "cannot be resumed",
    );
  });

  it("preserves actual Apify cache origin through the stored research report", async () => {
    const t = backend();
    const scope = await seed(t);
    const at = new Date().toISOString();
    await t.run((ctx) =>
      ctx.db.insert("apifyRuns", {
        key: "public-customer",
        counterparty: "Public customer",
        query: "Public customer news",
        actorId: "apify/google-search-scraper",
        companyId: scope.companyId,
        analystRunId: "original-public-search",
        day: at.slice(0, 10),
        at,
        status: "ok",
        remoteRunId: "remote-search",
        signals: [],
        itemCount: 1,
        resultCount: 0,
      }),
    );
    const cache = await t.query(internal.fieldApify.lookup, { keys: ["public-customer"] });
    const hit = cache.cached["public-customer"];
    if (!hit) throw new Error("Missing recorded cache result");
    expect(hit.originRunId).toBe("original-public-search");
    const report = searchReport({ counterparty: "Public customer", outcome: "cached", ...hit });
    await t.mutation(internal.fieldAnalyst.record, {
      runId: scope.runId,
      rows: [],
      research: report.research,
    });
    await finish(t, scope.runId);
    expect((await t.query(api.fieldTrace.get, scope))?.providers).toMatchObject([
      {
        provider: "apify",
        attribution: "cached",
        originRunId: "original-public-search",
        remoteRunId: "remote-search",
      },
    ]);
  });

  it("scopes historical timestamp run-id collisions by company and checks snapshot ownership", async () => {
    const t = backend();
    const a = await seed(t, "A");
    const b = await seed(t, "B");
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("analystRuns").collect())
        await ctx.db.patch("analystRuns", row._id, { runId: "old-timestamp-id", status: "done" });
    });
    expect(
      (await t.query(api.fieldTrace.get, { companyId: a.companyId, runId: "old-timestamp-id" }))
        ?.inputs?.company.name,
    ).toBe("A");
    expect(
      (await t.query(api.fieldTrace.get, { companyId: b.companyId, runId: "old-timestamp-id" }))
        ?.inputs?.company.name,
    ).toBe("B");
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("snapshots")
        .withIndex("by_company_asOf", (q) => q.eq("companyId", a.companyId))
        .first();
      if (row) await ctx.db.patch("snapshots", row._id, { companyId: b.companyId });
    });
    await expect(
      t.query(api.fieldTrace.get, { companyId: a.companyId, runId: "old-timestamp-id" }),
    ).rejects.toThrow("Snapshot belongs");
  });

  it("freezes failed partial runs and marks abandoned runs failed before starting a new one", async () => {
    const t = backend();
    const a = await seed(t);
    await planned(t, a);
    await t.mutation(internal.fieldAnalyst.record, {
      runId: a.runId,
      rows: [
        {
          action: "analyst.failed",
          agentId: "analyst#1",
          agentKind: "domino",
          event: "status",
          status: "failed",
          summary: "Recorded failure",
        },
      ],
      failRun: "Recorded failure",
    });
    const failed = await t.query(api.fieldTrace.get, a);
    expect(failed).toMatchObject({
      evidence: "frozen",
      run: { status: "failed", summary: "Recorded failure" },
    });
    expect(failed?.operations.at(-1)?.status).toBe("failed");
    const b = {
      companyId: a.companyId,
      ...(await t.mutation(api.fieldAnalyst.run, { companyId: a.companyId })),
    };
    vi.setSystemTime(Date.now() + 6 * 60_000);
    await t.mutation(api.fieldAnalyst.run, { companyId: a.companyId });
    expect(
      await t.query(api.fieldTrace.get, { companyId: b.companyId, runId: b.runId }),
    ).toMatchObject({
      evidence: "frozen",
      run: { status: "failed", summary: "Run abandoned after its completion deadline" },
    });
    expect(await t.query(api.fieldTrace.get, a)).toEqual(failed);
  });

  it("discloses bounded logs while preserving recorded terminal status", async () => {
    const t = backend();
    const scope = await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 405; i++)
        await ctx.db.insert("log", {
          companyId: scope.companyId,
          runId: scope.runId,
          actor: "engine",
          action: "recorded.step",
          at: new Date().toISOString(),
          refs: [],
          summary: `Step ${i}`,
        });
    });
    await finish(t, scope.runId);
    const trace = await t.query(api.fieldTrace.get, {
      companyId: scope.companyId,
      runId: scope.runId,
    });
    expect(trace?.truncation.operations).toBe(true);
    expect(trace?.operations.length).toBe(400);
    expect(trace?.operations.at(-1)?.status).toBe("done");
    expect(trace?.limitations.join(" ")).toContain("omitted");
  });
});
