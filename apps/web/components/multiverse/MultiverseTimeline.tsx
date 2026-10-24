"use client";

import type {
  Cents,
  HistoryWeek,
  ISODate,
  Id,
  PastEvent,
  ResilienceReport,
} from "@domino/contracts";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatCents, formatDate } from "../../lib/format";
import { Button } from "../ui/button";
import { TimelineCrosshair } from "./TimelineCrosshair";
import { TimelineParticles } from "./TimelineParticles";
import { futureKey, timelineGeometry, timestamp } from "./geometry";
import {
  inspectionCash,
  inspectionDate,
  inspectionPoints,
  nearestInspectionIndex,
} from "./inspection";
import type { ParticleTrack } from "./particles";

export interface MultiverseTimelineProps {
  history: HistoryWeek[];
  pastEvents: PastEvent[];
  today: ISODate;
  report: ResilienceReport;
  comparisonReport?: ResilienceReport;
  limit: Cents;
  selectedUniverseId?: Id;
  onSelectUniverse: (id: Id) => void;
  showFixes: boolean;
}

export function MultiverseTimeline({
  history,
  pastEvents,
  today,
  report,
  comparisonReport,
  limit,
  selectedUniverseId,
  onSelectUniverse,
  showFixes,
}: MultiverseTimelineProps) {
  const container = useRef<HTMLDivElement>(null);
  const chartViewport = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(1000);
  const [hovered, setHovered] = useState<string>();
  const [eventId, setEventId] = useState<string>();
  const [inspectedDate, setInspectedDate] = useState<ISODate>();
  const [pointerInPlot, setPointerInPlot] = useState(false);
  const reduced = useReducedMotion();
  const [ready, setReady] = useState(false);
  const [motionEnabled, setMotionEnabled] = useState(true);
  const id = useId().replace(/:/g, "");
  useEffect(() => {
    setReady(true);
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(860, Math.round(entry.contentRect.width)));
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const graph = useMemo(
    () => timelineGeometry(history, today, report, comparisonReport, limit, width),
    [history, today, report, comparisonReport, limit, width],
  );
  const particleTracks = useMemo<ParticleTrack[]>(
    () => [
      {
        key: "history",
        path: graph.pastPath,
        history: true,
        probability: 0.28,
        withinLimits: true,
      },
      ...report.universes.map((future) => ({
        key: futureKey(future),
        path: graph.path(graph.points(future)) ?? "",
        probability: future.probability,
        withinLimits: future.survives,
        breakX: future.breaksAt ? graph.x(timestamp(future.breaksAt)) : undefined,
      })),
    ],
    [graph, report],
  );
  const selected = report.universes.find((future) => future.id === selectedUniverseId);
  const activeParticleTrack = report.universes.find((future) => future.id === hovered) ?? selected;
  const focused = report.universes.find((future) => future.id === hovered) ?? selected;
  const inspectionFuture =
    selected ?? report.universes.find((future) => !future.riskIds.length) ?? report.universes[0];
  const inspectable = useMemo(
    () => inspectionPoints(history, inspectionFuture),
    [history, inspectionFuture],
  );
  const inspectedIndex = nearestInspectionIndex(inspectable, timestamp(inspectedDate ?? today));
  const inspected = inspectedDate ? inspectable[inspectedIndex] : undefined;
  const crosshair = pointerInPlot ? inspected : undefined;
  function inspectWeek(index: number) {
    const point = inspectable[index];
    setInspectedDate(point?.date);
    const viewport = chartViewport.current;
    if (!point || !viewport) return;
    const x = graph.x(timestamp(point.date));
    if (x < viewport.scrollLeft + 24 || x > viewport.scrollLeft + viewport.clientWidth - 24) {
      viewport.scrollTo({ left: Math.max(0, x - viewport.clientWidth / 2), behavior: "auto" });
    }
  }
  const pastEvent = pastEvents.find((event) => event.id === eventId);
  const months = [
    ...new Map(
      [...graph.past, ...(report.universes[0] ? graph.points(report.universes[0]) : [])].map(
        (point) => [point.date.slice(0, 7), point.date],
      ),
    ).values(),
  ];
  const duration = reduced ? 0 : 0.6;
  return (
    <div ref={container} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="font-medium">Cash you can use</p>
        <div className="flex min-h-9 flex-wrap items-center gap-5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <span className="h-px w-5 bg-clay" />
            Recorded
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-px w-5 bg-primary" />
            Forecast scenarios
          </span>
          {ready && reduced !== true ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-9 text-xs text-muted-foreground"
              onClick={() => setMotionEnabled((enabled) => !enabled)}
            >
              {motionEnabled ? "Pause motion" : "Resume motion"}
            </Button>
          ) : null}
        </div>
      </div>
      <section
        ref={chartViewport}
        className="relative overflow-x-auto rounded-lg bg-background/40"
        aria-label="Cash timeline. Scroll horizontally on smaller screens."
      >
        {ready && reduced === false ? (
          <TimelineParticles
            tracks={particleTracks}
            width={width}
            height={graph.height}
            activeKey={activeParticleTrack ? futureKey(activeParticleTrack) : undefined}
            enabled={motionEnabled}
          />
        ) : null}
        <svg
          width={width}
          height={graph.height}
          viewBox={`0 0 ${width} ${graph.height}`}
          className="block cursor-crosshair"
          role="img"
          aria-labelledby={`${id}-title ${id}-desc`}
          onPointerMove={(event) => {
            // Touch uses the range control so horizontal chart scrolling stays available.
            if (event.pointerType === "touch") {
              setPointerInPlot(false);
              return;
            }
            const bounds = event.currentTarget.getBoundingClientRect();
            const x = ((event.clientX - bounds.left) / bounds.width) * width;
            const y = ((event.clientY - bounds.top) / bounds.height) * graph.height;
            const inside =
              x >= graph.left && x <= graph.right && y >= graph.top && y <= graph.bottom;
            setPointerInPlot(inside);
            if (!inside) return;
            const index = nearestInspectionIndex(inspectable, x, (date) =>
              graph.x(timestamp(date)),
            );
            setInspectedDate(inspectable[index]?.date);
          }}
          onPointerLeave={() => setPointerInPlot(false)}
        >
          <title id={`${id}-title`}>
            {`Recorded cash and ${report.universes.length} forecast scenarios`}
          </title>
          <desc id={`${id}-desc`}>
            Recorded cash is left of Today. Forecast scenarios are on the right. The dashed line
            shows the lender’s limit. Crosses mark the first unmet requirement; checks mean all
            requirements are met. Use the menu below to select a scenario. Move over the chart or
            use Inspect week below to read exact weekly cash values.
          </desc>
          <text x={graph.left} y={22} className="fill-muted-foreground text-[11px] tracking-widest">
            HISTORY · {history.length} WEEKS
          </text>
          <text
            x={graph.todayX + 18}
            y={22}
            className="fill-muted-foreground text-[11px] tracking-widest"
          >
            FORECAST · 13 WEEKS
          </text>
          {graph.ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={graph.left}
                x2={graph.right}
                y1={graph.y(tick)}
                y2={graph.y(tick)}
                className="stroke-border/45"
              />
              <text
                x={graph.left - 12}
                y={graph.y(tick) + 4}
                textAnchor="end"
                className="fill-muted-foreground text-[11px]"
              >
                {formatCents(Math.round(tick))}
              </text>
            </g>
          ))}
          <path d={graph.pastArea} className="fill-clay/5" />
          <motion.path
            d={graph.pastPath}
            fill="none"
            className="stroke-clay"
            strokeWidth={2}
            initial={reduced ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: reduced ? 0 : 0.8 }}
          />
          <line
            x1={graph.todayX}
            x2={graph.todayX}
            y1={32}
            y2={graph.bottom}
            className="stroke-muted-foreground/60"
            strokeDasharray="3 5"
          />
          <text
            x={graph.todayX}
            y={graph.bottom + 37}
            textAnchor="middle"
            className="fill-foreground text-[11px]"
          >
            Today · {formatDate(today)}
          </text>
          <line
            x1={graph.todayX}
            x2={graph.right + 90}
            y1={graph.y(limit)}
            y2={graph.y(limit)}
            className="stroke-destructive"
            strokeDasharray="6 5"
          />
          <text
            x={graph.right + 10}
            y={graph.y(limit) - 8}
            className="fill-[hsl(var(--danger-text))] text-[11px]"
          >
            Lender’s limit
          </text>
          <text
            x={graph.right + 10}
            y={graph.y(limit) + 9}
            className="fill-muted-foreground text-[11px]"
          >
            {formatCents(limit)}
          </text>
          {report.universes.map((future, index) => {
            const key = futureKey(future);
            const points = graph.points(future);
            const d = graph.path(points) ?? "";
            const isSelected = future.id === selectedUniverseId;
            const opacity = selected
              ? isSelected
                ? 1
                : 0.15
              : hovered === future.id
                ? 1
                : key === "base"
                  ? 1
                  : 0.25 + future.probability * 0.65;
            const breakWeek = future.forecast.weeks.find(
              (week) => week.weekStart === future.breaksAt,
            );
            const endpoint = breakWeek
              ? { date: breakWeek.weekStart, usable: breakWeek.usable }
              : (points.at(-1) ?? graph.origin);
            const breakX = future.breaksAt ? graph.x(timestamp(future.breaksAt)) : graph.right + 1;
            return (
              <g key={key}>
                <defs>
                  <clipPath id={`${id}-break-${index}`}>
                    <motion.rect
                      x={breakX}
                      width={Math.max(0, graph.right - breakX + 1)}
                      animate={{ x: breakX, width: Math.max(0, graph.right - breakX + 1) }}
                      transition={{ duration }}
                      y={0}
                      height={graph.height}
                    />
                  </clipPath>
                </defs>
                <motion.path
                  d={d}
                  opacity={opacity}
                  fill="none"
                  initial={reduced ? false : { pathLength: 0 }}
                  animate={{ d, pathLength: 1, opacity }}
                  transition={{
                    d: { duration },
                    opacity: { duration: 0.15 },
                    pathLength: {
                      duration: reduced ? 0 : 0.6,
                      delay: reduced ? 0 : 0.8 + index * 0.04,
                    },
                  }}
                  stroke={
                    isSelected
                      ? "hsl(var(--primary))"
                      : key === "base"
                        ? "hsl(var(--foreground))"
                        : future.survives
                          ? "hsl(var(--safe))"
                          : "hsl(var(--muted-foreground))"
                  }
                  strokeWidth={isSelected ? 3 : key === "base" ? 2 : 1.25}
                />
                {!isSelected ? (
                  <motion.path
                    d={d}
                    opacity={opacity}
                    initial={reduced ? false : { pathLength: 0 }}
                    animate={{ d, opacity, pathLength: 1 }}
                    transition={{
                      d: { duration },
                      opacity: { duration: 0.15 },
                      pathLength: { duration, delay: reduced ? 0 : 0.8 + index * 0.04 },
                    }}
                    fill="none"
                    className="stroke-destructive"
                    strokeWidth={1.5}
                    clipPath={`url(#${id}-break-${index})`}
                  />
                ) : null}
                <motion.g
                  style={{
                    x: graph.x(timestamp(endpoint.date)),
                    y: graph.y(endpoint.usable),
                    opacity,
                  }}
                  animate={{
                    x: graph.x(timestamp(endpoint.date)),
                    y: graph.y(endpoint.usable),
                    opacity,
                  }}
                  transition={{ duration }}
                  className={
                    isSelected
                      ? "stroke-primary"
                      : future.survives
                        ? "stroke-safe"
                        : "stroke-destructive"
                  }
                  fill="none"
                  strokeWidth={1.6}
                >
                  {future.survives ? (
                    <path d="M-3 0L-0.5 3L4-3" />
                  ) : (
                    <path d="M-3-3L3 3M-3 3L3-3" />
                  )}
                </motion.g>
                <motion.path
                  d={d}
                  animate={{ d }}
                  transition={{ duration }}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14}
                  className="cursor-pointer"
                  onPointerEnter={() => {
                    setHovered(future.id);
                    setEventId(undefined);
                  }}
                  onPointerLeave={() => setHovered(undefined)}
                  onPointerDown={() => onSelectUniverse(future.id)}
                >
                  <title>
                    {`${future.label}: ${Math.round(future.probability * 100)}% chance. Low point ${formatCents(future.forecast.lowPoint.usable)} on ${formatDate(future.forecast.lowPoint.weekStart)}.`}
                  </title>
                </motion.path>
                {isSelected && !crosshair ? (
                  <text
                    x={graph.right + 10}
                    y={graph.y(points.at(-1)?.usable ?? graph.origin.usable) - 10}
                    className="fill-primary text-[11px]"
                  >
                    Selected scenario
                  </text>
                ) : null}
              </g>
            );
          })}
          {pastEvents.map((event) => {
            const week = history.reduce<HistoryWeek | undefined>(
              (closest, item) =>
                !closest ||
                Math.abs(timestamp(item.weekStart) - timestamp(event.date)) <
                  Math.abs(timestamp(closest.weekStart) - timestamp(event.date))
                  ? item
                  : closest,
              undefined,
            );
            if (!week) return null;
            return (
              <g
                key={event.id}
                onPointerEnter={() => setEventId(event.id)}
                onPointerLeave={() => setEventId(undefined)}
              >
                <circle
                  cx={graph.x(timestamp(event.date))}
                  cy={graph.y(week.usable)}
                  r={4}
                  className={
                    event.kind === "big_deal"
                      ? "fill-background stroke-safe"
                      : "fill-background stroke-destructive"
                  }
                  strokeWidth={1.5}
                />
                <circle
                  cx={graph.x(timestamp(event.date))}
                  cy={graph.y(week.usable)}
                  r={12}
                  fill="transparent"
                >
                  <title>{`${event.label} · ${formatDate(event.date)}`}</title>
                </circle>
              </g>
            );
          })}
          {months
            .filter((_, index) => index % 2 === 0)
            .map((date) => (
              <text
                key={date}
                x={graph.x(timestamp(date))}
                y={graph.bottom + 20}
                textAnchor="middle"
                className="fill-muted-foreground text-[11px]"
                opacity={
                  crosshair &&
                  Math.abs(graph.x(timestamp(date)) - graph.x(timestamp(crosshair.date))) < 130
                    ? 0
                    : 1
                }
              >
                {new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(
                  new Date(`${date}T00:00:00Z`),
                )}
              </text>
            ))}
          {crosshair ? <TimelineCrosshair point={crosshair} graph={graph} /> : null}
        </svg>
      </section>
      <div className="flex flex-col gap-3 rounded-lg bg-background/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <output
          id={`${id}-inspection`}
          className="min-w-0 text-sm"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="block truncate text-xs text-muted-foreground">
            {inspected?.label ?? "Move over the chart or choose a week."}
          </span>
          <span className="mt-1 block min-h-5 tabular-nums">
            {inspected
              ? `Week of ${inspectionDate(inspected.date)} · ${inspectionCash(inspected.usable)}`
              : "Exact weekly cash values"}
          </span>
        </output>
        <label className="flex min-h-11 shrink-0 items-center gap-3 text-xs text-muted-foreground">
          Inspect week
          <input
            type="range"
            min={0}
            max={Math.max(0, inspectable.length - 1)}
            step={1}
            disabled={!inspectable.length}
            aria-controls={`${id}-inspection`}
            value={Math.max(0, inspectedIndex)}
            aria-valuetext={
              inspectable[inspectedIndex]
                ? `Week of ${inspectionDate(inspectable[inspectedIndex].date)}, ${inspectionCash(inspectable[inspectedIndex].usable)}, ${inspectable[inspectedIndex].label}`
                : "No weekly data"
            }
            className="h-11 w-40 cursor-pointer accent-primary"
            onFocus={() => inspectWeek(inspectedIndex)}
            onChange={(event) => inspectWeek(Number(event.target.value))}
          />
        </label>
      </div>
      <div className="flex flex-col justify-between gap-4 rounded-lg bg-background/40 p-4 sm:flex-row sm:items-start">
        <div className="min-h-12 max-w-xl text-sm" aria-live="polite">
          {pastEvent ? (
            <>
              <p className="font-medium">{pastEvent.label}</p>
              <p className="mt-1 text-muted-foreground">
                {formatDate(pastEvent.date)} · {pastEvent.evidence[0]?.note}
              </p>
            </>
          ) : focused ? (
            <>
              <p className="font-medium">{focused.label}</p>
              <p className="mt-1 text-muted-foreground">
                {Math.round(focused.probability * 100)}% chance · Low point{" "}
                {formatCents(focused.forecast.lowPoint.usable)} on{" "}
                {formatDate(focused.forecast.lowPoint.weekStart)} ·{" "}
                {focused.survives
                  ? "Within limits"
                  : `Outside limits from ${formatDate(focused.breaksAt ?? focused.forecast.lowPoint.weekStart)}`}
              </p>
            </>
          ) : (
            <>
              <p className="font-medium">Review a cash scenario</p>
              <p className="mt-1 text-muted-foreground">
                Select a line or use the menu to review its cash forecast.
              </p>
            </>
          )}
        </div>
        <label className="flex shrink-0 flex-col gap-2 text-xs text-muted-foreground">
          Select a scenario
          <select
            className="min-h-11 max-w-64 rounded-md border bg-card px-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            value={selectedUniverseId ?? ""}
            onChange={(event) => onSelectUniverse(event.target.value)}
          >
            <option value="" disabled>
              Select a scenario
            </option>
            {report.universes.map((future) => (
              <option key={futureKey(future)} value={future.id}>
                {future.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        {showFixes
          ? "Showing the forecast with proposed fixes in each scenario. Approvals are recorded separately."
          : "Checks show scenarios within limits. Crosses mark the first unmet requirement."}
      </p>
      {ready && reduced === false ? (
        <p className="text-xs text-muted-foreground">More likely scenarios emit more particles.</p>
      ) : null}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          View {pastEvents.length} recorded events
        </summary>
        <ul className="mt-3 space-y-2">
          {pastEvents.map((event) => (
            <li key={event.id}>
              <button
                type="button"
                onFocus={() => setEventId(event.id)}
                onBlur={() => setEventId(undefined)}
                onClick={() => setEventId(event.id)}
                className="min-h-11 rounded px-2 text-left hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              >
                {formatDate(event.date)} · {event.label}
              </button>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
