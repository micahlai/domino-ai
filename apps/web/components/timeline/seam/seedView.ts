import type { TimelineSeedV1 } from "@domino/contracts";
import { CaseDataSchema, buildView } from "../../historical/live";
import type { HistoricalView } from "../../historical/types";

// Timeline-owned adapter: a VERIFIED TimelineSeedV1 -> the existing legacy CaseData shape ->
// the existing buildView/HistoricalReplay consumers, unchanged. Pre-forecast stage only: the
// seed carries no saved run, so nothing is projected and no figure is computed here. Every
// cash value shown is a seed fact's integer cents, passed through by buildView.

export const PEER_FIXTURE_DISCLOSURE =
  "PEER FIXTURE: this seed is a P0-C public fixture standing in for a Field export. It is not output of the Field backend and not a saved Timeline run.";

export function seedView(seed: TimelineSeedV1): HistoricalView {
  const caseData = CaseDataSchema.parse({
    case: seed.snapshot.case,
    knowledgeCutoff: seed.quarterBridge.knowledgeCutoff,
    originBalanceDate: seed.quarterBridge.originBalanceDate,
    visibleThrough: seed.quarterBridge.knowledgeCutoff,
    revealed: false,
    disclosure: PEER_FIXTURE_DISCLOSURE,
    method: seed.pins.method,
    projectionAssumptions: [],
    riskRulesNote: "Seam harness: no forecast is saved, so no risk rule is applied.",
  });
  return { ...buildView({ caseData }), caseName: `${seed.company.name} (peer fixture seed)` };
}
