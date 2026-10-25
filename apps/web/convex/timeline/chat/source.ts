import { BOUNDARY_INTEGER_MAX, canonicalJson, contentHashPreimage } from "@domino/contracts";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { type WorkspaceRun, projectRun, recordsOf, workspaceGet } from "../questions/context";
import { addDays } from "../questions/parse";
import {
  checkChanges,
  checkConstraints,
  checkMoneyBound,
  checkRowSize,
  reject,
  sha256Hex,
} from "../workspaceInput";
import type { ChatReceipt } from "./receipt";

export async function source(
  ctx: MutationCtx | QueryCtx,
  companyId: string,
  runId: string,
): Promise<WorkspaceRun> {
  const raw = await ctx.runQuery(workspaceGet, { companyId, runId });
  const run = projectRun(raw, companyId, runId);
  if (!run || run === "invalid")
    reject(
      "SOURCE_UNAVAILABLE",
      "The saved source run is missing or invalid. Open a saved timeline first.",
    );
  const seed = run.baseline.seed;
  const seedHash = await sha256Hex(contentHashPreimage(seed));
  const rulesHash = `rules/${(await sha256Hex(canonicalJson(run.constraints))).slice(0, 16)}`;
  if (
    seed.contentHash !== seedHash ||
    run.baseline.seedHash !== seedHash ||
    !/^[a-f0-9]{64}$/.test(run.inputHash) ||
    run.constraintVersion !== rulesHash
  )
    reject("CHAT_INTEGRITY", "The saved source identity or rule version could not be verified.");
  checkRowSize({ run });
  checkConstraints(run.constraints, seed.snapshot);
  checkChanges(run.changes, seed.snapshot, {
    asOf: seed.snapshot.asOf,
    firstWeek: run.forecast.weeks[0]?.weekStart ?? "",
    end: addDays(run.forecast.weeks[12]?.weekStart ?? "", 6),
  });
  checkMoneyBound(seed.snapshot, run.baseline.model, run.constraints, run.changes);
  for (const week of run.forecast.weeks)
    for (const money of [week.opening, week.inflow, week.outflow, week.closing, week.usable])
      if (!Number.isSafeInteger(money) || Math.abs(money) > BOUNDARY_INTEGER_MAX)
        reject("CHAT_INTEGRITY", "The saved source contains unsafe money values.");
  return run;
}
export function checkSelection(
  run: WorkspaceRun,
  selectedWeek: string | null,
  selectedItemId: string | null,
) {
  if (
    selectedWeek &&
    ![...run.forecast.weeks, ...run.baseline.history].some((w) => w.weekStart === selectedWeek)
  )
    reject("INVALID_SELECTION", "Select one saved Monday from this timeline.");
  if (
    selectedItemId &&
    !recordsOf(run).some((r) => r.id === selectedItemId || r.scheduledId === selectedItemId)
  )
    reject("INVALID_SELECTION", "The selected item does not belong to this saved run.");
}
export function checkPinned(run: WorkspaceRun, receipt: ChatReceipt) {
  if (
    run.runId !== receipt.runId ||
    run.companyId !== receipt.companyId ||
    run.inputHash !== receipt.inputHash ||
    run.constraintVersion !== receipt.constraintVersion
  )
    reject("CHAT_INTEGRITY", "This chat no longer matches its saved source. Start a new chat.");
  checkSelection(run, receipt.selectedWeek, receipt.selectedItemId);
  const context = receipt.workerContext;
  if (
    context &&
    (context.fixRunId !== run.runId ||
      context.scenarioRunId !== run.parentRunId ||
      context.inputs.snapshot.companyId !== run.companyId ||
      canonicalJson(context.inputs.model.data) !== canonicalJson(run.baseline.model) ||
      canonicalJson(context.inputs.constraints) !== canonicalJson(run.constraints) ||
      canonicalJson(context.candidate.fix.changes) !== canonicalJson(run.ownChanges) ||
      context.candidate.effect.lowPoint !== run.forecast.lowPoint.usable ||
      context.candidate.effect.lowWeekStart !== run.forecast.lowPoint.weekStart ||
      context.candidate.effect.gain !== run.comparison?.lowPointDelta)
  )
    reject("CHAT_INTEGRITY", "The saved Worker context does not match this forecast.");
}
