import { readFileSync } from "node:fs";
import { SnapshotSchema, WorldStateSchema } from "@domino/contracts";
import { engine } from "@domino/engine";
import { describe, expect, it } from "vitest";
import { thousandsToCents } from "./operating/anchors.ts";
import {
  OPERATING_COMPANY_IDS,
  OPERATING_SCENARIO_IDS,
  advanceOperatingDays,
  createOperatingDemo,
  isOperatingWorld,
  operatingProvenance,
  operatingSelectionOf,
} from "./operating/index.ts";

describe("filing-backed operating demos", () => {
  it("reconciles 2U in cents and distinguishes revenue from receipts", () => {
    const { world, provenance: p } = createOperatingDemo({ company: "2u", scenario: "baseline" });
    expect(world.snapshot.cashOnHand).toBe(5_385_100_000);
    expect(world.snapshot.cashOnHand - world.snapshot.restrictedCash).toBe(4_114_100_000);
    expect(p.reconciliation.openingCashCents).toBe(18_257_800_000);
    expect(p.reconciliation.revenueCents).toBe(69_029_200_000);
    expect(p.reconciliation.outstandingReceivablesCents).toBe(11_320_200_000);
    expect(p.accrualBridge.collectionsCents).not.toBe(p.reconciliation.revenueCents);
    expect(p.revenueRecognition.reduce((s, r) => s + r.cents, 0)).toBe(69_029_200_000);
    expect(
      p.revenueRecognition.filter((r) => r.date >= "2023-07-01").reduce((s, r) => s + r.cents, 0),
    ).toBe(22_969_900_000);
  });

  for (const company of OPERATING_COMPANY_IDS) {
    for (const scenario of OPERATING_SCENARIO_IDS) {
      it(`${company}/${scenario} is deterministic and exactly balanced`, () => {
        const selection = { company, scenario };
        const demo = createOperatingDemo(selection, 19);
        expect(createOperatingDemo(selection, 19)).toEqual(demo);
        expect(operatingProvenance(selection, 19)).toEqual(demo.provenance);
        const { world, provenance: p } = demo;
        expect(WorldStateSchema.parse(world)).toEqual(world);
        expect(SnapshotSchema.parse(world.snapshot)).toEqual(world.snapshot);
        expect(world.runtime).toBeUndefined();
        expect(isOperatingWorld(world)).toBe(true);
        expect(operatingSelectionOf(world)).toEqual(selection);
        expect(p.reconciliation.balanced).toBe(true);
        const forecast = engine.forecast(
          world.snapshot,
          { version: 1, customerDelayDays: {}, recurringSpend: [], rules: [] },
          [],
        );
        expect(forecast.weeks).toHaveLength(13);
        expect(forecast.weeks.reduce((total, week) => total + week.inflow, 0)).toBeGreaterThan(0);
        expect(forecast.weeks.reduce((total, week) => total + week.outflow, 0)).toBeGreaterThan(0);
        for (const week of forecast.weeks) {
          expect(week.opening + week.inflow - week.outflow).toBe(week.closing);
          expect(week.closing - world.snapshot.restrictedCash).toBe(week.usable);
        }
        expect(
          p.reconciliation.openingCashCents +
            world.snapshot.bankTxns.reduce((s, t) => s + t.amount, 0),
        ).toBe(world.snapshot.cashOnHand);
        for (const category of ["operating", "investing", "financing", "fx"] as const) {
          expect(
            p.cashFlowPostings
              .filter((t) => t.category === category)
              .reduce((s, t) => s + t.cents, 0),
          ).toBe(p.reconciliation[`${category}CashFlowCents`]);
        }
        const next = advanceOperatingDays(world, 91);
        const added = next.snapshot.bankTxns.filter((t) => t.date > world.today);
        expect(world.snapshot.cashOnHand + added.reduce((s, t) => s + t.amount, 0)).toBe(
          next.snapshot.cashOnHand,
        );
        expect(advanceOperatingDays(advanceOperatingDays(world, 20), 71)).toEqual(next);
        for (const state of [world, next]) {
          const s = state.snapshot;
          expect("pendingPayouts" in s).toBe(false);
          expect(s.bankTxns.every((t) => t.date <= s.asOf)).toBe(true);
          expect(
            s.invoices.every(
              (i) =>
                i.issued <= s.asOf && (!i.paid || i.paid <= s.asOf) && i.collection === undefined,
            ),
          ).toBe(true);
          expect(
            s.bills.every((b) => (!b.paid || b.paid <= s.asOf) && b.agreedPayOn === undefined),
          ).toBe(true);
          expect(new Set(s.bankTxns.map((t) => t.id)).size).toBe(s.bankTxns.length);
          for (const invoice of s.invoices.filter((i) => i.paid))
            expect(s.bankTxns.find((t) => t.id === `${invoice.id}/bank`)).toMatchObject({
              amount: invoice.amount,
              date: invoice.paid,
            });
          for (const bill of s.bills.filter((b) => b.paid))
            expect(s.bankTxns.find((t) => t.id === `${bill.id}/bank`)).toMatchObject({
              amount: -bill.amount,
              date: bill.paid,
            });
          for (const run of s.payroll.filter((r) => r.date <= s.asOf))
            expect(s.bankTxns.find((t) => t.id === `${run.id}/bank`)).toMatchObject({
              amount: -run.amount,
              date: run.date,
            });
          for (const records of [
            s.invoices,
            s.bankTxns,
            s.bills,
            s.payroll,
            s.cardTxns,
            s.billingPlans ?? [],
          ])
            expect(
              records.every((r) => Number.isSafeInteger(r.amount) && r.id.startsWith("synthetic/")),
            ).toBe(true);
          expect(
            p.reconciliation.openingCashCents +
              s.bankTxns.reduce((total, t) => total + t.amount, 0),
          ).toBe(s.cashOnHand);
        }
        const b = p.accrualBridge;
        expect(
          b.openingReceivablesCents +
            b.invoicedCents -
            b.collectionsCents +
            b.receivablesAdjustmentCents,
        ).toBe(b.endingReceivablesCents);
        expect(b.openingDeferredRevenueCents + b.invoicedCents - b.recognizedRevenueCents).toBe(
          b.endingDeferredRevenueCents,
        );
        const e = p.expenseBridge;
        expect(
          e.gaapExpensesCents - e.identifiedNoncashExpensesCents + e.cashConversionAdjustmentCents,
        ).toBe(e.modeledOperatingPaymentsCents);
        expect(
          demo.constraints.every(
            (c) => c.label.includes("Illustrative") && c.evidence.note.includes("Not a reported"),
          ),
        ).toBe(true);
      });
    }
    it(`${company} keeps historical records unchanged across scenarios`, () => {
      const baseline = createOperatingDemo({ company, scenario: "baseline" }, 7);
      for (const scenario of OPERATING_SCENARIO_IDS) {
        const current = createOperatingDemo({ company, scenario }, 7);
        expect(current.provenance.reported).toEqual(baseline.provenance.reported);
        expect(current.provenance.revenueRecognition).toEqual(
          baseline.provenance.revenueRecognition,
        );
        expect(current.world.snapshot.bankTxns).toEqual(baseline.world.snapshot.bankTxns);
        expect(current.world.snapshot.invoices).toEqual(baseline.world.snapshot.invoices);
        expect(current.provenance.reconciliation).toEqual(baseline.provenance.reconciliation);
        for (const field of ["bills", "payroll", "cardTxns"] as const) {
          const history = (s: typeof current.world.snapshot) =>
            s[field].filter((r) => ("date" in r ? r.date : r.due) <= s.asOf);
          expect(history(current.world.snapshot)).toEqual(history(baseline.world.snapshot));
        }
        const advanced = advanceOperatingDays(current.world, 91);
        expect(advanced.snapshot.bankTxns.filter((t) => t.date <= baseline.world.today)).toEqual(
          baseline.world.snapshot.bankTxns,
        );
      }
    });
    it(`${company} scenarios change future cash only`, () => {
      const base = createOperatingDemo({ company, scenario: "baseline" }, 9).world;
      for (const scenario of ["late-payments", "customer-loss", "unexpected-expense"] as const) {
        const alternate = createOperatingDemo({ company, scenario }, 9).world;
        expect(advanceOperatingDays(alternate, 45).snapshot.cashOnHand).toBeLessThan(
          advanceOperatingDays(base, 45).snapshot.cashOnHand,
        );
      }
    });
  }

  it("preserves permitted cutoff money anchors and source units", () => {
    const cutoff = JSON.parse(
      readFileSync(
        new URL("../../../data/historical/2u/cutoff-facts.json", import.meta.url),
        "utf8",
      ),
    ) as {
      facts: { id: string; cents: number | null }[];
      derived: { id: string; cents: number | null }[];
    };
    const p = operatingProvenance({ company: "2u", scenario: "baseline" });
    for (const f of [...cutoff.facts, ...cutoff.derived].filter((f) => f.cents !== null))
      expect(p.reported.find((r) => r.id === f.id)?.cents).toBe(f.cents);
    for (const company of OPERATING_COMPANY_IDS)
      for (const r of operatingProvenance({ company, scenario: "baseline" }).reported) {
        if (r.sourceValue) expect(thousandsToCents(r.sourceValue)).toBe(r.cents);
        expect(r.sourceUrl).toMatch(/^https:\/\//);
        expect(Number.isSafeInteger(r.cents)).toBe(true);
      }
    expect(thousandsToCents("(286,355)")).toBe(-28_635_500_000);
    expect(() => thousandsToCents("1.25")).toThrow();
    expect(() => thousandsToCents("9007199254740991")).toThrow();
  });

  it("cites both filings used to derive GitLab quarter cash flows", () => {
    const p = operatingProvenance({ company: "gitlab-inspired", scenario: "baseline" });
    for (const line of ["operating", "investing", "financing", "foreignExchangeEffect"]) {
      const quarter = p.reported.find((r) => r.id === `derived-quarter.${line}`)!;
      const nine = p.reported.find((r) => r.id === `cashFlowNineMonths.${line}`)!;
      const six = p.reported.find((r) => r.id === `cashFlowSixMonths.${line}`)!;
      expect(quarter.cents).toBe(nine.cents - six.cents);
      expect(quarter.sourceUrl).toBe(nine.sourceUrl);
      expect(quarter.note).toContain(nine.sourceUrl);
      expect(quarter.note).toContain(six.sourceUrl);
    }
  });

  it("retains 2U primary statement totals and reconciles the reported component anchors", () => {
    const p = operatingProvenance({ company: "2u", scenario: "baseline" });
    const value = (id: string) => {
      const anchor = p.reported.find((r) => r.id === id);
      expect(anchor, id).toBeDefined();
      return anchor!.cents;
    };
    expect(value("balance.closing.total-assets")).toBe(153_793_500_000);
    expect(value("balance.closing.total-assets")).toBe(
      value("balance.closing.total-liabilities") +
        value("balance.closing.total-stockholders-equity"),
    );
    expect(value("balance.closing.total-current-assets")).toBe(23_397_100_000);
    expect(value("balance.closing.total-current-liabilities")).toBe(31_463_400_000);
    expect(value("balance.closing.accounts-payable-and-accrued-expenses")).toBe(12_831_600_000);
    expect(value("balance.opening.accounts-payable-and-accrued-expenses")).toBe(11_002_000_000);
    expect(value("income.q3.interest-expense")).toBe(-1_916_700_000);
    expect(value("income.ytd.interest-expense")).toBe(-5_504_000_000);
    expect(
      value("income.ytd.loss-before-income-taxes") + value("income.ytd.income-tax-expense-benefit"),
    ).toBe(value("income.ytd.net-loss"));
    expect(value("q3.adjusted-ebitda")).toBe(2_862_900_000);
    expect(value("ytd.adjusted-ebitda")).toBe(8_061_200_000);
    for (const category of ["operating", "investing", "financing"] as const) {
      const components = p.reported.filter(
        (r) => r.id.startsWith(`cash-flow.${category}.`) && !r.id.includes(".net-cash-used-in-"),
      );
      expect(components.reduce((total, r) => total + r.cents, 0)).toBe(
        p.reconciliation[`${category}CashFlowCents`],
      );
    }
    expect(value("cash-flow.financing.proceeds-from-debt")).toBe(30_922_300_000);
    expect(value("cash-flow.financing.payments-on-debt")).toBe(-37_391_400_000);
    expect(p.reported.find((r) => r.id === "F24")!.note).toContain("next 12 to 24 months");
    expect(p.reported.find((r) => r.id === "F24")!.note).toContain("not the realization date");
  });

  it("allocates reported 2U AP/accruals to existing expected payment capacity without adding cash events", () => {
    const baseline = createOperatingDemo({ company: "2u", scenario: "baseline" }, 19);
    const bridge = baseline.provenance.payablesBridge!;
    expect(bridge.openingDate).toBe("2022-12-31");
    expect(bridge.closingDate).toBe("2023-09-30");
    expect(bridge.reportedOpeningPayablesAndAccrualsCents).toBe(11_002_000_000);
    expect(bridge.reportedClosingPayablesAndAccrualsCents).toBe(12_831_600_000);
    expect(bridge.balanceIncreaseCents).toBe(1_829_600_000);
    expect(bridge.cashFlowAdjustmentCents).toBe(1_988_800_000);
    expect(bridge.cashFlowAdjustmentLessBalanceIncreaseCents).toBe(159_200_000);
    expect(bridge.allocations.reduce((total, a) => total + a.allocatedPayablesCents, 0)).toBe(
      bridge.reportedClosingPayablesAndAccrualsCents,
    );
    expect(bridge.supplierAllocationCents + bridge.unincurredFutureBillCostsCents).toBe(
      bridge.baselineFutureBillsCents,
    );
    expect(
      bridge.payrollAndOtherAccrualAllocationCents + bridge.unincurredFuturePayrollCostsCents,
    ).toBe(bridge.baselineFuturePayrollCents);
    expect(bridge.unincurredFutureBillCostsCents).toBeGreaterThanOrEqual(0);
    expect(bridge.unincurredFuturePayrollCostsCents).toBeGreaterThanOrEqual(0);
    expect(new Set(bridge.allocations.map((a) => a.recordId)).size).toBe(bridge.allocations.length);
    for (const scenario of OPERATING_SCENARIO_IDS) {
      const current = createOperatingDemo({ company: "2u", scenario }, 19);
      expect(current.provenance.payablesBridge).toEqual(bridge);
      for (const allocation of bridge.allocations) {
        const record =
          allocation.recordKind === "bill"
            ? current.world.snapshot.bills.find((b) => b.id === allocation.recordId)
            : current.world.snapshot.payroll.find((r) => r.id === allocation.recordId);
        expect(record).toBeDefined();
        expect(record!.amount).toBe(allocation.expectedAmountCents);
        expect("date" in record! ? record!.date : record!.due).toBe(allocation.expectedPaymentDate);
        expect(allocation.expectedPaymentDate > current.world.today).toBe(true);
        expect(allocation.allocatedPayablesCents).toBeGreaterThan(0);
        expect(allocation.allocatedPayablesCents).toBeLessThanOrEqual(record!.amount);
        expect(
          current.world.snapshot.bankTxns.some((t) => t.id === `${allocation.recordId}/bank`),
        ).toBe(false);
      }
      expect(current.world.snapshot.payroll).toEqual(baseline.world.snapshot.payroll);
      expect(
        current.world.snapshot.bills.filter((b) => !b.id.endsWith("/illustrative-emergency")),
      ).toEqual(baseline.world.snapshot.bills);
    }
    for (const company of ["asana-inspired", "gitlab-inspired"] as const)
      expect(
        createOperatingDemo({ company, scenario: "baseline" }).provenance.payablesBridge,
      ).toBeUndefined();
  });

  it("rejects invalid seeds, non-operating worlds and unbounded advances without mutating inputs", () => {
    const selection = { company: "2u", scenario: "baseline" } as const;
    for (const seed of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(() => createOperatingDemo(selection, seed)).toThrow();
    const world = createOperatingDemo(selection).world;
    const copy = structuredClone(world);
    for (const days of [0, -1, 0.5, Number.POSITIVE_INFINITY, 3651])
      expect(() => advanceOperatingDays(world, days)).toThrow();
    expect(() => advanceOperatingDays({ ...world, companyId: "kestrel" }, 1)).toThrow();
    expect(operatingSelectionOf({ ...world, companyId: "operating/2u/unknown" })).toBeNull();
    expect(() =>
      advanceOperatingDays(
        { ...world, today: "2023-02-30", snapshot: { ...world.snapshot, asOf: "2023-02-30" } },
        1,
      ),
    ).toThrow();
    advanceOperatingDays(world, 1);
    expect(world).toEqual(copy);
    expect(createOperatingDemo(selection, 2).world.snapshot.invoices).not.toEqual(
      world.snapshot.invoices,
    );
  });
});
