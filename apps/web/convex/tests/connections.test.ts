/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import { fakeNessie } from "./connectors/nessie.test-support";

const modules = import.meta.glob(["../**/*.ts", "../_generated/*.js", "!./**"]);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
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
  it("a new company starts with Capital One as the bank and five mock tools, filled by its first ingest", async () => {
    vi.stubEnv("NESSIE_API_KEY", "test-key");
    vi.stubEnv("NESSIE_BASE_URL", "https://nessie.test");
    vi.stubGlobal("fetch", fakeNessie().fetch);
    const { t, companyId } = await setup();
    const list = await t.query(api.connections.list, {});
    expect(list?.companyId).toBe(companyId);
    expect(list?.tools.map((x) => [x.tool, x.status])).toEqual([
      ["nessie", "connected"],
      ["plaid", "disconnected"],
      ["stripe", "connected"],
      ["qbo", "connected"],
      ["gusto", "connected"],
      ["ramp", "connected"],
      ["hubspot", "connected"],
    ]);
    const on = list?.tools.filter((x) => x.status === "connected") ?? [];
    expect(on.every((x) => x.lastSyncAt !== null && x.recordsIn > 0)).toBe(true);
    expect(on.every((x) => x.checksOk === x.checksTotal)).toBe(true);
    expect(tool(list, "nessie")?.checksTotal).toBeGreaterThan(0);
  });

  it("without a reachable Nessie the simulated bank is read and the Capital One card says so", async () => {
    const { t } = await setup();
    const list = await t.query(api.connections.list, {});
    const nessie = tool(list, "nessie");
    expect(nessie?.status).toBe("error");
    expect(nessie?.lastError).toBe(
      "Nessie unreachable, using simulated bank: NESSIE_API_KEY is not set on this deployment",
    );
    expect(tool(list, "plaid")?.status).toBe("disconnected");
    expect(tool(list, "qbo")?.checksOk).toBe(tool(list, "qbo")?.checksTotal);
  });

  it("connect needs consent, then syncs and stores counts and tie-outs", async () => {
    const { t, companyId } = await setup();
    for (const id of ["nessie", "plaid", "stripe", "qbo", "gusto", "ramp", "hubspot"] as const)
      await t.mutation(api.connections.disconnect, { companyId, tool: id });
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
