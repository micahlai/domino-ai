"use client";

import type { HistoricalCase, HistoricalRun } from "@domino/contracts";
import { useMutation, useQueries } from "convex/react";
import { ConvexError } from "convex/values";
import { ArrowRight, CircleDashed, Eye, History, RotateCcw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { cn } from "../../../lib/utils";
import {
  BaselineDataSchema,
  CASE_ID,
  CaseDataSchema,
  RevealDataSchema,
} from "../../historical/live";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { PageHeader, Section, StatTile } from "../../ui/page";
import { Skeleton } from "../../ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../ui/table";
import { formatCents } from "../dashboard/money";
import { QuarterChart, seriesColors } from "./QuarterChart";
import {
  type FactRef,
  type FlagStatus,
  type RevealView,
  type RewindFlag,
  type RewindView,
  deriveReveal,
  deriveRewind,
  shortDate,
} from "./derive";

// 2U on the main dashboard, in quarterly rewind mode. The company is real and replayed from its
// public filings: the view above the reveal uses only what was public at the knowledge cutoff
// (getCase without a run, re-filtered in deriveRewind) plus the frozen forecast the backend saved
// from it. Later figures come only from the reveal record, in their own section, after the
// person presses Reveal.

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

/**
 * Shown only after the reveal. The audited case holds cash facts only, so this later event comes
 * from the project's research notes, with its source, and is labelled that way.
 */
export const EPILOGUE = {
  date: "Jul 25, 2024",
  text: "2U announced a prepackaged Chapter 11 transaction with new capital and debt reduction, while intending to keep operating.",
  url: "https://2u.com/newsroom/strengthening-2us-financial-position-for-sustained-innovation-and-growth/",
  basis:
    "From the project's research notes (kb/research/historical-case-candidates.md), not from the audited case data or the forecast. Domino's flags were warning signs, not a prediction of this event.",
};

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function RewindDashboard() {
  if (!CONVEX_URL)
    return (
      <Frame>
        <Header />
        <Notice title="The 2U rewind needs the history backend">
          2U is replayed from its public filings, which live in the backend. This environment is not
          connected to it, so nothing is shown rather than sample numbers.
        </Notice>
      </Frame>
    );
  return <LiveRewind />;
}

// ---------- Live wiring ----------

const STORE = "domino.2u.rewind.v1";
type Stored = { requestId: string; runId?: string };
const newRequestId = () => `rewind-${crypto.randomUUID().replaceAll("-", "")}`.slice(0, 48);

function readStored(): Stored | null {
  try {
    const raw = window.localStorage.getItem(STORE);
    const v = raw ? (JSON.parse(raw) as Partial<Stored>) : null;
    return v && typeof v.requestId === "string"
      ? { requestId: v.requestId, ...(typeof v.runId === "string" ? { runId: v.runId } : {}) }
      : null;
  } catch {
    return null;
  }
}

function writeStored(s: Stored) {
  try {
    window.localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    // Storage blocked: the rewind still works for this visit.
  }
}

function errorText(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: unknown } | undefined;
    if (data && typeof data.message === "string") return data.message;
  }
  return "Could not reach the history backend. Check the connection and try again.";
}

const notFound = (e: unknown) =>
  e instanceof ConvexError && (e.data as { code?: unknown } | undefined)?.code === "NOT_FOUND";

/**
 * This browser's saved baseline. The first visit asks the backend to save one (idempotent on the
 * stored requestId, so a retry never saves twice). "Rewind again" starts a new one.
 */
function useBaselineRun() {
  const [stored, setStored] = useState<Stored | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const save = useMutation(api.historical.saveBaseline);
  useEffect(() => {
    const s = readStored() ?? { requestId: newRequestId() };
    writeStored(s);
    setStored(s);
  }, []);
  useEffect(() => {
    if (!stored || stored.runId || saving.current) return;
    saving.current = true;
    setError(null);
    save({ requestId: stored.requestId, caseId: CASE_ID })
      .then((summary) => {
        const next = { ...stored, runId: (summary as { runId: string }).runId };
        writeStored(next);
        setStored(next);
      })
      .catch((e: unknown) => setError(errorText(e)))
      .finally(() => {
        saving.current = false;
      });
  }, [stored, save]);
  const restart = useCallback(() => {
    const s = { requestId: newRequestId() };
    writeStored(s);
    setStored(s);
  }, []);
  return { runId: stored?.runId, error, restart };
}

function LiveRewind() {
  const { runId, error: saveError, restart } = useBaselineRun();
  const [revealed, setRevealed] = useState(false);
  const raw = useQueries(
    useMemo(
      () => ({
        // The cutoff view: no run id, so the backend serves only what was public at the cutoff.
        cutoff: { query: api.historical.getCase, args: { caseId: CASE_ID } },
        ...(runId
          ? {
              run: { query: api.historical.getRun, args: { caseId: CASE_ID, runId } },
              reveal: { query: api.historical.getReveal, args: { runId } },
            }
          : {}),
        // Later evidence is requested only after the reveal record exists.
        ...(runId && revealed
          ? { frozen: { query: api.historical.getCase, args: { caseId: CASE_ID, runId } } }
          : {}),
      }),
      [runId, revealed],
    ),
  );
  const revealRecord = raw.reveal;
  useEffect(() => {
    setRevealed(Boolean(revealRecord) && !(revealRecord instanceof Error));
  }, [revealRecord]);

  // A saved run that the backend no longer knows (a reset database): start a fresh baseline.
  const staleRun = notFound(raw.run);
  useEffect(() => {
    if (staleRun) restart();
  }, [staleRun, restart]);

  const doReveal = useMutation(api.historical.reveal);
  const revealIds = useRef<Record<string, string>>({});
  const [act, setAct] = useState<{ pending?: boolean; error?: string }>({});
  const onReveal = () => {
    if (!runId || act.pending) return;
    revealIds.current[runId] ??= newRequestId();
    setAct({ pending: true });
    doReveal({ requestId: revealIds.current[runId], runId })
      .then(() => setAct({}))
      .catch((e: unknown) => setAct({ error: errorText(e) }));
  };
  const onRestart = () => {
    setAct({});
    setRevealed(false);
    restart();
  };

  const failed = [raw.cutoff, raw.run, raw.reveal, raw.frozen].find(
    (x): x is Error => x instanceof Error,
  );
  if (saveError || (failed && !staleRun))
    return (
      <Frame>
        <Header />
        <Notice title="The 2U rewind could not load" tone="danger">
          {saveError ?? errorText(failed)} Nothing was changed.
        </Notice>
      </Frame>
    );
  if (!runId || raw.cutoff === undefined || raw.run === undefined || raw.reveal === undefined)
    return <RewindScreen state={{ kind: "loading" }} />;

  const cutoff = CaseDataSchema.safeParse(raw.cutoff);
  const run = BaselineDataSchema.safeParse(raw.run);
  const reveal = RevealDataSchema.safeParse(raw.reveal);
  if (!cutoff.success || !run.success || !reveal.success)
    return (
      <Frame>
        <Header />
        <Notice title="The saved data was not in the expected shape" tone="danger">
          Nothing is shown rather than guessing. Nothing was changed.
        </Notice>
      </Frame>
    );

  let revealView: RevealView | null | undefined = null;
  if (reveal.data) {
    const frozen = raw.frozen === undefined ? undefined : CaseDataSchema.safeParse(raw.frozen);
    revealView =
      frozen === undefined
        ? undefined
        : frozen.success && frozen.data.revealed
          ? deriveReveal(frozen.data.case, run.data.run, reveal.data)
          : undefined;
  }
  return (
    <RewindScreen
      state={{
        kind: "ready",
        caseView: cutoff.data.case,
        run: run.data.run,
        disclosure: cutoff.data.disclosure,
        reveal: revealView,
        act,
        onReveal,
        onRestart,
      }}
    />
  );
}

// ---------- Screen (pure, rendered in tests) ----------

export type ScreenState =
  | { kind: "loading" }
  | {
      kind: "ready";
      caseView: HistoricalCase;
      run: HistoricalRun;
      disclosure: string;
      /** null before the reveal; undefined while the revealed view loads. */
      reveal: RevealView | null | undefined;
      act: { pending?: boolean; error?: string };
      onReveal: () => void;
      onRestart: () => void;
    };

export function RewindScreen({ state }: { state: ScreenState }) {
  if (state.kind === "loading")
    return (
      <Frame>
        <Header />
        <div className="space-y-4" aria-busy="true">
          <p className="text-sm text-muted-foreground">
            Loading 2U's filings as of Nov 10, 2023...
          </p>
          <Skeleton className="h-24 w-full rounded-lg" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[108px] rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-80 w-full rounded-lg" />
        </div>
      </Frame>
    );
  const view = deriveRewind(state.caseView, state.run);
  return (
    <Frame>
      <Header cutoff={view.cutoff} />
      <div className="space-y-4">
        <Verdict view={view} />
        <Tiles view={view} />
      </div>
      <CashSection view={view} />
      <Flags view={view} />
      <RevealSection view={view} state={state} />
      <p className="max-w-3xl text-[13px] leading-5 text-muted-foreground">
        <span className="font-medium text-foreground">About this replay.</span> {state.disclosure}{" "}
        The older 2U case study pages are still at{" "}
        <Link href="/case/2u" className={cn("text-primary underline", focusRing)}>
          /case/2u
        </Link>
        .
      </p>
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-[1200px] space-y-8">{children}</div>;
}

function Header({ cutoff = "2023-11-10" }: { cutoff?: string }) {
  return (
    <PageHeader
      eyebrow={
        <span className="flex flex-wrap items-center gap-2">
          Cash health, next quarter
          <Badge variant="secondary" className="font-normal">
            <History aria-hidden="true" />
            Rewind
          </Badge>
        </span>
      }
      title="2U, Inc."
      description={
        <>
          <span className="block text-foreground">
            2U, Inc. · Real company · Quarterly public filings · As of {shortDate(cutoff)} (rewind)
          </span>
          <span className="block">
            Figures are quarterly, not weekly: public companies report once a quarter. What happened
            after {shortDate(cutoff)} stays hidden until you reveal it below.
          </span>
        </>
      }
    />
  );
}

// ---------- Verdict ----------

const RATING = {
  warning: {
    label: "Warning signs",
    badge: "warning" as const,
    box: "border-warning/30 bg-warning/[0.05]",
  },
  watch: { label: "Watch", badge: "warning" as const, box: "border-warning/30 bg-warning/[0.05]" },
  clear: {
    label: "No warning signs",
    badge: "success" as const,
    box: "border-safe/25 bg-safe/[0.04]",
  },
};

function Verdict({ view }: { view: RewindView }) {
  const meta = RATING[view.rating];
  const f = view.forecast.usable;
  const checked = view.flags.filter((x) => x.status !== "not_checked").length;
  return (
    <section
      aria-label="Cash health"
      className={cn("flex items-start gap-3 rounded-lg border p-4 md:p-5", meta.box)}
    >
      <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
      <div className="min-w-0">
        <Badge variant={meta.badge} className="font-semibold">
          {meta.label}: {view.flaggedCount} of {checked} rules
        </Badge>
        <p className="mt-2 max-w-3xl text-[15px] font-medium leading-6 text-foreground">
          At the nine-month pace, usable cash falls from {formatCents(view.usable.cents)} to{" "}
          {formatCents(f.cents)} by {shortDate(f.date)}, down{" "}
          {Math.round(-view.forecastChange.share * 100)}% in one quarter.
        </p>
        <p className="mt-0.5 max-w-3xl text-sm leading-6 text-muted-foreground">
          {view.runway
            ? `That is about ${view.runway.quarters} quarters of usable cash before any new financing. `
            : ""}
          {view.limit
            ? `Compared with the lender's minimum of ${formatCents(view.limit.cents)}.`
            : "No lender's minimum is in the case data, so this is a cash trend, not a limit test."}
        </p>
        <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
          Frozen forecast saved from facts public by {shortDate(view.cutoff)}. Run {view.runId}.
        </p>
      </div>
    </section>
  );
}

const Big = ({ children }: { children: ReactNode }) => (
  <span className="text-2xl md:text-[28px] md:leading-9">{children}</span>
);

function Tiles({ view }: { view: RewindView }) {
  const f = view.forecast.usable;
  return (
    <section aria-label="Key numbers" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile
        label={`Usable cash, ${shortDate(view.lastBalanceDate)}`}
        value={<Big>{formatCents(view.usable.cents)}</Big>}
        delta={`${formatCents(view.total.cents)} with ${formatCents(view.restricted?.cents ?? 0)} restricted · reported`}
      />
      <StatTile
        label={`Forecast, ${shortDate(f.date)}`}
        value={<Big>{formatCents(f.cents)}</Big>}
        delta={`${formatCents(view.forecastChange.cents)} in the quarter · frozen at the cutoff`}
        tone="warning"
      />
      <StatTile
        label="Burn before financing"
        value={<Big>{formatCents(view.perQuarter.beforeFinancing)}</Big>}
        unit="a quarter"
        delta={`Operating ${formatCents(view.perQuarter.operating)} · investing ${formatCents(view.perQuarter.investing)}`}
      />
      {view.limit ? (
        <StatTile
          label="Lender's minimum"
          value={<Big>{formatCents(view.limit.cents)}</Big>}
          delta={`Disclosed term, rule ${view.limit.ruleId}`}
        />
      ) : (
        <StatTile
          label="Lender's minimum"
          value={<Big>None on file</Big>}
          delta="Not in the audited case data"
        />
      )}
    </section>
  );
}

// ---------- Chart ----------

function CashSection({ view }: { view: RewindView }) {
  const rows = [
    ...(view.trendStart
      ? [
          {
            date: view.trendStart.date,
            what: "Start of the year (derived)",
            total: view.trendStart.cents,
            usable: null,
            basis: "End balance minus nine months of reported flows",
          },
        ]
      : []),
    {
      date: view.lastBalanceDate,
      what: "Last reported balance",
      total: view.total.cents,
      usable: view.usable.cents,
      basis: `Reported in ${view.usable.source?.title ?? "the filing"}, public ${shortDate(view.usable.publishedOn)}`,
    },
    ...(view.nowcast.usable
      ? [
          {
            date: view.nowcast.usable.date,
            what: "Estimate at the cutoff (modeled)",
            total: view.nowcast.total?.cents ?? null,
            usable: view.nowcast.usable.cents,
            basis: "Modeled from the nine-month pace, not reported",
          },
        ]
      : []),
    {
      date: view.forecast.usable.date,
      what: "Forecast (frozen)",
      total: view.forecast.total?.cents ?? null,
      usable: view.forecast.usable.cents,
      basis: "Financing and exchange-rate effect set to zero, restricted cash held flat",
    },
  ];
  return (
    <Section
      title="Cash by quarter"
      description="Reported balances, then the frozen forecast for the next quarter end. Dashed means not yet reported at the cutoff."
    >
      <div className="space-y-4">
        <Legend />
        <QuarterChart
          label={`2U cash by quarter as of ${shortDate(view.cutoff)}: usable cash ${formatCents(view.usable.cents)} on ${shortDate(view.lastBalanceDate)}, forecast ${formatCents(view.forecast.usable.cents)} on ${shortDate(view.forecast.usable.date)}`}
          cutoff={view.cutoff}
          limit={view.limit ? { cents: view.limit.cents, label: "Lender's minimum" } : null}
          series={[
            {
              id: "total",
              label: "Cash including restricted",
              color: seriesColors.total,
              points: view.chart.total,
            },
            {
              id: "usable",
              label: "Usable cash",
              color: seriesColors.usable,
              points: view.chart.usable,
            },
          ]}
        />
        {!view.limit ? (
          <p className="text-[13px] leading-5 text-muted-foreground">
            No limit line: the audited case has no lender's minimum or other stated cash floor.
          </p>
        ) : null}
        <div className="-mx-[var(--card-pad)] border-t">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-[var(--card-pad)]">Date</TableHead>
                <TableHead className="hidden sm:table-cell">What</TableHead>
                <TableHead className="text-right">Incl. restricted</TableHead>
                <TableHead className="text-right">Usable</TableHead>
                <TableHead className="hidden pr-[var(--card-pad)] md:table-cell">Basis</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.date} className="hover:bg-transparent">
                  <TableCell className="pl-[var(--card-pad)]">
                    <span className="whitespace-nowrap">{shortDate(r.date)}</span>
                    <span className="block text-[13px] text-muted-foreground sm:hidden">
                      {r.what}
                    </span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{r.what}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.total === null ? "Not known" : formatCents(r.total)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.usable === null ? "Not known" : formatCents(r.usable)}
                  </TableCell>
                  <TableCell className="hidden pr-[var(--card-pad)] text-[13px] text-muted-foreground md:table-cell">
                    {r.basis}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </Section>
  );
}

function Legend() {
  const item = (color: string, text: string, dashed = false) => (
    <span className="inline-flex items-center gap-2">
      <svg width="22" height="8" aria-hidden="true">
        <line
          x1="1"
          x2="21"
          y1="4"
          y2="4"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={dashed ? "4 3" : undefined}
        />
      </svg>
      {text}
    </span>
  );
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted-foreground">
      {item(seriesColors.usable, "Usable cash (restricted excluded)")}
      {item(seriesColors.total, "Cash including restricted")}
      {item("hsl(var(--muted-foreground))", "Modeled or forecast", true)}
    </div>
  );
}

// ---------- Flags ----------

const STATUS: Record<FlagStatus, { label: string; badge: "warning" | "success" | "secondary" }> = {
  flagged: { label: "Flagged", badge: "warning" },
  clear: { label: "Clear", badge: "success" },
  not_checked: { label: "Not checked", badge: "secondary" },
};

function Flags({ view }: { view: RewindView }) {
  return (
    <Section
      title="What Domino would have flagged"
      description={`Fixed rules run on facts public by ${shortDate(view.cutoff)} only. Each shows its rule and the filing it came from. Warning signs, not a prediction of what happened next.`}
      flush
    >
      <ul className="divide-y">
        {view.flags.map((f) => (
          <FlagRow key={f.id} flag={f} />
        ))}
      </ul>
    </Section>
  );
}

function FlagRow({ flag }: { flag: RewindFlag }) {
  const s = STATUS[flag.status];
  return (
    <li className="grid gap-2 p-4 md:grid-cols-[7rem_1fr] md:gap-4 md:p-5">
      <div>
        <Badge variant={s.badge}>
          {flag.status === "not_checked" ? <CircleDashed aria-hidden="true" /> : null}
          {s.label}
        </Badge>
      </div>
      <div className="min-w-0 space-y-1.5">
        <p className="text-[15px] font-medium leading-6">{flag.title}</p>
        <p className="text-sm leading-6 text-muted-foreground">{flag.detail}</p>
        <p className="text-[13px] leading-5 text-muted-foreground">
          <span className="font-medium text-foreground">Rule.</span> {flag.rule}
        </p>
        {flag.evidence.length ? (
          <details className="group text-[13px]">
            <summary
              className={cn(
                "inline-flex min-h-6 cursor-pointer list-none items-center gap-1 text-primary underline-offset-2 hover:underline",
                focusRing,
              )}
            >
              Show the{" "}
              {flag.evidence.length === 1 ? "source fact" : `${flag.evidence.length} source facts`}
            </summary>
            <ul className="mt-2 space-y-1.5">
              {flag.evidence.map((e) => (
                <Evidence key={e.factId} e={e} />
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </li>
  );
}

function Evidence({ e }: { e: FactRef }) {
  return (
    <li className="rounded-md border bg-background/60 px-3 py-2 leading-5">
      <span className="font-medium">
        {e.factId} · {e.label}: {formatCents(e.cents)}
      </span>{" "}
      <span className="text-muted-foreground">
        ({e.periodText}). Public {shortDate(e.publishedOn)}
        {e.source ? (
          <>
            {" "}
            in{" "}
            {e.source.url ? (
              <a
                href={e.source.url}
                target="_blank"
                rel="noreferrer"
                className={cn("text-primary underline", focusRing)}
              >
                {e.source.title}
              </a>
            ) : (
              e.source.title
            )}{" "}
            (source {e.source.id})
          </>
        ) : null}
        .
      </span>
    </li>
  );
}

// ---------- Reveal ----------

function RevealSection({
  view,
  state,
}: { view: RewindView; state: Extract<ScreenState, { kind: "ready" }> }) {
  const r = state.reveal;
  if (r === null)
    return (
      <Section
        title="What happened next"
        description="Hidden. Nothing reported after the cutoff is used anywhere above."
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Reveal 2U's next published results and compare them with the forecast frozen on{" "}
            {shortDate(view.cutoff)}. The forecast is not recomputed or edited.
          </p>
          <div className="flex shrink-0 flex-col items-start gap-1.5">
            <Button
              onClick={state.onReveal}
              disabled={state.act.pending}
              className="h-11 sm:h-[var(--control-h)]"
            >
              <Eye aria-hidden="true" />
              {state.act.pending ? "Revealing..." : "Reveal what happened"}
            </Button>
            {state.act.error ? (
              <p role="alert" className="text-[13px] text-destructive">
                {state.act.error}
              </p>
            ) : null}
          </div>
        </div>
      </Section>
    );
  if (r === undefined)
    return (
      <Section title="What happened next">
        <Skeleton className="h-40 w-full rounded-lg" />
      </Section>
    );
  return <Revealed view={view} reveal={r} onRestart={state.onRestart} />;
}

function Revealed({
  view,
  reveal,
  onRestart,
}: { view: RewindView; reveal: RevealView; onRestart: () => void }) {
  const usable = reveal.rows.find((x) => x.metric === "cash_and_equivalents");
  const source = reveal.newSources[0];
  const headline = usable
    ? reveal.allAbove
      ? `Cash rose instead: usable cash was ${formatCents(usable.actual)} on ${shortDate(usable.date)}, ${formatCents(usable.difference)} above the forecast of ${formatCents(usable.forecast)}.`
      : `Usable cash was ${formatCents(usable.actual)} on ${shortDate(usable.date)}, against a forecast of ${formatCents(usable.forecast)}.`
    : "No reported figure matched the forecast date.";
  return (
    <Section
      title="What happened next"
      description={`Revealed: ${source ? `${source.title}, public ${shortDate(source.publishedOn)}` : `published by ${shortDate(reveal.revealedThrough)}`}. Shown only here, never in the view above.`}
      actions={
        <Button variant="outline" onClick={onRestart} className="h-11 sm:h-[var(--control-h)]">
          <RotateCcw aria-hidden="true" />
          Rewind again
        </Button>
      }
    >
      <div className="space-y-5">
        <div>
          <p className="max-w-3xl text-[15px] font-medium leading-6">{headline}</p>
          {reveal.allAbove ? (
            <p className="mt-0.5 max-w-3xl text-sm leading-6 text-muted-foreground">
              The quarterly forecast was wrong in direction. The flags above were about the pace of
              cash use; they did not say cash would fall this quarter for certain.
            </p>
          ) : null}
        </div>
        <QuarterChart
          label={`Frozen forecast against reported cash on ${usable ? shortDate(usable.date) : "the forecast date"}`}
          cutoff={view.cutoff}
          limit={null}
          series={[
            {
              id: "total",
              label: "Cash including restricted",
              color: seriesColors.total,
              points: view.chart.total,
            },
            {
              id: "usable",
              label: "Usable cash",
              color: seriesColors.usable,
              points: view.chart.usable,
            },
          ]}
          actual={[
            ...(reveal.actual.total ? [{ seriesId: "total", point: reveal.actual.total }] : []),
            ...(reveal.actual.usable ? [{ seriesId: "usable", point: reveal.actual.usable }] : []),
          ]}
        />
        <div className="-mx-[var(--card-pad)] border-t">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-[var(--card-pad)]">Measure</TableHead>
                <TableHead className="text-right">Forecast</TableHead>
                <TableHead className="text-right">Reported</TableHead>
                <TableHead className="pr-[var(--card-pad)] text-right">Difference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reveal.rows.map((row) => (
                <TableRow key={row.predictionId} className="hover:bg-transparent">
                  <TableCell className="pl-[var(--card-pad)]">
                    {row.label}, {shortDate(row.date)}
                    <span className="block text-[13px] text-muted-foreground">
                      Fact {row.fact.factId}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCents(row.forecast)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCents(row.actual)}
                  </TableCell>
                  <TableCell className="pr-[var(--card-pad)] text-right tabular-nums">
                    {row.difference > 0 ? "+" : ""}
                    {formatCents(row.difference)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {reveal.quarterFlows.length ? (
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-muted-foreground">
              Reported for the quarter itself (derived: full year minus nine months)
            </p>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {reveal.quarterFlows.map((f) => (
                <li key={f.factId} className="rounded-md border px-3 py-2">
                  <span className="block text-[13px] text-muted-foreground">
                    {f.label} · {f.factId}
                  </span>
                  <span className="text-[15px] font-semibold tabular-nums">
                    {f.cents > 0 ? "+" : ""}
                    {formatCents(f.cents)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="rounded-md border bg-background/60 p-4">
          <p className="text-[13px] font-medium text-muted-foreground">
            Later, outside the case data
          </p>
          <p className="mt-1 text-sm leading-6">
            {EPILOGUE.date}: {EPILOGUE.text}{" "}
            <a
              href={EPILOGUE.url}
              target="_blank"
              rel="noreferrer"
              className={cn("inline-flex items-center gap-1 text-primary underline", focusRing)}
            >
              Issuer announcement
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </a>
          </p>
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{EPILOGUE.basis}</p>
        </div>
      </div>
    </Section>
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
