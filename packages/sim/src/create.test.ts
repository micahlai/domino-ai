import { WorldStateSchema } from "@domino/contracts";
import { fixtures } from "@domino/contracts/fixtures";
import { describe, expect, it } from "vitest";
import { simulator } from "./index";
import { formatSummary } from "./summary";

const day = 86_400_000;
const date = (value: string) => Date.parse(`${value}T00:00:00Z`);
const monday = (value: string) => {
  const d = new Date(date(value));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

describe("createCompany Kestrel", () => {
  it("is reproducible for a seed and varies for another seed", () => {
    const first = simulator.createCompany("kestrel", 42);
    expect(simulator.createCompany("kestrel", 42)).toEqual(first);
    expect(simulator.createCompany("kestrel", 43).snapshot.bankTxns).not.toEqual(
      first.snapshot.bankTxns,
    );
    expect(() => simulator.createCompany("tally", 42)).toThrow(/not built/i);
    expect(() => simulator.createCompany("orbit", 42)).toThrow(/not built/i);
  });

  it("has 26 observed Monday buckets ending at the current week", () => {
    const world = simulator.createCompany("kestrel", 42);
    expect(world.week).toBe(25);
    expect(world.today).toBe("2026-10-30");
    expect(world.snapshot.asOf).toBe(world.today);
    const buckets = [...new Set(world.snapshot.bankTxns.map((txn) => monday(txn.date)))].sort();
    expect(buckets).toHaveLength(26);
    expect(buckets[0]).toBe("2026-05-04");
    expect(buckets[25]).toBe("2026-10-26");
    expect(world.snapshot.bankTxns.every((txn) => txn.date <= world.today)).toBe(true);
    expect(world.pendingEvents.length).toBeGreaterThan(0);
    expect(world.pendingEvents.every((event) => event.week >= 26)).toBe(true);
  });

  it("reconciles cash and keeps IDs and references valid", () => {
    const world = simulator.createCompany("kestrel", 42);
    expect(WorldStateSchema.safeParse(world).success).toBe(true);
    const snapshot = world.snapshot;
    expect(snapshot.cashOnHand).toBe(450_000_000);
    expect(snapshot.restrictedCash).toBe(60_000_000);
    const net = snapshot.bankTxns.reduce((sum, txn) => sum + txn.amount, 0);
    const opening = 450_000_000 - net;
    expect(net).toBe(243_746_860);
    expect(opening).toBe(206_253_140);
    expect(opening + net).toBe(snapshot.cashOnHand);
    let running = opening;
    for (const txn of snapshot.bankTxns) {
      running += txn.amount;
      expect(Number.isSafeInteger(running)).toBe(true);
      expect(running).toBeGreaterThanOrEqual(0);
    }
    expect(running).toBe(snapshot.cashOnHand);
    const customers = new Set(snapshot.customers.map((customer) => customer.id));
    expect(customers.size).toBe(snapshot.customers.length);
    expect(snapshot.customers).toHaveLength(300);
    for (const named of fixtures.snapshot.customers) {
      expect(snapshot.customers).toContainEqual(named);
    }
    for (const key of ["invoices", "bankTxns", "bills", "cardTxns", "payroll", "deals"] as const) {
      const ids = snapshot[key].map((record) => record.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(snapshot.invoices.every((invoice) => customers.has(invoice.customerId))).toBe(true);
    expect(snapshot.deals.every((deal) => customers.has(deal.customerId))).toBe(true);
    const invoices = new Set(snapshot.invoices.map((invoice) => invoice.id));
    expect(
      world.pendingEvents.every((event) =>
        event.change.kind === "delay_invoice" ? invoices.has(event.change.invoiceId) : true,
      ),
    ).toBe(true);
  });

  it("has a 18-24 day observed Acme mean and dated paid invoices with payout lag", () => {
    const { snapshot, today } = simulator.createCompany("kestrel", 42);
    const acme = snapshot.invoices.filter(
      (invoice) => invoice.customerId === "cus_acme" && invoice.paid,
    );
    expect(acme.length).toBeGreaterThanOrEqual(3);
    const mean =
      acme.reduce((sum, invoice) => sum + (date(invoice.paid!) - date(invoice.due)) / day, 0) /
      acme.length;
    expect(mean).toBeGreaterThanOrEqual(18);
    expect(mean).toBeLessThanOrEqual(24);
    expect(snapshot.invoices.every((invoice) => invoice.issued <= today)).toBe(true);
    expect(snapshot.invoices.every((invoice) => !invoice.paid || invoice.paid <= today)).toBe(true);
    expect(
      snapshot.invoices.find((invoice) => invoice.id === "inv_acme_2027")?.paid,
    ).toBeUndefined();
    expect(snapshot.bankTxns.some((txn) => txn.description.includes("inv_acme_2027"))).toBe(false);
    for (const invoice of snapshot.invoices.filter((record) => record.paid)) {
      const payout = snapshot.bankTxns.find((txn) => txn.description.includes(invoice.id));
      expect(payout, invoice.id).toBeDefined();
      const lag = (date(payout!.date) - date(invoice.paid!)) / day;
      expect(lag).toBeGreaterThanOrEqual(1);
      expect(lag).toBeLessThanOrEqual(3);
    }
  });

  it("prints a useful public summary", () => {
    const output = formatSummary(simulator.createCompany("kestrel", 42));
    expect(output).toContain("Kestrel Data");
    expect(output).toContain("2026-05-04");
    expect(output).toContain("2026-10-30");
    expect(output).toContain("Customers: 300");
    expect(output).toContain("Ending cash: $4,500,000.00");
    expect(output).toContain("Restricted cash: $600,000.00");
    expect(output).not.toContain("Answer key");
  });
});
