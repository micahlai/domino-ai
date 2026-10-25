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
