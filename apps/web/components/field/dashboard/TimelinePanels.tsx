"use client";

import { ArrowRight, CircleCheck, Eye, Inbox, Loader2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatDate } from "../../../lib/format";
import { cn } from "../../../lib/utils";
import type { FinancialOutput } from "../../timeline/analysis/output";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Section } from "../../ui/page";
import { OpenInTimeline } from "../OpenInTimeline";
import { EmptyRow } from "../panel";
import { CashLine } from "./charts";
import type { Health, Marker } from "./derive";
import { formatCents } from "./money";
import {
  type TimelineLink,
  type TimelineRead,
  cashMinimum,
  type firstBreach,
  timelineAnalysisHref,
  timelineCashLine,
  timelineHealth,
  timelineRiskCards,
} from "./timeline";

// Dashboard parts read from the selected company's saved Timeline run. Timeline is the source
// of truth for the health rating, the 13-week chart and the saved risk scenarios; Field's own
// derivation is the labelled fallback until a Timeline run exists.

const TONE: Record<Health, { label: string; icon: typeof CircleCheck; tone: string; box: string }> =
  {
    ok: {
      label: "On track",
      icon: CircleCheck,
      tone: "text-safe",
      box: "border-safe/25 bg-safe/[0.04]",
    },
    watch: {
      label: "Watch",
      icon: Eye,
      tone: "text-warning",
      box: "border-warning/30 bg-warning/[0.05]",
    },
    at_risk: {
      label: "At risk",
      icon: TriangleAlert,
      tone: "text-destructive",
      box: "border-destructive/20 bg-destructive/[0.03]",
    },
  };
const BADGE: Record<Health, "success" | "warning" | "destructive"> = {
  ok: "success",
  watch: "warning",
  at_risk: "destructive",
};

const week = (iso: string | null) => (iso ? formatDate(iso) : "an unknown week");

/** Plain words for one saved rule receipt that broke. */
function breachWords(r: ReturnType<typeof firstBreach>): string | null {
  if (!r) return null;
  if (r.kind === "min_cash")
    return `Usable cash falls below ${r.label.toLowerCase()} of ${formatCents(r.limit)} in the week of ${week(r.weekStart)}${
      r.shortfall !== null ? `, short by ${formatCents(Math.abs(r.shortfall))}` : ""
    }.`;
  if (r.kind === "min_runway_months")
    return `${r.label} breaks in the week of ${week(r.weekStart)}: runway ${
      r.value !== null ? `of ${r.value.toFixed(1)} months ` : ""
    }is under the ${r.limit} months required.`;
  return `${r.label} is not met by its allowed date${r.date ? ` (${formatDate(r.date)})` : ""}.`;
}

/** Link to the saved run. Fixes are modeled from the Worker's recommended fixes, so the
 * dashboard no longer links straight to the risk-analysis page (still reachable by URL). */
export function TimelineLinks({ link }: { link: TimelineLink }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild className="h-11 shrink-0 sm:h-[var(--control-h)]">
        <Link href={link.route}>
          Open in forecast
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    </div>
  );
}

/** Where a timeline action goes: the saved run, or a fresh import when there is none yet. */
export function TimelineActions({ timeline }: { timeline?: TimelineRead }) {
  const link = timeline && timeline.state !== "none" ? timeline.link : undefined;
  if (link?.current) return <TimelineLinks link={link} />;
  return (
    <div className="flex flex-wrap items-start gap-2">
      <OpenInTimeline label={link ? "Open latest books in forecast" : "Open in forecast"} />
      {link ? (
        <Button asChild variant="outline" className="h-11 shrink-0 sm:h-[var(--control-h)]">
          <Link href={link.route}>Previous run</Link>
        </Button>
      ) : null}
    </div>
  );
}

function RunNote({ link }: { link: TimelineLink }) {
  return (
    <>
      From the saved Timeline run on the books as of {formatDate(link.asOf)}
      {link.current ? "" : " (Field has newer books; open them in Timeline to refresh)"}.
    </>
  );
}

export function TimelineHealthBanner({
  output,
  timeline,
}: {
  output: FinancialOutput;
  timeline: Extract<TimelineRead, { state: "ready" }>;
}) {
  const h = timelineHealth(output);
  const meta = TONE[h.rating];
  const Icon = meta.icon;
  const words =
    breachWords(h.breach) ??
    (h.rating === "at_risk"
      ? `Usable cash goes below zero; the lowest is ${formatCents(h.lowPoint.usable)} in the week of ${week(h.lowPoint.weekStart)}.`
      : h.rating === "watch"
        ? h.unknownRules > 0
          ? `No rule breaks where Timeline could check, but ${h.unknownRules} rule${h.unknownRules === 1 ? "" : "s"} could not be checked in 13 weeks. Lowest usable cash ${formatCents(h.lowPoint.usable)}, week of ${week(h.lowPoint.weekStart)}.`
          : `No rules are on file, so nothing was checked. Lowest usable cash ${formatCents(h.lowPoint.usable)}, week of ${week(h.lowPoint.weekStart)}.`
        : `Every stated rule holds for 13 weeks. Lowest usable cash ${formatCents(h.lowPoint.usable)}, week of ${week(h.lowPoint.weekStart)}.`);
  return (
    <section
      aria-label="Cash health"
      data-testid="timeline-health"
      className={cn(
        "flex flex-col gap-4 rounded-lg border p-4 md:flex-row md:items-center md:justify-between md:p-5",
        meta.box,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <Icon className={cn("mt-0.5 size-5 shrink-0", meta.tone)} aria-hidden="true" />
        <div className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={BADGE[h.rating]} className="font-semibold">
              {meta.label}
            </Badge>
            <Badge variant="secondary" className="font-normal" title={h.scope}>
              Simulated
            </Badge>
          </span>
          <p className="mt-2 max-w-3xl text-[15px] font-medium leading-6 text-foreground">
            {words}
          </p>
          <p className="mt-1 max-w-3xl text-[13px] leading-5 text-muted-foreground">
            <RunNote link={timeline.link} /> Checked against the rules saved with that run, at each
            week's close. Not a compliance certificate.
          </p>
        </div>
      </div>
      <div className="self-start md:self-center">
        <TimelineActions timeline={timeline} />
      </div>
    </section>
  );
}

export function TimelineCashLineSection({
  output,
  asOf,
  markers,
}: { output: FinancialOutput; asOf: string; markers: Marker[] }) {
  const min = cashMinimum(output.receipts);
  const breach = output.receipts.find((r) => r.kind === "min_cash" && r.status === "breached");
  return (
    <Section
      title="Usable cash, next 13 weeks"
      description={`From the saved Timeline run: cash you can spend at the end of each week${
        min ? `, against ${min.label.toLowerCase()} of ${formatCents(min.cents)}` : ""
      }.`}
    >
      <CashLine
        points={timelineCashLine(output, asOf)}
        minimum={min?.cents ?? null}
        markers={markers}
        breach={breach?.weekStart ?? null}
      />
    </Section>
  );
}

function Loading({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-4 text-sm text-muted-foreground shadow-xs">
      <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
      {children}
    </div>
  );
}

/** TL7's saved risk scenarios and tested responses: the dashboard's source of truth for risks. */
export function TimelineRisks({
  timeline,
}: { timeline: Extract<TimelineRead, { state: "ready" }> }) {
  const { link, analysis, output } = timeline;
  const href = timelineAnalysisHref(link);
  const head = (
    <p className="text-[13px] leading-5 text-muted-foreground">
      Timeline's automatic analysis of the saved run: each risk is a saved hypothetical scenario
      calculated by the engine, with the best response it tested. Weights are stated assumptions,
      not probabilities. A person approves every action; nothing runs automatically.
    </p>
  );
  let body: ReactNode;
  if (!analysis)
    body = (
      <div className="rounded-lg border bg-card shadow-xs">
        <EmptyRow icon={<Inbox />}>
          {link.analysisError
            ? `Timeline's analysis did not start: ${link.analysisError}`
            : "No saved analysis for this run yet."}{" "}
          <Link href={href} className="text-primary underline-offset-2 hover:underline">
            Review the analysis
          </Link>
        </EmptyRow>
      </div>
    );
  else if (analysis.status === "queued" || analysis.status === "running")
    body = <Loading>Timeline is testing risks and responses on the saved run...</Loading>;
  else if (analysis.status === "failed" || !output)
    body = (
      <div className="rounded-lg border bg-card shadow-xs">
        <EmptyRow icon={<Inbox />}>
          {analysis.status === "failed"
            ? `Timeline's analysis stopped (${analysis.errorCode ?? "failed"}).`
            : "The saved financial output could not be verified."}{" "}
          <Link href={href} className="text-primary underline-offset-2 hover:underline">
            Review or retry it on the timeline
          </Link>
        </EmptyRow>
      </div>
    );
  else {
    const cards = timelineRiskCards(analysis, output, link.timelineCompanyId);
    body =
      cards.length === 0 ? (
        <div className="rounded-lg border bg-card shadow-xs">
          <EmptyRow icon={<Inbox />}>Timeline found no risk to test on these books.</EmptyRow>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" data-testid="timeline-risks">
          {cards.map((r) => (
            <li
              key={r.id}
              className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card shadow-xs"
            >
              <div className="flex-1 space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Badge variant={r.breach ? "destructive" : "success"}>
                    {r.breach ? `Breaks ${r.breach.label.toLowerCase()}` : "Every rule holds"}
                  </Badge>
                  {r.breach?.weekStart ? (
                    <span className="text-[13px] text-muted-foreground">
                      from the week of {formatDate(r.breach.weekStart)}
                    </span>
                  ) : null}
                </div>
                <p className="text-sm font-medium leading-5">{r.label}</p>
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="text-muted-foreground">Lowest projected cash moves by</span>
                  <span className="font-medium tabular-nums">{formatCents(r.impact)}</span>
                </div>
                <p className="text-xs leading-5 text-muted-foreground" title={r.weightBasis}>
                  Scenario weight {Math.round(r.weight * 100)}%: {r.weightBasis}
                </p>
                {r.route ? (
                  <Link
                    href={r.route}
                    className="text-[13px] text-primary underline-offset-2 hover:underline"
                  >
                    Open this scenario
                  </Link>
                ) : null}
              </div>
              {r.response ? (
                <div className="border-t bg-muted/40 px-4 py-3 text-[13px]">
                  <p>{r.response.label}</p>
                  <p className="mt-0.5 text-muted-foreground">{r.response.costNote}</p>
                  <p
                    className={cn(
                      "mt-0.5",
                      r.response.clearsAllRules ? "text-safe" : "text-destructive",
                    )}
                  >
                    {r.response.clearsAllRules
                      ? `Clears every rule; low point +${formatCents(r.response.gainCents)}`
                      : `Still breaks a rule; low point +${formatCents(r.response.gainCents)}`}
                  </p>
                </div>
              ) : r.failureReason ? (
                <p className="border-t bg-muted/40 px-4 py-3 text-[13px] text-muted-foreground">
                  {r.failureReason}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      );
  }
  return (
    <Section
      title="Saved risk scenarios"
      description="From Timeline: what each risk does to the lowest projected cash, and a tested response."
      card={false}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href={href}>All risks in the forecast</Link>
        </Button>
      }
    >
      {head}
      {body}
      {analysis?.resilience ? (
        <p className="text-[13px] leading-5 text-muted-foreground">
          Weighted scenario index {analysis.resilience.weightedScenarioIndex.toFixed(2)} (
          {analysis.resilience.survivedCount} of {analysis.resilience.scenarioCount} weighted
          scenarios keep every rule). This is not a probability of survival.
        </p>
      ) : null}
    </Section>
  );
}
