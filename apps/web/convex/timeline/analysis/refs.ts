import { makeFunctionReference } from "convex/server";
import type { AnalysisReceipt } from "./receipt";
export type StartArgs = { companyId: string; runId: string; requestId: string; reviewed: boolean };
export type StartResult = { companyId: string; analysisId: string; created: boolean };
export type Key = { companyId: string; analysisId: string };
export const analysisRefs = {
  start: makeFunctionReference<"mutation", StartArgs, StartResult>("timeline/analysis:start"),
  retry: makeFunctionReference<
    "mutation",
    Key & { requestId: string; reviewed: boolean },
    StartResult
  >("timeline/analysis:retry"),
  get: makeFunctionReference<"query", Key, AnalysisReceipt | null>("timeline/analysis:get"),
  list: makeFunctionReference<"query", { companyId: string; runId: string }, AnalysisReceipt[]>(
    "timeline/analysis:list",
  ),
  execute: makeFunctionReference<"action", Key, null>("timeline/analysis:execute"),
  claim: makeFunctionReference<"mutation", Key, AnalysisReceipt | null>("timeline/analysis:claim"),
  expire: makeFunctionReference<"mutation", Key, null>("timeline/analysis:expire"),
};
