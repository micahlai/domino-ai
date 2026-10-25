"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Button } from "../../ui/button";
import { formatExactCents, formatFullDate, formatSavedAt } from "../baseline/format";
import { ReadNotice } from "./CatalogPanel";
import { type CatalogEntry, GRAPH_LIMIT, type Read, type WorkspaceRun } from "./api";
import { MAX_COMPARISONS, type ScenarioComparisons, scenarioDepth } from "./scenarioComparisons";

const KIND = { baseline: "Baseline", rules: "Rules changed", scenario: "Scenario" };

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
  const filtered = entries.filter((entry) =>
    `${entry.label} ${KIND[entry.kind]}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <section
      className="min-w-0 space-y-4"
      aria-label="Saved scenarios"
      data-testid="scenario-sidebar"
    >
      <div className="space-y-1">
        <h3 className="font-medium">Saved scenarios</h3>
        <p className="text-xs text-muted-foreground">
          From this imported baseline. Open one, or compare up to {MAX_COMPARISONS} saved curves.
        </p>
      </div>
      <div className="space-y-2">
        <label htmlFor={searchId} className="text-xs text-muted-foreground">
          Find a scenario
        </label>
        <input
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          id={searchId}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search saved names"
        />
        {search ? (
          <Button size="sm" variant="ghost" onClick={() => setSearch("")}>
            Clear search
          </Button>
        ) : null}
      </div>
      <ul className="max-h-[32rem] space-y-2 overflow-y-auto pr-1">
        {filtered.map((entry) => {
          const current = entry.runId === run.runId;
          const selected = comparisons.ids.includes(entry.runId);
          const read = comparisons.reads[entry.runId];
          return (
            <li
              key={entry.runId}
              className={`min-w-0 space-y-2 rounded-md p-3 text-sm [overflow-wrap:anywhere] ${current ? "bg-primary/10 ring-1 ring-primary/30" : "bg-muted/30"}`}
              style={{ marginLeft: `${scenarioDepth(entry, entries) * 8}px` }}
            >
              <div className="text-xs text-muted-foreground">
                {KIND[entry.kind]}
                {entry.parentRunId && !entries.some((row) => row.runId === entry.parentRunId)
                  ? " · Earlier step not listed"
                  : ""}
              </div>
              {current ? (
                <p
                  className="line-clamp-2 font-medium text-primary"
                  title={entry.label || "Untitled scenario"}
                  aria-current="page"
                >
                  {entry.label || "Untitled scenario"} · Open now
                </p>
              ) : (
                <Link
                  className="line-clamp-2 font-medium underline-offset-4 hover:underline"
                  title={entry.label || "Untitled scenario"}
                  href={hrefFor(entry.runId)}
                  aria-label={`Open ${entry.label || "untitled scenario"}`}
                >
                  {entry.label || "Untitled scenario"}
                </Link>
              )}
              <p className="text-xs text-muted-foreground">
                Low {formatExactCents(entry.lowPointCents)} · {formatFullDate(entry.lowPointWeek)}
              </p>
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
                <p className="text-xs text-muted-foreground">Different saved rules</p>
              ) : null}
              {!current ? (
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    aria-label={`Compare ${entry.label || "untitled scenario"}`}
                    checked={selected}
                    disabled={!selected && comparisons.ids.length >= MAX_COMPARISONS}
                    onChange={() =>
                      comparisons.onChange(
                        selected
                          ? comparisons.ids.filter((id) => id !== entry.runId)
                          : [...comparisons.ids, entry.runId],
                      )
                    }
                  />
                  <span>Compare on timeline</span>
                </label>
              ) : null}
              {selected && read && read.state !== "ready" ? (
                <output className="block text-xs text-muted-foreground">
                  {read.state === "loading"
                    ? "Reading saved curve…"
                    : "Saved curve unavailable; it is not drawn."}
                </output>
              ) : null}
            </li>
          );
        })}
      </ul>
      {!filtered.length ? (
        <p className="text-xs text-muted-foreground">No saved names match.</p>
      ) : null}
      {graph.state !== "ready" ? <ReadNotice read={graph} what="scenario family" /> : null}
      {graph.state === "ready" && graph.value.length >= GRAPH_LIMIT ? (
        <p className="text-xs text-muted-foreground">
          Showing the first 100 saved scenarios from this baseline. Some may not be listed.
        </p>
      ) : null}
      {comparisons.ids.length ? (
        <Button size="sm" variant="ghost" onClick={() => comparisons.onChange([])}>
          Clear comparisons
        </Button>
      ) : null}
      <Link
        href={catalogHref}
        className="block text-xs text-primary underline-offset-4 hover:underline"
      >
        Browse all company scenarios
      </Link>
    </section>
  );
}
