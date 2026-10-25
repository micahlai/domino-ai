import { mulDiv } from "../drivers/basics.ts";
import currentSourceAnchors from "./current-source-anchors.json";
import { currentCompanySpec } from "./current-spec.ts";
import sourceAnchors from "./source-anchors.json";
import {
  type CashFlowCategory,
  OPERATING_CURRENT_AS_OF,
  OPERATING_DEMO_LABEL,
  type OperatingCompanyCatalogEntry,
  type OperatingCompanyId,
  type ReportedAnchor,
} from "./types.ts";

/** Source tables say USD thousands. Parentheses encode negatives, not missing values. */
export function thousandsToCents(value: string): number {
  if (!/^(?:-?\d[\d,]*|\(\d[\d,]*\))$/.test(value)) throw new Error("invalid USD thousands");
  const plain = value.replaceAll(",", "").replace("(", "-").replace(")", "");
  const cents = Number(BigInt(plain) * 100_000n);
  if (!Number.isSafeInteger(cents)) throw new Error("unsafe source money");
  return cents;
}

/** Preserve original units and decimal precision without floating-point money arithmetic. */
export function reportedValueToCents(value: string, unit: string): number {
  if (unit === "USD thousands") return thousandsToCents(value);
  if (
    unit !== "USD millions" ||
    !/^(?:-?\d[\d,]*(?:\.\d{1,8})?|\(\d[\d,]*(?:\.\d{1,8})?\))$/.test(value)
  )
    throw new Error("invalid source money or unit");
  const plain = value.replaceAll(",", "").replace("(", "-").replace(")", "");
  const negative = plain.startsWith("-");
  const [whole, fraction = ""] = plain.replace("-", "").split(".");
  const cents = Number(
    (BigInt(whole!) * 100_000_000n + BigInt(fraction.padEnd(8, "0"))) * (negative ? -1n : 1n),
  );
  if (!Number.isSafeInteger(cents)) throw new Error("unsafe source money");
  return cents;
}

export const operatingDemoCatalog: readonly OperatingCompanyCatalogEntry[] = [
  {
    id: "2u",
    name: "2U",
    referenceCompany: "2U, Inc.",
    label: OPERATING_DEMO_LABEL,
    periodStart: "2023-01-01",
    periodEnd: "2023-09-30",
    reportedAt: "2023-11-09",
    simulationAsOf: "2023-09-30",
    selectorDescription: "2U · Current scenarios",
  },
  {
    id: "asana-inspired",
    name: "Taskline (inspired by Asana)",
    referenceCompany: "Asana, Inc.",
    label:
      "Fictional Taskline demo inspired by Asana public filings, with reconstructed operating data.",
    periodStart: "2023-08-01",
    periodEnd: "2023-10-31",
    reportedAt: "2023-12-05",
    simulationAsOf: "2023-10-31",
  },
  {
    id: "gitlab-inspired",
    name: "CodeHarbor (inspired by GitLab)",
    referenceCompany: "GitLab Inc.",
    label:
      "Fictional CodeHarbor demo inspired by GitLab public filings, with reconstructed operating data.",
    periodStart: "2023-08-01",
    periodEnd: "2023-10-31",
    reportedAt: "2023-12-05",
    simulationAsOf: "2023-10-31",
  },
  {
    id: "asana-current",
    name: "Taskline (inspired by Asana)",
    referenceCompany: "Asana, Inc.",
    label:
      "Fictional Taskline demo based on Asana, Inc. filings for May 1 to July 31, 2026, published September 3, 2026; reconstructed books as of October 25, 2026.",
    periodStart: "2026-05-01",
    periodEnd: "2026-07-31",
    reportedAt: "2026-09-03",
    filedAt: "2026-09-03",
    simulationAsOf: OPERATING_CURRENT_AS_OF,
    selectorDescription: "Taskline · inspired by Asana",
  },
  {
    id: "gitlab-current",
    name: "CodeHarbor (inspired by GitLab)",
    referenceCompany: "GitLab Inc.",
    label:
      "Fictional CodeHarbor demo based on GitLab Inc. filings for May 1 to July 31, 2026, published September 1 and filed September 2, 2026; reconstructed books as of October 25, 2026.",
    periodStart: "2026-05-01",
    periodEnd: "2026-07-31",
    reportedAt: "2026-09-01",
    filedAt: "2026-09-02",
    simulationAsOf: OPERATING_CURRENT_AS_OF,
    selectorDescription: "CodeHarbor · inspired by GitLab",
  },
] as const;

/**
 * Company modes outside the operating feeds. The 2U backtest replays real filings from the
 * Nov 10, 2023 cutoff at its own page; the selector can list it beside the operating companies.
 */
export const companyModeCatalog = [
  {
    id: "2u-backtest-2023-11",
    company: "2u",
    mode: "Backtest: Nov 2023",
    selectorDescription: "2U · Backtest from Nov 2023 (real history)",
    href: "/case/2u/backtest",
  },
] as const;

export const operatingScenarioCatalog = [
  {
    id: "baseline",
    name: "Baseline",
    description:
      "Illustrative continuation of reconstructed customer billing and cash costs after the reported period.",
  },
  {
    id: "late-payments",
    name: "Late payments",
    description:
      "A synthetic customer cohort takes 21 extra days to pay after the reported period; future billing terms reflect the delay.",
  },
  {
    id: "customer-loss",
    name: "Customer loss",
    description:
      "A synthetic customer cohort cancels future renewals after the reported period. Existing receivables remain collectible.",
  },
  {
    id: "unexpected-expense",
    name: "Unexpected expense",
    description:
      "An illustrative urgent supplier bill, equal to 25% of a reconstructed month's cash costs, is due 35 days after the reported period.",
  },
] as const;

export function reportedAnchors(company: OperatingCompanyId): ReportedAnchor[] {
  const entries =
    company === "asana-current" || company === "gitlab-current"
      ? currentSourceAnchors[company]
      : sourceAnchors[company];
  return entries.map((entry) => ({
    ...entry,
    cents: reportedValueToCents(entry.sourceValue, entry.sourceUnit),
    basis:
      "basis" in entry && entry.basis === "derived-from-reported"
        ? "derived-from-reported"
        : "reported",
  }));
}

export function companySpec(company: OperatingCompanyId): OperatingSpec {
  const catalog = operatingDemoCatalog.find((entry) => entry.id === company)!;
  const reported = reportedAnchors(company);
  if (company === "asana-current" || company === "gitlab-current")
    return currentCompanySpec({ ...catalog, id: company }, reported);
  const value = (id: string) => {
    const anchor = reported.find((entry) => entry.id === id);
    if (!anchor) throw new Error(`missing anchor ${id}`);
    return anchor.cents;
  };
  const derived = (
    id: string,
    label: string,
    amount: number,
    note: string,
    sourceIds: string[],
  ) => {
    const urls = [
      ...new Set(
        sourceIds.map((sourceId) => {
          const anchor = reported.find((entry) => entry.id === sourceId);
          if (!anchor) throw new Error(`missing source anchor ${sourceId}`);
          return anchor.sourceUrl;
        }),
      ),
    ];
    reported.push({
      id,
      label,
      cents: amount,
      periodStart: catalog.periodStart,
      periodEnd: catalog.periodEnd,
      sourceUrl: urls[0]!,
      basis: "derived-from-reported",
      note: `${note} Derivation sources: ${urls.join("; ")}`,
    });
    return amount;
  };
  if (company === "2u")
    return {
      ...catalog,
      reported,
      months: 9,
      openingCash: value("F04"),
      endingCash: value("F03"),
      restrictedCash: value("F02"),
      ocf: value("F05"),
      icf: value("F06"),
      fcf: value("F07"),
      fx: value("F08"),
      revenue: value("ytd.revenue"),
      quarterRevenue: value("q3.revenue"),
      openingAR: value("opening-ar"),
      closingAR: value("F10"),
      openingDeferred: value("opening-deferred"),
      closingDeferred: value("closing-deferred"),
      expenses: value("ytd.total-costs-and-expenses"),
      noncash: [
        "depreciation-and-amortization",
        "stock-compensation",
        "noncash-lease",
        "noncash-restructuring",
        "impairment",
        "credit-loss-provision",
      ].reduce((sum, id) => sum + value(`noncash.${id}`), 0),
    };
  const asana = company === "asana-inspired";
  const revenue = value(asana ? "revenue" : "quarterIncome.totalRevenue");
  const openingCash = value(
    asana ? "cash_and_equivalents_prior_quarter_close" : "cashOpeningQuarter",
  );
  const endingCash = value(asana ? "cash_and_equivalents_close" : "cashClosingQuarter");
  const quarter = (line: string) =>
    derived(
      `derived-quarter.${line}`,
      `Quarter ${line} cash flow`,
      value(`cashFlowNineMonths.${line}`) - value(`cashFlowSixMonths.${line}`),
      "Nine months less six months; same USD thousands cash-flow basis.",
      [`cashFlowNineMonths.${line}`, `cashFlowSixMonths.${line}`],
    );
  const ocf = asana ? value("operating_cash_flow_quarter") : quarter("operating");
  const icf = asana ? value("investing_cash_flow_quarter") : quarter("investing");
  const fcf = asana ? value("financing_cash_flow_quarter") : quarter("financing");
  const fx = asana
    ? derived(
        "derived-quarter.fx",
        "Quarter foreign exchange and cash reconciliation residual",
        endingCash - openingCash - ocf - icf - fcf,
        "Derived residual from the cash endpoints and three reported cash-flow categories; not separately verified FX.",
        [
          "cash_and_equivalents_close",
          "cash_and_equivalents_prior_quarter_close",
          "operating_cash_flow_quarter",
          "investing_cash_flow_quarter",
          "financing_cash_flow_quarter",
        ],
      )
    : quarter("foreignExchangeEffect");
  return {
    ...catalog,
    reported,
    months: 3,
    openingCash,
    endingCash,
    restrictedCash: 0,
    ocf,
    icf,
    fcf,
    fx,
    revenue,
    quarterRevenue: revenue,
    openingAR: mulDiv(revenue, 15, 100),
    closingAR: mulDiv(revenue, 25, 100),
    openingDeferred: mulDiv(revenue, 20, 100),
    closingDeferred: mulDiv(revenue, 25, 100),
    expenses: asana
      ? value("total_operating_expenses") + value("cost_of_revenues")
      : value("quarterIncome.totalOperatingExpenses") + value("quarterIncome.totalCostOfRevenue"),
    noncash: asana ? value("stock_based_compensation") : value("quarterStockBasedCompensation"),
  };
}
export interface OperatingCashComponent {
  id: string;
  label: string;
  category: Exclude<CashFlowCategory, "operating">;
  cents: number;
  anchorId?: string;
}
export interface OperatingSpec extends OperatingCompanyCatalogEntry {
  reported: ReportedAnchor[];
  months: number;
  openingCash: number;
  endingCash: number;
  restrictedCash: number;
  ocf: number;
  icf: number;
  fcf: number;
  fx: number;
  revenue: number;
  quarterRevenue: number;
  openingAR: number;
  closingAR: number;
  openingDeferred: number;
  closingDeferred: number;
  expenses: number;
  noncash: number;
  cashFlowComponents?: OperatingCashComponent[];
  deferredScopeAdjustment?: number;
}
