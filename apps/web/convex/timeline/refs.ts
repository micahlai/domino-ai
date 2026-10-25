import { makeFunctionReference } from "convex/server";
import type { SavedBaseline } from "./baselines";

/**
 * Typed references to timeline/baselines until the lead regenerates `_generated/api` with the
 * CLI; then `api.timeline.baselines.*` is equivalent. Type-only import: no runtime code.
 */
export const baselineRefs = {
  save: makeFunctionReference<
    "mutation",
    {
      requestId: string;
      seedJson: string;
      modelJson: string;
      constraintsJson: string;
      assumptionNote: string;
      reviewed: boolean;
    },
    { runId: string; companyId: string; created: boolean }
  >("timeline/baselines:save"),
  get: makeFunctionReference<"query", { companyId: string; runId: string }, SavedBaseline | null>(
    "timeline/baselines:get",
  ),
};
