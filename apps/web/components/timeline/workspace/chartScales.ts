import { scaleLinear } from "d3-scale";
import { formatExactCents } from "../baseline/format";

/** Drawing geometry only. Flat saved values need space above and below the curve. */
export function cashScale(values: number[], range: [number, number]) {
  const safe = values.filter(Number.isSafeInteger);
  const low = safe.length ? Math.min(...safe) : 0;
  const high = safe.length ? Math.max(...safe) : 0;
  const padding = low === high ? Math.max(1, Math.ceil(Math.abs(low) * 0.02)) : 0;
  const domain: [number, number] = [
    Math.max(-Number.MAX_SAFE_INTEGER, low - padding),
    Math.min(Number.MAX_SAFE_INTEGER, high + padding),
  ];
  const scale = scaleLinear().domain(domain).range(range);
  // D3 may propose fractional-cent ticks on very small ranges. Axis guides stay in safe cents.
  const ticks = scale.ticks(4).filter(Number.isSafeInteger);
  return { scale, ticks: ticks.length ? ticks : [...new Set(domain)] };
}

/** Exact compact currency for axis guides; selected cash values retain the full money formatter. */
export function formatAxisCash(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error("Axis cash must be safe integer cents");
  const value = BigInt(cents);
  const absolute = value < 0n ? -value : value;
  const unit =
    absolute >= 100_000_000n
      ? { divisor: 100_000_000n, suffix: "M", places: 8 }
      : absolute >= 100_000n
        ? { divisor: 100_000n, suffix: "K", places: 5 }
        : null;
  if (!unit) return formatExactCents(cents);
  const whole = (absolute / unit.divisor).toLocaleString("en-US");
  const fraction = (absolute % unit.divisor)
    .toString()
    .padStart(unit.places, "0")
    .replace(/0+$/, "");
  return `${value < 0n ? "-" : ""}$${whole}${fraction ? `.${fraction}` : ""}${unit.suffix}`;
}

/** Date labels always refer to a supplied saved week, never an interpolated date. */
export function dateTicks(dates: string[], maximum = 7): { index: number; date: string }[] {
  const count = Math.min(Math.max(2, maximum), dates.length);
  if (!count) return [];
  return Array.from({ length: count }, (_, i) => {
    const index = count === 1 ? 0 : Math.round((i * (dates.length - 1)) / (count - 1));
    return { index, date: dates[index]! };
  });
}
