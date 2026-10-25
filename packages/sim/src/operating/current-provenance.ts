import { sum } from "../drivers/basics.ts";
import type { OperatingSpec } from "./anchors.ts";
import { observableLedger } from "./ledger.ts";
import type { OperatingProvenance, OperatingScenarioId } from "./types.ts";

const scenarioAssumptions: Record<OperatingScenarioId, string> = {
  baseline: "Baseline continues reconstructed billing and cash costs after October 25, 2026.",
  "late-payments":
    "A synthetic customer cohort receives 21 additional payment-term days only on invoices issued after October 25, 2026. Existing invoice terms and all prior payment observations are unchanged.",
  "customer-loss":
    "A synthetic customer cohort cancels renewals issued after October 25, 2026. Existing receivables remain collectible and prior invoices are unchanged.",
  "unexpected-expense":
    "A synthetic urgent supplier bill equal to 25% of a reconstructed month's cash costs is due 35 days after October 25, 2026. It creates no historical payment.",
};

/** The report bridge remains July-only. The separate nowcast is explicitly a reconstruction. */
export function withCurrentLedger(
  provenance: OperatingProvenance,
  spec: OperatingSpec,
  seed: number,
): OperatingProvenance {
  const deferredNote = deferredScopeNote(spec);
  return {
    ...provenance,
    assumptions: currentAssumptions(provenance, spec, deferredNote),
    accrualBridge: {
      ...provenance.accrualBridge,
      ...(spec.deferredScopeAdjustment !== undefined && {
        deferredRevenueAdjustmentCents: spec.deferredScopeAdjustment,
      }),
      note: `Opening AR + invoices - collections + adjustments = ending AR. Opening deferred liabilities + invoices - recognized revenue + scope adjustment = closing deferred liabilities. Net-balance simplification, not reported gross billings or collections. ${deferredNote}`,
    },
    aggregateBasis: currentBasis(provenance, spec, deferredNote),
    currentLedger: reconstructedLedger(spec, seed),
  };
}

function deferredScopeNote(spec: OperatingSpec): string {
  return spec.id === "asana-current"
    ? "Reported current plus noncurrent deferred revenue endpoints constrain a simplified synthetic billing bridge. Acquisition effects are not separated and the bridge is not reported gross billings."
    : "Reported opening deferred revenue and closing deferred revenue plus customer advances constrain a simplified synthetic bridge. The July current line includes customer advances and differs in scope from April. The rounded $15.0 million July advance balance is an explicit scope adjustment outside revenue invoices. This is not a reported quarter advance change or bank receipt, and no opening advance zero is inferred; billings remain synthetic.";
}

function reconstructedLedger(
  spec: OperatingSpec,
  seed: number,
): NonNullable<OperatingProvenance["currentLedger"]> {
  const { snapshot } = observableLedger(spec, seed, "baseline", spec.simulationAsOf);
  const reconstructedCashChangeCents = sum(
    snapshot.bankTxns.filter((t) => t.date > spec.periodEnd).map((t) => t.amount),
  );
  return {
    basis: "reconstructed",
    asOf: spec.simulationAsOf,
    reportedPeriodEnd: spec.periodEnd,
    reportedEndingCashCents: spec.endingCash,
    reconstructedCashChangeCents,
    cashOnHandCents: snapshot.cashOnHand,
    restrictedCashCents: snapshot.restrictedCash,
  };
}

function currentAssumptions(
  provenance: OperatingProvenance,
  spec: OperatingSpec,
  deferredNote: string,
): string[] {
  const asana = spec.id === "asana-current";
  return [
    provenance.assumptions[0]!,
    `Reported anchors cover May 1 through July 31, 2026. The release was published ${spec.reportedAt} and the Form 10-Q was filed ${spec.filedAt}. The reconstructed operating books start October 25, 2026 and the 13-week forecast starts October 26. Post-report observations through October 25 follow the same baseline simulation for every scenario and are not later reported results.`,
    "Revenue recognition is an accrual schedule. Synthetic invoices equal reported revenue plus the change in reported deferred liabilities, less any separately labeled scope adjustment. Synthetic receipts equal opening net receivables plus invoices less ending net receivables. The simplifying bridge assumes no separate receivable write-offs or FX; unobserved advance cash activity remains within the synthetic cash-conversion residual.",
    provenance.assumptions[3]!,
    provenance.assumptions[4]!,
    "Reported investing and financing components retain separate bank entries with synthetic monthly dates. Named residuals reconcile category totals after disclosed comparable components; they are not supplier cash payments. Actual reported foreign exchange is derived as six months less three months, never a residual.",
    provenance.assumptions[6]!,
    provenance.assumptions[7]!,
    provenance.assumptions[8]!,
    deferredNote,
    asana
      ? "Reported combined cash includes restricted cash. The July restricted balance is held constant in the post-report reconstruction. Marketable securities remain separate from cash. Acquisition-related receivable and deferred effects are not separately modeled."
      : "GitLab does not separately report or reconcile restricted cash in the cited statements. Zero restricted cash is an explicit fictional reconstruction assumption, not a verified reported zero. Short-term investments remain outside cash. Cash-tax disclosures have different scopes across quarters and are not subtracted into an invented quarter cash-tax amount.",
    "Reported opening and closing AP, accruals, total assets and liabilities remain source anchors. Future bills and payroll are synthetic expectations, without a claimed exact allocation of reported AP or a fabricated AP cash-flow adjustment. Stock compensation remains noncash; accounting income-tax provisions are not bank payments.",
    scenarioAssumptions[provenance.scenario],
  ];
}

function currentBasis(
  provenance: OperatingProvenance,
  spec: OperatingSpec,
  deferredNote: string,
): Record<string, string> {
  const asana = spec.id === "asana-current";
  return {
    ...provenance.aggregateBasis,
    cash: asana
      ? "Reported July combined cash and restricted cash; usable cash is combined less restricted. October cash is reconstructed and July restricted cash is held constant; securities excluded."
      : "Reported July cash and equivalents; restricted cash is assumed zero for this fictional reconstruction, not verified zero. October cash is reconstructed; short-term investments excluded.",
    cashFlow:
      "Reported-quarter categories derived in integer cents from comparable six-month less three-month filings, including actual FX. Disclosed investing/financing components and explicit residuals have synthetic bank dates. Post-report cash is a separate baseline reconstruction.",
    receivables:
      "Reported April and July net receivables constrain reconstructed invoice allocations. The synthetic billing and collection bridge is not a disclosure of actual transactions.",
    deferredRevenue: deferredNote,
    payables:
      "Reported April and July AP and accrual balances retained as source anchors. Future bills and payroll are reconstructed expectations, without a verified allocation or payment schedule for reported closing payables.",
    forecast:
      "Illustrative plans from October 26, 2026. Scenarios affect future terms, renewals or expenses only after the fixed October 25 reconstruction cutoff; no later outcomes or wall-clock dates are used.",
  };
}
