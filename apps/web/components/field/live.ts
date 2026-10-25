import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import {
  type FieldFinding,
  type FieldOperation,
  type FieldStatus,
  type OperationKind,
  isLifecycle,
} from "./types";

// Pure mapping from the real field.* records (convex/field.ts) into the Field UI view types.
// Only fields the backend actually writes are used; nothing here invents work or numbers.

export type LiveStatus = NonNullable<FunctionReturnType<typeof api.field.status>>;
export type LiveLogRow = FunctionReturnType<typeof api.field.log>["page"][number];
export type LiveFinding = FunctionReturnType<typeof api.field.findings>[number];

/**
 * Agent swarm fields the log is gaining (field/swarm lane). Optional and read defensively, so
 * rows written before them, or by a backend without them, map exactly as before.
 */
export type SwarmLogFields = {
  agentInstanceId?: string;
  agentKind?: string;
  parentAgentId?: string;
  /** "message" for agent -> agent messages. */
  kind?: string;
  from?: string;
  to?: string;
  /** Lifecycle step: spawned, working, done or failed. */
  status?: string;
  currentTask?: string;
  toolCategory?: string;
  progress?: number;
  instructions?: string;
};
type SwarmRow = LiveLogRow & SwarmLogFields;

const AGENT_KINDS = new Set(["domino", "claude", "creao", "system"]);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
/** A log agent reference: field ids keep their friendly names ("field.audit" -> "Audit agent"). */
const agentRef = (v: unknown) => {
  const s = str(v);
  return s && !s.includes("#") ? liveAgentName(s) : s;
};

/** Log agent ids -> names the brain map catalog knows (see catalog.ts). */
const AGENT_NAME: Record<string, string> = {
  "field.ingest": "Ingestion agent",
  "field.audit": "Audit agent",
  "mock.feed": "Mock feed",
  "field.worker": "Reviewer",
  "field.analyst": "Analyst",
  "field.forecaster": "Forecaster",
  "field.research": "Research agent",
};

/**
 * Source kinds in the log -> catalog source ids. Field ingest writes mock server kinds (crm,
 * books, nessie); the Connect page writes connector ids (hubspot, qbo, gusto). Both name the
 * same vendor, so they land on one node. Plaid stays its own node: it is a different way in to
 * the bank than the Capital One Nessie feed.
 */
const SOURCE_NAME: Record<string, string> = {
  stripe: "billing",
  crm: "crm",
  hubspot: "crm",
  ramp: "cards",
  books: "books",
  qbo: "books",
  payroll: "payroll",
  gusto: "payroll",
  nessie: "bank",
};

/** Rows written by shared engine code carry no agent; name them by actor instead. */
const ACTOR_NAME: Record<string, string> = {
  engine: "Engine",
  connector: "Connector",
  person: "Reviewer",
};

export const liveAgentName = (agent: string | undefined, actor = "") =>
  agent ? (AGENT_NAME[agent] ?? agent) : (ACTOR_NAME[actor] ?? "Unknown");
export const liveSourceName = (source: string) => SOURCE_NAME[source] ?? source;

export function operationKind(action: string): OperationKind {
  if (action === "agent.message" || action.endsWith(".message")) return "message";
  if (action === "agent.spawned") return "spawn";
  if (action.startsWith("feed.")) return "feed";
  if (action === "ingest.pulled") return "pull";
  if (action === "ingest.mapped" || action === "ingest.reconciled") return "map";
  if (action === "ingest.snapshotWritten") return "snapshot";
  if (/recompute/i.test(action)) return "forecast";
  if (action.startsWith("audit.")) return "audit";
  if (action.startsWith("escalation.")) return "decision";
  return "run";
}

function operationStatus(action: string): string {
  const step = /^agent\.(spawned|working|done|failed)$/.exec(action)?.[1];
  if (step) return step;
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
  return sorted.map((plain) => {
    const row = plain as SwarmRow;
    const first = row.runId ? runStart.get(row.runId) : undefined;
    const parentId =
      first && first._id !== row._id && first.agent !== row.agent ? first._id : undefined;
    const kind = row.kind === "message" ? "message" : operationKind(row.action);
    const status = isLifecycle(row.status) ? row.status : operationStatus(row.action);
    const agentKind = str(row.agentKind);
    return {
      id: row._id,
      at: row.at,
      seq: row._creationTime,
      agent: liveAgentName(row.agent, row.actor),
      actor: row.actor,
      ...(row.tool && { tool: row.tool }),
      ...(row.source && { source: liveSourceName(row.source) }),
      ...(str(row.agentInstanceId) && { instanceId: str(row.agentInstanceId) }),
      ...(agentKind &&
        AGENT_KINDS.has(agentKind) && { agentKind: agentKind as FieldOperation["agentKind"] }),
      ...(agentRef(row.parentAgentId) && { parentAgentId: agentRef(row.parentAgentId) }),
      ...(agentRef(row.from) && { from: agentRef(row.from) }),
      ...(agentRef(row.to) && { to: agentRef(row.to) }),
      ...(str(row.currentTask) && { currentTask: str(row.currentTask) }),
      ...(str(row.toolCategory) && { toolCategory: str(row.toolCategory) }),
      ...(str(row.instructions) && { instructions: str(row.instructions) }),
      ...(typeof row.progress === "number" && { progress: row.progress }),
      kind,
      status,
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
