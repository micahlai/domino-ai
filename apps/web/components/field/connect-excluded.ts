import type { ToolId } from "../../convex/connectors/types";

// Why connector records were excluded, grouped for the "Review excluded records" sheet. The
// reasons are the connector receipts' own words (convex/connectors/*.ts `skipped`), with record
// ids removed so equal reasons add up.

export type ExcludedGroup = "duplicates" | "unsupported" | "errors";

export const EXCLUDED_GROUP_LABEL: Record<ExcludedGroup, { title: string; note: string }> = {
  duplicates: {
    title: "Duplicates",
    note: "Already counted from another record or tool, so cash counts once.",
  },
  unsupported: {
    title: "Not used for cash",
    note: "Records Domino does not count, such as pending, declined or non-US-dollar items.",
  },
  errors: {
    title: "Errors",
    note: "Records that failed a shape or totals check. Worth a look in the tool.",
  },
};

export const EXCLUDED_GROUPS: ExcludedGroup[] = ["duplicates", "unsupported", "errors"];

export type ExcludedReason = { group: ExcludedGroup; reason: string; count: number };
export type ExcludedReport = { tool: ToolId; reasons: ExcludedReason[] }[];

export function skipGroup(reason: string): ExcludedGroup {
  if (/^(same record as|counted once|folded into)|counted from the bank feed/i.test(reason))
    return "duplicates";
  if (
    /fails the Domino contract|does not match the .* shape|do not add up|incomplete/i.test(reason)
  )
    return "errors";
  return "unsupported";
}

/** "same record as Stripe in_0042" -> "Same record as Stripe". */
export function reasonText(reason: string): string {
  const text = reason
    // Record ids carry an underscore (in_0042, bill_agency_nov); words never do.
    .replace(/\s+\S*_\S*/g, "")
    .replace(/\s+\(\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Receipt skips -> one row per (group, reason), biggest first. */
export function groupSkips(skips: { id: string; reason: string }[]): ExcludedReason[] {
  const rows = new Map<string, ExcludedReason>();
  for (const skip of skips) {
    const group = skipGroup(skip.reason);
    const reason = reasonText(skip.reason);
    const key = `${group}|${reason}`;
    const row = rows.get(key) ?? { group, reason, count: 0 };
    row.count++;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.count - a.count);
}
