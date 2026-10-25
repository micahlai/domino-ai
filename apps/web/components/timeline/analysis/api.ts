import {
  ChangeSchema,
  EvidenceSchema,
  OperationSummaryV1Schema,
  canonicalJson,
} from "@domino/contracts";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";
import type { Read, RunKey, WorkspaceRun } from "../workspace/api";

import { FinancialOutputSchema, ReceiptsSchema, SafeForecastSchema } from "./output";

const Text = z.string().min(1).max(4096);
const Cents = z.number().int().safe();
const Stamp = z.string().datetime({ offset: true });
const Risk = z
  .object({
    id: Text,
    label: Text,
    probability: z.number().finite().min(0).max(1),
    probabilityBasis: Text,
    evidence: z.array(EvidenceSchema).max(64),
    changes: z.array(ChangeSchema).max(64),
    runId: Text.nullable(),
    forecast: SafeForecastSchema,
    receipts: ReceiptsSchema,
    failureReason: z.string().nullable(),
  })
  .strict();
const Response = z
  .object({
    id: Text,
    riskId: Text,
    label: Text,
    costNote: Text,
    risk: z.enum(["low", "medium", "high"]),
    evidence: z.array(EvidenceSchema).max(64),
    changes: z.array(ChangeSchema).max(64),
    runId: Text.nullable(),
    forecast: SafeForecastSchema,
    receipts: ReceiptsSchema,
    gainCents: Cents,
    clearsAllRules: z.boolean(),
  })
  .strict();
const Receipt = z
  .object({
    schemaVersion: z.literal(1),
    companyId: Text,
    analysisId: Text,
    runId: Text,
    inputHash: Text,
    constraintVersion: Text,
    status: z.enum(["queued", "running", "succeeded", "partial", "failed"]),
    methodVersion: Text,
    savedAt: Stamp,
    finishedAt: Stamp.nullable(),
    operation: OperationSummaryV1Schema,
    risks: z.array(Risk).max(3),
    responses: z.array(Response).max(6),
    resilience: z
      .object({
        weightedScenarioIndex: z.number().finite().min(0).max(1),
        survivedCount: z.number().int().nonnegative(),
        scenarioCount: z.number().int().nonnegative(),
        scope: Text,
      })
      .strict()
      .nullable(),
    warnings: z.array(z.string()).max(64),
    errorCode: z.string().nullable(),
  })
  .strict();
export type AnalysisReceipt = z.infer<typeof Receipt>;
export type AnalysisRisk = AnalysisReceipt["risks"][number];
export type AnalysisResponse = AnalysisReceipt["responses"][number];

/** Exact JSON plus targeted cents checks: fractions in probabilities and discounts remain valid. */
export const AnalysisReceiptSchema = Receipt.superRefine((r, ctx) => {
  const bad = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  const terminal = r.status !== "queued" && r.status !== "running";
  if (terminal !== (r.finishedAt !== null)) bad("terminal timestamp mismatch");
  if (r.operation.ownerDomain !== "timeline" || r.operation.status !== r.status)
    bad("operation mismatch");
  if (r.resilience && r.resilience.survivedCount > r.resilience.scenarioCount) bad("invalid count");
  const ids = new Set(r.risks.map((x) => x.id));
  if (
    ids.size !== r.risks.length ||
    new Set(r.responses.map((x) => x.id)).size !== r.responses.length
  )
    bad("duplicate id");
  for (const risk of r.risks)
    if (r.responses.filter((x) => x.riskId === risk.id).length > 2) bad("response bound");
  for (const response of r.responses) if (!ids.has(response.riskId)) bad("response has no risk");
  for (const x of [...r.risks, ...r.responses]) {
    for (const w of x.forecast.weeks)
      for (const k of ["opening", "inflow", "outflow", "closing", "usable"] as const)
        if (!Number.isSafeInteger(w[k])) bad("unsafe cash");
    if (!Number.isSafeInteger(x.forecast.lowPoint.usable)) bad("unsafe low point");
    for (const c of x.changes) {
      if ((c.kind === "add_cash" || c.kind === "remove_cash") && !Number.isSafeInteger(c.amount))
        bad("unsafe amount");
      if (c.kind === "shift_hire" && !Number.isSafeInteger(c.monthlyCost))
        bad("unsafe hiring cost");
    }
    for (const receipt of x.receipts) {
      if (receipt.constraintVersion !== r.constraintVersion) bad("rule version mismatch");
      if (receipt.unit === "cents")
        for (const n of [receipt.limit, receipt.value, receipt.shortfall])
          if (n !== null && !Number.isSafeInteger(n)) bad("unsafe rule money");
    }
  }
});

function parse(raw: unknown): AnalysisReceipt | undefined {
  const p = AnalysisReceiptSchema.safeParse(raw);
  if (!p.success) return undefined;
  try {
    return canonicalJson(raw) === canonicalJson(p.data) ? p.data : undefined;
  } catch {
    return undefined;
  }
}
function early(raw: unknown): Read<never> | undefined {
  return raw === undefined
    ? { state: "loading" }
    : raw instanceof Error
      ? { state: "error" }
      : undefined;
}
export function readAnalysis(
  raw: unknown,
  key: RunKey & { analysisId: string },
  run?: WorkspaceRun,
): Read<AnalysisReceipt> {
  const pending = early(raw);
  if (pending) return pending;
  if (raw === null) return { state: "missing" };
  const r = parse(raw);
  if (
    !r ||
    r.companyId !== key.companyId ||
    r.runId !== key.runId ||
    r.analysisId !== key.analysisId ||
    (run && (r.inputHash !== run.inputHash || r.constraintVersion !== run.constraintVersion))
  )
    return { state: "unusable" };
  return { state: "ready", value: r };
}
export function readAnalyses(
  raw: unknown,
  key: RunKey,
  run?: WorkspaceRun,
): Read<AnalysisReceipt[]> {
  const pending = early(raw);
  if (pending) return pending;
  if (!Array.isArray(raw) || raw.length > 20) return { state: "unusable" };
  const out: AnalysisReceipt[] = [];
  for (const item of raw) {
    const r = parse(item);
    if (
      !r ||
      r.companyId !== key.companyId ||
      r.runId !== key.runId ||
      (run && (r.inputHash !== run.inputHash || r.constraintVersion !== run.constraintVersion))
    )
      return { state: "unusable" };
    out.push(r);
  }
  if (new Set(out.map((x) => x.analysisId)).size !== out.length) return { state: "unusable" };
  return { state: "ready", value: out };
}
export const StartResultSchema = z
  .object({ companyId: Text, analysisId: Text, created: z.boolean() })
  .strict();
export type StartArgs = RunKey & { requestId: string; reviewed: true };
export type RetryArgs = {
  companyId: string;
  analysisId: string;
  requestId: string;
  reviewed: true;
};
export const startRef = makeFunctionReference<"mutation", StartArgs, unknown>(
  "timeline/analysis:start",
);
export const retryRef = makeFunctionReference<"mutation", RetryArgs, unknown>(
  "timeline/analysis:retry",
);
export const getAnalysisRef = makeFunctionReference<
  "query",
  { companyId: string; analysisId: string },
  unknown
>("timeline/analysis:get");
export const listAnalysesRef = makeFunctionReference<"query", RunKey, unknown>(
  "timeline/analysis:list",
);
export const outputRef = makeFunctionReference<"action", RunKey, unknown>("timeline/output:get");
export function canAnalyze(run: WorkspaceRun): boolean {
  return run.kind !== "scenario" && run.changes.length === 0;
}
export function canRetry(r: AnalysisReceipt): boolean {
  return r.status === "failed" || r.status === "partial";
}
export { analysisHref } from "./links";
/** Validate the independently versioned financial export before making it downloadable. */
export function readOutput(raw: unknown, key: RunKey): string | undefined {
  if (typeof raw !== "string" || new TextEncoder().encode(raw).length > 900_000) return undefined;
  try {
    const json: unknown = JSON.parse(raw);
    const r = FinancialOutputSchema.safeParse(json);
    if (
      !r.success ||
      r.data.companyId !== key.companyId ||
      r.data.runId !== key.runId ||
      canonicalJson(json) !== raw
    )
      return undefined;
    return raw;
  } catch {
    return undefined;
  }
}
