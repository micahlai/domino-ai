import type { BankTxn, Deal, Snapshot } from "@domino/contracts";

/**
 * Source-shaped views of an observable Snapshot. Each source uses its own units on purpose
 * (cents vs dollar strings, Unix seconds vs ISO datetimes) so the mapping agent has real work.
 * Pure: no money math beyond exact decimal formatting of the same integer cents.
 */

/** Exact dollars text for integer cents, for example 123456 -> "1234.56". */
export function dollars(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error("money must be safe integer cents");
  const abs = Math.abs(cents);
  const whole = (abs - (abs % 100)) / 100;
  return `${cents < 0 ? "-" : ""}${whole}.${String(abs % 100).padStart(2, "0")}`;
}

/** Same exact decimal as a JSON number, for sources whose real API uses numbers. */
const dollarNumber = (cents: number) => Number(dollars(cents));

/** Midnight UTC of an ISO date, in Unix seconds. */
export function unix(date: string): number {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms)) throw new Error("invalid ISO date in snapshot");
  return ms / 1000;
}

const unixOrNull = (date: string | undefined) => (date === undefined ? null : unix(date));
const isoDatetime = (date: string) => `${date}T00:00:00.000Z`;

export const HUBSPOT_STAGE: Record<Deal["stage"], string> = {
  open: "qualifiedtobuy",
  won: "closedwon",
  lost: "closedlost",
};

/** Bank deposits from Stripe are the only observed payout evidence. */
const isStripePayout = (txn: BankTxn) => txn.counterparty === "Stripe";

export function stripeCustomers(s: Snapshot) {
  return s.customers.map((c) => ({
    id: c.id,
    object: "customer",
    name: c.name,
    invoice_settings: { days_until_due: c.paymentTermsDays },
  }));
}

export function stripeInvoices(s: Snapshot) {
  return s.invoices.map((i) => ({
    id: i.id,
    object: "invoice",
    customer: i.customerId,
    currency: "usd",
    amount_due: i.amount,
    amount_paid: i.paidAmount ?? null,
    created: unix(i.issued),
    due_date: unix(i.due),
    status: i.writtenOff !== undefined ? "uncollectible" : i.paid !== undefined ? "paid" : "open",
    status_transitions: {
      paid_at: unixOrNull(i.paid),
      marked_uncollectible_at: unixOrNull(i.writtenOff),
    },
    billing_plan: i.billingPlanId ?? null,
    collection_agreement: i.collection
      ? { pay_on: unix(i.collection.payOn), amount: i.collection.amount }
      : null,
  }));
}

export function stripePayouts(s: Snapshot) {
  return s.bankTxns.filter(isStripePayout).map((t) => ({
    id: `po_${t.id}`,
    object: "payout",
    amount: t.amount,
    currency: "usd",
    arrival_date: unix(t.date),
    status: "paid",
    bank_transaction: t.id,
    statement_descriptor: t.description,
  }));
}

export function stripePendingPayouts(s: Snapshot) {
  return (s.pendingPayouts ?? []).map((p) => ({
    id: p.id,
    object: "pending_payout",
    amount: p.amount,
    currency: "usd",
    expected_arrival_date: unix(p.expectedArrival),
    status: "pending",
    invoices: [...p.invoiceIds],
  }));
}

export function stripeBalanceTransactions(s: Snapshot) {
  const charges = s.invoices
    .filter((i) => i.paid !== undefined)
    .map((i) => ({
      id: `bt_ch_${i.id}`,
      object: "balance_transaction",
      type: "charge",
      amount: i.paidAmount ?? null,
      currency: "usd",
      created: unix(i.paid as string),
      source: i.id,
    }));
  const payouts = s.bankTxns.filter(isStripePayout).map((t) => ({
    id: `bt_po_${t.id}`,
    object: "balance_transaction",
    type: "payout",
    amount: -t.amount,
    currency: "usd",
    created: unix(t.date),
    source: `po_${t.id}`,
  }));
  return [...charges, ...payouts];
}

export function stripeBillingPlans(s: Snapshot) {
  return (s.billingPlans ?? []).map((p) => ({
    id: p.id,
    object: "billing_plan",
    customer: p.customerId,
    amount: p.amount,
    currency: "usd",
    interval: "month",
    interval_count: p.everyMonths,
    billing_cycle_anchor: unix(p.anchorDate),
    next_invoice_date: unix(p.nextInvoiceDate),
    days_until_due: p.paymentTermsDays,
    ends_at: unixOrNull(p.endDate),
  }));
}

export function crmDeals(s: Snapshot) {
  return s.deals.map((d) => {
    const properties: Record<string, string | null> = {
      dealname: d.id,
      amount: dollars(d.amount),
      dealstage: HUBSPOT_STAGE[d.stage],
      closedate: isoDatetime(d.expectedClose),
      contract_signed: d.signed ? "true" : "false",
      company_id: d.customerId,
      deal_kind: d.kind ?? null,
    };
    // Omitted = link unknown; null = known not invoiced. Keep that distinction.
    if (d.invoiceId !== undefined) properties.invoice_id = d.invoiceId;
    return { id: d.id, properties, archived: false };
  });
}

export function cardTransactions(s: Snapshot) {
  return s.cardTxns.map((t) => ({
    id: t.id,
    amount: dollarNumber(t.amount),
    currency_code: "USD",
    merchant_name: t.merchant,
    sk_category_name: t.category,
    user_transaction_time: isoDatetime(t.date),
  }));
}

export function bookBills(s: Snapshot) {
  return s.bills.map((b) => ({
    Id: b.id,
    VendorRef: { name: b.vendor },
    TotalAmt: dollarNumber(b.amount),
    Balance: b.paid === undefined ? dollarNumber(b.amount) : 0,
    DueDate: b.due,
    PaidDate: b.paid ?? null,
    AgreedPayDate: b.agreedPayOn ?? null,
    CriticalVendor: b.critical ? "true" : "false",
  }));
}

export function bookAccounts(s: Snapshot) {
  return [
    {
      Id: "acct_cash",
      Name: "Cash on hand",
      AccountType: "Bank",
      CurrentBalance: dollarNumber(s.cashOnHand),
      Restricted: "false",
      AsOfDate: s.asOf,
    },
    {
      Id: "acct_restricted",
      Name: "Restricted cash",
      AccountType: "Bank",
      CurrentBalance: dollarNumber(s.restrictedCash),
      Restricted: "true",
      AsOfDate: s.asOf,
    },
  ];
}

export function payrolls(s: Snapshot) {
  return s.payroll.map((p) => ({
    payroll_uuid: p.id,
    check_date: p.date,
    totals: { company_debit: dollars(p.amount), net_pay: null, employer_taxes: null },
  }));
}
