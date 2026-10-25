/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { readFileSync, writeFileSync } from "node:fs";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { toolInfo, toolSummaries } from "../connectors/catalog";
import { inProcessFetcher } from "../connectors/inProcess";
import { pullAll } from "../connectors/pullAll";
import { LIST_NAMES, TOOL_IDS, type ToolId } from "../connectors/types";
import { emptyOverlay, newWorld, servedSnapshot } from "../fieldFeed";
import {
  LIST_OWNERS,
  type SourceDetail,
  attributeRecords,
  buildSourceDetail,
  latestRecords,
  ownerOfList,
  parsePull,
  sourceTask,
} from "../fieldSourceDetail";
import schema from "../schema";

const modules = import.meta.glob(["../**/*.ts", "../_generated/*.js", "!./**"]);
const get = makeFunctionReference<
  "query",
  { companyId: Id<"companies">; tool: ToolId },
  SourceDetail | null
>("fieldSourceDetail:get");

afterEach(() => {
  vi.useRealTimers();
});

const served = () => servedSnapshot(newWorld(1), emptyOverlay());

async function pull(tools: ToolId[]) {
  const s = served();
  const r = await pullAll({
    fetcher: inProcessFetcher(s),
    companyId: s.companyId,
    connections: tools.map((tool) => ({ tool, status: "connected" as const })),
  });
  if (!r.snapshot) throw new Error(r.snapshotError ?? "no snapshot");
  return { r, snapshot: r.snapshot };
}

describe("source attribution", () => {
  it.each([
    [...TOOL_IDS],
    ["qbo", "ramp", "plaid", "gusto", "hubspot"],
    ["stripe", "ramp", "plaid"],
    ["qbo", "plaid"],
  ] as ToolId[][])("gives each record to the tool pullAll kept it from (%s)", async (...tools) => {
    const { r, snapshot } = await pull(tools);
    for (const receipt of r.log) {
      const mine = attributeRecords(snapshot, receipt.tool, tools);
      for (const list of LIST_NAMES) {
        const kept = receipt.counts[list] ?? 0;
        const shown = mine.lists.find((l) => l.list === list)?.count ?? 0;
        expect(shown, `${receipt.tool} ${list}`).toBe(kept);
      }
    }
  });

  it("follows the OWNERS order: Stripe keeps invoices over QuickBooks, QuickBooks bills over Ramp", () => {
    expect(ownerOfList("invoices", ["qbo", "stripe"])).toBe("stripe");
    expect(ownerOfList("invoices", ["qbo"])).toBe("qbo");
    expect(ownerOfList("bills", ["ramp", "qbo"])).toBe("qbo");
    expect(ownerOfList("bills", ["ramp"])).toBe("ramp");
    // Owner disconnected: the list keeps its last values, still that tool's (stale).
    expect(ownerOfList("payroll", ["stripe"])).toBe("gusto");
    for (const list of LIST_NAMES) expect(LIST_OWNERS[list].length).toBeGreaterThan(0);
  });

  it("names records in plain words with exact cents and the counterparty", async () => {
    const { snapshot } = await pull([...TOOL_IDS]);
    const stripe = attributeRecords(snapshot, "stripe", TOOL_IDS);
    const invoice = snapshot.invoices[0];
    if (!invoice) throw new Error("fixture has invoices");
    const row = stripe.records.find((x) => x.id === invoice.id);
    const name = snapshot.customers.find((c) => c.id === invoice.customerId)?.name;
    expect(row).toMatchObject({ list: "invoices", counterparty: name });
    expect(Number.isInteger(row?.amount)).toBe(true);
    const qbo = attributeRecords(snapshot, "qbo", TOOL_IDS);
    expect(qbo.lists.map((l) => l.list)).toEqual(["bills"]);
    expect(qbo.records.every((x) => x.type.startsWith("Bill") && (x.amount ?? 0) < 0)).toBe(true);
  });

  it("lists the newest records up to the snapshot date", async () => {
    const { snapshot } = await pull([...TOOL_IDS]);
    const recent = latestRecords(
      attributeRecords(snapshot, "plaid", TOOL_IDS).records,
      "2026-10-30",
    );
    expect(recent).toHaveLength(8);
    const dates = recent.map((x) => x.date ?? "");
    expect(dates.every((d) => d <= "2026-10-30")).toBe(true);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});

describe("source task", () => {
  const connection = {
    status: "connected" as const,
    account: "Kestrel Data (sandbox)",
    connectedAt: "2026-10-30T10:00:00Z",
    lastSyncAt: "2026-10-30T10:00:05Z",
    cursor: null,
    recordsIn: 10,
    recordsOut: 10,
    skipped: 0,
    checksOk: 0,
    checksTotal: 0,
    lastError: null,
  };
  it("reads the page progress a running ingest records, else says it is reading now", () => {
    const started = { at: "2026-10-30T11:00:00Z", action: "ingest.started", refs: [], runId: "r2" };
    const paged = {
      at: "2026-10-30T11:00:01Z",
      action: "ingest.page",
      refs: [],
      runId: "r2",
      source: "stripe",
      step: 3,
      steps: 26,
    };
    expect(sourceTask("stripe", [paged, started], connection)).toMatchObject({
      state: "reading",
      text: "Reading page 3 of 26 from Stripe",
    });
    expect(sourceTask("stripe", [started], connection)).toMatchObject({
      state: "reading",
      text: "Reading Stripe now",
    });
  });
  it("shows the last pull once the run wrote it", () => {
    const rows = [
      {
        at: "2026-10-30T11:00:02Z",
        action: "ingest.pulled",
        refs: ["/v1/customers"],
        runId: "r2",
        source: "stripe",
        tool: "stripe.read",
        summary: "Read 2111 records from Stripe in 25 pages",
      },
      { at: "2026-10-30T11:00:00Z", action: "ingest.started", refs: [], runId: "r2" },
    ];
    expect(sourceTask("stripe", rows, connection)).toMatchObject({
      state: "done",
      text: "Read 2111 records from Stripe in 25 pages",
    });
    expect(parsePull(rows[0]?.summary)).toEqual({ records: 2111, pages: 25 });
    expect(parsePull("Read 1 record from Gusto in 1 page")).toEqual({ records: 1, pages: 1 });
  });
});

// The brain map's demo mode shows these. They are real pullAll results over the same mock company
// field.setup creates (sim Kestrel, seed 1), with all six tools connected: nothing is invented.
// Re-record: RECORD_CONNECTOR_FIXTURES=1 npx vitest run convex/tests/fieldSourceDetail.test.ts,
// then biome format --write the JSON (the test compares parsed values, not text).
const FILE = new URL("../../components/field/BrainMapSourceDemo.json", import.meta.url);
const DEMO_AT = "2026-10-30T12:00:00.000Z";

async function demoDetails() {
  const { r, snapshot } = await pull([...TOOL_IDS]);
  const summaries = toolSummaries(r);
  const sources = Object.fromEntries(
    r.log.map((receipt) => {
      const sum = summaries.find((x) => x.tool === receipt.tool);
      const pages = receipt.calls.reduce((n, c) => n + c.pages, 0);
      const detail = buildSourceDetail({
        tool: receipt.tool,
        connected: TOOL_IDS,
        snapshot,
        connection: {
          status: "connected",
          account: "Kestrel Data (sandbox)",
          connectedAt: DEMO_AT,
          lastSyncAt: DEMO_AT,
          cursor: sum?.cursor ?? null,
          recordsIn: sum?.recordsIn ?? 0,
          recordsOut: sum?.recordsOut ?? 0,
          skipped: sum?.skipped ?? 0,
          checksOk: sum?.checksOk ?? 0,
          checksTotal: sum?.checksTotal ?? 0,
          lastError: null,
        },
        // The pull row fieldJobs writes for this read.
        log: [
          {
            at: DEMO_AT,
            action: "ingest.pulled",
            refs: receipt.calls.map((c) => c.endpoint),
            source: receipt.tool,
            tool: `${receipt.tool}.read`,
            summary: `Read ${receipt.recordsIn} records from ${toolInfo(receipt.tool).name} in ${pages} page${pages === 1 ? "" : "s"}`,
          },
        ],
      });
      return [receipt.tool, detail];
    }),
  );
  return { at: DEMO_AT, asOf: snapshot.asOf, sources };
}

describe("brain map source demo", () => {
  it("matches a fresh pullAll over the demo company", async () => {
    const fresh = await demoDetails();
    if (process.env.RECORD_CONNECTOR_FIXTURES === "1")
      writeFileSync(FILE, `${JSON.stringify(fresh, null, 1)}\n`);
    expect(JSON.parse(readFileSync(FILE, "utf8"))).toEqual(fresh);
  }, 60_000);
});

describe("fieldSourceDetail.get", () => {
  async function ingested() {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { companyId } = await t.mutation(api.field.setup, {});
    vi.runOnlyPendingTimers();
    await t.finishInProgressScheduledFunctions();
    await t.mutation(api.field.ingestNow, { companyId });
    vi.runOnlyPendingTimers();
    await t.finishInProgressScheduledFunctions();
    return { t, companyId };
  }

  it("returns the connection, the records Stripe and QuickBooks are the record for, and the last read", async () => {
    const { t, companyId } = await ingested();
    const stripe = await t.query(get, { companyId, tool: "stripe" });
    expect(stripe).toMatchObject({ tool: "stripe", name: "Stripe", status: "connected" });
    expect(stripe?.lists.map((l) => l.list)).toEqual(
      expect.arrayContaining(["customers", "invoices"]),
    );
    expect(stripe?.recent.length).toBeGreaterThan(0);
    expect(stripe?.task.state).toBe("done");
    expect(stripe?.task.text).toMatch(/^Read \d+ records from Stripe in \d+ pages?$/);
    expect(stripe?.pages).toBeGreaterThan(0);
    expect(stripe?.endpoints).toContain("/v1/invoices");
    expect(stripe?.lastReadAt).not.toBeNull();

    const qbo = await t.query(get, { companyId, tool: "qbo" });
    expect(qbo?.lists.map((l) => l.list)).toEqual(["bills"]);
    expect(qbo?.recent.every((x) => x.list === "bills")).toBe(true);
  });

  it("is read only and null for an unknown company", async () => {
    const { t, companyId } = await ingested();
    const before = await t.run((ctx) => ctx.db.query("log").collect());
    await t.query(get, { companyId, tool: "plaid" });
    const after = await t.run((ctx) => ctx.db.query("log").collect());
    expect(after.length).toBe(before.length);
    await t.run((ctx) => ctx.db.delete("companies", companyId));
    expect(await t.query(get, { companyId, tool: "plaid" })).toBeNull();
  });
});
