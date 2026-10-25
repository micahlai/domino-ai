import type { Change } from "@domino/contracts";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { type Computation, reject } from "./computed";
import {
  type RecomputeAction,
  eventCheck,
  planRecompute,
  planSimulateFix,
  toWire,
} from "./publish";
import { computedRefs } from "./refs";

/**
 * Action halves of the engine jobs: load (query) -> pure engine here (actions have no 1 s
 * limit) -> write (mutation). The write commits only if the rows the load read are unchanged;
 * otherwise the whole cycle runs again on the new rows, a bounded number of times.
 */
export const ENGINE_ATTEMPTS = 3;

type Runner = Pick<ActionCtx, "runQuery" | "runMutation">;

function inputsKeptChanging(job: string): never {
  reject(
    "INPUTS_CHANGED",
    `${job}: the company's data kept changing while the engine ran (${ENGINE_ATTEMPTS} tries); nothing was saved`,
  );
}

function timing(job: string, attempt: number, marks: number[]) {
  const [start = 0, loaded = 0, computed = 0, written = 0] = marks;
  console.log(
    `${job} attempt ${attempt}: load ${loaded - start}ms, engine ${computed - loaded}ms, write ${written - computed}ms`,
  );
}

export async function recomputeFresh(
  ctx: Runner,
  companyId: Id<"companies">,
  action: RecomputeAction,
  check?: (computation: Computation) => void,
) {
  for (let attempt = 1; attempt <= ENGINE_ATTEMPTS; attempt++) {
    const marks = [Date.now()];
    const load = await ctx.runQuery(computedRefs.loadForRecompute, { companyId });
    marks.push(Date.now());
    const plan = planRecompute(companyId, load, check);
    marks.push(Date.now());
    const result = await ctx.runMutation(computedRefs.writeRecomputed, {
      companyId,
      stamp: load.stamp,
      order: load.order,
      nextOrder: plan.nextOrder,
      computation: toWire(plan.computation),
      action,
    });
    marks.push(Date.now());
    timing(action, attempt, marks);
    if (!result.stale) return { computation: plan.computation, changed: result.changed };
  }
  return inputsKeptChanging(action);
}

export async function addEventFresh(
  ctx: Runner,
  companyId: Id<"companies">,
  label: string,
  changes: Change[],
) {
  const { check, found } = eventCheck(companyId, label, changes);
  await recomputeFresh(ctx, companyId, "engine.addEvent", check);
  return { ...found };
}

export async function simulateFixFresh(ctx: Runner, branchId: string, fixId: string) {
  for (let attempt = 1; attempt <= ENGINE_ATTEMPTS; attempt++) {
    const marks = [Date.now()];
    const load = await ctx.runQuery(computedRefs.loadForSimulateFix, { branchId, fixId });
    marks.push(Date.now());
    const branch = planSimulateFix(load);
    marks.push(Date.now());
    const result = await ctx.runMutation(computedRefs.writeSimulatedFix, {
      companyId: load.companyId,
      fixId,
      parent: load.parent,
      ancestors: load.ancestors,
      stamp: load.stamp,
      branch,
    });
    marks.push(Date.now());
    timing("engine.simulateFix", attempt, marks);
    if (!result.stale) return { branchId: result.branchId, changed: result.changed };
  }
  return inputsKeptChanging("engine.simulateFix");
}
