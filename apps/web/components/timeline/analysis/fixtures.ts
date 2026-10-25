import type { OperationSummaryV1 } from "@domino/contracts";
import { fixtureRules, fixtureScenario } from "../workspace/fixtures";
import type { AnalysisReceipt } from "./api";

const at = "2026-10-24T16:00:00.000Z";
export const fixtureAnalysis: AnalysisReceipt = {
  schemaVersion: 1,
  companyId: fixtureRules.companyId,
  analysisId: "timeline:analysis/fixture-complete",
  runId: fixtureRules.runId,
  inputHash: fixtureRules.inputHash,
  constraintVersion: fixtureRules.constraintVersion,
  status: "succeeded",
  methodVersion: "timeline-analysis-fixture-v1",
  savedAt: at,
  finishedAt: at,
  operation: {
    schemaVersion: 1,
    id: "timeline:operation/analysis-fixture",
    ownerDomain: "timeline",
    status: "succeeded",
    title: "Timeline analysis (fixture)",
    dependencies: [],
    evidenceRefs: [],
    outputRefs: [],
    createdAt: at,
    startedAt: at,
    finishedAt: at,
    updatedAt: at,
  },
  risks: [
    {
      id: "risk-acme",
      label: "Acme pays 30 days late",
      probability: 0.5,
      probabilityBasis:
        "Fixture stress assumption: 50% weight, not a learned chance or calibrated prediction.",
      evidence: [
        {
          source: "stripe",
          ref: "inv_acme_2027",
          note: "Fixture open invoice; payment delay is a scenario assumption.",
        },
      ],
      changes: fixtureScenario.ownChanges,
      runId: fixtureScenario.runId,
      forecast: fixtureScenario.forecast,
      receipts: fixtureScenario.receipts,
      failureReason: null,
    },
  ],
  responses: [
    {
      id: "response-discount",
      riskId: "risk-acme",
      label: "Offer early-payment terms",
      costNote:
        "Fixture: a 2% discount on the selected invoice in exchange for payment before its due date. Terms are simulated; no offer was sent.",
      risk: "medium",
      evidence: [
        {
          source: "stripe",
          ref: "inv_acme_2027",
          note: "Illustrative response terms for the selected invoice.",
        },
      ],
      changes: [
        { kind: "discount_early_pay", invoiceId: "inv_acme_2027", percent: 2, payOn: "2026-11-16" },
      ],
      runId: null,
      forecast: fixtureRules.forecast,
      receipts: fixtureRules.receipts,
      gainCents: 11_000_000,
      clearsAllRules: true,
    },
  ],
  resilience: {
    weightedScenarioIndex: 0.5,
    survivedCount: 1,
    scenarioCount: 2,
    scope:
      "Fixture only. Weighted index over tested combinations; not a probability. Weekly close and 13-week cash scope. Runway survival is excluded.",
  },
  warnings: ["Fixture preview: these sample results were not calculated by a live analysis job."],
  errorCode: null,
};
export function fixtureAttempt(status: AnalysisReceipt["status"]): AnalysisReceipt {
  const terminal = status !== "queued" && status !== "running";
  const { startedAt: _start, finishedAt: _finish, ...base } = fixtureAnalysis.operation;
  const operation: OperationSummaryV1 = {
    ...base,
    status,
    ...(status !== "queued" ? { startedAt: at } : {}),
    ...(terminal ? { finishedAt: at } : {}),
  };
  return {
    ...fixtureAnalysis,
    analysisId: `timeline:analysis/fixture-${status}`,
    status,
    finishedAt: terminal ? at : null,
    operation,
    risks:
      status === "queued" || status === "running" || status === "failed"
        ? []
        : fixtureAnalysis.risks,
    responses: status === "succeeded" ? fixtureAnalysis.responses : [],
    resilience: status === "succeeded" ? fixtureAnalysis.resilience : null,
    errorCode:
      status === "failed" ? "LEASE_EXPIRED" : status === "partial" ? "RESPONSE_INCOMPLETE" : null,
  };
}
