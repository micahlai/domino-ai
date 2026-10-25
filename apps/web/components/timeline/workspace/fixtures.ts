import {
  type Constraint,
  type ForecastWeek,
  type HistoryWeek,
  type OperationSummaryV1,
  WeeklySeedV1Schema,
} from "@domino/contracts";
import { weeklyBoundaryFixtures } from "@domino/contracts/fixtures";
import { NEUTRAL_MODEL, type SavedBaseline } from "../baseline/api";
import type { CatalogEntry, QuestionReceipt, WorkspaceRun } from "./api";

// Labelled fixtures for the playground and tests, in the wire shape. Any arithmetic here only
// builds test data; it is not engine output, and the UI never derives values like these.

const seed = WeeklySeedV1Schema.parse(weeklyBoundaryFixtures.validKestrelWeeklySeed);
const DAY = 86_400_000;
const monday = (start: string, i: number) =>
  new Date(Date.parse(`${start}T00:00:00Z`) + i * 7 * DAY).toISOString().slice(0, 10);

const HISTORY: HistoryWeek[] = Array.from({ length: 26 }, (_, i) => {
  const usable = 380_000_000 + ((i * 7_919_300) % 41_000_000) - i * 600_000;
  return { weekStart: monday("2026-05-04", i), closing: usable + 60_000_000, usable };
});

const BASE_USABLE = [
  327_800_000, 330_100_000, 333_200_000, 336_400_000, 340_900_000, 338_300_000, 335_700_000,
  333_100_000, 330_500_000, 327_900_000, 325_300_000, 322_700_000, 329_200_000,
];

function forecastFrom(usable: number[]) {
  const weeks: ForecastWeek[] = usable.map((u, i) => ({
    weekStart: monday(seed.asOf, i),
    opening: u + 1_500_000,
    inflow: 4_000_000,
    outflow: 5_500_000,
    closing: u + 60_000_000,
    usable: u,
  }));
  let low = weeks[0] as ForecastWeek;
  for (const w of weeks) if (w.usable < low.usable) low = w;
  return { weeks, lowPoint: { weekStart: low.weekStart, usable: low.usable } };
}

const baseForecast = forecastFrom(BASE_USABLE);
const lateUsable = BASE_USABLE.map((u, i) => (i >= 3 && i < 7 ? u - 24_000_000 : u));
const lateForecast = forecastFrom(lateUsable);

export const fixtureBaseline: SavedBaseline = {
  runId: "timeline:baseline/kestrel-fixture",
  companyId: seed.company.id,
  companyName: seed.company.name,
  seedHash: seed.contentHash,
  inputHash: "a".repeat(64),
  methodVersion: "timeline-baseline-v1",
  assumptionNote: "Fixture: neutral starting model.",
  model: NEUTRAL_MODEL,
  constraints: [],
  seed,
  forecast: baseForecast,
  dominoes: [],
  history: HISTORY,
  pastEvents: [],
  savedAt: "2026-10-24T15:00:00.000Z",
};

function operation(name: string, at: string): OperationSummaryV1 {
  return {
    schemaVersion: 1,
    id: `timeline:operation/${name}`,
    ownerDomain: "timeline",
    status: "succeeded",
    title: "Saved Timeline scenario (fixture)",
    dependencies: [],
    evidenceRefs: [],
    outputRefs: [],
    createdAt: at,
    startedAt: at,
    finishedAt: at,
    updatedAt: at,
  };
}

export const fixtureRule: Constraint = {
  id: "rule_min_cash_1",
  label: "Lender's limit",
  kind: "min_cash",
  limit: 315_000_000,
  evidence: {
    source: "document",
    ref: "timeline:workspace/person-entered-rule",
    note: "Fixture rule.",
  },
};

const COMPANY = seed.company.id;
const ROOT = "timeline:run/kestrel-root";
const RULES = "timeline:run/kestrel-rules";
const LATE = "timeline:run/kestrel-acme-late";

const shared = {
  companyId: COMPANY,
  baselineRunId: fixtureBaseline.runId,
  inputHash: "b".repeat(64),
  methodVersion: "timeline-workspace-v1",
  baseline: fixtureBaseline,
};

export const fixtureRoot: WorkspaceRun = {
  ...shared,
  runId: ROOT,
  parentRunId: null,
  kind: "baseline",
  label: "Imported baseline",
  savedAt: "2026-10-24T15:01:00.000Z",
  constraintVersion: "rules-0",
  constraintNote: "",
  constraints: [],
  ownChanges: [],
  changes: [],
  forecast: baseForecast,
  dominoes: [],
  receipts: [],
  comparison: null,
  operation: operation("open-root", "2026-10-24T15:01:00.000Z"),
};

export const fixtureRules: WorkspaceRun = {
  ...fixtureRoot,
  runId: RULES,
  parentRunId: ROOT,
  kind: "rules",
  label: "Lender's limit added",
  savedAt: "2026-10-24T15:02:00.000Z",
  constraintVersion: "rules-1",
  constraintNote: "Loan agreement section 7.2.",
  constraints: [fixtureRule],
  receipts: [
    {
      constraintId: fixtureRule.id,
      constraintVersion: "rules-1",
      label: fixtureRule.label,
      kind: "min_cash",
      status: "clear",
      relation: "clear",
      limit: fixtureRule.limit,
      unit: "cents",
      value: baseForecast.lowPoint.usable,
      shortfall: null,
      date: null,
      weekStart: baseForecast.lowPoint.weekStart,
      actionLabels: [],
      evidence: ["Lowest usable cash in the forecast is above the limit every Sunday."],
    },
  ],
  comparison: {
    parentRunId: ROOT,
    weekly: baseForecast.weeks.map((w) => ({ weekStart: w.weekStart, usableDelta: 0 })),
    lowPointDelta: 0,
  },
  operation: operation("rules-1", "2026-10-24T15:02:00.000Z"),
};

const acmeLate = { kind: "delay_invoice" as const, invoiceId: "inv_acme_2027", days: 30 };

export const fixtureScenario: WorkspaceRun = {
  ...fixtureRules,
  runId: LATE,
  parentRunId: RULES,
  kind: "scenario",
  label: "Acme pays 30 days late",
  savedAt: "2026-10-24T15:03:00.000Z",
  ownChanges: [acmeLate],
  changes: [acmeLate],
  forecast: lateForecast,
  dominoes: [
    {
      order: 1,
      weekStart: lateForecast.lowPoint.weekStart,
      label: "Usable cash falls below the lender's limit",
      constraintId: fixtureRule.id,
      evidence: [{ source: "stripe", ref: "inv_acme_2027", note: "Acme's invoice arrives later." }],
    },
  ],
  receipts: [
    {
      constraintId: fixtureRule.id,
      constraintVersion: "rules-1",
      label: fixtureRule.label,
      kind: "min_cash",
      status: "breached",
      relation: "new",
      limit: fixtureRule.limit,
      unit: "cents",
      value: lateForecast.lowPoint.usable,
      shortfall: fixtureRule.limit - lateForecast.lowPoint.usable,
      date: "2026-12-20",
      weekStart: lateForecast.lowPoint.weekStart,
      actionLabels: ["Acme pays 30 days late"],
      evidence: ["Evaluated on Sunday 2026-12-20 against usable cash after the week closes."],
    },
  ],
  comparison: {
    parentRunId: RULES,
    weekly: lateForecast.weeks.map((w, i) => ({
      weekStart: w.weekStart,
      usableDelta: (lateUsable[i] ?? 0) - (BASE_USABLE[i] ?? 0),
    })),
    lowPointDelta: lateForecast.lowPoint.usable - baseForecast.lowPoint.usable,
  },
  operation: operation("acme-late", "2026-10-24T15:03:00.000Z"),
};

const entry = (r: WorkspaceRun): CatalogEntry => ({
  runId: r.runId,
  companyId: r.companyId,
  baselineRunId: r.baselineRunId,
  parentRunId: r.parentRunId,
  kind: r.kind,
  label: r.label,
  savedAt: r.savedAt,
  lowPointCents: r.forecast.lowPoint.usable,
  lowPointWeek: r.forecast.lowPoint.weekStart,
  constraintVersion: r.constraintVersion,
});

export const fixtureGraph: CatalogEntry[] = [fixtureRoot, fixtureRules, fixtureScenario].map(entry);
export const fixtureRuns = { [ROOT]: fixtureRoot, [RULES]: fixtureRules, [LATE]: fixtureScenario };

function question(
  id: string,
  status: QuestionReceipt["status"],
  over: Partial<QuestionReceipt>,
): QuestionReceipt {
  const at = "2026-10-24T15:04:00.000Z";
  return {
    id,
    companyId: COMPANY,
    runId: RULES,
    requestId: `req-${id}`,
    prompt: "",
    selectedWeek: null,
    selectedItemId: null,
    status,
    answer: "",
    citations: [],
    proposal: null,
    errorCode: null,
    linkedRunId: null,
    savedAt: at,
    operation: { ...operation(`question-${id}`, at), title: "Question (fixture)" },
    ...over,
  };
}

export const fixtureQuestions: QuestionReceipt[] = [
  question("q1", "answered", {
    prompt: "When is cash lowest?",
    answer: "The saved forecast is lowest in the week of Jan 18, 2027.",
    citations: [{ ref: "forecast.lowPoint", label: "Saved low point" }],
  }),
  question("q2", "proposal", {
    prompt: "What if Acme pays 30 days late?",
    selectedItemId: "sched_inv_acme_2027",
    answer: "This would delay invoice inv_acme_2027 by 30 days.",
    citations: [{ ref: "inv_acme_2027", label: "Acme Logistics invoice" }],
    proposal: {
      label: "Acme pays 30 days late",
      changes: [acmeLate],
      constraints: null,
      constraintNote: null,
    },
  }),
  question("q3", "clarification", {
    prompt: "What if a customer pays late?",
    answer: "Which customer, and how many days late?",
  }),
  question("q4", "failed", { prompt: "Keep a daily cash floor", errorCode: "no_provider" }),
  question("q5", "running", { prompt: "What if we hire two engineers?" }),
];
