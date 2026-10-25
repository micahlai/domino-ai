import type { AlternativeView, CashPoint, HistoricalEvidence, HistoricalView } from "./types";

// UI FIXTURE. "Example Co" is invented and every figure below is made up to exercise the layout.
// None of it is reported history for any real company. Evidence rows are labelled provenance
// samples, not citations. Live data replaces this through the pending backend adapter.

const evidence: HistoricalEvidence[] = [
  {
    id: "ev-reported",
    provenance: "reported",
    label: "Quarter-end balance (invented)",
    source: "Example Co quarterly report (invented for this preview)",
    publishedOn: "2024-02-08",
    locator: "Balance sheet, cash line",
    quote: "Cash and equivalents at period end (invented sentence).",
    note: "Stands in for a filed balance. Real values come from the evidence bundle.",
  },
  {
    id: "ev-projected",
    provenance: "derived",
    label: "Saved forecast point",
    source: "Forecast saved at the knowledge cutoff",
    publishedOn: "2024-03-15",
    note: "Computed by the backend from reported facts. It was not edited after the reveal.",
  },
  {
    id: "ev-observed",
    provenance: "reported",
    label: "Balance published after the forecast (invented)",
    source: "Example Co quarterly report (invented for this preview)",
    publishedOn: "2024-05-10",
    locator: "Balance sheet, cash line",
    note: "Stands in for the reported result. It is shown next to the forecast, never over it.",
  },
  {
    id: "ev-nowcast",
    provenance: "derived",
    label: "Cash estimate at the cutoff (modeled)",
    source: "Backend estimate from reported facts, saved at the knowledge cutoff",
    publishedOn: "2024-03-15",
    note: "A modeled estimate, not a reported balance. The forecast and every alternative start from it.",
  },
  {
    id: "ev-threshold",
    provenance: "assumption",
    label: "Warning threshold",
    source: "Analyst assumption, not a loan term",
    publishedOn: "2024-03-15",
    note: "A threshold chosen for this review. It is not a lender's limit.",
  },
  {
    id: "ev-alt",
    provenance: "assumption",
    label: "Alternative path",
    source: "Counterfactual assumption",
    publishedOn: "2024-05-10",
    note: "What the alternative costs and saves is assumed, not reported.",
  },
  {
    id: "ev-detail",
    provenance: "synthetic",
    label: "Operational detail",
    source: "Invented to fill the screen",
    publishedOn: "2024-03-15",
    note: "Synthetic detail is never shown as reported evidence.",
  },
];

const nowcast: CashPoint = {
  id: "n1",
  date: "2024-03-15",
  cash: 3_600_000_000,
  evidenceId: "ev-nowcast",
};

const reported: CashPoint[] = [
  { id: "r1", date: "2023-06-30", cash: 5_200_000_000, evidenceId: "ev-reported" },
  { id: "r2", date: "2023-09-30", cash: 4_700_000_000, evidenceId: "ev-reported" },
  { id: "r3", date: "2023-12-31", cash: 4_100_000_000, evidenceId: "ev-reported" },
];

const projected: CashPoint[] = [
  {
    id: "p1",
    date: "2024-03-31",
    cash: 3_400_000_000,
    low: 3_000_000_000,
    high: 3_800_000_000,
    evidenceId: "ev-projected",
  },
  {
    id: "p2",
    date: "2024-06-30",
    cash: 2_600_000_000,
    low: 1_900_000_000,
    high: 3_300_000_000,
    evidenceId: "ev-projected",
  },
  {
    id: "p3",
    date: "2024-09-30",
    cash: 1_900_000_000,
    low: 1_000_000_000,
    high: 2_800_000_000,
    evidenceId: "ev-projected",
  },
];

const observed: CashPoint[] = [
  { id: "o1", date: "2024-03-31", cash: 2_800_000_000, evidenceId: "ev-observed" },
];

const alternative: AlternativeView = {
  label: "Cut planned spending by one tenth (preview alternative)",
  postHoc: true,
  upfrontCost: 300_000_000,
  delayedBenefit: 900_000_000,
  benefitFrom: "2024-06-30",
  downside: 500_000_000,
  downsideNote: "If some customers leave because of the cuts.",
  assumptions: [
    { text: "The cut could have started within one quarter of the cutoff." },
    { text: "Cut spending turns into cash savings after one quarter." },
    { text: "One-time costs are paid in the first quarter." },
  ],
  path: [
    { id: "a1", date: "2024-03-31", cash: 3_100_000_000, evidenceId: "ev-alt" },
    { id: "a2", date: "2024-06-30", cash: 2_700_000_000, evidenceId: "ev-alt" },
    { id: "a3", date: "2024-09-30", cash: 3_000_000_000, evidenceId: "ev-alt" },
  ],
};

// First stage at which each evidence item may appear. Anything published after the knowledge
// cutoff is held back until its stage, so the sources sheet cannot leak it before the reveal.
const evidenceFrom: Record<string, HistoricalView["stage"]> = {
  "ev-observed": "observed",
  "ev-alt": "response",
};
const stageOrder: HistoricalView["stage"][] = ["baseline", "observed", "response"];

/** Mirrors production: later stages add data, and earlier stages never contain it. */
export function previewView(stage: HistoricalView["stage"]): HistoricalView {
  const revealed = stage !== "baseline";
  const visible = (item: HistoricalEvidence) =>
    stageOrder.indexOf(stage) >= stageOrder.indexOf(evidenceFrom[item.id] ?? "baseline");
  return {
    caseName: "Example Co (synthetic preview)",
    stage,
    dates: {
      knowledgeCutoff: "2024-03-15",
      lastReportedOn: "2023-12-31",
      projectedThrough: "2024-09-30",
      ...(revealed ? { revealedOn: "2024-05-10" } : {}),
    },
    reported,
    nowcast,
    projected,
    observed: revealed ? observed : [],
    comparison: revealed
      ? [
          {
            period: "2024-03-31",
            projected: 3_400_000_000,
            observed: 2_800_000_000,
            difference: -600_000_000,
            outcome: "miss",
            note: "Below the saved range.",
          },
          { period: "2024-06-30", projected: 2_600_000_000, outcome: "unscored" },
          { period: "2024-09-30", projected: 1_900_000_000, outcome: "unscored" },
        ]
      : [],
    ...(stage === "response" ? { alternative } : {}),
    threshold: { cents: 2_000_000_000, label: "Analyst threshold (assumption)" },
    evidence: evidence.filter(visible),
  };
}
