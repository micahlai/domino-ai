import type { Prediction } from "./prediction";

// Playground and test states for PredictionView. Fixture only: nothing here ran.
const base = {
  predictionId: "timeline:prediction/fixture",
  runId: "fixture",
  activity: [],
  summary: null,
  effects: [],
  rejected: [],
  interest: null,
  resultRunId: null,
  warnings: [],
  error: null,
  createdAt: "2026-10-25T12:00:00.000Z",
} satisfies Omit<Prediction, "status" | "progress" | "stage">;

export const runningPrediction: Prediction = {
  ...base,
  status: "running",
  progress: 46,
  stage: "Asking the agents for knock-on effects",
  activity: [
    {
      at: "2026-10-25T12:00:04.000Z",
      text: "Loaded the brain map: flags, research, learned payment habits",
    },
    { at: "2026-10-25T12:00:19.000Z", text: "Read the brain map: research" },
  ],
};

export const donePrediction: Prediction = {
  ...base,
  status: "done",
  progress: 100,
  stage: "Done",
  summary:
    "Paying for the equipment leaves less cash on hand, so the business gives up interest every week. Northwind has paid late after past price changes and is likely to stretch its next invoice.",
  effects: [
    {
      title: "Northwind pays its December invoice three weeks late",
      reason: "Learned payment habit: Northwind paid 18-25 days late after its last two shocks.",
      likelihood: "likely",
      evidence: ["Brain map: learned payment delays", "Invoice inv_1042"],
      change: { kind: "delay_invoice", invoiceId: "inv_1042", days: 21 },
    },
  ],
  rejected: [{ title: "Acme leaves", reason: "No customer cust_acme in these books" }],
  interest: { annualBps: 450, weeks: 9, netCents: -6_820_000 },
  response: {
    source: "agents",
    respondFrom: "event",
    growthSpend: ["Campaign services"],
    spendCutPercent: 25,
    likelihood: "likely",
    reason: "A known one-time loss this size leads management to trim campaigns within weeks.",
    evidence: ["Ask Domino conversation: equipment failed an audit"],
    trigger: { date: "2026-11-10", usable: null },
    notes: [
      "Cut Campaign services by 25% from 2026-11-24",
      "Recurring billing 7.5% lower from 2027-01-19 after the cut",
    ],
    applied: true,
    skipped: null,
  },
  context: [
    { label: "Buy equipment", relation: "this scenario", sources: ["Ask Domino conversation"] },
  ],
  resultRunId: "fixture-predicted",
};
