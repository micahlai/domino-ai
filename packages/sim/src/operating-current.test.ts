import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { SnapshotSchema } from "@domino/contracts";
import { engine } from "@domino/engine";
import { describe, expect, it } from "vitest";
import { companySpec, reportedValueToCents } from "./operating/anchors.ts";
import {
  OPERATING_PRIMARY_COMPANY_IDS,
  OPERATING_SCENARIO_IDS,
  advanceOperatingDays,
  createOperatingDemo,
  operatingDemoCatalog,
} from "./operating/index.ts";
import legacyHashes from "./operating/legacy-output-hashes.json";

const currentCompanies = ["asana-current", "gitlab-current"] as const;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe("current filing operating books", () => {
  it("preserves every legacy demo, provenance, constraint and 91-day result", () => {
    for (const company of ["2u", "asana-inspired", "gitlab-inspired"] as const) {
      for (const scenario of OPERATING_SCENARIO_IDS) {
        for (const seed of [1, 7, 19]) {
          const demo = createOperatingDemo({ company, scenario }, seed);
          const hash = createHash("sha256")
            .update(JSON.stringify([demo, advanceOperatingDays(demo.world, 91)]))
            .digest("hex");
          expect(hash).toBe(
            legacyHashes[`${company}/${scenario}/${seed}` as keyof typeof legacyHashes],
          );
        }
      }
    }
  });

  it("parses original rounded-million source strings into exact integer cents", () => {
    expect(reportedValueToCents("15.0", "USD millions")).toBe(1_500_000_000);
    expect(reportedValueToCents("(15.0)", "USD millions")).toBe(-1_500_000_000);
    expect(reportedValueToCents("1.00000001", "USD millions")).toBe(100_000_001);
    for (const value of ["15.0.0", "1.000000001", "9007199254740991"])
      expect(() => reportedValueToCents(value, "USD millions")).toThrow();
    expect(() => reportedValueToCents("15.0", "unknown units")).toThrow();
  });

  it("offers three primary companies with explicit current publication and simulation dates", () => {
    expect(OPERATING_PRIMARY_COMPANY_IDS).toEqual(["2u", "asana-current", "gitlab-current"]);
    expect(operatingDemoCatalog).toHaveLength(5);
    for (const company of currentCompanies) {
      expect(operatingDemoCatalog.find((c) => c.id === company)).toMatchObject({
        simulationAsOf: "2026-10-25",
        periodStart: "2026-05-01",
        periodEnd: "2026-07-31",
        reportedAt: company === "asana-current" ? "2026-09-03" : "2026-09-01",
        filedAt: company === "asana-current" ? "2026-09-03" : "2026-09-02",
      });
    }
  });

  for (const company of currentCompanies) {
    for (const scenario of OPERATING_SCENARIO_IDS) {
      it(`${company}/${scenario} reconciles reported and current cash separately with a future 13-week forecast`, () => {
        const demo = createOperatingDemo({ company, scenario }, 19);
        const { world, provenance: p } = demo;
        expect(world.today).toBe("2026-10-25");
        expect(world.snapshot.asOf).toBe(world.today);
        expect(SnapshotSchema.parse(world.snapshot)).toEqual(world.snapshot);
        expect(p.cashFlowPostings.every((t) => t.date <= p.periodEnd)).toBe(true);
        const reconstructed = sum(
          world.snapshot.bankTxns.filter((t) => t.date > p.periodEnd).map((t) => t.amount),
        );
        expect(p.currentLedger).toEqual({
          basis: "reconstructed",
          asOf: "2026-10-25",
          reportedPeriodEnd: "2026-07-31",
          reportedEndingCashCents: p.reconciliation.endingCashCents,
          reconstructedCashChangeCents: reconstructed,
          cashOnHandCents: p.reconciliation.endingCashCents + reconstructed,
          restrictedCashCents: world.snapshot.restrictedCash,
        });
        expect(p.currentLedger!.cashOnHandCents).toBe(world.snapshot.cashOnHand);
        const forecast = engine.forecast(
          world.snapshot,
          { version: 1, customerDelayDays: {}, recurringSpend: [], rules: [] },
          [],
        );
        expect(forecast.weeks[0]!.weekStart).toBe("2026-10-26");
        expect(forecast.weeks).toHaveLength(13);
        expect(forecast.weeks[12]!.weekStart).toBe("2027-01-18");
        const next = advanceOperatingDays(world, 91);
        expect(advanceOperatingDays(advanceOperatingDays(world, 20), 71)).toEqual(next);
        expect(next.snapshot.cashOnHand).toBe(
          world.snapshot.cashOnHand +
            sum(next.snapshot.bankTxns.filter((t) => t.date > world.today).map((t) => t.amount)),
        );
        expect(createOperatingDemo({ company, scenario }, 19)).toEqual(demo);
      });
    }

    it(`${company} preserves all observation facts through Oct25 across future scenarios`, () => {
      const baseline = createOperatingDemo({ company, scenario: "baseline" }, 19);
      for (const scenario of OPERATING_SCENARIO_IDS) {
        const demo = createOperatingDemo({ company, scenario }, 19);
        expect(demo.provenance.currentLedger).toEqual(baseline.provenance.currentLedger);
        expect(demo.world.snapshot.invoices).toEqual(baseline.world.snapshot.invoices);
        expect(demo.world.snapshot.bankTxns).toEqual(baseline.world.snapshot.bankTxns);
        const advanced = advanceOperatingDays(demo.world, 91).snapshot;
        for (const original of baseline.world.snapshot.invoices) {
          const next = advanced.invoices.find((i) => i.id === original.id)!;
          expect({ ...next, paid: original.paid, paidAmount: original.paidAmount }).toEqual({
            ...original,
            paid: original.paid,
            paidAmount: original.paidAmount,
          });
          if (original.paid) expect(next).toEqual(original);
        }
        expect(advanced.bankTxns.filter((t) => t.date <= baseline.world.today)).toEqual(
          baseline.world.snapshot.bankTxns,
        );
        expect(
          advanced.invoices.every(
            (i) =>
              i.issued <= advanced.asOf && (!i.paid || i.paid <= advanced.asOf) && !i.collection,
          ),
        ).toBe(true);
        expect(
          advanced.bills.every((b) => !b.agreedPayOn && (!b.paid || b.paid <= advanced.asOf)),
        ).toBe(true);
      }
    });
  }

  it("uses exact reported cash, receivable and deferred liability endpoints", () => {
    const asana = createOperatingDemo({
      company: "asana-current",
      scenario: "baseline",
    }).provenance;
    expect(asana.reconciliation).toMatchObject({
      openingCashCents: 19_435_200_000,
      endingCashCents: 22_040_600_000,
      restrictedCashCents: 84_400_000,
      operatingCashFlowCents: 4_604_600_000,
      investingCashFlowCents: 3_275_200_000,
      financingCashFlowCents: -5_213_700_000,
      fxCashFlowCents: -60_700_000,
      revenueCents: 21_642_900_000,
    });
    expect(asana.accrualBridge).toMatchObject({
      openingReceivablesCents: 7_348_300_000,
      endingReceivablesCents: 7_864_500_000,
      openingDeferredRevenueCents: 32_311_800_000,
      endingDeferredRevenueCents: 35_071_600_000,
    });
    const gitlab = createOperatingDemo({
      company: "gitlab-current",
      scenario: "baseline",
    }).provenance;
    expect(gitlab.reconciliation).toMatchObject({
      openingCashCents: 33_539_500_000,
      endingCashCents: 22_649_100_000,
      operatingCashFlowCents: -309_200_000,
      investingCashFlowCents: -953_500_000,
      financingCashFlowCents: -9_551_100_000,
      fxCashFlowCents: -76_600_000,
      revenueCents: 28_625_400_000,
    });
    expect(gitlab.accrualBridge).toMatchObject({
      openingReceivablesCents: 20_030_200_000,
      endingReceivablesCents: 25_734_300_000,
      openingDeferredRevenueCents: 55_697_400_000,
      endingDeferredRevenueCents: 57_467_300_000,
    });
    expect(gitlab.accrualBridge.deferredRevenueAdjustmentCents).toBe(1_500_000_000);
    expect(gitlab.accrualBridge.invoicedCents).toBe(
      gitlab.reconciliation.revenueCents +
        gitlab.accrualBridge.endingDeferredRevenueCents -
        gitlab.accrualBridge.openingDeferredRevenueCents -
        1_500_000_000,
    );
    expect(gitlab.accrualBridge.note).toContain("no opening advance zero");
    expect(gitlab.aggregateBasis.deferredRevenue).toContain("customer advances");
    expect(gitlab.aggregateBasis.cash).toContain("assumed");
  });
  for (const company of currentCompanies) {
    it(`${company} preserves every supplied monetary source string and period`, () => {
      const research = JSON.parse(
        readFileSync(
          new URL(`../../../kb/features/field/research/${company}/anchors.json`, import.meta.url),
          "utf8",
        ),
      );
      const spec = companySpec(company);
      const sourceEntries: {
        id: string;
        value: string;
        end: string;
        start?: string;
        url: string;
        section: string;
        date: string;
        unit: string;
      }[] = [];
      if (company === "asana-current") {
        for (const entry of research.reportedAnchors) {
          const source = research.sources[entry.source];
          sourceEntries.push({
            id: entry.id,
            value: entry.sourceValue,
            end: entry.period.date ?? entry.period.end,
            start: entry.period.start,
            url: source.url,
            section: entry.section,
            date: source.filedAt ?? source.publicationDate,
            unit: entry.unit,
          });
        }
      } else {
        for (const [id, untyped] of Object.entries(research.reported)) {
          const entry = untyped as {
            value?: string;
            lines?: Record<string, string>;
            source: string;
            asOf?: string;
            periodStart?: string;
            periodEnd?: string;
            section: string;
            unit: string;
          };
          if (!entry.value && !entry.lines) continue;
          const source = research.sources[entry.source];
          for (const [line, value] of Object.entries(entry.lines ?? { "": entry.value! })) {
            sourceEntries.push({
              id: id + (line ? `.${line}` : ""),
              value,
              end: (entry.asOf ?? entry.periodEnd)!,
              start: entry.periodStart,
              url: source.url,
              section: entry.section,
              date: source.filingDate ?? source.publicationDate,
              unit: entry.unit,
            });
          }
        }
      }
      if (company === "gitlab-current" && !research.reported.customerAdvancesClosing)
        sourceEntries.push({
          id: "customerAdvancesClosing",
          value: "15.0",
          unit: "USD millions",
          end: "2026-07-31",
          url: "https://www.sec.gov/Archives/edgar/data/1653482/000162828026059943/gtlb-20260731.htm",
          section: "Note 3",
          date: "2026-09-02",
        });
      if (company === "gitlab-current" && !research.reported.cashFlowQuarterRelease) {
        for (const [line, value] of [
          ["operating", "(3,092)"],
          ["propertyAndEquipmentPurchases", "(213)"],
        ]) {
          sourceEntries.push({
            id: `cashFlowQuarterRelease.${line}`,
            value: value!,
            unit: "USD thousands",
            start: "2026-05-01",
            end: "2026-07-31",
            url: "https://ir.gitlab.com/news/news-details/2026/GitLab-Reports-Second-Quarter-Fiscal-Year-2027-Financial-Results/default.aspx",
            section:
              "Reconciliation of GAAP Cash Flow from Operating Activities to Adjusted Free Cash Flow",
            date: "2026-09-01",
          });
        }
      }
      expect(spec.reported.filter((a) => a.basis === "reported")).toHaveLength(
        sourceEntries.length,
      );
      for (const expected of sourceEntries) {
        const actual = spec.reported.find((a) => a.id === expected.id)!;
        expect(actual).toMatchObject({
          sourceValue: expected.value,
          sourceUnit: expected.unit,
          cents: reportedValueToCents(expected.value, expected.unit),
          periodEnd: expected.end,
          sourceUrl: expected.url,
        });
        expect(actual.periodStart).toBe(expected.start);
        expect(actual.note).toContain(expected.section);
        expect(actual.note).toContain(expected.date);
      }
    });

    it(`${company} posts every disclosed investing/financing component with an explicit residual`, () => {
      const spec = companySpec(company);
      const { world, provenance: p } = createOperatingDemo({ company, scenario: "baseline" });
      for (const component of spec.cashFlowComponents!) {
        const postings = p.cashFlowPostings.filter((t) =>
          t.bankTxnId.includes(`/${component.category}/${component.id}/`),
        );
        expect(postings).toHaveLength(3);
        expect(sum(postings.map((t) => t.cents))).toBe(component.cents);
        for (const posting of postings) {
          const bank = world.snapshot.bankTxns.find((t) => t.id === posting.bankTxnId)!;
          expect(bank.amount).toBe(posting.cents);
          expect(bank.description).toContain("Synthetic date allocation");
          expect(bank.description).toContain("not an actual transaction");
          expect(posting.date >= p.periodStart && posting.date <= p.periodEnd).toBe(true);
          expect(posting.recordId).toBe(component.anchorId);
        }
        if (component.anchorId)
          expect(spec.reported.find((a) => a.id === component.anchorId)!.cents).toBe(
            component.cents,
          );
      }
      for (const category of ["investing", "financing"] as const) {
        expect(spec.cashFlowComponents!.some((c) => c.id === `${category}-residual`)).toBe(true);
        expect(
          sum(spec.cashFlowComponents!.filter((c) => c.category === category).map((c) => c.cents)),
        ).toBe(p.reconciliation[`${category}CashFlowCents`]);
      }
      for (const line of ["operating", "investing", "financing", "foreignExchangeEffect"]) {
        const quarter = spec.reported.find((a) => a.id === `derived-quarter.${line}`)!;
        const six = spec.reported.find(
          (a) =>
            a.id ===
            (company === "asana-current"
              ? `cashFlow.sixMonths.${line}`
              : `cashFlowSixMonths.${line}`),
        )!;
        const three = spec.reported.find(
          (a) =>
            a.id ===
            (company === "asana-current"
              ? `cashFlow.firstQuarter.${line}`
              : `cashFlowThreeMonths.${line}`),
        )!;
        expect(quarter.cents).toBe(six.cents - three.cents);
        expect(quarter.note).toContain(six.sourceUrl);
        expect(quarter.note).toContain(three.sourceUrl);
      }
      expect(
        spec.reported.find((a) => a.id === "derived-balance.open.deferredLiabilities")!.periodEnd,
      ).toBe("2026-04-30");
    });
  }

  it("retains acquisition, securities, debt and equity cash separately from operating vendors", () => {
    const asana = companySpec("asana-current");
    const value = (id: string) => asana.cashFlowComponents!.find((c) => c.id === id)!.cents;
    expect(value("acquisition")).toBe(-7_161_600_000);
    expect(value("marketableSales")).toBe(13_360_300_000);
    expect(value("marketablePurchases")).toBe(-3_170_700_000);
    expect(value("marketableMaturities")).toBe(850_600_000);
    expect(value("termLoanRepayment")).toBe(-125_000_000);
    expect(value("shareRepurchases")).toBe(-5_154_100_000);
    expect(value("financing-residual")).toBe(0);
    const gitlab = companySpec("gitlab-current");
    expect(gitlab.cashFlowComponents!.find((c) => c.id === "financing-residual")!.cents).toBe(
      688_600_000,
    );
    expect(
      gitlab.cashFlowComponents!.some((c) => c.id === "employeeStockPurchasePlanProceeds"),
    ).toBe(false);
    expect(
      gitlab.reported.some((a) => a.id === "derived-quarter.cashTaxesPaidIncludingJiHuSettlement"),
    ).toBe(false);
    for (const line of ["operating", "propertyAndEquipmentPurchases"]) {
      expect(gitlab.reported.find((a) => a.id === `derived-quarter.${line}`)!.cents).toBe(
        gitlab.reported.find((a) => a.id === `cashFlowQuarterRelease.${line}`)!.cents,
      );
    }
    expect(gitlab.reported.find((a) => a.id === "quarterStockBasedCompensation")!.cents).toBe(
      7_500_600_000,
    );
    expect(gitlab.reported.find((a) => a.id === "balanceSheetOpening.accountsPayable")!.cents).toBe(
      884_700_000,
    );
    expect(gitlab.reported.find((a) => a.id === "balanceSheetClosing.accountsPayable")!.cents).toBe(
      995_500_000,
    );
  });
});
