import { ConvexError } from "convex/values";
import { z } from "zod";
import type { CatalogEntry, WorkspaceRun } from "../workspace";
import {
  CentsSchema,
  CompanyIdSchema,
  FinancialOutputSchema,
  MAX_OUTPUT_BYTES,
  MondaySchema,
  ReceiptsSchema,
  RunIdSchema,
  SafeForecastSchema,
  exact,
  healthFor,
  jsonBytes,
  routeFor,
} from "./schema";

const METHOD = "timeline_financial_output@1.0.0" as const;
function fail(): never {
  throw new ConvexError({
    code: "INTEGRITY",
    message: "Saved financial output failed its scope or value checks",
  });
}
const CatalogSchema = exact(
  z
    .object({
      runId: RunIdSchema,
      companyId: CompanyIdSchema,
      baselineRunId: z.string(),
      parentRunId: RunIdSchema.nullable(),
      kind: z.enum(["baseline", "rules", "scenario"]),
      label: z.string().min(1).max(200),
      savedAt: z.string().datetime(),
      lowPointCents: CentsSchema,
      lowPointWeek: MondaySchema,
      constraintVersion: z.string().min(1).max(128),
      startsOn: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable(),
    })
    .strict(),
);

function validateRun(run: WorkspaceRun, key: { companyId: string; runId: string }) {
  const receipts = ReceiptsSchema.safeParse(run.receipts);
  const forecast = SafeForecastSchema.safeParse(run.forecast);
  if (
    run.companyId !== key.companyId ||
    run.runId !== key.runId ||
    run.baseline.companyId !== key.companyId ||
    run.baseline.runId !== run.baselineRunId ||
    run.baseline.seed.company.id !== key.companyId ||
    run.baseline.seed.snapshot.companyId !== key.companyId ||
    run.baseline.seed.contentHash !== run.baseline.seedHash ||
    run.forecast.weeks[0]?.weekStart !== run.baseline.seed.asOf ||
    !receipts.success ||
    !forecast.success
  )
    fail();
  const ids = new Set(run.constraints.map((rule) => rule.id));
  if (ids.size !== run.constraints.length || receipts.data.length !== ids.size) fail();
  const seen = new Set<string>();
  for (const receipt of receipts.data) {
    const rule = run.constraints.find((rule) => rule.id === receipt.constraintId);
    if (
      !rule ||
      seen.has(receipt.constraintId) ||
      receipt.kind !== rule.kind ||
      receipt.label !== rule.label ||
      receipt.limit !== rule.limit
    )
      fail();
    seen.add(receipt.constraintId);
  }
  return receipts.data;
}

/** Projection only: loads a bounded set of saved direct scenarios, never calculates a forecast. */
export async function projectOutput(
  run: WorkspaceRun,
  rawGraph: CatalogEntry[],
  key: { companyId: string; runId: string },
  loadChild: (runId: string) => Promise<WorkspaceRun | null>,
) {
  const receipts = validateRun(run, key);
  const graph = z.array(CatalogSchema).max(100).safeParse(rawGraph);
  if (!graph.success) fail();
  const graphIds = new Set<string>();
  for (const entry of graph.data) {
    if (
      entry.companyId !== key.companyId ||
      entry.baselineRunId !== run.baselineRunId ||
      graphIds.has(entry.runId)
    )
      fail();
    graphIds.add(entry.runId);
  }
  const direct = graph.data.filter(
    (entry) => entry.parentRunId === key.runId && entry.kind === "scenario",
  );
  const scenarios = [];
  for (const entry of direct.slice(0, 20)) {
    const child = await loadChild(entry.runId);
    if (!child) fail();
    validateRun(child, { companyId: key.companyId, runId: entry.runId });
    if (
      child.parentRunId !== run.runId ||
      child.kind !== "scenario" ||
      child.baselineRunId !== run.baselineRunId ||
      child.baseline.seedHash !== run.baseline.seedHash ||
      child.baseline.seed.id !== run.baseline.seed.id ||
      child.label !== entry.label ||
      child.savedAt !== entry.savedAt ||
      child.constraintVersion !== entry.constraintVersion ||
      child.forecast.lowPoint.usable !== entry.lowPointCents ||
      child.forecast.lowPoint.weekStart !== entry.lowPointWeek
    )
      fail();
    scenarios.push({
      runId: child.runId,
      label: child.label,
      forecast: child.forecast,
      lowPoint: child.forecast.lowPoint,
      receipts: child.receipts,
      route: routeFor(key.companyId, child.runId),
    });
  }
  const health = healthFor(run.forecast, receipts);
  const raw = {
    schemaVersion: 1,
    methodVersion: METHOD,
    ...key,
    baselineRunId: run.baselineRunId,
    seedId: run.baseline.seed.id,
    seedHash: run.baseline.seedHash,
    inputHash: run.inputHash,
    constraintVersion: run.constraintVersion,
    savedAt: run.savedAt,
    resultRef: {
      seedId: run.baseline.seed.id,
      seedHash: run.baseline.seedHash,
      kind: run.kind === "baseline" ? "forecast" : "scenario",
      branchIds: [run.runId],
      route: routeFor(key.companyId, run.runId),
      health: {
        rating: health.rating,
        lowPointCents: run.forecast.lowPoint.usable,
        lowPointWeek: run.forecast.lowPoint.weekStart,
      },
    },
    health,
    receipts,
    chart: {
      history: run.baseline.history,
      forecast: run.forecast,
      lowPoint: run.forecast.lowPoint,
      runwayMonths: null,
    },
    scenarios,
    scenariosTruncated: direct.length > 20 || graph.data.length === 100,
  };
  const selectedBytes = jsonBytes({ ...raw, scenarios: [] });
  if (selectedBytes > MAX_OUTPUT_BYTES)
    throw new ConvexError({
      code: "OUTPUT_TOO_LARGE",
      message: "The selected saved financial output exceeds the 900,000-byte export limit",
    });
  if (jsonBytes(raw) > MAX_OUTPUT_BYTES) {
    const prefix: typeof scenarios = [];
    // true is one byte shorter than false; reserving the original header is conservative.
    let bytes = selectedBytes;
    for (const child of scenarios) {
      const added = jsonBytes(child) + (prefix.length > 0 ? 1 : 0);
      if (bytes + added > MAX_OUTPUT_BYTES) break;
      prefix.push(child);
      bytes += added;
    }
    raw.scenarios = prefix;
    raw.scenariosTruncated = true;
  }
  const result = FinancialOutputSchema.safeParse(raw);
  if (!result.success) fail();
  // Canonical equality is asserted by the schema, including legacy nested financial shapes.
  return result.data;
}
