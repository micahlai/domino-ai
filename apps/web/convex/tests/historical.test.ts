/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import { describe, expect, it } from "vitest";
import schema from "../schema";

const modules = import.meta.glob(["../**/*.ts", "../_generated/*.js", "!./**"]);
// ponytail: anyApi until `convex codegen` runs against a configured deployment (C0-owned).
const h = anyApi.historical!;
const caseId = "twou-2023-cash-v1";
const LATER = ["S8", "H01", "H03", "D01", "2024-02-12"];

const setup = () => convexTest(schema, modules);
const baseline = (t: ReturnType<typeof setup>, requestId = "req-base-1") =>
  t.mutation(h.saveBaseline!, { requestId, caseId });

describe("historical persistence (2U)", () => {
  it("cutoff view hides every later source, fact, value and date", async () => {
    const t = setup();
    const view = await t.query(h.getCase!, { caseId });
    const json = JSON.stringify(view);
    for (const s of LATER) expect(json).not.toContain(s);
    expect(view.case.sources.map((s: { id: string }) => s.id)).toEqual(["S7"]);
    expect(view.riskRules).toEqual([]);
    await expect(t.query(h.getCase!, { caseId: "nope" })).rejects.toThrow(/Unknown case/);
  });

  it("saves a server-computed baseline with a frozen snapshot, idempotent on requestId", async () => {
    const t = setup();
    const first = await baseline(t);
    const run = first.run;
    expect(run.method).toEqual({ id: "quarterly_cash_bridge", version: "0.1.0" });
    expect(run.inputs.sourceIds).toEqual(["S7"]);
    expect(run.inputs.assumptionIds).toEqual(["AS-FIN0", "AS-FX0", "AS-RESTRICTED"]);
    expect(run.knowledgeCutoff).not.toBe(run.createdAt);
    const target = run.predictions.find((p: { id: string }) => p.id === "target_total") as {
      cents: number;
    };
    expect(target.cents).toBe(3_581_900_000);
    expect(JSON.stringify(first)).not.toMatch(/S8|H0\d|D0\d/);
    expect(await baseline(t)).toEqual(first);
    const [a, b] = await Promise.all([baseline(t, "req-same-xx"), baseline(t, "req-same-xx")]);
    expect(a).toEqual(b);
    const rows = await t.run((ctx) => ctx.db.query("historicalRuns").collect());
    expect(rows).toHaveLength(2);
    // Same inputs, different request: new append-only run with the same input hash.
    expect(a.run.inputHash).toBe(run.inputHash);
    expect(a.runId).not.toBe(first.runId);
  });

  it("rejects conflicting retries and bad IDs", async () => {
    const t = setup();
    const { runId } = await baseline(t);
    await expect(
      t.mutation(h.computeAlternative!, { requestId: "req-base-1", baselineRunId: runId }),
    ).rejects.toThrow(/CONFLICT|different request/);
    await expect(t.mutation(h.saveBaseline!, { requestId: "x", caseId })).rejects.toThrow(
      /requestId/,
    );
    await expect(
      t.mutation(h.reveal!, { requestId: "req-rev-1", runId: "missing" }),
    ).rejects.toThrow(/Unknown run/);
    await t.mutation(h.reveal!, { requestId: "req-rev-1", runId });
    const other = await baseline(t, "req-base-2");
    await expect(
      t.mutation(h.reveal!, { requestId: "req-rev-1", runId: other.runId }),
    ).rejects.toThrow(/different request/);
  });

  it("reveal stores actual-minus-forecast once and never rewrites the run", async () => {
    const t = setup();
    const { runId, run } = await baseline(t);
    expect(await t.query(h.getReveal!, { runId })).toBeNull();
    const [r1, r2] = await Promise.all([
      t.mutation(h.reveal!, { requestId: "req-rev-1", runId }),
      t.mutation(h.reveal!, { requestId: "req-rev-1", runId }),
    ]);
    expect(r1).toEqual(r2);
    expect(await t.mutation(h.reveal!, { requestId: "req-rev-2", runId })).toEqual(r1);
    const scored = r1.comparisons.filter((c: { status: string }) => c.status === "scored");
    expect(scored.map((c: { errorCents: number }) => c.errorCents)).toEqual([
      3_758_000_000, 3_758_000_000,
    ]);
    expect(await t.run((ctx) => ctx.db.query("historicalReveals").collect())).toHaveLength(1);
    const after = await t.query(h.getCase!, { caseId, runId });
    expect(after.revealed).toBe(true);
    expect(after.case.sources.map((s: { id: string }) => s.id)).toEqual(["S7", "S8"]);
    const rows = await t.run((ctx) => ctx.db.query("historicalRuns").collect());
    expect(rows[0]!.run).toEqual(run);
  });

  it("computes a cost-only, post-hoc alternative tied to a baseline", async () => {
    const t = setup();
    const { runId, run: base } = await baseline(t);
    const alt = await t.mutation(h.computeAlternative!, {
      requestId: "req-alt-1",
      baselineRunId: runId,
    });
    expect(alt.run.branch).toEqual({
      kind: "alternative",
      baselineRunId: runId,
      decisionAssumptionIds: ["A1"],
      postHoc: true,
    });
    expect(alt.run.inputs.assumptionIds).not.toContain("A1-DOWNSIDE");
    expect(alt.caveats[0]).toMatch(/A1-DOWNSIDE/);
    expect(alt.costRelativeToBaseline).toEqual({
      low: -715_000_000,
      point: -426_250_000,
      high: -137_500_000,
    });
    expect(alt.benefit).toMatchObject({ daysInWindow: 0, afterTarget: "unknown" });
    expect(alt.run.predictions.slice(0, 2)).toEqual(base.predictions.slice(0, 2));
    expect(
      await t.mutation(h.computeAlternative!, { requestId: "req-alt-1", baselineRunId: runId }),
    ).toEqual(alt);
    await expect(
      t.mutation(h.computeAlternative!, { requestId: "req-alt-2", baselineRunId: alt.runId }),
    ).rejects.toThrow(/baseline run/);
    await expect(
      t.mutation(h.reveal!, { requestId: "req-rev-9", runId: alt.runId }),
    ).rejects.toThrow(/Only a baseline/);
  });

  it("detects tampering with a stored run", async () => {
    const t = setup();
    const { runId } = await baseline(t);
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("historicalRuns").first())!;
      const run = structuredClone(row.run);
      run.predictions[2].cents += 1;
      await ctx.db.patch(row._id, { run });
    });
    await expect(t.mutation(h.reveal!, { requestId: "req-rev-1", runId })).rejects.toThrow(
      /integrity/,
    );
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("historicalRuns").first())!;
      const snapshot = structuredClone(row.snapshot);
      snapshot.facts[0].cents += 1;
      await ctx.db.patch(row._id, { snapshot });
    });
    await expect(t.query(h.getReveal!, { runId })).rejects.toThrow(/integrity/);
  });
});
