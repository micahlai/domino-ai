import type { WorldState } from "@domino/contracts";

function dollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const whole = Math.trunc(absolute / 100).toLocaleString("en-US");
  const fraction = String(absolute % 100).padStart(2, "0");
  return `${sign}$${whole}.${fraction}`;
}

export function formatSummary(world: WorldState): string {
  const { snapshot } = world;
  const net = snapshot.bankTxns.reduce((sum, txn) => sum + txn.amount, 0);
  const first = snapshot.bankTxns[0]?.date ?? "unknown";
  return [
    `Kestrel Data | seed ${world.seed}`,
    `Observed history: 26 Monday buckets, 2026-05-04 to ${world.today}`,
    `Bank records: ${snapshot.bankTxns.length} (first ${first})`,
    `Customers: ${snapshot.customers.length}`,
    `Invoices: ${snapshot.invoices.length}`,
    `Bills: ${snapshot.bills.length}`,
    `Card transactions: ${snapshot.cardTxns.length}`,
    `Payroll runs: ${snapshot.payroll.length}`,
    `Deals: ${snapshot.deals.length}`,
    `Pending events: ${world.pendingEvents.length} (week 26 onward)`,
    `Opening cash: ${dollars(snapshot.cashOnHand - net)}`,
    `Net bank flow: ${dollars(net)}`,
    `Ending cash: ${dollars(snapshot.cashOnHand)}`,
    `Restricted cash: ${dollars(snapshot.restrictedCash)}`,
    `Usable cash: ${dollars(snapshot.cashOnHand - snapshot.restrictedCash)}`,
  ].join("\n");
}
