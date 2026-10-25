"use client";

import {
  Check,
  CircleDashed,
  Lock,
  Plug,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
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
import { PageHeader, Section, StatTile } from "../ui/page";
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
    <div className="mx-auto max-w-[1200px] space-y-6">
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            {data.name ?? "Your company"}
            <SourceLabel />
          </span>
        }
        title="Connect your tools"
        description="Domino reads the tools your company already uses: the bank, billing, books, payroll, cards and sales. It turns them into one set of books and checks that the tools agree with each other. Domino only reads. It never moves money."
        actions={<FieldTabs />}
      />

      <section aria-label="Summary" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile
          label="Tools connected"
          value={data.tools ? `${on.length}` : "..."}
          unit={data.tools ? `of ${TOOLS.length}` : undefined}
          delta={on.length === TOOLS.length ? "Every tool is connected" : "Read-only access"}
        />
        <StatTile
          label="Last read"
          value={timeAgo(lastRead, now)}
          delta="Across all connected tools"
        />
        <StatTile
          className="col-span-2 sm:col-span-1"
          label="Numbers that agree across tools"
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
      </section>

      <Section
        title="Integrations"
        description="Each tool is read on its own, then matched against the others."
        card={false}
        actions={
          <>
            <output
              className={cn(
                "text-[13px]",
                message?.error ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {message?.text ?? ""}
            </output>
            <Button
              variant="outline"
              size="sm"
              disabled={on.length === 0 || data.source === "loading"}
              onClick={() => run(data.syncNow, "Reading every connected tool again.")}
            >
              <RefreshCw aria-hidden="true" />
              Read all tools now
            </Button>
          </>
        }
      >
        {data.tools === null ? (
          <div className="rounded-lg border border-dashed bg-card p-6 text-sm text-muted-foreground">
            There is no company yet. Start the live feed on Review and actions, then come back to
            connect its tools.
          </div>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {TOOLS.map((info) => {
              const tool = tools.find((t) => t.tool === info.id);
              return (
                <li key={info.id} className="min-w-0">
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
                    <Skeleton className="h-60 w-full rounded-lg" />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

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
      <Badge variant="success" className="gap-1.5">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-safe" />
        Live
      </Badge>
    );
  if (source === "loading")
    return (
      <Badge variant="secondary" className="font-normal">
        Connecting...
      </Badge>
    );
  return (
    <Badge
      variant="outline"
      title={note}
      className="gap-1.5 border-dashed font-normal text-muted-foreground"
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-clay" />
      Demo data · recorded mock sync
    </Badge>
  );
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

/** The tool's mark. Monogram for now; swap this one body for ToolLogo when icons land. */
function ToolMark({ info }: { info: ToolInfo }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background text-[13px] font-semibold tracking-tight text-foreground shadow-xs"
    >
      {info.initials}
    </span>
  );
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
      className="flex h-full flex-col overflow-hidden rounded-lg border bg-card shadow-xs transition-colors hover:border-foreground/20"
    >
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start gap-3">
          <ToolMark info={info} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold leading-5">{info.name}</h3>
            <p className="text-[13px] text-muted-foreground">{info.kind}</p>
          </div>
          <StatusBadge tool={tool} />
        </div>
        <p className="text-sm leading-5 text-muted-foreground">{info.provides}</p>

        {on ? (
          <div className="space-y-3 text-[13px]">
            {tool.lastError ? (
              <p className="rounded-md border border-destructive/25 bg-destructive/[0.04] px-3 py-2 text-destructive">
                Last read failed: {tool.lastError}
              </p>
            ) : tool.lastSyncAt === null ? (
              <p className="inline-flex items-center gap-2 text-muted-foreground">
                <RefreshCw aria-hidden="true" className="size-3.5 animate-spin" />
                Reading for the first time...
              </p>
            ) : (
              <>
                {counts.length > 0 ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {counts.map(([list, count]) => (
                      <li
                        key={list}
                        className="rounded-md border bg-muted/50 px-2 py-0.5 text-xs tabular-nums"
                      >
                        {plural(count, LIST_LABEL[list] ?? [list, list])}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <dl className="grid grid-cols-3 gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Received</dt>
                    <dd className="font-medium tabular-nums">{n(tool.recordsIn)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Kept</dt>
                    <dd className="font-medium tabular-nums">{n(tool.recordsOut)}</dd>
                  </div>
                  <div title="Each one is set aside with a reason">
                    <dt className="text-muted-foreground">Set aside</dt>
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
              </>
            )}
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-5 py-3">
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {on
            ? tool.lastSyncAt
              ? `Read ${timeAgo(tool.lastSyncAt, now)}${tool.account ? ` · ${tool.account}` : ""}`
              : (tool.account ?? "Connected")
            : "Read-only access"}
        </span>
        {on ? (
          <Button variant="outline" size="sm" onClick={onDisconnect}>
            Disconnect
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={onConnect}>
            <Plug aria-hidden="true" />
            Connect
          </Button>
        )}
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
