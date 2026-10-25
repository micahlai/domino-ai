"use client";

import {
  ArrowUpRight,
  Check,
  Copy,
  Download,
  FileOutput,
  History,
  Inbox,
  Play,
  RefreshCw,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { verifyWeeklySeedText } from "../../lib/feature-boundary/verify";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { PageHeader, StatTile } from "../ui/page";
import { Skeleton } from "../ui/skeleton";
import { useFieldData } from "./data";
import { byTime } from "./graph";
import { EmptyRow, Panel } from "./panel";
import {
  AnomalyPicker,
  AutoIngestToggle,
  DataLabel,
  FINDING_LABEL,
  FieldTabs,
  OPERATION_LABEL,
  SEVERITY_BADGE,
  SEVERITY_LABEL,
  clock,
  timeAgo,
  useNow,
} from "./parts";
import type { Anomaly, Decision, FieldFinding, FieldOperation } from "./types";

export function WorkerPage() {
  const data = useFieldData();
  const now = useNow();
  const open = data.findings?.filter((f) => f.status === "open") ?? [];
  const decided = data.findings?.filter((f) => f.status !== "open") ?? [];
  const headline = !data.findings
    ? "Loading the review queue"
    : open.length === 0
      ? "Nothing needs your review right now"
      : `${open.length} ${open.length === 1 ? "flag needs" : "flags need"} your review`;

  return (
    <div className="mx-auto max-w-[1200px] space-y-6">
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            Finance agent
            <DataLabel />
          </span>
        }
        title={headline}
        description="The finance agent reads new entries from billing, customer records, cards, books, payroll and the bank, then checks them for anything odd. You decide every flag. Domino never moves money."
        actions={<FieldTabs />}
      />

      {data.needsSetup ? <SetupCard /> : null}
      <StatusStrip now={now} />
      <ActionBar />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <Panel
            aria-labelledby="queue-title"
            level="h2"
            title={<span id="queue-title">Review queue</span>}
            description="Approve if the flag is a real problem; reject if it is fine."
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
                    <FindingCard key={finding.id} finding={finding} now={now} />
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </Panel>
          {decided.length > 0 ? <DecidedList findings={decided} /> : null}
        </div>
        <ActivityFeed operations={data.operations} now={now} />
      </div>
    </div>
  );
}

function StatusStrip({ now }: { now: number }) {
  const { status } = useFieldData();
  const items = status
    ? [
        {
          label: "New entries arrived",
          value: timeAgo(status.feed.lastAdvanceAt, now),
          note:
            status.week !== undefined
              ? `Mock books as of ${status.asOf ?? "unknown"} · week ${status.week}`
              : status.feed.enabled
                ? "Mock feed on"
                : "Mock feed off",
        },
        {
          label: "Agent last ran",
          value: timeAgo(status.ingest.lastRunAt, now),
          note: `${status.ingest.enabled ? "Auto ingest on" : "Auto ingest off"} · ${RUN_NOTE[status.ingest.lastStatus ?? ""] ?? status.ingest.lastStatus ?? "no runs yet"}`,
        },
        { label: "Sources read", value: String(status.counts.sources), note: "of 6 connected" },
        {
          label: "Books versions saved",
          value: String(status.counts.snapshots),
          note: "one per ingest with new entries",
        },
      ]
    : null;
  return (
    <section aria-label="Agent status" className="space-y-2">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {items
          ? items.map((item) => (
              <StatTile key={item.label} label={item.label} value={item.value} delta={item.note} />
            ))
          : [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[100px] rounded-lg" />)}
      </div>
      {status?.ingest.lastStatus === "failed" && status.lastError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/25 bg-destructive/[0.04] px-3 py-2 text-sm text-destructive"
        >
          Last ingest failed: {status.lastError}
        </p>
      ) : null}
    </section>
  );
}

const RUN_NOTE: Record<string, string> = {
  ok: "last run saved new entries",
  no_change: "last run found nothing new",
  failed: "last run failed",
};

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

type Busy = "feed" | "ingest" | "analysis" | "export" | null;

function ActionBar() {
  const { actions, source, status, needsSetup } = useFieldData();
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [seed, setSeed] = useState<string | null>(null);
  const [anomaly, setAnomaly] = useState<Anomaly | "">("");
  const disabled = source === "loading" || needsSetup || busy !== null;

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

  return (
    <section aria-label="Actions" className="overflow-hidden rounded-lg border bg-card shadow-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3 p-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button
            disabled={disabled}
            onClick={() =>
              run(
                "feed",
                () => actions.advanceFeed(anomaly || undefined),
                `New entries arrived in the mock feed${anomaly ? " with a planted anomaly" : ""}. ${status?.ingest.enabled ? "Auto ingest picks them up on its next run." : "Press Ingest now to read them."}`,
              )
            }
          >
            <Download aria-hidden="true" />
            New entries arrive
          </Button>
          <AnomalyPicker value={anomaly} onChange={setAnomaly} disabled={disabled} />
        </div>
        <span aria-hidden="true" className="hidden h-6 w-px bg-border xl:block" />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() =>
              run(
                "ingest",
                actions.ingestNow,
                source === "live"
                  ? "Ingest queued. The agent reads every source; results appear below as they land."
                  : "The agent ran and checked every source.",
              )
            }
          >
            <RefreshCw aria-hidden="true" className={cn(busy === "ingest" && "animate-spin")} />
            Ingest now
          </Button>
          <Button
            variant="outline"
            disabled={disabled}
            title="For now this runs a fresh ingest and audit."
            onClick={() =>
              run(
                "analysis",
                actions.ingestNow,
                "Analysis started: a fresh ingest and audit. Forecast analysis comes next.",
              )
            }
          >
            <Play aria-hidden="true" />
            Launch analysis
          </Button>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() =>
              run(
                "export",
                async () => setSeed(await actions.exportSeed()),
                "Seed exported for a simulation.",
              )
            }
          >
            <FileOutput aria-hidden="true" />
            Export seed for simulation
          </Button>
        </div>
        <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 xl:ml-auto xl:w-auto">
          <AutoIngestToggle />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t bg-muted/40 px-3 py-2">
        <output
          className={cn(
            "block min-h-5 text-[13px]",
            message?.error ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {busy
            ? "Working..."
            : (message?.text ??
              "Ready. Every action here only reads or checks; nothing moves money.")}
        </output>
        <Link
          href="/field/map"
          className="inline-flex items-center gap-1 rounded text-[13px] font-medium text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Watch it on the brain map
          <ArrowUpRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>
      <SeedDialog text={seed} demo={source === "demo"} onClose={() => setSeed(null)} />
    </section>
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

function FindingCard({ finding, now }: { finding: FieldFinding; now: number }) {
  const { actions } = useFieldData();
  const reduced = useReducedMotion();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  const noteId = `note-${finding.id}`;
  return (
    <motion.li
      layout={!reduced}
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="bg-card px-4 py-4"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge variant={SEVERITY_BADGE[finding.severity]}>{SEVERITY_LABEL[finding.severity]}</Badge>
        <span className="text-sm font-semibold">{FINDING_LABEL[finding.kind]}</span>
        {finding.escalated ? (
          <Badge variant="outline" className="font-normal text-muted-foreground">
            Escalated to you
          </Badge>
        ) : null}
        <span className="ml-auto text-xs text-muted-foreground">
          Found {timeAgo(finding.detectedAt, now)}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6">{finding.summary}</p>
      <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        Records
        {finding.refs.map((ref) => (
          <code
            key={ref}
            className="rounded border bg-muted/60 px-1.5 py-px font-mono text-[11px] text-foreground"
          >
            {ref}
          </code>
        ))}
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <label htmlFor={noteId} className="sr-only">
          Note (optional)
        </label>
        <Input
          id={noteId}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="Add a note (optional): why you decided this"
          className="h-8 sm:flex-1"
        />
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            className="flex-1 sm:flex-none"
            disabled={busy !== null}
            onClick={() => decide("approved")}
          >
            <Check aria-hidden="true" />
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 sm:flex-none"
            disabled={busy !== null}
            onClick={() => decide("rejected")}
          >
            <X aria-hidden="true" />
            Reject
          </Button>
        </div>
      </div>
      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
    </motion.li>
  );
}

function DecidedList({ findings }: { findings: FieldFinding[] }) {
  return (
    <details className="group overflow-hidden rounded-lg border bg-card text-sm shadow-xs">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
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
        {findings.map((f) => (
          <li
            key={f.id}
            className="grid gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[88px_minmax(0,1fr)]"
          >
            <div>
              <Badge variant={f.status === "approved" ? "success" : "secondary"}>
                {f.status === "approved" ? "Approved" : "Rejected"}
              </Badge>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">{FINDING_LABEL[f.kind]}</p>
              <p className="mt-0.5 leading-6">{f.summary}</p>
              {f.note ? (
                <p className="mt-1 text-[13px] text-muted-foreground">Note: {f.note}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

const FEED_CAP = 14;

export function ActivityFeed({
  operations,
  now,
  className,
}: {
  operations?: FieldOperation[];
  now: number;
  className?: string;
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
      aside={<History aria-hidden="true" className="size-4 text-muted-foreground" />}
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
                    <p className="text-[13px] leading-5 text-muted-foreground">{op.summary}</p>
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
