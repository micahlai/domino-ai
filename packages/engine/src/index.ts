import type { Engine } from "@domino/contracts";
import { dominoes } from "./dominoes";
import { forecast } from "./forecast";
import { grade } from "./grade";
import { history, pastEvents } from "./history";
import { learn } from "./learn";
import { scanRisks } from "./risks";
import { scoreFix } from "./score-fix";
import { stressTest } from "./stress-test";

/** Engine-local ranking helper; not part of the shared Engine contract. */
export { type RankedFix, rankFixes } from "./score-fix";
/** Historical quarterly cash bridge; engine-local, not part of the Engine contract. */
export {
  QUARTER_BRIDGE_METHOD,
  type QuarterAlternative,
  type QuarterBridge,
  type QuarterBridgeInput,
  type RunInputs,
  compareRun,
  quarterAlternative,
  quarterBridge,
} from "./period";
/** One hypothetical quarterly outflow plus one costed response; engine-local, not in Engine. */
export {
  QUARTER_SCENARIO_METHOD,
  type QuarterScenarioArgs,
  quarterScenario,
} from "./period-scenario";

/** L1 supported SEC source normalization; engine-local, not part of the Engine contract. */
export {
  BRIDGE_ROLES,
  type CompanySnapshotResult,
  type DictionaryEntry,
  type MappedSource,
  type QuarterBridgeRoles,
  type QuarterRole,
  type ReadSecSource,
  type Result,
  SEC_CASH_DICTIONARY,
  SOURCE_NORMALIZER,
  type SecSource,
  type SecSourceInput,
  type SkippedSource,
  type SnapshotArgs,
  type UnmappedRecord,
  companySnapshot,
  mapSecRecords,
  readSecSource,
} from "./source-normalization";

export const engine: Engine = {
  forecast,
  dominoes,
  scanRisks,
  scoreFix,
  grade,
  learn,
  history,
  pastEvents,
  stressTest,
};
