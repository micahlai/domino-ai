"use client";

import {
  ArrowRight,
  ArrowUpRight,
  CircleCheck,
  Eye,
  Flag,
  Network,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { formatCents, formatDate } from "../../../lib/format";
import { cn } from "../../../lib/utils";
import { Badge } from "../../ui/badge";
import { Card } from "../../ui/card";
import { Skeleton } from "../../ui/skeleton";
import { CashFlowBars, CashLine } from "./charts";
import {
  type DashboardData,
  DashboardDataProvider,
  type DashboardHeader,
  useDashboard,
} from "./data";
import type { DashboardView, Health } from "./derive";

// Home dashboard: are we OK on cash for the next 13 weeks? If not, when does it break, why,
// and what do I do? Field owns this page; sections marked SampleTag wait on the Timeline lane.

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function Dashboard() {
  return (
    <DashboardDataProvider>
      <DashboardBody />
    </DashboardDataProvider>
  );
}

function DashboardBody() {
  const data = useDashboard();
  const result = data.result;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Header data={data} />
      {result === undefined ? (
        <LoadingState />
      ) : result === null ? (
        <Notice title="Waiting for the first read of the books">
          The agent is connected but has not saved a snapshot yet. Numbers appear after the first
          ingest finishes.
        </Notice>
      ) : !result.ok ? (
        <Notice title="These numbers do not tie out" tone="danger">
          The cash flow statement did not match the bank balance, so nothing is shown rather than a
          wrong number. {result.message}
        </Notice>
      ) : (
        <Sections view={result.view} header={data.header} />
      )}
    </div>
  );
}

function Sections({ view, header }: { view: DashboardView; header?: DashboardHeader }) {
  return (
    <>
      <HealthHero view={view} />
      <Tiles view={view} />
      <CashFlowSection view={view} />
      <CashLineSection view={view} />
      <ComingUp view={view} />
      <Risks view={view} />
      <Attention header={header} />
    </>
  );
}

// ---------- 1. Header ----------

function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function ago(iso: string | null, now: number | null): string {
  if (!iso || now === null) return "...";
  const s = Math.round((now - Date.parse(iso)) / 1000);
  if (Number.isNaN(s)) return "at an unknown time";
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

function Header({ data }: { data: DashboardData }) {
  const now = useNow();
  const h = data.header;
  return (
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">Cash health, next 13 weeks</p>
        <h1 className="mt-1 text-3xl font-medium tracking-tight">
          {h?.name ?? <Skeleton className="h-9 w-56" />}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {h ? (
            <>
              {h.asOf ? <>As of {formatDate(h.asOf)} · </> : null}
              Books updated {ago(h.updatedAt, now)} from {h.tools.connected} connected tool
              {h.tools.connected === 1 ? "" : "s"}
            </>
          ) : (
            "Loading the latest books"
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {h ? <AgentStatus agent={h.agent} /> : null}
        <SourceBadge data={data} />
      </div>
    </header>
  );
}

function AgentStatus({ agent }: { agent: DashboardHeader["agent"] }) {
  const text =
    agent.state === "on"
      ? `Agent on · checks every ${Math.round((agent.intervalMs ?? 0) / 1000)} s`
      : agent.state === "failed"
        ? "Agent's last check failed"
        : agent.state === "idle"
          ? "Agent idle · checks when asked"
          : "Agent not running in demo";
  return (
    <Link
      href="/field/map"
      title={agent.lastError ?? undefined}
      className={cn(
        "inline-flex min-h-8 items-center gap-2 rounded-full border px-3 text-xs text-muted-foreground transition-colors hover:text-foreground",
        focusRing,
      )}
    >
      <span className="relative flex size-2" aria-hidden="true">
        {agent.state === "on" ? (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60 motion-reduce:hidden" />
        ) : null}
        <span
          className={cn(
            "relative inline-flex size-2 rounded-full",
            agent.state === "on" && "bg-primary",
            agent.state === "failed" && "bg-destructive",
            (agent.state === "idle" || agent.state === "demo") && "bg-muted-foreground",
          )}
        />
      </span>
      {text}
    </Link>
  );
}

function SourceBadge({ data }: { data: DashboardData }) {
  if (data.source === "live")
    return (
      <Badge variant="outline" className="gap-1.5 font-normal">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
        Live
      </Badge>
    );
  if (data.source === "loading")
    return (
      <Badge variant="outline" className="font-normal text-muted-foreground">
        Connecting...
      </Badge>
    );
  return (
    <Badge variant="outline" title={data.note} className="border-dashed font-normal text-clay">
      Demo data · {data.note.toLowerCase()}
    </Badge>
  );
}

function SampleTag() {
  return (
    <span
      title="This section will show the Timeline lane's results once they are connected"
      className="inline-flex shrink-0 items-center rounded border border-dashed border-clay/60 px-1.5 py-0.5 text-[11px] leading-4 text-clay"
    >
      Sample data until Timeline is connected
    </span>
  );
}

function SectionTitle({
  title,
  tag,
  action,
}: { title: string; tag?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-medium">{title}</h2>
        {tag}
      </div>
      {action}
    </div>
  );
}

// ---------- 2. Health hero ----------

const HEALTH: Record<
  Health,
  { label: string; icon: typeof CircleCheck; tone: string; ring: string }
> = {
  ok: {
    label: "OK",
    icon: CircleCheck,
    tone: "text-primary",
    ring: "border-primary/40 bg-primary/10",
  },
  watch: { label: "Watch", icon: Eye, tone: "text-clay", ring: "border-clay/50 bg-clay/10" },
  at_risk: {
    label: "At risk",
    icon: TriangleAlert,
    tone: "text-destructive",
    ring: "border-destructive/50 bg-destructive/10",
  },
};

export function healthWords(view: DashboardView): { sentence: string; action: string | null } {
  const { health, lenderMinimum } = view;
  const floor = lenderMinimum ? "the lender's minimum" : "zero";
  const week = health.week ? formatDate(health.week) : "";
  if (health.rating === "at_risk")
    return {
      sentence: `Usable cash falls below ${floor} in the week of ${week}${
        health.line
          ? `, when ${health.line.label.toLowerCase()} of ${formatCents(health.line.cents)} goes out`
          : ""
      }.`,
      action: `Line up at least ${formatCents(health.cents)} before the week of ${week}, or try a fix on the timeline.`,
    };
  if (health.rating === "watch")
    return {
      sentence: `Cash stays above ${floor}, but the room shrinks to ${formatCents(health.cents)} in the week of ${week}.`,
      action: "Review the biggest outflows before that week.",
    };
  return {
    sentence: `Usable cash stays at least ${formatCents(health.cents)} above ${floor} for all 13 weeks.`,
    action: null,
  };
}

function HealthHero({ view }: { view: DashboardView }) {
  const meta = HEALTH[view.health.rating];
  const Icon = meta.icon;
  const words = healthWords(view);
  return (
    <Card className="relative overflow-hidden p-[var(--card-pad)]">
      <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div
            className={cn(
              "flex size-14 shrink-0 items-center justify-center rounded-2xl border",
              meta.ring,
            )}
          >
            <Icon className={cn("size-7", meta.tone)} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className={cn("text-2xl font-semibold tracking-tight", meta.tone)}>{meta.label}</p>
              <SampleTag />
            </div>
            <p className="mt-1 max-w-2xl text-lg leading-7">{words.sentence}</p>
            {words.action ? (
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                <span className="font-medium text-foreground">What to do: </span>
                {words.action}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            href="/c/kestrel"
            className={cn(
              "inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90",
              focusRing,
            )}
          >
            Try fixes on the timeline
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </Card>
  );
}

// ---------- 3. Tiles ----------

function Tile({
  label,
  value,
  sub,
  tone,
}: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-2 text-2xl font-semibold tabular-nums tracking-tight", tone)}>{value}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{sub}</p>
    </Card>
  );
}

function Tiles({ view }: { view: DashboardView }) {
  const min = view.lenderMinimum;
  const low = view.lowest;
  const below = (c: number | null) => (c !== null && c < 0 ? "text-destructive" : undefined);
  return (
    <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Tile
        label="Cash today"
        value={formatCents(view.cashToday)}
        sub={`${formatCents(view.usableToday)} usable; ${formatCents(view.restrictedCash)} is held back`}
      />
      <Tile
        label="Lowest usable cash, 13 weeks"
        value={low ? formatCents(low.usable) : "None"}
        sub={low ? `Week of ${formatDate(low.weekStart)}` : "No forecast weeks"}
        tone={min && low && low.usable < min.cents ? "text-destructive" : undefined}
      />
      <Tile
        label="Room above the minimum"
        value={view.roomAtLow === null ? "No minimum" : formatCents(view.roomAtLow)}
        sub={
          min && view.roomToday !== null
            ? `At the low point. Today ${formatCents(view.roomToday)}; lender's minimum ${formatCents(min.cents)}`
            : "No lender's minimum on file"
        }
        tone={below(view.roomAtLow)}
      />
      <Tile
        label="Runway"
        value={view.runway.weeks === null ? "Not burning" : `${view.runway.weeks} weeks`}
        sub={
          view.runway.weeks === null
            ? `Cash grew over the last ${view.runway.basisWeeks} full weeks`
            : `At ${formatCents(view.runway.weeklyBurn)} a week, last ${view.runway.basisWeeks} full weeks`
        }
      />
      <Tile
        label="13-week net change"
        value={`${view.netChange13 > 0 ? "+" : ""}${formatCents(view.netChange13)}`}
        sub="Projected money in minus money out"
        tone={view.netChange13 < 0 ? "text-destructive" : "text-primary"}
      />
    </section>
  );
}

// ---------- 4. Cash flow statement ----------

function CashFlowSection({ view }: { view: DashboardView }) {
  const totals = [
    { label: "Operating", cents: view.totals.operating },
    { label: "Investing", cents: view.totals.investing },
    { label: "Financing", cents: view.totals.financing },
  ];
  return (
    <Card className="p-[var(--card-pad)]">
      <SectionTitle
        title="Cash flow, next 13 weeks"
        action={
          view.unclassified > 0 ? (
            <span className="text-xs text-clay">
              {view.unclassified} entries could not be classified
            </span>
          ) : null
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
          <CashFlowBars bars={view.bars} />
        </div>
        <div className="space-y-5">
          <dl className="grid grid-cols-3 gap-2 lg:grid-cols-1">
            {totals.map((t) => (
              <div key={t.label} className="rounded-lg border bg-muted/30 px-3 py-2">
                <dt className="text-xs text-muted-foreground">{t.label}</dt>
                <dd
                  className={cn(
                    "text-lg font-semibold tabular-nums",
                    t.cents < 0 && "text-destructive",
                  )}
                >
                  {formatCents(t.cents)}
                </dd>
              </div>
            ))}
          </dl>
          <div>
            <p className="mb-2 text-xs text-muted-foreground">Biggest lines</p>
            <ul className="space-y-1.5 text-sm">
              {view.biggestLines.map((l) => (
                <li key={l.id} className="flex items-baseline justify-between gap-3">
                  <span className="truncate">{l.label}</span>
                  <span
                    className={cn(
                      "shrink-0 tabular-nums",
                      l.cents < 0 ? "text-muted-foreground" : "text-primary",
                    )}
                  >
                    {formatCents(l.cents)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ---------- 5. Cash line ----------

function CashLineSection({ view }: { view: DashboardView }) {
  return (
    <Link
      href="/c/kestrel"
      aria-label="Open the 13-week timeline"
      className={cn("group block rounded-xl", focusRing)}
    >
      <Card className="p-[var(--card-pad)] transition-colors group-hover:border-primary/60">
        <SectionTitle
          title="Usable cash, next 13 weeks"
          action={
            <span className="inline-flex items-center gap-1 text-sm text-muted-foreground group-hover:text-foreground">
              Open the timeline
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </span>
          }
        />
        <CashLine
          points={view.cashLine}
          minimum={view.lenderMinimum?.cents ?? null}
          markers={view.markers}
          breach={view.firstBreach}
        />
      </Card>
    </Link>
  );
}

// ---------- 6. Coming up ----------

const KIND_LABEL = {
  receivable: "Customer payment",
  payable: "Bill",
  payroll: "Payroll",
  other: "Other",
};

function ComingUp({ view }: { view: DashboardView }) {
  const n = view.next2Weeks;
  return (
    <section aria-labelledby="coming-up">
      <h2 id="coming-up" className="mb-3 text-base font-medium">
        Coming up
      </h2>
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="p-4">
          <p className="text-sm font-medium">Next 2 weeks, scheduled</p>
          <p className="text-xs text-muted-foreground">
            Weeks of {formatDate(n.weeks[0] ?? view.forecastStart)} and{" "}
            {formatDate(n.weeks[1] ?? view.forecastStart)}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg border bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">Money in</p>
              <p className="text-lg font-semibold tabular-nums text-primary">
                {formatCents(n.inflows)}
              </p>
            </div>
            <div className="rounded-lg border bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">Money out</p>
              <p className="text-lg font-semibold tabular-nums">{formatCents(n.outflows)}</p>
            </div>
          </div>
          <ul className="mt-3 divide-y text-sm">
            {n.items.map((i) => (
              <li key={i.id} className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate">
                  {i.counterparty}
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {KIND_LABEL[i.kind]}
                    {i.status === "at_risk" ? " · overdue" : ""}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 tabular-nums",
                    i.cents > 0 ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {formatCents(i.cents)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-4">
          <p className="text-sm font-medium">Overdue customer payments</p>
          <p className="text-xs text-muted-foreground">
            {view.overdue.count === 0
              ? "No customer is past due"
              : `${view.overdue.count} invoice${view.overdue.count === 1 ? "" : "s"}, ${formatCents(view.overdue.cents)} in total`}
          </p>
          <ul className="mt-3 space-y-2">
            {view.overdue.buckets.map((b) => {
              const share = view.overdue.cents > 0 ? b.cents / view.overdue.cents : 0;
              return (
                <li key={b.label} className="text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <span>{b.label} late</span>
                    <span className="tabular-nums text-muted-foreground">
                      {b.count > 0 ? `${b.count} · ${formatCents(b.cents)}` : "None"}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-muted" aria-hidden="true">
                    <div
                      className="h-1.5 rounded-full bg-clay"
                      style={{ width: `${Math.round(share * 100)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card className="p-4">
          <p className="text-sm font-medium">Bills due soon</p>
          <p className="text-xs text-muted-foreground">
            Unpaid, due in the next 14 days or already late
          </p>
          {view.billsDueSoon.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Nothing due in the next 14 days.</p>
          ) : (
            <ul className="mt-3 divide-y text-sm">
              {view.billsDueSoon.map((b) => (
                <li key={b.id} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="min-w-0 truncate">
                    {b.vendor}
                    <span
                      className={cn(
                        "ml-1.5 text-xs",
                        b.overdue ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {b.overdue ? "late" : formatDate(b.payOn)}
                      {b.critical ? " · must pay" : ""}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatCents(-b.cents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </section>
  );
}

// ---------- 7. Risks ----------

function Risks({ view }: { view: DashboardView }) {
  return (
    <section aria-label="Risks from auto-analysis">
      <SectionTitle title="Risks from auto-analysis" tag={<SampleTag />} />
      <div className="grid gap-3 lg:grid-cols-3">
        {view.risks.map((r) => (
          <Card key={r.id} className="flex flex-col p-4">
            <p className="text-sm font-medium leading-5">{r.title}</p>
            <p className={cn("mt-2 text-sm", r.failsWeek ? "text-destructive" : "text-primary")}>
              {r.failsWeek
                ? `Fails in the week of ${formatDate(r.failsWeek)}`
                : "Survives all 13 weeks"}
            </p>
            <p className="text-xs text-muted-foreground">
              Low point moves by{" "}
              <span className="tabular-nums text-foreground">{formatCents(r.impact)}</span>
            </p>
            {r.fix ? (
              <div className="mt-4 rounded-lg border border-dashed px-3 py-2 text-sm">
                <p>
                  {r.fix.label}:{" "}
                  <span className="font-medium tabular-nums">{formatCents(r.fix.cents)}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {r.fix.survives ? "Survives with this fix" : "Still short with this fix"} ·
                  awaiting your approval
                </p>
              </div>
            ) : null}
          </Card>
        ))}
      </div>
    </section>
  );
}

// ---------- 8. Attention ----------

function Attention({ header }: { header?: DashboardHeader }) {
  const open = header?.openFindings ?? 0;
  const urgent = header?.openEscalations ?? 0;
  return (
    <section
      aria-label="Needs your attention"
      className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
    >
      <Link href="/field" className={cn("group block rounded-xl", focusRing)}>
        <Card className="flex h-full items-center justify-between gap-4 p-4 transition-colors group-hover:border-primary/60">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl border bg-muted/40">
              <Flag
                className={cn("size-5", open > 0 ? "text-clay" : "text-muted-foreground")}
                aria-hidden="true"
              />
            </div>
            <div>
              <p className="font-medium">
                {open === 0
                  ? "Nothing needs your attention"
                  : `${open} open flag${open === 1 ? "" : "s"} to review`}
              </p>
              <p className="text-sm text-muted-foreground">
                {urgent > 0 ? `${urgent} marked urgent by the audit. ` : ""}Review flagged entries
                in the worker.
              </p>
            </div>
          </div>
          <ArrowRight
            className="size-5 shrink-0 text-primary transition-transform group-hover:translate-x-1 motion-reduce:transition-none"
            aria-hidden="true"
          />
        </Card>
      </Link>
      <Link href="/field/map" className={cn("group block rounded-xl", focusRing)}>
        <Card className="flex h-full items-center justify-between gap-4 p-4 transition-colors group-hover:border-primary/60">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl border bg-muted/40">
              <Network className="size-5 text-muted-foreground" aria-hidden="true" />
            </div>
            <div>
              <p className="font-medium">Brain map</p>
              <p className="text-sm text-muted-foreground">See every agent and tool at work</p>
            </div>
          </div>
          <ArrowRight
            className="size-5 shrink-0 text-primary transition-transform group-hover:translate-x-1 motion-reduce:transition-none"
            aria-hidden="true"
          />
        </Card>
      </Link>
    </section>
  );
}

// ---------- States ----------

function LoadingState() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-28 w-full rounded-xl" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  );
}

function Notice({
  title,
  children,
  tone,
}: { title: string; children: ReactNode; tone?: "danger" }) {
  return (
    <Card className={cn("p-[var(--card-pad)]", tone === "danger" && "border-destructive/50")}>
      <p className={cn("font-medium", tone === "danger" && "text-destructive")}>{title}</p>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{children}</p>
    </Card>
  );
}
