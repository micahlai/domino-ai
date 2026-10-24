/**
 * SYNTHETIC VALIDATION FIXTURE. Invented company, URLs, hashes and figures shaped like
 * one quarterly reveal. Not evidence about any real company; years are deliberately
 * fictional. Real case data comes from the reviewed H1 evidence bundle.
 */
import type {
  ActivityEvent,
  HistoricalCase,
  HistoricalComparison,
  HistoricalRun,
} from "../historical";

const hash = (c: string): string => c.repeat(64);
const M = (millions: number): number => millions * 100_000_000;

const q3Published = "2031-11-09T16:45:46-05:00";
const fyPublished = "2032-02-12T16:05:00-05:00";
export const cutoff = "2031-11-10T23:59:59-05:00";

export const historicalCase: HistoricalCase = {
  id: "case_fixture",
  companyName: "Fixture Learning Co (synthetic)",
  provenance: "synthetic_fixture",
  currency: "USD",
  sources: [
    {
      id: "src_q3",
      title: "Synthetic Q3 quarterly report",
      url: "https://example.com/fixture/q3",
      accession: "0000000000-31-000001",
      publishedAt: q3Published,
      timezone: "America/New_York",
      period: { kind: "duration", start: "2031-07-01", end: "2031-09-30" },
      retrievedOn: "2032-03-01",
      contentHash: hash("a"),
    },
    {
      id: "src_fy",
      title: "Synthetic annual results release",
      url: "https://example.com/fixture/fy",
      publishedAt: fyPublished,
      timezone: "America/New_York",
      period: { kind: "duration", start: "2031-01-01", end: "2031-12-31" },
      retrievedOn: "2032-03-01",
      contentHash: hash("b"),
    },
  ],
  facts: [
    {
      id: "f_cash_q3",
      kind: "reported",
      metric: "cash_and_equivalents",
      period: { kind: "instant", date: "2031-09-30" },
      currency: "USD",
      cents: M(70),
      availableAt: q3Published,
      sourceId: "src_q3",
      locator: "Balance sheet, cash and cash equivalents",
      reportedScale: "thousands",
    },
    {
      id: "f_restricted_q3",
      kind: "reported",
      metric: "restricted_cash",
      period: { kind: "instant", date: "2031-09-30" },
      currency: "USD",
      cents: M(5),
      availableAt: q3Published,
      sourceId: "src_q3",
      locator: "Cash reconciliation note",
      reportedScale: "thousands",
    },
    {
      id: "f_total_q3",
      kind: "derived",
      metric: "cash_including_restricted",
      period: { kind: "instant", date: "2031-09-30" },
      currency: "USD",
      cents: M(75),
      availableAt: q3Published,
      derivedFrom: ["f_cash_q3", "f_restricted_q3"],
      derivation: "cash and equivalents plus restricted cash",
    },
    {
      id: "f_cash_fy",
      kind: "reported",
      metric: "cash_and_equivalents",
      period: { kind: "instant", date: "2031-12-31" },
      currency: "USD",
      cents: M(52),
      availableAt: fyPublished,
      sourceId: "src_fy",
      locator: "Balance sheet, cash and cash equivalents",
      reportedScale: "thousands",
    },
  ],
  assumptions: [
    {
      id: "a_cut",
      label: "counterfactual",
      description: "Reduce operating spend from the cutoff, after a hiring freeze lag",
      basisFactIds: ["f_cash_q3"],
      value: { unit: "cents", low: M(2), high: M(6) },
      effectiveFrom: "2031-11-11",
      oneTimeCost: { unit: "cents", low: M(1), high: M(2) },
      benefitLagDays: 30,
      dependsOn: [],
      feasibleAtCutoff: "yes",
      selectedAfterReveal: false,
    },
  ],
};

const nowcast = {
  id: "p_nowcast",
  kind: "nowcast",
  metric: "cash_and_equivalents",
  period: { kind: "instant", date: "2031-11-10" },
  currency: "USD",
  cents: M(64),
} as const;

export const baselineRun: HistoricalRun = {
  id: "run_base",
  caseId: "case_fixture",
  createdAt: "2026-10-24T09:00:00Z",
  knowledgeCutoff: cutoff,
  originBalanceDate: "2031-09-30",
  inputs: {
    sourceIds: ["src_q3"],
    factIds: ["f_cash_q3", "f_restricted_q3", "f_total_q3"],
    assumptionIds: [],
  },
  inputHash: hash("c"),
  method: { id: "quarterly_cash_bridge", version: "0.1.0" },
  predictions: [
    nowcast,
    {
      id: "p_q4",
      kind: "forecast",
      metric: "cash_and_equivalents",
      period: { kind: "instant", date: "2031-12-31" },
      currency: "USD",
      cents: M(48),
      range: { low: M(40), high: M(55) },
    },
  ],
  riskRules: [
    {
      id: "r_min",
      metric: "cash_and_equivalents",
      breachWhen: "below",
      thresholdCents: M(50),
      basis: "analyst",
      sourceIds: [],
    },
  ],
  branch: { kind: "baseline" },
};

export const alternativeRun: HistoricalRun = {
  ...baselineRun,
  id: "run_alt",
  inputs: { ...baselineRun.inputs, assumptionIds: ["a_cut"] },
  inputHash: hash("d"),
  predictions: [nowcast, { ...baselineRun.predictions[1]!, id: "p_q4_alt", cents: M(51) }],
  branch: {
    kind: "alternative",
    baselineRunId: "run_base",
    decisionAssumptionIds: ["a_cut"],
    postHoc: false,
  },
};

export const revealedThrough = "2032-02-12T23:59:59-05:00";

export const comparison: HistoricalComparison = {
  id: "cmp_q4",
  runId: "run_base",
  predictionId: "p_q4",
  status: "scored",
  observationFactId: "f_cash_fy",
  predictedCents: M(48),
  observedCents: M(52),
  errorCents: M(4),
  absErrorCents: M(4),
  ruleOutcomes: [{ ruleId: "r_min", predictedBreach: true, observedBreach: false }],
};

export const activity: ActivityEvent[] = [
  {
    id: "evt_run_base",
    sequence: 1,
    occurredAt: "2026-10-24T09:00:01Z",
    caseId: "case_fixture",
    runId: "run_base",
    kind: "run_saved",
    status: "succeeded",
    entity: { kind: "run", id: "run_base" },
    label: "Baseline forecast saved",
    evidenceIds: ["src_q3"],
  },
];
