import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { planRecompute, toWire } from "../lib/publish";
import { computedRefs } from "../lib/refs";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Timing probe for one company (scripts/time-engine.mjs). `single` is the whole recompute in
 * one mutation (the old path, subject to the 1 s limit); `split` is the production path:
 * load query, engine in this action, guarded write mutation. Same writes as engine.recompute.
 */
export const recompute = internalAction({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    let start = Date.now();
    let single: { ms: number; error?: string };
    try {
      await ctx.runMutation(computedRefs.recompute, { companyId });
      single = { ms: Date.now() - start };
    } catch (error) {
      single = { ms: Date.now() - start, error: message(error) };
    }
    start = Date.now();
    const load = await ctx.runQuery(computedRefs.loadForRecompute, { companyId });
    const loaded = Date.now();
    const plan = planRecompute(companyId, load);
    const computed = Date.now();
    const result = await ctx.runMutation(computedRefs.writeRecomputed, {
      companyId,
      stamp: load.stamp,
      order: load.order,
      nextOrder: plan.nextOrder,
      computation: toWire(plan.computation),
      action: "engine.recompute",
    });
    const written = Date.now();
    return {
      single,
      split: {
        loadMs: loaded - start,
        engineMs: computed - loaded,
        writeMs: written - computed,
        stale: result.stale,
        branches: plan.computation.branches.length,
        risks: plan.computation.risks.length,
        bytes: JSON.stringify(toWire(plan.computation)).length,
      },
    };
  },
});

/** Wall time of one public query as run by this action (e.g. fieldCustomers:list). */
export const query = internalAction({
  args: { name: v.string(), args: v.any() },
  handler: async (ctx, { name, args }) => {
    const start = Date.now();
    await ctx.runQuery(makeFunctionReference<"query">(name), args);
    return { ms: Date.now() - start };
  },
});
