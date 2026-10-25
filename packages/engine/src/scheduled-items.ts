import {
  type ScheduledItem,
  type Snapshot,
  WEEKLY_HORIZON_WEEKS,
  firstForecastWeek,
} from "@domino/contracts";
import { addDays, daysBetween } from "./dates";

/**
 * Known future cash items for the 13-week weekly seed: open invoices (receivables), unpaid
 * bills (payables) and upcoming payroll runs. Amounts are copied from the records, never
 * estimated. An open item already past due lands in week 0 marked at_risk; anything after
 * the last week is left out. Pure; sorted by week then id.
 */
export function scheduledItems(s: Snapshot): ScheduledItem[] {
  const week0 = firstForecastWeek(s.asOf);
  const last = addDays(week0, 7 * (WEEKLY_HORIZON_WEEKS - 1) + 6);
  const names = new Map(s.customers.map((c) => [c.id, c.name]));
  const out: ScheduledItem[] = [];
  const add = (item: Omit<ScheduledItem, "dueWeek">, date: string, overdue: boolean) => {
    // Credits (wrong-signed records) are not scheduled cash; the audit reports oddities.
    const signed = item.kind === "receivable" ? item.cents > 0 : item.cents < 0;
    if (date > last || !signed) return;
    const dueWeek =
      date < week0 ? week0 : addDays(week0, 7 * Math.floor(daysBetween(week0, date) / 7));
    out.push({ ...item, dueWeek, ...(overdue && { status: "at_risk" as const }) });
  };
  for (const i of s.invoices) {
    if (i.paid !== undefined || i.writtenOff !== undefined) continue;
    const date = i.collection?.payOn ?? i.due;
    add(
      {
        id: `sched_${i.id}`,
        kind: "receivable",
        counterparty: names.get(i.customerId) ?? i.customerId,
        cents: i.collection?.amount ?? i.amount,
        status: i.collection ? "confirmed" : "expected",
        sourceRef: i.id,
      },
      date,
      date <= s.asOf,
    );
  }
  for (const b of s.bills) {
    if (b.paid !== undefined) continue;
    const date = b.agreedPayOn ?? b.due;
    add(
      {
        id: `sched_${b.id}`,
        kind: "payable",
        counterparty: b.vendor,
        cents: -b.amount,
        status: b.agreedPayOn ? "confirmed" : "expected",
        sourceRef: b.id,
      },
      date,
      date <= s.asOf,
    );
  }
  for (const p of s.payroll) {
    if (p.date <= s.asOf) continue;
    add(
      {
        id: `sched_${p.id}`,
        kind: "payroll",
        counterparty: "Payroll",
        cents: -p.amount,
        status: "confirmed",
        sourceRef: p.id,
      },
      p.date,
      false,
    );
  }
  return out.sort((a, b) =>
    a.dueWeek < b.dueWeek ? -1 : a.dueWeek > b.dueWeek ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}
