"use client";

import { useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cn } from "../../lib/utils";
import type { DashboardView } from "../field/dashboard/derive";
import { formatCents } from "../field/dashboard/money";
import { type BrainNode, buildBrainGraph, hasWork, isAgent, isWorking } from "../field/graph";
import { type LiveLogRow, liveAgentName, toOperations } from "../field/live";
import { AGENT_KIND_LABEL } from "../icons/AgentIcon";
import { Section, StatTile } from "../ui/page";
import { agentLabel, provenanceOf } from "./provenance";
import { ProofLabel, ago, clockTime, shortDay, useSecondsSince } from "./shared";

// Live panel: the 13-week verdict, recent agent activity and a compact brain map list for the
// judge company. Everything is a Convex useQuery subscription, so it changes without a refresh
// as the ingest, audit and analyst agents write.

type Row = LiveLogRow & { agentKind?: string; currentTask?: string };

function verdict(v: DashboardView) {
  const limit = v.lenderMinimum
    ? `the lender's ${formatCents(v.lenderMinimum.cents)} limit`
    : "zero";
  if (v.firstBreach)
    return {
      word: "At risk",
      tone: "negative" as const,
      text: `Cash falls below ${limit} the week of ${shortDay(v.firstBreach)}`,
    };
  if (v.health.rating === "watch")
    return {
      word: "Watch",
      tone: "warning" as const,
      text: `Stays above ${limit}, with ${formatCents(v.roomAtLow ?? 0)} to spare at the low point`,
    };
  return { word: "On track", tone: "positive" as const, text: `Stays above ${limit} all 13 weeks` };
}

/** Remembers the low point of the previous snapshot version, to show what the last change did. */
function usePrevious(version: number | undefined, value: number | undefined) {
  const seen = useRef(new Map<number, number>());
  if (version !== undefined && value !== undefined && !seen.current.has(version))
    seen.current.set(version, value);
  if (version === undefined) return undefined;
  const earlier = [...seen.current.keys()].filter((k) => k < version).sort((a, b) => b - a)[0];
  return earlier === undefined ? undefined : seen.current.get(earlier);
}

export function LivePanel({
  companyId,
  rows,
  version,
}: {
  companyId: Id<"companies">;
  rows: Row[];
  version: number;
}) {
  const summary = useQuery(api.fieldDashboard.summary, { companyId });
  const v = summary?.result?.ok ? summary.result.view : null;
  const before = usePrevious(v ? version : undefined, v?.lowest?.usable);
  const newest = rows[0];
  const since = useSecondsSince(newest?.at);
  const [flash, setFlash] = useState(false);
  const newestId = newest?._id;
  useEffect(() => {
    if (!newestId) return;
    setFlash(true);
    const id = setTimeout(() => setFlash(false), 1500);
    return () => clearTimeout(id);
  }, [newestId]);
  const say = v ? verdict(v) : null;
  const change = v?.lowest && before !== undefined ? v.lowest.usable - before : null;

  return (
    <Section
      title="Live: what the agents see"
      description="Re-forecast after every ingest. No refresh needed."
      actions={
        <span
          className="inline-flex items-center gap-2 text-[13px] text-muted-foreground"
          aria-live="polite"
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-2 rounded-full bg-muted-foreground/50 transition-colors duration-300",
              flash && "bg-primary-ink motion-safe:animate-pulse",
            )}
          />
          Updated live via Convex · {ago(since)}
        </span>
      }
      card={false}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="13-week verdict"
          value={say?.word ?? "Reading"}
          delta={say?.text ?? "Waiting for the first forecast"}
          tone={say?.tone ?? "neutral"}
        />
        <StatTile
          label="Lowest cash"
          value={v?.lowest ? formatCents(v.lowest.usable) : "..."}
          unit={v?.lowest ? `week of ${shortDay(v.lowest.weekStart)}` : undefined}
          delta={
            change === null
              ? `Forecast version ${version}`
              : change === 0
                ? `Unchanged by version ${version}`
                : `${change > 0 ? "+" : ""}${formatCents(change)} vs the version before`
          }
          tone={change !== null && change < 0 ? "negative" : "neutral"}
        />
        <StatTile
          label="Open flags"
          value={String(summary?.openFindings ?? 0)}
          delta={`${summary?.openEscalations ?? 0} need a person`}
          tone={(summary?.openEscalations ?? 0) > 0 ? "warning" : "neutral"}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <ProofLabel kind="real">Forecast: real engine</ProofLabel>
        <ProofLabel kind="simulated">Company books: simulated</ProofLabel>
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ActivityFeed rows={rows} />
        <AgentList rows={rows} />
      </div>
    </Section>
  );
}

function ActivityFeed({ rows }: { rows: Row[] }) {
  const recent = rows.slice(0, 14);
  return (
    <section aria-labelledby="judge-activity" className="min-w-0 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 id="judge-activity" className="text-sm font-semibold">
          Agent activity
        </h3>
        <ProofLabel kind="real">Real agents and audit</ProofLabel>
      </div>
      <ol className="divide-y rounded-lg border bg-card shadow-xs">
        {recent.length === 0 ? (
          <li className="p-4 text-sm text-muted-foreground">No activity yet.</li>
        ) : null}
        {recent.map((r) => {
          const p = provenanceOf(r);
          return (
            <li key={r._id} className="grid grid-cols-[3.75rem_minmax(0,1fr)] gap-x-3 px-3 py-2.5">
              <time dateTime={r.at} className="pt-0.5 text-xs tabular-nums text-muted-foreground">
                {clockTime(r.at)}
              </time>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                  <span className="font-medium">{agentLabel(liveAgentName(r.agent, r.actor))}</span>
                  <span
                    className={cn(
                      "text-xs",
                      p.simulated
                        ? "text-warning"
                        : p.ai
                          ? "text-primary-ink"
                          : "text-muted-foreground",
                    )}
                  >
                    {p.who}
                  </span>
                </div>
                <p className="mt-0.5 break-words text-sm leading-5 text-muted-foreground">
                  {r.summary ?? r.action}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const nodeState = (n: BrainNode) =>
  isWorking(n) ? "Working" : n.lifecycle === "failed" || n.status === "failed" ? "Failed" : "Done";

function AgentList({ rows }: { rows: Row[] }) {
  const graph = useMemo(() => buildBrainGraph(toOperations(rows)), [rows]);
  const agents = graph.nodes.filter((n) => isAgent(n) && hasWork(n));
  const sources = graph.nodes.filter((n) => n.kind === "source" && hasWork(n));
  return (
    <section aria-labelledby="judge-agents" className="min-w-0 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 id="judge-agents" className="text-sm font-semibold">
          Brain map
        </h3>
        <span className="text-xs text-muted-foreground">
          {agents.filter(isWorking).length} working · {agents.length} agents
        </span>
      </div>
      <ul className="divide-y rounded-lg border bg-card shadow-xs">
        {agents.slice(0, 12).map((n) => {
          const state = nodeState(n);
          return (
            <li key={n.id} className="flex items-start gap-2.5 px-3 py-2">
              <span
                aria-hidden="true"
                className={cn(
                  "mt-1.5 size-1.5 shrink-0 rounded-full",
                  state === "Working"
                    ? "bg-foreground motion-safe:animate-pulse"
                    : state === "Failed"
                      ? "bg-destructive"
                      : "bg-safe",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="truncate text-[13px] font-medium">{n.title}</span>
                  <span className="text-xs text-muted-foreground">{state}</span>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {n.agentKind ? AGENT_KIND_LABEL[n.agentKind] : "Domino agent"}
                  {n.currentTask ? ` · ${n.currentTask}` : ""}
                </p>
              </div>
            </li>
          );
        })}
        {agents.length === 0 ? (
          <li className="px-3 py-2 text-sm text-muted-foreground">No agents have run yet.</li>
        ) : null}
        <li className="px-3 py-2 text-xs text-muted-foreground">
          Read from {sources.length} mock tool{sources.length === 1 ? "" : "s"}:{" "}
          {sources.map((s) => s.title).join(", ") || "none yet"}
        </li>
      </ul>
    </section>
  );
}
