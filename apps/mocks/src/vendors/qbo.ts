import type { Snapshot } from "@domino/contracts";
import { type Item, type VendorRoute, dollarNumber, json, sortBy } from "./common";

/**
 * QuickBooks Online-shaped mock: GET /v3/company/:realmId/query?query=<sql>. Supports
 * `select * from <Entity> [startposition N] [maxresults M]` for Account, Bill, BillPayment,
 * Invoice and Payment (maxresults 1-1000, default 100). Each entity has Id, SyncToken and
 * MetaData like the real API. Amounts are decimal dollars. The realm id is the company id.
 */
const meta = (created: string, updated: string) => ({
  CreateTime: `${created}T09:00:00-08:00`,
  LastUpdatedTime: `${updated}T09:00:00-08:00`,
});

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

function accounts(s: Snapshot): Item[] {
  return [
    {
      Id: "35",
      Name: "Operating checking",
      AccountType: "Bank",
      AccountSubType: "Checking",
      CurrentBalance: dollarNumber(s.cashOnHand),
      CurrencyRef: { value: "USD" },
      Active: true,
      SyncToken: "0",
      MetaData: meta(s.asOf, s.asOf),
    },
    {
      Id: "36",
      Name: "Lease collateral (restricted)",
      // Money held for someone else's benefit: QuickBooks' subtype for cash the company cannot use.
      AccountType: "Bank",
      AccountSubType: "TrustAccounts",
      CurrentBalance: dollarNumber(s.restrictedCash),
      CurrencyRef: { value: "USD" },
      Active: true,
      SyncToken: "0",
      MetaData: meta(s.asOf, s.asOf),
    },
  ];
}

function bills(s: Snapshot): Item[] {
  return s.bills.map((b) => ({
    Id: b.id,
    DocNumber: b.id,
    VendorRef: { value: slug(b.vendor), name: b.vendor },
    // The books keep no separate bill date for these vendors; the due date stands in.
    TxnDate: b.due,
    DueDate: b.due,
    TotalAmt: dollarNumber(b.amount),
    Balance: b.paid === undefined ? dollarNumber(b.amount) : 0,
    CustomField: [
      {
        DefinitionId: "1",
        Name: "Critical vendor",
        Type: "StringType",
        StringValue: String(b.critical),
      },
      ...(b.agreedPayOn
        ? [
            {
              DefinitionId: "2",
              Name: "Agreed pay date",
              Type: "StringType",
              StringValue: b.agreedPayOn,
            },
          ]
        : []),
    ],
    SyncToken: b.paid === undefined ? "0" : "1",
    MetaData: meta(b.due, b.paid ?? b.due),
  }));
}

function billPayments(s: Snapshot): Item[] {
  return s.bills.flatMap((b) =>
    b.paid === undefined
      ? []
      : [
          {
            Id: `bp_${b.id}`,
            // Bills paid through Ramp carry Ramp's bill id, so the two tools link by id.
            ...(!b.critical && { DocNumber: `rb_${b.id}` }),
            TxnDate: b.paid,
            PayType: "Check",
            TotalAmt: dollarNumber(b.amount),
            VendorRef: { value: slug(b.vendor), name: b.vendor },
            Line: [
              {
                Amount: dollarNumber(b.amount),
                LinkedTxn: [{ TxnId: b.id, TxnType: "Bill" }],
              },
            ],
            SyncToken: "0",
            MetaData: meta(b.paid, b.paid),
          },
        ],
  );
}

function invoices(s: Snapshot): Item[] {
  const names = new Map(s.customers.map((c) => [c.id, c.name]));
  return s.invoices.map((i) => ({
    Id: i.id,
    // Synced from Stripe: the Stripe invoice id is the document number.
    DocNumber: i.id,
    CustomerRef: { value: i.customerId, name: names.get(i.customerId) ?? i.customerId },
    TxnDate: i.issued,
    DueDate: i.due,
    TotalAmt: dollarNumber(i.amount),
    Balance: i.paid !== undefined || i.writtenOff !== undefined ? 0 : dollarNumber(i.amount),
    PrivateNote: i.writtenOff ? `Written off ${i.writtenOff}` : "Synced from Stripe",
    SyncToken: i.paid !== undefined || i.writtenOff !== undefined ? "1" : "0",
    MetaData: meta(i.issued, i.paid ?? i.writtenOff ?? i.issued),
  }));
}

function payments(s: Snapshot): Item[] {
  return s.invoices.flatMap((i) =>
    i.paid === undefined
      ? []
      : [
          {
            Id: `pmt_${i.id}`,
            TxnDate: i.paid,
            TotalAmt: dollarNumber(i.paidAmount ?? i.amount),
            CustomerRef: { value: i.customerId },
            Line: [
              {
                Amount: dollarNumber(i.paidAmount ?? i.amount),
                LinkedTxn: [{ TxnId: i.id, TxnType: "Invoice" }],
              },
            ],
            SyncToken: "0",
            MetaData: meta(i.paid, i.paid),
          },
        ],
  );
}

const ENTITIES: Record<string, (s: Snapshot) => Item[]> = {
  Account: accounts,
  Bill: bills,
  BillPayment: billPayments,
  Invoice: invoices,
  Payment: payments,
};

const QUERY = /^select \* from (\w+)(?: startposition (\d{1,7}))?(?: maxresults (\d{1,4}))?$/i;

const fault = (status: number, message: string, detail: string) =>
  json(status, {
    Fault: { Error: [{ Message: message, Detail: detail, code: "4000" }], type: "ValidationFault" },
    time: new Date(0).toISOString(),
  });

export const qboRoute: VendorRoute = (rest, url, s) => {
  const m = rest.match(/^\/v3\/company\/([^/]+)\/query$/);
  if (!m) return null;
  if (decodeURIComponent(m[1] ?? "") !== s.companyId)
    return fault(403, "Forbidden", "This app is not connected to that company.");
  const q = QUERY.exec((url.searchParams.get("query") ?? "").trim().replace(/\s+/g, " "));
  const entity =
    q?.[1] && Object.keys(ENTITIES).find((e) => e.toLowerCase() === q[1]?.toLowerCase());
  if (!q || !entity)
    return fault(
      400,
      "Error parsing query",
      "Use select * from <Entity> [startposition] [maxresults].",
    );
  const startPosition = Number(q[2] ?? 1);
  const maxResults = Number(q[3] ?? 100);
  if (startPosition < 1 || maxResults < 1 || maxResults > 1000)
    return fault(400, "Invalid paging", "startposition >= 1 and maxresults 1 to 1000.");
  const rows = sortBy(ENTITIES[entity]?.(s) ?? [], "Id").slice(
    startPosition - 1,
    startPosition - 1 + maxResults,
  );
  return json(200, {
    QueryResponse:
      rows.length === 0 ? {} : { [entity]: rows, startPosition, maxResults: rows.length },
    // The books are closed through the as-of date.
    time: `${s.asOf}T23:59:59-08:00`,
  });
};
