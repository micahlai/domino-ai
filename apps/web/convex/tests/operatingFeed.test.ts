import type { Snapshot } from "@domino/contracts";
import { OPERATING_COMPANY_IDS, OPERATING_SCENARIO_IDS, createOperatingDemo } from "@domino/sim";
import { describe, expect, it } from "vitest";
import { inProcessFetcher } from "../connectors/inProcess";
import { pullAll } from "../connectors/pullAll";
import { MOCK_TOOL_IDS } from "../connectors/types";
import { emptyOverlay, nextWorld, servedSnapshot } from "../fieldFeed";
import { dayEntries, stepDays, supportsDayClock } from "../lib/clock";

const connections = MOCK_TOOL_IDS.map((tool) => ({ tool, status: "connected" as const }));
const selections = OPERATING_COMPANY_IDS.flatMap((company) =>
  OPERATING_SCENARIO_IDS.map((scenario) => ({ company, scenario })),
);

function sorted(snapshot: Snapshot | null) {
  if (!snapshot) return snapshot;
  const result: Record<string, unknown> = { ...snapshot };
  for (const [key, records] of Object.entries(snapshot))
    if (Array.isArray(records))
      result[key] = [...records].sort((a: { id: string }, b: { id: string }) =>
        a.id.localeCompare(b.id),
      );
  return result;
}

describe("reconstructed operating feed", () => {
  for (const selection of selections)
    it(`${selection.company}/${selection.scenario} round-trips through every mock source`, async () => {
      const { world } = createOperatingDemo(selection);
      const served = servedSnapshot(world, emptyOverlay());
      const pulled = await pullAll({
        fetcher: inProcessFetcher(served),
        companyId: served.companyId,
        connections,
      });
      expect(pulled.snapshotError).toBeNull();
      expect(sorted(pulled.snapshot)).toEqual(sorted(served));
      expect(pulled.checks.filter((check) => !check.ok)).toEqual([]);
      expect(pulled.log.map((entry) => entry.error)).toEqual(MOCK_TOOL_IDS.map(() => null));
    });

  it("uses the operating day and week dispatch and preserves the Plaid cursor", async () => {
    const { world } = createOperatingDemo({ company: "2u", scenario: "baseline" });
    expect(supportsDayClock(world)).toBe(true);
    const before = servedSnapshot(world, emptyOverlay());
    const first = await pullAll({
      fetcher: inProcessFetcher(before),
      companyId: before.companyId,
      connections,
    });
    const day = stepDays(world, emptyOverlay(), world.today);
    expect(day.world.today > world.today).toBe(true);
    const weekly = nextWorld(world);
    expect(weekly.today > day.world.today).toBe(true);
    const after = servedSnapshot(weekly, emptyOverlay());
    const incremental = await pullAll({
      fetcher: inProcessFetcher(after),
      companyId: after.companyId,
      connections,
      since: { cursor: first.cursor, bankTxns: first.records.bankTxns },
    });
    expect(incremental.snapshotError).toBeNull();
    expect(sorted(incremental.snapshot)).toEqual(sorted(after));
    expect(incremental.checks.filter((check) => !check.ok)).toEqual([]);
  });

  it("classifies linked reconstructed receipts, payroll, and bill payments", () => {
    const after = servedSnapshot(
      createOperatingDemo({ company: "2u", scenario: "baseline" }).world,
      emptyOverlay(),
    );
    const linked = (ids: string[]) =>
      after.bankTxns.find((bank) => ids.some((id) => bank.id === `${id}/bank`));
    const receipt = linked(after.invoices.map((invoice) => invoice.id));
    const payroll = linked(after.payroll.map((run) => run.id));
    const bill = linked(after.bills.map((item) => item.id));
    expect(receipt && payroll && bill).toBeTruthy();
    if (!receipt || !payroll || !bill) return;
    const selected = new Set([receipt.id, payroll.id, bill.id]);
    const before = { ...after, bankTxns: after.bankTxns.filter((bank) => !selected.has(bank.id)) };
    const entries = dayEntries(before, after);
    expect(entries.customerPayments).toBe(1);
    expect(entries.payrollDebits).toBe(1);
    expect(entries.billPayments).toBe(1);
    expect(entries.otherBank).toBe(0);
  });
});
