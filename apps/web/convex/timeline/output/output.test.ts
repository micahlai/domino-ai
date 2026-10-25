/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import {
  type Constraint,
  WeeklySeedV1Schema,
  canonicalJson,
  parseWeeklyResultRefJson,
} from "@domino/contracts";
import { weeklyBoundaryFixtures } from "@domino/contracts/fixtures";
import { engine } from "@domino/engine";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import { baselineRefs } from "../refs";
import type { CatalogEntry, WorkspaceRun } from "../workspace";
import { workspaceRefs } from "../workspaceRefs";
import { projectOutput } from "./project";
import { MAX_OUTPUT_BYTES, jsonBytes, parseFinancialOutputJson } from "./schema";

const modules = Object.fromEntries(
  Object.entries(
    import.meta.glob([
      "../../**/*.ts",
      "../../_generated/*.js",
      "!../../**/*.test.ts",
      "!../../**/*.test-support.ts",
    ]),
  ).map(([path, load]) => [new URL(path, import.meta.url).pathname, load]),
);
const setup = () => convexTest(schema, modules);
type Test = ReturnType<typeof setup>;
const ref = makeFunctionReference<"action", { companyId: string; runId: string }, string | null>(
  "timeline/output:get",
);
const seed = WeeklySeedV1Schema.parse(weeklyBoundaryFixtures.validKestrelWeeklySeed);
const evidence = {
  source: "document" as const,
  ref: "timeline:assumption",
  note: "User stated rule",
};
const cashRule = (limit: number): Constraint => ({
  id: "min_cash",
  label: "Cash floor",
  kind: "min_cash",
  limit,
  evidence,
});
afterEach(() => vi.restoreAllMocks());
function first<T>(values: T[]): T {
  const value = values[0];
  if (value === undefined) throw new Error("Missing first value");
  return value;
}

async function open(t: Test, constraints: Constraint[] = []) {
  const baseline = await t.mutation(baselineRefs.save, {
    requestId: "tl6-baseline-1",
    seedJson: JSON.stringify(seed),
    modelJson: JSON.stringify({ version: 0, customerDelayDays: {}, recurringSpend: [], rules: [] }),
    constraintsJson: JSON.stringify(constraints),
    assumptionNote: "Reviewed neutral synthetic fixture",
    reviewed: true,
  });
  const root = await t.mutation(workspaceRefs.open, {
    companyId: seed.company.id,
    baselineRunId: baseline.runId,
    requestId: "tl6-root-1",
  });
  const key = { companyId: seed.company.id, runId: root.runId };
  const run = await t.query(workspaceRefs.get, key);
  if (!run) throw new Error("Missing root");
  return { key, run };
}
async function output(t: Test, key: { companyId: string; runId: string }) {
  const json = await t.action(ref, key);
  const parsed = parseFinancialOutputJson(json);
  if (!parsed.success) throw new Error(`Invalid output: ${parsed.error.message}`);
  expect(json).toBe(canonicalJson(parsed.data));
  return parsed.data;
}
let counter = 0;
async function spend(t: Test, parentRunId: string, amount = 1_000_000) {
  const result = await t.mutation(workspaceRefs.simulate, {
    companyId: seed.company.id,
    parentRunId,
    requestId: `tl6-spend-${++counter}`,
    label: "Hypothetical equipment",
    changesJson: JSON.stringify([
      { kind: "remove_cash", amount, date: "2026-11-10", label: `Equipment ${counter}` },
    ]),
    reviewed: true,
  });
  return result.runId;
}
const entryFor = (run: WorkspaceRun): CatalogEntry => ({
  runId: run.runId,
  companyId: run.companyId,
  baselineRunId: run.baselineRunId,
  parentRunId: run.parentRunId,
  kind: run.kind,
  label: run.label,
  savedAt: run.savedAt,
  lowPointCents: run.forecast.lowPoint.usable,
  lowPointWeek: run.forecast.lowPoint.weekStart,
  constraintVersion: run.constraintVersion,
});

describe("TL6 saved financial output", () => {
  it("returns the exact saved 26/13 chart, provenance, pointer and unknown runway", async () => {
    const t = setup();
    const { key, run } = await open(t);
    const result = await output(t, key);
    expect(result.chart.history).toEqual(run.baseline.history);
    expect(result.chart.forecast).toEqual(run.forecast);
    expect(result.chart.lowPoint).toEqual(run.forecast.lowPoint);
    expect(result.chart.runwayMonths).toBeNull();
    expect(result.receipts).toEqual(run.receipts);
    expect(result.health).toMatchObject({
      rating: "watch",
      reasonCodes: ["no_rules"],
      evaluatedRuleCount: 0,
      unknownRuleCount: 0,
    });
    expect(result).toMatchObject({
      seedId: run.baseline.seed.id,
      seedHash: run.baseline.seedHash,
      inputHash: run.inputHash,
      constraintVersion: run.constraintVersion,
      baselineRunId: run.baselineRunId,
      savedAt: run.savedAt,
    });
    expect(parseWeeklyResultRefJson(JSON.stringify(result.resultRef)).success).toBe(true);
    expect(result.resultRef.health?.lowPointCents).toBe(268_900_000);
    expect(result.scenarios).toEqual([]);
    expect(result.scenariosTruncated).toBe(false);
  });

  it.each([
    { limit: 1_000, rating: "ok", reasons: [] },
    { limit: 500_000_000, rating: "at_risk", reasons: ["rule_breach"] },
  ])("rates saved rule outcomes for $limit", async ({ limit, rating, reasons }) => {
    const t = setup();
    const { key } = await open(t, [cashRule(limit)]);
    const result = await output(t, key);
    expect(result.health).toMatchObject({
      rating,
      reasonCodes: reasons,
      evaluatedRuleCount: 1,
      unknownRuleCount: 0,
    });
  });

  it("negative usable cash is at risk even without stated rules", async () => {
    const t = setup();
    const { key } = await open(t);
    const runId = await spend(t, key.runId, 300_000_000);
    const result = await output(t, { ...key, runId });
    expect(result.chart.lowPoint.usable).toBeLessThan(0);
    expect(result.health.rating).toBe("at_risk");
    expect(result.health.reasonCodes).toEqual(["negative_usable_cash", "no_rules"]);
  });

  it("outside-horizon and unable rules stay unknown rather than pass", async () => {
    const t = setup();
    const { key } = await open(t, [
      {
        id: "late_bill",
        label: "Pay cloud bill by deadline",
        kind: "pay_by_date",
        billId: "bill_cloud_q1",
        limit: 100,
        evidence,
      },
    ]);
    const outside = await output(t, key);
    expect(outside.health).toMatchObject({
      rating: "watch",
      reasonCodes: ["unknown_rules"],
      evaluatedRuleCount: 0,
      unknownRuleCount: 1,
    });
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("timelineRuns")
        .withIndex("by_company_and_runId", (q) =>
          q.eq("companyId", key.companyId).eq("runId", key.runId),
        )
        .unique();
      if (!row) throw new Error("Missing row");
      const receipts = structuredClone(row.receipts) as WorkspaceRun["receipts"];
      first(receipts).status = "unable";
      first(receipts).relation = "unable";
      await ctx.db.patch(row._id, { receipts });
    });
    expect((await output(t, key)).health).toEqual(outside.health);
  });

  it("keeps fractional runway limits and every child receipt exactly, without inventing runway", async () => {
    const t = setup();
    const { key } = await open(t, [
      { id: "runway", label: "Keep 4.5 months", kind: "min_runway_months", limit: 4.5, evidence },
    ]);
    const childId = await spend(t, key.runId);
    const child = await t.query(workspaceRefs.get, { ...key, runId: childId });
    const result = await output(t, key);
    expect(first(result.scenarios).receipts).toEqual(child?.receipts);
    expect(first(first(result.scenarios).receipts).limit).toBe(4.5);
    expect(result.chart.runwayMonths).toBeNull();
  });

  it("exports only direct saved scenarios, excluding nested scenarios, rule edits and siblings", async () => {
    const t = setup();
    const { key } = await open(t);
    const first = await spend(t, key.runId);
    const grandchild = await spend(t, first);
    const rules = await t.mutation(workspaceRefs.reviseConstraints, {
      companyId: key.companyId,
      parentRunId: key.runId,
      requestId: "tl6-rule-child",
      constraintsJson: JSON.stringify([cashRule(10)]),
      note: "New rule",
      reviewed: true,
    });
    await spend(t, rules.runId);
    const second = await spend(t, key.runId);
    const result = await output(t, key);
    expect(result.scenarios.map((s) => s.runId)).toEqual([first, second]);
    expect((await output(t, { ...key, runId: first })).scenarios.map((s) => s.runId)).toEqual([
      grandchild,
    ]);
    for (const scenario of result.scenarios) {
      const saved = await t.query(workspaceRefs.get, { ...key, runId: scenario.runId });
      expect(scenario.forecast).toEqual(saved?.forecast);
    }
  });

  it("caps children at 20 and conservatively signals the existing 100-row graph cap", async () => {
    const t = setup();
    const { key, run } = await open(t);
    const children = Array.from(
      { length: 21 },
      (_, i): WorkspaceRun => ({
        ...structuredClone(run),
        runId: `timeline:workspace/child-${i}`,
        parentRunId: run.runId,
        kind: "scenario",
      }),
    );
    const load = vi.fn(async (runId: string) => children.find((c) => c.runId === runId) ?? null);
    const result = await projectOutput(run, children.map(entryFor), key, load);
    expect(result.scenarios).toHaveLength(20);
    expect(load).toHaveBeenCalledTimes(20);
    expect(result.scenariosTruncated).toBe(true);
    const graph = Array.from({ length: 100 }, (_, i) => ({
      ...entryFor(run),
      runId: `timeline:workspace/rule-${i}`,
      kind: "rules" as const,
      parentRunId: run.runId,
    }));
    load.mockClear();
    expect((await projectOutput(run, graph, key, load)).scenariosTruncated).toBe(true);
    expect(load).not.toHaveBeenCalled();
  });

  it("repeated reads call neither engine nor provider and do not write", async () => {
    const t = setup();
    const { key } = await open(t, [cashRule(1000)]);
    await spend(t, key.runId);
    const before = await t.run(async (ctx) => ({
      runs: await ctx.db.query("timelineRuns").collect(),
      requests: await ctx.db.query("timelineRunRequests").collect(),
      baselines: await ctx.db.query("timelineBaselines").collect(),
    }));
    const spies = [
      vi.spyOn(engine, "forecast"),
      vi.spyOn(engine, "dominoes"),
      vi.spyOn(engine, "history"),
      vi.spyOn(engine, "scanRisks"),
      vi.spyOn(engine, "stressTest"),
      vi.spyOn(globalThis, "fetch"),
    ];
    const first = await t.action(ref, key);
    expect(await t.action(ref, key)).toBe(first);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    const after = await t.run(async (ctx) => ({
      runs: await ctx.db.query("timelineRuns").collect(),
      requests: await ctx.db.query("timelineRunRequests").collect(),
      baselines: await ctx.db.query("timelineBaselines").collect(),
    }));
    expect(after).toEqual(before);
  });

  it("bounds UTF-8 bytes with a deterministic child prefix, including multibyte evidence", async () => {
    const t = setup();
    const { key, run } = await open(t, [cashRule(1000)]);
    const children = Array.from({ length: 20 }, (_, i): WorkspaceRun => {
      const child = structuredClone(run);
      child.runId = `timeline:workspace/unicode-${i}`;
      child.parentRunId = run.runId;
      child.kind = "scenario";
      first(child.receipts).evidence = Array.from({ length: 64 }, () => "界".repeat(1000));
      return child;
    });
    const result = await projectOutput(
      run,
      children.map(entryFor),
      key,
      async (id) => children.find((c) => c.runId === id) ?? null,
    );
    expect(result.scenarios).toHaveLength(4);
    expect(result.scenariosTruncated).toBe(true);
    expect(result.scenarios.map((s) => s.runId)).toEqual(children.slice(0, 4).map((s) => s.runId));
    expect(jsonBytes(result)).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
    expect(parseFinancialOutputJson(canonicalJson(result)).success).toBe(true);
    expect(new TextEncoder().encode(canonicalJson(result)).byteLength).toBeGreaterThan(
      canonicalJson(result).length * 2,
    );
    expect(
      parseFinancialOutputJson(`${" ".repeat(MAX_OUTPUT_BYTES)}${canonicalJson(result)}`).success,
    ).toBe(false);
  });

  it("clearly refuses an oversized selected result instead of dropping its rule proof", async () => {
    const t = setup();
    const { key, run } = await open(t, [cashRule(1000), { ...cashRule(2000), id: "second_cash" }]);
    for (const receipt of run.receipts)
      receipt.evidence = Array.from({ length: 64 }, () => "界".repeat(4000));
    await expect(projectOutput(run, [], key, async () => null)).rejects.toThrow("OUTPUT_TOO_LARGE");
  });

  it("returns null for another company/missing run and rejects malformed identifiers", async () => {
    const t = setup();
    const { key } = await open(t);
    expect(await t.action(ref, { ...key, companyId: "other" })).toBeNull();
    expect(await t.action(ref, { ...key, runId: "timeline:workspace/missing" })).toBeNull();
    await expect(t.action(ref, { ...key, runId: "not-a-domain-id" })).rejects.toThrow(
      "INVALID_INPUT",
    );
    await expect(t.action(ref, { ...key, companyId: " " })).rejects.toThrow("INVALID_INPUT");
  });

  it.each(["company", "baseline", "parent", "seed", "missing", "catalog_money"])(
    "rejects child/catalog scope corruption: %s",
    async (kind) => {
      const t = setup();
      const { key, run } = await open(t);
      const childId = await spend(t, key.runId);
      const child = await t.query(workspaceRefs.get, { ...key, runId: childId });
      if (!child) throw new Error("Missing child");
      const entry = entryFor(child);
      const bad = structuredClone(child);
      if (kind === "company") bad.companyId = "other";
      if (kind === "baseline") bad.baselineRunId = "timeline:baseline/other";
      if (kind === "parent") bad.parentRunId = "timeline:workspace/other";
      if (kind === "seed") bad.baseline.seedHash = "0".repeat(64);
      if (kind === "catalog_money") entry.lowPointCents = Number.MAX_SAFE_INTEGER + 1;
      await expect(
        projectOutput(run, [entry], key, async () => (kind === "missing" ? null : bad)),
      ).rejects.toThrow("INTEGRITY");
    },
  );

  it("rejects unsafe/unknown financial payloads, forged pointers and invalid horizons", async () => {
    const t = setup();
    const { key } = await open(t);
    const result = await output(t, key);
    const mutations = [
      (x: typeof result) => {
        first(x.chart.forecast.weeks).usable = Number.MAX_SAFE_INTEGER + 1;
      },
      (x: typeof result) => {
        first(x.chart.history).closing = 1.5;
      },
      (x: typeof result) => {
        Object.assign(first(x.chart.forecast.weeks), { hidden: 1 });
      },
      (x: typeof result) => {
        x.resultRef.seedHash = "0".repeat(64);
      },
      (x: typeof result) => {
        x.chart.lowPoint.usable += 1;
      },
      (x: typeof result) => {
        first(x.chart.forecast.weeks).weekStart = "2026-11-03";
      },
      (x: typeof result) => {
        first(x.chart.history).weekStart = "2026-02-30";
      },
      (x: typeof result) => {
        x.health.rating = "ok";
        x.resultRef.health = {
          rating: "ok",
          lowPointCents: x.chart.lowPoint.usable,
          lowPointWeek: x.chart.lowPoint.weekStart,
        };
      },
      (x: typeof result) => {
        x.chart.history = [];
      },
    ];
    for (const mutate of mutations) {
      const bad = structuredClone(result);
      mutate(bad);
      expect(parseFinancialOutputJson(JSON.stringify(bad)).success).toBe(false);
    }
    expect(parseFinancialOutputJson("{").success).toBe(false);
    expect(parseFinancialOutputJson(null).success).toBe(false);
  });
});
