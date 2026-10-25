"use client";

import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  Download,
  FileOutput,
  History,
  Inbox,
  Link2,
  RefreshCw,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { verifyWeeklySeedText } from "../../lib/feature-boundary/verify";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { PageHeader } from "../ui/page";
import { Skeleton } from "../ui/skeleton";
import { useSelectedCompanyName } from "./company";
import { useFieldData } from "./data";
import {
  LARGE_CENTS,
  describeFinding,
  findingExplanation,
  formatDay,
  humanizeText,
  relatedFlags,
} from "./finding-text";
import { byTime } from "./graph";
import { EmptyRow, Panel } from "./panel";
import {
  AnomalyPicker,
  AutoIngestToggle,
  DataLabel,
  FINDING_LABEL,
  OPERATION_LABEL,
  SEVERITY_BADGE,
  SEVERITY_LABEL,
  clock,
  timeAgo,
  useNow,
} from "./parts";
import type { Anomaly, Decision, FieldFinding, FieldOperation } from "./types";

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
  const data = useFieldData();
  const company = useSelectedCompanyName();
  const now = useNow();
  const runner = useRunner();
  const [seed, setSeed] = useState<string | null>(null);
  const open = data.findings?.filter((f) => f.status === "open") ?? [];
  const decided = data.findings?.filter((f) => f.status !== "open") ?? [];
  const related = relatedFlags(open);
  const headline = !data.findings
    ? "Loading the review queue"
    : open.length === 0
      ? "Nothing needs your review right now"
      : `${open.length} ${open.length === 1 ? "flag needs" : "flags need"} your review`;
  const disabled = data.source === "loading" || data.needsSetup || runner.busy !== null;

  return (
    <div className="mx-auto max-w-[1200px] space-y-4">
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            {company}
            <DataLabel />
          </span>
        }
        title={headline}
        description="You decide every flag. Domino only reads your tools and never moves money."
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

      <StatusLine now={now} runner={runner} />
      {data.needsSetup ? <SetupCard /> : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
        <div className="min-w-0 space-y-4">
          <Panel
            aria-labelledby="queue-title"
            level="h2"
            title={<span id="queue-title">Review queue</span>}
            description="Confirm a flag if it is a real problem. Dismiss it if it is fine."
            aside={
              data.findings ? (
                <Badge variant={open.length > 0 ? "warning" : "secondary"}>
                  {open.length} open
                </Badge>
              ) : null
            }
          >
            {!data.findings ? (
              <div className="space-y-3 p-4" aria-busy="true">
                <p className="text-sm text-muted-foreground">Loading the review queue...</p>
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : open.length === 0 ? (
              <EmptyRow icon={<Inbox />}>
                No open flags. New ones show up here when the audit agent finds something.
              </EmptyRow>
            ) : (
              <ul className="divide-y">
                <AnimatePresence initial={false}>
                  {open.map((finding) => (
                    <FindingCard
                      key={finding.id}
                      finding={finding}
                      now={now}
                      related={(related.get(finding.id) ?? []).flatMap((id) => {
                        const other = open.find((f) => f.id === id);
                        return other ? [other] : [];
                      })}
                    />
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </Panel>
          {decided.length > 0 ? <DecidedList findings={decided} /> : null}
        </div>
        <div className="min-w-0 space-y-4">
          <DemoControls runner={runner} disabled={disabled} />
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
        </div>
      </div>
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
        <span>
          Demo controls
          <span className="ml-2 text-[13px] font-normal text-muted-foreground">
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

/** A DOM id for a flag; finding ids can carry ":" and ",". */
const flagDomId = (id: string) => `flag-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
/** The primary amount sits next to the name, so the fact line skips it. */
const PRIMARY_FACT = new Set(["Amount", "Now"]);

function FindingCard({
  finding,
  now,
  related,
}: { finding: FieldFinding; now: number; related: FieldFinding[] }) {
  const { actions, decideError } = useFieldData();
  const reduced = useReducedMotion();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const view = describeFinding(finding);
  const { explanation, suggestedCheck } = findingExplanation(finding);
  const primary = view.facts.find((f) => PRIMARY_FACT.has(f.label));
  const rest = view.facts.filter((f) => f !== primary);
  const high = finding.severity === "high";
  const large = view.amountCents !== null && Math.abs(view.amountCents) >= LARGE_CENTS;
  async function decide(decision: Decision) {
    setBusy(decision);
    setError(null);
    try {
      await actions.decide({ findingId: finding.id, decision, note: note.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the decision.");
      setBusy(null);
    }
  }
  const shownError = error ?? (decideError?.findingId === finding.id ? decideError.message : null);
  const noteId = `note-${finding.id}`;
  const domId = flagDomId(finding.id);
  return (
    <motion.li
      id={domId}
      layout={!reduced}
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      aria-labelledby={`${domId}-title`}
      className={cn(
        "relative scroll-mt-20 bg-card px-4 py-4",
        high &&
          "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-destructive",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`${domId}-title`} className="text-[15px] font-semibold leading-6">
            {view.counterparty ?? FINDING_LABEL[finding.kind]}
          </h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Badge variant={SEVERITY_BADGE[finding.severity]}>
              {SEVERITY_LABEL[finding.severity]}
            </Badge>
            {view.counterparty ? <span>{FINDING_LABEL[finding.kind]}</span> : null}
            <span>Found {timeAgo(finding.detectedAt, now)}</span>
            {finding.escalated ? <span>Escalated to you</span> : null}
          </div>
        </div>
        {primary ? (
          <p className="shrink-0 text-right">
            <span
              className={cn(
                "block font-semibold tabular-nums tracking-[-0.01em]",
                high || large ? "text-lg leading-6" : "text-[15px] leading-6",
              )}
            >
              {primary.value}
            </span>
            {rest.length > 0 ? (
              <span className="block text-xs tabular-nums text-muted-foreground">
                {rest.map((f) => `${f.label} ${f.value}`).join(" · ")}
              </span>
            ) : null}
          </p>
        ) : null}
      </div>

      <p className="mt-2 text-sm leading-6">{view.headline}</p>
      {!primary && rest.length > 0 ? (
        <p className="mt-1 text-[13px] tabular-nums text-muted-foreground">
          {rest.map((f) => `${f.label} ${f.value}`).join(" · ")}
        </p>
      ) : null}
      {explanation ? (
        <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
          <span className="font-medium text-foreground">Why it matters: </span>
          {explanation}
        </p>
      ) : null}
      {suggestedCheck ? (
        <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
          <span className="font-medium text-foreground">Suggested check: </span>
          {suggestedCheck}
        </p>
      ) : null}

      {related.length > 0 ? (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
          <Link2 aria-hidden="true" className="size-3.5" />
          Shares a record with
          {related.map((other) => (
            <a
              key={other.id}
              href={`#${flagDomId(other.id)}`}
              className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring sm:min-h-0"
            >
              {describeFinding(other).counterparty ?? FINDING_LABEL[other.kind]}
            </a>
          ))}
        </p>
      ) : null}

      {finding.refs.length > 0 ? (
        <details className="group mt-2 text-[13px]">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring sm:min-h-0 [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden="true"
              className="size-3.5 transition-transform group-open:rotate-90 motion-reduce:transition-none"
            />
            View records ({finding.refs.length})
          </summary>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {finding.refs.map((ref) => (
              <li key={ref}>
                <code className="rounded border bg-muted/60 px-1.5 py-px font-mono text-[11px] text-foreground">
                  {ref}
                </code>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="mt-3 space-y-1.5">
        <label htmlFor={noteId} className="block text-[13px] font-medium">
          Note <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            id={noteId}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="Why you decided this"
            className="h-11 sm:h-9 sm:flex-1"
          />
          <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
            <Button disabled={busy !== null} onClick={() => decide("approved")}>
              <Check aria-hidden="true" />
              Confirm issue
            </Button>
            <Button variant="outline" disabled={busy !== null} onClick={() => decide("rejected")}>
              <X aria-hidden="true" />
              Dismiss flag
            </Button>
          </div>
        </div>
      </div>
      {shownError ? <p className="mt-2 text-sm text-destructive">{shownError}</p> : null}
    </motion.li>
  );
}

function DecidedList({ findings }: { findings: FieldFinding[] }) {
  return (
    <details className="group overflow-hidden rounded-lg border bg-card text-sm shadow-xs">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <span>
          Decided
          <span className="ml-2 font-normal text-muted-foreground">
            {findings.length} {findings.length === 1 ? "flag" : "flags"}
          </span>
        </span>
        <span className="text-[13px] font-normal text-muted-foreground group-open:hidden">
          Show
        </span>
        <span className="hidden text-[13px] font-normal text-muted-foreground group-open:inline">
          Hide
        </span>
      </summary>
      <ul className="divide-y border-t">
        {findings.map((f) => {
          const view = describeFinding(f);
          return (
            <li
              key={f.id}
              className="grid gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[96px_minmax(0,1fr)]"
            >
              <div>
                <Badge variant={f.status === "approved" ? "success" : "secondary"}>
                  {f.status === "approved" ? "Confirmed" : "Dismissed"}
                </Badge>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">
                  {view.counterparty
                    ? `${view.counterparty} · ${FINDING_LABEL[f.kind]}`
                    : FINDING_LABEL[f.kind]}
                </p>
                <p className="mt-0.5 leading-6">{view.headline}</p>
                {f.note ? (
                  <p className="mt-1 text-[13px] text-muted-foreground">Note: {f.note}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </details>
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
