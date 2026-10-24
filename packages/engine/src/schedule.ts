import type { Cents, CompanyModel, ISODate, Invoice, Snapshot } from "@domino/contracts";
import { addDays, addMonthsClamped, horizonEnd, monthsBetween, toMs, weekIndexOf } from "./dates";

/** One dated cash movement. Positive = money in, negative = money out. */
export type CashItem = {
  kind: "invoice" | "deal" | "plan" | "payout" | "bill" | "payroll" | "recurring" | "change";
  /** Source record id, the change label, or JSON [planId, issueDate] for a planned occurrence */
  id: string;
  customerId?: string;
  /** Billing plan behind a "plan" occurrence */
  planId?: string;
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
  const endMs = toMs(addDays(last, 7));
  const items: CashItem[] = [];
  for (const inv of snapshot.invoices) {
    if (inv.paid || inv.writtenOff) continue;
    // An observable agreement replaces the inferred date and the original amount.
    const date =
      inv.collection?.payOn ??
      notBefore(addDays(inv.due, delayDays(model, inv.customerId)), inv.issued);
    const amount = inv.collection?.amount ?? inv.amount;
    items.push({ kind: "invoice", id: inv.id, customerId: inv.customerId, date, amount });
  }
  items.push(...planReceipts(snapshot, model, horizonEnd(weeks)));
  // Collected already, so customer churn or invoice changes cannot cancel it.
  for (const payout of snapshot.pendingPayouts ?? []) {
    items.push({
      kind: "payout",
      id: payout.id,
      date: payout.expectedArrival,
      amount: payout.amount,
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
  // Deadline rules still read bill.due; only the cash date follows the agreement.
  for (const bill of snapshot.bills) {
    if (!bill.paid)
      items.push({
        kind: "bill",
        id: bill.id,
        date: bill.agreedPayOn ?? bill.due,
        amount: -bill.amount,
      });
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
      toMs(date) < endMs;
      date = addDays(date, spend.everyDays)
    ) {
      items.push({ kind: "recurring", id: spend.label, date, amount: -spend.amount });
    }
  }
  return items;
}

/**
 * A paid invoice whose timing reflects the customer's own habit. An agreed collection or a
 * discounted settlement was negotiated, so its date is not organic delay evidence.
 */
export const isOrganicPayment = (inv: Invoice): inv is Invoice & { paid: string } =>
  inv.paid !== undefined &&
  inv.collection === undefined &&
  (inv.paidAmount === undefined || inv.paidAmount === inv.amount);

// Same-shape ISO dates order correctly as strings.
const notBefore = (date: ISODate, floor: ISODate) => (date < floor ? floor : date);

/**
 * Unissued occurrences from each plan's cursor, issued on or before the horizon end (a later
 * issue can never be received inside it) and endDate. Receipt = issue + plan terms + rounded
 * learned delay, never before issue. Issued occurrences are already invoices, so none repeat.
 */
function planReceipts(snapshot: Snapshot, model: CompanyModel, lastDay: ISODate): CashItem[] {
  const items: CashItem[] = [];
  for (const plan of snapshot.billingPlans ?? []) {
    const stop = plan.endDate !== undefined && plan.endDate < lastDay ? plan.endDate : lastDay;
    const start = monthsBetween(plan.anchorDate, plan.nextInvoiceDate);
    for (let k = start; ; k += plan.everyMonths) {
      const issued = addMonthsClamped(plan.anchorDate, k);
      if (issued > stop) break;
      const terms = plan.paymentTermsDays + delayDays(model, plan.customerId);
      items.push({
        kind: "plan",
        // An encoded tuple: distinct plan/date pairs never share an ID. Changes and dominoes
        // match by kind too, so an invoice whose ID happens to equal this is never confused.
        id: JSON.stringify([plan.id, issued]),
        planId: plan.id,
        customerId: plan.customerId,
        date: notBefore(addDays(issued, terms), issued),
        amount: plan.amount,
      });
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
