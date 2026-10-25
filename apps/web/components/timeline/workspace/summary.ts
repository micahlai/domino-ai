import { formatCents } from "../../../lib/format";
import { formatFullDate } from "../baseline/format";
import type { RuleReceipt, WorkspaceRun } from "./api";

// Plain-language reading of saved results. Every number is copied from a saved record; nothing
// here adds or subtracts money. The only comparison is the engine's own min-cash test (a week
// breaks a minimum when its usable cash is strictly below the limit), see packages/engine rules.

type CashReceipt = RuleReceipt & { kind: "min_cash"; unit: "cents" };

const isCashReceipt = (r: RuleReceipt): r is CashReceipt =>
  r.kind === "min_cash" && r.unit === "cents" && Number.isSafeInteger(r.limit);

/**
 * The minimum-cash rule a reader cares about first: the earliest saved breach, otherwise the
 * highest saved minimum. Null when the run has no minimum-cash rule.
 */
export function floorReceipt(run: Pick<WorkspaceRun, "receipts">): CashReceipt | null {
  const cash = run.receipts.filter(isCashReceipt);
  const breached = cash
    .filter((r) => r.status === "breached")
    .sort((a, b) => (a.weekStart ?? "").localeCompare(b.weekStart ?? ""));
  if (breached[0]) return breached[0];
  return cash.reduce<CashReceipt | null>((top, r) => (!top || r.limit > top.limit ? r : top), null);
}

/** A full-sentence answer for the page title. */
export function runHeadline(run: WorkspaceRun): string {
  const floor = floorReceipt(run);
  const low = run.forecast.lowPoint;
  if (floor?.status === "breached" && floor.weekStart)
    return `Cash falls below the ${formatCents(floor.limit)} minimum in the week of ${formatFullDate(floor.weekStart)}`;
  if (floor?.status === "clear")
    return `Cash stays above the ${formatCents(floor.limit)} minimum for all ${run.forecast.weeks.length} weeks`;
  return `Lowest cash is ${formatCents(low.usable)} in the week of ${formatFullDate(low.weekStart)}`;
}
