"use client";

import type { Cents, ISODate } from "@domino/contracts";
import { scaleLinear, scaleUtc } from "d3-scale";
import { motion, useReducedMotion } from "motion/react";
import { useId } from "react";
import { formatCents } from "../../lib/format";
import { formatReportDate } from "./format";
import type { CashPoint, HistoricalView } from "./types";

const W = 720;
const H = 320;
const M = { left: 64, right: 24, top: 44, bottom: 44 };

type Kind = "reported" | "nowcast" | "projected" | "observed" | "alternative";

const kindLabel: Record<Kind, string> = {
  reported: "Reported",
  nowcast: "Modeled estimate at cutoff",
  projected: "Saved forecast",
  observed: "Reported after forecast",
  alternative: "Alternative (projected)",
};

const utc = (iso: ISODate) => new Date(`${iso}T00:00:00.000Z`);

export interface ChartPoint extends CashPoint {
  kind: Kind;
}

export function chartPoints(view: HistoricalView): ChartPoint[] {
  const tag = (points: CashPoint[], kind: Kind): ChartPoint[] =>
    points.map((point) => ({ ...point, kind }));
  return [
    ...tag(view.reported, "reported"),
    ...tag(view.nowcast ? [view.nowcast] : [], "nowcast"),
    ...tag(view.projected, "projected"),
    ...tag(view.observed, "observed"),
    ...tag(view.alternative?.path ?? [], "alternative"),
  ];
}

/** Saved forecast and alternative share the supplied cutoff estimate, so they cannot diverge
 * before the decision date. Without one the alternative is drawn from its own first point:
 * the UI never invents a starting value. */
export function forecastPaths(view: HistoricalView): {
  projected: CashPoint[];
  alternative: CashPoint[];
} {
  const origin = view.reported.at(-1);
  const anchor = view.nowcast;
  const alt = view.alternative?.path ?? [];
  return {
    projected: [...(origin ? [origin] : []), ...(anchor ? [anchor] : []), ...view.projected],
    alternative: alt.length ? [...(anchor ? [anchor] : []), ...alt] : [],
  };
}

export function HistoricalChart({
  view,
  selectedId,
  onSelect,
}: { view: HistoricalView; selectedId?: string; onSelect: (id: string) => void }) {
  const reduced = useReducedMotion();
  const points = chartPoints(view);
  const { dates, threshold } = view;
  const marks = [dates.knowledgeCutoff, dates.revealedOn].filter((d): d is ISODate => Boolean(d));
  const allDates = [...points.map((p) => p.date), ...marks].map(utc);
  const values = [...points.flatMap((p) => [p.cash, p.low, p.high]), threshold?.cents, 0].filter(
    (v): v is Cents => v !== undefined,
  );
  const x = scaleUtc()
    .domain([
      new Date(Math.min(...allDates.map(Number))),
      new Date(Math.max(...allDates.map(Number))),
    ])
    .range([M.left, W - M.right]);
  const y = scaleLinear()
    .domain([Math.min(...values.map(Number)), Math.max(...values.map(Number))])
    .nice()
    .range([H - M.bottom, M.top]);
  const px = (p: CashPoint) => x(utc(p.date));
  const py = (p: CashPoint) => y(p.cash);
  const line = (list: CashPoint[]) =>
    list.map((p, i) => `${i ? "L" : "M"}${px(p).toFixed(1)} ${py(p).toFixed(1)}`).join(" ");
  const { projected: projectedPath, alternative: altPath } = forecastPaths(view);
  // Assumption ranges of the saved forecast and of an alternative, if the backend supplied them.
  const ranged = points.filter(
    (p) => (p.kind === "projected" || p.kind === "alternative") && p.low !== undefined,
  );
  const tickDates = [...new Set(points.map((p) => p.date))].sort();
  // A clip wipes the saved forecast in. pathLength would overwrite strokeDasharray with its own
  // values and draw the forecast solid, hiding the dashed "projected" meaning.
  const clipId = `forecast-reveal-${useId().replace(/:/g, "")}`;
  const sweep = reduced
    ? {}
    : { initial: { width: 0 }, animate: { width: W }, transition: { duration: 0.6 } };
  const fade = reduced
    ? {}
    : { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.3 } };

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto min-w-[560px] w-full"
        // biome-ignore lint/a11y/useSemanticElements: an SVG cannot be a fieldset
        role="group"
        aria-label={`Cash for ${view.caseName} by report date. Points are reported or projected values; nothing is drawn between report dates except forecast paths.`}
      >
        {y.ticks(4).map((t) => (
          <g key={t}>
            <line
              x1={M.left}
              x2={W - M.right}
              y1={y(t)}
              y2={y(t)}
              stroke="hsl(var(--border))"
              strokeWidth={0.5}
            />
            <text
              x={M.left - 8}
              y={y(t)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted-foreground text-[11px]"
            >
              {formatCents(Math.round(t) as Cents)}
            </text>
          </g>
        ))}
        {threshold ? (
          <g>
            <line
              x1={M.left}
              x2={W - M.right}
              y1={y(threshold.cents)}
              y2={y(threshold.cents)}
              stroke="hsl(var(--destructive))"
              strokeDasharray="2 4"
            />
            <text
              x={W - M.right}
              y={y(threshold.cents) - 6}
              textAnchor="end"
              className="text-[11px]"
              fill="hsl(var(--destructive))"
            >
              {threshold.label}
            </text>
          </g>
        ) : null}
        {[
          { date: dates.knowledgeCutoff, label: "Knowledge cutoff" },
          ...(dates.revealedOn ? [{ date: dates.revealedOn, label: "Disclosure published" }] : []),
        ].map((mark, row) => (
          <g key={mark.label}>
            <line
              x1={x(utc(mark.date))}
              x2={x(utc(mark.date))}
              y1={M.top - 24 + row * 14}
              y2={H - M.bottom}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="4 3"
            />
            <text
              x={x(utc(mark.date)) + 4}
              y={M.top - 28 + row * 14}
              className="fill-muted-foreground text-[10px]"
            >
              {mark.label}
            </text>
          </g>
        ))}
        {ranged.length
          ? ranged.map((p) =>
              p.low !== undefined && p.high !== undefined ? (
                <line
                  key={`range-${p.kind}-${p.id}`}
                  x1={px(p)}
                  x2={px(p)}
                  y1={y(p.low)}
                  y2={y(p.high)}
                  stroke={p.kind === "alternative" ? "hsl(var(--clay))" : "hsl(var(--primary-ink))"}
                  strokeOpacity={0.45}
                  strokeWidth={6}
                  strokeLinecap="round"
                >
                  <title>{`Assumption range ${formatCents(p.low)} to ${formatCents(p.high)}, not a probability`}</title>
                </line>
              ) : null,
            )
          : null}
        {altPath.length > 1 ? (
          <motion.path
            d={line(altPath)}
            fill="none"
            stroke="hsl(var(--clay))"
            strokeWidth={2}
            strokeDasharray="6 4"
            {...fade}
          />
        ) : null}
        {projectedPath.length > 1 ? (
          <>
            <clipPath id={clipId}>
              <motion.rect x={0} y={0} width={W} height={H} {...sweep} />
            </clipPath>
            <path
              d={line(projectedPath)}
              fill="none"
              stroke="hsl(var(--primary-ink))"
              strokeWidth={2}
              strokeDasharray="6 4"
              clipPath={`url(#${clipId})`}
            />
          </>
        ) : null}
        {tickDates.map((d) => (
          <text
            key={d}
            x={x(utc(d))}
            y={H - M.bottom + 18}
            textAnchor="middle"
            className="fill-muted-foreground text-[11px]"
          >
            {formatReportDate(d)}
          </text>
        ))}
        {points.map((p) => {
          const selected = p.id === selectedId;
          const label = `${kindLabel[p.kind]}, ${formatReportDate(p.date)}: ${formatCents(p.cash)}`;
          const projected = p.kind === "projected" || p.kind === "alternative";
          const modeled = p.kind === "nowcast";
          const colour = p.kind === "alternative" ? "hsl(var(--clay))" : "hsl(var(--primary-ink))";
          return (
            <motion.g
              key={`${p.kind}-${p.id}`}
              // biome-ignore lint/a11y/useSemanticElements: a button cannot live inside SVG
              role="button"
              tabIndex={0}
              aria-label={label}
              aria-pressed={selected}
              className="cursor-pointer outline-none [&:focus-visible>.ring]:opacity-100"
              onClick={() => onSelect(p.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(p.id);
                }
              }}
              {...(p.kind === "reported" ? {} : fade)}
            >
              <title>{label}</title>
              <circle
                className="ring opacity-0"
                cx={px(p)}
                cy={py(p)}
                r={11}
                fill="none"
                stroke="hsl(var(--ring))"
                strokeWidth={2}
              />
              {selected ? (
                <circle cx={px(p)} cy={py(p)} r={9} fill="none" stroke={colour} strokeWidth={1.5} />
              ) : null}
              {/* Hollow = projected, filled = reported. Shape also differs, so colour is not alone. */}
              {modeled ? (
                <circle
                  cx={px(p)}
                  cy={py(p)}
                  r={5}
                  fill="hsl(var(--card))"
                  stroke={colour}
                  strokeWidth={2}
                  strokeDasharray="2 2"
                />
              ) : projected ? (
                <rect
                  x={px(p) - 5}
                  y={py(p) - 5}
                  width={10}
                  height={10}
                  transform={`rotate(45 ${px(p)} ${py(p)})`}
                  fill="hsl(var(--card))"
                  stroke={colour}
                  strokeWidth={2}
                />
              ) : (
                <circle cx={px(p)} cy={py(p)} r={5} fill={colour} />
              )}
              <circle cx={px(p)} cy={py(p)} r={14} fill="transparent" />
            </motion.g>
          );
        })}
      </svg>
    </div>
  );
}
