import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { addEventFresh, recomputeFresh, simulateFixFresh } from "./lib/engineRun";

/**
 * Scheduled entry points. Each loads its inputs in a query, runs the pure engine here and
 * writes in one mutation that commits only if the inputs are unchanged (lib/engineRun.ts), so
 * outputs stay coherent and the engine never runs inside the 1 s mutation limit. No network or
 * agent call happens here.
 */
export const recompute = internalAction({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }): Promise<{ asOf: string; changed: boolean }> => {
    const { computation, changed } = await recomputeFresh(ctx, companyId, "engine.recompute");
    return { asOf: computation.asOf, changed };
  },
});
export const addEvent = internalAction({
  args: { companyId: v.id("companies"), label: v.string(), changes: v.array(v.any()) },
  handler: async (ctx, args): Promise<{ riskId: string; branchId: string }> =>
    addEventFresh(ctx, args.companyId, args.label, args.changes),
});
export const simulateFix = internalAction({
  args: { branchId: v.string(), fixId: v.string() },
  handler: async (ctx, args): Promise<{ branchId: string; changed: boolean }> =>
    simulateFixFresh(ctx, args.branchId, args.fixId),
});
