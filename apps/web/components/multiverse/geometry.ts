import type { HistoryWeek, ISODate, ResilienceReport, Universe } from "@domino/contracts";
import { scaleLinear } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";

export type CashPoint = { date: ISODate; usable: number };
export const timestamp = (date: ISODate) => Date.parse(`${date}T00:00:00Z`);
export const futureKey = (future: Universe) => [...future.riskIds].sort().join("|") || "base";

/** Map already-computed cents to pixels; this module never forecasts or changes money. */
export function timelineGeometry(
  history: HistoryWeek[],
  today: ISODate,
  report: ResilienceReport,
  comparison: ResilienceReport | undefined,
  limit: number,
  width: number,
) {
  const height = 390;
  const left = 62;
  const right = width - 132;
  const top = 44;
  const bottom = height - 48;
  const todayX = left + (right - left) * 0.4;
  const firstDate = history[0]?.weekStart ?? today;
  const lastDate = report.universes[0]?.forecast.weeks.at(-1)?.weekStart ?? today;
  const x = scaleLinear()
    .domain([
      timestamp(firstDate),
      timestamp(today),
      Math.max(timestamp(lastDate), timestamp(today) + 86_400_000),
    ])
    .range([left, todayX, right]);
  const values = [
    limit,
    ...history.map((week) => week.usable),
    ...[report, ...(comparison ? [comparison] : [])].flatMap((entry) =>
      entry.universes.flatMap((future) => future.forecast.weeks.map((week) => week.usable)),
    ),
  ];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max((max - min) * 0.15, 10_000_000);
  const y = scaleLinear()
    .domain([min - padding, max + padding])
    .range([bottom, top]);
  const past: CashPoint[] = history.map((week) => ({ date: week.weekStart, usable: week.usable }));
  const lastPast = past.at(-1);
  const origin = {
    date: today,
    usable: lastPast?.usable ?? report.universes[0]?.forecast.weeks[0]?.usable ?? limit,
  };
  if (lastPast && lastPast.date !== today) past.push(origin);
  const path = line<CashPoint>()
    .x((point) => x(timestamp(point.date)))
    .y((point) => y(point.usable))
    .curve(curveMonotoneX);
  const pastArea = area<CashPoint>()
    .x((point) => x(timestamp(point.date)))
    .y0(bottom)
    .y1((point) => y(point.usable))
    .curve(curveMonotoneX);
  return {
    width,
    height,
    left,
    right,
    top,
    bottom,
    todayX,
    x,
    y,
    path,
    origin,
    past,
    pastPath: path(past) ?? "",
    pastArea: pastArea(past) ?? "",
    ticks: [0, 1, 2, 3].map((index) => y.invert(top + ((bottom - top) * index) / 3)),
    points: (future: Universe) => [
      origin,
      ...future.forecast.weeks.map((week) => ({ date: week.weekStart, usable: week.usable })),
    ],
  };
}
