import { describe, expect, it } from "vitest";
import { fetchGusto, translateGusto } from "../../connectors/gusto";
import { fetchHubspot, translateHubspot } from "../../connectors/hubspot";
import { inProcessFetcher } from "../../connectors/inProcess";
import { fetchPlaid, translatePlaid } from "../../connectors/plaid";
import { fetchQbo, translateQbo } from "../../connectors/qbo";
import { fetchRamp, translateRamp } from "../../connectors/ramp";
import { fetchStripe, translateStripe } from "../../connectors/stripe";
import type { Fetcher, MockToolId } from "../../connectors/types";
import { fixtureSnapshot as s } from "./fixture-snapshot.test-support";
import { loadFixture, recorder, replay, saveFixture } from "./recording.test-support";

// Each translator runs on recorded responses from the vendor mocks (tests/connectors/fixtures).
// Re-record after a mock change: RECORD_CONNECTOR_FIXTURES=1 npx vitest run convex/tests/connectors
const RECORD = process.env.RECORD_CONNECTOR_FIXTURES === "1";

const byId = <T extends { id: string }>(xs: T[] | undefined) =>
  [...(xs ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const FETCH: Record<MockToolId, (f: Fetcher) => Promise<unknown>> = {
  stripe: fetchStripe,
  ramp: fetchRamp,
  qbo: (f) => fetchQbo(f, s.companyId),
  gusto: (f) => fetchGusto(f, s.companyId),
  hubspot: fetchHubspot,
  plaid: (f) => fetchPlaid(f, null),
};

/** Replays the committed recording; also proves the mock still serves exactly those pages. */
async function recorded<T>(tool: MockToolId): Promise<T> {
  const live = recorder(inProcessFetcher(s));
  await FETCH[tool](live.fetcher);
  if (RECORD) saveFixture(tool, live.calls);
  const calls = loadFixture(tool);
  expect(calls, `${tool} fixture is stale: re-record it`).toEqual(live.calls);
  return (await FETCH[tool](replay(calls))) as T;
}

describe("vendor translators on recorded mock responses", () => {
  it("Stripe: customers, invoices, plans, payouts in transit; charges and paid payouts fold", async () => {
    const t = translateStripe(await recorded("stripe"));
    expect(byId(t.lists.customers)).toEqual(byId(s.customers));
    expect(byId(t.lists.invoices)).toEqual(byId(s.invoices));
    expect(byId(t.lists.billingPlans)).toEqual(byId(s.billingPlans));
    expect(t.lists.pendingPayouts).toEqual(s.pendingPayouts);
    expect(t.links.payouts).toEqual([
      { id: "po_bank_po_inv_bp_oct", trace: "bank_po_inv_bp_oct", amount: 3_495_600 },
      { id: "po_txn_001", trace: "txn_001", amount: 12_000_000 },
    ]);
    expect(t.skipped).toContainEqual({
      id: "ch_inv_bp_oct",
      reason: "folded into invoice inv_bp_oct (paid date and amount)",
    });
    // + 2 charges, 3 payouts (2 paid, 1 in transit), 2 subscriptions
    expect(t.recordsIn).toBe(s.customers.length + s.invoices.length + 2 + 3 + 2);
  });

  it("Ramp: card spend with refunds; Bill Pay bills keep the books' bill id", async () => {
    const t = translateRamp(await recorded("ramp"));
    expect(byId(t.lists.cardTxns)).toEqual(byId(s.cardTxns));
    expect(byId(t.lists.bills)).toEqual(byId(s.bills.filter((b) => !b.critical)));
    expect(t.links.bills).toContainEqual({
      rampId: "rb_bill_paid_oct",
      billId: "bill_paid_oct",
      amount: 12_345,
      paid: "2026-10-10",
    });
  });

  it("QuickBooks: bills with payments and custom fields, invoices, balances", async () => {
    const t = translateQbo(await recorded("qbo"));
    expect(byId(t.lists.bills)).toEqual(byId(s.bills));
    expect(t.balances).toEqual({
      asOf: s.asOf,
      cashOnHand: s.cashOnHand,
      restrictedCash: s.restrictedCash,
    });
    // The books know amounts and dates, not Stripe's plan or promise metadata.
    expect(byId(t.lists.invoices)).toEqual(
      byId(s.invoices).map(({ billingPlanId, collection, ...i }) => i),
    );
    expect(t.links.billPayments).toEqual([
      {
        id: "bp_bill_paid_oct",
        billId: "bill_paid_oct",
        date: "2026-10-10",
        amount: 12_345,
        rampId: "rb_bill_paid_oct",
      },
    ]);
  });

  it("Gusto: one payroll run per payroll, cash cost = company debit, totals add up", async () => {
    const t = translateGusto(await recorded("gusto"));
    expect(byId(t.lists.payroll)).toEqual(byId(s.payroll));
    expect(t.links.processed).toEqual([{ id: "pay_1023", date: "2026-10-23", amount: 60_000_000 }]);
    expect(t.skipped).toEqual([]);
  });

  it("HubSpot: deals keep stage, signature and the three invoice-link states", async () => {
    const t = translateHubspot(await recorded("hubspot"));
    expect(byId(t.lists.deals)).toEqual(byId(s.deals));
    const cobalt = t.lists.deals?.find((d) => d.id === "deal_cobalt_open");
    expect(cobalt && "invoiceId" in cobalt).toBe(false);
  });

  it("Plaid: signs flipped to money-in positive, balances split restricted, references kept", async () => {
    const t = translatePlaid(await recorded("plaid"));
    expect(t.lists.bankTxns).toEqual(s.bankTxns);
    expect(t.balances).toEqual({
      asOf: s.asOf,
      cashOnHand: s.cashOnHand,
      restrictedCash: s.restrictedCash,
    });
    expect(t.links.references.get("bank_pay_1023")).toBe("pay_1023");
    expect(t.links.references.get("bank_bill_paid_oct")).toBe("bill_paid_oct");
    expect(t.links.references.get("bank_po_inv_bp_oct")).toBe("bank_po_inv_bp_oct");
  });

  it("skips records that do not match the vendor shape, with a reason", () => {
    const t = translateHubspot({
      deals: [
        { id: "deal_bad", properties: {} },
        {
          id: "deal_odd",
          archived: false,
          properties: {
            amount: "1.00",
            dealstage: "mystery",
            closedate: "2026-11-01T00:00:00.000Z",
            contract_signed: null,
            domino_deal_kind: null,
            invoice_link_status: null,
            stripe_invoice_id: null,
          },
          associations: { companies: { results: [{ id: "cus_acme", type: "deal_to_company" }] } },
        },
      ],
      pages: 1,
    });
    expect(t.lists.deals).toEqual([]);
    expect(t.skipped).toEqual([
      { id: "deal_bad", reason: "does not match the HubSpot deal shape" },
      { id: "deal_odd", reason: "unknown deal stage mystery" },
    ]);
  });
});
