"use client";

import { scaleLinear, scaleUtc } from "d3-scale";
import { useEffect, useRef, useState } from "react";
import { formatCents } from "../dashboard/money";
import type { QuarterPoint } from "./derive";

// Quarterly cash chart for the 2U rewind. Points sit at their real dates (time scale), so the
// gaps between filings are visible. Reported points are filled, the derived start and modeled
// points are hollow, and the line is dashed after the last reported balance. Actual later
// figures appear only when the caller passes them (the reveal section), never by default.

const INK = "hsl(var(--foreground))";
const MUTED = "hsl(var(--muted-foreground))";
const GRID = "hsl(var(--border))";
const ACCENT = "hsl(var(--primary-ink))";
const DANGER = "hsl(var(--danger-text))";

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

const utc = (d: string) => new Date(`${d}T00:00:00Z`);
const monthDay = (d: string) =>
  utc(d).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export interface ChartSeries {
  id: string;
  label: string;
  color: string;
  points: QuarterPoint[];
}

export const seriesColors = { total: INK, usable: ACCENT } as const;

export function QuarterChart({
  series,
  cutoff,
  limit,
  actual = [],
  label,
}: {
  series: ChartSeries[];
  cutoff: string;
  limit?: { cents: number; label: string } | null;
  actual?: { seriesId: string; point: QuarterPoint }[];
  label: string;
}) {
  const [ref, width] = useWidth();
  const height = 280;
  const m = { top: 28, right: 20, bottom: 44, left: 60 };
  const all = [...series.flatMap((s) => s.points), ...actual.map((a) => a.point)];
  const dates = [...new Set(all.map((p) => p.date))].sort();
  const first = dates[0] ?? cutoff;
  const last = dates.at(-1) ?? cutoff;
  const x = scaleUtc()
    .domain([utc(first), utc(last)])
    .range([m.left + 8, width - m.right - 8]);
  const max = Math.max(...all.map((p) => p.cents), limit?.cents ?? 0, 1);
  const y = scaleLinear()
    .domain([0, max * 1.08])
    .nice(4)
    .range([height - m.bottom, m.top]);
  const px = (p: QuarterPoint) => x(utc(p.date));
  const py = (p: QuarterPoint) => y(p.cents);
  const path = (pts: QuarterPoint[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${px(p).toFixed(1)},${py(p).toFixed(1)}`).join("");
  const tickDates = dates.filter((d) => d !== cutoff.slice(0, 10));
  const cx = x(utc(cutoff));

  return (
    <div ref={ref} className="w-full">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={label}
        className="block max-w-full overflow-visible"
      >
        {y.ticks(4).map((t) => (
          <g key={t}>
            <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} stroke={GRID} />
            <text
              x={m.left - 8}
              y={y(t)}
              dy="0.32em"
              textAnchor="end"
              fontSize={12}
              fill={MUTED}
              className="tabular-nums"
            >
              {formatCents(t)}
            </text>
          </g>
        ))}
        {tickDates.map((d) => (
          <g key={d} transform={`translate(${x(utc(d))},${height - m.bottom + 18})`}>
            <text textAnchor="middle" fontSize={12} fill={MUTED}>
              {monthDay(d)}
            </text>
            <text y={15} textAnchor="middle" fontSize={12} fill={MUTED}>
              {d.slice(0, 4)}
            </text>
          </g>
        ))}
        <line
          x1={cx}
          x2={cx}
          y1={m.top - 6}
          y2={height - m.bottom}
          stroke={MUTED}
          strokeDasharray="2 3"
        />
        <text
          x={cx}
          y={m.top - 12}
          textAnchor={cx > width - 140 ? "end" : "middle"}
          fontSize={12}
          fill={MUTED}
        >
          Cutoff {monthDay(cutoff)}
        </text>
        {limit ? (
          <g>
            <line
              x1={m.left}
              x2={width - m.right}
              y1={y(limit.cents)}
              y2={y(limit.cents)}
              stroke={DANGER}
              strokeDasharray="4 3"
            />
            <text
              x={width - m.right}
              y={y(limit.cents) - 6}
              textAnchor="end"
              fontSize={12}
              fill={DANGER}
            >
              {limit.label}
            </text>
          </g>
        ) : null}
        {series.map((s) => {
          const lastReported = s.points.reduce(
            (k, p, i) => (p.kind === "reported" || p.kind === "derived" ? i : k),
            0,
          );
          const solid = s.points.slice(0, lastReported + 1);
          const ahead = s.points.slice(lastReported);
          return (
            <g key={s.id}>
              {solid.length > 1 ? (
                <path d={path(solid)} fill="none" stroke={s.color} strokeWidth={2} />
              ) : null}
              {ahead.length > 1 ? (
                <path
                  d={path(ahead)}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                />
              ) : null}
              {s.points.map((p) => (
                <circle
                  key={`${s.id}-${p.date}`}
                  cx={px(p)}
                  cy={py(p)}
                  r={4}
                  fill={p.kind === "reported" ? s.color : "hsl(var(--card))"}
                  stroke={s.color}
                  strokeWidth={2}
                />
              ))}
            </g>
          );
        })}
        {actual.map(({ seriesId, point }) => {
          const color = series.find((s) => s.id === seriesId)?.color ?? INK;
          const ax = px(point);
          const ay = py(point);
          return (
            <g key={`actual-${seriesId}`}>
              <rect
                x={ax - 5}
                y={ay - 5}
                width={10}
                height={10}
                transform={`rotate(45 ${ax} ${ay})`}
                fill={color}
              />
              <text
                x={ax - 10}
                y={ay}
                dy="0.32em"
                textAnchor="end"
                fontSize={12}
                fill={color}
                className="tabular-nums"
              >
                Reported {formatCents(point.cents)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
