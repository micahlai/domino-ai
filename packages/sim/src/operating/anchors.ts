import { mulDiv } from "../drivers/basics.ts";
import sourceAnchors from "./source-anchors.json";
import { OPERATING_DEMO_LABEL, type OperatingCompanyId, type ReportedAnchor } from "./types.ts";

/** Source tables say USD thousands. Parentheses encode negatives, not missing values. */
export function thousandsToCents(value: string): number {
  if (!/^(?:-?\d[\d,]*|\(\d[\d,]*\))$/.test(value)) throw new Error("invalid USD thousands");
  const plain = value.replaceAll(",", "").replace("(", "-").replace(")", "");
  const cents = Number(BigInt(plain) * 100_000n);
  if (!Number.isSafeInteger(cents)) throw new Error("unsafe source money");
  return cents;
}

export const operatingDemoCatalog = [
  {
    id: "2u",
    name: "2U",
    referenceCompany: "2U, Inc.",
    label: OPERATING_DEMO_LABEL,
    periodStart: "2023-01-01",
    periodEnd: "2023-09-30",
    reportedAt: "2023-11-09",
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
  return sourceAnchors[company].map((entry) => ({
    ...entry,
    cents: thousandsToCents(entry.sourceValue),
    basis:
      "basis" in entry && entry.basis === "derived-from-reported"
        ? "derived-from-reported"
        : "reported",
  }));
}

export function companySpec(company: OperatingCompanyId) {
  const catalog = operatingDemoCatalog.find((entry) => entry.id === company)!;
  const reported = reportedAnchors(company);
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
export type OperatingSpec = ReturnType<typeof companySpec>;
