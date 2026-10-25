import { WorkerChatContextSchema } from "../../../lib/worker-chat-context";
import { fixtureRoot, fixtureScenario } from "../workspace/fixtures";

/** Labelled visual evidence; no engine or provider runs in the playground. */
export const fixtureWorkerContext = WorkerChatContextSchema.parse({
  fieldCompanyId: "worker-fixture-company",
  runId: "worker-fixture-run",
  snapshotId: "worker-fixture-snapshot",
  snapshotVersion: 1,
  scenarioRunId: fixtureScenario.runId,
  fixRunId: "timeline:worker-fixture-fix",
  note: "Compare the collection timing before deciding.",
  scenario: {
    id: "worker-fixture-risk",
    index: 0,
    agentId: "fixture-advisor",
    title: "A customer pays late",
    basis: "Illustrative saved Worker scenario.",
    changes: fixtureScenario.ownChanges,
    status: "done",
    work: null,
    fixes: [],
    error: null,
  },
  candidate: {
    suggestionId: "worker-fixture-suggestion",
    scenarioId: "worker-fixture-risk",
    scenarioTitle: "A customer pays late",
    agentId: "fixture-advisor",
    fix: {
      id: "fixture-fix",
      kind: "credit_line_draw",
      label: "Draw on the sample credit line",
      costNote:
        "Illustrative credit line; lender terms and fees must be checked before any real action.",
      risk: "medium",
      changes: [
        { kind: "add_cash", amount: 24_000_000, date: "2026-11-23", label: "Sample credit line" },
      ],
    },
    effect: {
      lowPoint: 322_700_000,
      lowWeekStart: "2027-01-18",
      survives: true,
      gain: 24_000_000,
      scenarioLow: 298_700_000,
      lenderMinimum: 315_000_000,
    },
    rank: 1,
    recommended: false,
    recommendation: null,
  },
  inputs: {
    company: {
      id: "worker-fixture-company",
      name: "Kestrel (fixture)",
      profile: "kestrel",
      datasetId: "kestrel",
      datasetScenario: null,
      datasetVersion: null,
    },
    snapshot: {
      id: "worker-fixture-snapshot",
      version: 1,
      asOf: fixtureRoot.baseline.seed.snapshot.asOf,
      companyId: fixtureRoot.companyId,
      cashOnHand: fixtureRoot.baseline.seed.snapshot.cashOnHand,
      restrictedCash: fixtureRoot.baseline.seed.snapshot.restrictedCash,
      recordCounts: {},
    },
    model: {
      id: "fixture-model",
      version: fixtureRoot.baseline.model.version,
      data: fixtureRoot.baseline.model,
    },
    constraints: fixtureRoot.constraints,
    sources: [],
    connections: [],
    provenance: null,
  },
});
