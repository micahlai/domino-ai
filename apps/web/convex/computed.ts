import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { addEventToCompany, recomputeCompany, simulateFixForBranch } from "./lib/publish";

/**
 * Transactional halves of the engine.* actions: each loads inputs, runs the pure engine,
 * validates and writes in one mutation, so a failure or retry never leaves a partial result.
 */
export const recompute = internalMutation({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const { computation, changed } = await recomputeCompany(ctx, companyId, {
      action: "engine.recompute",
    });
    return { asOf: computation.asOf, changed };
  },
});

export const addEvent = internalMutation({
  args: { companyId: v.id("companies"), label: v.string(), changes: v.array(v.any()) },
  handler: async (ctx, { companyId, label, changes }) =>
    addEventToCompany(ctx, companyId, label, changes),
});

export const simulateFix = internalMutation({
  args: { branchId: v.string(), fixId: v.string() },
  handler: async (ctx, { branchId, fixId }) => simulateFixForBranch(ctx, branchId, fixId),
});
