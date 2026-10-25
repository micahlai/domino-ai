import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import {
  type SimulateFixLoad,
  type WireComputation,
  addEventToCompany,
  fromWire,
  loadRecompute,
  loadSimulateFix,
  recomputeCompany,
  simulateFixForBranch,
  writeRecompute,
  writeSimulateFix,
} from "./lib/publish";

/**
 * The engine.* actions (engine.ts, lib/engineRun.ts) run each job as load (query) -> pure
 * engine (action) -> write (mutation). The engine is too slow for the 1 s mutation limit on the
 * larger companies; the write commits only if the loaded rows are unchanged.
 */
export const loadForRecompute = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => loadRecompute(ctx, companyId),
});

export const writeRecomputed = internalMutation({
  args: {
    companyId: v.id("companies"),
    stamp: v.string(),
    order: v.union(v.null(), v.array(v.string())),
    nextOrder: v.array(v.string()),
    computation: v.any(),
    action: v.union(v.literal("engine.recompute"), v.literal("engine.addEvent")),
  },
  handler: async (ctx, { companyId, stamp, order, nextOrder, computation, action }) =>
    writeRecompute(
      ctx,
      companyId,
      { stamp, order },
      { computation: fromWire(computation as WireComputation), nextOrder },
      action,
    ),
});

export const loadForSimulateFix = internalQuery({
  args: { branchId: v.string(), fixId: v.string() },
  handler: async (ctx, { branchId, fixId }) => loadSimulateFix(ctx, branchId, fixId),
});

export const writeSimulatedFix = internalMutation({
  args: {
    companyId: v.id("companies"),
    fixId: v.string(),
    parent: v.any(),
    ancestors: v.array(v.any()),
    stamp: v.string(),
    branch: v.any(),
  },
  handler: async (ctx, { companyId, fixId, parent, ancestors, stamp, branch }) =>
    writeSimulateFix(
      ctx,
      { companyId, fixId, parent, ancestors, stamp } as Pick<
        SimulateFixLoad,
        "companyId" | "fixId" | "parent" | "ancestors" | "stamp"
      >,
      branch,
    ),
});

/**
 * Single-transaction versions (tests and the small demo seed). They run the same load, engine
 * and write steps inside one mutation, so they can time out on large companies.
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
