import { type Snapshot, SnapshotSchema } from "@domino/contracts";
import { fixtures } from "@domino/contracts/fixtures";
import { describe, expect, it } from "vitest";
import { DOCUMENTS } from "./docs";
import { createMockHandler } from "./handler";
import { openapi } from "./openapi";
import { dollars } from "./sources";

const KEY = "test-key-not-secret";

/** Fixture snapshot plus every optional C3 field, valid under SnapshotSchema. */
const snapshot: Snapshot = SnapshotSchema.parse({
  ...fixtures.snapshot,
  invoices: [
    ...fixtures.snapshot.invoices.map((i) =>
      i.id === "inv_nw_q4" ? { ...i, collection: { payOn: "2026-12-15", amount: 25_000_000 } } : i,
    ),
    {
      id: "inv_bp_oct",
      customerId: "cus_brightpath",
      amount: 3_600_000,
      issued: "2026-10-01",
      due: "2026-10-31",
      paid: "2026-10-20",
      paidAmount: 3_600_000,
      billingPlanId: "plan_bp",
    },
    {
      id: "inv_acme_hist",
      customerId: "cus_acme",
      amount: 1_234_567,
      issued: "2026-08-01",
      due: "2026-08-31",
      paid: "2026-09-10",
    },
    {
      id: "inv_cobalt_old",
      customerId: "cus_cobalt",
      amount: 50_001,
      issued: "2026-06-01",
      due: "2026-07-01",
      writtenOff: "2026-10-01",
    },
  ],
  bankTxns: [
    ...fixtures.snapshot.bankTxns,
    {
      id: "bank_inv_acme_hist",
      date: "2026-09-12",
      amount: 1_198_765,
      description: "STRIPE PAYOUT inv_acme_hist NET FEES",
      counterparty: "Stripe",
    },
  ],
  bills: [
    ...fixtures.snapshot.bills.map((b) =>
      b.id === "bill_agency_nov" ? { ...b, agreedPayOn: "2026-11-29" } : b,
    ),
    {
      id: "bill_paid_oct",
      vendor: "Law firm",
      amount: 123_45,
      due: "2026-10-12",
      paid: "2026-10-10",
      critical: false,
    },
  ],
  cardTxns: [
    ...fixtures.snapshot.cardTxns,
    { id: "card_003", date: "2026-10-29", amount: 1999, merchant: "UBER", category: "Travel" },
    { id: "card_004", date: "2026-10-29", amount: -505, merchant: "UBER", category: "Travel" },
  ],
  deals: [
    ...fixtures.snapshot.deals,
    {
      id: "deal_cobalt_open",
      customerId: "cus_cobalt",
      amount: 7_000_01,
      stage: "open",
      expectedClose: "2026-12-01",
      signed: false,
    },
    {
      id: "deal_lost",
      customerId: "cus_acme",
      amount: 100,
      stage: "lost",
      expectedClose: "2026-09-01",
      signed: false,
      invoiceId: null,
      kind: "new_business",
    },
  ],
  billingPlans: [
    {
      id: "plan_bp",
      customerId: "cus_brightpath",
      amount: 3_600_000,
      anchorDate: "2026-09-01",
      nextInvoiceDate: "2026-11-01",
      everyMonths: 1,
      paymentTermsDays: 30,
      endDate: "2027-08-01",
    },
    {
      id: "plan_acme",
      customerId: "cus_acme",
      amount: 24_000_000,
      anchorDate: "2026-11-25",
      nextInvoiceDate: "2027-02-25",
      everyMonths: 3,
      paymentTermsDays: 30,
    },
  ],
  pendingPayouts: [
    {
      id: "pend_1",
      amount: 3_495_600,
      expectedArrival: "2026-11-02",
      invoiceIds: ["inv_bp_oct"],
    },
  ],
});

/** A full private world, passed where only a snapshot belongs, to prove stripping. */
const PRIVATE = "PRIVATE_MARKER";
const leakyWorld = {
  ...snapshot,
  pendingEvents: [{ label: PRIVATE }],
  runtime: { collections: [{ invoiceId: PRIVATE }] },
  answerKey: PRIVATE,
};

const handler = createMockHandler({ apiKey: KEY, snapshot: () => leakyWorld as Snapshot });
const get = (path: string, key: string | null = KEY, method = "GET") =>
  handler(
    new Request(`http://mocks.test${path}`, {
      method,
      headers: key === null ? {} : { "x-api-key": key },
    }),
  );

type Json = Record<string, unknown>;
async function body(path: string): Promise<Json> {
  const res = await get(path);
  expect(res.status, path).toBe(200);
  return (await res.json()) as Json;
}

/** Follows each source's own cursor style until the end, at page size 2. */
async function all(path: string): Promise<Json[]> {
  const out: Json[] = [];
  let query = "limit=2";
  for (let guard = 0; guard < 100; guard++) {
    const sep = path.includes("?") ? "&" : "?";
    if (path.startsWith("/stripe")) {
      const page = await body(`${path}${sep}${query}`);
      const data = page.data as Json[];
      out.push(...data);
      if (!page.has_more) return out;
      query = `limit=2&starting_after=${data.at(-1)?.id}`;
    } else if (path.startsWith("/crm")) {
      const page = await body(`${path}${sep}${query}`);
      out.push(...(page.results as Json[]));
      const after = (page.paging as { next: { after: string } } | undefined)?.next.after;
      if (!after) return out;
      query = `limit=2&after=${after}`;
    } else if (path.startsWith("/cards")) {
      const page = await body(`${path}${sep}${query.replace("limit", "page_size")}`);
      out.push(...(page.data as Json[]));
      const next = (page.page as { next: string | null }).next;
      if (!next) return out;
      query = `limit=2&start=${next}`;
    } else if (path.startsWith("/payroll")) {
      const res = await get(`${path}${sep}${query}`);
      out.push(...((await res.json()) as Json[]));
      const next = res.headers.get("x-next-cursor");
      if (!next) return out;
      query = `limit=2&cursor=${next}`;
    } else {
      const page = await body(`${path}${sep}${query}`);
      const key = Object.keys(page).find((k) => k !== "next_cursor") as string;
      out.push(...(page[key] as Json[]));
      if (!page.next_cursor) return out;
      query = `limit=2&cursor=${page.next_cursor}`;
    }
  }
  throw new Error("pagination did not end");
}

// ---- test-only decoders: source shape back to canonical, exact and money-math free ----
function cents(text: string): number {
  const m = /^(-?)(\d+)\.(\d{2})$/.exec(text);
  if (!m) throw new Error(`not exact dollars: ${text}`);
  return (m[1] ? -1 : 1) * (Number(m[2]) * 100 + Number(m[3]));
}
const numCents = (n: number) => cents(n.toFixed(2));
const day = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);
const optDay = (unix: number | null) => (unix === null ? undefined : day(unix));
const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => (a.id < b.id ? -1 : 1));
const strip = <T extends object>(o: T) => JSON.parse(JSON.stringify(o)) as T;

const ROUTES = [
  "/stripe/v1/customers",
  "/stripe/v1/invoices",
  "/stripe/v1/payouts",
  "/stripe/v1/pending_payouts",
  "/stripe/v1/balance_transactions",
  "/stripe/v1/billing_plans",
  "/crm/crm/v3/objects/deals",
  "/cards/developer/v1/transactions",
  "/books/v1/bills",
  "/books/v1/accounts",
  "/payroll/v1/companies/kestrel/payrolls",
  "/bank/v1/transactions",
  "/docs/documents",
];

describe("decoded sources match the observable snapshot", () => {
  it("billing customers, invoices, plans and pending payouts", async () => {
    const customers = (await all("/stripe/v1/customers")).map((c) => ({
      id: c.id,
      name: c.name,
      paymentTermsDays: (c.invoice_settings as Json).days_until_due,
    }));
    expect(customers).toEqual(byId(snapshot.customers));

    const invoices = (await all("/stripe/v1/invoices")).map((raw) => {
      const i = raw as Json & { status_transitions: Json; collection_agreement: Json | null };
      return strip({
        id: i.id,
        customerId: i.customer,
        amount: i.amount_due,
        issued: day(i.created as number),
        due: day(i.due_date as number),
        paid: optDay(i.status_transitions.paid_at as number | null),
        billingPlanId: i.billing_plan ?? undefined,
        collection: i.collection_agreement
          ? {
              payOn: day(i.collection_agreement.pay_on as number),
              amount: i.collection_agreement.amount,
            }
          : undefined,
        paidAmount: i.amount_paid ?? undefined,
        writtenOff: optDay(i.status_transitions.marked_uncollectible_at as number | null),
      });
    });
    expect(invoices).toEqual(strip(byId(snapshot.invoices)));

    const plans = (await all("/stripe/v1/billing_plans")).map((p) =>
      strip({
        id: p.id,
        customerId: p.customer,
        amount: p.amount,
        anchorDate: day(p.billing_cycle_anchor as number),
        nextInvoiceDate: day(p.next_invoice_date as number),
        everyMonths: p.interval_count,
        paymentTermsDays: p.days_until_due,
        endDate: optDay(p.ends_at as number | null),
      }),
    );
    expect(plans).toEqual(strip(byId(snapshot.billingPlans ?? [])));

    const pending = (await all("/stripe/v1/pending_payouts")).map((p) => ({
      id: p.id,
      amount: p.amount,
      expectedArrival: day(p.expected_arrival_date as number),
      invoiceIds: p.invoices,
    }));
    expect(pending).toEqual(snapshot.pendingPayouts);
  });

  it("recorded payouts come only from Stripe bank deposits, with no invented fee or invoice link", async () => {
    const payouts = await all("/stripe/v1/payouts");
    const stripeTxns = snapshot.bankTxns.filter((t) => t.counterparty === "Stripe");
    expect(
      payouts.map((p) => [p.bank_transaction, p.amount, day(p.arrival_date as number)]),
    ).toEqual(byId(stripeTxns).map((t) => [t.id, t.amount, t.date]));
    for (const p of payouts) expect(Object.keys(p)).not.toContain("invoices");
    const balance = await all("/stripe/v1/balance_transactions");
    for (const b of balance) expect(Object.keys(b)).not.toContain("fee");
    // Legacy paid invoice without a reported gross stays null, not guessed.
    expect(balance.find((b) => b.source === "inv_acme_hist")?.amount).toBeNull();
    expect(balance.find((b) => b.source === "inv_bp_oct")?.amount).toBe(3_600_000);
  });

  it("shows an invoice paid before its money reaches the bank", async () => {
    const invoices = await all("/stripe/v1/invoices");
    const bp = invoices.find((i) => i.id === "inv_bp_oct") as Json & { status_transitions: Json };
    expect(bp.status).toBe("paid");
    expect(day(bp.status_transitions.paid_at as number)).toBe("2026-10-20");
    const payouts = await all("/stripe/v1/payouts");
    expect(payouts.some((p) => String(p.statement_descriptor).includes("inv_bp_oct"))).toBe(false);
    const pending = await all("/stripe/v1/pending_payouts");
    expect(pending.map((p) => p.invoices)).toEqual([["inv_bp_oct"]]);
  });

  it("crm deals keep unknown versus not-invoiced links and exact dollars", async () => {
    const stages: Record<string, string> = {
      closedwon: "won",
      closedlost: "lost",
      qualifiedtobuy: "open",
    };
    const deals = (await all("/crm/crm/v3/objects/deals")).map((d) => {
      const p = d.properties as Record<string, string | null>;
      return strip({
        id: d.id,
        customerId: p.company_id,
        amount: cents(p.amount as string),
        stage: stages[p.dealstage as string],
        expectedClose: (p.closedate as string).slice(0, 10),
        signed: p.contract_signed === "true",
        invoiceId: "invoice_id" in p ? p.invoice_id : undefined,
        kind: p.deal_kind ?? undefined,
      });
    });
    expect(deals).toEqual(strip(byId(snapshot.deals)));
    const raw = await all("/crm/crm/v3/objects/deals");
    const props = (id: string) => raw.find((d) => d.id === id)?.properties as Json;
    expect("invoice_id" in props("deal_cobalt_open")).toBe(false);
    expect(props("deal_lost").invoice_id).toBeNull();
  });

  it("cards, bills, accounts and payroll", async () => {
    const cards = (await all("/cards/developer/v1/transactions")).map((t) => ({
      id: t.id,
      date: (t.user_transaction_time as string).slice(0, 10),
      amount: numCents(t.amount as number),
      merchant: t.merchant_name,
      category: t.sk_category_name,
    }));
    expect(cards).toEqual(byId(snapshot.cardTxns));

    const bills = (await all("/books/v1/bills")).map((b) =>
      strip({
        id: b.Id,
        vendor: (b.VendorRef as Json).name,
        amount: numCents(b.TotalAmt as number),
        due: b.DueDate,
        paid: b.PaidDate ?? undefined,
        agreedPayOn: b.AgreedPayDate ?? undefined,
        critical: b.CriticalVendor === "true",
      }),
    );
    expect(bills).toEqual(strip(byId(snapshot.bills)));

    const accounts = await all("/books/v1/accounts");
    expect(accounts.map((a) => [a.Restricted, numCents(a.CurrentBalance as number)])).toEqual([
      ["false", snapshot.cashOnHand],
      ["true", snapshot.restrictedCash],
    ]);

    const payroll = (await all("/payroll/v1/companies/kestrel/payrolls")).map((p) => ({
      id: p.payroll_uuid,
      date: p.check_date,
      amount: cents((p.totals as Json).company_debit as string),
    }));
    expect(payroll).toEqual(byId(snapshot.payroll));
  });

  it("documents list and text", async () => {
    const docs = await all("/docs/documents");
    expect(docs.map((d) => d.id)).toEqual(DOCUMENTS.map((d) => d.id).sort());
    const res = await get("/docs/documents/loan-agreement/text");
    expect(res.headers.get("content-type")).toContain("text/plain");
    const text = await res.text();
    expect(text).toContain("Unrestricted Cash of not less than $3,000,000");
    expect(text).toContain("SYNTHETIC");
  });
});

describe("bank", () => {
  it("serves every bank transaction with unsigned dollars and a direction", async () => {
    const txns = await all("/bank/v1/transactions");
    const decoded = txns.map((t) => ({
      id: t.id,
      date: t.transaction_date,
      amount: (t.type === "withdrawal" ? -1 : 1) * numCents(t.amount as number),
      description: t.description,
      ...(t.payee !== null && { counterparty: t.payee }),
    }));
    expect(decoded).toEqual(byId(strip(snapshot.bankTxns)));
  });
});

describe("dollars", () => {
  it("formats exact cents", () => {
    expect([0, 5, -505, 123456, 9_007_199_254_740_991].map(dollars)).toEqual([
      "0.00",
      "0.05",
      "-5.05",
      "1234.56",
      "90071992547409.91",
    ]);
    expect(() => dollars(0.5)).toThrow();
  });
});

describe("pagination", () => {
  it("returns every record exactly once across pages", async () => {
    for (const route of ROUTES) {
      const records = await all(route);
      const ids = records.map((r) => (r.id ?? r.Id ?? r.payroll_uuid) as string);
      expect(new Set(ids).size, route).toBe(ids.length);
      expect(ids, route).toEqual([...ids].sort());
    }
    expect((await all("/stripe/v1/invoices")).length).toBe(snapshot.invoices.length);
  });

  it("rejects bad limits and malformed, foreign or unknown cursors", async () => {
    const cases = [
      "/stripe/v1/invoices?limit=0",
      "/stripe/v1/invoices?limit=101",
      "/stripe/v1/invoices?limit=abc",
      "/stripe/v1/invoices?limit=1&limit=2",
      "/stripe/v1/invoices?starting_after=inv_missing",
      "/books/v1/bills?cursor=%%%",
      "/books/v1/bills?cursor=bm90LWpzb24",
      "/crm/crm/v3/objects/deals?after=AAAA",
    ];
    for (const path of cases) {
      const res = await get(path);
      expect(res.status, path).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toMatch(/invalid/);
    }
    // A valid cursor from one list does not work on another.
    const page = await body("/books/v1/bills?limit=1");
    const foreign = await get(`/books/v1/accounts?cursor=${page.next_cursor}`);
    expect(foreign.status).toBe(400);
  });
});

describe("auth and bounds", () => {
  it("requires the key on every route, including docs, openapi and health", async () => {
    const paths = [
      ...ROUTES,
      "/docs/documents/loan-agreement/text",
      "/stripe/openapi.json",
      "/health",
    ];
    for (const path of paths) {
      expect((await get(path, null)).status, path).toBe(401);
      expect((await get(path, "wrong")).status, path).toBe(401);
      expect((await get(path)).status, path).toBe(200);
    }
  });

  it("fails closed without a server key and never echoes keys", async () => {
    for (const apiKey of [undefined, ""]) {
      const closed = createMockHandler({ apiKey, snapshot: () => snapshot });
      const res = await closed(
        new Request("http://mocks.test/health", { headers: { "x-api-key": "" } }),
      );
      expect(res.status).toBe(503);
    }
    const res = await get("/health", "guess-SECRET-123");
    expect(await res.text()).not.toContain("SECRET");
  });

  it("allows only GET and rejects traversal and unknown routes", async () => {
    const post = await get("/stripe/v1/invoices", KEY, "POST");
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET");
    for (const path of [
      "/docs/documents/..%2F..%2Fpackage.json/text",
      "/docs/documents/../../etc/passwd",
      "/docs/documents/loan-agreement.pdf/text",
      "/docs/documents/nope/text",
      "/payroll/v1/companies/other/payrolls",
      "/nope",
      "/secrets/openapi.json",
    ]) {
      expect((await get(path)).status, path).toBe(404);
    }
  });

  it("returns 503 JSON when the data cannot be loaded", async () => {
    const broken = createMockHandler({
      apiKey: KEY,
      snapshot: () => {
        throw new Error("/private/path/world.json missing");
      },
    });
    const res = await broken(
      new Request("http://mocks.test/health", { headers: { "x-api-key": KEY } }),
    );
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("/private/path");
  });

  it("never emits private world fields", async () => {
    const paths = [
      ...ROUTES,
      "/docs/documents/loan-agreement/text",
      "/health",
      ...["stripe", "crm", "cards", "books", "payroll", "docs"].map((s) => `/${s}/openapi.json`),
    ];
    for (const path of paths) {
      const text = await (await get(path)).text();
      expect(text, path).not.toContain(PRIVATE);
      expect(text, path).not.toMatch(/pendingEvents|runtime|answerKey/);
    }
  });
});

describe("openapi", () => {
  function properties(schema: Json): Json {
    return (schema.properties ?? {}) as Json;
  }
  /** Every key actually served appears in the documented schema, recursively. */
  function covered(value: unknown, schema: Json, where: string): void {
    if (Array.isArray(value)) {
      for (const v of value) covered(v, schema.items as Json, where);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const props = properties(schema);
    for (const [key, v] of Object.entries(value)) {
      expect(props, `${where}.${key}`).toHaveProperty(key);
      covered(v, props[key] as Json, `${where}.${key}`);
    }
    for (const key of (schema.required ?? []) as string[])
      expect(value, `${where}.${key}`).toHaveProperty(key);
  }

  it("documents every served field of every list", async () => {
    for (const route of ROUTES) {
      const source = route.split("/")[1] as Parameters<typeof openapi>[0];
      const spec = openapi(source);
      const sub = route.slice(source.length + 1).replace("/kestrel/", "/{company_id}/");
      const op = (spec.paths as Json)[sub] as { get: Json } | undefined;
      expect(op, route).toBeDefined();
      const ok = (op?.get.responses as Json)["200"] as { content: Json };
      const schema = (ok.content["application/json"] as { schema: Json }).schema;
      const res = await get(`${route}?limit=100`);
      covered(await res.json(), schema, route);
      expect(spec.info["x-synthetic"]).toBe(true);
      expect(spec.components.securitySchemes.apiKey.name).toBe("x-api-key");
    }
  });
});
