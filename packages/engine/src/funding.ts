import type { Cents, ISODate, Snapshot } from "@domino/contracts";
import { addDays, horizonEnd } from "./dates";
import type { CashSchedule } from "./forecast";

type QueuedBill = { id: string; date: ISODate; eligible: ISODate; amount: Cents };

/**
 * Projected funding test (E3b demo convention), not a bank payment result.
 * Replays usable cash day by day from asOf through the last forecast Sunday. Each day adds
 * inflows, subtracts non-bill outflows (payroll, recurring, one-time removals), then funds
 * unpaid bills from one queue ordered by scheduled date and bill ID: the head is paid in full
 * only if usable cash covers it, otherwise bill funding stops until the next day (no partial
 * payments, no leapfrogging). Bills leave the outflow stream, so each is deducted once.
 * Overdue items become eligible on asOf + 1. Returns each funded bill's first funded day.
 */
export function fundingDays(snapshot: Snapshot, schedule: CashSchedule): Map<string, ISODate> {
  const first = addDays(snapshot.asOf, 1);
  const end = horizonEnd(schedule.weeks);
  const flows = new Map<ISODate, Cents>();
  const bills: QueuedBill[] = [];
  for (const item of schedule.items) {
    const eligible = item.date < first ? first : item.date;
    if (eligible > end) continue;
    if (item.kind === "bill")
      bills.push({ id: item.id, date: item.date, eligible, amount: -item.amount });
    else flows.set(eligible, (flows.get(eligible) ?? 0) + item.amount);
  }
  // Eligibility never decreases along this order, so the first unfunded bill is the queue head.
  bills.sort((a, b) => (a.date === b.date ? compareIds(a.id, b.id) : a.date < b.date ? -1 : 1));
  const funded = new Map<string, ISODate>();
  let usable = snapshot.cashOnHand - snapshot.restrictedCash;
  let head = 0;
  for (let day = first; day <= end; day = addDays(day, 1)) {
    usable += flows.get(day) ?? 0;
    for (let bill = bills[head]; bill && bill.eligible <= day; bill = bills[head]) {
      if (bill.amount > usable) break;
      usable -= bill.amount;
      funded.set(bill.id, day);
      head++;
    }
  }
  return funded;
}

/** Locale-independent ID order, so results never depend on the runtime's collation. */
export const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
