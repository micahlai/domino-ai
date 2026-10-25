import type { Change } from "@domino/contracts";
import type { WorkspaceRun } from "./api";
import { fixtureGraph, fixtureRoot, fixtureScenario } from "./fixtures";
import { familyEntries } from "./scenarioComparisons";

// Test/playground-only saved response: restore the collection after five weeks of the risk.
// Synthetic saved values demonstrate layout and entry motion, not an engine calculation.
const weeks = fixtureScenario.forecast.weeks.map((week, index) =>
  index < 5 ? week : fixtureRoot.forecast.weeks[index]!,
);
const low = weeks.reduce(
  (lowest, week) => (week.usable < lowest.usable ? week : lowest),
  weeks[0]!,
);
const forecast = { weeks, lowPoint: { weekStart: low.weekStart, usable: low.usable } };
const fix: Change = { kind: "delay_invoice", invoiceId: "inv_acme_2027", days: -30 };
export const fixtureOpenedResponse: WorkspaceRun = {
  ...fixtureScenario,
  runId: "timeline:run/opened-response-fixture",
  parentRunId: fixtureScenario.runId,
  label: "Collection timing restored (fixture)",
  ownChanges: [fix],
  changes: [...fixtureScenario.changes, fix],
  forecast,
  dominoes: [],
  receipts: [],
  comparison: {
    parentRunId: fixtureScenario.runId,
    weekly: forecast.weeks.map((week, index) => ({
      weekStart: week.weekStart,
      usableDelta: week.usable - fixtureScenario.forecast.weeks[index]!.usable,
    })),
    lowPointDelta: forecast.lowPoint.usable - fixtureScenario.forecast.lowPoint.usable,
  },
};
export const fixtureEntryGraph = familyEntries(fixtureOpenedResponse, {
  state: "ready",
  value: fixtureGraph,
});
