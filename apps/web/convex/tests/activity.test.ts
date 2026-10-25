/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { type ActivityEvent, ActivityEventSchema } from "@domino/contracts";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob(["../**/*.ts", "../_generated/*.js", "!./**"]);
const h = api.historical;
const caseId = "twou-2023-cash-v1";
const LATER = ["S8", "H01", "H03", "D01", "2024-02-12"];
const KEYS = ["id", "sequence", "occurredAt", "caseId", "runId", "kind", "status", "entity"];

const setup = () => convexTest(schema, modules);
type T = ReturnType<typeof setup>;
const baseline = (t: T, requestId = "req-base-1") =>
  t.mutation(h.saveBaseline, { requestId, caseId });
const alt = (t: T, requestId: string, baselineRunId: string) =>
  t.mutation(h.computeAlternative, { requestId, baselineRunId });
const feed = (t: T, baselineRunId: string): Promise<ActivityEvent[]> =>
  t.query(h.getActivity, { caseId, baselineRunId });
const allRows = (t: T) => t.run((ctx) => ctx.db.query("historicalActivity").collect());

describe("historical activity feed", () => {
  it("scopes by case and baseline, and is empty for a baseline with no events", async () => {
    const t = setup();
    const b = await baseline(t);
    const a = await alt(t, "req-alt-1", b.runId);
    await expect(
      t.query(h.getActivity, { caseId: "nope", baselineRunId: b.runId }),
    ).rejects.toThrow(/Unknown case/);
    await expect(feed(t, "missing")).rejects.toThrow(/Unknown run/);
    await expect(feed(t, a.runId)).rejects.toThrow(/per baseline/);
    // A baseline saved before H2d has no events and lists none.
    await t.run(async (ctx) => {
      for (const r of await ctx.db.query("historicalActivity").collect())
        await ctx.db.delete(r._id);
    });
    expect(await feed(t, b.runId)).toEqual([]);
  });

  it("a baseline save emits one event, also on retries and concurrent duplicates", async () => {
    const t = setup();
    const b = await baseline(t);
    await baseline(t);
    await Promise.all([baseline(t, "req-dup-xx"), baseline(t, "req-dup-xx")]);
    const events = await feed(t, b.runId);
    expect(events).toEqual([
      {
        id: `evt-saved-${b.runId}`,
        sequence: 1,
        occurredAt: b.run.createdAt,
        caseId,
        runId: b.runId,
        kind: "run_saved",
        status: "succeeded",
        entity: { kind: "run", id: b.runId },
        label: "Baseline forecast saved",
        evidenceIds: ["S7"],
        outputId: b.runId,
      },
    ]);
    expect(await allRows(t)).toHaveLength(2);
  });

  it("concurrent alternatives: duplicates share one event, distinct ones get distinct sequences", async () => {
    const t = setup();
    const b = await baseline(t);
    const [x, y, z] = await Promise.all([
      alt(t, "req-alt-1", b.runId),
      alt(t, "req-alt-1", b.runId),
      alt(t, "req-alt-2", b.runId),
    ]);
    expect(x).toEqual(y);
    await alt(t, "req-alt-2", b.runId);
    const events = await feed(t, b.runId);
    expect(events.map((e) => e.sequence)).toEqual([1, 2, 3]);
    const alts = events.filter((e) => e.kind === "alternative_computed");
    expect(alts.map((e) => e.runId).sort()).toEqual([x.runId, z.runId].sort());
    for (const e of alts) {
      const run = e.runId === x.runId ? x.run : z.run;
      expect(e).toMatchObject({
        id: `evt-alt-${run.id}`,
        occurredAt: run.createdAt,
        entity: { kind: "run", id: run.id },
        outputId: run.id,
        evidenceIds: ["S7"],
      });
    }
  });

  it("a reveal under many keys, including concurrent ones, emits one event", async () => {
    const t = setup();
    const b = await baseline(t);
    const r = await t.mutation(h.reveal, { requestId: "key-one-1", runId: b.runId });
    await t.mutation(h.reveal, { requestId: "key-one-1", runId: b.runId });
    await t.mutation(h.reveal, { requestId: "key-two-2", runId: b.runId });
    await Promise.all([
      t.mutation(h.reveal, { requestId: "key-con-3", runId: b.runId }),
      t.mutation(h.reveal, { requestId: "key-con-4", runId: b.runId }),
    ]);
    const reveals = (await feed(t, b.runId)).filter((e) => e.kind === "disclosure_revealed");
    expect(reveals).toEqual([
      {
        id: `evt-reveal-${b.runId}`,
        sequence: 2,
        occurredAt: r.revealedAt,
        caseId,
        runId: b.runId,
        kind: "disclosure_revealed",
        status: "succeeded",
        entity: { kind: "comparison", id: b.runId },
        label: "Next disclosure revealed",
        evidenceIds: ["S8"],
      },
    ]);
  });

  it("two baselines: no later facts before reveal, and one reveal never reaches the other", async () => {
    const t = setup();
    const a = await baseline(t);
    const b = await baseline(t, "req-base-2");
    await alt(t, "req-alt-a", a.runId);
    for (const id of [a.runId, b.runId]) {
      const json = JSON.stringify(await feed(t, id));
      for (const s of LATER) expect(json).not.toContain(s);
    }
    await t.mutation(h.reveal, { requestId: "req-rev-a", runId: a.runId });
    const fa = await feed(t, a.runId);
    const fb = await feed(t, b.runId);
    expect(fa.map((e) => e.kind)).toEqual([
      "run_saved",
      "alternative_computed",
      "disclosure_revealed",
    ]);
    expect(fb.map((e) => e.kind)).toEqual(["run_saved"]);
    expect(fb.every((e) => e.runId === b.runId)).toBe(true);
    for (const s of LATER) expect(JSON.stringify(fb)).not.toContain(s);
  });

  it("IDs and sequences are stable across requeries and later events", async () => {
    const t = setup();
    const b = await baseline(t);
    await alt(t, "req-alt-1", b.runId);
    const first = await feed(t, b.runId);
    expect(await feed(t, b.runId)).toEqual(first);
    await t.mutation(h.reveal, { requestId: "req-rev-1", runId: b.runId });
    await alt(t, "req-alt-2", b.runId);
    const later = await feed(t, b.runId);
    expect(later.slice(0, first.length)).toEqual(first);
    const seq = later.map((e) => e.sequence);
    expect(seq).toEqual([1, 2, 3, 4]);
    expect(new Set(later.map((e) => e.id)).size).toBe(later.length);
  });

  it("rejected mutations emit nothing", async () => {
    const t = setup();
    const b = await baseline(t);
    const a = await alt(t, "req-alt-1", b.runId);
    const before = await allRows(t);
    await expect(alt(t, "req-base-1", b.runId)).rejects.toThrow(/different request/);
    await expect(alt(t, "req-alt-2", a.runId)).rejects.toThrow(/baseline run/);
    await expect(alt(t, "req-alt-3", "missing")).rejects.toThrow(/Unknown run/);
    await expect(t.mutation(h.saveBaseline, { requestId: "req-alt-1", caseId })).rejects.toThrow(
      /different request/,
    );
    await expect(t.mutation(h.saveBaseline, { requestId: "x", caseId })).rejects.toThrow(
      /requestId/,
    );
    await expect(t.mutation(h.reveal, { requestId: "req-rev-9", runId: a.runId })).rejects.toThrow(
      /Only a baseline/,
    );
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("historicalRuns").first())!;
      await ctx.db.patch(row._id, { rowHash: "tampered" });
    });
    await expect(t.mutation(h.reveal, { requestId: "req-rev-1", runId: b.runId })).rejects.toThrow(
      /integrity/,
    );
    expect(await allRows(t)).toEqual(before);
  });

  it("returns only validated contract fields, no storage metadata", async () => {
    const t = setup();
    const b = await baseline(t);
    await alt(t, "req-alt-1", b.runId);
    await t.mutation(h.reveal, { requestId: "req-rev-1", runId: b.runId });
    for (const e of await feed(t, b.runId)) {
      expect(ActivityEventSchema.parse(e)).toEqual(e);
      for (const k of Object.keys(e))
        expect([...KEYS, "label", "evidenceIds", "outputId"]).toContain(k);
      expect(e.status).toBe("succeeded");
      expect(Date.parse(e.occurredAt)).toBeGreaterThan(Date.parse("2026-01-01"));
    }
    // A stored row edited to another case fails closed rather than leaking.
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("historicalActivity").first())!;
      await ctx.db.patch(row._id, { event: { ...row.event, caseId: "other-case" } });
    });
    await expect(feed(t, b.runId)).rejects.toThrow(/integrity/);
  });
});
