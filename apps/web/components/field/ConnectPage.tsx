"use client";

import {
  Check,
  ChevronDown,
  CircleDashed,
  Lock,
  Plug,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { Component, type ReactNode, useEffect, useState } from "react";
import { TOOLS, type ToolInfo } from "../../convex/connectors/catalog";
import type { ToolId } from "../../convex/connectors/types";
import { cn } from "../../lib/utils";
import { ToolLogo } from "../icons/ToolLogo";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { PageHeader, Section, StatTile } from "../ui/page";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../ui/sheet";
import { Skeleton } from "../ui/skeleton";
import { ConnectDataProvider, type ConnectTool, useConnectData } from "./connect-data";
import { EXCLUDED_GROUPS, EXCLUDED_GROUP_LABEL, type ExcludedReport } from "./connect-excluded";
import { SourceBadge, timeAgo, useNow } from "./parts";

const LIST_LABEL: Record<string, [string, string]> = {
  customers: ["customer", "customers"],
  invoices: ["invoice", "invoices"],
  billingPlans: ["subscription", "subscriptions"],
  pendingPayouts: ["payout on the way", "payouts on the way"],
  bankTxns: ["bank transaction", "bank transactions"],
  bills: ["bill", "bills"],
  cardTxns: ["card charge", "card charges"],
  payroll: ["payroll run", "payroll runs"],
  deals: ["deal", "deals"],
};
const n = (x: number) => x.toLocaleString("en-US");
const plural = (count: number, [one, many]: [string, string]) =>
  `${n(count)} ${count === 1 ? one : many}`;
const toolName = (id: ToolId) => TOOLS.find((t) => t.id === id)?.name ?? id;

/** A read older than this is not "current". */
const STALE_MS = 60 * 60_000;
/** With a backend configured, no answer after this long is a connection problem, not loading. */
const UNREACHABLE_MS = 10_000;
/** Stop showing "Reading tools..." if a requested read never reports back. */
const READ_TIMEOUT_MS = 30_000;

export function ConnectPage() {
  return (
    <ConnectBoundary>
      <ConnectDataProvider>
        <ConnectView />
      </ConnectDataProvider>
    </ConnectBoundary>
  );
}

/** A failed backend query is a connection failure, shown with Retry; never demo data. */
class ConnectBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-[1200px]">
        <ConnectionFailed
          detail={this.state.error.message}
          onRetry={() => this.setState({ error: null })}
        />
      </div>
    );
  }
}

function ConnectionFailed({ detail, onRetry }: { detail?: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/25 bg-card p-4 text-sm"
    >
      <div className="min-w-0">
        <p className="font-medium text-destructive">Could not reach the backend</p>
        <p className="mt-0.5 text-muted-foreground">
          This is a connection problem, not demo data. Your tools were not read.
          {detail ? ` (${detail})` : ""}
        </p>
      </div>
      <Button variant="outline" onClick={onRetry}>
        <RefreshCw aria-hidden="true" />
        Retry
      </Button>
    </div>
  );
}

/** How fresh the connected tools are, from their last successful reads. */
function freshness(on: ConnectTool[], now: number) {
  const reads = on.map((t) => ({
    tool: t.tool,
    at: t.lastError ? null : t.lastSyncAt,
  }));
  const oldest = [...reads].sort((a, b) =>
    a.at === b.at ? 0 : a.at === null ? -1 : b.at === null ? 1 : a.at < b.at ? -1 : 1,
  )[0];
  const current =
    reads.length > 0 && reads.every((r) => r.at !== null && now - Date.parse(r.at) < STALE_MS);
  return { oldest, current };
}

export function ConnectView() {
  const data = useConnectData();
  const now = useNow();
  const [asking, setAsking] = useState<ToolInfo | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [excludedOpen, setExcludedOpen] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const tools = data.tools ?? [];
  const on = tools.filter((t) => t.status !== "disconnected");
  const ok = on.reduce((s, t) => s + t.checksOk, 0);
  const total = on.reduce((s, t) => s + t.checksTotal, 0);
  const excluded = on.reduce((s, t) => s + t.skipped, 0);
  const received = on.reduce((s, t) => s + t.recordsIn, 0);
  const fresh = freshness(on, now);

  // A read is pending from the click until any tool's last read changes (or a timeout), and
  // while a newly connected tool waits for its first read.
  const signature = on.map((t) => `${t.tool}:${t.lastSyncAt}:${t.lastError}`).join("|");
  useEffect(() => {
    if (reading !== null && signature !== reading) setReading(null);
  }, [signature, reading]);
  useEffect(() => {
    if (reading === null) return;
    const id = setTimeout(() => setReading(null), READ_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [reading]);
  const firstRead = on.some((t) => t.lastSyncAt === null && !t.lastError);
  const pending = reading !== null || firstRead;

  const waiting = data.source === "loading" || (data.source === "live" && data.tools === undefined);
  useEffect(() => {
    if (!waiting) {
      setUnreachable(false);
      return;
    }
    const id = setTimeout(() => setUnreachable(true), UNREACHABLE_MS);
    return () => clearTimeout(id);
  }, [waiting]);

  async function run(task: () => Promise<void>, done: string) {
    setMessage(null);
    try {
      await task();
      setMessage({ text: done });
    } catch (error) {
      setReading(null);
      setMessage({
        text: `That did not work: ${error instanceof Error ? error.message : "unknown error"}`,
        error: true,
      });
    }
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-6">
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            {data.name ?? "Your company"}
            <SourceLabel />
          </span>
        }
        title={
          !data.tools || on.length === 0
            ? "Connect your tools"
            : on.length === TOOLS.length
              ? `All ${TOOLS.length} tools connected`
              : `${on.length} of ${TOOLS.length} tools connected`
        }
        description="Domino reads the bank, billing, books, payroll, cards and sales, turns them into one set of books and checks that they agree. It only reads. It never moves money."
      />

      {unreachable ? <ConnectionFailed onRetry={() => window.location.reload()} /> : null}

      <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {data.tools === undefined ? (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[100px] rounded-lg" />)
        ) : (
          <>
            <StatTile
              label="Tools connected"
              value={`${on.length}`}
              unit={`of ${TOOLS.length}`}
              delta="Read-only access"
            />
            <StatTile
              label="Freshness"
              value={
                on.length === 0
                  ? "None yet"
                  : fresh.oldest?.at
                    ? timeAgo(fresh.oldest.at, now)
                    : "Not read"
              }
              delta={
                on.length === 0 ? (
                  "Connect a tool to start"
                ) : fresh.current ? (
                  <Badge variant="success">All tools current</Badge>
                ) : fresh.oldest ? (
                  <Badge variant="warning" className="whitespace-normal">
                    Oldest read: {toolName(fresh.oldest.tool)},{" "}
                    {fresh.oldest.at ? timeAgo(fresh.oldest.at, now) : "not read yet"}
                  </Badge>
                ) : null
              }
            />
            <StatTile
              label="Numbers that agree"
              value={total === 0 ? "None yet" : `${n(ok)}`}
              unit={total === 0 ? undefined : `of ${n(total)}`}
              delta={
                total === 0
                  ? "Connect two tools to compare"
                  : ok < total
                    ? `${n(total - ok)} to look at`
                    : "All checks match"
              }
              tone={total > 0 && ok < total ? "warning" : total > 0 ? "positive" : "neutral"}
            />
            <StatTile
              label="Excluded records"
              value={n(excluded)}
              unit={received > 0 ? `of ${n(received)} read` : undefined}
              delta={
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto whitespace-normal px-0 text-left text-[13px] max-sm:min-h-11"
                  disabled={on.length === 0}
                  onClick={() => setExcludedOpen(true)}
                >
                  Review excluded records
                </Button>
              }
            />
          </>
        )}
      </section>

      <Section
        title="Integrations"
        description="Each tool is read on its own, then matched against the others."
        flush
        actions={
          <>
            <output
              aria-live="polite"
              className={cn(
                "text-[13px]",
                message?.error ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {pending ? "Reading tools..." : (message?.text ?? "")}
            </output>
            <Button
              variant="outline"
              size="sm"
              disabled={on.length === 0 || data.source === "loading" || pending}
              onClick={() => {
                setReading(signature);
                run(data.syncNow, "Read every connected tool again.");
              }}
            >
              <RefreshCw
                aria-hidden="true"
                className={cn(pending && "animate-spin motion-reduce:animate-none")}
              />
              Read all tools now
            </Button>
          </>
        }
      >
        {data.tools === null ? (
          <div className="p-6 text-sm text-muted-foreground">
            There is no company yet. Pick one in the company switcher at the top, then come back to
            connect its tools.
          </div>
        ) : (
          <div>
            <div
              aria-hidden="true"
              className="hidden grid-cols-[minmax(0,1fr)_140px_170px_150px_20px] gap-4 border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground sm:grid"
            >
              <span>Tool</span>
              <span>State</span>
              <span>Last successful read</span>
              <span>Exceptions</span>
              <span />
            </div>
            <ul className="divide-y">
              {TOOLS.map((info) => {
                const tool = tools.find((t) => t.tool === info.id);
                return (
                  <li key={info.id} className="min-w-0">
                    {tool ? (
                      <ToolRow
                        info={info}
                        tool={tool}
                        now={now}
                        onConnect={() => setAsking(info)}
                        onReview={() => setExcludedOpen(true)}
                        onDisconnect={() =>
                          run(
                            () => data.disconnect(info.id),
                            `${info.name} disconnected. Domino stopped reading it.`,
                          )
                        }
                      />
                    ) : (
                      <div className="flex items-center gap-3 px-4 py-4" aria-busy="true">
                        <Skeleton className="size-6 rounded" />
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="ml-auto h-4 w-20" />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Section>

      <ExcludedSheet
        open={excludedOpen}
        onOpenChange={setExcludedOpen}
        tools={on}
        signature={signature}
      />

      <ConsentDialog
        info={asking}
        account={`${data.name ?? "Your company"} (sandbox)`}
        onCancel={() => setAsking(null)}
        onAllow={(id) => {
          setAsking(null);
          const name = TOOLS.find((t) => t.id === id)?.name ?? id;
          run(() => data.connect(id), `${name} connected. Domino is reading it now.`);
        }}
      />
    </div>
  );
}

function SourceLabel() {
  const { source, note } = useConnectData();
  return <SourceBadge source={source} note={note} />;
}

function StatusBadge({ tool }: { tool: ConnectTool }) {
  if (tool.status === "error")
    return (
      <Badge variant="destructive">
        <TriangleAlert aria-hidden="true" />
        Needs attention
      </Badge>
    );
  if (tool.status === "connected")
    return (
      <Badge variant="success">
        <Check aria-hidden="true" />
        Connected
      </Badge>
    );
  return (
    <Badge variant="secondary" className="font-normal text-muted-foreground">
      <CircleDashed aria-hidden="true" />
      Not connected
    </Badge>
  );
}

function lastRead(tool: ConnectTool, now: number) {
  if (tool.lastError) return "Last read failed";
  if (tool.lastSyncAt === null) return "Reading for the first time...";
  return timeAgo(tool.lastSyncAt, now);
}

function exceptions(tool: ConnectTool) {
  if (tool.lastError) return { text: "Read failed", warn: true };
  const off = tool.checksTotal - tool.checksOk;
  if (off > 0)
    return { text: `${n(off)} ${off === 1 ? "check differs" : "checks differ"}`, warn: true };
  return { text: "None", warn: false };
}

const ROW_GRID = "sm:grid sm:grid-cols-[minmax(0,1fr)_140px_170px_150px_20px] sm:gap-4";

function ToolRow({
  info,
  tool,
  now,
  onConnect,
  onDisconnect,
  onReview,
}: {
  info: ToolInfo;
  tool: ConnectTool;
  now: number;
  onConnect: () => void;
  onDisconnect: () => void;
  onReview: () => void;
}) {
  const [open, setOpen] = useState(false);
  const on = tool.status !== "disconnected";
  const detailsId = `tool-${info.id}-details`;
  const name = (
    <span className="flex min-w-0 items-center gap-3">
      <ToolLogo vendor={info.id} size={28} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium leading-5">{info.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{info.kind}</span>
      </span>
    </span>
  );

  if (!on)
    return (
      <div className={cn("flex items-center gap-3 px-4 py-3 sm:items-center sm:py-2.5", ROW_GRID)}>
        <span className="min-w-0 flex-1">{name}</span>
        <span className="hidden sm:block">
          <StatusBadge tool={tool} />
        </span>
        <span className="hidden text-[13px] text-muted-foreground sm:block">Read-only access</span>
        <span className="shrink-0 sm:col-span-2 sm:justify-self-start">
          <Button variant="outline" size="sm" onClick={onConnect}>
            <Plug aria-hidden="true" />
            Connect
          </Button>
        </span>
      </div>
    );

  const ex = exceptions(tool);
  const counts = info.lists.flatMap((l) => {
    const count = tool.counts[l];
    // A zero here means another tool already supplied those records (deduped).
    return count === undefined || count === 0 ? [] : [[l, count] as const];
  });
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "w-full px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:items-center sm:py-2.5",
          ROW_GRID,
        )}
      >
        <span className="flex min-w-0 items-center justify-between gap-3">
          {name}
          <span className="shrink-0 sm:hidden">
            <StatusBadge tool={tool} />
          </span>
        </span>
        <span className="hidden sm:block">
          <StatusBadge tool={tool} />
        </span>
        <span
          className={cn(
            "mt-1 block pl-10 text-[13px] text-muted-foreground sm:mt-0 sm:pl-0",
            tool.lastError && "text-destructive",
          )}
        >
          <span className="sm:hidden">Read </span>
          {lastRead(tool, now)}
          <span className={cn("sm:hidden", ex.warn && "text-warning")}>
            {" · "}
            {ex.text === "None" ? "No exceptions" : ex.text}
          </span>
        </span>
        <span
          className={cn(
            "hidden text-[13px] sm:block",
            ex.warn ? "text-warning" : "text-muted-foreground",
          )}
        >
          {ex.text}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "hidden size-4 text-muted-foreground transition-transform motion-reduce:transition-none sm:block",
            open && "rotate-180",
          )}
        />
        <span className="sr-only">{open ? "Hide details" : "Show details"}</span>
      </button>
      {open ? (
        <div id={detailsId} className="space-y-3 border-t bg-muted/20 px-4 py-4 text-[13px]">
          <p className="text-muted-foreground">{info.provides}</p>
          {tool.lastError ? (
            <p className="rounded-md border border-destructive/25 bg-destructive/[0.04] px-3 py-2 text-destructive">
              Last read failed: {tool.lastError}
            </p>
          ) : null}
          {counts.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5" aria-label="Records kept">
              {counts.map(([list, count]) => (
                <li
                  key={list}
                  className="rounded-md border bg-card px-2 py-0.5 text-xs tabular-nums"
                >
                  {plural(count, LIST_LABEL[list] ?? [list, list])}
                </li>
              ))}
            </ul>
          ) : null}
          <dl className="grid max-w-md grid-cols-3 gap-2 text-xs">
            <div>
              <dt className="text-muted-foreground">Received</dt>
              <dd className="font-medium tabular-nums">{n(tool.recordsIn)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Kept</dt>
              <dd className="font-medium tabular-nums">{n(tool.recordsOut)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Excluded</dt>
              <dd className="font-medium tabular-nums">{n(tool.skipped)}</dd>
            </div>
          </dl>
          {tool.checksTotal > 0 ? (
            <p
              className={cn(
                "inline-flex items-center gap-1.5 text-xs",
                tool.checksOk === tool.checksTotal ? "text-safe" : "text-warning",
              )}
            >
              <ShieldCheck aria-hidden="true" className="size-3.5" />
              {n(tool.checksOk)} of {n(tool.checksTotal)} match another tool
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="text-xs text-muted-foreground">
              {tool.account ?? "Connected"} · read-only access
            </span>
            <span className="flex flex-wrap gap-2">
              {tool.skipped > 0 ? (
                <Button variant="outline" size="sm" onClick={onReview}>
                  Review excluded records
                </Button>
              ) : null}
              <Button variant="outline" size="sm" onClick={onDisconnect}>
                Disconnect
              </Button>
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Excluded records by reason, from the connector receipts; totals reconcile with the rows. */
function ExcludedSheet({
  open,
  onOpenChange,
  tools,
  signature,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tools: ConnectTool[];
  signature: string;
}) {
  const { loadExcluded } = useConnectData();
  const [report, setReport] = useState<ExcludedReport | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the reads change
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setReport(undefined);
    setError(null);
    loadExcluded().then(
      (r) => alive && setReport(r),
      (e) => alive && setError(e instanceof Error ? e.message : "Could not load the reasons"),
    );
    return () => {
      alive = false;
    };
  }, [open, signature, loadExcluded]);

  const excluded = tools.reduce((s, t) => s + t.skipped, 0);
  const received = tools.reduce((s, t) => s + t.recordsIn, 0);
  const kept = tools.reduce((s, t) => s + t.recordsOut, 0);
  const unitemized = received - kept - excluded;
  const rows = (report ?? []).flatMap((r) => r.reasons.map((x) => ({ ...x, tool: r.tool })));
  const other = tools.map((t) => ({
    tool: t.tool,
    count: t.skipped - rows.filter((r) => r.tool === t.tool).reduce((s, r) => s + r.count, 0),
  }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b p-5">
          <SheetTitle>Excluded records</SheetTitle>
          <SheetDescription>
            {n(excluded)} of {n(received)} records read were excluded, each with a reason. Kept{" "}
            {n(kept)} + excluded {n(excluded)}
            {unitemized !== 0 ? ` + ${n(unitemized)} not itemized` : ""} = {n(received)} read.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-6 p-5 text-sm">
          {error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : report === undefined ? (
            <div className="space-y-2" aria-busy="true">
              <p className="text-[13px] text-muted-foreground">Reading the connector receipts...</p>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : report === null ? (
            <>
              <p className="text-[13px] text-muted-foreground">
                This backend sends the excluded count for each tool, not the reasons. Each reason is
                in the connector receipt for that read.
              </p>
              <ul className="divide-y rounded-lg border">
                {tools.map((t) => (
                  <li key={t.tool} className="flex justify-between gap-3 px-3 py-2">
                    <span>{toolName(t.tool)}</span>
                    <span className="tabular-nums">{n(t.skipped)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            EXCLUDED_GROUPS.map((group) => {
              const mine = rows.filter((r) => r.group === group);
              const sum = mine.reduce((s, r) => s + r.count, 0);
              return (
                <section key={group} aria-labelledby={`excluded-${group}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 id={`excluded-${group}`} className="font-semibold">
                      {EXCLUDED_GROUP_LABEL[group].title}
                    </h3>
                    <span className="tabular-nums text-muted-foreground">{n(sum)}</span>
                  </div>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
                    {EXCLUDED_GROUP_LABEL[group].note}
                  </p>
                  {mine.length > 0 ? (
                    <ul className="mt-2 divide-y rounded-lg border">
                      {mine.map((r) => (
                        <li
                          key={`${r.tool}|${r.reason}`}
                          className="flex items-start justify-between gap-3 px-3 py-2"
                        >
                          <span className="min-w-0">
                            <span className="block">{r.reason}</span>
                            <span className="block text-xs text-muted-foreground">
                              {toolName(r.tool)}
                            </span>
                          </span>
                          <span className="shrink-0 tabular-nums">{n(r.count)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-[13px] text-muted-foreground">None in this read.</p>
                  )}
                </section>
              );
            })
          )}
          {report
            ? other
                .filter((o) => o.count !== 0)
                .map((o) => (
                  <p key={o.tool} className="text-[13px] text-warning">
                    {toolName(o.tool)}: {n(o.count)} excluded records have no reason in this
                    receipt.
                  </p>
                ))
            : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ConsentDialog({
  info,
  account,
  onCancel,
  onAllow,
}: {
  info: ToolInfo | null;
  account: string;
  onCancel: () => void;
  onAllow: (id: ToolId) => void;
}) {
  return (
    <Dialog open={info !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-md">
        {info ? (
          <>
            <DialogHeader>
              <DialogTitle>Connect {info.name}</DialogTitle>
              <DialogDescription>
                Practice sign-in: no password, nothing leaves this demo. You are signed in as{" "}
                {account}.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              <div className="space-y-2">
                <p className="font-medium">Domino will read</p>
                <ul className="space-y-1.5">
                  {info.reads.map((r) => (
                    <li key={r} className="flex items-start gap-2">
                      <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-safe" />
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="flex items-start gap-2 rounded-md border bg-muted/50 p-3 text-muted-foreground">
                <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                Domino never moves money, pays bills or changes anything in {info.name}. You can
                disconnect at any time.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button onClick={() => onAllow(info.id)}>Allow read-only access</Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
