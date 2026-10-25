"use client";

import { type OperatingProvenance, operatingDemoCatalog } from "@domino/sim";
import { useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import Link from "next/link";
import type { Id } from "../../convex/_generated/dataModel";
import { useOperatingSelection, useSelectedCompany } from "./company";
import { formatCents } from "./dashboard/money";

const CONTEXT = makeFunctionReference<
  "query",
  { companyId: Id<"companies"> },
  OperatingProvenance | null
>("fieldOperating:context");
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

export function OperatingProvenanceStrip() {
  const selection = useOperatingSelection();
  const label =
    operatingDemoCatalog.find((item) => item.id === selection.company)?.label ??
    "Filing-backed reconstruction";
  return (
    <div className="border-t bg-muted/35 px-4 py-2 text-xs md:px-6">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          Records reconstructed. Future scenarios and forecasts illustrative.
        </span>
        {CONVEX_URL ? (
          <LiveSources />
        ) : (
          <span className="text-muted-foreground">Source anchors need the backend.</span>
        )}
        {selection.company === "2u" ? (
          <Link href="/case/2u" className="ml-auto text-primary underline-offset-2 hover:underline">
            Separate 2U historical case
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function LiveSources() {
  const { companyId, error } = useSelectedCompany();
  const context = useQuery(CONTEXT, companyId ? { companyId } : "skip");
  if (error)
    return (
      <span role="alert" className="text-destructive">
        {error}
      </span>
    );
  return (
    <details className="relative">
      <summary className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline">
        Sources and cash bridge
      </summary>
      <div className="absolute left-0 top-full z-50 mt-2 max-h-[min(70vh,38rem)] w-[min(37rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border bg-card p-4 text-foreground shadow-lg">
        {context === undefined ? (
          <p className="text-muted-foreground">Reading the selected company's source anchors...</p>
        ) : context === null ? (
          <p className="text-destructive">No source context was returned for this company.</p>
        ) : (
          <SourceContents context={context} />
        )}
      </div>
    </details>
  );
}

export function SourceContents({ context }: { context: OperatingProvenance }) {
  const r = context.reconciliation;
  const cashLabel =
    context.company === "2u" ? "combined cash including restricted" : "cash and equivalents";
  const terms = [
    [`Opening ${cashLabel}`, r.openingCashCents],
    ["Operating cash flow", r.operatingCashFlowCents],
    ["Investing cash flow", r.investingCashFlowCents],
    ["Financing cash flow", r.financingCashFlowCents],
    ["FX effect", r.fxCashFlowCents],
    [`Ending ${cashLabel}`, r.endingCashCents],
    ["Restricted cash, shown separately", r.restrictedCashCents],
    ["Recognized revenue", r.revenueCents],
    ["Outstanding receivables", r.outstandingReceivablesCents],
  ] as const;
  return (
    <div className="space-y-4">
      <div>
        <p className="font-semibold">Reported anchors and reconstructed books</p>
        <p className="mt-1 text-muted-foreground">
          Ledger period {context.periodStart} to {context.periodEnd}. Filing published{" "}
          {context.reportedAt}. The ledger date and publication date are separate.
        </p>
      </div>
      <details>
        <summary className="cursor-pointer font-medium text-primary">
          Reported and derived anchors ({context.reported.length})
        </summary>
        <ul className="mt-2 space-y-2">
          {context.reported.map((anchor) => (
            <li
              key={anchor.id}
              className="flex flex-wrap items-baseline justify-between gap-x-2 border-b pb-1"
            >
              <span>
                {anchor.label}{" "}
                <span className="text-muted-foreground">
                  ({anchor.basis === "reported" ? "reported" : "derived from reported"};{" "}
                  {anchor.periodStart ? `${anchor.periodStart} to ` : ""}
                  {anchor.periodEnd})
                </span>
              </span>
              <span className="font-medium tabular-nums" title={formatCents(anchor.cents)}>
                {anchor.sourceValue
                  ? `${anchor.sourceValue} ${anchor.sourceUnit ?? "USD thousands"}`
                  : formatCents(anchor.cents)}
              </span>
              <a
                href={anchor.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline-offset-2 hover:underline"
              >
                Filing source
              </a>
            </li>
          ))}
        </ul>
      </details>
      <div>
        <p className="font-medium">Cash bridge from backend</p>
        <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 tabular-nums">
          {terms.map(([name, cents]) => (
            <div key={name} className="col-span-2 grid grid-cols-subgrid">
              <dt>{name}</dt>
              <dd>{formatCents(cents)}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-muted-foreground">
          {r.balanced ? "Backend bridge reconciles." : "Backend bridge does not reconcile."}{" "}
          {context.aggregateBasis.cash} Usable cash is shown on the dashboard.
        </p>
      </div>
      {context.payablesBridge ? (
        <div>
          <p className="font-medium">2U payables and accruals bridge</p>
          <p className="mt-1 text-muted-foreground">
            Reported balances are dated {context.payablesBridge.openingDate} and{" "}
            {context.payablesBridge.closingDate}. The split across future bills and payroll is
            reconstructed, not a reported bill ledger.
          </p>
          <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 tabular-nums">
            {(
              [
                [
                  "Opening reported payables and accruals",
                  context.payablesBridge.reportedOpeningPayablesAndAccrualsCents,
                ],
                [
                  "Closing reported payables and accruals",
                  context.payablesBridge.reportedClosingPayablesAndAccrualsCents,
                ],
                [
                  "Balance increase, derived from reported balances",
                  context.payablesBridge.balanceIncreaseCents,
                ],
                ["Cash-flow adjustment, reported", context.payablesBridge.cashFlowAdjustmentCents],
                [
                  "Cash-flow adjustment less balance increase; composition unknown",
                  context.payablesBridge.cashFlowAdjustmentLessBalanceIncreaseCents,
                ],
                [
                  "Assumed supplier allocation to known future bills",
                  context.payablesBridge.supplierAllocationCents,
                ],
                [
                  "Assumed payroll and other accrual allocation",
                  context.payablesBridge.payrollAndOtherAccrualAllocationCents,
                ],
                ["Baseline future bills", context.payablesBridge.baselineFutureBillsCents],
                ["Baseline future payroll", context.payablesBridge.baselineFuturePayrollCents],
                [
                  "Future bill costs not allocated from closing payables",
                  context.payablesBridge.unincurredFutureBillCostsCents,
                ],
                [
                  "Future payroll costs not allocated from closing accruals",
                  context.payablesBridge.unincurredFuturePayrollCostsCents,
                ],
              ] as const
            ).map(([name, cents]) => (
              <div key={name} className="col-span-2 grid grid-cols-subgrid">
                <dt>{name}</dt>
                <dd>{formatCents(cents)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-muted-foreground">
            {context.payablesBridge.note} No extra cash outflows are created by this allocation.
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer font-medium text-primary">
              Scheduled record allocations
            </summary>
            <ul className="mt-1 space-y-1 text-muted-foreground">
              {context.payablesBridge.allocations.map((row) => (
                <li key={row.recordId}>
                  {row.recordKind} {row.recordId}: expected {formatCents(row.expectedAmountCents)}{" "}
                  on {row.expectedPaymentDate}; {formatCents(row.allocatedPayablesCents)} allocated
                  from closing balance.
                </li>
              ))}
            </ul>
          </details>
        </div>
      ) : null}
      <div>
        <p className="font-medium">Basis of displayed totals</p>
        <dl className="mt-1 space-y-1 text-muted-foreground">
          {Object.entries(context.aggregateBasis).map(([key, value]) => (
            <div key={key}>
              <dt className="inline font-medium text-foreground">{key}: </dt>
              <dd className="inline">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div>
        <p className="font-medium">Reconstruction assumptions</p>
        <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
          {context.assumptions.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <p className="text-muted-foreground">
        {operatingDemoCatalog.find((item) => item.id === context.company)?.name ?? "Company"}:
        generated records are illustrative, not the real company's transactions.
      </p>
    </div>
  );
}
