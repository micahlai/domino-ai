/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob(["../**/*.ts", "../_generated/*.js", "!./**"]);

afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const { companyId } = await t.mutation(api.field.setup, {});
  await drain(t);
  return { t, companyId };
}

async function drain(t: ReturnType<typeof convexTest>) {
  vi.runOnlyPendingTimers();
  await t.finishInProgressScheduledFunctions();
}

const tool = <T extends { tool: string }>(list: { tools: T[] } | null, id: string) =>
  list?.tools.find((x) => x.tool === id);

describe("connections", () => {
  it("lists every tool as not connected for a new company", async () => {
    const { t, companyId } = await setup();
    const list = await t.query(api.connections.list, {});
    expect(list?.companyId).toBe(companyId);
    expect(list?.tools.map((x) => [x.tool, x.status])).toEqual([
      ["plaid", "disconnected"],
      ["stripe", "disconnected"],
      ["qbo", "disconnected"],
      ["gusto", "disconnected"],
      ["ramp", "disconnected"],
      ["hubspot", "disconnected"],
    ]);
  });

  it("connect needs consent, then syncs and stores counts and tie-outs", async () => {
    const { t, companyId } = await setup();
    await expect(
      t.mutation(api.connections.connect, { companyId, tool: "stripe", consent: false }),
    ).rejects.toThrow(/consent/);

    await t.mutation(api.connections.connect, { companyId, tool: "stripe", consent: true });
    await t.mutation(api.connections.connect, { companyId, tool: "plaid", consent: true });
    await drain(t);
    const list = await t.query(api.connections.list, { companyId });
    const stripe = tool(list, "stripe");
    const plaid = tool(list, "plaid");
    expect(stripe).toMatchObject({ status: "connected", lastError: null });
    expect(stripe?.lastSyncAt).toEqual(expect.any(String));
    expect(stripe?.counts.customers).toBeGreaterThan(0);
    expect(stripe?.recordsIn).toBeGreaterThan(stripe?.recordsOut ?? 0);
    expect(plaid?.counts.bankTxns).toBeGreaterThan(0);
    // Every Stripe payout matched its bank deposit.
    expect(plaid?.checksTotal).toBeGreaterThan(0);
    expect(plaid?.checksOk).toBe(plaid?.checksTotal);
    expect(tool(list, "gusto")?.status).toBe("disconnected");

    const log = await t.query(api.field.log, {
      companyId,
      paginationOpts: { numItems: 50, cursor: null },
    });
    const actions = log.page.map((r) => r.action);
    expect(actions).toContain("connections.connected");
    expect(actions).toContain("connections.synced");
  });

  it("disconnect stops reading the tool and clears its counts", async () => {
    const { t, companyId } = await setup();
    await t.mutation(api.connections.connect, { companyId, tool: "gusto", consent: true });
    await drain(t);
    expect(tool(await t.query(api.connections.list, {}), "gusto")?.counts.payroll).toBeGreaterThan(
      0,
    );

    await t.mutation(api.connections.disconnect, { companyId, tool: "gusto" });
    const after = tool(await t.query(api.connections.list, {}), "gusto");
    expect(after).toMatchObject({ status: "disconnected", counts: {}, lastSyncAt: null });

    // A later sync does not bring it back.
    await t.mutation(api.connections.syncNow, { companyId });
    await drain(t);
    expect(tool(await t.query(api.connections.list, {}), "gusto")?.status).toBe("disconnected");
  });

  it("returns null before any company exists", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.connections.list, {})).toBeNull();
    await expect(
      t.mutation(api.connections.connect, { tool: "plaid", consent: true }),
    ).rejects.toThrow(/No company/);
  });
});
