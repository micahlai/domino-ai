"use client";

import { scaleLinear } from "d3-scale";
import { line as d3line } from "d3-shape";
import { ChevronRight } from "lucide-react";
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { formatDate } from "../../../lib/format";
import { cn } from "../../../lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../ui/table";
import type { CashPoint, DashboardBar, Marker } from "./derive";
import { formatCents } from "./money";

// Hand-drawn SVG charts on the theme tokens. Text stays in text tokens; colors carry identity
// only. Each chart is one focusable week picker (tap or arrow keys), with a readout and a
// visible "View data" table holding the same numbers.

const INK = "hsl(var(--foreground))";
const MUTED = "hsl(var(--muted-foreground))";
const GRID = "hsl(var(--border))";
const ACCENT = "hsl(var(--primary-ink))";
const DANGER = "hsl(var(--danger-text))";
const SAFE = "hsl(var(--safe))";
const CLAY = "hsl(var(--clay))";
/** Axis and annotation text, px. */
const TEXT = 12;
/** Annotations stay this far inside the plot edges, px. */
const INSET = 12;

/** Width of the chart's box, so SVG text stays its real size at every viewport. */
function useWidth(initial = 720) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(280, Math.round(entry.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

const shortMoney = (c: number) => formatCents(Math.round(c));

// ---------- Pure helpers (tested) ----------

/**
 * Index of the lowest projected week in a cash line. Today is not a projected week, so it never
 * counts, even when it is lower: the same definition as the "Lowest projected cash" tile
 * (derive.ts lowest). -1 when there is no projected week.
 */
export function lowestProjectedIndex(points: CashPoint[]): number {
  let best = -1;
  points.forEach((p, i) => {
    if (p.label !== "week") return;
    const cur = points[best];
    if (best < 0 || (cur && p.usable < cur.usable)) best = i;
  });
  return best;
}

/** Keeps an annotation's anchor inside the plot: `INSET` px from each edge, text never clipped. */
export function clampLabel(
  x: number,
  y: number,
  plot: { left: number; right: number; top: number; bottom: number },
  textWidth: number,
): { x: number; y: number; anchor: "start" | "middle" | "end" } {
  const lo = plot.left + INSET;
  const hi = plot.right - INSET;
  const cy = Math.min(plot.bottom - INSET, Math.max(plot.top + INSET + TEXT / 2, y));
  if (x - textWidth / 2 < lo) return { x: Math.max(lo, x), y: cy, anchor: "start" };
  if (x + textWidth / 2 > hi) return { x: Math.min(hi, x), y: cy, anchor: "end" };
  return { x, y: cy, anchor: "middle" };
}

/** Next selected week for a key press, or null when the key is not a week key. */
export function stepWeek(current: number, key: string, count: number): number | null {
  const last = count - 1;
  if (key === "ArrowRight" || key === "ArrowUp") return Math.min(last, current + 1);
  if (key === "ArrowLeft" || key === "ArrowDown") return Math.max(0, current - 1);
  if (key === "Home") return 0;
  if (key === "End") return last;
  return null;
}

/** Rough text width for 12px Inter digits and letters, enough to keep labels inside the plot. */
const textWidth = (s: string) => s.length * 6.6;

// ---------- Week picker ----------

/**
 * Selected week. Goes back to `initial` when the weeks or the default change (another company,
 * a new week), but survives a refresh of the same numbers.
 */
function useSelection(weeks: { weekStart: string }[], initial: number) {
  const key = `${weeks[0]?.weekStart}|${weeks.length}|${initial}`;
  const [picked, setPicked] = useState<{ key: string; index: number } | null>(null);
  const selected = picked && picked.key === key ? picked.index : initial;
  return [selected, (index: number) => setPicked({ key, index })] as const;
}

/**
 * A chart that is one slider: tap or click a week to select it, arrow keys step weeks, the
 * mouse previews. `indexAt` maps a pointer x (px inside the chart) to a week index.
 */
function WeekPicker({
  count,
  selected,
  onSelect,
  onPreview,
  label,
  valueText,
  indexAt,
  children,
}: {
  count: number;
  selected: number;
  onSelect: (i: number) => void;
  onPreview: (i: number | null) => void;
  label: string;
  valueText: string;
  indexAt: (x: number) => number;
  children: ReactNode;
}) {
  const at = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return Math.min(count - 1, Math.max(0, indexAt(e.clientX - box.left)));
  };
  // A div slider, not <input type="range">: the range input cannot hold the SVG it controls.
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={count - 1}
      aria-valuenow={selected}
      aria-valuetext={valueText}
      className="cursor-pointer touch-pan-y rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        const next = stepWeek(selected, e.key, count);
        if (next === null) return;
        e.preventDefault();
        onPreview(null);
        onSelect(next);
      }}
      onPointerDown={(e) => onSelect(at(e))}
      onPointerMove={(e) => {
        if (e.pointerType === "mouse") onPreview(at(e));
      }}
      onPointerLeave={() => onPreview(null)}
    >
      {children}
    </div>
  );
}

function Readout({ children }: { children: ReactNode }) {
  return (
    <div
      className="mb-3 flex min-h-10 flex-wrap items-baseline gap-x-4 gap-y-1 text-sm"
      aria-live="polite"
    >
      {children}
    </div>
  );
}

/** Visible disclosure with the chart's numbers as a table. 44px tall on touch screens. */
function ViewData({ children }: { children: ReactNode }) {
  return (
    <details className="group mt-3 border-t pt-1">
      <summary
        className={cn(
          "inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-md text-[13px] font-medium text-primary sm:min-h-8",
          "outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden",
        )}
      >
        <ChevronRight
          className="size-4 transition-transform group-open:rotate-90 motion-reduce:transition-none"
          aria-hidden="true"
        />
        View data
      </summary>
      <div className="-mx-[var(--card-pad)] mt-1 border-t">{children}</div>
    </details>
  );
}

const hint = "Tap a week or use the arrow keys.";

// ---------- Weekly cash flow bars ----------

/** Activity series, shared with the dashboard's totals table so its swatches match the bars. */
export const FLOW_SECTIONS = [
  { key: "operating", label: "Operating", color: ACCENT },
  { key: "investing", label: "Investing", color: CLAY },
  { key: "financing", label: "Financing", color: "hsl(var(--foreground) / 0.55)" },
] as const;

/** Projected swatch: the series colour as an outline with diagonal hatching. */
export function ProjectedSwatch({ color = "currentColor" }: { color?: string }) {
  return (
    <span
      aria-hidden="true"
      className="size-2.5 rounded-[3px] border"
      style={{
        borderColor: color,
        backgroundImage: `repeating-linear-gradient(135deg, ${color} 0 1.5px, transparent 1.5px 4px)`,
      }}
    />
  );
}

export function CashFlowBars({ bars }: { bars: DashboardBar[] }) {
  const [ref, width] = useWidth();
  const id = useId().replace(/:/g, "");
  const firstProjected = bars.findIndex((b) => b.kind === "projected");
  const [selected, setSelected] = useSelection(bars, Math.max(0, firstProjected));
  const [preview, setPreview] = useState<number | null>(null);
  const shown = preview ?? selected;
  const height = 252;
  const m = { top: 26, right: 8, bottom: 30, left: 56 };
  const innerW = width - m.left - m.right;
  const band = innerW / Math.max(1, bars.length);
  const barW = Math.max(6, Math.min(28, band * 0.6));
  let lo = 0;
  let hi = 0;
  for (const b of bars) {
    const vals = FLOW_SECTIONS.map((s) => b[s.key]);
    hi = Math.max(
      hi,
      vals.filter((v) => v > 0).reduce((a, v) => a + v, 0),
    );
    lo = Math.min(
      lo,
      vals.filter((v) => v < 0).reduce((a, v) => a + v, 0),
    );
  }
  const y = scaleLinear()
    .domain([lo, hi === lo ? lo + 1 : hi])
    .nice(4)
    .range([height - m.bottom, m.top]);
  const ticks = y.ticks(4);
  const cur = bars[shown];
  const labelEvery = width < 520 ? 4 : 2;
  const kindWords = (b: DashboardBar) =>
    b.kind === "actual" ? (b.partial ? "Actual, week so far" : "Actual") : "Projected";

  return (
    <div>
      <Readout>
        {cur ? (
          <>
            <span className="font-medium">
              Week of {formatDate(cur.weekStart)}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {kindWords(cur)}
              </span>
            </span>
            {FLOW_SECTIONS.map((s) => (
              <span key={s.key} className="tabular-nums text-muted-foreground">
                {s.label} <span className="text-foreground">{shortMoney(cur[s.key])}</span>
              </span>
            ))}
            <span className="tabular-nums text-muted-foreground">
              Ends at <span className="text-foreground">{shortMoney(cur.endingCash)}</span>
            </span>
          </>
        ) : null}
      </Readout>
      <div ref={ref} className="w-full">
        <WeekPicker
          count={bars.length}
          selected={selected}
          onSelect={setSelected}
          onPreview={setPreview}
          label="Weekly net cash flow. Select a week"
          valueText={cur ? `Week of ${formatDate(cur.weekStart)}, ${kindWords(cur)}` : ""}
          indexAt={(px) => Math.floor((px - m.left) / band)}
        >
          <svg width={width} height={height} aria-hidden="true" className="block">
            <defs>
              {FLOW_SECTIONS.map((s) => (
                <pattern
                  key={s.key}
                  id={`${id}-${s.key}`}
                  width={5}
                  height={5}
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <rect width={5} height={5} fill="hsl(var(--card))" />
                  <line x1={0} y1={0} x2={0} y2={5} stroke={s.color} strokeWidth={2} />
                </pattern>
              ))}
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={m.left}
                  x2={width - m.right}
                  y1={y(t)}
                  y2={y(t)}
                  stroke={GRID}
                  strokeWidth={t === 0 ? 1 : 0.5}
                  strokeDasharray={t === 0 ? undefined : "2 4"}
                />
                <text
                  x={m.left - 8}
                  y={y(t)}
                  dy="0.32em"
                  textAnchor="end"
                  fontSize={TEXT}
                  fill={MUTED}
                  className="tabular-nums"
                >
                  {shortMoney(t)}
                </text>
              </g>
            ))}
            {firstProjected > 0 ? (
              <g>
                <line
                  x1={m.left + band * firstProjected}
                  x2={m.left + band * firstProjected}
                  y1={m.top - 22}
                  y2={height - m.bottom}
                  stroke={GRID}
                  strokeWidth={1}
                />
                <text
                  x={m.left + band * firstProjected - 6}
                  y={m.top - 10}
                  textAnchor="end"
                  fontSize={TEXT}
                  fontWeight={500}
                  fill={MUTED}
                >
                  Actual
                </text>
                <text
                  x={m.left + band * firstProjected + 6}
                  y={m.top - 10}
                  fontSize={TEXT}
                  fontWeight={500}
                  fill={MUTED}
                >
                  Forecast
                </text>
              </g>
            ) : null}
            {shown >= 0 && shown < bars.length ? (
              <rect
                x={m.left + band * shown}
                y={m.top}
                width={band}
                height={height - m.top - m.bottom}
                fill="hsl(var(--muted))"
                rx={3}
              />
            ) : null}
            {bars.map((b, i) => {
              const cx = m.left + band * i + band / 2;
              const projected = b.kind === "projected";
              let up = 0;
              let down = 0;
              const segs = FLOW_SECTIONS.flatMap((s) => {
                const v = b[s.key];
                if (v === 0) return [];
                const from = v > 0 ? up : down;
                const to = from + v;
                if (v > 0) up = to;
                else down = to;
                const top = y(Math.max(from, to));
                const h = Math.max(1, Math.abs(y(from) - y(to)) - (from !== 0 ? 2 : 0));
                return [
                  {
                    key: s.key,
                    color: s.color,
                    top: v > 0 ? top : y(from) + (from !== 0 ? 2 : 0),
                    h,
                  },
                ];
              });
              return (
                <g key={b.weekStart}>
                  {segs.map((s) => (
                    <rect
                      key={s.key}
                      x={cx - barW / 2 + (projected ? 0.75 : 0)}
                      y={s.top + (projected ? 0.75 : 0)}
                      width={barW - (projected ? 1.5 : 0)}
                      height={Math.max(1, s.h - (projected ? 1.5 : 0))}
                      rx={2}
                      fill={projected ? `url(#${id}-${s.key})` : s.color}
                      stroke={projected ? s.color : undefined}
                      strokeWidth={projected ? 1.5 : undefined}
                    />
                  ))}
                  {i % labelEvery === 0 ? (
                    <text
                      x={cx}
                      y={height - 8}
                      textAnchor="middle"
                      fontSize={TEXT}
                      fill={i === shown ? INK : MUTED}
                    >
                      {formatDate(b.weekStart)}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
        </WeekPicker>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        {FLOW_SECTIONS.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-[3px]"
              style={{ background: s.color }}
            />
            {s.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-[3px] bg-foreground/80" />
          Actual (solid)
        </span>
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <ProjectedSwatch />
          Projected (outlined)
        </span>
        <span className="sm:ml-auto">{hint}</span>
      </div>
      <ViewData>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Week of</TableHead>
              <TableHead>Kind</TableHead>
              {FLOW_SECTIONS.map((s) => (
                <TableHead key={s.key} className="text-right">
                  {s.label}
                </TableHead>
              ))}
              <TableHead className="text-right">Ending cash</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bars.map((b) => (
              <TableRow key={b.weekStart}>
                <TableCell className="h-9 whitespace-nowrap py-1">
                  {formatDate(b.weekStart)}
                </TableCell>
                <TableCell className="h-9 whitespace-nowrap py-1 text-muted-foreground">
                  {kindWords(b)}
                </TableCell>
                {FLOW_SECTIONS.map((s) => (
                  <TableCell key={s.key} className="h-9 whitespace-nowrap py-1 text-right">
                    {formatCents(b[s.key])}
                  </TableCell>
                ))}
                <TableCell className="h-9 whitespace-nowrap py-1 text-right font-medium">
                  {formatCents(b.endingCash)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ViewData>
    </div>
  );
}

// ---------- 13-week usable cash line ----------

export function CashLine({
  points,
  minimum,
  markers,
  breach,
}: {
  points: CashPoint[];
  minimum: number | null;
  markers: Marker[];
  breach: string | null;
}) {
  const [ref, width] = useWidth();
  const clip = useId().replace(/:/g, "");
  const low = lowestProjectedIndex(points);
  const [selected, setSelected] = useSelection(points, Math.max(0, low));
  const [preview, setPreview] = useState<number | null>(null);
  const shown = preview ?? selected;
  const plotH = width < 520 ? 240 : 264;
  const m = { top: 20, right: 16, bottom: 52, left: 56 };
  const height = m.top + plotH + m.bottom;
  const plotBottom = m.top + plotH;
  const plot = { left: m.left, right: width - m.right, top: m.top, bottom: plotBottom };
  const x = scaleLinear()
    .domain([0, Math.max(1, points.length - 1)])
    .range([m.left + 8, width - m.right - 8]);
  const values = points.map((p) => p.usable);
  const lo = Math.min(...values, minimum ?? Number.POSITIVE_INFINITY);
  const hi = Math.max(...values, minimum ?? Number.NEGATIVE_INFINITY);
  const pad = (hi - lo) * 0.12 || 1;
  const y = scaleLinear()
    .domain([lo - pad, hi + pad])
    .nice(4)
    .range([plotBottom, m.top]);
  const path =
    d3line<CashPoint>()
      .x((_, i) => x(i))
      .y((p) => y(p.usable))(points) ?? "";
  const minY = minimum === null ? null : y(minimum);
  const breachIndex = breach
    ? points.findIndex((p) => p.label === "week" && p.weekStart === breach)
    : -1;
  const byIndex = new Map<number, Marker[]>();
  for (const mk of markers) {
    const i = points.findIndex((p) => p.label === "week" && p.weekStart === mk.weekStart);
    if (i >= 0) byIndex.set(i, [...(byIndex.get(i) ?? []), mk]);
  }
  const labelEvery = width < 520 ? 4 : 2;
  const cur = points[shown];
  const curMarkers = byIndex.get(shown) ?? [];
  const pointName = (p: CashPoint) =>
    p.label === "today" ? "Today" : `Week of ${formatDate(p.weekStart)}`;

  const lowPoint = points[low];
  const lowText = lowPoint
    ? `Lowest projected ${formatCents(lowPoint.usable)}, ${formatDate(lowPoint.weekStart)}`
    : "";
  const lowY = lowPoint ? y(lowPoint.usable) : 0;
  // Below the dot when there is room, else above it.
  const lowLabel = lowPoint
    ? clampLabel(
        x(low),
        lowY + 22 <= plotBottom - INSET ? lowY + 22 : lowY - 12,
        plot,
        textWidth(lowText),
      )
    : null;
  const today = points[0];
  const todayText = today?.label === "today" ? `Today ${formatCents(today.usable)}` : "";
  // On the side away from the line's next step, so the line never crosses the text.
  const todayY = y(today?.usable ?? 0);
  const rising = (points[1]?.usable ?? 0) >= (today?.usable ?? 0);
  const todayLabel = todayText
    ? clampLabel(x(0), rising ? todayY + 22 : todayY - 12, plot, textWidth(todayText))
    : null;
  const minText = minimum === null ? "" : `Lender's minimum ${formatCents(minimum)}`;
  const minLabel =
    minY === null ? null : clampLabel(plot.right, minY - 6, plot, textWidth(minText));

  return (
    <div>
      <Readout>
        {cur ? (
          <>
            <span className="font-medium">{pointName(cur)}</span>
            <span className="tabular-nums text-muted-foreground">
              Usable cash <span className="text-foreground">{formatCents(cur.usable)}</span>
            </span>
            {minimum !== null ? (
              <span
                className={
                  cur.usable < minimum
                    ? "tabular-nums text-destructive"
                    : "tabular-nums text-muted-foreground"
                }
              >
                {cur.usable < minimum
                  ? `${formatCents(minimum - cur.usable)} below the minimum`
                  : `${formatCents(cur.usable - minimum)} above the minimum`}
              </span>
            ) : null}
            {shown === low ? (
              <span className="text-[13px] text-muted-foreground">Lowest projected week</span>
            ) : null}
            {curMarkers.map((mk) => (
              <span key={mk.label} className="tabular-nums text-muted-foreground">
                {mk.label} <span className="text-foreground">{formatCents(mk.cents)}</span>
              </span>
            ))}
          </>
        ) : null}
      </Readout>
      <div ref={ref} className="w-full">
        <WeekPicker
          count={points.length}
          selected={selected}
          onSelect={setSelected}
          onPreview={setPreview}
          label="Usable cash for the next 13 weeks. Select a week"
          valueText={cur ? `${pointName(cur)}, usable cash ${formatCents(cur.usable)}` : ""}
          indexAt={(px) => Math.round(x.invert(px))}
        >
          <svg width={width} height={height} aria-hidden="true" className="block">
            <defs>
              {minY !== null ? (
                <>
                  <clipPath id={`${clip}-above`}>
                    <rect x={0} y={0} width={width} height={minY} />
                  </clipPath>
                  <clipPath id={`${clip}-below`}>
                    <rect x={0} y={minY} width={width} height={height} />
                  </clipPath>
                </>
              ) : null}
            </defs>
            {y.ticks(4).map((t) => (
              <g key={t}>
                <line
                  x1={m.left}
                  x2={width - m.right}
                  y1={y(t)}
                  y2={y(t)}
                  stroke={GRID}
                  strokeWidth={0.5}
                  strokeDasharray="2 4"
                />
                <text
                  x={m.left - 8}
                  y={y(t)}
                  dy="0.32em"
                  textAnchor="end"
                  fontSize={TEXT}
                  fill={MUTED}
                  className="tabular-nums"
                >
                  {shortMoney(t)}
                </text>
              </g>
            ))}
            {minY !== null ? (
              <g>
                <rect
                  x={m.left}
                  y={minY}
                  width={width - m.left - m.right}
                  height={Math.max(0, plotBottom - minY)}
                  fill="hsl(var(--destructive) / 0.05)"
                />
                <line
                  x1={m.left}
                  x2={width - m.right}
                  y1={minY}
                  y2={minY}
                  stroke={DANGER}
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                />
                {minLabel ? (
                  <text
                    x={minLabel.x}
                    y={minLabel.y}
                    textAnchor={minLabel.anchor}
                    fontSize={TEXT}
                    fill={DANGER}
                  >
                    {minText}
                  </text>
                ) : null}
              </g>
            ) : null}
            {breachIndex >= 0 ? (
              <line
                x1={x(breachIndex)}
                x2={x(breachIndex)}
                y1={m.top}
                y2={plotBottom}
                stroke={DANGER}
                strokeWidth={1}
                strokeDasharray="2 3"
              />
            ) : null}
            {cur ? (
              <line
                x1={x(shown)}
                x2={x(shown)}
                y1={m.top}
                y2={plotBottom}
                stroke={MUTED}
                strokeWidth={1}
              />
            ) : null}
            <path
              d={path}
              fill="none"
              stroke={ACCENT}
              strokeWidth={2}
              clipPath={minY !== null ? `url(#${clip}-above)` : undefined}
            />
            {minY !== null ? (
              <path
                d={path}
                fill="none"
                stroke={DANGER}
                strokeWidth={2}
                clipPath={`url(#${clip}-below)`}
              />
            ) : null}
            {points.map((p, i) => {
              const below = minimum !== null && p.usable < minimum;
              const big = i === low || i === 0;
              return (
                <circle
                  key={p.weekStart}
                  cx={x(i)}
                  cy={y(p.usable)}
                  r={i === shown ? 5.5 : big ? 4 : 2.5}
                  fill={p.label === "today" ? "hsl(var(--card))" : below ? DANGER : ACCENT}
                  stroke={p.label === "today" ? INK : "hsl(var(--card))"}
                  strokeWidth={2}
                />
              );
            })}
            {todayLabel ? (
              <text
                x={todayLabel.x}
                y={todayLabel.y}
                textAnchor={todayLabel.anchor}
                fontSize={TEXT}
                fill={MUTED}
                className="tabular-nums"
              >
                {todayText}
              </text>
            ) : null}
            {lowLabel ? (
              <text
                x={lowLabel.x}
                y={lowLabel.y}
                textAnchor={lowLabel.anchor}
                fontSize={TEXT}
                fontWeight={500}
                fill={INK}
                className="tabular-nums"
              >
                {lowText}
              </text>
            ) : null}
            {/* Big scheduled items: up = money in, down = money out. */}
            {[...byIndex.entries()].map(([i, list]) => {
              const net = list.reduce((s, mk) => s + mk.cents, 0);
              const cx = x(i);
              const cy = plotBottom + 14;
              return (
                <path
                  key={i}
                  d={
                    net >= 0
                      ? `M${cx - 5},${cy + 4} L${cx + 5},${cy + 4} L${cx},${cy - 4} Z`
                      : `M${cx - 5},${cy - 4} L${cx + 5},${cy - 4} L${cx},${cy + 4} Z`
                  }
                  fill={net >= 0 ? SAFE : CLAY}
                />
              );
            })}
            {points.map((p, i) =>
              i === 0 || i % labelEvery === 0 ? (
                <text
                  key={p.weekStart}
                  x={x(i)}
                  y={height - 8}
                  textAnchor={i === 0 ? "start" : "middle"}
                  fontSize={TEXT}
                  fill={i === shown ? INK : MUTED}
                >
                  {i === 0 ? "Today" : formatDate(p.weekStart)}
                </text>
              ) : null,
            )}
          </svg>
        </WeekPicker>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-0.5 w-4 rounded" style={{ background: ACCENT }} />
          Usable cash
        </span>
        {minimum !== null ? (
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-0 w-4 border-t-2 border-dashed"
              style={{ borderColor: DANGER }}
            />
            Lender's minimum
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" style={{ color: SAFE }}>
            ▲
          </span>
          <span aria-hidden="true" style={{ color: CLAY }}>
            ▼
          </span>
          Big scheduled money in / out
        </span>
        <span className="sm:ml-auto">{hint}</span>
      </div>
      <ViewData>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Week</TableHead>
              <TableHead className="text-right">Usable cash</TableHead>
              {minimum !== null ? (
                <TableHead className="text-right">Versus minimum</TableHead>
              ) : null}
              <TableHead>Big scheduled items</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {points.map((p, i) => (
              <TableRow key={p.weekStart}>
                <TableCell className="h-9 whitespace-nowrap py-1">
                  {p.label === "today" ? "Today" : formatDate(p.weekStart)}
                  {i === low ? (
                    <span className="ml-2 text-xs text-muted-foreground">Lowest projected</span>
                  ) : null}
                </TableCell>
                <TableCell className="h-9 whitespace-nowrap py-1 text-right font-medium">
                  {formatCents(p.usable)}
                </TableCell>
                {minimum !== null ? (
                  <TableCell
                    className={cn(
                      "h-9 whitespace-nowrap py-1 text-right",
                      p.usable < minimum && "text-destructive",
                    )}
                  >
                    {p.usable >= minimum ? "+" : ""}
                    {formatCents(p.usable - minimum)}
                  </TableCell>
                ) : null}
                <TableCell className="h-9 py-1 text-muted-foreground">
                  {(byIndex.get(i) ?? [])
                    .map((mk) => `${mk.label} ${formatCents(mk.cents)}`)
                    .join(", ")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ViewData>
    </div>
  );
}
