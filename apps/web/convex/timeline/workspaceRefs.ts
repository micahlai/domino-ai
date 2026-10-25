import { makeFunctionReference } from "convex/server";
import type { CatalogEntry, WorkspaceResult, WorkspaceRun } from "./workspace";

/**
 * Typed references to timeline/workspace until the lead regenerates `_generated/api` with the
 * CLI; then `api.timeline.workspace.*` is equivalent. Type-only import: no runtime code.
 */
export const workspaceRefs = {
  open: makeFunctionReference<
    "mutation",
    { companyId: string; baselineRunId: string; requestId: string },
    WorkspaceResult
  >("timeline/workspace:open"),
  reviseConstraints: makeFunctionReference<
    "mutation",
    {
      companyId: string;
      parentRunId: string;
      requestId: string;
      constraintsJson: string;
      note: string;
      reviewed: boolean;
    },
    WorkspaceResult
  >("timeline/workspace:reviseConstraints"),
  simulate: makeFunctionReference<
    "mutation",
    {
      companyId: string;
      parentRunId: string;
      requestId: string;
      label: string;
      changesJson: string;
      reviewed: boolean;
      constraintsJson?: string;
      constraintNote?: string;
      allowEarlierStart?: boolean;
    },
    WorkspaceResult
  >("timeline/workspace:simulate"),
  get: makeFunctionReference<"query", { companyId: string; runId: string }, WorkspaceRun | null>(
    "timeline/workspace:get",
  ),
  catalog: makeFunctionReference<
    "query",
    { companyId: string; paginationOpts: { numItems: number; cursor: string | null } },
    { page: CatalogEntry[]; isDone: boolean; continueCursor: string }
  >("timeline/workspace:catalog"),
  graph: makeFunctionReference<
    "query",
    { companyId: string; baselineRunId: string },
    CatalogEntry[]
  >("timeline/workspace:graph"),
  resultRef: makeFunctionReference<"query", { companyId: string; runId: string }, string | null>(
    "timeline/workspace:resultRef",
  ),
};
