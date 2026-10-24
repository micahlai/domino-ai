import type { Cents, HistoryWeek, ISODate, Universe } from "@domino/contracts";
import { timestamp } from "./geometry";

export interface InspectionPoint {
  date: ISODate;
  usable: Cents;
  label: string;
  recorded: boolean;
}

/** Only inspect supplied weekly values, never a synthetic Today point or interpolated money. */
export function inspectionPoints(history: HistoryWeek[], future: Universe | undefined) {
  const forecast = future?.forecast.weeks ?? [];
  const firstForecast = forecast[0]?.weekStart;
  return [
    ...history
      .filter((week) => !firstForecast || week.weekStart < firstForecast)
      .map((week) => ({
        date: week.weekStart,
        usable: week.usable,
        label: "Recorded cash",
        recorded: true,
      })),
    ...forecast.map((week) => ({
      date: week.weekStart,
      usable: week.usable,
      label: future?.label ?? "Forecast",
      recorded: false,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));
}

export function nearestInspectionIndex(
  points: InspectionPoint[],
  target: number,
  position: (date: ISODate) => number = timestamp,
) {
  let closest = -1;
  let distance = Number.POSITIVE_INFINITY;
  points.forEach((point, index) => {
    const next = Math.abs(position(point.date) - target);
    if (next < distance) {
      closest = index;
      distance = next;
    }
  });
  return closest;
}

const dollars = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const calendar = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export const inspectionDate = (date: ISODate) => calendar.format(new Date(timestamp(date)));

/** Exact display formatting uses integer cents, including values above floating-point precision. */
export function inspectionCash(cents: Cents) {
  const value = BigInt(cents);
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}$${dollars.format(absolute / 100n)}.${String(absolute % 100n).padStart(2, "0")}`;
}
