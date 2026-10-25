"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { timelineCalculationHref } from "../../../lib/trace-links";
import { cn } from "../../../lib/utils";
import { formatExactCents } from "../baseline/format";
import { familyEntries } from "./ScenarioSidebar";
import type { CatalogEntry, Read, WorkspaceRun } from "./api";
import { scenarioDepth } from "./scenarioComparisons";
import { receiptOutcome } from "./summary";

const KIND = { baseline: "Imported books", rules: "Rules changed", scenario: "What-if" };

/**
 * Left rail for switching between saved scenarios of the same books. Each row is a link, so
 * switching is a normal navigation; comparing curves stays in the Saved scenarios panel.
 */
export function ScenarioNav({
  run,
  graph,
  hrefFor,
  catalogHref,
}: {
  run: WorkspaceRun;
  graph: Read<CatalogEntry[]>;
  hrefFor: (id: string) => string;
  catalogHref: string;
}) {
  const reduced = useReducedMotion();
  const entries = familyEntries(run, graph);
  const outcome = receiptOutcome(run);
  return (
    <nav
      aria-label="Switch scenario"
      className="hidden min-w-0 xl:sticky xl:top-20 xl:flex xl:h-[calc(100dvh-6rem)] xl:flex-col"
      data-testid="scenario-nav"
    >
      <p className="mb-2 shrink-0 px-2.5 text-xs font-medium text-muted-foreground">Scenarios</p>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain pr-1">
        {entries.map((entry) => {
          const current = entry.runId === run.runId;
          const name = entry.label || KIND[entry.kind];
          const depth = Math.min(scenarioDepth(entry, entries), 4);
          return (
            <li key={entry.runId} className="relative">
              {current ? (
                <motion.span
                  layoutId={reduced ? undefined : "scenario-nav-current"}
                  className="absolute inset-0 rounded-md bg-secondary"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              ) : null}
              <Link
                href={hrefFor(entry.runId)}
                aria-current={current ? "page" : undefined}
                title={name}
                className={cn(
                  "relative flex min-h-9 flex-col justify-center rounded-md px-2.5 py-1.5 text-sm transition-colors duration-150 hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  current ? "font-medium text-foreground" : "text-muted-foreground",
                )}
                style={{ paddingLeft: `${10 + depth * 10}px` }}
              >
                <span className="truncate">{name}</span>
                <span className="truncate text-xs font-normal text-muted-foreground">
                  {current && outcome ? `${outcome.text} · ` : ""}low{" "}
                  {formatExactCents(entry.lowPointCents)}
                </span>
              </Link>
              <Link
                href={timelineCalculationHref(run.companyId, entry.runId)}
                aria-label={`See how for ${name}`}
                className="relative ml-2.5 block w-fit rounded px-1 py-0.5 text-xs text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                style={{ marginLeft: `${10 + depth * 10}px` }}
              >
                See how
              </Link>
            </li>
          );
        })}
      </ul>
      <Link
        href={catalogHref}
        className="mt-2 shrink-0 px-2.5 text-xs text-primary underline-offset-4 hover:underline"
      >
        All saved scenarios
      </Link>
    </nav>
  );
}
