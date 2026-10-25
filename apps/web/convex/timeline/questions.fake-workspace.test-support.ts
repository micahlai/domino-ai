import type { Change, CompanyModel, Constraint, WeeklySeedV1 } from "@domino/contracts";
import { weeklyBoundaryFixtures as wfx } from "@domino/contracts/fixtures";
import { engine } from "@domino/engine";
import { queryGeneric } from "convex/server";
import { v } from "convex/values";
import type { WorkspaceRun } from "./questions/context";

// Test stand-in for timeline/workspace:get (TL2B owns the real one). Two dots in the file
// name keep the Convex bundler from deploying it. Runs are built with the real engine from
// the pinned Kestrel seed, so answers are checked against actual saved outputs.

const NEUTRAL: CompanyModel = { version: 0, customerDelayDays: {}, recurringSpend: [], rules: [] };
export const kestrelSeed = wfx.validKestrelWeeklySeed as WeeklySeedV1;
export const MIN_CASH: Constraint = {
  id: "user_min_cash",
  label: "Keep usable cash above $3.5M",
  kind: "min_cash",
  limit: 350_000_000,
  evidence: { source: "document", ref: "timeline:assumption", note: "Stated by the user" },
};

function baselineOf(seed: WeeklySeedV1, constraints: Constraint[]) {
  const forecast = engine.forecast(seed.snapshot, NEUTRAL, []);
  return {
    runId: `timeline:baseline/${seed.company.id}-base`,
    companyId: seed.company.id,
    companyName: seed.company.name,
    seedHash: seed.contentHash,
    inputHash: "a".repeat(64),
    methodVersion: "timeline_weekly_baseline@1.0.0",
    assumptionNote: "Neutral model.",
    model: NEUTRAL,
    constraints,
    seed,
    forecast,
    dominoes: engine.dominoes(forecast, constraints, seed.snapshot, {
      model: NEUTRAL,
      changes: [],
    }),
    history: engine.history(seed.snapshot, 26),
    pastEvents: engine.pastEvents(seed.snapshot, NEUTRAL),
    savedAt: "2026-10-24T12:00:00.000Z",
  };
}

export function makeRun(opts: {
  seed?: WeeklySeedV1;
  runId: string;
  parentRunId?: string | null;
  kind?: WorkspaceRun["kind"];
  constraints?: Constraint[];
  ownChanges?: Change[];
  changes?: Change[];
}): WorkspaceRun {
  const seed = opts.seed ?? kestrelSeed;
  const constraints = opts.constraints ?? [MIN_CASH];
  const changes = opts.changes ?? opts.ownChanges ?? [];
  const baseline = baselineOf(seed, [MIN_CASH]);
  const forecast = engine.forecast(seed.snapshot, NEUTRAL, changes);
  const low = forecast.lowPoint;
  return {
    runId: opts.runId,
    companyId: seed.company.id,
    baselineRunId: baseline.runId,
    parentRunId: opts.parentRunId ?? null,
    kind: opts.kind ?? "baseline",
    label: opts.runId,
    savedAt: "2026-10-24T12:00:00.000Z",
    inputHash: `hash-${opts.runId}`,
    methodVersion: "timeline_workspace@1",
    constraintVersion: "c1",
    constraintNote: "",
    constraints,
    ownChanges: opts.ownChanges ?? [],
    changes,
    forecast,
    dominoes: engine.dominoes(forecast, constraints, seed.snapshot, { model: NEUTRAL, changes }),
    receipts: constraints
      .filter((c) => c.kind === "min_cash")
      .map((c) => ({
        constraintId: c.id,
        constraintVersion: "c1",
        label: c.label,
        kind: "min_cash" as const,
        status: low.usable < c.limit ? ("breached" as const) : ("clear" as const),
        relation: low.usable < c.limit ? ("pre_existing" as const) : ("clear" as const),
        limit: c.limit,
        unit: "cents" as const,
        // Saved engine-side values in the real workspace; the fixture copies the low point.
        value: low.usable,
        shortfall: low.usable < c.limit ? c.limit - low.usable : null,
        date: low.weekStart,
        weekStart: low.weekStart,
        actionLabels: [],
        evidence: [],
      })),
    comparison: null,
    baseline,
    operation: {
      schemaVersion: 1,
      id: "timeline:operation/run-fixture",
      ownerDomain: "timeline",
      status: "succeeded",
      title: "Save a timeline run",
      dependencies: [],
      evidenceRefs: [],
      outputRefs: [],
      createdAt: "2026-10-24T12:00:00Z",
      startedAt: "2026-10-24T12:00:00Z",
      finishedAt: "2026-10-24T12:00:01Z",
      updatedAt: "2026-10-24T12:00:01Z",
    },
  };
}

/** Runs the fake workspace serves, keyed by company and run id. Tests add to it. */
export const fakeRuns = new Map<string, unknown>();
export const putRun = (
  run: WorkspaceRun | (Record<string, unknown> & { companyId: string; runId: string }),
) => fakeRuns.set(`${run.companyId}|${run.runId}`, run);

export const get = queryGeneric({
  args: { companyId: v.string(), runId: v.string() },
  handler: async (_ctx, args) => fakeRuns.get(`${args.companyId}|${args.runId}`) ?? null,
});
