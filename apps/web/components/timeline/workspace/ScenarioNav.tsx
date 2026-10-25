"use client";

import { ChevronRight, GitBranch } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { timelineCalculationHref } from "../../../lib/trace-links";
import { cn } from "../../../lib/utils";
import { formatExactCents, formatFullDate } from "../baseline/format";
import type { CatalogEntry, Read, WorkspaceRun } from "./api";
import {
  MAX_COMPARISONS,
  type ScenarioComparisons,
  colorFor,
  familyEntries,
  showWithAncestors,
  toggleShown,
} from "./scenarioComparisons";

const KIND = { baseline: "Base forecast", rules: "Rules changed", scenario: "What-if" };

type Node = { entry: CatalogEntry; children: Node[] };

/** Parent links as a tree under the base run; a run whose parent is not listed hangs off the base. */
function treeOf(entries: CatalogEntry[], baseRunId: string | null): Node | null {
  const nodes = new Map(entries.map((e) => [e.runId, { entry: e, children: [] as Node[] }]));
  const root = baseRunId ? nodes.get(baseRunId) : undefined;
  if (!root) return null;
  for (const node of nodes.values()) {
    if (node === root) continue;
    const parent = node.entry.parentRunId ? nodes.get(node.entry.parentRunId) : undefined;
    (parent && parent !== node ? parent : root).children.push(node);
  }
  const order = (n: Node) => {
    n.children.sort(
      (a, b) =>
        (a.entry.startsOn ?? "").localeCompare(b.entry.startsOn ?? "") ||
        a.entry.savedAt.localeCompare(b.entry.savedAt),
    );
    n.children.forEach(order);
  };
  order(root);
  return root;
}

type RowContext = {
  wide: boolean;
  run: WorkspaceRun;
  comparisons: ScenarioComparisons;
  byId: Map<string, CatalogEntry>;
  /** Whether ticking this run (with its parents) stays within the line limit. */
  canShow: (id: string) => boolean;
  toggle: (id: string) => void;
  buildOn?: (runId: string) => void;
  hrefFor: (id: string) => string;
};

/**
 * Left rail: every saved scenario of these books as a branch tree. Ticking a box draws that
 * scenario on the chart in its own color without leaving the page; "Build on" makes it the
 * scenario new what-ifs branch from.
 */
export function ScenarioNav({
  run,
  graph,
  baseRunId,
  comparisons,
  buildOn,
  hrefFor,
  catalogHref,
  wide = false,
}: {
  run: WorkspaceRun;
  graph: Read<CatalogEntry[]>;
  baseRunId: string | null;
  comparisons: ScenarioComparisons;
  buildOn?: (runId: string) => void;
  hrefFor: (id: string) => string;
  catalogHref: string;
  wide?: boolean;
}) {
  const entries = familyEntries(run, graph);
  const root = treeOf(entries, baseRunId);
  const ctx: RowContext = {
    wide,
    run,
    comparisons,
    byId: new Map(entries.map((e) => [e.runId, e])),
    canShow: (id) => showWithAncestors(comparisons.ids, id, entries, baseRunId ?? "") !== null,
    // A child is shown only with all its parents; hiding a parent hides what builds on it.
    toggle: (id) => {
      const next = toggleShown(comparisons.ids, id, entries, baseRunId ?? "");
      if (next) comparisons.onChange(next);
    },
    buildOn,
    hrefFor,
  };
  return (
    <nav
      aria-label="Scenarios"
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      data-testid="scenario-nav"
    >
      <div className="mb-2 shrink-0 space-y-0.5 px-1">
        <p className="text-[11px] leading-4 text-muted-foreground">
          Tick to draw on the chart, up to {MAX_COMPARISONS}. Each branch starts where it leaves the
          line it builds on.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
        {root ? (
          <ul className="space-y-0.5">
            <TreeRow node={root} depth={0} ctx={ctx} />
          </ul>
        ) : (
          <p className="px-1 text-xs text-muted-foreground">Reading saved scenarios…</p>
        )}
      </div>
      <Link
        href={catalogHref}
        className="mt-2 shrink-0 px-1 text-xs text-primary underline-offset-4 hover:underline"
      >
        All saved scenarios
      </Link>
    </nav>
  );
}

function TreeRow({ node, depth, ctx }: { node: Node; depth: number; ctx: RowContext }) {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(true);
  const { entry, children } = node;
  const { run, comparisons, byId, canShow, toggle, buildOn, hrefFor } = ctx;
  const blocked = !comparisons.ids.includes(entry.runId) && depth > 0 && !canShow(entry.runId);
  const isBase = depth === 0;
  const shown = isBase || comparisons.ids.includes(entry.runId);
  const color = !isBase && shown ? colorFor(comparisons, entry.runId) : undefined;
  const building = entry.runId === run.runId;
  const name = isBase ? "Base forecast" : entry.label || KIND[entry.kind];
  const parent = entry.parentRunId ? byId.get(entry.parentRunId) : undefined;
  const checkboxId = `scenario-show-${entry.runId}`;
  return (
    <li
      className={cn("relative", depth > 0 && "pl-3")}
      data-testid={`scenario-node-${entry.runId}`}
    >
      {depth > 0 ? (
        // Elbow from the parent's vertical line into this row.
        <span
          aria-hidden="true"
          className="absolute left-0 top-0 h-[1.15rem] w-2.5 rounded-bl-md border-b border-l border-border"
        />
      ) : null}
      <div
        className={cn(
          "group relative flex min-w-0 items-start gap-1.5 rounded-md px-1.5 py-1.5",
          !building && "hover:bg-accent/60",
        )}
      >
        {building ? (
          <motion.span
            layoutId={reduced ? undefined : "scenario-building"}
            className="absolute inset-0 rounded-md bg-secondary"
            transition={{ type: "spring", stiffness: 500, damping: 40 }}
          />
        ) : null}
        <span className="relative flex w-4 shrink-0 justify-center pt-0.5">
          {children.length ? (
            <button
              type="button"
              aria-label={open ? `Collapse ${name}` : `Expand ${name}`}
              aria-expanded={open}
              onClick={() => setOpen(!open)}
              className="rounded text-muted-foreground hover:text-foreground"
            >
              <ChevronRight
                aria-hidden="true"
                className={cn("size-3.5 transition-transform", open && "rotate-90")}
              />
            </button>
          ) : null}
        </span>
        {isBase ? (
          <span
            aria-hidden="true"
            className="relative mt-[0.45rem] h-0.5 w-3.5 shrink-0 rounded-full bg-primary"
            title="The base forecast is always shown"
          />
        ) : null}
        <input
          hidden={isBase}
          id={checkboxId}
          type="checkbox"
          className="relative mt-0.5 size-3.5 shrink-0 cursor-pointer disabled:cursor-default"
          style={color ? { accentColor: color } : undefined}
          checked={shown}
          disabled={isBase || blocked}
          title={
            isBase
              ? "The base forecast is always shown"
              : blocked
                ? `Up to ${MAX_COMPARISONS} lines at a time, counting the scenarios it builds on`
                : undefined
          }
          onChange={() => toggle(entry.runId)}
          data-testid={checkboxId}
        />
        <div className="relative min-w-0 flex-1">
          <label htmlFor={checkboxId} className="block cursor-pointer">
            <span
              className={cn(
                "break-words text-sm leading-5",
                !ctx.wide && "lg:line-clamp-2",
                building ? "font-medium" : "text-foreground/90",
              )}
              title={name}
            >
              {name}
            </span>
          </label>
          <div className="mt-1 flex min-h-8 flex-wrap items-center gap-1 text-xs">
            {building ? (
              <span
                className="inline-flex items-center gap-1 font-medium text-foreground"
                title="New what-ifs from the chat or manual entry branch from here"
              >
                <GitBranch aria-hidden="true" className="size-3" />
                Building here
              </span>
            ) : buildOn ? (
              <button
                type="button"
                onClick={() => buildOn(entry.runId)}
                className="inline-flex items-center gap-1 rounded text-primary hover:underline"
                aria-label={`Build new what-ifs on ${name}`}
                data-testid={`scenario-build-${entry.runId}`}
              >
                <GitBranch aria-hidden="true" className="size-3" />
                Build on
              </button>
            ) : (
              <Link
                href={hrefFor(entry.runId)}
                className="text-primary underline-offset-4 hover:underline"
              >
                Open
              </Link>
            )}
          </div>
          <details className="group/details mt-1 text-xs">
            <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1 text-muted-foreground [&::-webkit-details-marker]:hidden">
              <ChevronRight
                aria-hidden="true"
                className="size-3 transition-transform group-open/details:rotate-90"
              />
              Details
            </summary>
            <div className="space-y-1 pb-1 text-muted-foreground">
              {!isBase && parent && parent.parentRunId !== null ? (
                <span className="block break-words text-[11px] leading-4 text-muted-foreground">
                  Built on {parent.label || KIND[parent.kind]}
                </span>
              ) : null}
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span>
                  {isBase
                    ? "No what-ifs"
                    : entry.startsOn
                      ? `Starts ${formatFullDate(entry.startsOn)}`
                      : "Same events, other rules"}
                  {" · low "}
                  {formatExactCents(entry.lowPointCents)}, week of{" "}
                  {formatFullDate(entry.lowPointWeek)}
                </span>
                <Link
                  href={timelineCalculationHref(run.companyId, entry.runId)}
                  aria-label={`How we got here for ${name}`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  How we got here
                </Link>
              </span>
            </div>
          </details>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {children.length && open ? (
          <motion.ul
            className="relative ml-[0.95rem] space-y-0.5 overflow-hidden border-l border-border"
            initial={reduced ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduced ? undefined : { opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            {children.map((child) => (
              <TreeRow key={child.entry.runId} node={child} depth={depth + 1} ctx={ctx} />
            ))}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </li>
  );
}
