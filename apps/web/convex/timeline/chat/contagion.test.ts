import { type CompanyModel, type Snapshot, SnapshotSchema } from "@domino/contracts";
import { forecast } from "@domino/engine/src/forecast";
import { describe, expect, it } from "vitest";
import type { WorkspaceRun } from "../questions/context";
import { planRequest, withContagion } from "./planChanges";

const snapshot: Snapshot = SnapshotSchema.parse({
  companyId: "dyn",
  asOf: "2026-10-30",
  cashOnHand: 10_000_000,
  restrictedCash: 0,
  customers: [
    { id: "big", name: "Northwind", paymentTermsDays: 0 },
    { id: "small", name: "Tailspin", paymentTermsDays: 0 },
  ],
  invoices: [
    { id: "inv_big", customerId: "big", amount: 500_000, issued: "2026-10-01", due: "2026-11-04" },
  ],
  bankTxns: [],
  bills: [],
  cardTxns: [],
  payroll: [],
  deals: [],
  billingPlans: ["big", "small"].map((customerId) => ({
    id: `p_${customerId}`,
    customerId,
    amount: 400_000,
    anchorDate: "2026-01-05",
    nextInvoiceDate: "2026-11-05",
    everyMonths: 1,
    paymentTermsDays: 0,
  })),
});
const model: CompanyModel = { version: 0, customerDelayDays: {}, recurringSpend: [], rules: [] };
const run = {
  baseline: { seed: { snapshot }, model },
  changes: [],
  forecast: forecast(snapshot, model, []),
} as unknown as WorkspaceRun;
const late = {
  label: "Northwind pays late",
  changes: [{ kind: "delay_invoice" as const, invoiceId: "inv_big", days: 30 }],
  constraints: null,
  constraintNote: null,
};

describe("persistent chat what-ifs", () => {
  it("a late payer's later receipts slip too, labelled as an assumption", () => {
    const out = withContagion(run, late);
    expect(out.changes).toEqual([
      {
        kind: "delay_customer",
        customerId: "big",
        days: 15,
        fromDate: "2026-11-05",
        basis: "Assumption: Northwind's later payments slip half as long (15 days)",
      },
      late.changes[0],
    ]);
  });

  it("uses the learned spread when the customer has payment history", () => {
    const learned = {
      ...run,
      baseline: {
        seed: { snapshot },
        model: { ...model, customerDelayDays: { big: { mean: 4, p90: 12, samples: 6 } } },
      },
    } as unknown as WorkspaceRun;
    const d = withContagion(learned, late).changes[0];
    expect(d).toMatchObject({ kind: "delay_customer", days: 8 });
    expect(d && "basis" in d ? d.basis : "").toMatch(/^Learned/);
  });

  it("losing a customer is one churn change from the next day", () => {
    const reply = planRequest(run, "what if we lose Northwind", null);
    expect(reply?.proposal?.changes).toEqual([
      { kind: "churn", customerId: "big", fromDate: "2026-10-31" },
    ]);
  });
});
