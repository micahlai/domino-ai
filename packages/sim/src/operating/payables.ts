import { mulDiv, sum } from "../drivers/basics.ts";
import type { OperatingSpec } from "./anchors.ts";
import { observableLedger } from "./ledger.ts";
import type { OperatingPayablesBridge } from "./types.ts";

type Allocation = OperatingPayablesBridge["allocations"][number];

/** Allocate existing expected payments in deterministic date/id order. Never add cash events. */
function allocateObligations(
  records: Omit<Allocation, "allocatedPayablesCents">[],
  amount: number,
): Allocation[] {
  let remaining = amount;
  const allocations: Allocation[] = [];
  const sorted = [...records].sort(
    (a, b) =>
      a.expectedPaymentDate.localeCompare(b.expectedPaymentDate) ||
      a.recordId.localeCompare(b.recordId),
  );
  for (const record of sorted) {
    if (remaining === 0) break;
    const allocatedPayablesCents = Math.min(remaining, record.expectedAmountCents);
    allocations.push({ ...record, allocatedPayablesCents });
    remaining -= allocatedPayablesCents;
  }
  if (remaining !== 0)
    throw new Error("reported payables allocation exceeds expected payment capacity");
  return allocations;
}

export function payablesBridge(
  spec: OperatingSpec,
  seed: number,
): OperatingPayablesBridge | undefined {
  if (spec.id !== "2u") return undefined;
  const anchor = (id: string) => {
    const found = spec.reported.find((r) => r.id === id);
    if (!found) throw new Error(`missing payables anchor ${id}`);
    return found;
  };
  const opening = anchor("balance.opening.accounts-payable-and-accrued-expenses");
  const closing = anchor("balance.closing.accounts-payable-and-accrued-expenses");
  const adjustment = anchor("cash-flow.operating.accounts-payable-and-accrued-expenses").cents;
  const snapshot = observableLedger(spec, seed, "baseline", spec.periodEnd).snapshot;
  const bills = snapshot.bills.filter((b) => !b.paid && b.due > spec.periodEnd);
  const payroll = snapshot.payroll.filter((r) => r.date > spec.periodEnd);
  const supplierAllocationCents = mulDiv(closing.cents, 60, 100);
  const payrollAndOtherAccrualAllocationCents = closing.cents - supplierAllocationCents;
  const baselineFutureBillsCents = sum(bills.map((b) => b.amount));
  const baselineFuturePayrollCents = sum(payroll.map((r) => r.amount));
  const allocations = [
    ...allocateObligations(
      bills.map((b) => ({
        recordKind: "bill",
        recordId: b.id,
        expectedPaymentDate: b.due,
        expectedAmountCents: b.amount,
      })),
      supplierAllocationCents,
    ),
    ...allocateObligations(
      payroll.map((r) => ({
        recordKind: "payroll",
        recordId: r.id,
        expectedPaymentDate: r.date,
        expectedAmountCents: r.amount,
      })),
      payrollAndOtherAccrualAllocationCents,
    ),
  ];
  return {
    basis: "reconstructed",
    openingDate: opening.periodEnd,
    closingDate: closing.periodEnd,
    reportedOpeningPayablesAndAccrualsCents: opening.cents,
    reportedClosingPayablesAndAccrualsCents: closing.cents,
    balanceIncreaseCents: closing.cents - opening.cents,
    cashFlowAdjustmentCents: adjustment,
    cashFlowAdjustmentLessBalanceIncreaseCents: adjustment - (closing.cents - opening.cents),
    supplierAllocationCents,
    payrollAndOtherAccrualAllocationCents,
    baselineFutureBillsCents,
    baselineFuturePayrollCents,
    unincurredFutureBillCostsCents: baselineFutureBillsCents - supplierAllocationCents,
    unincurredFuturePayrollCostsCents:
      baselineFuturePayrollCents - payrollAndOtherAccrualAllocationCents,
    allocations,
    note: "Reported AP and accrued expenses are one combined balance. A synthetic 60% supplier / 40% payroll-or-other-accrual split is allocated in date/id order against existing initial baseline future bill and payroll expectations, including partial record amounts. Neither the split nor payment dates are verified issuer obligations. Remaining expected payments represent assumed unincurred future costs. This classification adds no payments and does not make all future bills reported AP. The cash-flow adjustment exceeds the balance increase by the displayed residual; its composition is unknown. Scenario-only extra expenses are outside this unchanged baseline allocation.",
  };
}
