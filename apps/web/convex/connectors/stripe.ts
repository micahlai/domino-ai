import {
  BillingPlanSchema,
  CustomerSchema,
  InvoiceSchema,
  PendingPayoutSchema,
} from "@domino/contracts";
import { z } from "zod";
import type { Fetcher, Skip, Translated } from "./types";
import { MAX_PAGES, day, getJson, keepValid, parseEach } from "./vendorHttp";

/**
 * Stripe connector: customers, invoices, charges, payouts and subscriptions from the
 * Stripe-shaped mock (/vendor/stripe/v1), paged with starting_after/has_more.
 * Paid payouts are not records: the bank feed counts that cash once, so they become links
 * the merge checks against Plaid deposits. Charges fold into the invoice they paid.
 */
export const STRIPE_LISTS = [
  "customers",
  "invoices",
  "charges",
  "payouts",
  "subscriptions",
] as const;
export type StripeRaw = Record<(typeof STRIPE_LISTS)[number], unknown[]> & {
  pages: Record<string, number>;
};

const Page = z.object({
  object: z.literal("list"),
  has_more: z.boolean(),
  data: z.array(z.unknown()),
});

export async function fetchStripe(fetcher: Fetcher): Promise<StripeRaw> {
  const raw = { pages: {} } as StripeRaw;
  for (const list of STRIPE_LISTS) {
    const items: unknown[] = [];
    let after: string | null = null;
    let pages = 0;
    do {
      if (++pages > MAX_PAGES) throw new Error(`stripe ${list} did not finish paging`);
      const q = `limit=100${after ? `&starting_after=${encodeURIComponent(after)}` : ""}`;
      const page = Page.parse((await getJson(fetcher, `/vendor/stripe/v1/${list}?${q}`)).body);
      items.push(...page.data);
      const last = page.data.at(-1) as { id?: unknown } | undefined;
      after = page.has_more && typeof last?.id === "string" ? last.id : null;
    } while (after);
    raw[list] = items;
    raw.pages[`/v1/${list}`] = pages;
  }
  return raw;
}

const s = z.string();
const n = z.number().int();
const nn = n.nullable();
const Customer = z.object({
  id: s,
  object: z.literal("customer"),
  name: s,
  invoice_settings: z.object({ days_until_due: n }),
});
const Invoice = z.object({
  id: s,
  object: z.literal("invoice"),
  customer: s,
  amount_due: n,
  amount_paid: n,
  created: n,
  due_date: n,
  status: z.enum(["draft", "open", "paid", "uncollectible", "void"]),
  status_transitions: z.object({ paid_at: nn, marked_uncollectible_at: nn }),
  subscription: s.nullable(),
  metadata: z.record(s),
});
const Charge = z.object({
  id: s,
  object: z.literal("charge"),
  amount: n,
  invoice: s.nullable(),
  paid: z.boolean(),
});
const Payout = z.object({
  id: s,
  object: z.literal("payout"),
  amount: n,
  arrival_date: n,
  status: z.enum(["paid", "pending", "in_transit", "canceled", "failed"]),
  trace_id: z.object({ value: s.nullable() }),
  metadata: z.record(s),
});
const Subscription = z.object({
  id: s,
  object: z.literal("subscription"),
  customer: s,
  days_until_due: n,
  billing_cycle_anchor: n,
  current_period_end: n,
  cancel_at: nn,
  items: z.object({
    data: z
      .array(
        z.object({
          price: z.object({
            unit_amount: n,
            recurring: z.object({ interval: z.enum(["month", "year"]), interval_count: n }),
          }),
        }),
      )
      .length(1),
  }),
});

export interface StripeLinks {
  /** Paid payouts: bank trace id and amount, to tie out against the bank deposit. */
  payouts: { id: string; trace: string | null; amount: number }[];
  /** Charges with the invoice they paid. */
  charges: { id: string; invoice: string; amount: number }[];
}

const months = (interval: "month" | "year", count: number) =>
  interval === "year" ? count * 12 : count;

const InvoiceIds = z.array(s).min(1);

export function translateStripe(raw: StripeRaw): Translated<StripeLinks> {
  const skipped: Skip[] = [];
  const notes: string[] = [];
  const customers = keepValid(
    CustomerSchema,
    parseEach(Customer, raw.customers, "Stripe customer", skipped).map((c) => ({
      id: c.id,
      name: c.name,
      paymentTermsDays: c.invoice_settings.days_until_due,
    })),
    "customer",
    skipped,
  );
  const invoiceRows = parseEach(Invoice, raw.invoices, "Stripe invoice", skipped).filter((i) => {
    if (i.status === "draft" || i.status === "void") {
      skipped.push({ id: i.id, reason: `${i.status} invoices are not owed` });
      return false;
    }
    return true;
  });
  const invoices = keepValid(
    InvoiceSchema,
    invoiceRows.map((i) => {
      const promisedOn = i.metadata.promised_pay_on;
      const promised = i.metadata.promised_amount;
      return {
        id: i.id,
        customerId: i.customer,
        amount: i.amount_due,
        issued: day(i.created),
        due: day(i.due_date),
        ...(i.status_transitions.paid_at !== null && { paid: day(i.status_transitions.paid_at) }),
        // amount_paid 0 means Stripe reports no collected amount.
        ...(i.amount_paid > 0 && { paidAmount: i.amount_paid }),
        ...(i.subscription !== null && { billingPlanId: i.subscription }),
        ...(promisedOn !== undefined &&
          promised !== undefined &&
          /^\d+$/.test(promised) && {
            collection: { payOn: promisedOn, amount: Number(promised) },
          }),
        ...(i.status_transitions.marked_uncollectible_at !== null && {
          writtenOff: day(i.status_transitions.marked_uncollectible_at),
        }),
      };
    }),
    "invoice",
    skipped,
  );

  const charges = parseEach(Charge, raw.charges, "Stripe charge", skipped).flatMap((c) => {
    if (!c.paid || c.invoice === null) {
      skipped.push({ id: c.id, reason: "charge without a paid invoice" });
      return [];
    }
    skipped.push({ id: c.id, reason: `folded into invoice ${c.invoice} (paid date and amount)` });
    return [{ id: c.id, invoice: c.invoice, amount: c.amount }];
  });

  const payoutRows = parseEach(Payout, raw.payouts, "Stripe payout", skipped);
  const paid = payoutRows.filter((p) => p.status === "paid");
  const pendingPayouts = keepValid(
    PendingPayoutSchema,
    payoutRows
      .filter((p) => p.status === "in_transit" || p.status === "pending")
      .flatMap((p) => {
        const ids = InvoiceIds.safeParse(
          (() => {
            try {
              return JSON.parse(p.metadata.invoice_ids ?? "null");
            } catch {
              return null;
            }
          })(),
        );
        if (!ids.success) {
          skipped.push({ id: p.id, reason: "payout in transit names no invoices" });
          return [];
        }
        return [
          {
            id: p.id,
            amount: p.amount,
            expectedArrival: day(p.arrival_date),
            invoiceIds: ids.data,
          },
        ];
      }),
    "pending payout",
    skipped,
  );
  for (const p of payoutRows)
    if (p.status === "canceled" || p.status === "failed")
      skipped.push({ id: p.id, reason: `${p.status} payout moved no cash` });

  const billingPlans = keepValid(
    BillingPlanSchema,
    parseEach(Subscription, raw.subscriptions, "Stripe subscription", skipped).flatMap((sub) => {
      const price = sub.items.data[0]?.price;
      const every = price ? months(price.recurring.interval, price.recurring.interval_count) : 0;
      if (!price || (every !== 1 && every !== 3 && every !== 12)) {
        skipped.push({ id: sub.id, reason: "billing cadence is not monthly, quarterly or yearly" });
        return [];
      }
      return [
        {
          id: sub.id,
          customerId: sub.customer,
          amount: price.unit_amount,
          anchorDate: day(sub.billing_cycle_anchor),
          nextInvoiceDate: day(sub.current_period_end),
          everyMonths: every as 1 | 3 | 12,
          paymentTermsDays: sub.days_until_due,
          ...(sub.cancel_at !== null && { endDate: day(sub.cancel_at) }),
        },
      ];
    }),
    "billing plan",
    skipped,
  );
  if (paid.length > 0) notes.push(`${paid.length} paid payouts are counted from the bank feed`);

  return {
    lists: { customers, invoices, billingPlans, pendingPayouts },
    links: {
      payouts: paid.map((p) => ({ id: p.id, trace: p.trace_id.value, amount: p.amount })),
      charges,
    },
    skipped,
    recordsIn: STRIPE_LISTS.reduce((sum, l) => sum + raw[l].length, 0),
    notes,
  };
}
