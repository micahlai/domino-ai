/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { type Constraint, WeeklySeedV1Schema } from "@domino/contracts";
import { weeklyBoundaryFixtures } from "@domino/contracts/fixtures";
import { engine } from "@domino/engine";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";
import { readAnalysis, readOutput } from "../../components/timeline/analysis/api";
import { readRun } from "../../components/timeline/workspace/api";
import schema from "../schema";
import { analysisRefs } from "./analysis/refs";
import { parseFinancialOutputJson } from "./output/schema";
import { baselineRefs } from "./refs";
import { workspaceRefs } from "./workspaceRefs";

const modules = Object.fromEntries(
  Object.entries(
    import.meta.glob([
      "../**/*.ts",
      "../_generated/*.js",
      "!../**/*.test.ts",
      "!./*.test.ts",
      "!./*.test-support.ts",
    ]),
  ).map(([path, load]) => [path.replace(/^\.\//, "../timeline/"), load]),
);
const output = makeFunctionReference<"action", { companyId: string; runId: string }, string | null>(
  "timeline/output:get",
);
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("TL7 real risk/response receipts fit the screen and financial handoff, then quietly reopen", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const seed = WeeklySeedV1Schema.parse(weeklyBoundaryFixtures.validKestrelWeeklySeed);
  const model = { version: 0, customerDelayDays: {}, recurringSpend: [], rules: [] };
  const rules: Constraint[] = [
    {
      id: "acceptance_cash",
      kind: "min_cash",
      label: "Keep usable cash above $2,700,000",
      limit: 270_000_000,
      evidence: { source: "document", ref: "timeline:user/tl7", note: "Reviewed test assumption" },
    },
    {
      id: "acceptance_runway",
      kind: "min_runway_months",
      label: "Keep 4.5 months of cash",
      limit: 4.5,
      evidence: { source: "document", ref: "timeline:user/tl7", note: "Reviewed test assumption" },
    },
  ];
  const baseline = await t.mutation(baselineRefs.save, {
    requestId: "tl7-acceptance-baseline",
    seedJson: JSON.stringify(seed),
    modelJson: JSON.stringify(model),
    constraintsJson: JSON.stringify(rules),
    assumptionNote: "Labelled synthetic Kestrel fixture with reviewed neutral assumptions",
    reviewed: true,
  });
  const opened = await t.mutation(workspaceRefs.open, {
    companyId: seed.company.id,
    baselineRunId: baseline.runId,
    requestId: "tl7-acceptance-open",
  });
  const key = { companyId: seed.company.id, runId: opened.runId };
  const source = await t.query(workspaceRefs.get, key);
  if (!source) throw new Error("Missing source");
  const screenRun = readRun(source, key);
  if (screenRun.state !== "ready") throw new Error("Source does not fit screen");
  const args = { ...key, requestId: "tl7-acceptance-launch", reviewed: true };
  const launched = await t.mutation(analysisRefs.start, args);
  const analysisKey = { companyId: launched.companyId, analysisId: launched.analysisId };
  await t.action(analysisRefs.execute, analysisKey);
  const receipt = await t.query(analysisRefs.get, analysisKey);
  if (!receipt) throw new Error("Missing analysis");
  expect(receipt.status).toBe("succeeded");
  expect(receipt.risks.length).toBeGreaterThan(0);
  expect(receipt.responses.some((r) => r.clearsAllRules)).toBe(true);
  expect(
    receipt.risks.some((r) =>
      r.receipts.some((p) => p.constraintVersion !== receipt.constraintVersion),
    ),
  ).toBe(true);
  expect(
    readAnalysis(receipt, { ...key, analysisId: receipt.analysisId }, screenRun.value).state,
  ).toBe("ready");
  for (const response of receipt.responses) {
    const risk = receipt.risks.find((r) => r.id === response.riskId);
    if (!risk?.runId || !response.runId) throw new Error("Missing saved parent");
    const saved = await t.query(workspaceRefs.get, { ...key, runId: response.runId });
    expect(saved?.parentRunId).toBe(risk.runId);
    expect(saved?.changes).toEqual([...risk.changes, ...response.changes]);
    expect(saved?.forecast).toEqual(
      engine.forecast(seed.snapshot, model, [...risk.changes, ...response.changes]),
    );
    expect(saved?.constraints).toEqual(rules);
  }

  const spies = [
    vi.spyOn(engine, "forecast"),
    vi.spyOn(engine, "stressTest"),
    vi.spyOn(engine, "scanRisks"),
    vi.spyOn(globalThis, "fetch"),
  ];
  const text = await t.action(output, key);
  expect(readOutput(text, key)).toBe(text);
  const parsed = parseFinancialOutputJson(text);
  if (!parsed.success) throw new Error("Invalid handoff");
  expect(parsed.data.chart.forecast).toEqual(source.forecast);
  expect(parsed.data.chart.runwayMonths).toBeNull();
  expect(parsed.data.receipts).toEqual(source.receipts);
  expect(parsed.data.health.rating).toBe("at_risk");
  expect(parsed.data.scenarios.map((s) => s.runId)).toEqual(receipt.risks.map((r) => r.runId));
  expect(await t.action(output, key)).toBe(text);
  expect(await t.query(analysisRefs.get, analysisKey)).toEqual(receipt);
  expect(await t.query(analysisRefs.list, key)).toEqual([receipt]);
  expect(await t.mutation(analysisRefs.start, args)).toEqual({ ...launched, created: false });
  expect(await t.query(workspaceRefs.get, key)).toEqual(source);
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
});
