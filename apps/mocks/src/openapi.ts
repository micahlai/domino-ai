/**
 * OpenAPI 3.1 documents the mapping agent reads. Every field lists its unit (x-unit) and
 * whether it can be null or omitted. Describes this mock contract, not the real providers.
 */
export type SourceName = "stripe" | "crm" | "cards" | "books" | "payroll" | "docs";

type Schema = Record<string, unknown>;
type Unit = "cents" | "dollars" | "unix_seconds" | "iso_date" | "iso_datetime" | "days" | "months";

const field = (type: string, description: string, unit?: Unit): Schema => ({
  type,
  description,
  ...(unit && { "x-unit": unit }),
});
const str = (d: string, unit?: Unit) => field("string", d, unit);
const int = (d: string, unit?: Unit) => field("integer", d, unit);
const num = (d: string, unit?: Unit) => field("number", d, unit);
const bool = (d: string) => field("boolean", d);
const lit = (value: string | boolean, d: string): Schema => ({ const: value, description: d });
const nullable = (s: Schema): Schema => ({ ...s, type: [s.type, "null"] });
const strEnum = (values: string[], d: string): Schema => ({
  type: "string",
  enum: values,
  description: d,
});
const array = (items: Schema, d = "Items"): Schema => ({ type: "array", items, description: d });
/** Keys listed in `optional` may be omitted entirely; all others are always present. */
const obj = (properties: Record<string, Schema>, optional: string[] = []): Schema => ({
  type: "object",
  properties,
  required: Object.keys(properties).filter((k) => !optional.includes(k)),
  additionalProperties: false,
});

const STRING_BOOL = 'String boolean: "true" or "false".';
const PAGE_NOTE =
  "Ordered by id (code-unit order), stable across requests. Pass the returned cursor to get the next page; every record appears exactly once.";

const limit = (name: string): Schema => ({
  name,
  in: "query",
  required: false,
  description: "Page size, 1 to 100. Default 10.",
  schema: { type: "integer", minimum: 1, maximum: 100, default: 10 },
});
const cursor = (name: string, description: string): Schema => ({
  name,
  in: "query",
  required: false,
  description,
  schema: { type: "string" },
});
const OPAQUE = "Opaque cursor from the previous page. Invalid or foreign cursors return 400.";

function list(summary: string, params: Schema[], body: Schema, headers?: Schema) {
  return {
    get: {
      summary,
      description: PAGE_NOTE,
      parameters: params,
      responses: {
        "200": {
          description: "One page",
          ...(headers && { headers }),
          content: { "application/json": { schema: body } },
        },
        "400": { description: "Invalid limit or cursor", content: { "application/json": {} } },
        "401": { description: "Missing or invalid x-api-key", content: { "application/json": {} } },
      },
    },
  };
}

const stripeList = (summary: string, item: Schema) =>
  list(
    summary,
    [limit("limit"), cursor("starting_after", "Id of the last object on the previous page.")],
    obj({
      object: lit("list", "Always list"),
      url: str("Request path"),
      data: array(item),
      has_more: bool("True when another page exists; request again with starting_after."),
    }),
  );

const keyedList = (summary: string, key: string, item: Schema) =>
  list(
    summary,
    [limit("limit"), cursor("cursor", OPAQUE)],
    obj({
      [key]: array(item),
      next_cursor: nullable(str("Cursor for the next page, or null on the last page.")),
    }),
  );

const USD = lit("usd", "Currency, always usd");

const SPECS: Record<SourceName, { title: string; paths: Record<string, unknown> }> = {
  stripe: {
    title: "Billing (Stripe-style subset)",
    paths: {
      "/v1/customers": stripeList(
        "Customers",
        obj({
          id: str("Customer id"),
          object: lit("customer", "Object type"),
          name: str("Customer name"),
          invoice_settings: obj({
            days_until_due: int("Default payment terms for new invoices", "days"),
          }),
        }),
      ),
      "/v1/invoices": stripeList(
        "Invoices",
        obj({
          id: str("Invoice id"),
          object: lit("invoice", "Object type"),
          customer: str("Customer id"),
          currency: USD,
          amount_due: int("Original invoice amount. Never changes.", "cents"),
          amount_paid: nullable(
            int(
              "Gross collected before processor fees. Null when not reported (unknown, not zero).",
              "cents",
            ),
          ),
          created: int("Issue date, midnight UTC", "unix_seconds"),
          due_date: int("Original due date, midnight UTC. Never changes.", "unix_seconds"),
          status: strEnum(["open", "paid", "uncollectible"], "uncollectible means written off"),
          status_transitions: obj({
            paid_at: nullable(int("Date the customer paid. Null if unpaid.", "unix_seconds")),
            marked_uncollectible_at: nullable(
              int("Date observed written off. Null if not written off.", "unix_seconds"),
            ),
          }),
          billing_plan: nullable(str("Billing plan id this invoice was issued for, or null")),
          collection_agreement: nullable(
            obj({
              pay_on: int("Agreed full settlement date. due_date stays original.", "unix_seconds"),
              amount: int("Agreed full settlement amount", "cents"),
            }),
          ),
        }),
      ),
      "/v1/payouts": stripeList(
        "Recorded payouts, one per Stripe deposit seen in the bank. No invoice or fee breakdown.",
        obj({
          id: str("Payout id (po_ + bank transaction id)"),
          object: lit("payout", "Object type"),
          amount: int("Net amount deposited, after fees", "cents"),
          currency: USD,
          arrival_date: int("Bank posting date", "unix_seconds"),
          status: lit("paid", "Always paid; pending payouts are a separate list"),
          bank_transaction: str("Bank transaction id of the deposit"),
          statement_descriptor: str("Bank description text"),
        }),
      ),
      "/v1/pending_payouts": stripeList(
        "Collected but not yet deposited payouts",
        obj({
          id: str("Pending payout id"),
          object: lit("pending_payout", "Object type"),
          amount: int("Net of processor fees", "cents"),
          currency: USD,
          expected_arrival_date: int("Estimated arrival, not a promise", "unix_seconds"),
          status: lit("pending", "Always pending"),
          invoices: array(str("Invoice id"), "Paid invoices batched in this payout"),
        }),
      ),
      "/v1/balance_transactions": stripeList(
        "Charges per paid invoice and payouts. Fees are not reported by this mock.",
        obj({
          id: str("Balance transaction id"),
          object: lit("balance_transaction", "Object type"),
          type: strEnum(["charge", "payout"], "charge = invoice payment, payout = deposit"),
          amount: nullable(
            int(
              "charge: gross collected, null when not reported. payout: negative net deposit.",
              "cents",
            ),
          ),
          currency: USD,
          created: int("charge: paid date; payout: bank posting date", "unix_seconds"),
          source: str("Invoice id (charge) or payout id (payout)"),
        }),
      ),
      "/v1/billing_plans": stripeList(
        "Recurring billing plans",
        obj({
          id: str("Billing plan id"),
          object: lit("billing_plan", "Object type"),
          customer: str("Customer id"),
          amount: int("Amount billed each occurrence", "cents"),
          currency: USD,
          interval: lit("month", "Always month"),
          interval_count: { type: "integer", enum: [1, 3, 12], description: "Months per cycle" },
          billing_cycle_anchor: int("Anchor date of the cadence", "unix_seconds"),
          next_invoice_date: int("First occurrence not yet invoiced", "unix_seconds"),
          days_until_due: int("Payment terms for plan invoices", "days"),
          ends_at: nullable(int("Last permitted issuance date, or null", "unix_seconds")),
        }),
      ),
    },
  },
  crm: {
    title: "CRM (HubSpot-style subset)",
    paths: {
      "/crm/v3/objects/deals": list(
        "Deals",
        [limit("limit"), cursor("after", OPAQUE)],
        obj(
          {
            results: array(
              obj({
                id: str("Deal id"),
                archived: bool("Always false"),
                properties: obj(
                  {
                    dealname: str("Deal name (this mock uses the deal id)"),
                    amount: str("Deal value, exact decimal with 2 places", "dollars"),
                    dealstage: strEnum(
                      ["qualifiedtobuy", "closedwon", "closedlost"],
                      "qualifiedtobuy = open, closedwon = won, closedlost = lost",
                    ),
                    closedate: str("Expected or actual close, midnight UTC", "iso_datetime"),
                    contract_signed: str(STRING_BOOL),
                    company_id: str("Customer id"),
                    deal_kind: nullable(
                      strEnum(["new_business", "renewal", "expansion"], "Null = unknown kind"),
                    ),
                    invoice_id: nullable(
                      str(
                        "Invoice for the full deal amount. null = known not invoiced. Omitted = link unknown.",
                      ),
                    ),
                  },
                  ["invoice_id"],
                ),
              }),
            ),
            paging: obj({ next: obj({ after: str("Cursor for the next page") }) }),
          },
          ["paging"],
        ),
      ),
    },
  },
  cards: {
    title: "Cards (Ramp-style subset)",
    paths: {
      "/developer/v1/transactions": list(
        "Card transactions",
        [limit("page_size"), cursor("start", OPAQUE)],
        obj({
          data: array(
            obj({
              id: str("Transaction id"),
              amount: num("Spend, exact decimal with up to 2 places", "dollars"),
              currency_code: lit("USD", "Always USD"),
              merchant_name: str("Merchant"),
              sk_category_name: str("Spend category"),
              user_transaction_time: str("Transaction date, midnight UTC", "iso_datetime"),
            }),
          ),
          page: obj({ next: nullable(str("Cursor for the next page, or null")) }),
        }),
      ),
    },
  },
  books: {
    title: "Books (QuickBooks-style subset)",
    paths: {
      "/v1/bills": keyedList(
        "Vendor bills",
        "Bill",
        obj({
          Id: str("Bill id"),
          VendorRef: obj({ name: str("Vendor name") }),
          TotalAmt: num("Original bill amount, exact decimal", "dollars"),
          Balance: num("Unpaid amount: TotalAmt if unpaid, 0 if paid", "dollars"),
          DueDate: str("Original due date", "iso_date"),
          PaidDate: nullable(str("Date paid, or null if unpaid", "iso_date")),
          AgreedPayDate: nullable(
            str("Known agreed payment date, or null. Not evidence of payment.", "iso_date"),
          ),
          CriticalVendor: str(`Never delay this bill. ${STRING_BOOL}`),
        }),
      ),
      "/v1/accounts": keyedList(
        "Cash accounts",
        "Account",
        obj({
          Id: str("Account id"),
          Name: str("Account name"),
          AccountType: lit("Bank", "Always Bank"),
          CurrentBalance: num(
            "acct_cash: all cash on hand. acct_restricted: the part of it the company cannot use (already inside acct_cash).",
            "dollars",
          ),
          Restricted: str(STRING_BOOL),
          AsOfDate: str("Balance date", "iso_date"),
        }),
      ),
    },
  },
  payroll: {
    title: "Payroll (Gusto-style subset)",
    paths: {
      "/v1/companies/{company_id}/payrolls": {
        ...list(
          "Payroll runs. Body is a bare array; the next cursor is in the x-next-cursor header.",
          [
            { name: "company_id", in: "path", required: true, schema: { type: "string" } },
            limit("limit"),
            cursor("cursor", OPAQUE),
          ],
          array(
            obj({
              payroll_uuid: str("Payroll run id"),
              check_date: str("Pay date", "iso_date"),
              totals: obj({
                company_debit: str("Total cash leaving the company, exact decimal", "dollars"),
                net_pay: nullable(str("Not reported by this mock: always null", "dollars")),
                employer_taxes: nullable(str("Not reported by this mock: always null", "dollars")),
              }),
            }),
          ),
          {
            "x-next-cursor": {
              description: "Cursor for the next page. Absent on the last page.",
              schema: { type: "string" },
            },
          },
        ),
      },
    },
  },
  docs: {
    title: "Company documents",
    paths: {
      "/documents": keyedList(
        "Document list",
        "documents",
        obj({
          id: str("Document id"),
          title: str("Title"),
          filename: str("Original file name"),
          content_type: lit("text/plain", "Text route content type"),
          text_url: str("Path of the text route on this server"),
          synthetic: lit(true, "Always true"),
        }),
      ),
      "/documents/{id}/text": {
        get: {
          summary: "Full document text",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description: "Text",
              content: { "text/plain": { schema: { type: "string" } } },
            },
            "404": { description: "Unknown document id", content: { "application/json": {} } },
          },
        },
      },
    },
  },
};

export function openapi(source: SourceName) {
  const spec = SPECS[source];
  return {
    openapi: "3.1.0",
    info: {
      title: spec.title,
      version: "1.0.0",
      description:
        "Synthetic mock data for the Domino demo. A documented mock contract, not real provider compatibility. Errors are JSON { error: { code, message } }.",
      "x-synthetic": true,
    },
    servers: [{ url: `/${source}` }],
    security: [{ apiKey: [] }],
    components: {
      securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "x-api-key" } },
    },
    paths: spec.paths,
  };
}
