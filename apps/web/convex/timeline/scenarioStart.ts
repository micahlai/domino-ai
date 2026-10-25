import type { Change, Snapshot } from "@domino/contracts";

/**
 * When a scenario's own changes first touch the forecast. A branch forks from its parent on
 * this date, so a child built on a scenario may not start before that scenario does: before
 * the fork its forecast is the parent's, not the base's.
 */

/** First date one change can move cash. Invoice and bill changes act from the record's due date. */
export function changeStart(change: Change, snapshot: Snapshot): string | null {
  switch (change.kind) {
    case "add_cash":
    case "remove_cash":
      return change.date;
    case "churn":
      return change.fromDate;
    case "discount_early_pay":
      return change.payOn;
    case "shift_hire":
      return change.fromDate < change.toDate ? change.fromDate : change.toDate;
    case "delay_invoice":
    case "lose_invoice":
      return snapshot.invoices.find((i) => i.id === change.invoiceId)?.due ?? null;
    case "delay_bill":
      return snapshot.bills.find((b) => b.id === change.billId)?.due ?? null;
    default:
      return null;
  }
}

/** Earliest start of a scenario's own changes; null for runs that change no events. */
export function scenarioStart(ownChanges: Change[], snapshot: Snapshot): string | null {
  let first: string | null = null;
  for (const change of ownChanges) {
    const date = changeStart(change, snapshot);
    if (date !== null && (first === null || date < first)) first = date;
  }
  return first;
}

/** Changes dated before the branch's floor, with their start dates, for a plain message. */
export function startsBefore(
  ownChanges: Change[],
  snapshot: Snapshot,
  floor: string | null,
): { change: Change; date: string }[] {
  if (floor === null) return [];
  return ownChanges.flatMap((change) => {
    const date = changeStart(change, snapshot);
    return date !== null && date < floor ? [{ change, date }] : [];
  });
}
