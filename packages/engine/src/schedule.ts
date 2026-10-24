import type { Cents, CompanyModel, ISODate, Snapshot } from "@domino/contracts";
import { addDays, toMs, weekIndexOf } from "./dates";

/** One dated cash movement. Positive = money in, negative = money out. */
export type CashItem = {
  kind: "invoice" | "deal" | "bill" | "payroll" | "recurring" | "change";
  /** Source record id, or the change label */
  id: string;
  customerId?: string;
  date: ISODate;
  amount: Cents;
};

/**
 * Week bucket for a cash date. Overdue or pre-week-0 flows still have to happen, so they
 * land in week 0; flows after the last week are outside the forecast.
 */
export function bucketOf(date: ISODate, weeks: ISODate[]): number | null {
  const i = weekIndexOf(date, weeks);
  return i >= weeks.length ? null : Math.max(i, 0);
}

const delayDays = (model: CompanyModel, customerId: string) =>
  Math.round(model.customerDelayDays[customerId]?.mean ?? 0);

/** Build-spec §6.1 steps 3-6, before any changes. */
export function baseSchedule(
  snapshot: Snapshot,
  model: CompanyModel,
  weeks: ISODate[],
): CashItem[] {
  const last = weeks[weeks.length - 1];
  if (!last) throw new Error("no weeks");
  assertUniqueBillIds(snapshot);
  const horizonEnd = toMs(addDays(last, 7));
  const items: CashItem[] = [];
  for (const inv of snapshot.invoices) {
    if (inv.paid) continue;
    const date = addDays(inv.due, delayDays(model, inv.customerId));
    items.push({
      kind: "invoice",
      id: inv.id,
      customerId: inv.customerId,
      date,
      amount: inv.amount,
    });
  }
  for (const deal of uninvoicedSignedDeals(snapshot)) {
    const customer = snapshot.customers.find((c) => c.id === deal.customerId);
    if (!customer) throw new Error(`deal ${deal.id}: unknown customer ${deal.customerId}`);
    const date = addDays(
      deal.expectedClose,
      customer.paymentTermsDays + delayDays(model, deal.customerId),
    );
    items.push({
      kind: "deal",
      id: deal.id,
      customerId: deal.customerId,
      date,
      amount: deal.amount,
    });
  }
  for (const bill of snapshot.bills) {
    if (!bill.paid) items.push({ kind: "bill", id: bill.id, date: bill.due, amount: -bill.amount });
  }
  // Runs on or before asOf already left the bank and are in cashOnHand.
  for (const run of snapshot.payroll) {
    if (run.date > snapshot.asOf)
      items.push({ kind: "payroll", id: run.id, date: run.date, amount: -run.amount });
  }
  // ponytail: the model has no last-paid date, so each item is anchored at asOf + everyDays.
  // Add an anchor date to RecurringSpend if real spend dates matter.
  for (const spend of model.recurringSpend) {
    for (
      let date = addDays(snapshot.asOf, spend.everyDays);
      toMs(date) < horizonEnd;
      date = addDays(date, spend.everyDays)
    ) {
      items.push({ kind: "recurring", id: spend.label, date, amount: -spend.amount });
    }
  }
  return items;
}

/**
 * C1 linkage. A string invoiceId means that invoice carries the cash (even if already paid),
 * so the deal adds nothing; null means not invoiced, so the deal adds cash once; a missing
 * invoiceId is an unknown legacy mapping. Never guess by customer or amount.
 */
function uninvoicedSignedDeals(snapshot: Snapshot) {
  return snapshot.deals.filter((deal) => {
    if (deal.stage !== "won" || !deal.signed) return false;
    if (deal.invoiceId === undefined) {
      throw new Error(
        `unknown invoice mapping: signed won deal ${deal.id} has no invoiceId. Set it to the invoice that bills this deal, or null if it is not invoiced yet.`,
      );
    }
    if (deal.invoiceId !== null && !snapshot.invoices.some((i) => i.id === deal.invoiceId)) {
      throw new Error(`deal ${deal.id}: linked invoice ${deal.invoiceId} is not in the snapshot`);
    }
    return deal.invoiceId === null;
  });
}

/**
 * Bill targets, delays and funding days are keyed by bill ID, so a repeated ID would silently
 * select or merge the wrong bill. Refuse instead of deduplicating.
 */
export function assertUniqueBillIds(snapshot: Snapshot): void {
  const seen = new Set<string>();
  for (const bill of snapshot.bills) {
    if (seen.has(bill.id)) {
      throw new Error(`ambiguous bill id ${bill.id}: more than one bill in the snapshot uses it`);
    }
    seen.add(bill.id);
  }
}
