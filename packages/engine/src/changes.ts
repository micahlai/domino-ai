import type { Change, ISODate, Snapshot } from "@domino/contracts";
import { addDays, daysInMonth } from "./dates";
import { type CashItem, bucketOf } from "./schedule";

/**
 * Build-spec §6.7, applied in order to a copy of the cash schedule.
 * A change to a record that exists but has no cash left (paid, lost, churned) does nothing,
 * so stacked risks such as "churns" plus "pays late" still combine.
 */
export function applyChanges(
  items: CashItem[],
  changes: Change[],
  snapshot: Snapshot,
  weeks: ISODate[],
): CashItem[] {
  let out = items.map((i) => ({ ...i }));
  for (const change of changes) out = applyOne(out, change, snapshot, weeks);
  return out;
}

function applyOne(
  items: CashItem[],
  change: Change,
  snapshot: Snapshot,
  weeks: ISODate[],
): CashItem[] {
  switch (change.kind) {
    case "delay_invoice":
      requireRecord(snapshot.invoices, change.invoiceId, "invoice");
      return items.map((i) =>
        isItem(i, "invoice", change.invoiceId) ? { ...i, date: addDays(i.date, change.days) } : i,
      );
    case "lose_invoice":
      requireRecord(snapshot.invoices, change.invoiceId, "invoice");
      return items.filter((i) => !isItem(i, "invoice", change.invoiceId));
    case "churn":
      requireRecord(snapshot.customers, change.customerId, "customer");
      return items.filter(
        (i) =>
          !(
            (i.kind === "invoice" || i.kind === "deal") &&
            i.customerId === change.customerId &&
            i.date >= change.fromDate
          ),
      );
    case "add_cash":
    case "remove_cash": {
      if (change.amount < 0)
        throw new Error(`${change.kind} ${change.label}: negative amount; use the other kind`);
      const amount = change.kind === "add_cash" ? change.amount : -change.amount;
      return [...items, { kind: "change", id: change.label, date: change.date, amount }];
    }
    case "delay_bill": {
      const bill = requireRecord(snapshot.bills, change.billId, "bill");
      if (bill.critical) throw new Error(`bill ${bill.id} is critical and cannot be delayed`);
      return items.map((i) =>
        isItem(i, "bill", change.billId) ? { ...i, date: addDays(i.date, change.days) } : i,
      );
    }
    case "discount_early_pay":
      requireRecord(snapshot.invoices, change.invoiceId, "invoice");
      return items.map((i) =>
        isItem(i, "invoice", change.invoiceId)
          ? {
              ...i,
              date: change.payOn,
              amount: Math.round((i.amount * (100 - change.percent)) / 100),
            }
          : i,
      );
    case "shift_hire":
      return [...items, ...hireSavings(change, weeks)];
  }
}

/**
 * Daily rate is monthlyCost / days in that calendar month, over [fromDate, toDate).
 * Each week's total is rounded to cents once. Savings are money not spent, so they count as cash in.
 */
function hireSavings(
  change: Extract<Change, { kind: "shift_hire" }>,
  weeks: ISODate[],
): CashItem[] {
  if (change.toDate < change.fromDate)
    throw new Error(`shift_hire ${change.label}: toDate before fromDate`);
  const perWeek = new Map<number, number>();
  for (let day = change.fromDate; day < change.toDate; day = addDays(day, 1)) {
    const week = bucketOf(day, weeks);
    if (week !== null)
      perWeek.set(week, (perWeek.get(week) ?? 0) + change.monthlyCost / daysInMonth(day));
  }
  return [...perWeek].map(([week, saved]) => ({
    kind: "change" as const,
    id: change.label,
    date: weeks[week] ?? change.fromDate,
    amount: Math.round(saved),
  }));
}

const isItem = (i: CashItem, kind: CashItem["kind"], id: string) => i.kind === kind && i.id === id;

function requireRecord<T extends { id: string }>(records: T[], id: string, what: string): T {
  const found = records.find((r) => r.id === id);
  if (!found) throw new Error(`unknown ${what}: ${id}`);
  return found;
}
