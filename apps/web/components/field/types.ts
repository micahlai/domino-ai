import type { Finding } from "@domino/contracts";

// Field UI view of the field.* Convex API (being built on field/ingest). Presentation types only:
// the adapter in data.ts maps backend records into these, so a shape change is a one-file fix.

export type FieldStatus = {
  feed: { enabled: boolean; lastAdvanceAt: string | null };
  ingest: { enabled: boolean; lastRunAt: string | null; lastStatus: string | null };
  counts: { sources: number; snapshots: number; openFindings: number };
};

export type OperationKind = "pull" | "map" | "snapshot" | "audit" | "decision" | "export" | "spawn";

/** Plain JSON values only: the panel prints them, it never interprets them. */
export type OperationValues = Record<string, unknown>;

export type FieldOperation = {
  id: string;
  /** ISO timestamp the operation was recorded. */
  at: string;
  agent: string;
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
export type FieldFinding = Finding & { status: FindingStatus; note?: string };

export type Decision = "approved" | "rejected";

/** Where the data on screen came from. "demo" is always labelled as demo data in the UI. */
export type FieldSource = "live" | "demo" | "loading";

export type FieldActions = {
  decide: (args: { findingId: string; decision: Decision; note: string }) => Promise<void>;
  ingestNow: () => Promise<void>;
  advanceFeed: () => Promise<void>;
  /** WeeklySeedV1 as JSON text, exactly as it crosses the seam. */
  exportSeed: () => Promise<string>;
};

export type FieldData = {
  source: FieldSource;
  /** Plain-words reason shown next to the data label, for example why demo data is shown. */
  sourceNote: string;
  status?: FieldStatus;
  /** Oldest first. */
  operations?: FieldOperation[];
  findings?: FieldFinding[];
  canLoadMore: boolean;
  loadMore: () => void;
  actions: FieldActions;
};
