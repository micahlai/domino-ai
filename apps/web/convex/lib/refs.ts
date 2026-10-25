import type { Branch, Change } from "@domino/contracts";
import { makeFunctionReference } from "convex/server";
import type { Id } from "../_generated/dataModel";
import type { RecomputeAction, RecomputeLoad, SimulateFixLoad, WireComputation } from "./publish";

/**
 * Typed references to I2's internal functions. Offline `convex codegen` needs a configured
 * deployment, so `_generated/api` does not list these modules yet; once the integration owner
 * regenerates it, `internal.computed.*` and `internal.dev.seedComputed.seed` are equivalent.
 */
export const computedRefs = {
  recompute: makeFunctionReference<
    "mutation",
    { companyId: Id<"companies"> },
    { asOf: string; changed: boolean }
  >("computed:recompute"),
  addEvent: makeFunctionReference<
    "mutation",
    { companyId: Id<"companies">; label: string; changes: Change[] },
    { riskId: string; branchId: string }
  >("computed:addEvent"),
  simulateFix: makeFunctionReference<
    "mutation",
    { branchId: string; fixId: string },
    { branchId: string; changed: boolean }
  >("computed:simulateFix"),
  loadForRecompute: makeFunctionReference<"query", { companyId: Id<"companies"> }, RecomputeLoad>(
    "computed:loadForRecompute",
  ),
  writeRecomputed: makeFunctionReference<
    "mutation",
    {
      companyId: Id<"companies">;
      stamp: string;
      order: string[] | null;
      nextOrder: string[];
      computation: WireComputation;
      action: RecomputeAction;
    },
    { stale: true } | { stale: false; changed: boolean }
  >("computed:writeRecomputed"),
  loadForSimulateFix: makeFunctionReference<
    "query",
    { branchId: string; fixId: string },
    SimulateFixLoad
  >("computed:loadForSimulateFix"),
  writeSimulatedFix: makeFunctionReference<
    "mutation",
    {
      companyId: Id<"companies">;
      fixId: string;
      parent: Branch;
      ancestors: Branch[];
      stamp: string;
      branch: Branch;
    },
    { stale: true } | { stale: false; branchId: string; changed: boolean }
  >("computed:writeSimulatedFix"),
};

export const seedComputedRef = makeFunctionReference<
  "mutation",
  Record<string, never>,
  { companyId: Id<"companies">; created: boolean }
>("dev/seedComputed:seed");
