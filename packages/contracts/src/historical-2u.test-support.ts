import caseJson from "../../../data/historical/2u/case.json";
import protocol from "../../../data/historical/2u/protocol.json";
import {
  type HistoricalCase,
  HistoricalCaseSchema,
  type HistoricalComparison,
  type HistoricalRun,
  HistoricalRunSchema,
} from "./historical";
import type { HistoricalSpecialistRole } from "./historical-specialist";

/**
 * Test support, not exported from the package: real 2U specialist packets. The case is
 * data/historical/2u/case.json filtered by availability, as the server's visibleCase does.
 * Runs carry the audited protocol predictions, which packages/engine/src/period-2u.test.ts
 * checks equal the engine's quarter bridge. Comparisons follow the engine's compareRun.
 */
export const TWOU_CUTOFF = protocol.knowledgeCutoff;
/** After S8 publishes at 2024-02-12T16:01-05:00. */
export const TWOU_REVEAL = "2024-02-13T00:00:00-05:00";
const full: HistoricalCase = HistoricalCaseSchema.parse(caseJson);
const at = (t: string) => Date.parse(t);

export function twoUCase(through: string): HistoricalCase {
  return {
    ...full,
    sources: full.sources.filter((s) => at(s.publishedAt) <= at(through)),
    facts: full.facts.filter((f) => at(f.availableAt) <= at(through)),
  };
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function run(
  id: string,
  assumptionIds: string[],
  forecast: unknown[],
  branch: HistoricalRun["branch"],
): Promise<HistoricalRun> {
  const inputs = {
    sourceIds: protocol.inputs.sourceIds,
    factIds: protocol.inputs.factIds,
    assumptionIds,
  };
  return HistoricalRunSchema.parse({
    id,
    caseId: full.id,
    createdAt: "2026-10-24T12:00:00Z",
    knowledgeCutoff: TWOU_CUTOFF,
    originBalanceDate: protocol.originBalanceDate,
    inputs,
    inputHash: await sha256(inputs),
    method: protocol.method,
    predictions: [...protocol.nowcast, ...forecast],
    riskRules: protocol.riskRules,
    branch,
  });
}

export async function twoURuns(): Promise<{ baseline: HistoricalRun; response: HistoricalRun }> {
  const baseline = await run(
    "run-2u-baseline",
    protocol.inputs.baselineAssumptionIds,
    protocol.baselineForecast,
    { kind: "baseline" },
  );
  const response = await run(
    "run-2u-response",
    protocol.inputs.responseAssumptionIds,
    protocol.responseForecast,
    {
      kind: "alternative",
      baselineRunId: baseline.id,
      decisionAssumptionIds: protocol.response.decisionAssumptionIds,
      postHoc: protocol.response.postHoc,
    },
  );
  return { baseline, response };
}

/** Nowcasts have no observation; targets score against S8 H03 (total) and H01 (usable). */
export function twoUComparisons(r: HistoricalRun): HistoricalComparison[] {
  return r.predictions.map((p) => {
    const base = { id: `cmp-${r.id}-${p.id}`, runId: r.id, predictionId: p.id };
    if (p.kind === "nowcast")
      return { ...base, status: "unscored" as const, reason: "no_observation" as const };
    const f = full.facts.find(
      (x) => x.id === (p.metric === "cash_and_equivalents" ? "H01" : "H03"),
    );
    if (!f) throw new Error("2U observation fact missing");
    const errorCents = f.cents - p.cents;
    return {
      ...base,
      status: "scored" as const,
      observationFactId: f.id,
      predictedCents: p.cents,
      observedCents: f.cents,
      errorCents,
      absErrorCents: Math.abs(errorCents),
      ruleOutcomes: [],
    };
  });
}

/** Raw packet (not yet parsed). Analyst: baseline only. Reviewer: response plus its baseline. */
export async function twoUPacket(role: HistoricalSpecialistRole, phase: "cutoff" | "reveal") {
  const { baseline, response } = await twoURuns();
  const through = phase === "cutoff" ? TWOU_CUTOFF : TWOU_REVEAL;
  const runs = role === "evidence_analyst" ? [baseline] : [response, baseline];
  return {
    role,
    visibleThrough: through,
    question: "What does the latest disclosure show about cash?",
    history: [] as { speaker: "user" | "domino"; text: string }[],
    case: twoUCase(through),
    run: runs[0] as HistoricalRun,
    baseline: runs[1],
    comparisons: phase === "reveal" ? runs.flatMap(twoUComparisons) : [],
    excerpts: [] as { sourceId: string; text: string }[],
  };
}
