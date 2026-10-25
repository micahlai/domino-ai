"use client";

import { Check, Lock, Plug, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { TOOLS, type ToolInfo } from "../../convex/connectors/catalog";
import type { ToolId } from "../../convex/connectors/types";
import { cn } from "../../lib/utils";
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
import { Skeleton } from "../ui/skeleton";
import { ConnectDataProvider, type ConnectTool, useConnectData } from "./connect-data";
import { FieldTabs, timeAgo, useNow } from "./parts";

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

export function ConnectPage() {
  return (
    <ConnectDataProvider>
      <ConnectView />
    </ConnectDataProvider>
  );
}

export function ConnectView() {
  const data = useConnectData();
  const now = useNow();
  const [asking, setAsking] = useState<ToolInfo | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const tools = data.tools ?? [];
  const on = tools.filter((t) => t.status !== "disconnected");
  const ok = on.reduce((s, t) => s + t.checksOk, 0);
  const total = on.reduce((s, t) => s + t.checksTotal, 0);
  const lastRead = on
    .map((t) => t.lastSyncAt)
    .filter((x): x is string => x !== null)
    .sort()
    .at(-1);

  async function run(task: () => Promise<void>, done: string) {
    setMessage(null);
    try {
      await task();
      setMessage({ text: done });
    } catch (error) {
      setMessage({
        text: `That did not work: ${error instanceof Error ? error.message : "unknown error"}`,
        error: true,
      });
    }
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{data.name ?? "Your company"}</span>
            <SourceLabel />
          </div>
          <h1 className="text-3xl font-medium tracking-tight">Connect your tools</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Domino reads the tools your company already uses: the bank, billing, books, payroll,
            cards and sales. It turns them into one set of books and checks that the tools agree
            with each other. Domino only reads. It never moves money.
          </p>
        </div>
        <FieldTabs />
      </header>

      <section aria-label="Summary" className="rounded-xl border bg-card p-4">
        <dl className="grid gap-4 sm:grid-cols-3">
          <Stat
            label="Tools connected"
            value={data.tools ? `${on.length} of ${TOOLS.length}` : "..."}
          />
          <Stat label="Last read" value={timeAgo(lastRead, now)} />
          <Stat
            label="Numbers that agree across tools"
            value={total === 0 ? "Connect two tools to compare" : `${n(ok)} of ${n(total)}`}
            tone={total > 0 && ok < total ? "warn" : undefined}
          />
        </dl>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            disabled={on.length === 0 || data.source === "loading"}
            onClick={() => run(data.syncNow, "Reading every connected tool again.")}
          >
            <RefreshCw aria-hidden="true" className="mr-2 size-4" />
            Read all tools now
          </Button>
          <output
            className={cn(
              "text-sm",
              message?.error ? "text-[hsl(var(--danger-text))]" : "text-muted-foreground",
            )}
          >
            {message?.text ?? ""}
          </output>
        </div>
      </section>

      {data.tools === null ? (
        <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          There is no company yet. Start the live feed on Review and actions, then come back to
          connect its tools.
        </p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {TOOLS.map((info) => {
            const tool = tools.find((t) => t.tool === info.id);
            return (
              <li key={info.id}>
                {tool ? (
                  <ToolCard
                    info={info}
                    tool={tool}
                    now={now}
                    onConnect={() => setAsking(info)}
                    onDisconnect={() =>
                      run(
                        () => data.disconnect(info.id),
                        `${info.name} disconnected. Domino stopped reading it.`,
                      )
                    }
                  />
                ) : (
                  <Skeleton className="h-56 w-full rounded-xl" />
                )}
              </li>
            );
          })}
        </ul>
      )}

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
  if (source === "live")
    return (
      <Badge variant="outline" className="gap-1.5 font-normal">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
        Live
      </Badge>
    );
  if (source === "loading")
    return (
      <Badge variant="outline" className="font-normal text-muted-foreground">
        Connecting...
      </Badge>
    );
  return (
    <Badge variant="outline" title={note} className="border-dashed font-normal text-clay">
      Demo data · recorded mock sync
    </Badge>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-lg font-medium", tone === "warn" && "text-clay")}>{value}</dd>
    </div>
  );
}

function StatusPill({ tool }: { tool: ConnectTool }) {
  if (tool.status === "error")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-[hsl(var(--danger-text))]">
        <TriangleAlert aria-hidden="true" className="size-3.5" />
        Needs attention
      </span>
    );
  if (tool.status === "connected")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-primary">
        <Check aria-hidden="true" className="size-3.5" />
        Connected
      </span>
    );
  return <span className="text-xs text-muted-foreground">Not connected</span>;
}

function ToolCard({
  info,
  tool,
  now,
  onConnect,
  onDisconnect,
}: {
  info: ToolInfo;
  tool: ConnectTool;
  now: number;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const on = tool.status !== "disconnected";
  const counts = info.lists.flatMap((l) => {
    const count = tool.counts[l];
    // A zero here means another tool already supplied those records (deduped).
    return count === undefined || count === 0 ? [] : [[l, count] as const];
  });
  return (
    <article
      aria-label={info.name}
      className={cn(
        "flex h-full flex-col gap-4 rounded-xl border bg-card p-5",
        on && "border-primary/30",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-lg border text-sm font-semibold tracking-tight",
            on ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          {info.initials}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-medium leading-tight">{info.name}</h2>
          <p className="text-xs text-muted-foreground">{info.kind}</p>
        </div>
        <StatusPill tool={tool} />
      </div>
      <p className="text-sm text-muted-foreground">{info.provides}</p>

      {on ? (
        <div className="space-y-2 text-sm">
          {tool.lastError ? (
            <p className="text-[hsl(var(--danger-text))]">Last read failed: {tool.lastError}</p>
          ) : tool.lastSyncAt === null ? (
            <p className="inline-flex items-center gap-2 text-muted-foreground">
              <RefreshCw aria-hidden="true" className="size-3.5 animate-spin" />
              Reading for the first time...
            </p>
          ) : (
            <>
              <p className="text-muted-foreground">Read {timeAgo(tool.lastSyncAt, now)}</p>
              {counts.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {counts.map(([list, count]) => (
                    <li key={list} className="rounded-md bg-muted px-2 py-0.5 text-xs">
                      {plural(count, LIST_LABEL[list] ?? [list, list])}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Received {n(tool.recordsIn)} · kept {n(tool.recordsOut)} · set aside{" "}
                {n(tool.skipped)}, each with a reason
              </p>
              {tool.checksTotal > 0 ? (
                <p
                  className={cn(
                    "inline-flex items-center gap-1.5 text-xs",
                    tool.checksOk === tool.checksTotal ? "text-primary" : "text-clay",
                  )}
                >
                  <ShieldCheck aria-hidden="true" className="size-3.5" />
                  {n(tool.checksOk)} of {n(tool.checksTotal)} match another tool
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      <div className="mt-auto flex items-center gap-2 pt-1">
        {on ? (
          <Button variant="ghost" size="sm" onClick={onDisconnect}>
            Disconnect
          </Button>
        ) : (
          <Button size="sm" onClick={onConnect}>
            <Plug aria-hidden="true" className="mr-1.5 size-3.5" />
            Connect
          </Button>
        )}
        {on && tool.account ? (
          <span className="truncate text-xs text-muted-foreground">{tool.account}</span>
        ) : null}
      </div>
    </article>
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
                      <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="flex items-start gap-2 rounded-lg bg-muted p-3 text-muted-foreground">
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
