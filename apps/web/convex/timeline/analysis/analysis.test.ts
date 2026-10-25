/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import {
  type Change,
  type CompanyModel,
  type Constraint,
  WeeklySeedV1Schema,
  contentHashPreimage,
} from "@domino/contracts";
import { weeklyBoundaryFixtures } from "@domino/contracts/fixtures";
import { engine } from "@domino/engine";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import { baselineRefs } from "../refs";
import { workspaceRefs } from "../workspaceRefs";
import { candidates, checkSource, projectRisk, resilience, responsesFor } from "./compute";
import { ANALYSIS_METHOD, LEASE_MS, exactReceipt } from "./receipt";
import { analysisRefs as a } from "./refs";
const modules = Object.fromEntries(
  Object.entries(
    import.meta.glob(["../../**/*.ts", "../../_generated/*.js", "!../../**/*.test.ts"]),
  ).map(([p, f]) => [
    p.startsWith("../../")
      ? p
      : p.startsWith("../")
        ? `../../timeline/${p.slice(3)}`
        : `../../timeline/analysis/${p.slice(2)}`,
    f,
  ]),
);
const setup = () => convexTest(schema, modules);
type T = ReturnType<typeof setup>;
const seed = WeeklySeedV1Schema.parse(weeklyBoundaryFixtures.validKestrelWeeklySeed);
const model: CompanyModel = { version: 0, customerDelayDays: {}, recurringSpend: [], rules: [] };
const min = (limit: number): Constraint => ({
  id: "analysis_cash",
  kind: "min_cash",
  label: "Keep cash above the limit",
  limit,
  evidence: { source: "document", ref: "analysis-test", note: "User-defined weekly cash floor" },
});
const runway: Constraint = {
  id: "analysis_runway",
  kind: "min_runway_months",
  label: "Keep runway",
  limit: 4.5,
  evidence: { source: "document", ref: "analysis-test", note: "User-defined runway" },
};
async function root(t: T, rules: Constraint[] = [], customModel = model, customSeed = seed) {
  const base = await t.mutation(baselineRefs.save, {
    requestId: "analysis-baseline",
    seedJson: JSON.stringify(customSeed),
    modelJson: JSON.stringify(customModel),
    constraintsJson: JSON.stringify(rules),
    assumptionNote: "Frozen synthetic inputs for analysis",
    reviewed: true,
  });
  const opened = await t.mutation(workspaceRefs.open, {
    companyId: customSeed.company.id,
    baselineRunId: base.runId,
    requestId: "analysis-open",
  });
  const run = await t.query(workspaceRefs.get, {
    companyId: opened.companyId,
    runId: opened.runId,
  });
  if (!run) throw new Error("Missing run");
  return run;
}
const launch = (t: T, runId: string, requestId = "analysis-test-request", companyId = "kestrel") =>
  t
    .mutation(a.start, { companyId, runId, requestId, reviewed: true })
    .then(({ companyId, analysisId }) => ({ companyId, analysisId }));
const execute = async (t: T, key: { companyId: string; analysisId: string }) => {
  await t.action(a.execute, { companyId: key.companyId, analysisId: key.analysisId });
  const out = await t.query(a.get, { companyId: key.companyId, analysisId: key.analysisId });
  if (!out) throw new Error("Missing receipt");
  return out;
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("TL7 saved automatic analysis", () => {
  it("saves a full real engine journey, costed responses, exact-once children and frozen reads", async () => {
    vi.useFakeTimers();
    const t = setup();
    const run = await root(t, [min(270_000_000)]);
    const key = await launch(t, run.runId);
    expect((await t.query(a.get, key))?.status).toBe("queued");
    const receipt = await execute(t, key);
    expect(receipt.status, JSON.stringify(receipt)).toBe("succeeded");
    expect(receipt.risks.length).toBeGreaterThan(0);
    expect(receipt.risks.length).toBeLessThanOrEqual(3);
    expect(receipt.risks.some((r) => r.failureReason?.includes("is breached"))).toBe(true);
    expect(receipt.responses.some((r) => r.clearsAllRules)).toBe(true);
    expect(receipt.responses.length).toBeGreaterThan(0);
    expect(receipt.responses.length).toBeLessThanOrEqual(6);
    expect(receipt.resilience?.scope).toContain("not a probability");
    for (const risk of receipt.risks) {
      expect(risk.runId).not.toBeNull();
      expect(risk.probabilityBasis.length).toBeGreaterThan(0);
      const saved = await t.query(workspaceRefs.get, {
        companyId: run.companyId,
        runId: risk.runId ?? "",
      });
      expect(saved?.parentRunId).toBe(run.runId);
      expect(saved?.changes).toEqual(risk.changes);
      expect(saved?.constraints).toEqual(run.constraints);
      expect(saved?.forecast).toEqual(risk.forecast);
    }
    for (const response of receipt.responses) {
      const risk = receipt.risks.find((r) => r.id === response.riskId);
      if (!risk) throw new Error("Missing risk");
      const saved = await t.query(workspaceRefs.get, {
        companyId: run.companyId,
        runId: response.runId ?? "",
      });
      expect(saved?.parentRunId).toBe(risk.runId);
      expect(saved?.changes).toEqual([...risk.changes, ...response.changes]);
      expect(response.forecast).toEqual(
        engine.forecast(seed.snapshot, model, [...risk.changes, ...response.changes]),
      );
      expect(response.gainCents).toBe(
        response.forecast.lowPoint.usable - risk.forecast.lowPoint.usable,
      );
      expect(response.costNote).toMatch(/2%|14-day/);
      expect(response.changes.every((c) => c.kind !== "add_cash")).toBe(true);
    }
    const before = await t.run((ctx) => ctx.db.query("timelineRuns").collect());
    const f = vi.spyOn(engine, "forecast");
    const s = vi.spyOn(engine, "stressTest");
    const provider = vi.spyOn(globalThis, "fetch");
    await t.action(a.execute, { companyId: key.companyId, analysisId: key.analysisId });
    expect(await launch(t, run.runId)).toEqual(key);
    expect(await t.query(a.get, key)).toEqual(receipt);
    expect((await t.query(a.list, { companyId: run.companyId, runId: run.runId }))[0]).toEqual(
      receipt,
    );
    expect(await t.run((ctx) => ctx.db.query("timelineRuns").collect())).toEqual(before);
    expect(f).not.toHaveBeenCalled();
    expect(s).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });
  it("requires review, scopes company and binds launch keys across runs and operation", async () => {
    vi.useFakeTimers();
    const t = setup();
    const run = await root(t);
    await expect(
      t.mutation(a.start, {
        companyId: "kestrel",
        runId: run.runId,
        requestId: "analysis-request",
        reviewed: false,
      }),
    ).rejects.toThrow(/REVIEW_REQUIRED/);
    await expect(launch(t, run.runId, "analysis-request", "other")).rejects.toThrow(
      /RUN_NOT_FOUND/,
    );
    const key = await launch(t, run.runId, "analysis-request");
    expect(await t.query(a.get, { ...key, companyId: "other" })).toBeNull();
    expect(await t.query(a.list, { companyId: "other", runId: run.runId })).toEqual([]);
    const child = await t.mutation(workspaceRefs.reviseConstraints, {
      companyId: "kestrel",
      parentRunId: run.runId,
      requestId: "analysis-edit-rules",
      constraintsJson: JSON.stringify([min(200_000_000)]),
      note: "New cash floor",
      reviewed: true,
    });
    await expect(launch(t, child.runId, "analysis-request")).rejects.toThrow(/REQUEST_CONFLICT/);
    await expect(launch(t, run.runId, "bad")).rejects.toThrow(/INVALID_REQUEST/);
    await expect(
      t.mutation(a.retry, { ...key, requestId: "analysis-retry", reviewed: true }),
    ).rejects.toThrow(/RETRY_UNAVAILABLE/);
  });
  it("rejects event ancestry rather than silently dropping changes", async () => {
    vi.useFakeTimers();
    const t = setup();
    const run = await root(t);
    const child = await t.mutation(workspaceRefs.simulate, {
      companyId: "kestrel",
      parentRunId: run.runId,
      requestId: "analysis-event",
      label: "Equipment",
      changesJson: JSON.stringify([
        { kind: "remove_cash", amount: 10000, date: "2026-11-17", label: "Equipment" },
      ]),
      reviewed: true,
    });
    await expect(launch(t, child.runId)).rejects.toThrow(/ANCESTORS_UNSUPPORTED/);
    const edited = await t.mutation(workspaceRefs.reviseConstraints, {
      companyId: "kestrel",
      parentRunId: child.runId,
      requestId: "analysis-event-rules",
      constraintsJson: JSON.stringify([min(1)]),
      note: "Rule",
      reviewed: true,
    });
    await expect(launch(t, edited.runId)).rejects.toThrow(/ANCESTORS_UNSUPPORTED/);
  });
  it("expires abandoned queued or running jobs and creates separate idempotent reviewed retries", async () => {
    vi.useFakeTimers();
    const t = setup();
    const run = await root(t);
    const key = await launch(t, run.runId);
    expect(await t.mutation(a.claim, key)).not.toBeNull();
    expect(await t.mutation(a.claim, key)).toBeNull();
    vi.setSystemTime(Date.now() + LEASE_MS + 1);
    await t.mutation(a.expire, key);
    const failed = await t.query(a.get, { companyId: key.companyId, analysisId: key.analysisId });
    expect(failed?.status).toBe("failed");
    expect(failed?.errorCode).toBe("LEASE_EXPIRED");
    await t.action(a.execute, { companyId: key.companyId, analysisId: key.analysisId });
    expect(await t.query(a.get, key)).toEqual(failed);
    await expect(
      t.mutation(a.retry, { ...key, requestId: "analysis-retry", reviewed: false }),
    ).rejects.toThrow(/REVIEW_REQUIRED/);
    const next = await t.mutation(a.retry, { ...key, requestId: "analysis-retry", reviewed: true });
    expect(next.analysisId).not.toBe(key.analysisId);
    expect(
      await t.mutation(a.retry, { ...key, requestId: "analysis-retry", reviewed: true }),
    ).toEqual({ ...next, created: false });
    await expect(launch(t, run.runId, "analysis-retry")).rejects.toThrow(/REQUEST_CONFLICT/);
    expect((await execute(t, next)).status).toBe("succeeded");
    expect(await t.query(a.get, key)).toEqual(failed);
  });
  it("expires before claim and refuses late stage workspace writes", async () => {
    vi.useFakeTimers();
    const t = setup();
    const run = await root(t);
    const key = await launch(t, run.runId);
    const risk = projectRisk(run, candidates(run).risks[0]!);
    vi.setSystemTime(Date.now() + LEASE_MS + 1);
    const stage = makeFunctionReference<
      "mutation",
      { companyId: string; analysisId: string; stageJson: string },
      boolean
    >("timeline/analysis:saveStage");
    expect(
      await t.mutation(stage, { ...key, stageJson: JSON.stringify({ kind: "risk", risk }) }),
    ).toBe(false);
    expect(await t.mutation(a.claim, key)).toBeNull();
    expect((await t.query(a.get, key))?.status).toBe("failed");
    expect(await t.run((ctx) => ctx.db.query("timelineRuns").collect())).toHaveLength(1);
  });
  it("persists progress as partial on expiry and prevents duplicate or altered stage delivery", async () => {
    vi.useFakeTimers();
    const t = setup();
    const run = await root(t);
    const key = await launch(t, run.runId);
    await t.mutation(a.claim, key);
    const risk = projectRisk(run, candidates(run).risks[0]!);
    const stage = makeFunctionReference<
      "mutation",
      { companyId: string; analysisId: string; stageJson: string },
      boolean
    >("timeline/analysis:saveStage");
    const payload = { ...key, stageJson: JSON.stringify({ kind: "risk", risk }) };
    expect(await t.mutation(stage, payload)).toBe(true);
    expect(await t.mutation(stage, payload)).toBe(true);
    await expect(
      t.mutation(stage, {
        ...key,
        stageJson: JSON.stringify({ kind: "risk", risk: { ...risk, label: "Changed risk" } }),
      }),
    ).rejects.toThrow(/STAGE_CONFLICT/);
    expect(await t.run((ctx) => ctx.db.query("timelineRuns").collect())).toHaveLength(2);
    vi.setSystemTime(Date.now() + LEASE_MS + 1);
    await t.mutation(a.expire, key);
    const out = await t.query(a.get, { companyId: key.companyId, analysisId: key.analysisId });
    expect(out?.status).toBe("partial");
    expect(out?.risks[0]?.runId).not.toBeNull();
    expect(out?.operation.outputRefs).toContain(out?.risks[0]?.runId);
  });
  it("fails closed on corrupted saved output and never recalculates to repair it", async () => {
    vi.useFakeTimers();
    const t = setup();
    const run = await root(t);
    const key = await launch(t, run.runId);
    const receipt = await execute(t, key);
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("timelineAnalyses").collect())[0]!;
      await ctx.db.patch(row._id, { data: { ...receipt, unexpected: "not accepted" } });
    });
    const spy = vi.spyOn(engine, "forecast");
    await expect(t.query(a.get, key)).rejects.toThrow(/INTEGRITY/);
    expect(spy).not.toHaveBeenCalled();
  });
  it("produces an explicit assumption fallback without altering a neutral model", async () => {
    const t = setup();
    const run = await root(t);
    const neutral = structuredClone(run);
    neutral.baseline.seed.snapshot.deals = [];
    neutral.baseline.seed.snapshot.cardTxns = [];
    const before = structuredClone(neutral.baseline.model);
    const generated = candidates(neutral);
    expect(generated.risks).toHaveLength(1);
    expect(generated.risks[0]?.probability).toBe(0.1);
    expect(generated.risks[0]?.changes[0]).toMatchObject({ kind: "delay_invoice", days: 14 });
    expect(generated.warnings.join(" ")).toMatch(/assumption/);
    expect(neutral.baseline.model).toEqual(before);
  });
  it("caps budgets before scan, validates effective dates and refuses unsafe money", async () => {
    const t = setup();
    const run = await root(t);
    const scan = vi.spyOn(engine, "scanRisks");
    const big = structuredClone(run);
    big.baseline.seed.snapshot.customers = Array.from({ length: 4001 }, (_, i) => ({
      id: `customer-${i}`,
      name: `Customer ${i}`,
      paymentTermsDays: 30,
    }));
    expect(() => checkSource(big)).toThrow(/BUDGET_EXCEEDED/);
    expect(scan).not.toHaveBeenCalled();
    const unsafe = structuredClone(run);
    unsafe.baseline.seed.snapshot.cashOnHand = Number.MAX_SAFE_INTEGER;
    expect(() => checkSource(unsafe)).toThrow(/UNSAFE_MONEY/);
    const invalid = {
      id: "invalid-risk",
      label: "Past spending",
      probability: 0.1,
      impactLowPoint: 1,
      changes: [
        { kind: "remove_cash", date: "2026-01-01", amount: 100, label: "Past" },
      ] as Change[],
      evidence: [{ source: "document" as const, ref: "test", note: "Assumption" }],
    };
    scan.mockReturnValue([invalid]);
    expect(candidates(run).risks).toHaveLength(0);
    expect(candidates(run).warnings.join(" ")).toContain("skipped");
  });
  it("discloses no-rule vacuous survival and keeps outside horizon rules unknown", async () => {
    const t = setup();
    const run = await root(t, [runway]);
    const summary = resilience(run, candidates(run).risks);
    expect(summary.scope).toContain("runway");
    expect(summary.scope).toContain("even when cash is negative");
    const outside: Constraint = {
      id: "outside-rule",
      label: "Future cloud deadline",
      kind: "pay_by_date",
      billId: "bill_cloud_q1",
      limit: 366,
      evidence: { source: "document", ref: "test", note: "Future deadline" },
    };
    const altered = { ...run, constraints: [outside] };
    const risk = projectRisk(altered, candidates(altered).risks[0]!);
    expect(risk.receipts[0]?.status).toBe("beyond_horizon");
    const responses = responsesFor(altered, risk);
    expect(responses.length).toBeGreaterThan(0);
    expect(responses.every((r) => !r.clearsAllRules)).toBe(true);
  });
  it("receipt parser refuses unsafe cents, dangling references and unbounded results", async () => {
    vi.useFakeTimers();
    const t = setup();
    const run = await root(t);
    const key = await launch(t, run.runId);
    const receipt = await execute(t, key);
    expect(exactReceipt(receipt).methodVersion).toBe(ANALYSIS_METHOD);
    const unsafe = structuredClone(receipt);
    unsafe.risks[0]!.forecast.lowPoint.usable = Number.MAX_SAFE_INTEGER + 1;
    expect(() => exactReceipt(unsafe)).toThrow(/Unsafe/);
    const dangling = structuredClone(receipt);
    dangling.responses[0]!.riskId = "missing-risk";
    expect(() => exactReceipt(dangling)).toThrow(/Invalid response/);
    expect(() =>
      exactReceipt({ ...receipt, risks: Array.from({ length: 4 }, () => receipt.risks[0]) }),
    ).toThrow();
  });
  it("keeps saved risk progress partial and withholds the index if response scoring fails", async () => {
    vi.useFakeTimers();
    const t = setup();
    const run = await root(t, [min(270_000_000)]);
    const key = await launch(t, run.runId);
    const score = engine.scoreFix;
    vi.spyOn(engine, "scoreFix").mockImplementationOnce((...args) => {
      const branch = score(...args);
      branch.forecast.weeks[0]!.usable += 1;
      return branch;
    });
    const out = await execute(t, key);
    expect(out.status).toBe("partial");
    expect(out.errorCode).toBe("STAGE_FAILED");
    expect(out.risks.length).toBeGreaterThan(0);
    expect(out.responses).toEqual([]);
    expect(out.resilience).toBeNull();
    expect(out.warnings.join(" ")).toContain("index is withheld");
  });
  it("rolls back an unverified scenario and fails rather than publishing a mismatched result", async () => {
    vi.useFakeTimers();
    const t = setup();
    const run = await root(t);
    const key = await launch(t, run.runId);
    const f = structuredClone(run.forecast);
    f.weeks[0]!.usable += 1;
    vi.spyOn(engine, "forecast").mockReturnValueOnce(f);
    const out = await execute(t, key);
    expect(out.status).toBe("failed");
    expect(out.errorCode).toBe("STAGE_FAILED");
    expect(out.risks).toEqual([]);
    expect(out.resilience).toBeNull();
    expect(await t.run((ctx) => ctx.db.query("timelineRuns").collect())).toHaveLength(1);
  });
  it("scheduled delivery finishes without page polling and never restarts after completion", async () => {
    vi.useFakeTimers();
    const t = setup();
    const run = await root(t);
    const key = await launch(t, run.runId);
    await vi.advanceTimersByTimeAsync(1);
    await t.finishInProgressScheduledFunctions();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const out = await t.query(a.get, key);
    expect(out?.status).toBe("succeeded");
    expect(out?.operation.status).toBe("succeeded");
    const spy = vi.spyOn(engine, "scanRisks");
    await t.action(a.execute, key);
    expect(spy).not.toHaveBeenCalled();
  });
  it("keeps identical request keys separate across real saved companies", async () => {
    vi.useFakeTimers();
    const t = setup();
    const first = await root(t);
    const other = structuredClone(seed);
    other.id = "field:weekly_seed/analysis-other";
    other.company = { id: "analysis-other", name: "Analysis Other" };
    other.snapshot.companyId = "analysis-other";
    other.scheduledItems = [];
    other.findings = [];
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(contentHashPreimage(other)),
    );
    other.contentHash = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const second = await root(t, [], model, other);
    const one = await launch(t, first.runId, "shared-analysis-key");
    const two = await launch(t, second.runId, "shared-analysis-key", second.companyId);
    expect(one.analysisId).not.toBe(two.analysisId);
    expect((await execute(t, two)).companyId).toBe(second.companyId);
    expect(
      await t.query(a.get, { companyId: first.companyId, analysisId: two.analysisId }),
    ).toBeNull();
  });
});
