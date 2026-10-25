import type { Cents, ISODate } from "@domino/contracts";

export const OPERATING_COMPANY_IDS = ["2u", "asana-inspired", "gitlab-inspired"] as const;
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
