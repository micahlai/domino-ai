"use client";

import type { Forecast, HistoryWeek, ScheduledItem } from "@domino/contracts";
import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { useId } from "react";
import { formatExactCents, formatFullDate } from "../baseline/format";
import { cashScale, dateTicks, formatAxisCash } from "./chartScales";

export type ChartProps = {
  history: HistoryWeek[];
  forecast: Forecast;
  /** Parent node's saved forecast, drawn faintly for comparison. */
  parent?: Forecast | null;
  comparisons?: {
    runId: string;
    label: string;
    href: string;
    forecast: Forecast;
    parent?: boolean;
  }[];
  items: ScheduledItem[];
  /** Saved minimum-cash limits, drawn as dashed lines. */
  limits: { id: string; label: string; cents: number }[];
  /** Only saved rule receipts may mark a week as breached. */
  breachedWeeks?: string[];
  selectedWeek: string | null;
  onSelectWeek: (weekStart: string) => void;
};

const W = 880;
const H = 350;
const PAD = { left: 94, right: 24, top: 38, bottom: 82 };

type Point = { x: number; y: number };

/**
 * Recorded history on the left, the saved 13-week forecast on the right. Positions are drawing
 * geometry only; every value shown in text comes straight from the saved record.
 */
export function WorkspaceChart(p: ChartProps) {
  const titleId = useId();
  const weeks = p.forecast.weeks;
  const slots = p.history.length + weeks.length;
  const values = [
    ...p.history.map((h) => h.usable),
    ...weeks.map((w) => w.usable),
    ...(!p.comparisons ? (p.parent?.weeks.map((w) => w.usable) ?? []) : []),
    ...(p.comparisons
      ?.slice(0, 3)
      .flatMap((entry) => entry.forecast.weeks.map((week) => week.usable)) ?? []),
    ...p.limits.map((l) => l.cents),
  ];
  const { scale: y, ticks: cashTicks } = cashScale(values, [H - PAD.bottom, PAD.top]);
  const left = Math.max(
    PAD.left,
    ...cashTicks.map((value) => formatAxisCash(value).length * 6.5 + 20),
  );
  const dates = [
    ...p.history.map((week) => week.weekStart),
    ...weeks.map((week) => week.weekStart),
  ];
  const timeTicks = dateTicks(dates);
  const x = scaleLinear()
    .domain([0, Math.max(slots - 1, 1)])
    .range([left, W - PAD.right]);
  const draw = line<Point>()
    .x((d) => d.x)
    .y((d) => d.y);
  const at = (i: number, cents: number): Point => ({ x: x(i), y: y(cents) });
  const off = p.history.length;
  const past = p.history.map((h, i) => at(i, h.usable));
  const future = weeks.map((w, i) => at(off + i, w.usable));
  const parentLine = p.parent?.weeks.map((w, i) => at(off + i, w.usable)) ?? [];
  const lastPast = past[past.length - 1];
  const todayX = off > 0 ? (x(off - 1) + x(off)) / 2 : x(0);
  const itemsByWeek = new Map<string, number>();
  for (const it of p.items) itemsByWeek.set(it.dueWeek, (itemsByWeek.get(it.dueWeek) ?? 0) + 1);
  const selectedIndex = weeks.findIndex((w) => w.weekStart === p.selectedWeek);
  const low = p.forecast.lowPoint;
  const lowIndex = weeks.findIndex((w) => w.weekStart === low.weekStart);
  const breachedWeeks = new Set(p.breachedWeeks ?? []);

  return (
    <figure className="min-w-0 max-w-full space-y-3" data-testid="workspace-chart">
      <div className="min-w-0 max-w-full overflow-x-auto" data-testid="chart-scroll">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full min-w-[640px]"
          role="img"
          aria-labelledby={titleId}
        >
          <title
            id={titleId}
          >{`Usable cash: ${p.history.length} recorded weeks, then the saved 13-week forecast. Lowest forecast week ${formatFullDate(low.weekStart)} at ${formatExactCents(low.usable)}.`}</title>
          <g data-testid="cash-axis" pointerEvents="none">
            <text x={left} y={18} className="fill-muted-foreground text-[11px]">
              Usable cash · USD
            </text>
            {cashTicks.map((cents) => (
              <g key={cents} data-cents={cents}>
                <line
                  x1={left}
                  x2={W - PAD.right}
                  y1={y(cents)}
                  y2={y(cents)}
                  className="stroke-muted-foreground/15"
                />
                <line
                  x1={left - 4}
                  x2={left}
                  y1={y(cents)}
                  y2={y(cents)}
                  className="stroke-muted-foreground/50"
                />
                <text
                  x={left - 10}
                  y={y(cents)}
                  dy="0.35em"
                  textAnchor="end"
                  className="fill-muted-foreground text-[11px]"
                >
                  <title>{formatExactCents(cents)}</title>
                  {formatAxisCash(cents)}
                </text>
              </g>
            ))}
            <line
              x1={left}
              x2={left}
              y1={PAD.top}
              y2={H - PAD.bottom}
              className="stroke-muted-foreground/40"
            />
          </g>
          <g data-testid="date-axis" pointerEvents="none">
            <line
              x1={left}
              x2={W - PAD.right}
              y1={H - PAD.bottom}
              y2={H - PAD.bottom}
              className="stroke-muted-foreground/40"
            />
            {timeTicks.map(({ index, date }, i) => (
              <g key={date} data-week={date}>
                <line
                  x1={x(index)}
                  x2={x(index)}
                  y1={H - PAD.bottom}
                  y2={H - PAD.bottom + 5}
                  className="stroke-muted-foreground/50"
                />
                <text
                  x={x(index)}
                  y={H - PAD.bottom + 50}
                  textAnchor={i === 0 ? "start" : i === timeTicks.length - 1 ? "end" : "middle"}
                  className="fill-muted-foreground text-[11px]"
                >
                  {formatFullDate(date)}
                </text>
              </g>
            ))}
          </g>
          {p.limits.map((l) => (
            <g key={l.id} data-testid={`limit-${l.id}`}>
              <line
                x1={todayX}
                x2={W - PAD.right}
                y1={y(l.cents)}
                y2={y(l.cents)}
                className="stroke-[#D991A8]"
                strokeDasharray="6 4"
              />
              <text
                x={W - PAD.right}
                y={y(l.cents) - 6}
                textAnchor="end"
                className="fill-[#E6A5B9] text-[11px]"
              >
                {l.label} {formatExactCents(l.cents)}
              </text>
            </g>
          ))}
          <line
            x1={todayX}
            x2={todayX}
            y1={PAD.top - 8}
            y2={H - PAD.bottom}
            className="stroke-muted-foreground"
            strokeDasharray="3 3"
          />
          {past.length > 1 ? (
            <path d={draw(past) ?? ""} fill="none" className="stroke-clay" strokeWidth={2} />
          ) : null}
          {parentLine.length > 1 && !p.comparisons ? (
            <path
              d={draw(lastPast ? [lastPast, ...parentLine] : parentLine) ?? ""}
              fill="none"
              className="stroke-muted-foreground"
              strokeWidth={1.25}
              strokeDasharray="4 3"
              data-testid="parent-line"
            />
          ) : null}
          {(p.comparisons ?? []).slice(0, 3).map((entry, index) => {
            const points = entry.forecast.weeks.map((week, i) => at(off + i, week.usable));
            return (
              <path
                key={entry.runId}
                d={draw(lastPast ? [lastPast, ...points] : points) ?? ""}
                fill="none"
                className="stroke-muted-foreground opacity-50"
                strokeWidth={1.25}
                strokeDasharray={index === 0 ? "5 3" : index === 1 ? "2 4" : "8 3 2 3"}
                data-testid={entry.parent ? "parent-line" : "comparison-line"}
                pointerEvents="none"
              />
            );
          })}
          <path
            d={draw(lastPast ? [lastPast, ...future] : future) ?? ""}
            fill="none"
            className="stroke-primary"
            data-testid="forecast-line"
            strokeWidth={2.5}
          />
          {weeks.map((w, i) => {
            const pt = future[i] as Point;
            const selected = i === selectedIndex;
            const breached = breachedWeeks.has(w.weekStart);
            const count = itemsByWeek.get(w.weekStart) ?? 0;
            return (
              <g key={w.weekStart}>
                {/* Wide hit area for pointer and touch; keyboard users pick weeks with the range below. */}
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: the week range control is the keyboard path */}
                <rect
                  x={pt.x - 14}
                  y={PAD.top}
                  width={28}
                  height={H - PAD.top - PAD.bottom}
                  fill="transparent"
                  className="cursor-pointer"
                  onClick={() => p.onSelectWeek(w.weekStart)}
                  data-testid={`chart-week-${w.weekStart}`}
                />
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={selected ? 6 : i === lowIndex ? 5 : 3}
                  className={
                    breached
                      ? `fill-[#D991A8]${selected ? " stroke-foreground" : ""}`
                      : selected
                        ? "fill-primary stroke-foreground"
                        : "fill-primary"
                  }
                  data-testid={`forecast-point-${w.weekStart}`}
                  data-breached={breached}
                  pointerEvents="none"
                />
                {count ? (
                  <g pointerEvents="none">
                    <path
                      d={`M${pt.x - 5},${H - PAD.bottom + 14} l5,-8 l5,8 z`}
                      className="fill-clay"
                    />
                    <text
                      x={pt.x}
                      y={H - PAD.bottom + 26}
                      textAnchor="middle"
                      className="fill-muted-foreground text-[10px]"
                    >
                      {count}
                    </text>
                  </g>
                ) : null}
              </g>
            );
          })}
          {(p.comparisons ?? []).slice(0, 3).map((entry) => {
            const points = entry.forecast.weeks.map((week, i) => at(off + i, week.usable));
            const path = draw(lastPast ? [lastPast, ...points] : points) ?? "";
            return (
              <a
                key={entry.runId}
                href={entry.href}
                aria-label={`Open saved scenario: ${entry.label}`}
              >
                <title>{`${entry.label} · saved forecast`}</title>
                <path
                  d={path}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={10}
                  pointerEvents="stroke"
                />
              </a>
            );
          })}
          {selectedIndex >= 0 ? (
            <line
              x1={x(off + selectedIndex)}
              x2={x(off + selectedIndex)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              className="stroke-foreground"
              strokeDasharray="2 3"
              pointerEvents="none"
            />
          ) : null}
        </svg>
      </div>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Forecast starts {weeks[0] ? formatFullDate(weeks[0].weekStart) : ""}</span>
        <span>
          <span className="mr-1 inline-block h-0.5 w-4 bg-clay align-middle" />
          Recorded usable cash
        </span>
        <span>
          <span className="mr-1 inline-block h-0.5 w-4 bg-primary align-middle" />
          This scenario
        </span>
        {p.parent && !p.comparisons ? (
          <span>
            <span className="mr-1 inline-block w-4 border-t border-dashed border-muted-foreground align-middle" />
            Scenario it started from
          </span>
        ) : null}
        {(p.comparisons ?? []).slice(0, 3).map((entry, index) => (
          <a
            key={entry.runId}
            href={entry.href}
            className="inline-flex max-w-full items-center gap-1 underline-offset-4 hover:underline"
            aria-label={`Open saved scenario: ${entry.label}`}
          >
            <svg width="18" height="4" aria-hidden="true" className="shrink-0">
              <line
                x1="0"
                y1="2"
                x2="18"
                y2="2"
                className="stroke-muted-foreground"
                strokeDasharray={index === 0 ? "5 3" : index === 1 ? "2 4" : "8 3 2 3"}
              />
            </svg>
            <span className="max-w-48 truncate" title={entry.label}>
              {entry.label}
            </span>
            {entry.parent ? " (started from)" : ""}
          </a>
        ))}
        <span>
          <span className="mr-1 text-clay">▲</span>
          Original imported schedule (item count; does not move with scenario changes)
        </span>
        {breachedWeeks.size ? (
          <span data-testid="breach-legend">
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#D991A8]" />
            Week with a saved rule breach
          </span>
        ) : null}
      </figcaption>
      <label className="block space-y-1 text-sm">
        <span className="text-muted-foreground">Choose a forecast week</span>
        <input
          type="range"
          min={0}
          max={weeks.length - 1}
          step={1}
          value={selectedIndex >= 0 ? selectedIndex : 0}
          aria-valuetext={
            selectedIndex >= 0
              ? `Week of ${formatFullDate(weeks[selectedIndex]?.weekStart ?? "")}`
              : "No week chosen"
          }
          onChange={(e) => {
            const w = weeks[Number(e.target.value)];
            if (w) p.onSelectWeek(w.weekStart);
          }}
          className="w-full accent-primary"
          data-testid="week-range"
        />
      </label>
    </figure>
  );
}
