"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { formatExactCents, formatFullDate, formatSavedAt } from "../baseline/format";
import { ReadNotice } from "./CatalogPanel";
import { type CatalogEntry, GRAPH_LIMIT, type Read, type WorkspaceRun } from "./api";
import { MAX_COMPARISONS, type ScenarioComparisons, scenarioDepth } from "./scenarioComparisons";
import { type Outcome, entryOutcome, receiptOutcome } from "./summary";

const KIND = { baseline: "Imported books", rules: "Rules changed", scenario: "What-if" };

export function OutcomeBadge({ outcome }: { outcome: Outcome | null }) {
  if (!outcome) return null;
  return (
    <Badge
      variant={
        outcome.tone === "below"
          ? "destructive"
          : outcome.tone === "above"
            ? "success"
            : "secondary"
      }
      data-outcome={outcome.tone}
    >
      {outcome.text}
    </Badge>
  );
}

/** Saved scenarios built from the open run's books, always including the open run. */
export function familyEntries(run: WorkspaceRun, graph: Read<CatalogEntry[]>): CatalogEntry[] {
  const entries =
    graph.state === "ready"
      ? graph.value.filter(
          (entry) => entry.companyId === run.companyId && entry.baselineRunId === run.baselineRunId,
        )
      : [];
  // A capped family read may omit the current node; its saved record is already available.
  if (!entries.some((entry) => entry.runId === run.runId))
    entries.push({
      runId: run.runId,
      companyId: run.companyId,
      baselineRunId: run.baselineRunId,
      parentRunId: run.parentRunId,
      kind: run.kind,
      label: run.label,
      savedAt: run.savedAt,
      lowPointCents: run.forecast.lowPoint.usable,
      lowPointWeek: run.forecast.lowPoint.weekStart,
      constraintVersion: run.constraintVersion,
    });
  return entries;
}

/** One baseline family. Open navigates; Compare only reads a saved curve. */
export function ScenarioSidebar({
  run,
  graph,
  comparisons,
  hrefFor,
  catalogHref,
}: {
  run: WorkspaceRun;
  graph: Read<CatalogEntry[]>;
  comparisons: ScenarioComparisons;
  hrefFor: (id: string) => string;
  catalogHref: string;
}) {
  const [search, setSearch] = useState("");
  const searchId = useId();
  const entries = familyEntries(run, graph);
  const byId = new Map(entries.map((e) => [e.runId, e]));
  const filtered = entries.filter((entry) =>
    `${entry.label} ${KIND[entry.kind]}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const full = comparisons.ids.length >= MAX_COMPARISONS;
  return (
    <section
      className="min-w-0 space-y-3"
      aria-label="Saved scenarios"
      data-testid="scenario-sidebar"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Saved scenarios</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Everything built from these books. Tick up to {MAX_COMPARISONS} to draw them on the
            chart as dashed lines.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <output className="text-muted-foreground" data-testid="comparison-count">
            {comparisons.ids.length} of {MAX_COMPARISONS} on chart
          </output>
          {comparisons.ids.length ? (
            <Button size="sm" variant="ghost" onClick={() => comparisons.onChange([])}>
              Clear
            </Button>
          ) : null}
          <Link
            href={catalogHref}
            className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline sm:min-h-0"
          >
            All saved scenarios
          </Link>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
        {entries.length > 6 ? (
          <div className="border-b p-3">
            <label htmlFor={searchId} className="sr-only">
              Find a scenario
            </label>
            <input
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm sm:h-9"
              id={searchId}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find a saved scenario"
            />
          </div>
        ) : null}
        <ul className="max-h-[30rem] divide-y overflow-y-auto">
          {filtered.map((entry) => {
            const current = entry.runId === run.runId;
            const selected = comparisons.ids.includes(entry.runId);
            const read = comparisons.reads[entry.runId];
            const outcome = current
              ? receiptOutcome(run)
              : read?.state === "ready"
                ? receiptOutcome(read.value)
                : entryOutcome(entry, run);
            const parent = entry.parentRunId ? byId.get(entry.parentRunId) : undefined;
            const name = entry.label || "Untitled scenario";
            const depth = Math.min(scenarioDepth(entry, entries), 4);
            return (
              <li
                key={entry.runId}
                className={`flex min-w-0 items-start gap-3 px-4 py-3 text-sm [overflow-wrap:anywhere] ${current ? "bg-primary/[0.06]" : ""}`}
                style={{ paddingLeft: `${16 + depth * 12}px` }}
                data-testid={`scenario-row-${entry.runId}`}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {current ? (
                      <span className="font-medium" title={name} aria-current="page">
                        {name}
                      </span>
                    ) : (
                      <Link
                        className="font-medium text-primary underline-offset-4 hover:underline"
                        title={name}
                        href={hrefFor(entry.runId)}
                        aria-label={`Open ${name}`}
                      >
                        {name}
                      </Link>
                    )}
                    {current ? <Badge variant="outline">Open now</Badge> : null}
                    <OutcomeBadge outcome={outcome} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {KIND[entry.kind]}
                    {outcome?.detail ? ` · ${outcome.detail}` : ""} · lowest{" "}
                    {formatExactCents(entry.lowPointCents)}, week of{" "}
                    {formatFullDate(entry.lowPointWeek)}
                  </p>
                  {entry.parentRunId ? (
                    <p className="text-xs text-muted-foreground">
                      Built on{" "}
                      {parent ? (
                        parent.runId === run.runId ? (
                          "the open scenario"
                        ) : (
                          <Link
                            href={hrefFor(parent.runId)}
                            className="underline-offset-4 hover:text-foreground hover:underline"
                          >
                            {parent.label || "Untitled scenario"}
                          </Link>
                        )
                      ) : (
                        "an earlier step not listed here"
                      )}
                    </p>
                  ) : null}
                  {entries.filter((row) => row.label === entry.label).length > 1 ? (
                    <time
                      dateTime={entry.savedAt}
                      title={entry.savedAt}
                      className="block text-xs text-muted-foreground"
                    >
                      Saved{" "}
                      {formatSavedAt(entry.savedAt).replace(
                        " UTC",
                        `:${new Date(entry.savedAt).toISOString().slice(17, 19)} UTC`,
                      )}
                    </time>
                  ) : null}
                  {entry.constraintVersion !== run.constraintVersion ? (
                    <p className="text-xs text-muted-foreground">Checked against different rules</p>
                  ) : null}
                  {selected && read && read.state !== "ready" ? (
                    <output className="block text-xs text-muted-foreground">
                      {read.state === "loading"
                        ? "Reading saved curve…"
                        : "Saved curve unavailable; it is not drawn."}
                    </output>
                  ) : null}
                </div>
                {!current ? (
                  <label
                    className={`flex min-h-11 shrink-0 items-center gap-2 text-xs sm:min-h-8 ${!selected && full ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer"}`}
                    title={!selected && full ? `Up to ${MAX_COMPARISONS} at a time` : undefined}
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      aria-label={`Compare ${name}`}
                      checked={selected}
                      disabled={!selected && full}
                      onChange={() =>
                        comparisons.onChange(
                          selected
                            ? comparisons.ids.filter((id) => id !== entry.runId)
                            : [...comparisons.ids, entry.runId],
                        )
                      }
                    />
                    <span>Compare</span>
                  </label>
                ) : null}
              </li>
            );
          })}
        </ul>
        {!filtered.length ? (
          <p className="p-4 text-xs text-muted-foreground">No saved names match.</p>
        ) : null}
        {graph.state !== "ready" ? (
          <div className="p-4">
            <ReadNotice read={graph} what="scenario family" />
          </div>
        ) : null}
        {graph.state === "ready" && graph.value.length >= GRAPH_LIMIT ? (
          <p className="border-t p-4 text-xs text-muted-foreground">
            Showing the first 100 saved scenarios from these books. Some may not be listed.
          </p>
        ) : null}
      </div>
    </section>
  );
}
