"use client";

import type { ActivityEvent } from "@domino/contracts";
import { Check, Circle, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import {
  type ActivityScope,
  type ActivityState,
  DEFAULT_CAP,
  MAX_CONFLICTS,
  activityRows,
  emptyActivity,
  ingestActivity,
} from "../lib/activity";
import { cn } from "../lib/utils";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

const kindLabel: Record<ActivityEvent["kind"], string> = {
  source_validated: "Source checked",
  run_saved: "Forecast saved",
  disclosure_revealed: "Disclosure revealed",
  alternative_computed: "Alternative computed",
  agent_task: "Agent task",
  tool_registered: "Tool registered",
  tool_invoked: "Tool used",
};

// Shape and words carry the status, so colour is never the only signal. A start is only "Started":
// the feed cannot tell whether work is still going, so nothing here claims progress or elapsed time.
const statusView = {
  started: { text: "Started", Icon: Circle, variant: "outline" },
  succeeded: { text: "Done", Icon: Check, variant: "secondary" },
  failed: { text: "Failed", Icon: X, variant: "destructive" },
} as const;

/** UTC and fixed format so server and browser print the same text. Runtime time, not a report date. */
export const formatRuntime = (iso: string) =>
  `${new Date(iso).toISOString().slice(0, 19).replace("T", " ")} UTC`;

export type ActivitySource = "live" | "simulation" | "unavailable";

const sourceView: Record<
  ActivitySource,
  { text: string; variant: "default" | "secondary" | "outline" }
> = {
  live: { text: "Live", variant: "default" },
  simulation: { text: "Simulation preview", variant: "secondary" },
  unavailable: { text: "Not connected", variant: "outline" },
};

interface FeedProps {
  /** Parsed with ActivityEventSchema and already authorized. May be redelivered in any order. */
  events: readonly ActivityEvent[];
  scope: ActivityScope;
  /** Retained event cap. */
  cap?: number;
  /** Opens an evidence record in the host's own viewer. Without it ids are shown as plain text. */
  onOpenEvidence?: (id: string) => void;
}

export type ActivityPanelProps = { className?: string } & (
  | ({ source: "live" | "simulation" } & FeedProps)
  /** `note` says why, in plain words, when the host knows (loading, failed). */
  | { source: "unavailable"; note?: string }
);

export function ActivityPanel(props: ActivityPanelProps) {
  return (
    <Card className={cn("shadow-none", props.className)}>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-sm font-medium">Activity</CardTitle>
        <Badge variant={sourceView[props.source].variant}>{sourceView[props.source].text}</Badge>
      </CardHeader>
      <CardContent>
        {props.source === "unavailable" ? (
          <p className="text-sm text-muted-foreground">
            {props.note ??
              "No activity feed is connected yet, so the status is unknown. This panel cannot say whether anything is running or has been recorded."}
          </p>
        ) : (
          // A different case or run is a different feed, so its state starts clean.
          <Feed key={`${props.scope.caseId}/${props.scope.runId ?? ""}`} {...props} />
        )}
      </CardContent>
    </Card>
  );
}

function Feed({ events, scope, cap = DEFAULT_CAP, onOpenEvidence }: FeedProps) {
  const reduced = useReducedMotion();
  // First load is quiet; later deliveries animate only the ids that are new. Style changes touch
  // neither the props nor this state, so they cannot replay an entrance or reset the selection.
  const [state, setState] = useState<ActivityState>(() =>
    ingestActivity(emptyActivity, events, scope, { quiet: true, cap }),
  );
  const [seen, setSeen] = useState(events);
  if (seen !== events) {
    setSeen(events);
    setState(ingestActivity(state, events, scope, { cap }));
  }
  const [selectedKey, setSelectedKey] = useState<string>();

  const rows = activityRows(state);
  const selected = rows.find((row) => row.key === selectedKey);
  const latestNews = state.events.filter((e) => state.fresh.has(e.id) && e.status !== "started");
  const news = latestNews[latestNews.length - 1];

  if (!rows.length)
    return (
      <p className="text-sm text-muted-foreground">
        No activity yet. Events appear here as they happen.
      </p>
    );

  return (
    <div className="space-y-3">
      {/* One sparse announcement per finished or failed event, never for the first load. */}
      <output className="sr-only">
        {news ? `${kindLabel[news.kind]}, ${statusView[news.status].text}: ${news.label}` : ""}
      </output>
      <ul
        aria-label="Activity events"
        className="max-h-72 space-y-1 overflow-y-auto overflow-x-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {rows.map((row) => {
          const { latest } = row;
          const view = statusView[latest.status];
          const isNew = !reduced && row.history.some((e) => state.fresh.has(e.id));
          const justChanged = !reduced && state.fresh.has(latest.id);
          return (
            <motion.li
              key={row.key}
              initial={isNew ? { opacity: 0, y: 6 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <button
                type="button"
                aria-pressed={row.key === selectedKey}
                onClick={() => setSelectedKey(row.key === selectedKey ? undefined : row.key)}
                className={cn(
                  // Badge beside one text column, at any width: the label keeps the room, and the
                  // full timestamp wraps under it instead of squeezing it.
                  "grid w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 rounded-md border px-3 py-2 text-left text-sm",
                  "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  row.key === selectedKey && "bg-muted",
                )}
              >
                <motion.span
                  // A new key replays this small settle only when this exact event is new.
                  key={latest.id}
                  initial={justChanged ? { opacity: 0.3, scale: 0.9 } : false}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.2 }}
                >
                  <Badge variant={view.variant} className="gap-1">
                    <view.Icon aria-hidden className="size-3" />
                    {view.text}
                  </Badge>
                </motion.span>
                <span className="min-w-0">
                  <span className="block text-xs text-muted-foreground">
                    {kindLabel[latest.kind]}
                  </span>
                  <span className="block break-words">{latest.label}</span>
                  <time
                    dateTime={latest.occurredAt}
                    className="block text-xs tabular-nums text-muted-foreground"
                  >
                    {formatRuntime(latest.occurredAt)}
                  </time>
                  {row.retry ? (
                    <span className="block text-xs text-muted-foreground">
                      Retry started{" "}
                      <time dateTime={row.retry.occurredAt} className="tabular-nums">
                        {formatRuntime(row.retry.occurredAt)}
                      </time>
                    </span>
                  ) : null}
                </span>
              </button>
            </motion.li>
          );
        })}
      </ul>
      {state.conflicts ? (
        <p className="text-xs text-destructive">
          {state.conflicts >= MAX_CONFLICTS ? `${MAX_CONFLICTS}+` : state.conflicts} conflicting
          version{state.conflicts === 1 ? "" : "s"} of an event id{" "}
          {state.conflicts === 1 ? "was" : "were"} ignored. The first copy is kept.
        </p>
      ) : null}
      {selected ? (
        <section aria-label="Event details" className="space-y-2 rounded-md border p-3 text-sm">
          <h3 className="font-medium">{selected.latest.label}</h3>
          <ol className="space-y-1">
            {selected.history.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                <span className="text-foreground">{statusView[e.status].text}</span>
                <time dateTime={e.occurredAt} className="tabular-nums">
                  {formatRuntime(e.occurredAt)}
                </time>
                <span>#{e.sequence}</span>
              </li>
            ))}
          </ol>
          <Refs title="Evidence" ids={selected.latest.evidenceIds} onOpen={onOpenEvidence} />
          <Refs title="Output" ids={selected.latest.outputId ? [selected.latest.outputId] : []} />
        </section>
      ) : null}
    </div>
  );
}

function Refs({
  title,
  ids,
  onOpen,
}: { title: string; ids: readonly string[]; onOpen?: (id: string) => void }) {
  if (!ids.length) return null;
  return (
    <p className="text-xs">
      <span className="text-muted-foreground">{title}: </span>
      {ids.map((id) =>
        onOpen ? (
          <button
            key={id}
            type="button"
            onClick={() => onOpen(id)}
            className="mr-2 underline underline-offset-2"
          >
            {id}
          </button>
        ) : (
          <code key={id} className="mr-2">
            {id}
          </code>
        ),
      )}
    </p>
  );
}
