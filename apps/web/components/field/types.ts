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
  | "spawn";

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
};

export type FindingStatus = "open" | "approved" | "rejected";
export type FieldFinding = Finding & { status: FindingStatus; note?: string; escalated?: boolean };

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
