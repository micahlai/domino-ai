import type { Cents, ISODate } from "@domino/contracts";

export const OPERATING_PRIMARY_COMPANY_IDS = ["2u", "asana-current", "gitlab-current"] as const;
export const OPERATING_COMPANY_IDS = [
  "2u",
  "asana-inspired",
  "gitlab-inspired",
  "asana-current",
  "gitlab-current",
] as const;
/** Frozen reconstruction cutoff, independent of the machine clock. */
export const OPERATING_CURRENT_AS_OF = "2026-10-25";
export type OperatingCompanyId = (typeof OPERATING_COMPANY_IDS)[number];
export const OPERATING_SCENARIO_IDS = [
  "baseline",
  "late-payments",
  "customer-loss",
  "unexpected-expense",
] as const;
export type OperatingScenarioId = (typeof OPERATING_SCENARIO_IDS)[number];
export interface OperatingSelection {
  company: OperatingCompanyId;
  scenario: OperatingScenarioId;
}
export const OPERATING_DEMO_LABEL =
  "Based on 2U public filings, with reconstructed operating data.";

export interface OperatingCompanyCatalogEntry {
  id: OperatingCompanyId;
  name: string;
  referenceCompany: string;
  label: string;
  periodStart: ISODate;
  periodEnd: ISODate;
  reportedAt: ISODate;
  simulationAsOf: ISODate;
  filedAt?: ISODate;
}

export interface ReportedAnchor {
  id: string;
  label: string;
  cents: Cents;
  periodStart?: ISODate;
  periodEnd: ISODate;
  sourceUrl: string;
  basis: "reported" | "derived-from-reported";
  sourceValue?: string;
  sourceUnit?: string;
  note?: string;
}
export type CashFlowCategory = "operating" | "investing" | "financing" | "fx";
export interface OperatingPayablesBridge {
  basis: "reconstructed";
  openingDate: ISODate;
  closingDate: ISODate;
  reportedOpeningPayablesAndAccrualsCents: Cents;
  reportedClosingPayablesAndAccrualsCents: Cents;
  balanceIncreaseCents: Cents;
  cashFlowAdjustmentCents: Cents;
  cashFlowAdjustmentLessBalanceIncreaseCents: Cents;
  supplierAllocationCents: Cents;
  payrollAndOtherAccrualAllocationCents: Cents;
  baselineFutureBillsCents: Cents;
  baselineFuturePayrollCents: Cents;
  unincurredFutureBillCostsCents: Cents;
  unincurredFuturePayrollCostsCents: Cents;
  allocations: {
    recordKind: "bill" | "payroll";
    recordId: string;
    expectedPaymentDate: ISODate;
    expectedAmountCents: Cents;
    allocatedPayablesCents: Cents;
  }[];
  note: string;
}
export interface OperatingProvenance extends OperatingSelection {
  version: 1;
  label: string;
  periodStart: ISODate;
  periodEnd: ISODate;
  reportedAt: ISODate;
  reported: ReportedAnchor[];
  assumptions: string[];
  /** All entries are synthetic accrual allocations, never invoices or collections. */
  revenueRecognition: {
    id: string;
    date: ISODate;
    cents: Cents;
    basis: "reconstructed";
    description: string;
  }[];
  /** Historical bank links only. Future private settlement schedules never leave the generator. */
  cashFlowPostings: {
    bankTxnId: string;
    date: ISODate;
    cents: Cents;
    category: CashFlowCategory;
    recordId?: string;
    basis: "reconstructed";
  }[];
  accrualBridge: {
    basis: "reconstructed";
    openingReceivablesCents: Cents;
    invoicedCents: Cents;
    collectionsCents: Cents;
    endingReceivablesCents: Cents;
    openingDeferredRevenueCents: Cents;
    endingDeferredRevenueCents: Cents;
    recognizedRevenueCents: Cents;
    receivablesAdjustmentCents: Cents;
    /** Rounded closing advance balance used only as a scope adjustment, not cash or quarter change. */
    deferredRevenueAdjustmentCents?: Cents;
    note: string;
  };
  expenseBridge: {
    basis: "reconstructed";
    gaapExpensesCents: Cents;
    identifiedNoncashExpensesCents: Cents;
    cashConversionAdjustmentCents: Cents;
    modeledOperatingPaymentsCents: Cents;
    note: string;
  };
  /** Only present when reported opening and closing AP/accrual anchors are available. */
  payablesBridge?: OperatingPayablesBridge;
  /** Post-report reconstructed observations, never claimed to be filed balances. */
  currentLedger?: {
    asOf: ISODate;
    reportedPeriodEnd: ISODate;
    reportedEndingCashCents: Cents;
    reconstructedCashChangeCents: Cents;
    cashOnHandCents: Cents;
    restrictedCashCents: Cents;
    basis: "reconstructed";
  };
  /** A factual endpoint does not make its reconstructed allocation factual. */
  aggregateBasis: Record<string, string>;
  reconciliation: {
    openingCashCents: Cents;
    operatingCashFlowCents: Cents;
    investingCashFlowCents: Cents;
    financingCashFlowCents: Cents;
    fxCashFlowCents: Cents;
    endingCashCents: Cents;
    restrictedCashCents: Cents;
    revenueCents: Cents;
    outstandingReceivablesCents: Cents;
    balanced: boolean;
  };
}
