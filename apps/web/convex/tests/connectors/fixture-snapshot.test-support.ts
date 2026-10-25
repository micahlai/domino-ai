import { type Snapshot, SnapshotSchema } from "@domino/contracts";
import { fixtures } from "@domino/contracts/fixtures";

/**
 * Small synthetic snapshot behind the recorded vendor fixtures: the shared Kestrel fixture
 * plus one record for every path a translator handles (paid, written off, promised, refund,
 * billing plan, payout in transit, a paid Ramp bill, a processed payroll run).
 */
export const fixtureSnapshot: Snapshot = SnapshotSchema.parse({
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
      id: "inv_acme_sep",
      customerId: "cus_acme",
      amount: 1_234_567,
      issued: "2026-09-01",
      due: "2026-10-01",
      paid: "2026-10-29",
      paidAmount: 1_234_567,
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
      id: "bank_po_inv_bp_oct",
      date: "2026-10-22",
      amount: 3_495_600,
      description: "STRIPE PAYOUT inv_bp_oct NET FEES",
      counterparty: "Stripe",
    },
    {
      id: "bank_pay_1023",
      date: "2026-10-23",
      amount: -60_000_000,
      description: "GUSTO PAYROLL pay_1023",
      counterparty: "Gusto",
    },
    {
      id: "bank_bill_paid_oct",
      date: "2026-10-10",
      amount: -12_345,
      description: "BILL bill_paid_oct",
      counterparty: "Law firm",
    },
  ],
  bills: [
    ...fixtures.snapshot.bills.map((b) =>
      b.id === "bill_agency_nov" ? { ...b, agreedPayOn: "2026-11-29" } : b,
    ),
    {
      id: "bill_paid_oct",
      vendor: "Law firm",
      amount: 12_345,
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
  payroll: [
    { id: "pay_1023", date: "2026-10-23", amount: 60_000_000 },
    ...fixtures.snapshot.payroll,
  ],
  deals: [
    ...fixtures.snapshot.deals,
    {
      id: "deal_cobalt_open",
      customerId: "cus_cobalt",
      amount: 700_001,
      stage: "open",
      expectedClose: "2026-12-01",
      signed: false,
    },
  ],
  billingPlans: [
    {
      id: "plan_bp",
      customerId: "cus_brightpath",
      amount: 3_600_000,
      anchorDate: "2026-10-01",
      nextInvoiceDate: "2026-12-01",
      everyMonths: 1,
      paymentTermsDays: 30,
    },
    {
      id: "plan_acme_yearly",
      customerId: "cus_acme",
      amount: 24_000_000,
      anchorDate: "2026-10-26",
      nextInvoiceDate: "2027-10-26",
      everyMonths: 12,
      paymentTermsDays: 30,
      endDate: "2028-10-26",
    },
  ],
  pendingPayouts: [
    {
      id: "po_inv_acme_sep",
      amount: 1_197_530,
      expectedArrival: "2026-11-02",
      invoiceIds: ["inv_acme_sep"],
    },
  ],
});
