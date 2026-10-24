import type {
  Branch,
  Change,
  Domino,
  DominoContext,
  FixCandidate,
  FixScoreContext,
  Forecast,
  HistoryWeek,
  PastEvent,
  ResilienceReport,
  RiskEvent,
} from "./branches";
import type {
  BankTxn,
  CompanyModel,
  Constraint,
  Evidence,
  ISODate,
  Snapshot,
  SourceKind,
} from "./core";
import type { AnswerKey, CompanyProfile, FieldMapping, WorldState } from "./sim";

/**
 * Module interfaces. Each module implements one of these.
 * Modules call each other only through these functions.
 */

/** packages/sim. Pure and seeded. */
export interface Simulator {
  createCompany(profile: CompanyProfile, seed: number): WorldState;
  advanceWeek(world: WorldState, injected: Change[]): WorldState;
  /** Only packages/sim/eval may call this. */
  answerKey(world: WorldState): AnswerKey;
}

/** apps/web/convex/connectors. One per source. */
export interface Connector {
  source: SourceKind;
  pull(since: ISODate): Promise<Partial<Snapshot>>;
}

/** packages/engine. Pure functions: no AI, no network, no clock, no randomness. */
export interface Engine {
  forecast(snapshot: Snapshot, model: CompanyModel, changes: Change[]): Forecast;
  /** Without context, only directly supported weekly min_cash rules may be evaluated. */
  dominoes(
    forecast: Forecast,
    constraints: Constraint[],
    snapshot: Snapshot,
    context?: DominoContext,
  ): Domino[];
  scanRisks(snapshot: Snapshot, model: CompanyModel, constraints: Constraint[]): RiskEvent[];
  /** Builds a relative fix branch. Non-root parents require explicit ancestor context. */
  scoreFix(
    parent: Branch,
    fix: FixCandidate,
    snapshot: Snapshot,
    model: CompanyModel,
    constraints: Constraint[],
    context?: FixScoreContext,
  ): Branch;
  /** Compares last week's forecast with what the bank actually shows. */
  grade(previous: Forecast, actualBank: BankTxn[]): { errorPct: number; misses: Evidence[] };
  /** Updates the company model. Keeps a change only if past forecast error goes down. */
  learn(snapshot: Snapshot, model: CompanyModel, history: Forecast[]): CompanyModel;
  /** Real weekly cash for the past side of the timeline. */
  history(snapshot: Snapshot, weeks: number): HistoryWeek[];
  /** Notable real events for markers on the past side of the timeline. */
  pastEvents(snapshot: Snapshot, model: CompanyModel): PastEvent[];
  /**
   * Multiverse stress test: runs every single risk and every pair of the top risks,
   * with the given fixes applied, and finds the breaking points.
   */
  stressTest(
    snapshot: Snapshot,
    model: CompanyModel,
    constraints: Constraint[],
    risks: RiskEvent[],
    fixes: FixCandidate[],
  ): ResilienceReport;
}

/** packages/agents. Two versions: creao.ts and claude.ts. They propose and explain; never calculate money. */
export interface Agents {
  mapSource(apiDocs: string, samples: unknown[]): Promise<FieldMapping[]>;
  readConstraints(documents: { name: string; text: string }[]): Promise<Constraint[]>;
  /** The engine scores every candidate afterwards. */
  proposeFixes(branch: Branch, snapshot: Snapshot): Promise<FixCandidate[]>;
  /** Plain English, at most 3 sentences. */
  explain(branch: Branch): Promise<string>;
  /** Weekly plain-English brief: what changed, what Domino learned. */
  weeklyBrief(input: {
    grade: { errorPct: number; misses: Evidence[] };
    model: CompanyModel;
  }): Promise<string>;
}

export type AgentJob = "mapSource" | "readConstraints" | "proposeFixes" | "explain" | "weeklyBrief";
export type AgentBackend = "creao" | "claude";
