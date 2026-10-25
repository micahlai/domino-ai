"use client";

import {
  ArrowUpRight,
  Check,
  Copy,
  Download,
  FileOutput,
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
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Skeleton } from "../ui/skeleton";
import { useFieldData } from "./data";
import { byTime } from "./graph";
import {
  AnomalyPicker,
  AutoIngestToggle,
  DataLabel,
  FINDING_LABEL,
  OPERATION_LABEL,
  SEVERITY_LABEL,
  SEVERITY_TONE,
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
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>Finance agent</span>
            <DataLabel />
          </div>
          <h1 className="text-3xl font-medium tracking-tight">{headline}</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            The finance agent reads new entries from billing, customer records, cards, books,
            payroll and the bank, then checks them for anything odd. You decide every flag. Domino
            never moves money.
          </p>
        </div>
      </header>

      {data.needsSetup ? <SetupCard /> : null}
      <StatusStrip now={now} />
      <ActionBar />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section aria-labelledby="queue-title" className="min-w-0 space-y-4">
          <h2 id="queue-title" className="text-sm font-medium">
            Review queue
            {data.findings ? (
              <span className="ml-2 text-muted-foreground">{open.length} open</span>
            ) : null}
          </h2>
          {!data.findings ? (
            <Skeleton className="h-40 w-full" />
          ) : open.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
              <Inbox aria-hidden="true" className="size-5 shrink-0" />
              No open flags. New ones show up here when the audit agent finds something.
            </div>
          ) : (
            <ul className="space-y-3">
              <AnimatePresence initial={false}>
                {open.map((finding) => (
                  <FindingCard key={finding.id} finding={finding} now={now} />
                ))}
              </AnimatePresence>
            </ul>
          )}
          {decided.length > 0 ? <DecidedList findings={decided} /> : null}
        </section>
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
    <div className="space-y-2">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-4">
        {(items ?? Array.from({ length: 4 }, () => null)).map((item, i) => (
          <div key={item?.label ?? i} className="bg-card p-4">
            {item ? (
              <>
                <dt className="text-xs text-muted-foreground">{item.label}</dt>
                <dd className="mt-1 text-lg font-medium">{item.value}</dd>
                <dd className="text-xs text-muted-foreground">{item.note}</dd>
              </>
            ) : (
              <Skeleton className="h-14 w-full" />
            )}
          </div>
        ))}
      </dl>
      {status?.ingest.lastStatus === "failed" && status.lastError ? (
        <p role="alert" className="text-sm text-[hsl(var(--danger-text))]">
          Last ingest failed: {status.lastError}
        </p>
      ) : null}
    </div>
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
    <section className="rounded-xl border border-dashed p-4 text-sm">
      <p>No live feed yet. Connect the six mock sources for a synthetic company to start.</p>
      <Button
        className="mt-3"
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
      {error ? <p className="mt-2 text-[hsl(var(--danger-text))]">{error}</p> : null}
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
    <section aria-label="Actions" className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
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
          <Download aria-hidden="true" className="mr-2 size-4" />
          New entries arrive
        </Button>
        <AnomalyPicker value={anomaly} onChange={setAnomaly} disabled={disabled} />
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
          <RefreshCw
            aria-hidden="true"
            className={cn("mr-2 size-4", busy === "ingest" && "animate-spin")}
          />
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
          <Play aria-hidden="true" className="mr-2 size-4" />
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
          <FileOutput aria-hidden="true" className="mr-2 size-4" />
          Export seed for simulation
        </Button>
        <AutoIngestToggle />
        <Link
          href="/field/map"
          className="ml-auto inline-flex min-h-9 items-center gap-1 rounded text-sm text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Watch it on the brain map
          <ArrowUpRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
      <output
        className={cn(
          "mt-3 block min-h-5 text-sm",
          message?.error ? "text-[hsl(var(--danger-text))]" : "text-muted-foreground",
        )}
      >
        {busy ? "Working..." : (message?.text ?? "")}
      </output>
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
            verdict?.ok === false ? "text-[hsl(var(--danger-text))]" : "text-muted-foreground",
          )}
        >
          {verdict?.ok ? <Check aria-hidden="true" className="size-4 text-primary" /> : null}
          {verdict?.text ?? "Checking the seed..."}
        </p>
        <pre
          aria-label="Weekly seed JSON text"
          className="max-h-[50vh] overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-5"
        >
          {text}
        </pre>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" asChild>
            <a
              download="weekly-seed.json"
              href={`data:application/json;charset=utf-8,${encodeURIComponent(text ?? "")}`}
            >
              <Download aria-hidden="true" className="mr-2 size-4" />
              Download
            </a>
          </Button>
          <Button
            onClick={async () => {
              await navigator.clipboard.writeText(text ?? "");
              setCopied(true);
            }}
          >
            <Copy aria-hidden="true" className="mr-2 size-4" />
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
      className="rounded-xl border bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          className={cn(
            "rounded-md border px-2 py-0.5 font-medium",
            SEVERITY_TONE[finding.severity],
          )}
        >
          {SEVERITY_LABEL[finding.severity]}
        </span>
        <span className="font-medium">{FINDING_LABEL[finding.kind]}</span>
        {finding.escalated ? (
          <span className="text-muted-foreground">· escalated to you</span>
        ) : null}
        <span className="text-muted-foreground">· found {timeAgo(finding.detectedAt, now)}</span>
      </div>
      <p className="mt-2 text-sm leading-6">{finding.summary}</p>
      <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        Records:
        {finding.refs.map((ref) => (
          <code key={ref} className="rounded bg-muted px-1.5 py-0.5 font-mono">
            {ref}
          </code>
        ))}
      </p>
      <label htmlFor={noteId} className="mt-3 block text-xs text-muted-foreground">
        Note (optional)
      </label>
      <textarea
        id={noteId}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder="Why you decided this"
        className="mt-1 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy !== null} onClick={() => decide("approved")}>
          <Check aria-hidden="true" className="mr-1.5 size-3.5" />
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => decide("rejected")}
        >
          <X aria-hidden="true" className="mr-1.5 size-3.5" />
          Reject
        </Button>
        <span className="text-xs text-muted-foreground">
          Approve if the flag is a real problem; reject if it is fine.
        </span>
      </div>
      {error ? <p className="mt-2 text-sm text-[hsl(var(--danger-text))]">{error}</p> : null}
    </motion.li>
  );
}

function DecidedList({ findings }: { findings: FieldFinding[] }) {
  return (
    <details className="rounded-xl border p-4 text-sm">
      <summary className="cursor-pointer text-muted-foreground">
        {findings.length} decided {findings.length === 1 ? "flag" : "flags"}
      </summary>
      <ul className="mt-3 space-y-3">
        {findings.map((f) => (
          <li key={f.id} className="border-t pt-3">
            <p className="text-xs">
              <span className={f.status === "approved" ? "text-primary" : "text-muted-foreground"}>
                {f.status === "approved" ? "Approved" : "Rejected"}
              </span>
              <span className="text-muted-foreground"> · {FINDING_LABEL[f.kind]}</span>
            </p>
            <p className="mt-1 leading-6">{f.summary}</p>
            {f.note ? <p className="mt-1 text-muted-foreground">Note: {f.note}</p> : null}
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
    <section aria-labelledby="activity-title" className={cn("min-w-0 space-y-4", className)}>
      <h2 id="activity-title" className="text-sm font-medium">
        Recent activity
      </h2>
      {!operations ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No recorded activity yet.</p>
      ) : (
        <ol className="space-y-0 border-l">
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
                  className="relative py-2 pl-4"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute -left-[3.5px] top-3.5 size-1.5 rounded-full",
                      op.status === "failed" ? "bg-destructive" : "bg-muted-foreground/60",
                    )}
                  />
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{OPERATION_LABEL[op.kind]}</span>
                    {" · "}
                    {op.agent}
                    {op.tool ? ` · ${op.tool}` : ""}
                    {" · "}
                    <time dateTime={op.at} title={clock(op.at)}>
                      {timeAgo(op.at, now)}
                    </time>
                  </p>
                  <p className="text-sm leading-5">{op.summary}</p>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      )}
    </section>
  );
}
