"use client";

import { ArrowRight, CircleCheck, Eye, Flag, Inbox, Network, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { formatDate } from "../../../lib/format";
import { cn } from "../../../lib/utils";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { PageHeader, Section, StatTile } from "../../ui/page";
import { Skeleton } from "../../ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../ui/table";
import { useIsReplayCompany, useSelectedCompanyName, useSelectedProfile } from "../company";
import { EmptyRow, Panel } from "../panel";
import { RewindDashboard } from "../rewind/RewindDashboard";
import { CashFlowBars, CashLine, FLOW_SECTIONS } from "./charts";
import {
  type DashboardData,
  DashboardDataProvider,
  type DashboardHeader,
  useDashboard,
} from "./data";
import type { DashboardView, Health } from "./derive";
import { formatCents } from "./money";
import { OUTCOME_WORDS, type RiskFeed } from "./risks";
import { TIMELINE_PENDING_TEXT, timelineHref } from "./timeline";

// Home dashboard: are we OK on cash for the next 13 weeks? If not, when does it break, why,
// and what do I do? Order: verdict and key numbers, usable-cash chart, main drivers, the
// detailed cash flow statement, then what is coming up and the risks.

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function Dashboard() {
  // 2U is a real company replayed from quarterly filings: its own quarterly rewind view.
  if (useIsReplayCompany()) return <RewindDashboard />;
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
    <div className="mx-auto max-w-[1200px] space-y-8">
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
        <Sections view={result.view} header={data.header} risks={data.risks} />
      )}
    </div>
  );
}

function Sections({
  view,
  header,
  risks,
}: { view: DashboardView; header?: DashboardHeader; risks?: RiskFeed }) {
  return (
    <>
      <div className="space-y-4">
        <HealthBanner view={view} />
        <Tiles view={view} />
      </div>
      <CashLineSection view={view} />
      <Drivers view={view} />
      <CashFlowSection view={view} />
      <ComingUp view={view} />
      {risks ? <Risks feed={risks} /> : null}
      <Attention header={header} />
    </>
  );
}

// ---------- Shared bits ----------

/** Provenance only: neutral badges. Green and amber are kept for financial status. */
function ProvenanceBadge({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <Badge variant="secondary" title={title} className="font-normal">
      {children}
      {title ? <span className="sr-only">: {title}</span> : null}
    </Badge>
  );
}

/** A visible 13px note for a section whose content is not backed by real analysis. */
function Illustrative({ children }: { children: ReactNode }) {
  return (
    <p className="text-[13px] leading-5 text-muted-foreground">
      <span className="font-medium text-foreground">Illustrative.</span> {children}
    </p>
  );
}

/**
 * The timeline button for the selected company. The Timeline cannot open the simulated
 * companies yet, so this is a disabled button saying so rather than a link to another company.
 */
function TimelineAction({ variant }: { variant: "default" | "outline" }) {
  const href = timelineHref(useSelectedProfile());
  if (!href)
    return (
      <Button variant="outline" disabled className="h-11 shrink-0 sm:h-[var(--control-h)]">
        {TIMELINE_PENDING_TEXT}
      </Button>
    );
  return (
    <Button asChild variant={variant} className="h-11 shrink-0 sm:h-[var(--control-h)]">
      <Link href={href}>
        Try fixes on the timeline
        <ArrowRight aria-hidden="true" />
      </Link>
    </Button>
  );
}

/** KPI value at 24px on mobile and 28px from md up. */
const Big = ({ children }: { children: ReactNode }) => (
  <span className="text-2xl md:text-[28px] md:leading-9">{children}</span>
);

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
  const company = useSelectedCompanyName();
  const h = data.header;
  return (
    <PageHeader
      eyebrow={
        <span className="flex flex-wrap items-center gap-2">
          Cash health, next 13 weeks
          <ProvenanceBadge title="A made-up company generated by the Domino simulator, not a real business">
            Simulated company
          </ProvenanceBadge>
          <ProvenanceBadge title={data.note}>
            {data.source === "live"
              ? "Live feed"
              : data.source === "demo"
                ? "Demo data"
                : "Connecting..."}
          </ProvenanceBadge>
        </span>
      }
      title={h?.name ?? (data.source === "loading" ? <Skeleton className="h-9 w-56" /> : company)}
      description={
        h ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {h.asOf ? (
              <>
                <span>
                  As of <span className="text-foreground">{formatDate(h.asOf)}</span>
                </span>
                <Dot />
              </>
            ) : null}
            {data.source === "demo" ? (
              <span>Sample books from the simulator, not read from a live feed</span>
            ) : (
              <>
                <span>Books updated {ago(h.updatedAt, now)}</span>
                <Dot />
                <span>
                  {h.tools.connected} of {h.tools.total} tools connected
                  {h.tools.off.length > 0
                    ? ` (${h.tools.off.join(", ")} not read since disconnected)`
                    : ""}
                </span>
              </>
            )}
          </span>
        ) : (
          "Loading the latest books"
        )
      }
      actions={h ? <AgentStatus agent={h.agent} /> : null}
    />
  );
}

function Dot() {
  return (
    <span aria-hidden="true" className="text-border">
      •
    </span>
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
        "inline-flex h-11 items-center gap-2 rounded-md border bg-card px-2.5 text-[13px] text-muted-foreground shadow-xs transition-colors hover:bg-accent hover:text-foreground sm:h-8",
        focusRing,
      )}
    >
      <span className="relative flex size-2" aria-hidden="true">
        {agent.state === "on" ? (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-safe opacity-50 motion-reduce:hidden" />
        ) : null}
        <span
          className={cn(
            "relative inline-flex size-2 rounded-full",
            agent.state === "on" && "bg-safe",
            agent.state === "failed" && "bg-destructive",
            (agent.state === "idle" || agent.state === "demo") && "bg-muted-foreground/50",
          )}
        />
      </span>
      {text}
    </Link>
  );
}

// ---------- 2. Verdict ----------

const HEALTH: Record<
  Health,
  {
    label: string;
    icon: typeof CircleCheck;
    tone: string;
    box: string;
    badge: "success" | "warning" | "destructive";
  }
> = {
  ok: {
    label: "On track",
    icon: CircleCheck,
    tone: "text-safe",
    box: "border-safe/25 bg-safe/[0.04]",
    badge: "success",
  },
  watch: {
    label: "Watch",
    icon: Eye,
    tone: "text-warning",
    box: "border-warning/30 bg-warning/[0.05]",
    badge: "warning",
  },
  at_risk: {
    label: "At risk",
    icon: TriangleAlert,
    tone: "text-destructive",
    box: "border-destructive/20 bg-destructive/[0.03]",
    badge: "destructive",
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
      action: `Line up at least ${formatCents(health.cents)} before the week of ${week}.`,
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

function HealthBanner({ view }: { view: DashboardView }) {
  const meta = HEALTH[view.health.rating];
  const Icon = meta.icon;
  const words = healthWords(view);
  return (
    <section
      aria-label="Cash health"
      className={cn(
        "flex flex-col gap-4 rounded-lg border p-4 md:flex-row md:items-center md:justify-between md:p-5",
        meta.box,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <Icon className={cn("mt-0.5 size-5 shrink-0", meta.tone)} aria-hidden="true" />
        <div className="min-w-0">
          <Badge variant={meta.badge} className="font-semibold">
            {meta.label}
          </Badge>
          <p className="mt-2 max-w-3xl text-[15px] font-medium leading-6 text-foreground">
            {words.sentence}
          </p>
          {words.action ? (
            <p className="mt-0.5 max-w-3xl text-sm leading-6 text-muted-foreground">
              {words.action}
            </p>
          ) : null}
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
            Rated from the lowest projected cash against{" "}
            {view.lenderMinimum ? "the lender's minimum" : "zero"}.
          </p>
        </div>
      </div>
      <div className="self-start md:self-center">
        <TimelineAction variant="default" />
      </div>
    </section>
  );
}

// ---------- 3. Key numbers ----------

function Tiles({ view }: { view: DashboardView }) {
  const min = view.lenderMinimum;
  const low = view.lowest;
  const lowBelow = Boolean(min && low && low.usable < min.cents);
  const room = view.roomAtLow;
  return (
    <section aria-label="Key numbers" className="grid gap-3 sm:grid-cols-3">
      <StatTile
        label="Usable cash today"
        value={<Big>{formatCents(view.usableToday)}</Big>}
        delta={`${formatCents(view.cashToday)} in the bank · ${formatCents(view.restrictedCash)} held back`}
      />
      <StatTile
        label="Lowest projected cash"
        value={<Big>{low ? formatCents(low.usable) : "None"}</Big>}
        delta={
          low
            ? `Week of ${formatDate(low.weekStart)}${
                min ? ` · ${lowBelow ? "below" : "above"} the minimum` : ""
              }`
            : "No forecast weeks"
        }
        tone={lowBelow ? "negative" : "neutral"}
      />
      {min && room !== null ? (
        <StatTile
          label={
            room < 0 ? "Shortfall below the lender's minimum" : "Buffer above the lender's minimum"
          }
          value={<Big>{formatCents(Math.abs(room))}</Big>}
          delta={`At the lowest projected week, against ${formatCents(min.cents)}`}
          tone={room < 0 ? "negative" : "neutral"}
        />
      ) : (
        <StatTile
          label="Lender's minimum"
          value={<Big>None on file</Big>}
          delta="Cash is compared with zero instead"
        />
      )}
    </section>
  );
}

// ---------- 4. Usable cash chart ----------

function CashLineSection({ view }: { view: DashboardView }) {
  return (
    <Section
      title="Usable cash, next 13 weeks"
      description={
        view.lenderMinimum
          ? `Cash you can spend at the end of each week, against the lender's ${formatCents(view.lenderMinimum.cents)} minimum.`
          : "Cash you can spend at the end of each week."
      }
    >
      <CashLine
        points={view.cashLine}
        minimum={view.lenderMinimum?.cents ?? null}
        markers={view.markers}
        breach={view.firstBreach}
      />
    </Section>
  );
}

// ---------- 5. Main drivers ----------

function runwayWords(view: DashboardView): string {
  const r = view.runway;
  if (r.weeks === null)
    return `No burn-based runway: cash grew over the last ${r.basisWeeks} full weeks.`;
  const lasts = r.weeks > 52 ? "more than a year" : `about ${r.weeks} weeks`;
  return `At the average net outflow of ${formatCents(r.weeklyBurn)} a week over the last ${r.basisWeeks} full weeks, cash would last ${lasts}. This is a simple average, not the forecast above.`;
}

function Drivers({ view }: { view: DashboardView }) {
  const net = view.netChange13;
  return (
    <Section
      title="Main drivers, next 13 weeks"
      description="The biggest forecast lines and how each activity adds up."
      flush
    >
      <div className="grid lg:grid-cols-2">
        <div className="min-w-0">
          <div className="px-4 pb-1 pt-4 text-xs font-medium text-muted-foreground">
            Biggest lines
          </div>
          <Table>
            <TableBody>
              {view.biggestLines.map((l) => (
                <TableRow key={l.id} className="hover:bg-transparent">
                  <TableCell className="h-10 max-w-0 truncate py-1.5">{l.label}</TableCell>
                  <TableCell
                    className={cn(
                      "h-10 w-32 py-1.5 text-right font-medium",
                      l.cents > 0 ? "text-safe" : "text-foreground",
                    )}
                  >
                    {l.cents > 0 ? "+" : ""}
                    {formatCents(l.cents)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="min-w-0 border-t lg:border-l lg:border-t-0">
          <div className="px-4 pb-1 pt-4 text-xs font-medium text-muted-foreground">
            By activity
          </div>
          <Table>
            <TableBody>
              {FLOW_SECTIONS.map((s) => (
                <TableRow key={s.key} className="hover:bg-transparent">
                  <TableCell className="h-10 py-1.5">
                    <span className="inline-flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="size-2.5 rounded-[3px]"
                        style={{ background: s.color }}
                      />
                      {s.label}
                    </span>
                  </TableCell>
                  <TableCell className="h-10 w-32 py-1.5 text-right font-medium">
                    {formatCents(view.totals[s.key])}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableCell className="h-10 py-1.5 font-medium">
                  Forecast net change, money in minus out
                </TableCell>
                <TableCell className="h-10 py-1.5 text-right font-semibold">
                  {net > 0 ? "+" : ""}
                  {formatCents(net)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>
      <p className="border-t px-4 py-3 text-[13px] leading-5 text-muted-foreground">
        {runwayWords(view)}
      </p>
    </Section>
  );
}

// ---------- 6. Cash flow statement ----------

function CashFlowSection({ view }: { view: DashboardView }) {
  return (
    <Section
      title="Cash flow statement"
      description="Net cash by week for the last 4 weeks and the next 13, split by activity."
      actions={
        view.unclassified > 0 ? (
          <Badge variant="warning" className="font-normal">
            {view.unclassified} entries could not be classified
          </Badge>
        ) : null
      }
    >
      <CashFlowBars bars={view.bars} />
    </Section>
  );
}

// ---------- 7. Coming up ----------

const KIND_LABEL = {
  receivable: "Customer payment",
  payable: "Bill",
  payroll: "Payroll",
  other: "Other",
};

function Money({ cents, signed = true }: { cents: number; signed?: boolean }) {
  return (
    <span className={cn("tabular-nums", cents > 0 ? "text-safe" : "text-foreground")}>
      {signed && cents > 0 ? "+" : ""}
      {formatCents(cents)}
    </span>
  );
}

function ComingUp({ view }: { view: DashboardView }) {
  const n = view.next2Weeks;
  const w0 = formatDate(n.weeks[0] ?? view.forecastStart);
  const w1 = formatDate(n.weeks[1] ?? view.forecastStart);
  return (
    <Section
      title="Coming up"
      description={`Scheduled for the weeks of ${w0} and ${w1}.`}
      card={false}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel
          title="Scheduled, next 2 weeks"
          aside={
            <dl className="flex gap-4 text-right text-[13px]">
              <div>
                <dt className="text-muted-foreground">Money in</dt>
                <dd className="font-semibold tabular-nums text-safe">+{formatCents(n.inflows)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Money out</dt>
                <dd className="font-semibold tabular-nums">{formatCents(n.outflows)}</dd>
              </div>
            </dl>
          }
        >
          {n.items.length === 0 ? (
            <EmptyRow icon={<Inbox />}>Nothing scheduled in the next 2 weeks.</EmptyRow>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Week of</TableHead>
                  <TableHead>Counterparty</TableHead>
                  <TableHead className="hidden sm:table-cell">Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...n.items]
                  .sort((a, b) => a.dueWeek.localeCompare(b.dueWeek))
                  .map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(i.dueWeek)}
                      </TableCell>
                      <TableCell className="max-w-0 w-full">
                        <span className="block truncate font-medium">{i.counterparty}</span>
                        <span className="block truncate text-xs text-muted-foreground sm:hidden">
                          {KIND_LABEL[i.kind]}
                        </span>
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap sm:table-cell">
                        <span className="text-muted-foreground">{KIND_LABEL[i.kind]}</span>
                        {i.status === "at_risk" ? (
                          <Badge variant="warning" className="ml-2">
                            Overdue
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <Money cents={i.cents} />
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          )}
        </Panel>
        <div className="flex min-w-0 flex-col gap-4">
          <Panel
            title="Bills due soon"
            description="Unpaid, due in the next 14 days or already late"
          >
            {view.billsDueSoon.length === 0 ? (
              <EmptyRow icon={<Inbox />}>Nothing due in the next 14 days.</EmptyRow>
            ) : (
              <Table>
                <TableBody>
                  {view.billsDueSoon.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="w-full max-w-0">
                        <span className="block truncate font-medium">{b.vendor}</span>
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {b.overdue ? (
                            <span className="text-destructive">Late</span>
                          ) : (
                            <>Pay by {formatDate(b.payOn)}</>
                          )}
                          {b.critical ? (
                            <>
                              <Dot />
                              Must pay
                            </>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        {formatCents(-b.cents)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>
          <Panel
            title="Overdue customer payments"
            aside={
              <span className="text-[13px] tabular-nums text-muted-foreground">
                {view.overdue.count === 0
                  ? "None past due"
                  : `${view.overdue.count} · ${formatCents(view.overdue.cents)}`}
              </span>
            }
            padded
          >
            <ul className="space-y-3">
              {view.overdue.buckets.map((b) => {
                const share = view.overdue.cents > 0 ? b.cents / view.overdue.cents : 0;
                return (
                  <li key={b.label} className="text-sm">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-muted-foreground">{b.label} late</span>
                      <span className="tabular-nums">
                        {b.count > 0 ? (
                          <>
                            <span className="text-muted-foreground">{b.count} · </span>
                            {formatCents(b.cents)}
                          </>
                        ) : (
                          <span className="text-muted-foreground">None</span>
                        )}
                      </span>
                    </div>
                    {view.overdue.cents > 0 ? (
                      <div className="mt-1.5 h-1 rounded-full bg-muted" aria-hidden="true">
                        <div
                          className="h-1 rounded-full bg-warning"
                          style={{ width: `${Math.round(share * 100)}%` }}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      </div>
    </Section>
  );
}

// ---------- 8. Risks ----------

function Risks({ feed }: { feed: RiskFeed }) {
  const analyst = feed.source === "analyst";
  return (
    <Section
      title={analyst ? "Risks the analyst found" : "Risks to watch"}
      description="What happens to the lowest projected cash if each event comes true, and a fix to try."
      card={false}
    >
      {analyst ? (
        <p className="text-[13px] leading-5 text-muted-foreground">
          From the analyst's latest run
          {feed.asOf ? ` on the books as of ${formatDate(feed.asOf)}` : ""}: the{" "}
          {feed.cards.length === 1 ? "worst scenario" : `worst ${feed.cards.length}`} of{" "}
          {feed.total} it tested.
        </p>
      ) : (
        <Illustrative>
          Example events picked by a simple rule from these books. Each outcome is the real forecast
          with that change applied.
        </Illustrative>
      )}
      {feed.cards.length === 0 ? (
        <div className="rounded-lg border bg-card shadow-xs">
          <EmptyRow icon={<Inbox />}>No events to test on these books.</EmptyRow>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {feed.cards.map((r) => (
            <li
              key={r.id}
              className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card shadow-xs"
            >
              <div className="flex-1 space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Badge variant={r.outcome === "stays_above" ? "success" : "destructive"}>
                    {OUTCOME_WORDS[r.outcome]}
                  </Badge>
                  {r.week ? (
                    <span className="text-[13px] text-muted-foreground">
                      from the week of {formatDate(r.week)}
                    </span>
                  ) : null}
                </div>
                <p className="text-sm font-medium leading-5">{r.title}</p>
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="text-muted-foreground">Lowest projected cash moves by</span>
                  <span className="font-medium tabular-nums">{formatCents(r.impact)}</span>
                </div>
              </div>
              {r.fix ? (
                <div className="border-t bg-muted/40 px-4 py-3 text-[13px]">
                  <p>{r.fix.label}</p>
                  {r.fix.note ? <p className="mt-0.5 text-muted-foreground">{r.fix.note}</p> : null}
                  <p className={cn("mt-0.5", r.fix.holds ? "text-safe" : "text-destructive")}>
                    {r.fix.holds
                      ? analyst
                        ? "Stays within the lender's rules with this fix"
                        : "Stays above the lender's minimum with this fix"
                      : "Still short with this fix"}
                  </p>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---------- 9. Attention ----------

function Attention({ header }: { header?: DashboardHeader }) {
  const open = header?.openFindings ?? 0;
  const urgent = header?.openEscalations ?? 0;
  return (
    <section
      aria-label="Needs your attention"
      className="grid overflow-hidden rounded-lg border bg-card shadow-xs md:grid-cols-2"
    >
      <AttentionLink
        href="/field"
        icon={<Flag className={open > 0 ? "text-warning" : undefined} />}
        title={
          open === 0
            ? "Nothing needs your attention"
            : `${open} open flag${open === 1 ? "" : "s"} to review`
        }
        body={`${urgent > 0 ? `${urgent} marked urgent by the audit. ` : ""}Review flagged entries in the worker.`}
      />
      <AttentionLink
        href="/field/map"
        icon={<Network />}
        title="Brain map"
        body="See every agent and tool at work"
        className="border-t md:border-l md:border-t-0"
      />
    </section>
  );
}

function AttentionLink({
  href,
  icon,
  title,
  body,
  className,
}: { href: string; icon: ReactNode; title: string; body: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center gap-3 px-4 py-4 transition-colors hover:bg-muted/50",
        focusRing,
        "focus-visible:-outline-offset-2",
        className,
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground [&_svg]:size-4">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-[13px] text-muted-foreground">{body}</span>
      </span>
      <ArrowRight
        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none"
        aria-hidden="true"
      />
    </Link>
  );
}

// ---------- States ----------

function LoadingState() {
  return (
    <div className="space-y-4" aria-busy="true">
      <p className="text-sm text-muted-foreground">Reading the latest books...</p>
      <Skeleton className="h-24 w-full rounded-lg" />
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[108px] rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-80 w-full rounded-lg" />
    </div>
  );
}

function Notice({
  title,
  children,
  tone,
}: { title: string; children: ReactNode; tone?: "danger" }) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-[var(--card-pad)] shadow-xs",
        tone === "danger" && "border-destructive/30 bg-destructive/[0.04]",
      )}
    >
      <p className={cn("text-[15px] font-semibold", tone === "danger" && "text-destructive")}>
        {title}
      </p>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{children}</p>
    </div>
  );
}
