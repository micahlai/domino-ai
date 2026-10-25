import type { Change, Forecast } from "@domino/contracts";
import { customerName, invoiceName, shortDate } from "../../../convex/timeline/recordNames";
import { formatFullDate } from "../baseline/format";
import type { WorkspaceRun } from "./api";

/**
 * What kind of effect a scenario line shows, for the chart's focus line, so a reader can tell a
 * timing shift (the line rejoins) from a permanent change (it keeps bending away) and sees when
 * a branch runs out of cash. Reads only the saved changes and saved forecasts.
 */
export function effectNote(run: WorkspaceRun, anchor: Forecast, diverges: number): string | null {
  const parts = run.ownChanges.flatMap((c) => kindOf(c, run));
  const catchUp = catchUpWeek(run.forecast, anchor, diverges);
  if (catchUp) parts.push(`timing: cash catches up in the week of ${formatFullDate(catchUp)}`);
  const out = outOfCashWeek(run.forecast);
  if (out)
    parts.unshift(
      `Runs out of cash in the week of ${formatFullDate(out)} (the line after it assumes nothing else changes)`,
    );
  return parts.length ? parts.slice(0, 3).join("; ") : null;
}

/** First week with no usable cash left: the terminal outcome. Plain wording, not a legal claim. */
export function outOfCashWeek(forecast: Forecast): string | null {
  return forecast.weeks.find((w) => w.usable < 0)?.weekStart ?? null;
}

function kindOf(c: Change, run: WorkspaceRun): string[] {
  const s = run.baseline.seed.snapshot;
  const pct = (p: number) => `${p < 0 ? "down" : "up"} ${Math.abs(p)}%`;
  switch (c.kind) {
    case "churn":
      return [
        `permanent: billing from ${customerName(s, c.customerId)} stops after ${shortDate(c.fromDate)}`,
      ];
    case "lose_invoice":
      return [`permanent: the ${invoiceName(s, c.invoiceId)} is never paid`];
    case "recurring_cash":
      return [`recurring: ${c.label}, every ${c.everyDays} days from ${shortDate(c.fromDate)}`];
    case "scale_recurring":
      return [
        `permanent: ${c.flows === "billing" ? "recurring billing" : c.names.slice(0, 2).join(", ")} ${pct(c.percent)} from ${shortDate(c.fromDate)}`,
      ];
    case "delay_customer":
      return [
        `spreads: later ${customerName(s, c.customerId)} payments slip ${c.days} days (${c.basis})`,
      ];
    default:
      return [];
  }
}

/**
 * A late payment only moves timing, so its line rejoins the line it left once the money
 * arrives: the first week from which the two saved lines match again, or null.
 */
function catchUpWeek(forecast: Forecast, anchor: Forecast, diverges: number): string | null {
  if (diverges < 0) return null;
  const last = forecast.weeks.length - 1;
  if (forecast.weeks[last]?.usable !== anchor.weeks[last]?.usable) return null;
  let back = last;
  while (back > diverges && forecast.weeks[back - 1]?.usable === anchor.weeks[back - 1]?.usable)
    back--;
  return back > diverges ? (forecast.weeks[back]?.weekStart ?? null) : null;
}
