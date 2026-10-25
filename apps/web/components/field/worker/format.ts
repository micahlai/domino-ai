import { formatDate } from "../../../lib/format";
import { formatCents } from "../dashboard/money";

// Display helpers for the worker page. Backend values are read defensively: a malformed date or
// a fractional amount shows a plain fallback instead of throwing during render.

/** "$1.2M" with a true minus sign; integer cents only, so fractions are rounded for display. */
export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "unknown";
  return formatCents(Math.round(cents));
}

/** "Dec 14" from "2026-12-14" (or a full ISO timestamp); null when it is not a real date. */
export function day(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return formatDate(iso.slice(0, 10));
  } catch {
    return null;
  }
}

/** "the week of Dec 14", or null when the date is missing or invalid. */
export function weekOf(iso: string | null | undefined): string | null {
  const d = day(iso);
  return d ? `the week of ${d}` : null;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Here's what needs you: 2 suggestions, 1 risk below the minimum and 3 flags." */
export function introLine(counts: {
  suggestions: number | null;
  risks: number | null;
  flags: number | null;
}): string {
  const parts = [
    counts.suggestions ? plural(counts.suggestions, "suggestion") : null,
    counts.risks ? `${plural(counts.risks, "risk")} below the minimum` : null,
    counts.flags ? plural(counts.flags, "flag") : null,
  ].filter((p): p is string => p !== null);
  if (parts.length === 0) {
    const loading = counts.suggestions === null || counts.flags === null;
    return loading ? "Here's what needs you." : "Here's what needs you: nothing right now.";
  }
  const list =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `Here's what needs you: ${list}.`;
}
