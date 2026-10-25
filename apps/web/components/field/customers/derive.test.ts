import type { CompanyModel, Snapshot } from "@domino/contracts";
import { fixtures } from "@domino/contracts/fixtures";
import { engine, recurringAssumptions } from "@domino/engine";
import { simulator } from "@domino/sim";
import { describe, expect, it } from "vitest";
import { STRESS_DAYS, deriveCustomers } from "./derive";

const MODEL: CompanyModel = { version: 1, customerDelayDays: {}, recurringSpend: [], rules: [] };
const snapshot = (): Snapshot => simulator.createCompany("kestrel", 1).snapshot;
const run = (s: Snapshot, model = MODEL) =>
  deriveCustomers({
    snapshot: s,
    model,
    constraints: fixtures.constraints,
    connected: ["stripe", "hubspot"],
    findings: [],
    signals: {},
  });

describe("deriveCustomers", () => {
  const s = snapshot();
  const view = run(s);

  it("uses the engine's billing-plan delay for every plan customer", () => {
    const { delayDays } = recurringAssumptions(s, MODEL);
    for (const row of view.customers)
      if (row.id in delayDays) expect(row.payment.delayDays).toBe(delayDays[row.id]);
  });

  it("labels the learned model when it applies", () => {
    const id = s.billingPlans?.[0]?.customerId as string;
    const model = { ...MODEL, customerDelayDays: { [id]: { mean: 21.4, p90: 40, samples: 8 } } };
    const row = run(s, model).customers.find((r) => r.id === id);
    expect(row?.payment.basis).toBe("learned");
    expect(row?.payment.delayDays).toBe(21);
    expect(row?.payment.basisLabel).toBe("Learned from 8 payments");
    expect(row?.risk.reasons.some((r) => r.text.startsWith("Pays 21 days late"))).toBe(true);
  });

  it("falls back to customers on the same terms when a customer has no payments", () => {
    const fresh = { id: "cus_new_test", name: "Fresh Co", paymentTermsDays: 30 };
    const s2 = { ...s, customers: [...s.customers, fresh] };
    const row = run(s2).customers.find((r) => r.id === fresh.id);
    expect(row?.payment.paidCount).toBe(0);
    expect(row?.payment.basisLabel).toBe("Estimated from customers on Net 30");
    expect(row?.monthlyRecurring).toBeNull();
  });

  it("shares of active recurring revenue add up to one", () => {
    const total = view.customers.reduce((sum, r) => sum + (r.recurringShare ?? 0), 0);
    expect(view.totalMonthlyRecurring).toBeGreaterThan(0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("sorts risky customers first and builds their chains with the engine", () => {
    const levels = view.customers.map((r) => r.risk.level);
    const firstLow = levels.indexOf("low");
    if (firstLow >= 0) expect(levels.slice(firstLow).every((l) => l === "low")).toBe(true);
    const withChain = view.customers.find((r) => r.chain?.assumption);
    if (!withChain?.chain) return;
    const open = s.invoices.filter(
      (i) => i.customerId === withChain.id && i.paid === undefined && !i.writtenOff,
    );
    const changes = open
      .slice(0, 8)
      .map((i) => ({ kind: "delay_invoice" as const, invoiceId: i.id, days: STRESS_DAYS }));
    expect(withChain.chain.lowPoint).toEqual(engine.forecast(s, MODEL, changes).lowPoint);
    expect(withChain.chain.scenario).toBe(`${withChain.name} pays ${STRESS_DAYS} days late`);
  });
});
