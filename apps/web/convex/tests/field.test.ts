/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { type WeeklySeedV1, contentHashPreimage, parseWeeklySeedJson } from "@domino/contracts";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { sha256 } from "../fieldJobs";
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

async function setup() {
  vi.useFakeTimers();
  const t = newBackend();
  const { companyId } = await t.mutation(api.field.setup, {});
  await drain(t);
  return { t, companyId };
}

async function ingest(t: T, companyId: Id<"companies">) {
  await t.mutation(api.field.ingestNow, { companyId });
  await drain(t);
  return t.query(api.field.status, { companyId });
}

async function actions(t: T, companyId: Id<"companies">) {
  const page = await t.query(api.field.log, {
    companyId,
    paginationOpts: { numItems: 200, cursor: null },
  });
  return page.page.map((r) => r.action);
}

describe("field ingest", () => {
  it("new mock entries -> ingest -> new snapshot version -> recompute, all logged", async () => {
    const { t, companyId } = await setup();
    const first = await t.query(api.field.status, { companyId });
    expect(first).toMatchObject({ snapshotVersion: 1, lastIngestStatus: "ok", openFindings: 0 });
    expect(first?.sources.every((s) => s.tieOut === "ok" && s.lastPull === first.asOf)).toBe(true);

    // Nothing new: no new version.
    expect(await ingest(t, companyId)).toMatchObject({
      snapshotVersion: 1,
      lastIngestStatus: "no_change",
    });

    const moved = await t.mutation(api.field.advanceFeed, { companyId });
    const after = await ingest(t, companyId);
    expect(after).toMatchObject({ snapshotVersion: 2, lastIngestStatus: "ok", asOf: moved.asOf });
    expect(after?.recordCounts?.bankTxns).toBeGreaterThan(first?.recordCounts?.bankTxns ?? 0);

    // Old versions stay; the newest is what the engine reads.
    const snapshots = await t.run((ctx) =>
      ctx.db
        .query("snapshots")
        .withIndex("by_company_asOf", (q) => q.eq("companyId", companyId))
        .collect(),
    );
    expect(snapshots.map((s) => s.asOf)).toEqual([first?.asOf, moved.asOf]);

    const log = await t.query(api.field.log, {
      companyId,
      paginationOpts: { numItems: 200, cursor: null },
    });
    const run = log.page.filter((r) => r.runId && r.runId === log.page[0]?.runId);
    expect(run.map((r) => r.action).reverse()).toEqual([
      "ingest.started",
      ...Array(6).fill("ingest.pulled"),
      "ingest.reconciled",
      "ingest.mapped",
      "ingest.snapshotWritten",
      "audit.completed",
      "ingest.recomputed",
    ]);
    expect(new Set(run.filter((r) => r.action === "ingest.pulled").map((r) => r.source))).toEqual(
      new Set(["stripe", "crm", "ramp", "books", "payroll", "nessie"]),
    );
    expect(run.every((r) => r.agent === "field.ingest" || r.agent === "field.audit")).toBe(true);
    expect(await actions(t, companyId)).toContain("engine.recompute");
  }, 60_000);

  it("a planted duplicate becomes an escalation, a decision is recorded, the seed exports", async () => {
    const { t, companyId } = await setup();
    const planted = await t.mutation(api.field.advanceFeed, {
      companyId,
      advance: false,
      anomaly: "duplicate",
    });
    const status = await ingest(t, companyId);
    expect(status).toMatchObject({ snapshotVersion: 2, openFindings: 1, openEscalations: 1 });
    const [finding] = await t.query(api.field.findings, { companyId, escalatedOnly: true });
    expect(finding).toMatchObject({
      kind: "duplicate",
      severity: "high",
      status: "open",
      refs: planted.planted,
    });
    expect(await actions(t, companyId)).toContain("audit.escalated");

    // Re-ingesting the same data does not repeat the finding.
    await t.mutation(api.field.advanceFeed, { companyId });
    expect(await ingest(t, companyId)).toMatchObject({ snapshotVersion: 3, openFindings: 1 });

    const fid = finding?.findingId as string;
    await t.mutation(api.field.decide, { companyId, findingId: fid, decision: "approved" });
    await expect(
      t.mutation(api.field.decide, { companyId, findingId: fid, decision: "rejected" }),
    ).rejects.toThrow();
    const approvals = await t.run((ctx) => ctx.db.query("approvals").collect());
    expect(approvals).toMatchObject([{ fixId: fid, decision: "approved" }]);
    expect(await t.query(api.field.findings, { companyId })).toEqual([]);
    expect((await actions(t, companyId))[0]).toBe("escalation.approved");

    const exported = await t.query(api.field.exportSeed, { companyId });
    const parsed = parseWeeklySeedJson(exported.json);
    expect(parsed.success).toBe(true);
    const seed = JSON.parse(exported.json) as WeeklySeedV1;
    expect(await sha256(contentHashPreimage(seed))).toBe(seed.contentHash);
    expect(seed.id).toBe(`field:weekly_seed/${companyId}-v3`);
    expect(seed.findings.map((f) => f.id)).toEqual([fid]);
    expect(seed.scheduledItems.length).toBeGreaterThan(0);
  }, 60_000);

  it("a source rewriting an invoice amount is flagged as a conflict between versions", async () => {
    const { t, companyId } = await setup();
    const planted = await t.mutation(api.field.advanceFeed, {
      companyId,
      advance: false,
      anomaly: "conflict",
    });
    await ingest(t, companyId);
    const found = await t.query(api.field.findings, { companyId });
    expect(found).toMatchObject([{ kind: "conflict", severity: "high", refs: planted.planted }]);
  }, 60_000);

  it.each([
    ["unusual_amount", "high"],
    ["unusual_timing", "medium"],
    ["missing_expected", "high"],
  ] as const)(
    "a planted %s is detected after a week of new entries",
    async (kind, severity) => {
      const { t, companyId } = await setup();
      await t.mutation(api.field.advanceFeed, { companyId, anomaly: kind });
      await ingest(t, companyId);
      const found = await t.query(api.field.findings, { companyId });
      expect(found.map((f) => [f.kind, f.severity])).toEqual([[kind, severity]]);
    },
    60_000,
  );

  it("auto-ingest runs bounded ticks and a stale generation stops itself", async () => {
    const { t, companyId } = await setup();
    await t.mutation(api.field.setAutoIngest, { companyId, enabled: true });
    expect(await t.mutation(internal.fieldJobs.claimTick, { companyId, generation: 0 })).toBe(
      false,
    );
    expect(await t.mutation(internal.fieldJobs.claimTick, { companyId, generation: 1 })).toBe(true);
    await t.mutation(api.field.setAutoIngest, { companyId, enabled: false });
    expect(await t.mutation(internal.fieldJobs.claimTick, { companyId, generation: 1 })).toBe(
      false,
    );
    expect(await t.query(api.field.status, { companyId })).toMatchObject({ auto: false });
  }, 60_000);
});
