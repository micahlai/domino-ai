"use client";

import { scaleLinear } from "d3-scale";
import { line as d3line } from "d3-shape";
import { useEffect, useId, useRef, useState } from "react";
import { formatCents, formatDate } from "../../../lib/format";
import type { CashPoint, DashboardBar, Marker } from "./derive";

// Hand-drawn SVG charts on the theme tokens. Text stays in text tokens; colors carry identity
// only. Each chart has a hover readout and a screen-reader table with the same numbers.

const INK = "hsl(var(--foreground))";
const MUTED = "hsl(var(--muted-foreground))";
const GRID = "hsl(var(--border))";
const ACCENT = "hsl(var(--primary-ink))";
const DANGER = "hsl(var(--danger-text))";
const SAFE = "hsl(var(--safe))";
const CLAY = "hsl(var(--clay))";

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

// ---------- Weekly cash flow bars ----------

/** Activity series, shared with the dashboard's totals table so its swatches match the bars. */
export const FLOW_SECTIONS = [
  { key: "operating", label: "Operating", color: ACCENT },
  { key: "investing", label: "Investing", color: CLAY },
  { key: "financing", label: "Financing", color: "hsl(var(--foreground) / 0.55)" },
] as const;

export function CashFlowBars({ bars }: { bars: DashboardBar[] }) {
  const [ref, width] = useWidth();
  const firstProjected = bars.findIndex((b) => b.kind === "projected");
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? Math.max(0, firstProjected);
  const height = 220;
  const m = { top: 22, right: 8, bottom: 26, left: 52 };
  const innerW = width - m.left - m.right;
  const band = innerW / Math.max(1, bars.length);
  const barW = Math.max(4, Math.min(28, band * 0.6));
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

  return (
    <div>
      <div
        className="mb-3 flex min-h-10 flex-wrap items-baseline gap-x-4 gap-y-1 text-sm"
        aria-live="polite"
      >
        {cur ? (
          <>
            <span className="font-medium">
              Week of {formatDate(cur.weekStart)}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {cur.kind === "actual"
                  ? cur.partial
                    ? "Actual, week so far"
                    : "Actual"
                  : "Projected"}
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
      </div>
      <div ref={ref} className="w-full">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Weekly net cash flow by section, actual then projected"
          onPointerLeave={() => setHover(null)}
        >
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
                fontSize={11}
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
                y1={m.top - 20}
                y2={height - m.bottom}
                stroke={GRID}
                strokeWidth={1}
              />
              <text
                x={m.left + band * firstProjected - 6}
                y={m.top - 10}
                textAnchor="end"
                fontSize={10}
                fontWeight={500}
                fill={MUTED}
              >
                Actual
              </text>
              <text
                x={m.left + band * firstProjected + 6}
                y={m.top - 10}
                fontSize={10}
                fontWeight={500}
                fill={MUTED}
              >
                Forecast
              </text>
            </g>
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
              <g key={b.weekStart} opacity={hover === null || hover === i ? 1 : 0.55}>
                {segs.map((s) => (
                  <rect
                    key={s.key}
                    x={cx - barW / 2}
                    y={s.top}
                    width={barW}
                    height={s.h}
                    rx={2}
                    fill={s.color}
                    fillOpacity={projected ? 0.38 : 1}
                  />
                ))}
                {i % labelEvery === 0 ? (
                  <text x={cx} y={height - 8} textAnchor="middle" fontSize={10} fill={MUTED}>
                    {formatDate(b.weekStart)}
                  </text>
                ) : null}
                <rect
                  x={m.left + band * i}
                  y={m.top}
                  width={band}
                  height={height - m.top - m.bottom}
                  fill="transparent"
                  onPointerEnter={() => setHover(i)}
                />
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
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
          Actual
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-[3px] bg-foreground/30" />
          Projected
        </span>
      </div>
      <div className="sr-only">
        <table>
          <caption>Weekly cash flow</caption>
          <thead>
            <tr>
              <th>Week</th>
              <th>Kind</th>
              <th>Operating</th>
              <th>Investing</th>
              <th>Financing</th>
              <th>Ending cash</th>
            </tr>
          </thead>
          <tbody>
            {bars.map((b) => (
              <tr key={b.weekStart}>
                <td>{formatDate(b.weekStart)}</td>
                <td>{b.kind}</td>
                <td>{formatCents(b.operating)}</td>
                <td>{formatCents(b.investing)}</td>
                <td>{formatCents(b.financing)}</td>
                <td>{formatCents(b.endingCash)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
  const [hover, setHover] = useState<number | null>(null);
  const height = 230;
  const m = { top: 18, right: 14, bottom: 50, left: 52 };
  const plotBottom = height - m.bottom;
  const x = scaleLinear()
    .domain([0, Math.max(1, points.length - 1)])
    .range([m.left, width - m.right]);
  const values = points.map((p) => p.usable);
  const lo = Math.min(...values, minimum ?? Number.POSITIVE_INFINITY);
  const hi = Math.max(...values, minimum ?? Number.NEGATIVE_INFINITY);
  const pad = (hi - lo) * 0.08 || 1;
  const y = scaleLinear()
    .domain([lo - pad, hi + pad])
    .nice(4)
    .range([plotBottom, m.top]);
  const path =
    d3line<CashPoint>()
      .x((_, i) => x(i))
      .y((p) => y(p.usable))(points) ?? "";
  const minY = minimum === null ? null : y(minimum);
  const low = points.reduce((a, p, i) => (p.usable < (points[a]?.usable ?? 0) ? i : a), 0);
  const breachIndex = breach
    ? points.findIndex((p) => p.label === "week" && p.weekStart === breach)
    : -1;
  const byIndex = new Map<number, Marker[]>();
  for (const mk of markers) {
    const i = points.findIndex((p) => p.label === "week" && p.weekStart === mk.weekStart);
    if (i >= 0) byIndex.set(i, [...(byIndex.get(i) ?? []), mk]);
  }
  const labelEvery = width < 520 ? 4 : 2;
  const cur = hover === null ? null : points[hover];
  const curMarkers = hover === null ? [] : (byIndex.get(hover) ?? []);

  return (
    <div>
      <div
        className="mb-3 flex min-h-10 flex-wrap items-baseline gap-x-4 gap-y-1 text-sm"
        aria-live="polite"
      >
        {cur ? (
          <>
            <span className="font-medium">
              {cur.label === "today" ? "Today" : `Week of ${formatDate(cur.weekStart)}`}
            </span>
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
            {curMarkers.map((mk) => (
              <span key={mk.label} className="tabular-nums text-muted-foreground">
                {mk.label} <span className="text-foreground">{formatCents(mk.cents)}</span>
              </span>
            ))}
          </>
        ) : (
          <span className="text-[13px] text-muted-foreground">
            Hover a week for details. Click the chart to open the timeline.
          </span>
        )}
      </div>
      <div ref={ref} className="w-full">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Usable cash for the next 13 weeks against the lender's minimum"
          onPointerLeave={() => setHover(null)}
          onPointerMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const i = Math.round(x.invert(e.clientX - box.left));
            setHover(Math.min(points.length - 1, Math.max(0, i)));
          }}
        >
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
                fontSize={11}
                fill={MUTED}
                className="tabular-nums"
              >
                {shortMoney(t)}
              </text>
            </g>
          ))}
          {minY !== null && minimum !== null ? (
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
              <text x={width - m.right} y={minY - 6} textAnchor="end" fontSize={11} fill={DANGER}>
                Lender's minimum {formatCents(minimum)}
              </text>
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
                r={hover === i ? 5 : big ? 4 : 2.5}
                fill={below ? DANGER : ACCENT}
                stroke="hsl(var(--card))"
                strokeWidth={2}
              />
            );
          })}
          <text
            x={x(low)}
            y={y(points[low]?.usable ?? 0) + 18}
            textAnchor={low > points.length - 3 ? "end" : "middle"}
            fontSize={11}
            fill={INK}
            className="tabular-nums"
          >
            Low {formatCents(points[low]?.usable ?? 0)}
          </text>
          {hover !== null ? (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={m.top}
              y2={plotBottom}
              stroke={MUTED}
              strokeWidth={1}
            />
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
              >
                <title>{list.map((mk) => `${mk.label} ${formatCents(mk.cents)}`).join(", ")}</title>
              </path>
            );
          })}
          {points.map((p, i) =>
            i === 0 || i % labelEvery === 0 ? (
              <text
                key={p.weekStart}
                x={x(i)}
                y={height - 8}
                textAnchor={i === 0 ? "start" : "middle"}
                fontSize={10}
                fill={MUTED}
              >
                {i === 0 ? "Today" : formatDate(p.weekStart)}
              </text>
            ) : null,
          )}
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
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
      </div>
      <div className="sr-only">
        <table>
          <caption>Usable cash by week</caption>
          <thead>
            <tr>
              <th>Week</th>
              <th>Usable cash</th>
              <th>Big scheduled items</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p, i) => (
              <tr key={p.weekStart}>
                <td>{p.label === "today" ? "Today" : formatDate(p.weekStart)}</td>
                <td>{formatCents(p.usable)}</td>
                <td>
                  {(byIndex.get(i) ?? [])
                    .map((mk) => `${mk.label} ${formatCents(mk.cents)}`)
                    .join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
