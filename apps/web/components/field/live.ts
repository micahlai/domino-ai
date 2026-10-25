import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import type { FieldFinding, FieldOperation, FieldStatus, OperationKind } from "./types";

// Pure mapping from the real field.* records (convex/field.ts) into the Field UI view types.
// Only fields the backend actually writes are used; nothing here invents work or numbers.

export type LiveStatus = NonNullable<FunctionReturnType<typeof api.field.status>>;
export type LiveLogRow = FunctionReturnType<typeof api.field.log>["page"][number];
export type LiveFinding = FunctionReturnType<typeof api.field.findings>[number];

/** Log agent ids -> names the brain map catalog knows (see catalog.ts). */
const AGENT_NAME: Record<string, string> = {
  "field.ingest": "Ingestion agent",
  "field.audit": "Audit agent",
  "mock.feed": "Mock feed",
  "field.worker": "Reviewer",
};

/** Source kinds in the log -> catalog source ids. */
const SOURCE_NAME: Record<string, string> = {
  stripe: "billing",
  crm: "crm",
  ramp: "cards",
  books: "books",
  payroll: "payroll",
  nessie: "bank",
};

export const liveAgentName = (agent: string | undefined) =>
  agent ? (AGENT_NAME[agent] ?? agent) : "Unknown";
export const liveSourceName = (source: string) => SOURCE_NAME[source] ?? source;

export function operationKind(action: string): OperationKind {
  if (action.startsWith("feed.")) return "feed";
  if (action === "ingest.pulled") return "pull";
  if (action === "ingest.mapped" || action === "ingest.reconciled") return "map";
  if (action === "ingest.snapshotWritten") return "snapshot";
  if (action.startsWith("ingest.recompute")) return "forecast";
  if (action.startsWith("audit.")) return "audit";
  if (action.startsWith("escalation.")) return "decision";
  return "run";
}

function operationStatus(action: string): string {
  if (/failed$/i.test(action)) return "failed";
  if (action === "ingest.started") return "running";
  return "succeeded";
}

/**
 * Log rows (any order) -> operations, oldest first. Within one ingest run (same runId), a step
 * by a different agent than the run's first step is recorded as started by that first step, so
 * the map draws the ingestion agent handing the new snapshot to the audit agent.
 */
export function toOperations(rows: LiveLogRow[]): FieldOperation[] {
  const sorted = [...rows].sort((a, b) =>
    a.at === b.at ? (a._creationTime ?? 0) - (b._creationTime ?? 0) : a.at < b.at ? -1 : 1,
  );
  const runStart = new Map<string, LiveLogRow>();
  for (const row of sorted) if (row.runId && !runStart.has(row.runId)) runStart.set(row.runId, row);
  return sorted.map((row) => {
    const first = row.runId ? runStart.get(row.runId) : undefined;
    const parentId =
      first && first._id !== row._id && first.agent !== row.agent ? first._id : undefined;
    return {
      id: row._id,
      at: row.at,
      agent: liveAgentName(row.agent),
      ...(row.tool && { tool: row.tool }),
      ...(row.source && { source: liveSourceName(row.source) }),
      kind: operationKind(row.action),
      status: operationStatus(row.action),
      summary: row.summary ?? row.action,
      inputs: { action: row.action, actor: row.actor, ...(row.runId && { runId: row.runId }) },
      ...(row.refs.length > 0 && { outputs: { refs: row.refs } }),
      ...(parentId && { parentId }),
    };
  });
}

export function toStatus(status: LiveStatus, rows: LiveLogRow[]): FieldStatus {
  const lastAdvance = rows
    .filter((r) => r.action === "feed.advanced" || r.action === "feed.planted")
    .reduce<string | null>((latest, r) => (latest && latest > r.at ? latest : r.at), null);
  return {
    feed: { enabled: true, lastAdvanceAt: lastAdvance },
    ingest: {
      enabled: status.auto,
      lastRunAt: status.lastIngestAt,
      lastStatus: status.lastIngestStatus,
    },
    counts: {
      sources: status.sources.filter((s) => s.lastPull !== null).length,
      snapshots: status.snapshotVersion,
      openFindings: status.openFindings,
    },
    asOf: status.asOf,
    week: status.week,
    lastError: status.lastError,
    openEscalations: status.openEscalations,
  };
}

export function toFinding(f: LiveFinding): FieldFinding {
  return {
    id: f.findingId,
    kind: f.kind,
    severity: f.severity,
    summary: f.summary,
    refs: f.refs,
    detectedAt: f.detectedAt,
    status: f.status,
    escalated: f.escalated,
    ...(f.note && { note: f.note }),
  };
}
