"use client";

import type { Forecast, HistoryWeek, ScheduledItem } from "@domino/contracts";
import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { motion, useReducedMotion } from "motion/react";
import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { formatCents } from "../../../lib/format";
import { formatExactCents, formatFullDate } from "../baseline/format";
import { placeChartAnnotations } from "./chartAnnotations";
import { type FocusCurve, type FocusPoint, nearestCurveAt, pointOnCurve } from "./chartFocus";
import { cashScale, formatAxisCash, panWeekWindow, visibleDateTicks } from "./chartScales";

export type ChartProps = {
  /** Fill the workspace plot area while keeping labels at their native size. */
  fill?: boolean;
  history: HistoryWeek[];
  forecast: Forecast;
  /** Parent node's saved forecast, drawn faintly for comparison. */
  parent?: Forecast | null;
  /** Name of the main forecast line in the legend and tooltip. */
  forecastLabel?: string;
  /** Identity of the main line and preferred open scenario for the initial focus dot. */
  forecastRunId?: string;
  initialFocusRunId?: string;
  onReveal?: (runId: string) => void;
  comparisons?: {
    runId: string;
    /** Draw this newly accepted saved curve once on arrival. */
    reveal?: boolean;
    label: string;
    href: string;
    forecast: Forecast;
    parent?: boolean;
    /** Solid line in this color; without one the line is a gray dash. */
    color?: string;
    /**
     * Forecast week the line starts from (its fork); -1 forks from the last recorded week, which
     * every line shares; null when it never leaves its anchor.
     */
    fromIndex?: number | null;
    /** The anchor's cash in the first changed week. The line leaves the anchor there. */
    forkCents?: number | null;
    /** First date the scenario's own changes act, shown in the legend. */
    startsOn?: string | null;
    /** Plain note for the focus line, e.g. why a timing-only line rejoins its parent. */
    note?: string | null;
    /** This scenario's own saved breach notes, marked on its line. */
    breaches?: { weekStart: string; text: string; short?: string }[];
    /** Scenarios this one builds on, so hovering it in the key lights up its whole path. */
    ancestors?: string[];
  }[];
  /** A scenario and the ones it builds on, drawn in front while it is hovered elsewhere. */
  highlightRunIds?: string[] | null;
  items: ScheduledItem[];
  /** Saved minimum-cash limits, drawn as dashed lines. */
  limits: { id: string; label: string; cents: number }[];
  /** Only saved rule receipts may mark a week as breached. */
  breachedWeeks?: string[];
  /** Saved receipt text for the first breach of a rule, e.g. "Below Lender's minimum, short $1.00". */
  breachNotes?: { weekStart: string; text: string; short?: string }[];
  selectedWeek: string | null;
  onSelectWeek: (weekStart: string) => void;
  /**
   * Where a proposal under review would branch: flashed on the parent's line. `forecast` is the
   * parent's line (without it the main line is the parent); `drawLine: false` when that line is
   * already drawn, so the marker still sits on it without drawing it twice.
   */
  branchPreview?: {
    key: string;
    date: string;
    color: string;
    label: string;
    forecast?: Forecast;
    drawLine?: boolean;
  };
};

const DEFAULT_W = 880;
const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Phones open on the last two months of history so the forecast gets most of the width. */
const RECENT_WEEKS = 8;
/** The narrowest window the range bar allows, in weeks. */
const MIN_SPAN = 4;
const DASHES = ["6 4", "2 4", "10 3 2 3"] as const;
/** The chart key sits in the top-left corner, above the plot, so it covers no lines while closed. */
const KEY_SPOT = { left: 4, top: 2 };

type Point = FocusPoint;

/** Measures the drawing width so text stays at its real size on phones and wide screens. */
function usePlotSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: DEFAULT_W, height: 340 });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () =>
      setSize({
        width: Math.max(200, Math.round(el.clientWidth)),
        height: Math.round(el.clientHeight),
      });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

/** Retain this mount's draw state when its arrival signal is consumed by the workspace. */
function ScenarioStroke({
  d,
  color,
  dash,
  lit = false,
  reveal,
  onReveal,
}: {
  d: string;
  color?: string;
  dash?: string;
  lit?: boolean;
  reveal: boolean;
  onReveal: () => void;
}) {
  const reduced = useReducedMotion();
  const [drawIn] = useState(reveal && !reduced);
  useEffect(() => {
    if (reveal) onReveal();
  }, [reveal, onReveal]);
  const props = {
    d,
    fill: "none",
    className: color ? undefined : "stroke-muted-foreground opacity-80",
    stroke: color,
    strokeWidth: (color ? 2.25 : 1.5) + (lit ? 1 : 0),
    strokeLinejoin: "round" as const,
    strokeLinecap: "round" as const,
    strokeDasharray: dash,
  };
  return drawIn ? (
    <motion.path
      {...props}
      initial={{ pathLength: 0 }}
      animate={{ pathLength: 1 }}
      transition={{ duration: reduced ? 0 : 0.9, ease: "easeOut" }}
      data-testid="forecast-reveal"
    />
  ) : (
    <path {...props} />
  );
}

/** Rules can leave cash unchanged: briefly trace their saved path without inventing a fork. */
function SameForecastReveal({
  d,
  color,
  reveal,
  onReveal,
}: { d: string; color?: string; reveal: boolean; onReveal: () => void }) {
  const reduced = useReducedMotion();
  const [drawIn] = useState(reveal && !reduced);
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    if (reveal) onReveal();
  }, [reveal, onReveal]);
  return drawIn && !finished ? (
    <motion.path
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={4}
      strokeLinecap="round"
      initial={{ pathLength: 0, opacity: 0.9 }}
      animate={{ pathLength: 1, opacity: 0.9 }}
      transition={{ duration: reduced ? 0 : 0.9, ease: "easeOut" }}
      onAnimationComplete={() => setFinished(true)}
      data-testid="forecast-same-path-reveal"
    />
  ) : null;
}

/**
 * Recorded history on the left, the saved 13-week forecast on the right. Positions are drawing
 * geometry only; every value shown in text comes straight from the saved record.
 */
export function WorkspaceChart(p: ChartProps) {
  const titleId = useId();
  const clipId = `${titleId.replace(/:/g, "")}-plot`;
  const [wrapRef, plotSize] = usePlotSize();
  const legendRef = useRef<HTMLElement>(null);
  const [legendSize, setLegendSize] = useState({ width: 180, height: 60 });
  useEffect(() => {
    const element = legendRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const update = () =>
      setLegendSize({ width: element.offsetWidth, height: element.offsetHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const W = plotSize.width;
  const compact = W < 560;
  const H = p.fill ? Math.max(180, plotSize.height) : compact ? 280 : 340;
  const PAD = { right: compact ? 12 : 20, top: 30, bottom: 52 };
  const [focus, setFocus] = useState<{
    runId: string;
    slot: number;
    weekStart: string | null;
  } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [keyHover, setKeyHover] = useState<string | null>(null);
  const reduced = useReducedMotion();
  const [chosenView, setView] = useState<[number, number] | null>(null);
  const [cashView, setCashView] = useState<[number, number] | null>(null);
  const history = p.history;
  const weeks = p.forecast.weeks;
  const comparisons = (p.comparisons ?? []).slice(0, 6);
  const mainLabel = p.forecastLabel ?? "This scenario";
  const slots = history.length + weeks.length;
  const off = history.length;
  const lastSlot = Math.max(slots - 1, 1);
  // The visible window, in slots (recorded weeks then forecast weeks), set by the range bar.
  const [viewStart, viewEnd] = chosenView ?? [
    compact ? Math.max(0, off - RECENT_WEEKS) : 0,
    lastSlot,
  ];
  const visible = (slot: number) => slot >= viewStart && slot <= viewEnd;
  const forecastIn = (series: { usable: number }[]) =>
    series.filter((_, i) => visible(off + i)).map((w) => w.usable);
  const values = [
    // The cash axis fits only the weeks in view, so zooming in also zooms the cash scale.
    ...history.filter((_, i) => visible(i)).map((h) => h.usable),
    ...forecastIn(weeks),
    ...(!p.comparisons ? forecastIn(p.parent?.weeks ?? []) : []),
    ...comparisons.flatMap((entry) => forecastIn(entry.forecast.weeks)),
    ...p.limits.map((l) => l.cents),
  ];
  // Everything the cash scroller can reach: every saved week of every line, the limits and $0.
  const reach = [
    0,
    ...history.map((h) => h.usable),
    ...weeks.map((w) => w.usable),
    ...(p.parent?.weeks.map((w) => w.usable) ?? []),
    ...comparisons.flatMap((entry) => entry.forecast.weeks.map((week) => week.usable)),
    ...p.limits.map((l) => l.cents),
  ].filter(Number.isSafeInteger);
  const reachLo = Math.min(...reach);
  const reachHi = Math.max(...reach);
  const reachPad = Math.max(1, Math.round((reachHi - reachLo) * 0.05));
  const cashExtent: [number, number] = [
    reachLo < 0 ? reachLo - reachPad : reachLo,
    reachHi + reachPad,
  ];
  // Without a chosen range the cash axis fits the lines in view.
  const { scale: y, ticks: cashTicks } = cashScale(
    cashView ?? values,
    [H - PAD.bottom, PAD.top],
    compact ? 4 : 6,
  );
  const [domainLo, domainHi] = y.domain() as [number, number];
  // Room for the rotated "Usable cash" title plus the widest tick label.
  const left =
    18 + Math.max(44, ...cashTicks.map((value) => formatAxisCash(value).length * 6.5 + 14));
  const dates = [...history.map((week) => week.weekStart), ...weeks.map((week) => week.weekStart)];
  const timeTicks = visibleDateTicks(
    dates,
    viewStart,
    viewEnd,
    Math.min(9, Math.max(2, Math.floor((W - left - PAD.right) / 110) + 1)),
  );
  const x = scaleLinear()
    .domain([viewStart, Math.max(viewEnd, viewStart + 1)])
    .range([left, W - PAD.right]);
  const plotLeft = left;
  const plotRight = W - PAD.right;
  const step = slots > 1 ? x(1) - x(0) : 28;
  const draw = line<Point>()
    .x((d) => d.x)
    .y((d) => d.y);
  const at = (i: number, cents: number): Point => ({ slot: i, x: x(i), y: y(cents) });
  const past = history.map((h, i) => at(i, h.usable));
  const future = weeks.map((w, i) => at(off + i, w.usable));
  const parentLine = p.parent?.weeks.map((w, i) => at(off + i, w.usable)) ?? [];
  const lastPast = past[past.length - 1];
  // A forked line leaves its anchor in the first changed week, so the fork sits on the week the
  // change acts. Without the anchor's cash it starts at its last matching week; an unforked
  // (legacy) line joins the last recorded week.
  const comparisonPoints = (entry: (typeof comparisons)[number]): Point[] => {
    const points = entry.forecast.weeks.map((week, i) => at(off + i, week.usable));
    if (entry.fromIndex !== undefined && entry.fromIndex !== null && entry.forkCents != null) {
      const first = entry.fromIndex + 1;
      return [at(off + first, entry.forkCents), ...points.slice(first)];
    }
    if (entry.fromIndex === undefined || entry.fromIndex === -1)
      return lastPast ? [lastPast, ...points] : points;
    return entry.fromIndex === null ? [] : points.slice(entry.fromIndex);
  };
  const rawToday = off > 0 ? (x(off - 1) + x(off)) / 2 : x(0);
  // The recorded/forecast divider stays at the plot edge when it is scrolled out of view.
  const todayX = Math.min(plotRight, Math.max(plotLeft, rawToday));
  const todayInView = rawToday > plotLeft && rawToday < plotRight;
  const itemsByWeek = new Map<string, number>();
  for (const it of p.items) itemsByWeek.set(it.dueWeek, (itemsByWeek.get(it.dueWeek) ?? 0) + 1);
  const selectedIndex = weeks.findIndex((w) => w.weekStart === p.selectedWeek);
  const mainRunId = p.forecastRunId ?? "forecast";
  // The hovered path moves to the front. The base line fades with the rest unless the base itself is hovered.
  const keyEntry = comparisons.find((entry) => entry.runId === keyHover);
  const lineage = new Set(
    keyHover
      ? [keyHover, ...(keyEntry?.ancestors ?? [])]
      : (p.highlightRunIds ?? []).filter((id) => id !== mainRunId),
  );
  const highlighting = Boolean(keyHover) || Boolean(p.highlightRunIds?.length);
  const lit = (runId: string) => lineage.has(runId);
  const baseFaded = highlighting && lineage.size > 0;
  const curves: FocusCurve[] = [
    { runId: mainRunId, label: mainLabel, points: lastPast ? [lastPast, ...future] : future },
    ...comparisons.map((entry) => ({
      runId: entry.runId,
      label: entry.label,
      color: entry.color,
      points: comparisonPoints(entry),
    })),
    ...(p.parent && !p.comparisons
      ? [
          {
            runId: "parent",
            label: "Scenario it started from",
            color: "hsl(var(--muted-foreground))",
            points: lastPast ? [lastPast, ...parentLine] : parentLine,
          },
        ]
      : []),
    { runId: "recorded", label: "Recorded cash", points: past, color: "hsl(var(--clay))" },
  ];
  const focusCurve =
    curves.find(
      (curve) => curve.runId === (focus?.runId ?? p.initialFocusRunId) && curve.points.length > 1,
    ) ?? curves[0]!;
  // Store time and identity, then reproject from the current scales after any pan, zoom or resize.
  const focusSlot = focus && focus.weekStart === p.selectedWeek ? focus.slot : off + selectedIndex;
  const focusPoint =
    selectedIndex >= 0 || focus ? pointOnCurve(focusCurve.points, focusSlot) : null;
  const focusDate = (slot: number) => {
    const before = dates[Math.floor(slot)];
    const after = dates[Math.ceil(slot)];
    return before && after && before !== after
      ? `between ${formatFullDate(before)} and ${formatFullDate(after)}`
      : `week of ${formatFullDate(before ?? "")}`;
  };
  const focusNote = comparisons.find((entry) => entry.runId === focusCurve.runId)?.note;
  const focusLabel = `${focusCurve.label} · ${focusDate(focusSlot)}`;
  const selectAt = (event: MouseEvent<SVGRectElement>) => {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const bounds = svg.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const pointerX = ((event.clientX - bounds.left) / bounds.width) * W;
    const pointerY = ((event.clientY - bounds.top) / bounds.height) * H;
    const slot = x.invert(clampTo(pointerX, plotLeft, plotRight));
    const picked = nearestCurveAt(curves, slot, pointerY, focusCurve.runId);
    if (!picked) return;
    // Week details keep the nearest saved forecast record; no fractional financial values are made.
    const week =
      picked.curve.runId !== "recorded" && slot >= off - 1
        ? weeks[clampTo(Math.round(slot - off), 0, weeks.length - 1)]
        : undefined;
    setFocus({ runId: picked.curve.runId, slot, weekStart: week?.weekStart ?? p.selectedWeek });
    if (week) p.onSelectWeek(week.weekStart);
  };
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
  const annotations = placeChartAnnotations(
    [
      ...p.limits
        .filter((limit) => limit.cents >= domainLo && limit.cents <= domainHi)
        .map((limit) => ({
          id: `limit:${limit.id}`,
          x: left + 5,
          y: y(limit.cents),
          text: `${limit.label} ${formatCents(limit.cents)}`,
        })),
      ...notes.map((note, index) => ({
        id: `note:${index}`,
        x: note.pt.x,
        y: note.pt.y,
        text: note.short ?? note.text,
      })),
    ],
    {
      left: plotLeft + 4,
      top: PAD.top + 6,
      width: Math.max(1, plotRight - plotLeft - 8),
      height: Math.max(1, H - PAD.bottom - PAD.top - 12),
    },
    p.fill ? [{ ...KEY_SPOT, ...legendSize }] : [],
  );

  // The branch point of a proposal under review: the forecast week containing its start date.
  const preview = p.branchPreview;
  const previewLine = preview?.forecast ?? p.forecast;
  let previewIndex = -1;
  if (preview)
    previewLine.weeks.forEach((w, i) => {
      if (w.weekStart <= preview.date) previewIndex = i;
    });
  const previewWeek = previewLine.weeks[previewIndex];
  const previewPoint = previewWeek ? at(off + previewIndex, previewWeek.usable) : null;

  // Trackpad: two-finger swipes pan time and cash; a pinch zooms time around the pointer. The
  // scrollers set the scale. At an edge the swipe goes back to the page, so it never traps it.
  const onWheel = useRef<(e: WheelEvent) => void>(() => undefined);
  onWheel.current = (e) => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = rect.width / W;
    const span = viewEnd - viewStart;
    if (e.ctrlKey) {
      const nextSpan = clampTo(span * Math.exp(e.deltaY * 0.01), MIN_SPAN, lastSlot);
      e.preventDefault();
      if (nextSpan === span) return;
      const ratio = clampTo(
        ((e.clientX - rect.left) / px - plotLeft) / (plotRight - plotLeft),
        0,
        1,
      );
      const anchorSlot = viewStart + ratio * span;
      const start = clampTo(anchorSlot - ratio * nextSpan, 0, lastSlot - nextSpan);
      setView(start === 0 && nextSpan === lastSlot ? null : [start, start + nextSpan]);
      return;
    }
    const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey;
    const dx = sideways ? e.deltaX || e.deltaY : 0;
    const dy = sideways ? 0 : e.deltaY;
    if (dx && span < lastSlot) {
      const next = panWeekWindow(
        viewStart,
        viewEnd,
        (dx / ((plotRight - plotLeft) * px)) * span,
        lastSlot,
      );
      if (next[0] !== viewStart) {
        e.preventDefault();
        setCashView((current) => current ?? [domainLo, domainHi]);
        setView(next);
      }
    }
    const height = domainHi - domainLo;
    if (dy && height < cashExtent[1] - cashExtent[0]) {
      // Swiping up (natural scrolling) moves to lower amounts, like scrolling down a page.
      const cents = Math.round((dy / ((H - PAD.top - PAD.bottom) * px)) * height);
      const lo = clampTo(domainLo - cents, cashExtent[0], cashExtent[1] - height);
      if (lo === domainLo) return;
      e.preventDefault();
      setCashView([lo, lo + height]);
    }
  };
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => onWheel.current(e);
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [wrapRef]);

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
    <figure
      className={
        p.fill
          ? "relative flex min-h-0 min-w-0 max-w-full flex-1 flex-col gap-2"
          : "min-w-0 max-w-full space-y-3"
      }
      data-testid="workspace-chart"
    >
      <figcaption
        ref={legendRef}
        className={
          p.fill
            ? "absolute z-20 max-h-[70%] w-max max-w-[min(20rem,calc(100%_-_6rem))] overflow-y-auto rounded-md border bg-card/95 px-2 py-0.5 text-xs text-muted-foreground shadow-xs"
            : "shrink-0 text-xs text-muted-foreground"
        }
        style={p.fill ? KEY_SPOT : undefined}
      >
        {/* Closed, the key is a single line; cash minimum details open inside it. */}
        <details open={p.fill ? undefined : true}>
          <summary className="min-h-6 cursor-pointer whitespace-nowrap">
            Chart key
            {comparisons.length
              ? ` · ${comparisons.length} ${comparisons.length === 1 ? "scenario" : "scenarios"}`
              : ""}
          </summary>
          <div
            className={
              p.fill
                ? "flex flex-col items-start gap-2 py-2"
                : "flex flex-wrap gap-x-4 gap-y-1.5 py-1"
            }
          >
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
                className={`inline-flex max-w-full flex-wrap items-center gap-1.5 transition-opacity${highlighting && !lit(entry.runId) ? " opacity-50" : ""}`}
                data-testid="comparison-legend"
                onPointerEnter={() => setKeyHover(entry.runId)}
                onPointerLeave={() => setKeyHover(null)}
              >
                <Swatch
                  dash={entry.color ? undefined : DASHES[index % DASHES.length]}
                  color={entry.color}
                />
                <span
                  className={p.fill ? "min-w-0 break-words" : "max-w-48 truncate"}
                  title={entry.label}
                >
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
          </div>
          {notes.length || p.limits.length ? (
            <details className="mt-1 max-h-32 overflow-y-auto text-xs">
              <summary className="min-h-8 cursor-pointer py-1 text-destructive">
                Cash minimum details ({notes.length + p.limits.length})
              </summary>
              <ul className="space-y-1 pl-2">
                {p.limits.map((limit) => (
                  <li key={limit.id}>
                    {limit.label} · {formatCents(limit.cents)}
                  </li>
                ))}
                {notes.map((note, index) => (
                  <li key={`${index}:${note.weekStart}`}>
                    {formatFullDate(note.weekStart)} · {note.text}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </details>
      </figcaption>
      <div
        className={
          p.fill
            ? "flex min-h-[180px] min-w-0 flex-1 items-stretch gap-2"
            : "flex min-w-0 items-start gap-2"
        }
        data-testid="chart-scale"
      >
        <div
          ref={wrapRef}
          className="relative min-h-0 min-w-0 max-w-full flex-1 overscroll-contain"
        >
          <svg
            id={`${clipId}-chart`}
            viewBox={`0 0 ${W} ${H}`}
            className={
              p.fill
                ? "absolute inset-0 block h-full w-full touch-pan-y select-none"
                : "block h-auto w-full touch-pan-y select-none"
            }
            role="img"
            aria-labelledby={titleId}
            aria-describedby={focusPoint ? `${clipId}-focus-label` : undefined}
            onPointerLeave={() => setHover(null)}
          >
            <title
              id={titleId}
            >{`Usable cash: ${history.length} recorded weeks, then the saved 13-week forecast. Lowest forecast week ${formatFullDate(low.weekStart)} at ${formatCents(low.usable)}.`}</title>
            {/* Lines are drawn for every week and clipped to the plot, so panning stays smooth. */}
            <defs>
              <clipPath id={clipId}>
                <rect
                  x={plotLeft - 6}
                  y={PAD.top - 10}
                  width={plotRight - plotLeft + 12}
                  height={H - PAD.bottom - PAD.top + 16}
                />
              </clipPath>
            </defs>
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
              {off > 0 && todayX - plotLeft > 64 ? (
                <text
                  x={todayX - 8}
                  y={PAD.top - 12}
                  textAnchor="end"
                  className="fill-muted-foreground"
                >
                  Recorded
                </text>
              ) : null}
              {plotRight - todayX > 96 ? (
                <text x={todayX + 8} y={PAD.top - 12} className="fill-foreground font-medium">
                  Next {weeks.length} weeks
                </text>
              ) : null}
              {todayInView ? (
                <line
                  x1={todayX}
                  x2={todayX}
                  y1={PAD.top - 22}
                  y2={H - PAD.bottom}
                  className="stroke-muted-foreground/60"
                  strokeDasharray="3 3"
                />
              ) : null}
            </g>
            {p.limits
              .filter((l) => l.cents >= domainLo && l.cents <= domainHi)
              .map((l) => (
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
                </g>
              ))}
            <g clipPath={`url(#${clipId})`}>
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
              {/* One keyed list so a hovered path moves in front without redrawing its lines. */}
              {[
                ...comparisons
                  .map((entry, index) => ({ entry, index }))
                  .filter(({ entry }) => !lit(entry.runId)),
                null,
                ...comparisons
                  .map((entry, index) => ({ entry, index }))
                  .filter(({ entry }) => lit(entry.runId)),
              ].map((drawn) => {
                if (!drawn)
                  return (
                    <path
                      key="forecast-line"
                      d={draw(lastPast ? [lastPast, ...future] : future) ?? ""}
                      fill="none"
                      className="stroke-primary"
                      style={{ transition: "opacity 150ms" }}
                      opacity={baseFaded ? 0.25 : 1}
                      data-testid="forecast-line"
                      strokeWidth={comparisons.some((c) => c.color) ? 2 : 2.5}
                    />
                  );
                const { entry, index } = drawn;
                const points = comparisonPoints(entry);
                if (points.length < 2)
                  return (
                    <SameForecastReveal
                      key={entry.runId}
                      d={
                        draw(
                          lastPast
                            ? [
                                lastPast,
                                ...entry.forecast.weeks.map((week, i) => at(off + i, week.usable)),
                              ]
                            : entry.forecast.weeks.map((week, i) => at(off + i, week.usable)),
                        ) ?? ""
                      }
                      color={entry.color}
                      reveal={Boolean(entry.reveal)}
                      onReveal={() => p.onReveal?.(entry.runId)}
                    />
                  );
                const fork =
                  entry.fromIndex === undefined || entry.fromIndex === null ? null : points[0];
                return (
                  <g
                    key={entry.runId}
                    pointerEvents="none"
                    data-testid={entry.parent ? "parent-line" : "comparison-line"}
                    data-run-id={entry.runId}
                    data-highlighted={highlighting ? lit(entry.runId) : undefined}
                    opacity={highlighting && !lit(entry.runId) ? 0.25 : 1}
                    className="transition-opacity duration-150"
                  >
                    <ScenarioStroke
                      d={draw(points) ?? ""}
                      color={entry.color}
                      dash={entry.color ? undefined : DASHES[index % DASHES.length]}
                      lit={highlighting && lit(entry.runId)}
                      reveal={Boolean(entry.reveal)}
                      onReveal={() => p.onReveal?.(entry.runId)}
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
              {focusPoint ? (
                <line
                  x1={focusPoint.x}
                  x2={focusPoint.x}
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
                const breached = breachedWeeks.has(w.weekStart);
                return (
                  <circle
                    key={w.weekStart}
                    cx={pt.x}
                    cy={pt.y}
                    r={breached || i === lowIndex ? 4.5 : 2.5}
                    className={`${breached ? "fill-destructive" : "fill-primary"}${breached ? " stroke-card" : ""}`}
                    strokeWidth={breached ? 2 : undefined}
                    opacity={baseFaded ? 0.25 : 1}
                    data-testid={`forecast-point-${w.weekStart}`}
                    data-breached={breached}
                    pointerEvents="none"
                  />
                );
              })}
              {focusPoint ? (
                <circle
                  cx={focusPoint.x}
                  cy={focusPoint.y}
                  r={5.5}
                  fill={focusCurve.color}
                  className={`${focusCurve.color ? "" : "fill-primary "}stroke-card`}
                  strokeWidth={2}
                  pointerEvents="none"
                  aria-label={`Chart focus: ${focusLabel}`}
                  data-testid="chart-focus-point"
                  data-run-id={focusCurve.runId}
                  data-slot={focusSlot}
                >
                  <title>{focusLabel}</title>
                </circle>
              ) : null}
              {notes.map((note, index) => (
                <g
                  key={`dot:${index}:${note.weekStart}`}
                  pointerEvents="none"
                  data-testid="breach-note"
                >
                  <title>{`${formatFullDate(note.weekStart)} · ${note.text}`}</title>
                  {"dot" in note ? (
                    <circle
                      cx={note.pt.x}
                      cy={note.pt.y}
                      r={4.5}
                      className="fill-destructive stroke-card"
                      strokeWidth={2}
                      data-breached="true"
                    />
                  ) : null}
                </g>
              ))}
              {annotations.placed.map((label) => {
                const noteIndex = label.id.startsWith("note:") ? Number(label.id.slice(5)) : -1;
                const note = notes[noteIndex];
                const fullText = note
                  ? `${formatFullDate(note.weekStart)} · ${note.text}`
                  : label.text;
                const targetX = Math.max(label.left, Math.min(label.left + label.width, label.x));
                const targetY = Math.max(label.top, Math.min(label.top + label.height, label.y));
                return (
                  <g
                    key={label.id}
                    data-testid="chart-annotation"
                    pointerEvents="none"
                    aria-label={fullText}
                  >
                    <title>{fullText}</title>
                    {note ? (
                      <line
                        x1={label.x}
                        y1={label.y}
                        x2={targetX}
                        y2={targetY}
                        className="stroke-destructive/60"
                      />
                    ) : null}
                    <text
                      x={label.left}
                      y={label.top + 11}
                      className="fill-destructive text-[11px] font-medium [paint-order:stroke] [stroke-linejoin:round] [stroke-width:3px] stroke-card"
                    >
                      {label.lines.map((line, i) => (
                        <tspan key={`${i}:${line}`} x={label.left} dy={i ? 14 : 0}>
                          {line}
                        </tspan>
                      ))}
                    </text>
                  </g>
                );
              })}
              {preview && previewPoint ? (
                <g key={preview.key} pointerEvents="none" data-testid="branch-preview">
                  {preview.forecast && preview.drawLine !== false ? (
                    <path
                      d={draw(preview.forecast.weeks.map((w, i) => at(off + i, w.usable))) ?? ""}
                      fill="none"
                      stroke={preview.color}
                      strokeWidth={1.75}
                      strokeDasharray="5 4"
                      opacity={0.7}
                    />
                  ) : null}
                  <motion.line
                    x1={previewPoint.x}
                    x2={previewPoint.x}
                    y1={PAD.top - 4}
                    y2={H - PAD.bottom}
                    stroke={preview.color}
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    initial={{ opacity: 0 }}
                    animate={reduced ? { opacity: 0.7 } : { opacity: [0, 1, 0.2, 1, 0.2, 1, 0.7] }}
                    transition={{ duration: 2.2, ease: "easeInOut" }}
                  />
                  {reduced ? null : (
                    <motion.circle
                      cx={previewPoint.x}
                      cy={previewPoint.y}
                      fill="none"
                      stroke={preview.color}
                      strokeWidth={2}
                      initial={{ r: 5, opacity: 0.9 }}
                      animate={{ r: [5, 16], opacity: [0.9, 0] }}
                      transition={{ duration: 1.1, repeat: 2, ease: "easeOut" }}
                    />
                  )}
                  <circle
                    cx={previewPoint.x}
                    cy={previewPoint.y}
                    r={5}
                    fill={preview.color}
                    className="stroke-card"
                    strokeWidth={2}
                  />
                  <text
                    x={previewPoint.x + (previewPoint.x > W * 0.7 ? -6 : 6)}
                    y={PAD.top + 8}
                    textAnchor={previewPoint.x > W * 0.7 ? "end" : "start"}
                    className="text-[11px] font-medium [paint-order:stroke] [stroke-linejoin:round] [stroke-width:3px] stroke-card"
                    fill={preview.color}
                  >
                    Branches here · {formatFullDate(preview.date)}
                  </text>
                </g>
              ) : null}
            </g>
            {/* Wide hit areas: recorded weeks show details on hover; forecast weeks can be chosen.
              Keyboard users pick weeks with the range control below the chart. */}
            {dates.map((date, slot) => {
              const forecastIndex = slot - off;
              if (!visible(slot)) return null;
              return (
                // biome-ignore lint/a11y/useKeyWithClickEvents: the week range control is the keyboard path
                <rect
                  key={date}
                  x={x(slot) - step / 2}
                  y={PAD.top}
                  width={step}
                  height={H - PAD.top - PAD.bottom}
                  fill="transparent"
                  className="cursor-pointer"
                  onPointerEnter={(e) => {
                    if (e.pointerType === "mouse") setHover(slot);
                  }}
                  onClick={selectAt}
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
                <span className="tabular-nums">{formatCents(hovered.usable)}</span>
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
                        <span className="shrink-0 tabular-nums">{formatCents(v)}</span>
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
        <CashBar
          controls={`${clipId}-chart`}
          extent={cashExtent}
          lo={Math.max(cashExtent[0], domainLo)}
          hi={Math.min(cashExtent[1], domainHi)}
          top={PAD.top}
          height={H - PAD.top - PAD.bottom}
          zoomed={cashView !== null}
          onChange={setCashView}
          onReset={() => setCashView(null)}
        />
      </div>
      <RangeBar
        controls={`${clipId}-chart`}
        dates={dates}
        series={[...history.map((h) => h.usable), ...weeks.map((w) => w.usable)]}
        split={off}
        start={viewStart}
        end={viewEnd}
        onChange={(next, mode) => {
          if (mode === "move") setCashView((current) => current ?? [domainLo, domainHi]);
          setView(next[0] === 0 && next[1] === lastSlot ? null : next);
        }}
        onReset={() => setView([0, lastSlot])}
      />

      <label className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="text-muted-foreground">Pick a week</span>
        <input
          type="range"
          min={0}
          max={weeks.length - 1}
          step={1}
          value={selectedIndex >= 0 ? selectedIndex : 0}
          aria-valuetext={
            selectedIndex >= 0
              ? `Week of ${formatFullDate(weeks[selectedIndex]?.weekStart ?? "")} · ${focusCurve.label}`
              : "No week chosen"
          }
          onChange={(e) => {
            const w = weeks[Number(e.target.value)];
            if (w) {
              setFocus({
                runId: focusCurve.runId === "recorded" ? mainRunId : focusCurve.runId,
                slot: off + Number(e.target.value),
                weekStart: w.weekStart,
              });
              p.onSelectWeek(w.weekStart);
            }
          }}
          className="h-8 min-w-0 flex-1 accent-primary"
          data-testid="week-range"
        />
      </label>
      {focusPoint ? (
        <p
          id={`${clipId}-focus-label`}
          className="shrink-0 text-xs text-muted-foreground"
          data-testid="chart-focus-label"
          aria-live="polite"
        >
          Focus: {focusLabel}.{focusNote ? ` ${focusNote}.` : ""} Week details use the open
          scenario.
        </p>
      ) : null}
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

type Drag = { mode: "start" | "end" | "move"; x0: number; s0: number; e0: number };

/**
 * Two-handle time scroller under the chart, like an editing timeline: drag a handle to zoom,
 * drag the window to pan, double-click to show everything. A faint overview line shows the
 * whole series so the window's position is always clear. Arrow keys move handles one week;
 * Shift moves four.
 */
function RangeBar({
  controls,
  dates,
  series,
  split,
  start,
  end,
  onChange,
  onReset,
}: {
  /** Id of the chart this scroller pans. */
  controls: string;
  dates: string[];
  series: number[];
  /** First forecast slot; earlier slots are recorded weeks. */
  split: number;
  start: number;
  end: number;
  onChange: (view: [number, number], mode: Drag["mode"]) => void;
  onReset: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const last = Math.max(dates.length - 1, 1);
  const minSpan = Math.min(MIN_SPAN, last);
  const pct = (slot: number) => (slot / last) * 100;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const apply = (mode: Drag["mode"], s0: number, e0: number, delta: number) => {
    if (mode === "start") onChange([clamp(s0 + delta, 0, e0 - minSpan), e0], mode);
    else if (mode === "end") onChange([s0, clamp(e0 + delta, s0 + minSpan, last)], mode);
    else {
      onChange(panWeekWindow(s0, e0, delta, last), mode);
    }
  };
  const begin = (mode: Drag["mode"]) => (e: PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, x0: e.clientX, s0: start, e0: end };
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    const width = track.current?.clientWidth ?? 0;
    if (!d || width <= 0) return;
    apply(d.mode, d.s0, d.e0, ((e.clientX - d.x0) / width) * last);
  };
  const end_ = () => {
    drag.current = null;
  };
  const keys = (mode: Drag["mode"]) => (e: KeyboardEvent<HTMLElement>) => {
    const step = e.shiftKey ? 4 : 1;
    const delta = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
    if (!delta) return;
    e.preventDefault();
    // A handle sits inside the window; without this the window's pan handler undoes the zoom.
    e.stopPropagation();
    apply(mode, start, end, delta);
  };
  // Overview geometry in a 0..100 x 0..24 box.
  const finite = series.filter(Number.isFinite);
  const lo = finite.length ? Math.min(...finite) : 0;
  const hi = finite.length ? Math.max(...finite) : 1;
  const yOf = (v: number) => (hi === lo ? 12 : 21 - ((v - lo) / (hi - lo)) * 18);
  const pts = (from: number, to: number) =>
    series
      .slice(from, to)
      .map((v, i) => `${pct(from + i).toFixed(2)},${yOf(v).toFixed(2)}`)
      .join(" ");
  const full = start === 0 && end === last;
  const firstDate = dates[Math.ceil(start)];
  const lastDate = dates[Math.floor(end)];
  return (
    <div className="space-y-1" data-testid="time-range">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Showing {firstDate ? formatFullDate(firstDate) : ""} to{" "}
          {lastDate ? formatFullDate(lastDate) : ""}
        </span>
        {full ? (
          <span>Swipe to scroll · drag the handles to zoom</span>
        ) : (
          <button
            type="button"
            onClick={onReset}
            className="text-primary underline-offset-4 hover:underline"
          >
            Show all weeks
          </button>
        )}
      </div>
      <div
        ref={track}
        className="relative h-8 touch-none select-none rounded-md border bg-muted/40"
        onPointerMove={move}
        onPointerUp={end_}
        onPointerCancel={end_}
        onDoubleClick={onReset}
      >
        <svg
          viewBox="0 0 100 24"
          preserveAspectRatio="none"
          aria-hidden="true"
          className="absolute inset-0 h-full w-full"
        >
          {split > 0 ? (
            <polyline
              points={pts(0, split + 1)}
              fill="none"
              className="stroke-clay"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          <polyline
            points={pts(Math.max(0, split), series.length)}
            fill="none"
            className="stroke-primary"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          {split > 0 ? (
            <line
              x1={pct(split - 0.5)}
              x2={pct(split - 0.5)}
              y1={0}
              y2={24}
              className="stroke-muted-foreground/50"
              strokeDasharray="1.5 1.5"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>
        {/* Dim what is outside the window. */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 rounded-l-md bg-background/60"
          style={{ width: `${pct(start)}%` }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 rounded-r-md bg-background/60"
          style={{ width: `${100 - pct(end)}%` }}
        />
        <div
          role="scrollbar"
          aria-controls={controls}
          aria-label="Pan the visible weeks"
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, last - (end - start))}
          aria-valuenow={start}
          className="absolute inset-y-0 cursor-grab rounded-md border-2 border-primary/70 active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          style={{ left: `${pct(start)}%`, width: `${pct(end) - pct(start)}%` }}
          tabIndex={0}
          onPointerDown={begin("move")}
          onKeyDown={keys("move")}
          data-testid="time-range-window"
        >
          {(["start", "end"] as const).map((mode) => (
            <span
              key={mode}
              role="slider"
              tabIndex={0}
              aria-label={mode === "start" ? "First visible week" : "Last visible week"}
              aria-valuemin={0}
              aria-valuemax={last}
              aria-valuenow={mode === "start" ? start : end}
              aria-valuetext={
                dates[mode === "start" ? Math.ceil(start) : Math.floor(end)]
                  ? formatFullDate(
                      dates[mode === "start" ? Math.ceil(start) : Math.floor(end)] ?? "",
                    )
                  : undefined
              }
              className={`absolute inset-y-0 flex w-3 cursor-ew-resize items-center justify-center bg-primary/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${mode === "start" ? "-left-1.5 rounded-l-md" : "-right-1.5 rounded-r-md"}`}
              onPointerDown={begin(mode)}
              onKeyDown={keys(mode)}
              data-testid={`time-range-${mode}`}
            >
              <span aria-hidden="true" className="h-3 w-px bg-primary-foreground/80" />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

type CashDrag = { mode: "top" | "bottom" | "move"; y0: number; lo0: number; hi0: number };

/**
 * Two-handle cash scroller beside the chart: drag the top handle to set the highest amount
 * shown, the bottom handle for the lowest, and the window between them to pan. Double-click
 * fits the lines again. Up and down arrows move a handle; Shift moves further.
 */
function CashBar({
  controls,
  extent,
  lo,
  hi,
  top,
  height,
  zoomed,
  onChange,
  onReset,
}: {
  controls: string;
  /** Lowest and highest cents the scroller can reach. */
  extent: [number, number];
  lo: number;
  hi: number;
  /** Plot offset and height in chart pixels, so the track lines up with the plot. */
  top: number;
  height: number;
  zoomed: boolean;
  onChange: (range: [number, number]) => void;
  onReset: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<CashDrag | null>(null);
  const [min, max] = extent;
  const span = Math.max(1, max - min);
  const minSpan = Math.max(1, Math.round(span * 0.03));
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  const apply = (mode: CashDrag["mode"], lo0: number, hi0: number, delta: number) => {
    const d = Math.round(delta);
    if (mode === "top") onChange([lo0, clamp(hi0 + d, lo0 + minSpan, max)]);
    else if (mode === "bottom") onChange([clamp(lo0 + d, min, hi0 - minSpan), hi0]);
    else {
      const next = clamp(lo0 + d, min, max - (hi0 - lo0));
      onChange([next, next + (hi0 - lo0)]);
    }
  };
  const begin = (mode: CashDrag["mode"]) => (e: PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, y0: e.clientY, lo0: lo, hi0: hi };
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    const px = track.current?.clientHeight ?? 0;
    if (!d || px <= 0) return;
    // Dragging up raises the amounts shown.
    apply(d.mode, d.lo0, d.hi0, (-(e.clientY - d.y0) / px) * span);
  };
  const stop = () => {
    drag.current = null;
  };
  const keys = (mode: CashDrag["mode"]) => (e: KeyboardEvent<HTMLElement>) => {
    const step = span * (e.shiftKey ? 0.08 : 0.02);
    const delta = e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0;
    if (!delta) return;
    e.preventDefault();
    e.stopPropagation();
    apply(mode, lo, hi, delta);
  };
  const pctTop = ((max - hi) / span) * 100;
  const pctHeight = ((hi - lo) / span) * 100;
  return (
    <div className="flex w-6 shrink-0 flex-col items-center" style={{ paddingTop: top }}>
      <div
        ref={track}
        className="relative w-4 touch-none select-none rounded-md border bg-muted/40"
        style={{ height }}
        onPointerMove={move}
        onPointerUp={stop}
        onPointerCancel={stop}
        onDoubleClick={onReset}
        data-testid="cash-range"
      >
        <div
          role="scrollbar"
          aria-controls={controls}
          aria-label="Pan the cash range"
          aria-orientation="vertical"
          aria-valuemin={min}
          aria-valuemax={Math.max(min, max - (hi - lo))}
          aria-valuenow={lo}
          aria-valuetext={`${formatExactCents(lo)} to ${formatExactCents(hi)}`}
          tabIndex={0}
          className="absolute inset-x-0 cursor-grab rounded-md border-2 border-primary/70 active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          style={{ top: `${pctTop}%`, height: `${pctHeight}%` }}
          onPointerDown={begin("move")}
          onKeyDown={keys("move")}
          data-testid="cash-range-window"
        >
          {(["top", "bottom"] as const).map((mode) => (
            <span
              key={mode}
              role="slider"
              tabIndex={0}
              aria-orientation="vertical"
              aria-label={mode === "top" ? "Highest cash shown" : "Lowest cash shown"}
              aria-valuemin={min}
              aria-valuemax={max}
              aria-valuenow={mode === "top" ? hi : lo}
              aria-valuetext={formatExactCents(mode === "top" ? hi : lo)}
              className={`absolute inset-x-0 flex h-3 cursor-ns-resize items-center justify-center bg-primary/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${mode === "top" ? "-top-1.5 rounded-t-md" : "-bottom-1.5 rounded-b-md"}`}
              onPointerDown={begin(mode)}
              onKeyDown={keys(mode)}
              data-testid={`cash-range-${mode}`}
            >
              <span aria-hidden="true" className="h-px w-2 bg-primary-foreground/80" />
            </span>
          ))}
        </div>
      </div>
      {zoomed ? (
        <button
          type="button"
          onClick={onReset}
          className="mt-1 text-[10px] leading-3 text-primary underline-offset-2 hover:underline"
          title="Fit the cash axis to the lines in view"
        >
          Fit
        </button>
      ) : null}
    </div>
  );
}
