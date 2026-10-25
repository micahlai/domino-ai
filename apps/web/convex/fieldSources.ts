import { type Snapshot, SnapshotSchema } from "@domino/contracts";
import { z } from "zod";

/**
 * Field ingestion connector (pure, no Convex functions): page through every mock source API,
 * validate each record's source shape, map it to canonical contract records with exact cents,
 * then validate the whole result with SnapshotSchema. No money is estimated: every amount is
 * the source's own value converted exactly from cents or decimal dollars.
 */
export type Fetcher = (path: string) => Promise<Response>;
export type SourceKind = "stripe" | "crm" | "ramp" | "books" | "payroll" | "nessie";

export interface Pull {
  kind: SourceKind;
  /** Which mock API (and its endpoints) the agent called. */
  tool: string;
  endpoints: string[];
  records: number;
  pages: number;
}

export interface TieOut {
  checked: number;
  mismatches: string[];
}

export interface Ingested {
  snapshot: Snapshot;
  pulls: Pull[];
  tieOut: TieOut;
}

type Json = Record<string, unknown>;
type Style = "stripe" | "keyed" | "crm" | "cards" | "header";
const PAGE = 100;
const MAX_PAGES = 200;

async function json(fetcher: Fetcher, path: string): Promise<{ body: unknown; res: Response }> {
  const res = await fetcher(path);
  if (!res.ok) throw new Error(`mock source ${path.split("?")[0]} answered ${res.status}`);
  return { body: await res.json(), res };
}

/** Every record of one list endpoint, following that source's own cursor style. */
async function pullList(fetcher: Fetcher, path: string, style: Style) {
  const out: Json[] = [];
  let cursor: string | null = null;
  for (let pages = 1; pages <= MAX_PAGES; pages++) {
    const param =
      style === "stripe"
        ? "starting_after"
        : style === "crm"
          ? "after"
          : style === "cards"
            ? "start"
            : "cursor";
    const size = style === "cards" ? "page_size" : "limit";
    const query = `${size}=${PAGE}${cursor ? `&${param}=${encodeURIComponent(cursor)}` : ""}`;
    const { body, res } = await json(fetcher, `${path}?${query}`);
    const b = body as Json;
    let data: Json[];
    if (style === "stripe") {
      data = b.data as Json[];
      cursor = b.has_more ? String(data.at(-1)?.id) : null;
    } else if (style === "crm") {
      data = b.results as Json[];
      cursor =
        (((b.paging as Json | undefined)?.next as Json | undefined)?.after as string | null) ??
        null;
    } else if (style === "cards") {
      data = b.data as Json[];
      cursor = ((b.page as Json).next as string | null) ?? null;
    } else if (style === "header") {
      data = body as Json[];
      cursor = res.headers.get("x-next-cursor");
    } else {
      const key = Object.keys(b).find((k) => k !== "next_cursor");
      data = (key ? b[key] : []) as Json[];
      cursor = (b.next_cursor as string | null) ?? null;
    }
    if (!Array.isArray(data)) throw new Error(`mock source ${path} returned no list`);
    out.push(...data);
    if (!cursor) return { items: out, pages };
  }
  throw new Error(`mock source ${path} did not finish paging`);
}

// ---- exact unit conversion ----

/** Decimal dollars (number or string, at most 2 places) to integer cents, exactly. */
export function toCents(value: number | string): number {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(typeof value === "number" ? String(value) : value);
  if (!m) throw new Error(`not an exact dollar amount: ${value}`);
  const cents = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error("amount is too large to be exact");
  return m[1] ? -cents : cents;
}
const day = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

// ---- source record shapes (validated before mapping) ----

const n = z.number();
const nn = z.number().nullable();
const s = z.string();
const Customer = z.object({ id: s, name: s, invoice_settings: z.object({ days_until_due: n }) });
const Invoice = z.object({
  id: s,
  customer: s,
  amount_due: n,
  amount_paid: nn,
  created: n,
  due_date: n,
  status_transitions: z.object({ paid_at: nn, marked_uncollectible_at: nn }),
  billing_plan: s.nullable(),
  collection_agreement: z.object({ pay_on: n, amount: n }).nullable(),
});
const Payout = z.object({ id: s, amount: n, bank_transaction: s });
const PendingPayout = z.object({
  id: s,
  amount: n,
  expected_arrival_date: n,
  invoices: z.array(s),
});
const Plan = z.object({
  id: s,
  customer: s,
  amount: n,
  interval_count: z.union([z.literal(1), z.literal(3), z.literal(12)]),
  billing_cycle_anchor: n,
  next_invoice_date: n,
  days_until_due: n,
  ends_at: nn,
});
const Deal = z.object({
  id: s,
  properties: z
    .object({
      amount: s,
      dealstage: z.enum(["qualifiedtobuy", "closedwon", "closedlost"]),
      closedate: s,
      contract_signed: z.enum(["true", "false"]),
      company_id: s,
      deal_kind: z.enum(["new_business", "renewal", "expansion"]).nullable(),
      invoice_id: s.nullable().optional(),
    })
    .passthrough(),
});
const Card = z.object({
  id: s,
  amount: n,
  merchant_name: s,
  sk_category_name: s,
  user_transaction_time: s,
});
const BookBill = z.object({
  Id: s,
  VendorRef: z.object({ name: s }),
  TotalAmt: n,
  DueDate: s,
  PaidDate: s.nullable(),
  AgreedPayDate: s.nullable(),
  CriticalVendor: z.enum(["true", "false"]),
});
const Account = z.object({
  Id: s,
  CurrentBalance: n,
  Restricted: z.enum(["true", "false"]),
  AsOfDate: s,
});
const Payroll = z.object({
  payroll_uuid: s,
  check_date: s,
  totals: z.object({ company_debit: s }),
});
const BankTxn = z.object({
  id: s,
  type: z.enum(["deposit", "withdrawal"]),
  amount: n,
  transaction_date: s,
  description: s,
  payee: s.nullable(),
});
const Health = z.object({ companyId: s, asOf: s });

const STAGE = { qualifiedtobuy: "open", closedwon: "won", closedlost: "lost" } as const;
const each = <T>(schema: z.ZodType<T>, items: Json[], what: string): T[] =>
  items.map((item, i) => {
    const r = schema.safeParse(item);
    if (!r.success) throw new Error(`${what} record ${i} does not match its documented shape`);
    return r.data;
  });

/** Pull every mock source and map it into one validated canonical Snapshot. */
export async function ingestSources(fetcher: Fetcher): Promise<Ingested> {
  const health = Health.parse((await json(fetcher, "/health")).body);
  const pulls: Pull[] = [];
  const get = async (kind: SourceKind, tool: string, lists: [string, Style][]) => {
    const results: Json[][] = [];
    let pages = 0;
    for (const [path, style] of lists) {
      const r = await pullList(fetcher, path, style);
      results.push(r.items);
      pages += r.pages;
    }
    pulls.push({
      kind,
      tool,
      endpoints: lists.map(([p]) => p),
      records: results.reduce((sum, r) => sum + r.length, 0),
      pages,
    });
    return results;
  };

  const [customers = [], invoices = [], payouts = [], pending = [], plans = []] = await get(
    "stripe",
    "mock.billing.list",
    [
      ["/stripe/v1/customers", "stripe"],
      ["/stripe/v1/invoices", "stripe"],
      ["/stripe/v1/payouts", "stripe"],
      ["/stripe/v1/pending_payouts", "stripe"],
      ["/stripe/v1/billing_plans", "stripe"],
    ],
  );
  const [deals = []] = await get("crm", "mock.crm.list", [["/crm/crm/v3/objects/deals", "crm"]]);
  const [cards = []] = await get("ramp", "mock.cards.list", [
    ["/cards/developer/v1/transactions", "cards"],
  ]);
  const [bills = [], accounts = []] = await get("books", "mock.books.list", [
    ["/books/v1/bills", "keyed"],
    ["/books/v1/accounts", "keyed"],
  ]);
  const [payroll = []] = await get("payroll", "mock.payroll.list", [
    [`/payroll/v1/companies/${encodeURIComponent(health.companyId)}/payrolls`, "header"],
  ]);
  const [bank = []] = await get("nessie", "mock.bank.list", [["/bank/v1/transactions", "keyed"]]);

  const acct = each(Account, accounts, "books account");
  const cash = acct.find((a) => a.Restricted === "false");
  const restricted = acct.filter((a) => a.Restricted === "true");
  if (!cash) throw new Error("books has no unrestricted cash account");

  const bankTxns = each(BankTxn, bank, "bank").map((t) => ({
    id: t.id,
    date: t.transaction_date,
    amount: (t.type === "withdrawal" ? -1 : 1) * toCents(t.amount),
    description: t.description,
    ...(t.payee !== null && { counterparty: t.payee }),
  }));
  const billingPlans = each(Plan, plans, "billing plan").map((p) => ({
    id: p.id,
    customerId: p.customer,
    amount: p.amount,
    anchorDate: day(p.billing_cycle_anchor),
    nextInvoiceDate: day(p.next_invoice_date),
    everyMonths: p.interval_count,
    paymentTermsDays: p.days_until_due,
    ...(p.ends_at !== null && { endDate: day(p.ends_at) }),
  }));
  const pendingPayouts = each(PendingPayout, pending, "pending payout").map((p) => ({
    id: p.id,
    amount: p.amount,
    expectedArrival: day(p.expected_arrival_date),
    invoiceIds: p.invoices,
  }));

  const candidate = {
    companyId: health.companyId,
    asOf: cash.AsOfDate,
    cashOnHand: toCents(cash.CurrentBalance),
    restrictedCash: restricted.reduce((sum, a) => sum + toCents(a.CurrentBalance), 0),
    customers: each(Customer, customers, "customer").map((c) => ({
      id: c.id,
      name: c.name,
      paymentTermsDays: c.invoice_settings.days_until_due,
    })),
    invoices: each(Invoice, invoices, "invoice").map((i) => ({
      id: i.id,
      customerId: i.customer,
      amount: i.amount_due,
      issued: day(i.created),
      due: day(i.due_date),
      ...(i.status_transitions.paid_at !== null && { paid: day(i.status_transitions.paid_at) }),
      ...(i.amount_paid !== null && { paidAmount: i.amount_paid }),
      ...(i.billing_plan !== null && { billingPlanId: i.billing_plan }),
      ...(i.collection_agreement !== null && {
        collection: {
          payOn: day(i.collection_agreement.pay_on),
          amount: i.collection_agreement.amount,
        },
      }),
      ...(i.status_transitions.marked_uncollectible_at !== null && {
        writtenOff: day(i.status_transitions.marked_uncollectible_at),
      }),
    })),
    bankTxns,
    bills: each(BookBill, bills, "bill").map((b) => ({
      id: b.Id,
      vendor: b.VendorRef.name,
      amount: toCents(b.TotalAmt),
      due: b.DueDate,
      ...(b.PaidDate !== null && { paid: b.PaidDate }),
      ...(b.AgreedPayDate !== null && { agreedPayOn: b.AgreedPayDate }),
      critical: b.CriticalVendor === "true",
    })),
    cardTxns: each(Card, cards, "card").map((c) => ({
      id: c.id,
      date: c.user_transaction_time.slice(0, 10),
      amount: toCents(c.amount),
      merchant: c.merchant_name,
      category: c.sk_category_name,
    })),
    payroll: each(Payroll, payroll, "payroll").map((p) => ({
      id: p.payroll_uuid,
      date: p.check_date,
      amount: toCents(p.totals.company_debit),
    })),
    deals: each(Deal, deals, "deal").map((d) => ({
      id: d.id,
      customerId: d.properties.company_id,
      amount: toCents(d.properties.amount),
      stage: STAGE[d.properties.dealstage],
      expectedClose: d.properties.closedate.slice(0, 10),
      signed: d.properties.contract_signed === "true",
      // Omitted = link unknown; null = known not invoiced.
      ...("invoice_id" in d.properties && { invoiceId: d.properties.invoice_id ?? null }),
      ...(d.properties.deal_kind !== null && { kind: d.properties.deal_kind }),
    })),
    ...(billingPlans.length > 0 && { billingPlans }),
    ...(pendingPayouts.length > 0 && { pendingPayouts }),
  };
  const parsed = SnapshotSchema.safeParse(candidate);
  if (!parsed.success)
    throw new Error(
      `mapped records fail the Snapshot contract at ${parsed.error.issues
        .slice(0, 3)
        .map((i) => i.path.join("."))
        .join(", ")}`,
    );

  // Exact-cent tie-out: every Stripe payout must match the bank deposit it names.
  const byId = new Map(bankTxns.map((t) => [t.id, t]));
  const paid = each(Payout, payouts, "payout");
  const mismatches = paid
    .filter((p) => byId.get(p.bank_transaction)?.amount !== p.amount)
    .map((p) => p.id);
  return { snapshot: parsed.data, pulls, tieOut: { checked: paid.length, mismatches } };
}
