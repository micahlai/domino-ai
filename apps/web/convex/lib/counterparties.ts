import type { Snapshot } from "@domino/contracts";
import {
  type Counterparty,
  type CounterpartyJob,
  MAX_COUNTERPARTIES,
} from "../../../../packages/agents/src/fieldAi";

/**
 * The research agent's CREAO job: the top customers (by open receivables) and vendors (by open
 * bills) from the snapshot, described by counts and dates only. Ranking is deterministic code;
 * no amount is sent, so the remote agent has nothing to calculate.
 */
const PER_ROLE = MAX_COUNTERPARTIES / 2;

function rankBy<T>(rows: T[], key: (r: T) => string, weight: (r: T) => number): string[] {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(key(r), (totals.get(key(r)) ?? 0) + weight(r));
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([k]) => k);
}

export function counterpartyJob(s: Snapshot, company: string): CounterpartyJob {
  const open = s.invoices.filter((i) => i.paid === undefined && i.writtenOff === undefined);
  const pool = open.length > 0 ? open : s.invoices;
  const names = new Map(s.customers.map((c) => [c.id, c]));
  const customers: Counterparty[] = rankBy(
    pool,
    (i) => i.customerId,
    (i) => i.amount,
  )
    .slice(0, PER_ROLE)
    .map((id, n) => {
      const mine = s.invoices.filter((i) => i.customerId === id);
      const openMine = open.filter((i) => i.customerId === id);
      const paid = mine.filter((i) => i.paid !== undefined);
      const late = paid.filter((i) => (i.paid ?? "") > i.due).length;
      return {
        name: names.get(id)?.name ?? id,
        role: "customer",
        rank: n + 1,
        facts: [
          `Rank ${n + 1} customer by open receivables`,
          `${openMine.length} open invoices, ${openMine.filter((i) => i.due < s.asOf).length} past due as of ${s.asOf}`,
          `${late} of ${paid.length} paid invoices were paid after the due date`,
          `Payment terms ${names.get(id)?.paymentTermsDays ?? "unknown"} days`,
        ],
      };
    });
  const openBills = s.bills.filter((b) => b.paid === undefined);
  const billPool = openBills.length > 0 ? openBills : s.bills;
  const vendors: Counterparty[] = rankBy(
    billPool,
    (b) => b.vendor,
    (b) => b.amount,
  )
    .slice(0, PER_ROLE)
    .map((vendor, n) => {
      const mine = openBills.filter((b) => b.vendor === vendor);
      return {
        name: vendor,
        role: "vendor",
        rank: n + 1,
        facts: [
          `Rank ${n + 1} vendor by open bills`,
          `${mine.length} open bills, ${mine.filter((b) => b.due < s.asOf).length} past due as of ${s.asOf}`,
          s.bills.some((b) => b.vendor === vendor && b.critical)
            ? "Critical vendor (never delayed by fixes)"
            : "Not marked critical",
        ],
      };
    });
  // Names must be unique for the output schema enum; a vendor sharing a customer name is dropped.
  const counterparties: Counterparty[] = [];
  for (const c of [...customers, ...vendors])
    if (!counterparties.some((o) => o.name === c.name)) counterparties.push(c);
  return { company, asOf: s.asOf, counterparties };
}
