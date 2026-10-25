import { type Cents, CentsSchema } from "@domino/contracts";

const grouped = new Intl.NumberFormat("en-US");

/** Exact dollars and cents for display only ("$1,234,567.08", "-$40.00"). BigInt keeps it exact. */
export function formatExactCents(cents: Cents): string {
  CentsSchema.safe().parse(cents);
  const value = BigInt(cents);
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const fraction = String(absolute % 100n).padStart(2, "0");
  return `${sign}$${grouped.format(absolute / 100n)}.${fraction}`;
}

const fullDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** "Oct 27, 2026" for an ISO calendar date; the year matters when reopening an old forecast. */
export function formatFullDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? iso : fullDate.format(date);
}

/** A saved ISO timestamp in plain words, in UTC so every reader sees the same text. */
export function formatSavedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
