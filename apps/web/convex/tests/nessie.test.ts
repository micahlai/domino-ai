/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { SnapshotSchema } from "@domino/contracts";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { decodeDescription } from "../connectors/nessie";
import schema from "../schema";
import { FOREIGN_ACCOUNT, fakeNessie } from "./connectors/nessie.test-support";

const modules = import.meta.glob(["../**/*.ts", "../_generated/*.js", "!./**"]);
const newBackend = () => convexTest(schema, modules);
type T = ReturnType<typeof newBackend>;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function drain(t: T) {
  vi.runOnlyPendingTimers();
  await t.finishInProgressScheduledFunctions();
}

function withNessie() {
  const nessie = fakeNessie();
  vi.stubEnv("NESSIE_API_KEY", "test-key");
  vi.stubEnv("NESSIE_BASE_URL", "https://nessie.test");
  vi.stubGlobal("fetch", nessie.fetch);
  return nessie;
}

async function latest(t: T, companyId: Id<"companies">) {
  return t.run(async (ctx) => {
    const feed = await ctx.db
      .query("feeds")
      .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
      .unique();
    const row = feed?.lastSnapshotId ? await ctx.db.get("snapshots", feed.lastSnapshotId) : null;
    return SnapshotSchema.parse(row?.data);
  });
}

async function runRows(t: T, companyId: Id<"companies">) {
  const log = await t.query(api.field.log, {
    companyId,
    paginationOpts: { numItems: 300, cursor: null },
  });
  return log.page.filter((r) => r.runId && r.runId === log.page[0]?.runId);
}

const sortById = <X extends { id: string }>(xs: X[]) =>
  [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

describe("Capital One Nessie as the bank", () => {
  it("setup posts the history to Domino's own accounts; ingest reads it back tied out", async () => {
    vi.useFakeTimers();
    const nessie = withNessie();
    const t = newBackend();
    const { companyId } = await t.mutation(api.field.setup, { profile: "kestrel" });
    await drain(t);
    const served = await t.query(internal.fieldJobs.served, { companyId });
    const snap = await latest(t, companyId);
    expect(sortById(snap.bankTxns)).toEqual(sortById(served.bankTxns));
    expect(snap.cashOnHand).toBe(served.cashOnHand);
    expect(snap.restrictedCash).toBe(served.restrictedCash);

    const link = await t.query(internal.fieldNessie.link, { companyId });
    expect(link?.label.startsWith("domino-kestrel-")).toBe(true);
    expect(link?.posted).toHaveLength(served.bankTxns.length);
    expect(link?.created).toBe(served.bankTxns.length + 3);
    const run = await runRows(t, companyId);
    expect(run.map((r) => r.action)).toContain("nessie.posted");
    expect(run.map((r) => r.action)).not.toContain("ingest.bankFallback");
    expect(run.find((r) => r.action === "ingest.pulled" && r.source === "nessie")).toBeTruthy();
    expect(run.find((r) => r.action === "ingest.reconciled")?.summary).toMatch(/agree to the cent/);
    const summary = await t.query(api.fieldDashboard.summary, { companyId });
    expect(summary?.result?.ok && summary.result.view.unclassified).toBe(0);
    expect(summary?.sources).toEqual({ total: 6, connected: 6, off: [] });

    // Same week again: nothing is posted, the snapshot does not change.
    const posts = () => nessie.calls.filter((c) => c.method === "POST").length;
    const before = posts();
    await t.mutation(api.field.ingestNow, { companyId });
    await drain(t);
    expect(posts()).toBe(before);
    expect((await t.query(api.field.status, { companyId }))?.lastIngestStatus).toBe("no_change");

    // New entries arrive: only that week's lines are posted.
    await t.mutation(api.field.advanceFeed, { companyId });
    await t.mutation(api.field.ingestNow, { companyId });
    await drain(t);
    const served2 = await t.query(internal.fieldJobs.served, { companyId });
    expect(posts() - before).toBe(served2.bankTxns.length - served.bankTxns.length);
    const snap2 = await latest(t, companyId);
    expect(snap2.cashOnHand).toBe(served2.cashOnHand);
    expect(sortById(snap2.bankTxns)).toEqual(sortById(served2.bankTxns));

    // Every write went to Domino's own ids; the foreign account was never touched.
    expect(nessie.calls.some((c) => c.path.includes(FOREIGN_ACCOUNT))).toBe(false);
    expect(nessie.calls.some((c) => c.method === "GET" && c.path === "/customers")).toBe(false);
    const ours = [...nessie.txns.values()].filter((x) => x.account === link?.checkingId);
    const ids = ours.map((x) => decodeDescription(String(x.description))?.id);
    expect(new Set(ids).size).toBe(ids.length);
  }, 120_000);

  it("Nessie down: the simulated bank is read, logged honestly, and Nessie is used again later", async () => {
    vi.useFakeTimers();
    const nessie = withNessie();
    const t = newBackend();
    const { companyId } = await t.mutation(api.field.setup, { profile: "kestrel" });
    await drain(t);
    await t.mutation(api.field.advanceFeed, { companyId });
    nessie.state.failPostIn = 0;
    await t.mutation(api.field.ingestNow, { companyId });
    await drain(t);
    const run = await runRows(t, companyId);
    const fallback = run.find((r) => r.action === "ingest.bankFallback");
    expect(fallback?.summary).toMatch(/^Nessie unreachable, using simulated bank: Nessie POST/);
    expect(fallback?.summary).not.toContain("test-key");
    expect(run.find((r) => r.action === "ingest.pulled" && r.source === "plaid")).toBeTruthy();
    const served = await t.query(internal.fieldJobs.served, { companyId });
    expect((await latest(t, companyId)).cashOnHand).toBe(served.cashOnHand);
    const list = await t.query(api.connections.list, { companyId });
    const card = list?.tools.find((x) => x.tool === "nessie");
    expect(card?.status).toBe("error");
    expect(card?.lastError).toMatch(/^Nessie unreachable, using simulated bank/);

    // Next run: Nessie answers again, the missing lines are posted and read from Nessie.
    await t.mutation(api.field.ingestNow, { companyId });
    await drain(t);
    const again = await runRows(t, companyId);
    expect(again.find((r) => r.action === "ingest.pulled" && r.source === "nessie")).toBeTruthy();
    expect(again.map((r) => r.action)).not.toContain("ingest.bankFallback");
    const link = await t.query(internal.fieldNessie.link, { companyId });
    expect(link?.posted).toHaveLength(served.bankTxns.length);
    const back = await t.query(api.connections.list, { companyId });
    expect(back?.tools.find((x) => x.tool === "nessie")?.status).toBe("connected");
  }, 120_000);
});
