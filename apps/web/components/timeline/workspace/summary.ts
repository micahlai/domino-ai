import { formatExactCents, formatFullDate } from "../baseline/format";
import type { CatalogEntry, RuleReceipt, WorkspaceRun } from "./api";

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
    return `Cash falls below the ${formatExactCents(floor.limit)} minimum in the week of ${formatFullDate(floor.weekStart)}`;
  if (floor?.status === "clear")
    return `Cash stays above the ${formatExactCents(floor.limit)} minimum for all ${run.forecast.weeks.length} weeks`;
  return `Lowest cash is ${formatExactCents(low.usable)} in the week of ${formatFullDate(low.weekStart)}`;
}

export type Outcome =
  | { tone: "below"; text: string; detail: string | null }
  | { tone: "above"; text: string; detail: string | null }
  | { tone: "unknown"; text: string; detail: string | null };

/** Outcome from a run's own saved rule receipts (exact week and shortfall). */
export function receiptOutcome(run: Pick<WorkspaceRun, "receipts">): Outcome | null {
  const floor = floorReceipt(run);
  if (!floor) return null;
  if (floor.status === "breached")
    return {
      tone: "below",
      text: "Falls below minimum",
      detail:
        [
          floor.weekStart ? `first below in the week of ${formatFullDate(floor.weekStart)}` : null,
          floor.shortfall !== null && Number.isSafeInteger(floor.shortfall)
            ? `short ${formatExactCents(floor.shortfall)}`
            : null,
        ]
          .filter(Boolean)
          .join(", ") || null,
    };
  if (floor.status === "clear") return { tone: "above", text: "Stays above minimum", detail: null };
  return { tone: "unknown", text: "Minimum not checked", detail: null };
}

/**
 * Outcome for a catalog row that has not been opened. Only rows saved under the same rule
 * version as the open run share its minimum; the low point decides it exactly as the engine does
 * (any week below the limit means the lowest week is below it). The breach week and shortfall
 * need the row's own receipts, so they are left out here.
 */
export function entryOutcome(entry: CatalogEntry, run: WorkspaceRun): Outcome | null {
  const floor = floorReceipt(run);
  if (!floor || entry.constraintVersion !== run.constraintVersion) return null;
  return entry.lowPointCents < floor.limit
    ? { tone: "below", text: "Falls below minimum", detail: null }
    : { tone: "above", text: "Stays above minimum", detail: null };
}
