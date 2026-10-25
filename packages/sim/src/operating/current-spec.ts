import type { OperatingCashComponent, OperatingSpec } from "./anchors.ts";
import type { OperatingCompanyCatalogEntry, ReportedAnchor } from "./types.ts";

type CurrentCatalog = OperatingCompanyCatalogEntry & { id: "asana-current" | "gitlab-current" };
interface CurrentContext {
  catalog: CurrentCatalog;
  reported: ReportedAnchor[];
  asana: boolean;
}
type CashTotals = Pick<OperatingSpec, "ocf" | "icf" | "fcf" | "fx">;
type ComponentRecipe = readonly ["investing" | "financing", string, boolean?];
const ASANA_COMPONENTS: readonly ComponentRecipe[] = [
  ["investing", "acquisition", true],
  ["investing", "marketableSales", true],
  ["investing", "marketablePurchases"],
  ["investing", "marketableMaturities"],
  ["investing", "propertyEquipment"],
  ["investing", "capitalizedSoftware"],
  ["financing", "termLoanRepayment"],
  ["financing", "shareRepurchases"],
  ["financing", "stockOptionProceeds"],
  ["financing", "employeeSharePlanProceeds"],
];
const GITLAB_COMPONENTS: readonly ComponentRecipe[] = [
  ["investing", "purchasesOfShortTermInvestments"],
  ["investing", "maturitiesOfShortTermInvestments"],
  ["investing", "salesOfShortTermInvestments"],
  ["investing", "propertyAndEquipmentPurchases"],
  ["financing", "stockOptionExerciseProceedsNet"],
  ["financing", "commonStockRepurchases"],
  ["financing", "netShareSettlementTaxPayments"],
];

function anchor(context: CurrentContext, id: string): ReportedAnchor {
  const found = context.reported.find((entry) => entry.id === id);
  if (!found) throw new Error(`missing current anchor ${id}`);
  return found;
}
const value = (context: CurrentContext, id: string) => anchor(context, id).cents;

function derive(
  context: CurrentContext,
  id: string,
  label: string,
  ids: string[],
  subtract = false,
) {
  const sources = ids.map((sourceId) => anchor(context, sourceId));
  const cents = sources.reduce(
    (total, source, i) => total + (subtract && i > 0 ? -source.cents : source.cents),
    0,
  );
  context.reported.push({
    id,
    label,
    cents,
    ...(subtract
      ? { periodStart: context.catalog.periodStart, periodEnd: context.catalog.periodEnd }
      : { periodEnd: sources[0]!.periodEnd }),
    sourceUrl: sources[0]!.sourceUrl,
    basis: "derived-from-reported",
    note: `${subtract ? "Comparable six-month less three-month reported amounts" : "Sum of reported balance components"}. Inputs: ${ids.join(", ")}. Derivation sources: ${[...new Set(sources.map((source) => source.sourceUrl))].join("; ")}`,
  });
  return cents;
}

/** An omitted first-quarter line is never substituted with a reported zero. */
function quarter(context: CurrentContext, line: string): number {
  const cents = derive(
    context,
    `derived-quarter.${line}`,
    `Quarter ${line} cash flow`,
    context.asana
      ? [`cashFlow.sixMonths.${line}`, `cashFlow.firstQuarter.${line}`]
      : [`cashFlowSixMonths.${line}`, `cashFlowThreeMonths.${line}`],
    true,
  );
  const crosscheck = context.reported.find(
    (a) =>
      a.id ===
      (context.asana ? `cashFlow.quarterRelease.${line}` : `cashFlowQuarterRelease.${line}`),
  );
  if (crosscheck && crosscheck.cents !== cents)
    throw new Error(`quarter release mismatch: ${line}`);
  return cents;
}

function cashComponents(context: CurrentContext, totals: CashTotals): OperatingCashComponent[] {
  const components: OperatingCashComponent[] = (
    context.asana ? ASANA_COMPONENTS : GITLAB_COMPONENTS
  ).map(([category, line, direct]) => {
    const anchorId = direct ? `cashFlow.quarterRelease.${line}` : `derived-quarter.${line}`;
    const cents = direct ? value(context, anchorId) : quarter(context, line);
    return { id: line, label: anchor(context, anchorId).label, category, cents, anchorId };
  });
  for (const [category, total] of [
    ["investing", totals.icf],
    ["financing", totals.fcf],
  ] as const) {
    const known = components
      .filter((c) => c.category === category)
      .reduce((sum, c) => sum + c.cents, 0);
    components.push({
      id: `${category}-residual`,
      category,
      cents: total - known,
      label: `Explicit ${category} residual after comparable disclosed components; undisclosed quarter composition`,
    });
  }
  components.push({
    id: "foreignExchangeEffect",
    label: "Reported quarter foreign-exchange effect",
    category: "fx",
    cents: totals.fx,
    anchorId: "derived-quarter.foreignExchangeEffect",
  });
  return components;
}

function cashBalances(context: CurrentContext) {
  const combined = (side: "open" | "close") =>
    derive(
      context,
      `derived-balance.${side}.combinedCash`,
      `Combined ${side} cash and restricted cash`,
      [`balance.${side}.cash_and_equivalents`, `balance.${side}.restricted_cash`],
    );
  return {
    openingCash: context.asana ? combined("open") : value(context, "cashOpeningQuarter"),
    endingCash: context.asana ? combined("close") : value(context, "cashClosingQuarter"),
    restrictedCash: context.asana ? value(context, "balance.close.restricted_cash") : 0,
  };
}

function deferred(context: CurrentContext, side: "open" | "close"): number {
  const ids = context.asana
    ? [`balance.${side}.deferred_revenue_current`, `balance.${side}.deferred_revenue_noncurrent`]
    : side === "open"
      ? [
          "balanceSheetOpening.deferredRevenueCurrent",
          "balanceSheetOpening.deferredRevenueNoncurrent",
        ]
      : [
          "balanceSheetClosing.deferredRevenueAndCustomerAdvancesCurrent",
          "balanceSheetClosing.deferredRevenueNoncurrent",
        ];
  return derive(
    context,
    `derived-balance.${side}.deferredLiabilities`,
    `${side} deferred liabilities${!context.asana && side === "close" ? " including customer advances" : ""}`,
    ids,
  );
}

function workingBalances(context: CurrentContext) {
  return {
    openingAR: value(
      context,
      context.asana
        ? "balance.open.accounts_receivable_net"
        : "balanceSheetOpening.accountsReceivableNet",
    ),
    closingAR: value(
      context,
      context.asana
        ? "balance.close.accounts_receivable_net"
        : "balanceSheetClosing.accountsReceivableNet",
    ),
    openingDeferred: deferred(context, "open"),
    closingDeferred: deferred(context, "close"),
    ...(!context.asana && { deferredScopeAdjustment: value(context, "customerAdvancesClosing") }),
  };
}

function income(context: CurrentContext) {
  const revenue = value(
    context,
    context.asana ? "income.quarter.revenue" : "quarterIncome.totalRevenue",
  );
  return {
    revenue,
    quarterRevenue: revenue,
    expenses: context.asana
      ? value(context, "income.quarter.cost_of_revenues") +
        value(context, "income.quarter.total_operating_expenses")
      : value(context, "quarterIncome.totalCostOfRevenue") +
        value(context, "quarterIncome.totalOperatingExpenses"),
    noncash: value(
      context,
      context.asana ? "income.quarter.stock_based_compensation" : "quarterStockBasedCompensation",
    ),
  };
}

/** Retain reported endpoints and source strings; all quarter arithmetic runs in integer cents. */
export function currentCompanySpec(
  catalog: CurrentCatalog,
  reported: ReportedAnchor[],
): OperatingSpec {
  const context = { catalog, reported, asana: catalog.id === "asana-current" };
  const totals = {
    ocf: quarter(context, "operating"),
    icf: quarter(context, "investing"),
    fcf: quarter(context, "financing"),
    fx: quarter(context, "foreignExchangeEffect"),
  };
  quarter(context, context.asana ? "netIncreaseCombinedCash" : "netCashChange");
  const components = cashComponents(context, totals);
  const balances = cashBalances(context);
  if (
    balances.openingCash + totals.ocf + totals.icf + totals.fcf + totals.fx !==
    balances.endingCash
  )
    throw new Error("reported current cash bridge does not balance");
  return {
    ...catalog,
    reported,
    months: 3,
    ...balances,
    ...totals,
    ...income(context),
    ...workingBalances(context),
    cashFlowComponents: components,
  };
}
