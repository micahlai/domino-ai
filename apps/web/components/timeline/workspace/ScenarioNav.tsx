"use client";

import { ChevronRight, GitBranch } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { cn } from "../../../lib/utils";
import { formatExactCents, formatFullDate } from "../baseline/format";
import { familyEntries } from "./ScenarioSidebar";
import type { CatalogEntry, Read, WorkspaceRun } from "./api";
import { MAX_COMPARISONS, type ScenarioComparisons, colorFor } from "./scenarioComparisons";

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
  run: WorkspaceRun;
  comparisons: ScenarioComparisons;
  byId: Map<string, CatalogEntry>;
  full: boolean;
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
}: {
  run: WorkspaceRun;
  graph: Read<CatalogEntry[]>;
  baseRunId: string | null;
  comparisons: ScenarioComparisons;
  buildOn?: (runId: string) => void;
  hrefFor: (id: string) => string;
  catalogHref: string;
}) {
  const entries = familyEntries(run, graph);
  const root = treeOf(entries, baseRunId);
  const ctx: RowContext = {
    run,
    comparisons,
    byId: new Map(entries.map((e) => [e.runId, e])),
    full: comparisons.ids.length >= MAX_COMPARISONS,
    toggle: (id) =>
      comparisons.onChange(
        comparisons.ids.includes(id)
          ? comparisons.ids.filter((x) => x !== id)
          : [...comparisons.ids, id],
      ),
    buildOn,
    hrefFor,
  };
  return (
    <nav
      aria-label="Scenarios"
      className="hidden min-w-0 xl:sticky xl:top-20 xl:flex xl:h-[calc(100dvh-6rem)] xl:flex-col"
      data-testid="scenario-nav"
    >
      <div className="mb-2 shrink-0 space-y-0.5 px-1">
        <p className="text-xs font-medium text-muted-foreground">Scenarios</p>
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
  const { run, comparisons, byId, full, toggle, buildOn, hrefFor } = ctx;
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
        <input
          id={checkboxId}
          type="checkbox"
          className="relative mt-0.5 size-3.5 shrink-0 cursor-pointer disabled:cursor-default"
          style={color ? { accentColor: color } : undefined}
          checked={shown}
          disabled={isBase || (!shown && full)}
          title={
            isBase
              ? "The base forecast is always shown"
              : !shown && full
                ? `Up to ${MAX_COMPARISONS} at a time`
                : undefined
          }
          onChange={() => toggle(entry.runId)}
          data-testid={checkboxId}
        />
        <label htmlFor={checkboxId} className="relative min-w-0 flex-1 cursor-pointer">
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn("size-2 shrink-0 rounded-full", isBase && "bg-primary")}
              style={color ? { background: color } : undefined}
            />
            <span
              className={cn("truncate text-sm", building ? "font-medium" : "text-foreground/90")}
              title={name}
            >
              {name}
            </span>
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {isBase
              ? "No what-ifs"
              : entry.startsOn
                ? `Starts ${formatFullDate(entry.startsOn)}`
                : "Same events, other rules"}
            {" · low "}
            {formatExactCents(entry.lowPointCents)}
          </span>
          {!isBase && parent && parent.parentRunId !== null ? (
            <span className="block truncate text-[11px] text-muted-foreground">
              Built on {parent.label || KIND[parent.kind]}
            </span>
          ) : null}
        </label>
        <span className="relative shrink-0 pt-0.5">
          {building ? (
            <span
              className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground"
              title="New what-ifs from the chat or Try an event branch from here"
            >
              <GitBranch aria-hidden="true" className="size-3" />
              Here
            </span>
          ) : buildOn ? (
            <button
              type="button"
              onClick={() => buildOn(entry.runId)}
              className="inline-flex items-center gap-1 rounded px-1 text-[11px] text-primary opacity-0 transition-opacity hover:underline focus-visible:opacity-100 group-hover:opacity-100"
              aria-label={`Build new what-ifs on ${name}`}
              data-testid={`scenario-build-${entry.runId}`}
            >
              <GitBranch aria-hidden="true" className="size-3" />
              Build on
            </button>
          ) : (
            <Link
              href={hrefFor(entry.runId)}
              className="text-[11px] text-primary underline-offset-4 hover:underline"
            >
              Open
            </Link>
          )}
        </span>
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
