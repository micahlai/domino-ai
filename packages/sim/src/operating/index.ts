import { type Constraint, type WorldState, WorldStateSchema } from "@domino/contracts";
import { addDays, isRealDate } from "../create.ts";
import { daysBetween, mulDiv, sum } from "../drivers/basics.ts";
import { companySpec, operatingScenarioCatalog } from "./anchors.ts";
import { withCurrentLedger } from "./current-provenance.ts";
import { historicalLedger, observableLedger } from "./ledger.ts";
import { payablesBridge } from "./payables.ts";
import {
  OPERATING_COMPANY_IDS,
  OPERATING_SCENARIO_IDS,
  type OperatingProvenance,
  type OperatingSelection,
} from "./types.ts";

export * from "./types.ts";
export { operatingDemoCatalog, operatingScenarioCatalog } from "./anchors.ts";

function validate(selection: OperatingSelection, seed: number) {
  if (
    !OPERATING_COMPANY_IDS.includes(selection.company) ||
    !OPERATING_SCENARIO_IDS.includes(selection.scenario)
  )
    throw new Error("invalid operating demo selection");
  if (!Number.isSafeInteger(seed)) throw new Error("seed must be a safe integer");
}

/** Immutable reported-period context. Future observations never change these anchors. */
export function operatingProvenance(selection: OperatingSelection, seed = 1): OperatingProvenance {
  validate(selection, seed);
  const spec = companySpec(selection.company);
  const ledger = historicalLedger(spec, seed);
  const payables = payablesBridge(spec, seed);
  const bankTotal = sum(ledger.snapshot.bankTxns.map((txn) => txn.amount));
  const closingAR = sum(ledger.snapshot.invoices.filter((i) => !i.paid).map((i) => i.amount));
  const categoryMatches = (
    [
      ["operating", spec.ocf],
      ["investing", spec.icf],
      ["financing", spec.fcf],
      ["fx", spec.fx],
    ] as const
  ).every(
    ([category, amount]) =>
      sum(ledger.postings.filter((p) => p.category === category).map((p) => p.cents)) === amount,
  );
  const provenance: OperatingProvenance = {
    version: 1,
    ...selection,
    label: spec.label,
    periodStart: spec.periodStart,
    periodEnd: spec.periodEnd,
    reportedAt: spec.reportedAt,
    reported: spec.reported,
    assumptions: [
      "Every customer, invoice, bank posting, vendor, payroll run and date allocation is synthetic. Reported totals constrain the reconstruction; they do not verify the individual records.",
      "The simulation starts at the reported period end. The later publication date is shown separately. Future dates are illustrative, not information known at that historical date and not later reported outcomes.",
      "Revenue recognition is an accrual schedule. Invoicing is reconstructed as revenue plus the change in deferred revenue; receipts equal opening net receivables plus invoicing less ending net receivables. This simplifying bridge assumes no separate write-offs or FX adjustments to receivables.",
      "Cash operating payments are the residual needed to reconcile reconstructed receipts to reported operating cash flow. Their 60% payroll, 35% supplier and 5% card allocation is illustrative, not reported expense composition.",
      "Identified noncash expenses are excluded before the explicit cash-conversion adjustment. Stock compensation, impairments, depreciation and GAAP tax provisions are not treated as payroll or tax payments.",
      "Historical cash-flow buckets are allocated across months. Invoice receipts settle directly to the bank with no modeled processor fee. Payment lags and customer concentration are seed-based assumptions.",
      "The existing engine's three-section reconstructed statement may classify the separate FX reconciliation amount under other operating. The four filing-category totals in this provenance reconciliation are authoritative; that engine grouping is not reported operating cash flow.",
      "Future billing plans use the latest reported quarter's monthly revenue scale and a synthetic mix of monthly, quarterly and annual renewals. Future payroll and recurring supplier bills are known expectations through the 13-week horizon. Private collection outcomes remain inside the simulator.",
      "Future recurring cash costs use the historical average monthly cash-payment bridge. Payroll uses the 15th and last calendar day, moved to the preceding weekday. Holidays and future financing, investment transfers and FX are not modeled.",
      ...(payables ? [payables.note] : []),
      spec.id === "2u"
        ? "2U uses the nine months ended September 30 for cash and revenue; July through September recognition separately equals reported Q3 revenue. Cash on hand includes restricted cash, which is subtracted to obtain usable cash. Reported debt and guidance anchors are context, not invented lending rules or future cash receipts."
        : "This is a fictional company inspired by public-company anchors. Customer records are reconstructed cohorts and invoices summarize customer pools, not individual real customers. Receivables are assumed at 15% of quarterly revenue on opening and 25% on closing; deferred revenue is assumed at 20% and 25%. Restricted cash is assumed zero, not a verified disclosure. Investments are excluded from cash.",
      ...(spec.id === "asana-inspired"
        ? [
            "The FX bucket is the derived residual between reported cash endpoints and the three cash-flow categories; its composition was not independently verified.",
          ]
        : []),
      operatingScenarioCatalog.find((entry) => entry.id === selection.scenario)!.description,
    ],
    revenueRecognition: ledger.recognition,
    cashFlowPostings: ledger.postings,
    accrualBridge: {
      basis: "reconstructed",
      openingReceivablesCents: spec.openingAR,
      invoicedCents: ledger.invoiced,
      collectionsCents: ledger.collections,
      endingReceivablesCents: closingAR,
      openingDeferredRevenueCents: spec.openingDeferred,
      endingDeferredRevenueCents: spec.closingDeferred,
      recognizedRevenueCents: spec.revenue,
      receivablesAdjustmentCents: 0,
      note: "Opening AR + invoices - collections + adjustments = ending AR. Opening deferred revenue + invoices - recognized revenue = ending deferred revenue. Net-balance simplification, not reported gross billings or collections.",
    },
    expenseBridge: {
      basis: "reconstructed",
      gaapExpensesCents: spec.expenses,
      identifiedNoncashExpensesCents: spec.noncash,
      cashConversionAdjustmentCents: ledger.payments - (spec.expenses - spec.noncash),
      modeledOperatingPaymentsCents: ledger.payments,
      note: "GAAP costs and expenses - identified noncash expenses + cash-conversion adjustment = modeled cash payments. The adjustment combines unmodeled accrual timing, other operating cash costs and working capital; it is synthetic and not a payroll estimate. Identified noncash expenses are not claimed exhaustive.",
    },
    ...(payables && { payablesBridge: payables }),
    aggregateBasis: {
      cash:
        spec.id === "2u"
          ? "Reported combined cash and restricted cash; usable cash is combined less restricted."
          : "Reported cash and equivalents; assumed zero restricted cash for this fictional demo; securities excluded.",
      cashFlow:
        spec.id === "gitlab-inspired"
          ? "Derived quarter from reported nine-month less six-month cash flows."
          : spec.id === "asana-inspired"
            ? "Reported quarter OCF/ICF/financing; derived cash-reconciliation residual in FX."
            : "Reported nine-month OCF/ICF/financing/FX.",
      revenue: "Reported period total, reconstructed monthly accrual timing; not collections.",
      receivables:
        spec.id === "2u"
          ? "Reported net opening and ending balances; reconstructed gross invoice allocation."
          : "Synthetic opening and closing receivables, expressed as a share of reported quarterly revenue.",
      deferredRevenue:
        spec.id === "2u"
          ? "Reported opening and closing deferred revenue balances; simplified synthetic billing bridge."
          : "Synthetic opening and closing deferred revenue at 20% and 25% of reported quarterly revenue.",
      payables: payables
        ? "Reported combined AP/accrual balances; explicit synthetic allocation against existing future bill/payroll expectations. No added cash payments or verified settlement schedule."
        : "No reported AP/accrual anchor supplied; future bills and payroll are reconstructed expectations, not reported closing payables.",
      invoicingAndCollections:
        "Reconstructed using the explicit accrual bridge; neither is reported revenue.",
      expenses:
        "Reported GAAP expense and identified noncash anchors; synthetic cash-conversion adjustment and payment allocation.",
      forecast:
        "Illustrative future plans and expectations only; no calibration against later filings.",
    },
    reconciliation: {
      openingCashCents: spec.openingCash,
      operatingCashFlowCents: spec.ocf,
      investingCashFlowCents: spec.icf,
      financingCashFlowCents: spec.fcf,
      fxCashFlowCents: spec.fx,
      endingCashCents: spec.endingCash,
      restrictedCashCents: spec.restrictedCash,
      revenueCents: spec.revenue,
      outstandingReceivablesCents: closingAR,
      balanced:
        categoryMatches &&
        spec.openingCash + bankTotal === spec.endingCash &&
        closingAR === spec.closingAR &&
        sum(ledger.recognition.map((r) => r.cents)) === spec.revenue,
    },
  };
  return spec.cashFlowComponents ? withCurrentLedger(provenance, spec, seed) : provenance;
}

function worldOn(selection: OperatingSelection, seed: number, today: string): WorldState {
  validate(selection, seed);
  const spec = companySpec(selection.company);
  const elapsed = daysBetween(spec.periodEnd, today);
  if (!isRealDate(today) || elapsed < 0 || elapsed > 3650)
    throw new Error("operating date must be within 3650 days after the reported period end");
  const { snapshot } = observableLedger(spec, seed, selection.scenario, today);
  return WorldStateSchema.parse({
    companyId: snapshot.companyId,
    profile: "kestrel",
    seed,
    week: Math.floor(daysBetween(spec.periodStart, today) / 7),
    today,
    snapshot,
    pendingEvents: [],
  });
}

export function createOperatingDemo(
  selection: OperatingSelection,
  seed = 1,
): { world: WorldState; provenance: OperatingProvenance; constraints: Constraint[] } {
  const provenance = operatingProvenance(selection, seed);
  const world = worldOn(selection, seed, companySpec(selection.company).simulationAsOf);
  const limit = mulDiv(
    provenance.expenseBridge.modeledOperatingPaymentsCents,
    1,
    companySpec(selection.company).months,
  );
  const constraints: Constraint[] = [
    {
      id: `synthetic/${selection.company}/illustrative-cash-buffer`,
      label: "Illustrative one-month cash buffer",
      kind: "min_cash",
      limit,
      evidence: {
        source: "document",
        ref: `synthetic/${selection.company}/cash-buffer-assumption`,
        note: "Synthetic demo threshold equal to one reconstructed month of operating cash payments. Not a reported company policy or loan covenant.",
      },
    },
  ];
  return { world, provenance, constraints };
}

export function operatingSelectionOf(world: WorldState): OperatingSelection | null {
  const parts = world.companyId.split("/");
  const company = OPERATING_COMPANY_IDS.find((id) => id === parts[1]);
  const scenario = OPERATING_SCENARIO_IDS.find((id) => id === parts[2]);
  return parts.length === 3 && parts[0] === "operating" && company && scenario
    ? { company, scenario }
    : null;
}

export function isOperatingWorld(world: WorldState): boolean {
  return (
    operatingSelectionOf(world) !== null &&
    world.runtime === undefined &&
    world.profile === "kestrel" &&
    world.snapshot.companyId === world.companyId &&
    world.snapshot.asOf === world.today
  );
}

/** Regeneration means reloads, retries and batched advances cannot double-post cash. */
export function advanceOperatingDays(world: WorldState, days: number): WorldState {
  const selection = operatingSelectionOf(world);
  if (!selection || !isOperatingWorld(world)) throw new Error("not an operating demo world");
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650)
    throw new Error("days must be an integer between 1 and 3650");
  if (!isRealDate(world.today)) throw new Error("invalid operating world date");
  return worldOn(selection, world.seed, addDays(world.today, days));
}
