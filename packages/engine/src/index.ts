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
/** L2 source evidence reconciliation; engine-local, not part of the Engine contract. */
export {
  CASH_TERMS,
  type Candidate,
  type CashIdentity,
  type CashTerm,
  type ConflictResolution,
  type ExcludedCandidate,
  type KeyDifference,
  type KeyOutcome,
  type KeyReconciliation,
  type ReconcileArgs,
  type ReconciledValue,
  type Reconciliation,
  SOURCE_RECONCILER,
  cashIdentity,
  keyDifference,
  quarterFlow,
  reconcileSources,
  valueFor,
} from "./source-reconciliation";

/** L3 Candidate C, a retrospective experimental quarterly method; engine-local. */
export {
  type CandidateIneligible,
  type CandidateIneligibleReason,
  type DerivedQuarterFlow,
  type ExactBand,
  type LastQuarterFlow,
  QUARTER_CANDIDATE_METHOD,
  type QuarterCandidate,
  type QuarterCandidateInput,
  quarterCandidate,
} from "./period-candidate";
/** L3 scoped learned rules; engine-local, not part of the Engine contract. */
export {
  type FeedbackDecision,
  type MethodRef,
  type MethodSelection,
  QUARTER_METHOD_SLOT,
  QUARTER_METHODS,
  RULE_VALIDATOR,
  type Revocation,
  type RuleApplication,
  type RuleChange,
  type RuleChangeReceipt,
  type RuleResolution,
  type RuleUse,
  type RuleVersionRef,
  type RuledForecast,
  type RuledReconcileArgs,
  type RuledReconciliation,
  type SlotResolution,
  decideFeedback,
  quarterForecastWithRules,
  reconcileWithRules,
  resolveRules,
  revokeRuleVersion,
  rollbackRule,
  ruleSlot,
  selectQuarterMethod,
} from "./learned-rules";

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
