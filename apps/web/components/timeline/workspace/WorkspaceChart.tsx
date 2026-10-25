"use client";

import type { Forecast, HistoryWeek, ScheduledItem } from "@domino/contracts";
import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { useId } from "react";
import { formatExactCents, formatFullDate } from "../baseline/format";

export type ChartProps = {
  history: HistoryWeek[];
  forecast: Forecast;
  /** Parent node's saved forecast, drawn faintly for comparison. */
  parent?: Forecast | null;
  items: ScheduledItem[];
  /** Saved minimum-cash limits, drawn as dashed lines. */
  limits: { id: string; label: string; cents: number }[];
  /** Only saved rule receipts may mark a week as breached. */
  breachedWeeks?: string[];
  selectedWeek: string | null;
  onSelectWeek: (weekStart: string) => void;
};

const W = 880;
const H = 300;
const PAD = { left: 16, right: 16, top: 24, bottom: 44 };

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
    ...(p.parent?.weeks.map((w) => w.usable) ?? []),
    ...p.limits.map((l) => l.cents),
  ];
  const y = scaleLinear()
    .domain([Math.min(...values), Math.max(...values)])
    .range([H - PAD.bottom, PAD.top]);
  if (y.domain()[0] === y.domain()[1])
    y.domain([(y.domain()[0] ?? 0) - 1, (y.domain()[1] ?? 0) + 1]);
  const x = scaleLinear()
    .domain([0, Math.max(slots - 1, 1)])
    .range([PAD.left, W - PAD.right]);
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
          <text
            x={todayX}
            y={H - PAD.bottom + 32}
            textAnchor="middle"
            className="fill-muted-foreground text-[11px]"
          >
            Forecast starts {weeks[0] ? formatFullDate(weeks[0].weekStart) : ""}
          </text>
          {past.length > 1 ? (
            <path d={draw(past) ?? ""} fill="none" className="stroke-clay" strokeWidth={2} />
          ) : null}
          {parentLine.length > 1 ? (
            <path
              d={draw(lastPast ? [lastPast, ...parentLine] : parentLine) ?? ""}
              fill="none"
              className="stroke-muted-foreground"
              strokeWidth={1.25}
              strokeDasharray="4 3"
              data-testid="parent-line"
            />
          ) : null}
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
        <span>
          <span className="mr-1 inline-block h-0.5 w-4 bg-clay align-middle" />
          Recorded usable cash
        </span>
        <span>
          <span className="mr-1 inline-block h-0.5 w-4 bg-primary align-middle" />
          This scenario
        </span>
        {p.parent ? (
          <span>
            <span className="mr-1 inline-block w-4 border-t border-dashed border-muted-foreground align-middle" />
            Scenario it started from
          </span>
        ) : null}
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
