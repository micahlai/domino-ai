import { type Cents, CentsSchema, type ISODate, ISODateSchema } from "@domino/contracts";

const wholeNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const calendarDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** Convert cents only for display. BigInt keeps rounding exact even near the safe integer limit. */
export function formatCents(cents: Cents): string {
  CentsSchema.safe().parse(cents);
  const value = BigInt(cents);
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const unit =
    absolute >= 100_000_000_000n
      ? "B"
      : absolute >= 100_000_000n
        ? "M"
        : absolute >= 1_000_000n
          ? "K"
          : "";
  if (unit) {
    const divisor = { B: 100_000_000_000n, M: 100_000_000n, K: 100_000n }[unit];
    const tenths = (absolute * 10n + divisor / 2n) / divisor;
    const fraction = tenths % 10n;
    return `${sign}$${wholeNumber.format(tenths / 10n)}${fraction ? `.${fraction}` : ""}${unit}`;
  }
  const fraction = absolute % 100n;
  return `${sign}$${wholeNumber.format(absolute / 100n)}${fraction ? `.${String(fraction).padStart(2, "0")}` : ""}`;
}

export function formatDate(iso: ISODate): string {
  ISODateSchema.parse(iso);
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) {
    throw new RangeError("Expected a real calendar date in YYYY-MM-DD format");
  }
  return calendarDate.format(date);
}
