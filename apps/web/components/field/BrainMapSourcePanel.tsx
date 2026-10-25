import { X } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { formatCents, formatDate } from "../../lib/format";
import { cn } from "../../lib/utils";
import { ToolLogo } from "../icons/ToolLogo";
import { VENDORS } from "../icons/vendors";
import { Button } from "../ui/button";
import { SheetTitle } from "../ui/sheet";
import type { SourceDetail, SourceRecord } from "./BrainMapSourceData";
import { clock, timeAgo } from "./parts";

// The brain map's data source panel and hover summary: the vendor's own logo, its brand color as
// a thin stripe and a light tint behind the header (never as text color, so contrast stays the
// theme's), what the connection read and the records it is the record for. Presentation only;
// BrainMapSourceData.ts loads the detail.

type Tone = "idle" | "running" | "ok" | "failed";
const DOT: Record<Tone, string> = {
  idle: "bg-muted-foreground/40",
  running: "bg-foreground motion-safe:animate-pulse",
  ok: "bg-safe",
  failed: "bg-destructive",
};
const TEXT: Record<Tone, string> = {
  idle: "text-muted-foreground",
  running: "text-foreground",
  ok: "text-safe",
  failed: "text-destructive",
};

/** The one status word a source shows, from its connection and what the agent is doing. */
export function connectionState(d: SourceDetail): { tone: Tone; label: string } {
  if (d.task.state === "reading") return { tone: "running", label: "Reading now" };
  if (d.status === "error") return { tone: "failed", label: "Read failed" };
  if (d.status === "connected")
    return d.lastReadAt
      ? { tone: "ok", label: "Connected" }
      : { tone: "idle", label: "Connected, not read yet" };
  if (d.status === "disconnected") return { tone: "idle", label: "Not connected" };
  return { tone: "idle", label: "Never connected" };
}

function StatePill({ detail }: { detail: SourceDetail }) {
  const { tone, label } = connectionState(detail);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 text-xs font-medium",
        TEXT[tone],
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", DOT[tone])} />
      {label}
    </span>
  );
}

const count = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;
/** "Read 2111 records" -> "Read 2,111 records" (log summaries print raw counts). */
export const grouped = (text: string) =>
  text.replace(/\b\d{4,}\b/g, (n) => Number(n).toLocaleString("en-US"));
/** Brand color as a translucent tint: #635BFF -> #635BFF14 (8%). */
const tint = (hex: string) => (/^#[0-9a-f]{6}$/i.test(hex) ? `${hex}14` : "transparent");

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t px-4 py-3">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <div className="mt-2 text-sm leading-6">{children}</div>
    </section>
  );
}

function When({ iso, now }: { iso: string | null; now: number }) {
  if (!iso) return <>never</>;
  return (
    <time dateTime={iso} title={clock(iso)}>
      {timeAgo(iso, now)}
    </time>
  );
}

export function RecordRow({ record }: { record: SourceRecord }) {
  return (
    <li className="flex items-baseline gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="truncate leading-5">{record.counterparty}</p>
        <p className="text-xs leading-5 text-muted-foreground">
          {record.type}
          {record.date ? ` · ${formatDate(record.date)}` : ""}
        </p>
      </div>
      {record.amount !== null ? (
        <span className="shrink-0 font-medium tabular-nums">{formatCents(record.amount)}</span>
      ) : null}
    </li>
  );
}

export type SourcePanelProps = {
  /** Undefined while loading or when there is nothing to show; `note` then says why. */
  detail: SourceDetail | undefined;
  note?: string;
  /** Brain map vendor id, for the logo and brand color. */
  vendor: string;
  /** Shown until the detail arrives, so the heading (and its focus) never swaps. */
  title: string;
  subtitle?: string;
  now: number;
  demo?: boolean;
  onClose: () => void;
  /** Receives focus when the desktop panel opens (like the agent panels). */
  headingRef?: RefObject<HTMLHeadingElement | null>;
  /** Inside the phone Sheet: the Sheet supplies the title role and the close button. */
  inSheet?: boolean;
  /** The map's own sections (reads in the loaded events, linked agents). */
  children?: ReactNode;
};

export function SourcePanel({
  detail: d,
  note,
  vendor,
  title,
  subtitle,
  now,
  demo,
  onClose,
  headingRef,
  inSheet,
  children,
}: SourcePanelProps) {
  const brand = VENDORS[vendor as keyof typeof VENDORS] ?? VENDORS.generic;
  const titleClass = "break-words text-base font-semibold leading-6 focus:outline-none";
  const name = d?.name ?? title;
  return (
    <section
      aria-label={`${name} details`}
      className="flex h-full min-h-0 flex-col overflow-hidden bg-card text-card-foreground"
      data-source-panel={vendor}
    >
      <div
        className="border-t-[3px]"
        style={{ borderTopColor: brand.color, backgroundColor: tint(brand.color) }}
      >
        <div className={cn("flex items-start gap-3 p-4", inSheet && "pr-12")}>
          <ToolLogo vendor={vendor} size={40} title={`${brand.name} logo`} />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">
              Data source · {d?.kind ?? subtitle ?? brand.category}
              {demo ? " · demo data" : ""}
            </p>
            {inSheet ? (
              <SheetTitle className={titleClass}>{name}</SheetTitle>
            ) : (
              <h2 ref={headingRef} tabIndex={-1} className={titleClass}>
                {name}
              </h2>
            )}
            {d ? (
              <div className="mt-1.5">
                <StatePill detail={d} />
              </div>
            ) : null}
          </div>
          {inSheet ? null : (
            <Button
              variant="ghost"
              aria-label="Close details"
              onClick={onClose}
              className="-mr-2 -mt-2 size-9 p-0"
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {d ? (
          <SourceBody d={d} now={now} />
        ) : (
          <p className="border-t px-4 py-3 text-sm text-muted-foreground">
            {note ?? `Loading what ${name} sent...`}
          </p>
        )}
        {children}
      </div>
    </section>
  );
}

function SourceBody({ d, now }: { d: SourceDetail; now: number }) {
  const reading = d.task.state === "reading";
  return (
    <>
      <Block title={reading ? "Ingestion agent is working on" : "Ingestion agent, last result"}>
        <p className={cn(d.task.state === "failed" && "text-destructive")}>
          {grouped(d.task.text)}
        </p>
        {d.task.at ? (
          <p className="text-xs text-muted-foreground">
            <When iso={d.task.at} now={now} />
          </p>
        ) : null}
        {reading && d.task.progress !== undefined ? (
          <span aria-hidden="true" className="mt-2 block h-1.5 rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-[hsl(var(--primary-ink))] transition-[width] duration-700"
              style={{ width: `${Math.round(d.task.progress * 100)}%` }}
            />
          </span>
        ) : null}
      </Block>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t px-4 py-3">
        <div>
          <dt className="text-xs text-muted-foreground">Last successful read</dt>
          <dd className="text-sm font-medium">
            <When iso={d.lastReadAt} now={now} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Pages read</dt>
          <dd className="text-sm font-medium tabular-nums">
            {d.pages === null ? "unknown" : count(d.pages)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Rows read</dt>
          <dd className="text-sm font-medium tabular-nums">{count(d.recordsIn)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Kept as records</dt>
          <dd className="text-sm font-medium tabular-nums">{count(d.recordsOut)}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-muted-foreground">Position</dt>
          <dd className="text-sm">
            {d.position}
            {d.cursor ? (
              <code className="mt-0.5 block break-all text-[11px] text-muted-foreground">
                {d.cursor}
              </code>
            ) : null}
          </dd>
        </div>
      </dl>
      {d.skipped > 0 ? (
        <p className="px-4 pb-3 text-xs leading-5 text-muted-foreground">
          {plural(d.skipped, "row")} not kept as records of their own: a payment folds into the
          record it paid, and a copy another tool already gave is skipped. Each has a reason.
        </p>
      ) : null}

      <Block title={d.asOf ? `Records it provides, as of ${formatDate(d.asOf)}` : "Records"}>
        {d.lists.length ? (
          <ul className="divide-y">
            {d.lists.map((l) => (
              <li key={l.list} className="flex items-baseline justify-between gap-3 py-1">
                <span>
                  {l.label}
                  {l.stale ? (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      last read before it was disconnected
                    </span>
                  ) : null}
                </span>
                <span className="font-medium tabular-nums">{count(l.count)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">
            No saved books yet, or another tool is the record for everything {d.name} sends.
          </p>
        )}
      </Block>

      <Block title="Latest records read">
        {d.recent.length ? (
          <ul className="divide-y" aria-label={`Latest records read from ${d.name}`}>
            {d.recent.map((r) => (
              <RecordRow key={`${r.list}:${r.id}`} record={r} />
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No dated records yet.</p>
        )}
      </Block>

      {d.endpoints.length ? (
        <Block title={`What it asked ${d.name} for`}>
          <ul className="flex flex-wrap gap-1.5">
            {d.endpoints.map((e) => (
              <li key={e}>
                <code className="rounded-md bg-muted px-1.5 py-0.5 text-[11px]">{e}</code>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      {d.checksTotal > 0 ? (
        <Block title="Checks against other tools">
          <p className={cn(d.checksOk < d.checksTotal && "text-destructive")}>
            {count(d.checksOk)} of {plural(d.checksTotal, "cross-tool check")} agree to the cent
          </p>
        </Block>
      ) : null}
    </>
  );
}

/** Hover summary for a source card: logo, status, last read and how many records. */
export function SourceHover({
  detail: d,
  vendor,
  title,
  now,
}: {
  detail: SourceDetail | undefined;
  vendor: string;
  title: string;
  now: number;
}) {
  const state = d ? connectionState(d) : undefined;
  return (
    <>
      <p className="flex items-center gap-2">
        <ToolLogo vendor={vendor} size={20} />
        <span className="text-sm font-medium">{d?.name ?? title}</span>
      </p>
      {d && state ? (
        <>
          <p
            className={cn("mt-1.5 flex items-center gap-1.5 text-xs font-medium", TEXT[state.tone])}
          >
            <span aria-hidden="true" className={cn("size-1.5 rounded-full", DOT[state.tone])} />
            {state.label}
          </p>
          <p className="mt-1 text-xs">
            <span className="text-muted-foreground">Last read </span>
            <When iso={d.lastReadAt} now={now} />
          </p>
          <p className="mt-1 text-xs tabular-nums">
            {plural(d.recordsIn, "row")} read, {plural(d.recordsOut, "record")} kept
          </p>
        </>
      ) : (
        <p className="mt-1.5 text-xs text-muted-foreground">Loading what it read...</p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">Press for details</p>
    </>
  );
}
