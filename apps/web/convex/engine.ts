import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { computedRefs } from "./lib/refs";

/**
 * Scheduled entry points. Each runs one transactional mutation (computed.ts) so the pure
 * engine's inputs and outputs stay coherent; no network or agent call happens here.
 */
export const recompute = internalAction({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => ctx.runMutation(computedRefs.recompute, args),
});
export const addEvent = internalAction({
  args: { companyId: v.id("companies"), label: v.string(), changes: v.array(v.any()) },
  handler: async (ctx, args) => ctx.runMutation(computedRefs.addEvent, args),
});
export const simulateFix = internalAction({
  args: { branchId: v.string(), fixId: v.string() },
  handler: async (ctx, args) => ctx.runMutation(computedRefs.simulateFix, args),
});
