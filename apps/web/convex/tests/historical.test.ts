/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { hashInput } from "../../../../packages/agents/src/hash";
import { api } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob(["../**/*.ts", "../_generated/*.js", "!./**"]);
const h = api.historical;
const caseId = "twou-2023-cash-v1";
const LATER = ["S8", "H01", "H03", "D01", "2024-02-12"];

const setup = () => convexTest(schema, modules);
const baseline = (t: ReturnType<typeof setup>, requestId = "req-base-1") =>
  t.mutation(h.saveBaseline, { requestId, caseId });

describe("historical persistence (2U)", () => {
  it("cutoff view hides every later source, fact, value and date", async () => {
    const t = setup();
    const view = await t.query(h.getCase, { caseId });
    const json = JSON.stringify(view);
    for (const s of LATER) expect(json).not.toContain(s);
    expect(view.case.sources.map((s: { id: string }) => s.id)).toEqual(["S7"]);
    expect(view.riskRules).toEqual([]);
    await expect(t.query(h.getCase, { caseId: "nope" })).rejects.toThrow(/Unknown case/);
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
      t.mutation(h.computeAlternative, { requestId: "req-base-1", baselineRunId: runId }),
    ).rejects.toThrow(/CONFLICT|different request/);
    await expect(t.mutation(h.saveBaseline, { requestId: "x", caseId })).rejects.toThrow(
      /requestId/,
    );
    await expect(
      t.mutation(h.reveal, { requestId: "req-rev-1", runId: "missing" }),
    ).rejects.toThrow(/Unknown run/);
    await t.mutation(h.reveal, { requestId: "req-rev-1", runId });
    const other = await baseline(t, "req-base-2");
    await expect(
      t.mutation(h.reveal, { requestId: "req-rev-1", runId: other.runId }),
    ).rejects.toThrow(/different request/);
  });

  it("reveal stores actual-minus-forecast once and never rewrites the run", async () => {
    const t = setup();
    const { runId, run } = await baseline(t);
    expect(await t.query(h.getReveal, { runId })).toBeNull();
    const [r1, r2] = await Promise.all([
      t.mutation(h.reveal, { requestId: "req-rev-1", runId }),
      t.mutation(h.reveal, { requestId: "req-rev-1", runId }),
    ]);
    expect(r1).toEqual(r2);
    expect(await t.mutation(h.reveal, { requestId: "req-rev-2", runId })).toEqual(r1);
    const scored = r1.comparisons.filter((c: { status: string }) => c.status === "scored");
    expect(scored.map((c: { errorCents: number }) => c.errorCents)).toEqual([
      3_758_000_000, 3_758_000_000,
    ]);
    expect(await t.run((ctx) => ctx.db.query("historicalReveals").collect())).toHaveLength(1);
    const after = await t.query(h.getCase, { caseId, runId });
    expect(after.revealed).toBe(true);
    expect(after.case.sources.map((s: { id: string }) => s.id)).toEqual(["S7", "S8"]);
    const rows = await t.run((ctx) => ctx.db.query("historicalRuns").collect());
    expect(rows[0]!.run).toEqual(run);
  });

  it("computes a cost-only, post-hoc alternative tied to a baseline", async () => {
    const t = setup();
    const { runId, run: base } = await baseline(t);
    const alt = await t.mutation(h.computeAlternative, {
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
      await t.mutation(h.computeAlternative, { requestId: "req-alt-1", baselineRunId: runId }),
    ).toEqual(alt);
    await expect(
      t.mutation(h.computeAlternative, { requestId: "req-alt-2", baselineRunId: alt.runId }),
    ).rejects.toThrow(/baseline run/);
    await expect(
      t.mutation(h.reveal, { requestId: "req-rev-9", runId: alt.runId }),
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
    await expect(t.mutation(h.reveal, { requestId: "req-rev-1", runId })).rejects.toThrow(
      /integrity/,
    );
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("historicalRuns").first())!;
      const snapshot = structuredClone(row.snapshot);
      snapshot.facts[0].cents += 1;
      await ctx.db.patch(row._id, { snapshot });
    });
    await expect(t.query(h.getReveal, { runId })).rejects.toThrow(/integrity/);
  });

  it("getRun recovers the stored summary and checks the case/run association", async () => {
    const t = setup();
    const first = await baseline(t);
    const alt = await t.mutation(h.computeAlternative, {
      requestId: "req-alt-1",
      baselineRunId: first.runId,
    });
    expect(await t.query(h.getRun, { caseId, runId: first.runId })).toEqual(first);
    expect(await t.query(h.getRun, { caseId, runId: alt.runId })).toEqual(alt);
    expect(JSON.stringify(await t.query(h.getRun, { caseId, runId: first.runId }))).not.toMatch(
      /S8|H0\d|D0\d/,
    );
    await expect(t.query(h.getRun, { caseId: "nope", runId: first.runId })).rejects.toThrow(
      /Unknown run/,
    );
    await expect(t.query(h.getRun, { caseId, runId: "missing" })).rejects.toThrow(/Unknown run/);
    // Row says another case: hidden from this case, and an integrity failure by run ID alone.
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("historicalRuns").first())!;
      await ctx.db.patch(row._id, { caseId: "other-case" });
    });
    await expect(t.query(h.getRun, { caseId, runId: first.runId })).rejects.toThrow(/Unknown run/);
    await expect(t.query(h.getReveal, { runId: first.runId })).rejects.toThrow(/integrity/);
    await expect(t.query(h.getRun, { caseId, runId: alt.runId })).rejects.toThrow(/integrity/);
  });

  it("an alternative row pointing at another baseline fails integrity", async () => {
    const t = setup();
    const a = await baseline(t);
    const b = await baseline(t, "req-base-2");
    const alt = await t.mutation(h.computeAlternative, {
      requestId: "req-alt-1",
      baselineRunId: a.runId,
    });
    await t.run(async (ctx) => {
      const row = (await ctx.db
        .query("historicalRuns")
        .withIndex("by_runId", (q) => q.eq("runId", alt.runId))
        .unique())!;
      await ctx.db.patch(row._id, { baselineRunId: b.runId });
    });
    await expect(t.query(h.getRun, { caseId, runId: alt.runId })).rejects.toThrow(/integrity/);
  });

  it("a valid earlier snapshot stays readable, retryable and revealable", async () => {
    const t = setup();
    const first = await baseline(t);
    const alt = await t.mutation(h.computeAlternative, {
      requestId: "req-alt-1",
      baselineRunId: first.runId,
    });
    // Fixture: the same run saved when S7 had another title. Hashes are recomputed, so it is
    // valid on its own terms but differs from today's case.
    const old = await t.run(async (ctx) => {
      const row = (await ctx.db
        .query("historicalRuns")
        .withIndex("by_runId", (q) => q.eq("runId", first.runId))
        .unique())!;
      const snapshot = structuredClone(row.snapshot);
      snapshot.sources[0].title = "2U Q3 2023 results (earlier title)";
      const run = { ...row.run, inputHash: await hashInput(snapshot) };
      const summary = { ...row.summary, run };
      await ctx.db.patch(row._id, {
        snapshot,
        run,
        summary,
        rowHash: await hashInput({ run, snapshot, summary }),
      });
      return summary;
    });
    expect(old.run.inputHash).not.toBe(first.run.inputHash);
    expect(await t.query(h.getRun, { caseId, runId: first.runId })).toEqual(old);
    expect(await baseline(t)).toEqual(old);
    expect((await t.query(h.getCase, { caseId, runId: first.runId })).revealed).toBe(false);
    // Saved alternative retries still return; a new one refuses the drifted baseline.
    expect(
      await t.mutation(h.computeAlternative, {
        requestId: "req-alt-1",
        baselineRunId: first.runId,
      }),
    ).toEqual(alt);
    await expect(
      t.mutation(h.computeAlternative, { requestId: "req-alt-2", baselineRunId: first.runId }),
    ).rejects.toThrow(/CASE_CHANGED|case changed/);
    const r = await t.mutation(h.reveal, { requestId: "req-rev-1", runId: first.runId });
    const scored = r.comparisons.filter((c: { status: string }) => c.status === "scored");
    expect(scored.map((c: { predictedCents: number }) => c.predictedCents)).toEqual(
      old.run.predictions
        .filter((p: { id: string }) =>
          scored.some((c: { predictionId: string }) => c.predictionId === p.id),
        )
        .map((p: { cents: number }) => p.cents),
    );
    expect(await t.query(h.getReveal, { runId: first.runId })).toEqual(r);
    expect(await t.query(h.getRun, { caseId, runId: first.runId })).toEqual(old);
  });

  it("reveal keys stay bound to their first run, including repeat keys", async () => {
    const t = setup();
    const a = await baseline(t);
    const b = await baseline(t, "req-base-2");
    const ra = await t.mutation(h.reveal, { requestId: "key-one-1", runId: a.runId });
    expect(await t.mutation(h.reveal, { requestId: "key-two-2", runId: a.runId })).toEqual(ra);
    await expect(t.mutation(h.reveal, { requestId: "key-two-2", runId: b.runId })).rejects.toThrow(
      /different request/,
    );
    await expect(t.mutation(h.reveal, { requestId: "key-one-1", runId: b.runId })).rejects.toThrow(
      /different request/,
    );
    // Concurrent new keys on one run: one reveal record, every key bound to that run.
    const [c1, c2] = await Promise.all([
      t.mutation(h.reveal, { requestId: "key-con-3", runId: a.runId }),
      t.mutation(h.reveal, { requestId: "key-con-4", runId: a.runId }),
    ]);
    expect(c1).toEqual(ra);
    expect(c2).toEqual(ra);
    await expect(t.mutation(h.reveal, { requestId: "key-con-4", runId: b.runId })).rejects.toThrow(
      /different request/,
    );
    const rb = await t.mutation(h.reveal, { requestId: "key-new-5", runId: b.runId });
    expect(rb.runId).toBe(b.runId);
    // A rejected key never earns a receipt; the failed alternative-run reveal binds nothing.
    const receipts = await t.run((ctx) => ctx.db.query("historicalRevealReceipts").collect());
    expect(receipts.map((x) => [x.requestId, x.runId]).sort()).toEqual(
      [
        ["key-con-3", a.runId],
        ["key-con-4", a.runId],
        ["key-new-5", b.runId],
        ["key-one-1", a.runId],
        ["key-two-2", a.runId],
      ].sort(),
    );
    expect(await t.run((ctx) => ctx.db.query("historicalReveals").collect())).toHaveLength(2);
  });

  it("serves the evidence view frozen at reveal, not today's case", async () => {
    const t = setup();
    const { runId } = await baseline(t);
    const r = await t.mutation(h.reveal, { requestId: "req-rev-1", runId });
    const cmp = r.comparisons.find((c: { status: string }) => c.status === "scored") as {
      observationFactId: string;
      observedCents: number;
    };
    const before = await t.query(h.getCase, { caseId, runId });
    const fact = before.case.facts.find((f) => f.id === cmp.observationFactId)!;
    expect(fact.cents).toBe(cmp.observedCents);
    // Fixture: a reveal frozen when S8 reported 1 cent more than today's case says.
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("historicalReveals").first())!;
      const view = structuredClone(row.view);
      const comparisons = structuredClone(row.comparisons);
      for (const f of view.facts) if (f.id === cmp.observationFactId) f.cents += 1;
      for (const c of comparisons)
        if (c.observationFactId === cmp.observationFactId) {
          c.observedCents += 1;
          c.errorCents += 1;
          c.absErrorCents = Math.abs(c.errorCents);
        }
      const fields = { ...row, view, comparisons };
      await ctx.db.patch(row._id, {
        view,
        comparisons,
        revealHash: await hashInput({
          runId: fields.runId,
          revealedThrough: fields.revealedThrough,
          revealedAt: fields.revealedAt,
          comparisons,
          view,
        }),
      });
    });
    const after = await t.query(h.getCase, { caseId, runId });
    const frozen = after.case.facts.find((f) => f.id === cmp.observationFactId)!;
    expect(frozen.cents).toBe(cmp.observedCents + 1);
    const saved = await t.query(h.getReveal, { runId });
    const again = await t.mutation(h.reveal, { requestId: "req-rev-2", runId });
    expect(again).toEqual(saved);
    expect(
      saved!.comparisons.find(
        (c: { observationFactId?: string }) => c.observationFactId === cmp.observationFactId,
      ).observedCents,
    ).toBe(frozen.cents);
    // Editing the frozen record without its hash fails closed.
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("historicalReveals").first())!;
      const view = structuredClone(row.view);
      view.facts[0].cents += 1;
      await ctx.db.patch(row._id, { view });
    });
    await expect(t.query(h.getCase, { caseId, runId })).rejects.toThrow(/integrity/);
    await expect(t.query(h.getReveal, { runId })).rejects.toThrow(/integrity/);
  });

  it("pre-reveal run views stay cutoff-filtered", async () => {
    const t = setup();
    const { runId } = await baseline(t);
    const view = await t.query(h.getCase, { caseId, runId });
    expect(view.revealed).toBe(false);
    for (const s of LATER) expect(JSON.stringify(view)).not.toContain(s);
  });
});
