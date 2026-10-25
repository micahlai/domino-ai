import { BillSchema, InvoiceSchema } from "@domino/contracts";
import { z } from "zod";
import type { Fetcher, Skip, Translated } from "./types";
import { MAX_PAGES, cents, dateOf, getJson, keepValid, parseEach } from "./vendorHttp";

/**
 * QuickBooks Online connector: Account, Bill, BillPayment, Invoice and Payment through the
 * query endpoint (/vendor/qbo/v3/company/:realmId/query), paged with STARTPOSITION and
 * MAXRESULTS. The books are the record for bills and balances; invoices synced from Stripe
 * carry the Stripe id as DocNumber so the merge keeps one copy.
 */
export const QBO_ENTITIES = ["Account", "Bill", "BillPayment", "Invoice", "Payment"] as const;
type Entity = (typeof QBO_ENTITIES)[number];
export type QboRaw = Record<Entity, unknown[]> & { pages: Record<string, number>; time: string };

const PAGE = 1000;
const Response = z.object({
  QueryResponse: z.record(z.unknown()),
  time: z.string(),
});

export async function fetchQbo(fetcher: Fetcher, realmId: string): Promise<QboRaw> {
  const raw = { pages: {}, time: "" } as QboRaw;
  for (const entity of QBO_ENTITIES) {
    const rows: unknown[] = [];
    let start = 1;
    let pages = 0;
    for (;;) {
      if (++pages > MAX_PAGES) throw new Error(`qbo ${entity} did not finish paging`);
      const query = `select * from ${entity} startposition ${start} maxresults ${PAGE}`;
      const path = `/vendor/qbo/v3/company/${encodeURIComponent(realmId)}/query?query=${encodeURIComponent(query)}&minorversion=75`;
      const body = Response.parse((await getJson(fetcher, path)).body);
      raw.time = body.time;
      const got = body.QueryResponse[entity];
      const page = Array.isArray(got) ? got : [];
      rows.push(...page);
      if (page.length < PAGE) break;
      start += PAGE;
    }
    raw[entity] = rows;
    raw.pages[`query ${entity}`] = pages;
  }
  return raw;
}

const s = z.string();
const amt = z.number();
const Ref = z.object({ value: s, name: s.optional() });
const Account = z.object({
  Id: s,
  Name: s,
  AccountType: s,
  AccountSubType: s,
  CurrentBalance: amt,
  Active: z.boolean(),
});
const Bill = z.object({
  Id: s,
  DocNumber: s,
  VendorRef: Ref,
  DueDate: s,
  TotalAmt: amt,
  Balance: amt,
  CustomField: z.array(z.object({ Name: s, StringValue: s.optional() })).default([]),
});
const Linked = z.array(
  z.object({ Amount: amt, LinkedTxn: z.array(z.object({ TxnId: s, TxnType: s })) }),
);
const BillPayment = z.object({
  Id: s,
  DocNumber: s.optional(),
  TxnDate: s,
  TotalAmt: amt,
  Line: Linked,
});
const Invoice = z.object({
  Id: s,
  DocNumber: s,
  CustomerRef: Ref,
  TxnDate: s,
  DueDate: s,
  TotalAmt: amt,
  Balance: amt,
  PrivateNote: s.optional(),
});
const Payment = z.object({ Id: s, TxnDate: s, TotalAmt: amt, Line: Linked });

export interface QboLinks {
  /** Bill payments: which bill, paid when, how much, and the Ramp bill id when paid there. */
  billPayments: {
    id: string;
    billId: string;
    date: string;
    amount: number;
    rampId: string | null;
  }[];
}

/** Bank accounts QuickBooks marks as holding money for someone else: cash the company cannot use. */
const RESTRICTED_SUBTYPES = new Set(["TrustAccounts", "RentsHeldInTrust"]);

const field = (fields: { Name: string; StringValue?: string }[], name: string) =>
  fields.find((f) => f.Name === name)?.StringValue;

const linksTo = (lines: z.infer<typeof Linked>, type: string) =>
  lines.flatMap((l) => l.LinkedTxn.filter((t) => t.TxnType === type).map((t) => t.TxnId));

export function translateQbo(raw: QboRaw): Translated<QboLinks> {
  const skipped: Skip[] = [];
  const notes: string[] = [];
  const accounts = parseEach(Account, raw.Account, "QuickBooks account", skipped).filter((a) => {
    const bank = a.AccountType === "Bank" && a.Active;
    if (!bank) skipped.push({ id: a.Id, reason: "not an active bank account" });
    return bank;
  });
  const cash = accounts.filter((a) => !RESTRICTED_SUBTYPES.has(a.AccountSubType));
  const restricted = accounts.filter((a) => RESTRICTED_SUBTYPES.has(a.AccountSubType));
  const sum = (xs: { CurrentBalance: number }[]) =>
    xs.reduce((t, a) => t + cents(a.CurrentBalance), 0);

  const payments = parseEach(BillPayment, raw.BillPayment, "QuickBooks bill payment", skipped);
  const billPayments = payments.flatMap((p) =>
    linksTo(p.Line, "Bill").map((billId) => ({
      id: p.Id,
      billId,
      date: dateOf(p.TxnDate),
      amount: cents(p.TotalAmt),
      rampId: p.DocNumber?.startsWith("rb_") ? p.DocNumber : null,
    })),
  );
  const paidOn = new Map(billPayments.map((p) => [p.billId, p.date]));
  for (const p of payments) skipped.push({ id: p.Id, reason: "folded into the bill it paid" });

  const bills = keepValid(
    BillSchema,
    parseEach(Bill, raw.Bill, "QuickBooks bill", skipped).map((b) => {
      const agreed = field(b.CustomField, "Agreed pay date");
      const paid = b.Balance === 0 ? paidOn.get(b.Id) : undefined;
      return {
        id: b.DocNumber,
        vendor: b.VendorRef.name ?? b.VendorRef.value,
        amount: cents(b.TotalAmt),
        due: dateOf(b.DueDate),
        ...(paid !== undefined && { paid }),
        ...(agreed !== undefined && { agreedPayOn: agreed }),
        critical: field(b.CustomField, "Critical vendor") === "true",
      };
    }),
    "bill",
    skipped,
  );

  const customerPaid = new Map<string, { date: string; amount: number }>();
  for (const p of parseEach(Payment, raw.Payment, "QuickBooks payment", skipped)) {
    for (const invoiceId of linksTo(p.Line, "Invoice"))
      customerPaid.set(invoiceId, { date: dateOf(p.TxnDate), amount: cents(p.TotalAmt) });
    skipped.push({ id: p.Id, reason: "folded into the invoice it paid" });
  }
  const invoices = keepValid(
    InvoiceSchema,
    parseEach(Invoice, raw.Invoice, "QuickBooks invoice", skipped).map((i) => {
      const paid = customerPaid.get(i.Id);
      const writtenOff = /^Written off (\d{4}-\d{2}-\d{2})$/.exec(i.PrivateNote ?? "")?.[1];
      return {
        id: i.DocNumber,
        customerId: i.CustomerRef.value,
        amount: cents(i.TotalAmt),
        issued: dateOf(i.TxnDate),
        due: dateOf(i.DueDate),
        ...(paid && { paid: paid.date, paidAmount: paid.amount }),
        ...(!paid && writtenOff && { writtenOff }),
      };
    }),
    "invoice",
    skipped,
  );

  if (cash.length === 0) notes.push("no unrestricted bank account in the books");
  return {
    lists: { bills, invoices },
    ...(cash.length > 0 && {
      balances: { asOf: dateOf(raw.time), cashOnHand: sum(cash), restrictedCash: sum(restricted) },
    }),
    links: { billPayments },
    skipped,
    recordsIn: QBO_ENTITIES.reduce((t, e) => t + raw[e].length, 0),
    notes,
  };
}
