import {
  ArrowRight,
  Calculator,
  CalendarClock,
  ChevronDown,
  CircleHelp,
  Database,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "../../../lib/utils";
import { AgentIcon } from "../../icons/AgentIcon";
import { ToolIcon } from "../../icons/ToolIcon";
import { ToolLogo } from "../../icons/ToolLogo";
import type {
  AgentMap,
  Explain,
  ExplainResult,
  Fact,
  MapIcon,
  MapNode,
  Money,
  ResultTone,
  Step,
} from "./explain-model";

// Shared "How we got here" story for saved Timeline calculations and Field runs. Purely
// presentational: the builders (timeline/calculation/explain.ts, field/trace/explain.ts) read
// saved records; this file only lays them out.

type Tone = "neutral" | "change" | "calc" | ResultTone;
const TONE_VAR: Record<Tone, string> = {
  neutral: "var(--muted-foreground)",
  change: "var(--warning)",
  calc: "var(--primary-ink)",
  above: "var(--safe)",
  below: "var(--destructive)",
  unknown: "var(--muted-foreground)",
};
const toneStyle = (tone: Tone) => ({ "--tone": TONE_VAR[tone] }) as CSSProperties;

/** Short money with the exact saved value on hover and for screen readers. */
export function Amount({ money, className }: { money: Money; className?: string }) {
  return (
    <span title={money.exact} className={cn("tabular-nums", className)}>
      <span aria-hidden="true">{money.short}</span>
      <span className="sr-only">{money.exact}</span>
    </span>
  );
}

function FactChip({ fact }: { fact: Fact }) {
  return (
    <li className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs leading-4 text-muted-foreground">
      <span className="min-w-0 break-words">{fact.text}</span>
      {fact.money ? <Amount money={fact.money} className="font-semibold text-foreground" /> : null}
    </li>
  );
}

function StepCard({
  index,
  title,
  tone,
  icon,
  step,
  children,
}: {
  index: number;
  title: string;
  tone: Tone;
  icon: ReactNode;
  step?: Step;
  children?: ReactNode;
}) {
  return (
    <li
      style={toneStyle(tone)}
      className="relative flex min-w-0 flex-col rounded-lg border border-t-[3px] border-t-[hsl(var(--tone))] bg-card p-4 shadow-xs"
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="grid size-7 shrink-0 place-items-center rounded-md bg-[hsl(var(--tone)/0.12)] text-[hsl(var(--tone))] [&_svg]:size-4"
        >
          {icon}
        </span>
        <span className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--tone))]">
          <span className="sr-only">Step {index}: </span>
          {title}
        </span>
      </div>
      {step ? (
        <>
          <p className="mt-3 text-[15px] font-semibold leading-snug">{step.headline}</p>
          {step.logos?.length ? (
            <ul aria-label="Sources used" className="mt-3 flex flex-wrap gap-1.5">
              {step.logos.map((l) => (
                <li key={`${l.vendor}-${l.label}`} className="inline-flex items-center gap-1.5">
                  <ToolLogo vendor={l.vendor} size={20} title={l.label} />
                </li>
              ))}
            </ul>
          ) : null}
          {step.facts.length ? (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {step.facts.map((f, i) => (
                <FactChip key={`${f.text}-${i}`} fact={f} />
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      {children}
    </li>
  );
}

/** Bar widths are display geometry only; the compared values are the saved ones. */
function CompareBar({ result }: { result: ExplainResult }) {
  const { low, floor } = result;
  if (!low || !floor) return null;
  const max = Math.max(low.cents, floor.cents, 1);
  const pct = (c: number) => `${Math.min(100, Math.max(0, (c / max) * 100))}%`;
  return (
    <div className="mt-4" aria-hidden="true">
      <div className="relative h-2.5 rounded-full bg-muted">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[hsl(var(--tone))]"
          style={{ width: pct(low.cents) }}
        />
        <div
          className="absolute -top-1 h-[18px] w-0.5 rounded bg-foreground"
          style={{ left: `calc(${pct(floor.cents)} - 1px)` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between gap-2 text-[11px] text-muted-foreground">
        <span>$0</span>
        <span>Line: {result.floorLabel}</span>
      </div>
    </div>
  );
}

function ResultIcon({ tone }: { tone: ResultTone }) {
  return tone === "above" ? <ShieldCheck /> : tone === "below" ? <ShieldAlert /> : <CircleHelp />;
}

function ResultCard({ result }: { result: ExplainResult }) {
  return (
    <StepCard index={4} title="Result" tone={result.tone} icon={<ResultIcon tone={result.tone} />}>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          data-testid="result-badge"
          className="inline-flex items-center rounded-md bg-[hsl(var(--tone)/0.12)] px-2 py-0.5 text-xs font-semibold text-[hsl(var(--tone))]"
        >
          {result.badge}
        </span>
      </div>
      {result.low ? (
        <div className="mt-2">
          <p className="text-xs text-muted-foreground">Lowest cash</p>
          <p className="text-2xl font-semibold tracking-tight">
            <Amount money={result.low} />
          </p>
          {result.lowWeek ? (
            <p className="text-xs text-muted-foreground">week of {result.lowWeek}</p>
          ) : null}
        </div>
      ) : null}
      {result.floor ? (
        <p className="mt-2 text-sm text-muted-foreground">
          vs {result.floorLabel}{" "}
          <Amount money={result.floor} className="font-semibold text-foreground" />
        </p>
      ) : null}
      <CompareBar result={result} />
      {result.facts.length ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {result.facts.map((f, i) => (
            <FactChip key={`${f.text}-${i}`} fact={f} />
          ))}
        </ul>
      ) : null}
    </StepCard>
  );
}

function Stepper({ explain }: { explain: Explain }) {
  return (
    <ol
      aria-label="How we got here, in four steps"
      className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_1.25fr]"
    >
      <StepCard index={1} title="Data" tone="neutral" icon={<Database />} step={explain.data} />
      <StepCard
        index={2}
        title="What changed"
        tone={explain.change.tone === "change" ? "change" : "neutral"}
        icon={<CalendarClock />}
        step={explain.change}
      />
      <StepCard
        index={3}
        title="What we calculated"
        tone="calc"
        icon={<Calculator />}
        step={explain.calc}
      />
      <ResultCard result={explain.result} />
    </ol>
  );
}

// ---------- Agent map snapshot ----------

const NODE_MIN = 150;
const NODE_MAX = 210;
const NODE_H = 56;
const COL_GAP = 32;
const ROW_GAP = 12;
const HEAD = 26;

function NodeIcon({ icon }: { icon: MapIcon }) {
  if (icon.type === "vendor") return <ToolLogo vendor={icon.vendor} size={26} />;
  if (icon.type === "vendors")
    return (
      <span className="flex shrink-0 -space-x-2">
        {icon.vendors.map((v) => (
          <ToolLogo
            key={v}
            vendor={v}
            size={24}
            className="outline outline-2 outline-[hsl(var(--card))]"
          />
        ))}
      </span>
    );
  if (icon.type === "agent") return <AgentIcon kind={icon.kind} size={26} />;
  if (icon.type === "tool") return <ToolIcon category={icon.category} tile size={26} />;
  return (
    <span
      style={toneStyle(icon.tone)}
      className="grid size-[26px] place-items-center rounded-[7px] bg-[hsl(var(--tone)/0.12)] text-[hsl(var(--tone))] [&_svg]:size-4"
    >
      <ResultIcon tone={icon.tone} />
    </span>
  );
}

function MapCard({
  node,
  style,
  wrap,
}: {
  node: MapNode;
  style?: CSSProperties;
  /** Let text wrap (narrow screens) instead of truncating in a fixed-size card. */
  wrap?: boolean;
}) {
  const result = node.icon.type === "result" ? node.icon.tone : null;
  return (
    <div
      style={{ ...style, ...(result ? toneStyle(result) : {}) }}
      className={cn(
        "relative flex items-center gap-2 rounded-[14px] border bg-card px-2.5 py-2 shadow-xs",
        result && "border-[hsl(var(--tone)/0.45)]",
        node.failed && "border-destructive/50",
      )}
      data-node={node.id}
    >
      <NodeIcon icon={node.icon} />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-[13px] font-medium leading-5",
            wrap ? "break-words" : "truncate",
            result && "text-[hsl(var(--tone))]",
          )}
        >
          {node.label}
        </span>
        {node.sub ? (
          <span
            className={cn(
              "block text-[11px] leading-4 text-muted-foreground",
              wrap ? "break-words" : "truncate",
              node.failed && "text-destructive",
            )}
            title={node.sub}
          >
            {node.sub}
          </span>
        ) : null}
      </span>
      {node.order !== null ? (
        <span
          title={`Step ${node.order} in recorded order`}
          className="absolute -left-2 -top-2 grid size-5 place-items-center rounded-full border bg-card text-[10px] font-semibold tabular-nums text-muted-foreground"
        >
          {node.order}
        </span>
      ) : null}
    </div>
  );
}

function layout(map: AgentMap, nodeW = NODE_MIN) {
  const cols = map.columns.length;
  const byCol = Array.from({ length: cols }, (_, c) => map.nodes.filter((n) => n.col === c));
  const tallest = Math.max(1, ...byCol.map((c) => c.length));
  const height = HEAD + tallest * NODE_H + (tallest - 1) * ROW_GAP;
  const pos = new Map<string, { x: number; y: number }>();
  byCol.forEach((nodes, c) => {
    const block = nodes.length * NODE_H + Math.max(0, nodes.length - 1) * ROW_GAP;
    const top = HEAD + (height - HEAD - block) / 2;
    nodes.forEach((n, i) => {
      pos.set(n.id, { x: c * (nodeW + COL_GAP), y: top + i * (NODE_H + ROW_GAP) });
    });
  });
  return { byCol, pos, height, width: cols * nodeW + (cols - 1) * COL_GAP };
}

/** Card width that fills the panel; below the minimum the map scrolls sideways instead. */
function useNodeWidth(cols: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(960);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setAvailable(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const fit = Math.floor((available - (cols - 1) * COL_GAP) / Math.max(1, cols));
  return { ref, nodeW: Math.max(NODE_MIN, Math.min(NODE_MAX, fit)) };
}

function DesktopMap({ map }: { map: AgentMap }) {
  const { ref, nodeW } = useNodeWidth(map.columns.length);
  const { byCol, pos, height, width } = layout(map, nodeW);
  return (
    <div ref={ref} className="hidden overflow-x-auto pb-1 md:block">
      <div className="relative mx-auto" style={{ width, height }}>
        {map.columns.map((title, c) => (
          <p
            key={byCol[c]?.[0]?.id ?? title}
            className="absolute top-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
            style={{ left: c * (nodeW + COL_GAP), width: nodeW }}
          >
            {title === map.columns[c - 1] ? "" : title}
          </p>
        ))}
        <svg
          aria-hidden="true"
          className="absolute inset-0 overflow-visible"
          width={width}
          height={height}
        >
          <defs>
            <marker
              id="hwgh-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0 0 8 4 0 8z" fill="hsl(var(--foreground) / 0.35)" />
            </marker>
          </defs>
          {map.edges.map((e) => {
            const a = pos.get(e.from);
            const b = pos.get(e.to);
            if (!a || !b || b.x <= a.x) return null;
            const x1 = a.x + nodeW;
            const y1 = a.y + NODE_H / 2;
            const x2 = b.x - 2;
            const y2 = b.y + NODE_H / 2;
            const mid = (x1 + x2) / 2;
            return (
              <path
                key={`${e.from}-${e.to}`}
                d={`M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`}
                fill="none"
                stroke="hsl(var(--foreground) / 0.28)"
                strokeWidth={1.5}
                markerEnd="url(#hwgh-arrow)"
              />
            );
          })}
        </svg>
        {map.nodes.map((n) => {
          const p = pos.get(n.id);
          return p ? (
            <MapCard
              key={n.id}
              node={n}
              style={{ position: "absolute", left: p.x, top: p.y, width: nodeW, height: NODE_H }}
            />
          ) : null;
        })}
      </div>
    </div>
  );
}

function MobileMap({ map }: { map: AgentMap }) {
  const { byCol } = layout(map);
  return (
    <ol className="space-y-1 md:hidden">
      {byCol.map((nodes, c) => (
        <li key={nodes[0]?.id ?? map.columns[c]}>
          {c > 0 ? (
            <ChevronDown
              aria-hidden="true"
              className="mx-auto my-1 block size-4 text-muted-foreground"
            />
          ) : null}
          {map.columns[c] !== map.columns[c - 1] ? (
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {map.columns[c]}
            </p>
          ) : null}
          <div className={cn("grid gap-2", nodes.length > 1 && "grid-cols-2")}>
            {nodes.map((n) => (
              <MapCard key={n.id} node={n} wrap />
            ))}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function AgentMapSnapshot({ map }: { map: AgentMap }) {
  const label = new Map(map.nodes.map((n) => [n.id, n.label]));
  return (
    <section aria-labelledby="hwgh-map" className="rounded-lg border bg-card p-5 shadow-xs">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="hwgh-map" className="text-[15px] font-semibold">
          What worked on this result
        </h2>
        <p className="text-xs text-muted-foreground" data-testid="map-note">
          {map.note}
        </p>
      </div>
      <DesktopMap map={map} />
      <MobileMap map={map} />
      <ol className="sr-only" aria-label="Connections in recorded order">
        {map.edges.map((e) => (
          <li key={`${e.from}-${e.to}`}>
            {label.get(e.from) ?? e.from} to {label.get(e.to) ?? e.to}
          </li>
        ))}
      </ol>
      {map.truncated ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Older steps were left out of this saved record, so some early work may be missing.
        </p>
      ) : null}
    </section>
  );
}

// ---------- Page body ----------

export function HowWeGotHere({
  explain,
  back,
  links,
  footer,
}: {
  explain: Explain;
  back: ReactNode;
  /** Related saved views, shown under the header. */
  links?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <article className="mx-auto max-w-5xl space-y-6 pb-16">
      {back}
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          How we got here · {explain.eyebrow}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{explain.title}</h1>
        <p className="text-sm text-muted-foreground">{explain.subtitle}</p>
        {links}
      </header>
      {explain.limits.length ? (
        <div
          style={toneStyle("change")}
          className="rounded-md border border-[hsl(var(--tone)/0.35)] bg-[hsl(var(--tone)/0.06)] p-3 text-sm"
        >
          <strong className="text-[hsl(var(--tone))]">Evidence limits</strong>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
            {explain.limits.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <section aria-label="How we got here">
        <Stepper explain={explain} />
        {explain.result.quote ? (
          <figure className="mt-3 rounded-lg border bg-card p-4 text-sm shadow-xs">
            <blockquote className="leading-6">{explain.result.quote.text}</blockquote>
            <figcaption className="mt-1 text-xs text-muted-foreground">
              {explain.result.quote.by}
            </figcaption>
          </figure>
        ) : null}
      </section>
      <AgentMapSnapshot map={explain.map} />
      {footer}
      <details className="group rounded-lg border bg-card p-5 shadow-xs">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden">
          <ArrowRight
            aria-hidden="true"
            className="size-4 text-muted-foreground transition-transform group-open:rotate-90"
          />
          Details
          <span className="text-xs font-normal text-muted-foreground">
            Full sources, exact amounts, steps and IDs
          </span>
        </summary>
        <div className="mt-4 space-y-5">
          {explain.details.map((g) =>
            g.rows.length ? (
              <section key={g.title}>
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {g.title}
                </h3>
                <dl className="mt-2 divide-y text-xs">
                  {g.rows.map((r, i) => (
                    <div
                      key={`${r.label}-${i}`}
                      className="grid gap-1 py-1.5 sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-4"
                    >
                      <dt className="font-medium">{r.label}</dt>
                      <dd className="min-w-0 break-words text-muted-foreground">{r.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null,
          )}
        </div>
      </details>
    </article>
  );
}
