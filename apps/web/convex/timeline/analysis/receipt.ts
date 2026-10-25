import {
  ChangeSchema,
  EvidenceSchema,
  ForecastSchema,
  OperationSummaryV1Schema,
  canonicalJson,
} from "@domino/contracts";
import { z } from "zod";
import { RuleReceiptSchema } from "../workspaceRules";

export const ANALYSIS_METHOD = "timeline_analysis@1.0.0";
export const MAX_RISKS = 3;
export const MAX_RESPONSES = 2;
export const LEASE_MS = 120_000;
const text = z.string().min(1).max(2000);
const evidence = z.array(EvidenceSchema).max(100);
const changes = z.array(ChangeSchema).min(1).max(8);
export const AnalysisRiskSchema = z
  .object({
    id: text,
    label: text,
    probability: z.number().finite().min(0).max(1),
    probabilityBasis: text,
    evidence,
    changes,
    runId: text.nullable(),
    forecast: ForecastSchema,
    receipts: z.array(RuleReceiptSchema).max(32),
    failureReason: text.nullable(),
  })
  .strict();
export const AnalysisResponseSchema = z
  .object({
    id: text,
    riskId: text,
    label: text,
    costNote: text,
    risk: z.enum(["low", "medium", "high"]),
    evidence,
    changes,
    runId: text.nullable(),
    forecast: ForecastSchema,
    receipts: z.array(RuleReceiptSchema).max(32),
    gainCents: z.number().safe().int(),
    clearsAllRules: z.boolean(),
  })
  .strict();
export const AnalysisReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    companyId: text,
    analysisId: text,
    runId: text,
    inputHash: text,
    constraintVersion: text,
    status: z.enum(["queued", "running", "succeeded", "partial", "failed"]),
    methodVersion: z.literal(ANALYSIS_METHOD),
    savedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
    operation: OperationSummaryV1Schema,
    risks: z.array(AnalysisRiskSchema).max(MAX_RISKS),
    responses: z.array(AnalysisResponseSchema).max(MAX_RISKS * MAX_RESPONSES),
    resilience: z
      .object({
        weightedScenarioIndex: z.number().finite().min(0).max(1),
        survivedCount: z.number().int().min(0).max(8),
        scenarioCount: z.number().int().min(1).max(8),
        scope: text,
      })
      .strict()
      .nullable(),
    warnings: z.array(text).max(30),
    errorCode: text.nullable(),
  })
  .strict();
export type AnalysisReceipt = z.infer<typeof AnalysisReceiptSchema>;
export type AnalysisRisk = z.infer<typeof AnalysisRiskSchema>;
export type AnalysisResponse = z.infer<typeof AnalysisResponseSchema>;

/** No schema stripping, invalid references, unsafe cents or hidden fields on persisted reads. */
export function exactReceipt(raw: unknown): AnalysisReceipt {
  const p = AnalysisReceiptSchema.parse(raw);
  if (canonicalJson(raw) !== canonicalJson(p)) throw new Error("Analysis has unknown fields");
  const safeMoney = (x: unknown, key = "") => {
    if (
      typeof x === "number" &&
      [
        "opening",
        "inflow",
        "outflow",
        "closing",
        "usable",
        "amount",
        "monthlyCost",
        "gainCents",
      ].includes(key) &&
      !Number.isSafeInteger(x)
    )
      throw new Error("Unsafe analysis cents");
    if (Array.isArray(x)) {
      for (const v of x) safeMoney(v);
    } else if (x && typeof x === "object") {
      for (const [k, v] of Object.entries(x)) safeMoney(v, k);
    }
  };
  safeMoney(p);
  if (
    p.operation.status !== p.status ||
    p.operation.ownerDomain !== "timeline" ||
    p.operation.finishedAt !== (p.finishedAt ?? undefined) ||
    p.operation.createdAt !== p.savedAt
  )
    throw new Error("Invalid analysis operation");
  if (
    (p.status === "succeeded" && p.errorCode !== null) ||
    ((p.status === "failed" || p.status === "partial") && p.errorCode === null)
  )
    throw new Error("Invalid analysis error status");
  const outputs = [
    p.analysisId,
    ...p.risks.flatMap((r) => (r.runId ? [r.runId] : [])),
    ...p.responses.flatMap((r) => (r.runId ? [r.runId] : [])),
  ];
  if (
    (p.status === "succeeded" || p.status === "partial") &&
    canonicalJson(p.operation.outputRefs) !== canonicalJson(outputs)
  )
    throw new Error("Invalid analysis outputs");
  if (p.status === "succeeded" && [...p.risks, ...p.responses].some((r) => r.runId === null))
    throw new Error("Completed analysis has unsaved scenarios");
  const ids = new Set(p.risks.map((r) => r.id));
  if (
    ids.size !== p.risks.length ||
    new Set(p.responses.map((r) => r.id)).size !== p.responses.length
  )
    throw new Error("Duplicate analysis identities");
  for (const r of p.responses)
    if (
      !ids.has(r.riskId) ||
      p.responses.filter((f) => f.riskId === r.riskId).length > MAX_RESPONSES
    )
      throw new Error("Invalid response risk");
  for (const r of [...p.risks, ...p.responses])
    for (const receipt of r.receipts) {
      if (
        receipt.unit === "cents" &&
        [receipt.limit, receipt.value, receipt.shortfall].some(
          (x) => x !== null && !Number.isSafeInteger(x),
        )
      )
        throw new Error("Unsafe rule cents");
    }
  if ((p.status === "queued" || p.status === "running") !== (p.finishedAt === null))
    throw new Error("Invalid analysis finish");
  return p;
}
