import type { Snapshot } from "@domino/contracts";
import {
  type Item,
  type VendorRoute,
  intParam,
  isStripeDeposit,
  json,
  sortBy,
  unix,
} from "./common";

/**
 * Stripe-shaped mock (subset of /v1): customers, invoices, charges, payouts, subscriptions.
 * Cursor pagination with `limit` (1-100, default 10), `starting_after` (an object id) and
 * `has_more`, like the real list API. Amounts are integer cents, dates Unix seconds.
 */
const unixOrNull = (d: string | undefined) => (d === undefined ? null : unix(d));

export function customers(s: Snapshot): Item[] {
  return s.customers.map((c) => ({
    id: c.id,
    object: "customer",
    name: c.name,
    currency: "usd",
    invoice_settings: { days_until_due: c.paymentTermsDays },
    metadata: {},
  }));
}

export function invoices(s: Snapshot): Item[] {
  return s.invoices.map((i) => ({
    id: i.id,
    object: "invoice",
    customer: i.customerId,
    currency: "usd",
    collection_method: "send_invoice",
    amount_due: i.amount,
    // Real Stripe always sends a number: 0 means no collected amount is known.
    amount_paid: i.paidAmount ?? 0,
    amount_remaining: i.paid !== undefined || i.writtenOff !== undefined ? 0 : i.amount,
    created: unix(i.issued),
    due_date: unix(i.due),
    status: i.writtenOff !== undefined ? "uncollectible" : i.paid !== undefined ? "paid" : "open",
    status_transitions: {
      finalized_at: unix(i.issued),
      paid_at: unixOrNull(i.paid),
      marked_uncollectible_at: unixOrNull(i.writtenOff),
    },
    subscription: i.billingPlanId ?? null,
    // Stripe has no promise-to-pay object; the finance team records it as invoice metadata.
    metadata: i.collection
      ? { promised_pay_on: i.collection.payOn, promised_amount: String(i.collection.amount) }
      : {},
  }));
}

export function charges(s: Snapshot): Item[] {
  return s.invoices.flatMap((i) =>
    i.paid === undefined
      ? []
      : [
          {
            id: `ch_${i.id}`,
            object: "charge",
            amount: i.paidAmount ?? i.amount,
            amount_captured: i.paidAmount ?? i.amount,
            currency: "usd",
            customer: i.customerId,
            invoice: i.id,
            paid: true,
            captured: true,
            status: "succeeded",
            created: unix(i.paid),
          },
        ],
  );
}

export function payouts(s: Snapshot): Item[] {
  const paid = s.bankTxns.filter(isStripeDeposit).map((t) => ({
    id: `po_${t.id}`,
    object: "payout",
    amount: t.amount,
    currency: "usd",
    arrival_date: unix(t.date),
    created: unix(t.date),
    method: "standard",
    type: "bank_account",
    destination: "ba_mock_operating",
    status: "paid",
    statement_descriptor: t.description,
    // The trace id is what the bank shows as the reference number on the deposit.
    trace_id: { status: "supported", value: t.id },
    metadata: {},
  }));
  const inTransit = (s.pendingPayouts ?? []).map((p) => ({
    id: p.id,
    object: "payout",
    amount: p.amount,
    currency: "usd",
    arrival_date: unix(p.expectedArrival),
    created: unix(s.asOf),
    method: "standard",
    type: "bank_account",
    destination: "ba_mock_operating",
    status: "in_transit",
    statement_descriptor: "STRIPE PAYOUT",
    trace_id: { status: "pending", value: null },
    // Invoice ids can contain commas, so the list is JSON text (metadata values are strings).
    metadata: { invoice_ids: JSON.stringify(p.invoiceIds) },
  }));
  return [...paid, ...inTransit];
}

export function subscriptions(s: Snapshot): Item[] {
  return (s.billingPlans ?? []).map((p) => {
    const recurring =
      p.everyMonths === 12
        ? { interval: "year", interval_count: 1 }
        : { interval: "month", interval_count: p.everyMonths };
    const ended = p.endDate !== undefined && p.endDate < p.nextInvoiceDate;
    return {
      id: p.id,
      object: "subscription",
      customer: p.customerId,
      status: ended ? "canceled" : "active",
      collection_method: "send_invoice",
      days_until_due: p.paymentTermsDays,
      billing_cycle_anchor: unix(p.anchorDate),
      // The next invoice is issued when the current period ends.
      current_period_end: unix(p.nextInvoiceDate),
      cancel_at: p.endDate === undefined ? null : unix(p.endDate),
      items: {
        object: "list",
        data: [{ id: `si_${p.id}`, price: { unit_amount: p.amount, currency: "usd", recurring } }],
      },
    };
  });
}

const LISTS: Record<string, (s: Snapshot) => Item[]> = {
  "/v1/customers": customers,
  "/v1/invoices": invoices,
  "/v1/charges": charges,
  "/v1/payouts": payouts,
  "/v1/subscriptions": subscriptions,
};

const error = (status: number, message: string, param?: string) =>
  json(status, { error: { type: "invalid_request_error", message, ...(param && { param }) } });

export const stripeRoute: VendorRoute = (rest, url, s) => {
  const list = LISTS[rest];
  if (!list) return null;
  const limit = intParam(url, "limit", 1, 100) ?? 10;
  if (Number.isNaN(limit)) return error(400, "limit must be an integer from 1 to 100.", "limit");
  const items = sortBy(list(s), "id");
  const after = url.searchParams.get("starting_after");
  let start = 0;
  if (after !== null) {
    const at = items.findIndex((i) => i.id === after);
    if (at < 0) return error(400, `No such object: '${after}'`, "starting_after");
    start = at + 1;
  }
  const data = items.slice(start, start + limit);
  return json(200, {
    object: "list",
    url: `/v1${rest.slice(3)}`,
    has_more: start + limit < items.length,
    data,
  });
};
