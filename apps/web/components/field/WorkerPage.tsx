"use client";

import { useQuery } from "convex/react";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  Download,
  FileOutput,
  History,
  RefreshCw,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { verifyWeeklySeedText } from "../../lib/feature-boundary/verify";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { PageHeader } from "../ui/page";
import { Skeleton } from "../ui/skeleton";
import { OpenInTimeline } from "./OpenInTimeline";
import { useSelectedCompany, useSelectedCompanyName, useSelectedProfile } from "./company";
import { type DashboardData, DashboardDataProvider, useDashboard } from "./dashboard/data";
import type { AnalystLatest } from "./dashboard/risks";
import { useFieldData } from "./data";
import { formatDay, humanizeText } from "./finding-text";
import { byTime } from "./graph";
import { EmptyRow, Panel } from "./panel";
import {
  AnomalyPicker,
  AutoIngestToggle,
  DataLabel,
  OPERATION_LABEL,
  clock,
  timeAgo,
  useNow,
} from "./parts";
import type { Anomaly, FieldFinding, FieldOperation } from "./types";
import type {
  DecideSuggestion,
  SimulateSuggestion,
  SuggestionsState,
} from "./worker/SuggestionsSection";
import { WorkerSections } from "./worker/WorkerSections";
import { introLine } from "./worker/format";
import { type WatchedRisk, watchedRisks } from "./worker/risks";
import type { EffectContext } from "./worker/suggestions";
import { useDemoSuggestions, useLiveSuggestions } from "./worker/useSuggestions";

// The worker page: "Here's what needs you", in three sections and this order:
// 1. Suggestions to accept or decline, 2. Risks we're watching, 3. Flags to review.
// Read-only apart from the decisions a person records; Domino never moves money.

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

type Busy = "feed" | "ingest" | "export" | null;
type Runner = {
  busy: Busy;
  message: { text: string; error?: boolean } | null;
  run: (kind: Exclude<Busy, null>, task: () => Promise<void>, done: string) => Promise<void>;
};

/** One busy flag and one result line for every action on the page. */
function useRunner(): Runner {
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<Runner["message"]>(null);
  async function run(kind: Exclude<Busy, null>, task: () => Promise<void>, done: string) {
    setBusy(kind);
    setMessage(null);
    try {
      await task();
      setMessage({ text: done });
    } catch (error) {
      setMessage({
        text: `That did not work: ${error instanceof Error ? error.message : "unknown error"}`,
        error: true,
      });
    } finally {
      setBusy(null);
    }
  }
  return { busy, message, run };
}

export function WorkerPage() {
  // The dashboard's provider: the same summary, Timeline run (TL6/TL7) and sample events.
  return (
    <DashboardDataProvider>{CONVEX_URL ? <LiveWorker /> : <DemoWorker />}</DashboardDataProvider>
  );
}

function LiveWorker() {
  const router = useRouter();
  const dashboard = useDashboard();
  const { companyId } = useSelectedCompany();
  const latest = useQuery(
    api.fieldAnalyst.latest,
    companyId ? { companyId: companyId as Id<"companies"> } : "skip",
  );
  const suggestions = useLiveSuggestions(companyId);
  return (
    <WorkerBody
      companyId={companyId ?? null}
      dashboard={dashboard}
      latest={latest ?? undefined}
      suggestions={suggestions.state}
      onDecide={suggestions.decide}
      onSimulate={async (suggestion) => {
        const result = await suggestions.simulate(suggestion);
        router.push(result.route);
      }}
    />
  );
}

function DemoWorker() {
  const dashboard = useDashboard();
  const view = viewOf(dashboard);
  const suggestions = useDemoSuggestions(
    dashboard.result === undefined ? undefined : view,
    useSelectedProfile(),
  );
  return (
    <WorkerBody
      companyId={null}
      dashboard={dashboard}
      latest={undefined}
      suggestions={suggestions.state}
      onDecide={suggestions.decide}
    />
  );
}

const viewOf = (d: DashboardData) => (d.result?.ok ? d.result.view : null);

/** Lowest cash in the plan and in each scenario, for a suggestion's before and after. */
export function effectContext(d: DashboardData, risks: WatchedRisk[]): EffectContext {
  const view = viewOf(d);
  const scenarios: EffectContext["scenarios"] = new Map();
  for (const r of risks)
    if (r.low && !scenarios.has(r.id)) scenarios.set(r.id, { ...r.low, title: r.title });
  return {
    baseline: view?.lowest ? { cents: view.lowest.usable, week: view.lowest.weekStart } : null,
    scenarios,
    minimum: view?.lenderMinimum?.cents ?? null,
  };
}

function WorkerBody({
  companyId,
  dashboard,
  latest,
  suggestions,
  onDecide,
  onSimulate,
}: {
  companyId: string | null;
  dashboard: DashboardData;
  latest: AnalystLatest | undefined;
  suggestions: SuggestionsState;
  onDecide: DecideSuggestion;
  onSimulate?: SimulateSuggestion;
}) {
  const data = useFieldData();
  const company = useSelectedCompanyName();
  const now = useNow();
  const runner = useRunner();
  const [seed, setSeed] = useState<string | null>(null);
  const risks = useMemo(
    () => watchedRisks({ timeline: dashboard.timeline, latest, view: viewOf(dashboard) }),
    [dashboard, latest],
  );
  const context = useMemo(() => effectContext(dashboard, risks), [dashboard, risks]);
  const risksLoading = dashboard.result === undefined;
  const disabled = data.source === "loading" || data.needsSetup || runner.busy !== null;

  return (
    <div className="mx-auto max-w-[1040px] space-y-8">
      <div className="space-y-4">
        <PageHeader
          eyebrow={<DataLabel />}
          title={company}
          description={introLine({
            suggestions:
              suggestions.kind === "ready"
                ? suggestions.list.filter((s) => s.status === "open").length
                : suggestions.kind === "loading"
                  ? null
                  : 0,
            risks: risksLoading ? null : risks.filter((r) => r.status !== "holds").length,
            flags: data.findings ? data.findings.filter((f) => f.status === "open").length : null,
          })}
          actions={
            <>
              <Button
                disabled={disabled}
                onClick={() =>
                  runner.run(
                    "ingest",
                    data.actions.ingestNow,
                    data.source === "live"
                      ? "Checking every tool now. New flags appear below as they land."
                      : "Checked every tool.",
                  )
                }
              >
                <RefreshCw
                  aria-hidden="true"
                  className={cn(
                    runner.busy === "ingest" && "animate-spin motion-reduce:animate-none",
                  )}
                />
                Check latest data
              </Button>
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() =>
                  runner.run(
                    "export",
                    async () => setSeed(await data.actions.exportSeed()),
                    "Seed exported for a simulation.",
                  )
                }
              >
                <FileOutput aria-hidden="true" />
                Export seed
              </Button>
            </>
          }
        />
        <div className="grid items-start gap-3 md:grid-cols-[minmax(0,1fr)_300px]">
          <StatusLine now={now} runner={runner} />
          <DemoControls runner={runner} disabled={disabled} />
        </div>
        {data.needsSetup ? <SetupCard /> : null}
      </div>

      <WorkerSections
        companyId={companyId}
        suggestions={suggestions}
        context={context}
        onDecide={onDecide}
        onSimulate={onSimulate}
        risks={risks}
        risksLoading={risksLoading}
        timelineAction={<OpenInTimeline variant="outline" label="Open in timeline" />}
        findings={data.findings}
        now={now}
      />

      <ActivityFeed
        operations={data.operations}
        now={now}
        aside={
          <Link
            href="/field/map"
            className="inline-flex min-h-11 items-center gap-1 rounded text-[13px] font-medium text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring sm:min-h-0"
          >
            Brain map
            <ArrowUpRight aria-hidden="true" className="size-3.5" />
          </Link>
        }
      />
      <SeedDialog text={seed} demo={data.source === "demo"} onClose={() => setSeed(null)} />
    </div>
  );
}

const RUN_NOTE: Record<string, string> = {
  ok: "saved new entries",
  no_change: "found nothing new",
  failed: "failed",
};

/** Agent status as one quiet metadata line; the queue below is the main thing on the page. */
function StatusLine({ now, runner }: { now: number; runner: Runner }) {
  const { status } = useFieldData();
  const parts: ReactNode[] = status
    ? [
        status.feed.lastAdvanceAt
          ? `New entries arrived ${timeAgo(status.feed.lastAdvanceAt, now)}`
          : "Arrival time unavailable",
        status.ingest.lastRunAt
          ? `Agent last ran ${timeAgo(status.ingest.lastRunAt, now)}${
              status.ingest.lastStatus && RUN_NOTE[status.ingest.lastStatus]
                ? `, ${RUN_NOTE[status.ingest.lastStatus]}`
                : ""
            }`
          : "Agent has not run yet",
        ...(status.asOf
          ? [
              `Books as of ${formatDay(status.asOf)}${status.week !== undefined ? `, week ${status.week}` : ""}`,
            ]
          : []),
        `${status.counts.sources} of 6 tools read`,
        `Auto checks ${status.ingest.enabled ? "on" : "off"}`,
      ]
    : [];
  return (
    <section aria-label="Agent status" className="space-y-2">
      {status ? (
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] leading-5 text-muted-foreground sm:gap-x-2">
          {parts.map((part, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed order of status parts
            <span key={i} className="inline-flex items-center gap-2">
              {i > 0 ? (
                <span aria-hidden="true" className="hidden sm:inline">
                  ·
                </span>
              ) : null}
              {part}
            </span>
          ))}
        </p>
      ) : (
        <Skeleton className="h-5 w-full max-w-lg" />
      )}
      {runner.busy || runner.message ? (
        <output
          className={cn(
            "block text-[13px]",
            runner.message?.error ? "text-destructive" : "text-foreground",
          )}
        >
          {runner.busy ? "Working..." : runner.message?.text}
        </output>
      ) : null}
      {status?.ingest.lastStatus === "failed" && status.lastError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/25 bg-destructive/[0.04] px-3 py-2 text-sm text-destructive"
        >
          Last check failed: {status.lastError}
        </p>
      ) : null}
    </section>
  );
}

function SetupCard() {
  const { actions } = useFieldData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed bg-card p-4 text-sm">
      <p>No live feed yet. Connect the six mock sources for a synthetic company to start.</p>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await actions.setup();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Setup failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        Connect mock sources
      </Button>
      {error ? <p className="w-full text-destructive">{error}</p> : null}
    </section>
  );
}

/** Synthetic-feed controls for demos. Collapsed so the review queue stays first. */
function DemoControls({ runner, disabled }: { runner: Runner; disabled: boolean }) {
  const { actions, status } = useFieldData();
  const [anomaly, setAnomaly] = useState<Anomaly | "">("");
  return (
    <details className="group overflow-hidden rounded-lg border bg-card text-sm shadow-xs">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 font-medium hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          Demo controls
          <span className="block text-xs font-normal text-muted-foreground">
            Synthetic entries only
          </span>
        </span>
        <ChevronRight
          aria-hidden="true"
          className="size-4 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none"
        />
      </summary>
      <div className="space-y-3 border-t px-4 py-3">
        <AnomalyPicker value={anomaly} onChange={setAnomaly} disabled={disabled} stacked />
        <Button
          variant="outline"
          className="w-full"
          disabled={disabled}
          onClick={() =>
            runner.run(
              "feed",
              () => actions.advanceFeed(anomaly || undefined),
              `New entries arrived in the mock feed${anomaly ? " with a planted anomaly" : ""}. ${
                status?.ingest.enabled
                  ? "Auto checks pick them up on the next run."
                  : "Press Check latest data to read them."
              }`,
            )
          }
        >
          <Download aria-hidden="true" />
          New entries arrive
        </Button>
        <AutoIngestToggle />
      </div>
    </details>
  );
}

function SeedDialog({
  text,
  demo,
  onClose,
}: { text: string | null; demo: boolean; onClose: () => void }) {
  const [verdict, setVerdict] = useState<{ text: string; ok: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setVerdict(null);
    setCopied(false);
    if (!text) return;
    let alive = true;
    // The same check Timeline runs on receipt: parse, then recompute the content hash.
    verifyWeeklySeedText(text).then(
      (r) =>
        alive &&
        setVerdict(
          r.ok
            ? {
                ok: true,
                text: `Checked: valid weekly seed, fingerprint ${r.contentHash?.slice(0, 12)}`,
              }
            : { ok: false, text: `This seed failed the check: ${r.reason}` },
        ),
    );
    return () => {
      alive = false;
    };
  }, [text]);
  return (
    <Dialog open={text !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Seed for the simulation</DialogTitle>
          <DialogDescription>
            {demo
              ? "Demo data: the built-in Kestrel fixture seed, not exported from a backend."
              : "The latest saved weekly books, scheduled payments and open or confirmed flags, exported by field.exportSeed as the text the timeline reads."}
          </DialogDescription>
        </DialogHeader>
        <p
          className={cn(
            "flex items-center gap-2 text-sm",
            verdict?.ok === false ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {verdict?.ok ? <Check aria-hidden="true" className="size-4 text-safe" /> : null}
          {verdict?.text ?? "Checking the seed..."}
        </p>
        <pre
          aria-label="Weekly seed JSON text"
          className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/40 p-3 font-mono text-xs leading-5"
        >
          {text}
        </pre>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" asChild>
            <a
              download="weekly-seed.json"
              href={`data:application/json;charset=utf-8,${encodeURIComponent(text ?? "")}`}
            >
              <Download aria-hidden="true" />
              Download
            </a>
          </Button>
          <Button
            onClick={async () => {
              await navigator.clipboard.writeText(text ?? "");
              setCopied(true);
            }}
          >
            <Copy aria-hidden="true" />
            {copied ? "Copied" : "Copy text"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const FEED_CAP = 14;

export function ActivityFeed({
  operations,
  now,
  className,
  aside,
}: {
  operations?: FieldOperation[];
  now: number;
  className?: string;
  /** Right side of the header; a history icon by default. */
  aside?: ReactNode;
}) {
  const reduced = useReducedMotion();
  // Rows on screen at first render are history and appear still; only later arrivals animate.
  const initial = useRef<Set<string> | null>(null);
  if (operations && !initial.current) initial.current = new Set(operations.map((op) => op.id));
  const rows = useMemo(
    () => (operations ? [...operations].sort(byTime).reverse().slice(0, FEED_CAP) : []),
    [operations],
  );
  return (
    <Panel
      aria-labelledby="activity-title"
      level="h2"
      title={<span id="activity-title">Recent activity</span>}
      aside={aside ?? <History aria-hidden="true" className="size-4 text-muted-foreground" />}
      className={className}
    >
      {!operations ? (
        <div className="space-y-3 p-4" aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyRow>No recorded activity yet.</EmptyRow>
      ) : (
        <ol className="divide-y">
          <AnimatePresence initial={false}>
            {rows.map((op) => {
              const fresh = !initial.current?.has(op.id) && !reduced;
              return (
                <motion.li
                  key={op.id}
                  layout={!reduced}
                  initial={fresh ? { opacity: 0, x: -6 } : false}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                  className="flex gap-3 px-4 py-2.5"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-[7px] size-1.5 shrink-0 rounded-full",
                      op.status === "failed" ? "bg-destructive" : "bg-muted-foreground/40",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0 truncate text-[13px] font-medium">
                        {OPERATION_LABEL[op.kind]}
                        <span className="font-normal text-muted-foreground">
                          {" · "}
                          {op.agent}
                          {op.tool ? ` · ${op.tool}` : ""}
                        </span>
                      </p>
                      <time
                        dateTime={op.at}
                        title={clock(op.at)}
                        className="shrink-0 text-xs tabular-nums text-muted-foreground"
                      >
                        {timeAgo(op.at, now)}
                      </time>
                    </div>
                    <p className="text-[13px] leading-5 text-muted-foreground">
                      {humanizeText(op.summary)}
                    </p>
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      )}
    </Panel>
  );
}
