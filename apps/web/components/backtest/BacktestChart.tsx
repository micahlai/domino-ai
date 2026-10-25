"use client";

import { scaleLinear, scaleUtc } from "d3-scale";
import { useEffect, useRef, useState } from "react";
import { formatCents } from "../field/dashboard/money";

// One timeline for the 2U backtest: Forecast (dashed), Actual (solid, only after the reveal) and
// the simulated Counterfactual (accent). Points sit at their real dates. Public companies report
// once a quarter, so the only reported balances are quarter ends; the cutoff point is modeled.

const INK = "hsl(var(--foreground))";
const MUTED = "hsl(var(--muted-foreground))";
const GRID = "hsl(var(--border))";
const ACCENT = "hsl(var(--primary-ink))";
const CARD = "hsl(var(--card))";

export type ChartPoint = { date: string; cents: number; reported: boolean };
export type ChartLine = {
  id: "forecast" | "actual" | "counterfactual";
  label: string;
  points: ChartPoint[];
};

const STYLE = {
  forecast: { color: MUTED, dash: "6 5", width: 2 },
  actual: { color: INK, dash: undefined, width: 2.25 },
  counterfactual: { color: ACCENT, dash: undefined, width: 3 },
} as const;

const LEGEND = ["forecast", "actual", "counterfactual"] as const;

function useWidth(initial = 760) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(300, Math.round(entry.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

const utc = (d: string) => new Date(`${d}T00:00:00Z`);
const longDate = (d: string) =>
  utc(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

export function BacktestChart({
  lines,
  cutoff,
  quarterLabels,
}: {
  lines: ChartLine[];
  /** Calendar date of the knowledge cutoff. */
  cutoff: string;
  /** Quarter-end dates and their labels, e.g. Q3 2023 end. */
  quarterLabels: { date: string; label: string }[];
}) {
  const [ref, width] = useWidth();
  const height = 320;
  const m = { top: 34, right: 168, bottom: 52, left: 64 };
  const all = lines.flatMap((l) => l.points);
  const dates = [...new Set([...all.map((p) => p.date), cutoff])].sort();
  const x = scaleUtc()
    .domain([utc(dates[0] ?? cutoff), utc(dates.at(-1) ?? cutoff)])
    .range([m.left + 10, width - m.right]);
  const max = Math.max(...all.map((p) => p.cents), 1);
  const y = scaleLinear()
    .domain([0, max * 1.12])
    .nice(4)
    .range([height - m.bottom, m.top]);
  const px = (p: ChartPoint) => x(utc(p.date));
  const py = (p: ChartPoint) => y(p.cents);
  const path = (pts: ChartPoint[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${px(p).toFixed(1)},${py(p).toFixed(1)}`).join("");
  const cx = x(utc(cutoff));
  const ends = lines.map((l) => ({ line: l, end: l.points.at(-1) })).filter((e) => e.end);
  // Spread end labels that would overlap; coincident values share one label line each.
  const labelY = new Map<string, number>();
  [...ends]
    .sort((a, b) => py(a.end!) - py(b.end!))
    .reduce((prev, e) => {
      const yy = Math.max(py(e.end!), prev + 16);
      labelY.set(e.line.id, yy);
      return yy;
    }, Number.NEGATIVE_INFINITY);
  const order = ["counterfactual", "forecast", "actual"] as const;
  const sorted = [...lines].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  return (
    <div ref={ref} className="w-full">
      <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted-foreground">
        {[...lines]
          .sort((a, b) => LEGEND.indexOf(a.id) - LEGEND.indexOf(b.id))
          .map((l) => (
            <li key={l.id} className="flex items-center gap-2">
              <svg width="28" height="10" aria-hidden="true">
                <line
                  x1="0"
                  x2="28"
                  y1="5"
                  y2="5"
                  stroke={STYLE[l.id].color}
                  strokeWidth={STYLE[l.id].width}
                  strokeDasharray={STYLE[l.id].dash}
                />
              </svg>
              {l.label}
            </li>
          ))}
      </ul>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Usable cash by quarter end: ${lines.map((l) => l.label).join(", ")}. Cutoff ${longDate(cutoff)}.`}
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
        {quarterLabels.map((q) => (
          <g key={q.date} transform={`translate(${x(utc(q.date))},${height - m.bottom + 18})`}>
            <text textAnchor="middle" fontSize={12} fill={INK}>
              {q.label}
            </text>
            <text y={16} textAnchor="middle" fontSize={12} fill={MUTED}>
              {longDate(q.date)}
            </text>
          </g>
        ))}
        <line
          x1={cx}
          x2={cx}
          y1={m.top - 8}
          y2={height - m.bottom}
          stroke={MUTED}
          strokeDasharray="2 3"
        />
        <text x={cx} y={m.top - 14} textAnchor="middle" fontSize={12} fill={INK}>
          Cutoff {longDate(cutoff)}
        </text>
        {sorted.map((l) => {
          const s = STYLE[l.id];
          return (
            <g key={l.id} data-line={l.id}>
              <path
                d={path(l.points)}
                fill="none"
                stroke={s.color}
                strokeWidth={l.id === "counterfactual" ? 7 : s.width}
                strokeOpacity={l.id === "counterfactual" ? 0.35 : 1}
                strokeDasharray={s.dash}
                strokeLinecap="round"
              />
              {l.points.map((p) => (
                <circle
                  key={`${l.id}-${p.date}`}
                  cx={px(p)}
                  cy={py(p)}
                  r={4}
                  fill={p.reported ? s.color : CARD}
                  stroke={s.color}
                  strokeWidth={2}
                />
              ))}
            </g>
          );
        })}
        {ends.map(({ line, end }) => (
          <text
            key={`end-${line.id}`}
            x={px(end!) + 10}
            y={labelY.get(line.id)}
            dy="0.32em"
            fontSize={12}
            fill={STYLE[line.id].color}
            className="tabular-nums"
          >
            {line.id === "forecast"
              ? "Forecast"
              : line.id === "actual"
                ? "Actual"
                : "Counterfactual"}{" "}
            {formatCents(end!.cents)}
          </text>
        ))}
      </svg>
      <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
        Quarterly granularity: 2U reports cash once a quarter, so filled points are reported
        quarter-end balances. The cutoff point is a modeled estimate, and lines between points are
        straight joins, not daily data. Usable cash excludes restricted cash.
      </p>
    </div>
  );
}
