"use client";

import type { Forecast, HistoryWeek, ScheduledItem } from "@domino/contracts";
import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { useEffect, useId, useRef, useState } from "react";
import { Segmented } from "../../ui/segmented";
import { formatExactCents, formatFullDate } from "../baseline/format";
import { cashScale, dateTicks, formatAxisCash } from "./chartScales";

export type ChartProps = {
  history: HistoryWeek[];
  forecast: Forecast;
  /** Parent node's saved forecast, drawn faintly for comparison. */
  parent?: Forecast | null;
  /** Name of the main forecast line in the legend and tooltip. */
  forecastLabel?: string;
  comparisons?: {
    runId: string;
    label: string;
    href: string;
    forecast: Forecast;
    parent?: boolean;
    /** Solid line in this color; without one the line is a gray dash. */
    color?: string;
    /** Forecast week the line starts from (its fork); null when it never leaves its anchor. */
    fromIndex?: number | null;
    /** First date the scenario's own changes act, shown in the legend. */
    startsOn?: string | null;
    /** This scenario's own saved breach notes, marked on its line. */
    breaches?: { weekStart: string; text: string; short?: string }[];
  }[];
  items: ScheduledItem[];
  /** Saved minimum-cash limits, drawn as dashed lines. */
  limits: { id: string; label: string; cents: number }[];
  /** Only saved rule receipts may mark a week as breached. */
  breachedWeeks?: string[];
  /** Saved receipt text for the first breach of a rule, e.g. "Below Lender's minimum, short $1.00". */
  breachNotes?: { weekStart: string; text: string; short?: string }[];
  selectedWeek: string | null;
  onSelectWeek: (weekStart: string) => void;
};

const DEFAULT_W = 880;
type TimeWindow = "auto" | "all" | "recent" | "forecast";
type CashRange = "fit" | "zero";
const RECENT_WEEKS = 8;
const DASHES = ["6 4", "2 4", "10 3 2 3"] as const;

type Point = { x: number; y: number };

/** Measures the drawing width so text stays at its real size on phones and wide screens. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_W);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => setWidth(Math.max(300, Math.min(1400, Math.round(el.clientWidth))));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Recorded history on the left, the saved 13-week forecast on the right. Positions are drawing
 * geometry only; every value shown in text comes straight from the saved record.
 */
export function WorkspaceChart(p: ChartProps) {
  const titleId = useId();
  const [wrapRef, W] = useWidth();
  const compact = W < 560;
  const H = compact ? 280 : 340;
  const PAD = { right: compact ? 12 : 20, top: 30, bottom: 52 };
  const [hover, setHover] = useState<number | null>(null);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("auto");
  const [cashRange, setCashRange] = useState<CashRange>("fit");
  // Phones default to the last two months of history so the forecast gets most of the width.
  const shownWindow = timeWindow === "auto" ? (compact ? "recent" : "all") : timeWindow;
  const history =
    shownWindow === "forecast"
      ? []
      : shownWindow === "recent"
        ? p.history.slice(-RECENT_WEEKS)
        : p.history;
  const weeks = p.forecast.weeks;
  const comparisons = (p.comparisons ?? []).slice(0, 6);
  const mainLabel = p.forecastLabel ?? "This scenario";
  const slots = history.length + weeks.length;
  const values = [
    ...history.map((h) => h.usable),
    ...weeks.map((w) => w.usable),
    ...(!p.comparisons ? (p.parent?.weeks.map((w) => w.usable) ?? []) : []),
    ...comparisons.flatMap((entry) => entry.forecast.weeks.map((week) => week.usable)),
    ...p.limits.map((l) => l.cents),
    // "From $0" keeps the true size of a change visible; "Fit" zooms into the lines shown.
    ...(cashRange === "zero" ? [0] : []),
  ];
  const { scale: y, ticks: cashTicks } = cashScale(
    values,
    [H - PAD.bottom, PAD.top],
    compact ? 4 : 6,
  );
  // Room for the rotated "Usable cash" title plus the widest tick label.
  const left =
    18 + Math.max(44, ...cashTicks.map((value) => formatAxisCash(value).length * 6.5 + 14));
  const dates = [...history.map((week) => week.weekStart), ...weeks.map((week) => week.weekStart)];
  const timeTicks = dateTicks(dates, compact ? 4 : W < 820 ? 6 : 9);
  const x = scaleLinear()
    .domain([0, Math.max(slots - 1, 1)])
    .range([left, W - PAD.right]);
  const step = slots > 1 ? x(1) - x(0) : 28;
  const draw = line<Point>()
    .x((d) => d.x)
    .y((d) => d.y);
  const at = (i: number, cents: number): Point => ({ x: x(i), y: y(cents) });
  const off = history.length;
  const past = history.map((h, i) => at(i, h.usable));
  const future = weeks.map((w, i) => at(off + i, w.usable));
  const parentLine = p.parent?.weeks.map((w, i) => at(off + i, w.usable)) ?? [];
  const lastPast = past[past.length - 1];
  // A forked line starts at its fork week; an unforked (legacy) line joins the last recorded week.
  const comparisonPoints = (entry: (typeof comparisons)[number]): Point[] => {
    const points = entry.forecast.weeks.map((week, i) => at(off + i, week.usable));
    if (entry.fromIndex === undefined) return lastPast ? [lastPast, ...points] : points;
    return entry.fromIndex === null ? [] : points.slice(entry.fromIndex);
  };
  const todayX = off > 0 ? (x(off - 1) + x(off)) / 2 : x(0);
  const itemsByWeek = new Map<string, number>();
  for (const it of p.items) itemsByWeek.set(it.dueWeek, (itemsByWeek.get(it.dueWeek) ?? 0) + 1);
  const selectedIndex = weeks.findIndex((w) => w.weekStart === p.selectedWeek);
  const low = p.forecast.lowPoint;
  const lowIndex = weeks.findIndex((w) => w.weekStart === low.weekStart);
  const breachedWeeks = new Set(p.breachedWeeks ?? []);
  const notes = [
    ...(p.breachNotes ?? []).flatMap((n) => {
      const i = weeks.findIndex((w) => w.weekStart === n.weekStart);
      return i >= 0 ? [{ ...n, i, pt: future[i] as Point }] : [];
    }),
    // A shown scenario's breaches sit on its own line, where it is drawn.
    ...comparisons.flatMap((entry) =>
      (entry.breaches ?? []).flatMap((n) => {
        const i = weeks.findIndex((w) => w.weekStart === n.weekStart);
        const drawn =
          entry.fromIndex === undefined || (entry.fromIndex !== null && i >= entry.fromIndex);
        const week = entry.forecast.weeks[i];
        return i >= 0 && drawn && week
          ? [{ ...n, i, pt: at(off + i, week.usable), dot: entry.color }]
          : [];
      }),
    ),
  ];
  const anyBreach = breachedWeeks.size > 0 || notes.some((n) => "dot" in n);

  // Hover details for any drawn week (recorded or forecast); index is a slot on the x axis.
  const hovered =
    hover === null
      ? null
      : hover < off
        ? {
            kind: "Recorded" as const,
            weekStart: history[hover]?.weekStart ?? "",
            usable: history[hover]?.usable ?? 0,
          }
        : {
            kind: "Forecast" as const,
            weekStart: weeks[hover - off]?.weekStart ?? "",
            usable: weeks[hover - off]?.usable ?? 0,
          };

  return (
    <figure className="min-w-0 max-w-full space-y-3" data-testid="workspace-chart">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="chart-scale">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Time</span>
          <Segmented
            label="Time shown"
            name={`${titleId}-time`}
            value={shownWindow}
            onChange={(v) => setTimeWindow(v)}
            options={[
              { value: "all", label: "All history" },
              { value: "recent", label: `Last ${RECENT_WEEKS} weeks` },
              { value: "forecast", label: "Forecast only" },
            ]}
            className="[&>label>span]:h-7 [&>label>span]:px-2 [&>label>span]:text-xs"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Cash</span>
          <Segmented
            label="Cash range"
            name={`${titleId}-cash`}
            value={cashRange}
            onChange={(v) => setCashRange(v)}
            options={[
              { value: "fit", label: "Fit to lines" },
              { value: "zero", label: "From $0" },
            ]}
            className="[&>label>span]:h-7 [&>label>span]:px-2 [&>label>span]:text-xs"
          />
        </div>
      </div>
      <div ref={wrapRef} className="relative min-w-0 max-w-full">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full touch-pan-y select-none"
          role="img"
          aria-labelledby={titleId}
          onPointerLeave={() => setHover(null)}
        >
          <title
            id={titleId}
          >{`Usable cash: ${history.length} recorded weeks, then the saved 13-week forecast. Lowest forecast week ${formatFullDate(low.weekStart)} at ${formatExactCents(low.usable)}.`}</title>
          <rect
            x={todayX}
            y={PAD.top - 6}
            width={Math.max(0, W - PAD.right - todayX)}
            height={H - PAD.bottom - PAD.top + 6}
            className="fill-muted/60"
            pointerEvents="none"
          />
          <g data-testid="cash-axis" pointerEvents="none">
            {cashTicks.map((cents) => (
              <g key={cents} data-cents={cents}>
                <line
                  x1={left}
                  x2={W - PAD.right}
                  y1={y(cents)}
                  y2={y(cents)}
                  className="stroke-border"
                />
                <text
                  x={left - 8}
                  y={y(cents)}
                  dy="0.35em"
                  textAnchor="end"
                  className="fill-muted-foreground text-[11px] tabular-nums"
                >
                  <title>{formatExactCents(cents)}</title>
                  {formatAxisCash(cents)}
                </text>
              </g>
            ))}
          </g>
          <g data-testid="date-axis" pointerEvents="none">
            {timeTicks.map(({ index, date }) => (
              <line
                key={`grid-${date}`}
                x1={x(index)}
                x2={x(index)}
                y1={PAD.top}
                y2={H - PAD.bottom}
                className="stroke-border"
                strokeDasharray="2 4"
                data-testid="time-grid"
              />
            ))}
            <line
              x1={left}
              x2={W - PAD.right}
              y1={H - PAD.bottom}
              y2={H - PAD.bottom}
              className="stroke-muted-foreground/40"
            />
            <text
              x={(left + W - PAD.right) / 2}
              y={H - 8}
              textAnchor="middle"
              className="fill-muted-foreground text-[11px] font-medium"
              data-testid="time-axis-title"
            >
              Week starting
            </text>
            <text
              transform={`translate(12 ${(PAD.top + H - PAD.bottom) / 2}) rotate(-90)`}
              textAnchor="middle"
              className="fill-muted-foreground text-[11px] font-medium"
              data-testid="cash-axis-title"
            >
              Usable cash
            </text>
            {timeTicks.map(({ index, date }, i) => (
              <text
                key={date}
                data-week={date}
                x={x(index)}
                y={H - PAD.bottom + 20}
                textAnchor={i === 0 ? "start" : i === timeTicks.length - 1 ? "end" : "middle"}
                className="fill-muted-foreground text-[11px]"
              >
                {formatFullDate(date)}
              </text>
            ))}
          </g>
          <g pointerEvents="none" className="text-[11px]">
            {off > 0 ? (
              <text
                x={todayX - 8}
                y={PAD.top - 12}
                textAnchor="end"
                className="fill-muted-foreground"
              >
                Recorded
              </text>
            ) : null}
            <text x={todayX + 8} y={PAD.top - 12} className="fill-foreground font-medium">
              Next {weeks.length} weeks
            </text>
            <line
              x1={todayX}
              x2={todayX}
              y1={PAD.top - 22}
              y2={H - PAD.bottom}
              className="stroke-muted-foreground/60"
              strokeDasharray="3 3"
            />
          </g>
          {p.limits.map((l) => (
            <g key={l.id} data-testid={`limit-${l.id}`} pointerEvents="none">
              <line
                x1={left}
                x2={W - PAD.right}
                y1={y(l.cents)}
                y2={y(l.cents)}
                className="stroke-destructive"
                strokeWidth={1.25}
                strokeDasharray="6 4"
              />
              <text
                x={left + 6}
                y={y(l.cents) - 6}
                className="fill-destructive text-[11px] font-medium [paint-order:stroke] [stroke-linejoin:round] [stroke-width:3px] stroke-card"
              >
                {l.label} {formatExactCents(l.cents)}
              </text>
            </g>
          ))}
          {past.length > 1 ? (
            <path d={draw(past) ?? ""} fill="none" className="stroke-clay" strokeWidth={2} />
          ) : null}
          {parentLine.length > 1 && !p.comparisons ? (
            <path
              d={draw(lastPast ? [lastPast, ...parentLine] : parentLine) ?? ""}
              fill="none"
              className="stroke-muted-foreground"
              strokeWidth={1.5}
              strokeDasharray={DASHES[0]}
              data-testid="parent-line"
            />
          ) : null}
          {comparisons.map((entry, index) => {
            const points = comparisonPoints(entry);
            if (points.length < 2) return null;
            const fork =
              entry.fromIndex === undefined || entry.fromIndex === null ? null : points[0];
            return (
              <g
                key={entry.runId}
                pointerEvents="none"
                data-testid={entry.parent ? "parent-line" : "comparison-line"}
                data-run-id={entry.runId}
              >
                <path
                  d={draw(points) ?? ""}
                  fill="none"
                  className={entry.color ? undefined : "stroke-muted-foreground opacity-80"}
                  stroke={entry.color}
                  strokeWidth={entry.color ? 2.25 : 1.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray={entry.color ? undefined : DASHES[index % DASHES.length]}
                />
                {fork ? (
                  <circle
                    cx={fork.x}
                    cy={fork.y}
                    r={4}
                    fill={entry.color}
                    className="stroke-card"
                    strokeWidth={2}
                    data-testid="fork-point"
                  />
                ) : null}
              </g>
            );
          })}
          <path
            d={draw(lastPast ? [lastPast, ...future] : future) ?? ""}
            fill="none"
            className="stroke-primary"
            data-testid="forecast-line"
            strokeWidth={comparisons.some((c) => c.color) ? 2 : 2.5}
          />
          {/* Scheduled items: quiet ticks on the date axis, counted in the hover details. */}
          <g pointerEvents="none">
            {weeks.map((w, i) =>
              itemsByWeek.get(w.weekStart) ? (
                <circle
                  key={w.weekStart}
                  cx={(future[i] as Point).x}
                  cy={H - PAD.bottom}
                  r={2.5}
                  className="fill-muted-foreground/70"
                  data-testid={`item-mark-${w.weekStart}`}
                />
              ) : null,
            )}
          </g>
          {selectedIndex >= 0 ? (
            <line
              x1={x(off + selectedIndex)}
              x2={x(off + selectedIndex)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              className="stroke-foreground/50"
              strokeDasharray="2 3"
              pointerEvents="none"
            />
          ) : null}
          {hover !== null && hover !== off + selectedIndex ? (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              className="stroke-muted-foreground/40"
              pointerEvents="none"
            />
          ) : null}
          {weeks.map((w, i) => {
            const pt = future[i] as Point;
            const selected = i === selectedIndex;
            const breached = breachedWeeks.has(w.weekStart);
            return (
              <circle
                key={w.weekStart}
                cx={pt.x}
                cy={pt.y}
                r={selected ? 5.5 : breached || i === lowIndex ? 4.5 : 2.5}
                className={`${breached ? "fill-destructive" : "fill-primary"}${selected || breached ? " stroke-card" : ""}`}
                strokeWidth={selected || breached ? 2 : undefined}
                data-testid={`forecast-point-${w.weekStart}`}
                data-breached={breached}
                pointerEvents="none"
              />
            );
          })}
          {notes.map((n) => {
            const flip = n.pt.x > W * 0.62;
            return (
              <g
                key={`${n.weekStart}-${n.text}-${n.pt.y}`}
                pointerEvents="none"
                data-testid="breach-note"
              >
                {"dot" in n ? (
                  <circle
                    cx={n.pt.x}
                    cy={n.pt.y}
                    r={4.5}
                    className="fill-destructive stroke-card"
                    strokeWidth={2}
                    data-breached="true"
                  />
                ) : null}
                <line
                  x1={n.pt.x}
                  x2={n.pt.x}
                  y1={n.pt.y + 7}
                  y2={Math.min(H - PAD.bottom - 4, n.pt.y + 22)}
                  className="stroke-destructive"
                />
                <text
                  x={n.pt.x + (flip ? -6 : 6)}
                  y={Math.min(H - PAD.bottom - 6, n.pt.y + 22)}
                  textAnchor={flip ? "end" : "start"}
                  className="fill-destructive text-[11px] font-medium [paint-order:stroke] [stroke-linejoin:round] [stroke-width:3px] stroke-card"
                >
                  {compact && n.short ? n.short : n.text}
                </text>
              </g>
            );
          })}
          {/* Wide hit areas: recorded weeks show details on hover; forecast weeks can be chosen.
              Keyboard users pick weeks with the range control below the chart. */}
          {dates.map((date, slot) => {
            const forecastIndex = slot - off;
            return (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the week range control is the keyboard path
              <rect
                key={date}
                x={x(slot) - step / 2}
                y={PAD.top}
                width={step}
                height={H - PAD.top - PAD.bottom}
                fill="transparent"
                className={forecastIndex >= 0 ? "cursor-pointer" : undefined}
                onPointerEnter={(e) => {
                  if (e.pointerType === "mouse") setHover(slot);
                }}
                onClick={
                  forecastIndex >= 0
                    ? () => {
                        const w = weeks[forecastIndex];
                        if (w) p.onSelectWeek(w.weekStart);
                      }
                    : undefined
                }
                data-testid={forecastIndex >= 0 ? `chart-week-${date}` : undefined}
              />
            );
          })}
        </svg>
        {hovered && hover !== null ? (
          <div
            className="pointer-events-none absolute top-8 z-10 w-64 max-w-[80%] rounded-md border bg-popover p-3 text-xs text-popover-foreground shadow-md"
            style={
              x(hover) > W / 2
                ? { right: `${Math.max(0, W - x(hover) + 12)}px` }
                : { left: `${x(hover) + 12}px` }
            }
            data-testid="chart-tooltip"
          >
            <p className="font-medium">
              Week of {formatFullDate(hovered.weekStart)}{" "}
              <span className="font-normal text-muted-foreground">· {hovered.kind}</span>
            </p>
            <p className="mt-1 flex justify-between gap-3">
              <span className="text-muted-foreground">
                {hovered.kind === "Forecast" ? mainLabel : "Usable cash"}
              </span>
              <span className="tabular-nums">{formatExactCents(hovered.usable)}</span>
            </p>
            {hovered.kind === "Forecast"
              ? comparisons.map((entry) => {
                  const v = entry.forecast.weeks[hover - off]?.usable;
                  return v === undefined ? null : (
                    <p key={entry.runId} className="flex justify-between gap-3">
                      <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
                        {entry.color ? (
                          <span
                            aria-hidden="true"
                            className="size-2 shrink-0 rounded-full"
                            style={{ background: entry.color }}
                          />
                        ) : null}
                        <span className="truncate">{entry.label}</span>
                      </span>
                      <span className="shrink-0 tabular-nums">{formatExactCents(v)}</span>
                    </p>
                  );
                })
              : null}
            {hovered.kind === "Forecast" && breachedWeeks.has(hovered.weekStart) ? (
              <p className="mt-1 text-destructive">Below a cash minimum this week</p>
            ) : null}
            {itemsByWeek.get(hovered.weekStart) ? (
              <p className="mt-1 text-muted-foreground">
                {itemsByWeek.get(hovered.weekStart)} scheduled{" "}
                {itemsByWeek.get(hovered.weekStart) === 1 ? "item" : "items"}
              </p>
            ) : null}
            {hovered.kind === "Forecast" ? (
              <p className="mt-1 text-muted-foreground">Click to see this week</p>
            ) : null}
          </div>
        ) : null}
      </div>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-clay" />
          Recorded cash
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="18" height="4" aria-hidden="true" className="shrink-0">
            <line x1="0" y1="2" x2="18" y2="2" className="stroke-primary" strokeWidth={2.5} />
          </svg>
          {mainLabel}
        </span>
        {p.parent && !p.comparisons ? (
          <span className="inline-flex items-center gap-1.5">
            <Swatch dash={DASHES[0]} />
            Scenario it started from
          </span>
        ) : null}
        {comparisons.map((entry, index) => (
          <span
            key={entry.runId}
            className="inline-flex max-w-full items-center gap-1.5"
            data-testid="comparison-legend"
          >
            <Swatch
              dash={entry.color ? undefined : DASHES[index % DASHES.length]}
              color={entry.color}
            />
            <span className="max-w-48 truncate" title={entry.label}>
              {entry.label}
            </span>
            {entry.startsOn ? (
              <span className="shrink-0">· from {formatFullDate(entry.startsOn)}</span>
            ) : null}
            {entry.fromIndex === null ? (
              <span className="shrink-0">· same as the line it builds on</span>
            ) : null}
            {entry.parent ? " (started from)" : ""}
          </span>
        ))}
        {p.limits.length ? (
          <span className="inline-flex items-center gap-1.5">
            <svg width="18" height="4" aria-hidden="true" className="shrink-0">
              <line
                x1="0"
                y1="2"
                x2="18"
                y2="2"
                className="stroke-destructive"
                strokeDasharray="4 3"
              />
            </svg>
            Cash minimum
          </span>
        ) : null}
        {anyBreach ? (
          <span data-testid="breach-legend" className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-destructive" />
            Week below a cash minimum
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/70" />
          Scheduled items (original imported dates; scenario changes are in the cash line)
        </span>
      </figcaption>
      <label className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="text-muted-foreground">Pick a week</span>
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
          className="h-11 min-w-0 flex-1 accent-primary"
          data-testid="week-range"
        />
      </label>
    </figure>
  );
}

function Swatch({ dash, color }: { dash?: string; color?: string }) {
  return (
    <svg width="18" height="4" aria-hidden="true" className="shrink-0">
      <line
        x1="0"
        y1="2"
        x2="18"
        y2="2"
        className={color ? undefined : "stroke-muted-foreground"}
        stroke={color}
        strokeWidth={color ? 2.5 : 1.5}
        strokeDasharray={dash}
      />
    </svg>
  );
}
