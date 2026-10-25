import type { Finding } from "@domino/contracts";

// Field UI view of the field.* Convex API (convex/field.ts). Presentation types only: live.ts
// maps backend records into these, so a backend shape change is a one-file fix.

export type FieldStatus = {
  feed: { enabled: boolean; lastAdvanceAt: string | null };
  /** `enabled` is auto-ingest (field.setAutoIngest); manual "Ingest now" always works. */
  ingest: { enabled: boolean; lastRunAt: string | null; lastStatus: string | null };
  counts: { sources: number; snapshots: number; openFindings: number };
  /** Live only: the mock world's date and week, the last ingest error, high-severity flags. */
  asOf?: string | null;
  week?: number;
  lastError?: string | null;
  openEscalations?: number;
  /**
   * Live only: each saved source row, keyed by brain map catalog id ("billing", "plaid").
   * `lastPull` is the company date the data runs through, not a clock time.
   */
  sources?: { id: string; lastPull: string | null; step?: string | null; tieOut?: string | null }[];
};

/** Synthetic anomalies the mock feed can plant (field.advanceFeed `anomaly`). */
export const ANOMALY_OPTIONS = [
  { value: "duplicate", label: "Duplicate bill" },
  { value: "unusual_amount", label: "Card spike" },
  { value: "unusual_timing", label: "Late bank entry" },
  { value: "conflict", label: "Invoice amount changed" },
  { value: "missing_expected", label: "Missing payroll run" },
] as const;
export type Anomaly = (typeof ANOMALY_OPTIONS)[number]["value"];

export type OperationKind =
  | "feed"
  | "run"
  | "pull"
  | "map"
  | "snapshot"
  | "audit"
  | "forecast"
  | "decision"
  | "export"
  | "spawn"
  | "message";

/** Lifecycle of one running agent copy, as status rows record it. */
export const AGENT_LIFECYCLE = ["spawned", "working", "done", "failed"] as const;
export type AgentLifecycle = (typeof AGENT_LIFECYCLE)[number];
export const isLifecycle = (s: string | undefined): s is AgentLifecycle =>
  (AGENT_LIFECYCLE as readonly string[]).includes(s ?? "");

/** Plain JSON values only: the panel prints them, it never interprets them. */
export type OperationValues = Record<string, unknown>;

export type FieldOperation = {
  id: string;
  /** ISO timestamp the operation was recorded. */
  at: string;
  /** Write order, to break ties: rows from one backend transaction share the same `at`. */
  seq?: number;
  agent: string;
  /** Who ran the step, as the log records it ("connector", "engine", "agent:claude", ...). */
  actor?: string;
  tool?: string;
  source?: string;
  kind: OperationKind;
  status: string;
  summary: string;
  inputs?: OperationValues;
  outputs?: OperationValues;
  /** The operation that started this one; a different agent here means a sub-agent. */
  parentId?: string;
  /** Optional reasoning summary, shown in the side panel only when the backend provides it. */
  reasoning?: string;
  /** One running copy of an agent ("forecaster#3"). Many copies of one agent can run at once. */
  instanceId?: string;
  /** Who runs the agent, when the log says so. */
  agentKind?: "domino" | "claude" | "creao" | "system";
  /** Instance id (or agent name) of the agent that started this one. */
  parentAgentId?: string;
  /** Message rows (kind "message"): sending and receiving agent, as instance ids or names. */
  from?: string;
  to?: string;
  /** Status rows: what the agent is working on now. `status` holds the lifecycle step. */
  currentTask?: string;
  /** 0 to 1, when the agent reports how far along it is. */
  progress?: number;
  /** Tool category as the log records it ("apify" for Apify actors). */
  toolCategory?: string;
  /** Tool label as the log records it (an Apify run's actor name, or "demo actor"). */
  toolLabel?: string;
  /** Instructions the agent was started with, when the log records them. */
  instructions?: string;
};

export type FindingStatus = "open" | "approved" | "rejected";
export type FieldFinding = Finding & {
  status: FindingStatus;
  note?: string;
  escalated?: boolean;
  /** Live only: Claude's plain-language explanation of the flag and a check to run. */
  explanation?: string;
  suggestedCheck?: string;
};

export type Decision = "approved" | "rejected";

/** Where the data on screen came from. "demo" is always labelled as demo data in the UI. */
export type FieldSource = "live" | "demo" | "loading";

export type FieldActions = {
  decide: (args: { findingId: string; decision: Decision; note: string }) => Promise<void>;
  ingestNow: () => Promise<void>;
  /** Advance the mock world one week; optionally plant one synthetic anomaly. */
  advanceFeed: (anomaly?: Anomaly) => Promise<void>;
  setAutoIngest: (enabled: boolean) => Promise<void>;
  /** Live only, when no feed exists yet: connect a new synthetic company (field.setup). */
  setup: () => Promise<void>;
  /** WeeklySeedV1 as JSON text, exactly as it crosses the seam. */
  exportSeed: () => Promise<string>;
};

export type FieldData = {
  source: FieldSource;
  /** Plain-words reason shown next to the data label, for example why demo data is shown. */
  sourceNote: string;
  status?: FieldStatus;
  /** Live backend reachable but field.setup has never run. */
  needsSetup?: boolean;
  /** Oldest first. */
  operations?: FieldOperation[];
  findings?: FieldFinding[];
  canLoadMore: boolean;
  loadMore: () => void;
  actions: FieldActions;
};
