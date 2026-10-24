import type { Change } from "@domino/contracts";
import { makeFunctionReference } from "convex/server";
import type { Id } from "../_generated/dataModel";

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
};

export const seedComputedRef = makeFunctionReference<
  "mutation",
  Record<string, never>,
  { companyId: Id<"companies">; created: boolean }
>("dev/seedComputed:seed");
