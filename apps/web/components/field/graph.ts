import type { CanvasStatus } from "../investigate/types";
import { BUILT_IN_AGENTS, BUILT_IN_SOURCES, catalogKey } from "./catalog";
import type { FieldOperation } from "./types";

// Brain map model: built only from the operation log plus the built-in catalog. Pure and
// deterministic so it is easy to test; the React layer only adds positions and motion.

export type BrainKind = "agent" | "subagent" | "tool" | "source";

export type BrainNode = {
  id: string;
  kind: BrainKind;
  title: string;
  brief: string;
  instructions?: string;
  status: CanvasStatus;
  /** Operations that touched this node, oldest first. */
  operations: FieldOperation[];
  lastAt?: string;
  /** Agent id that started this sub-agent. */
  parentId?: string;
};

export type BrainEdge = { id: string; source: string; target: string };
export type BrainGraph = { nodes: BrainNode[]; edges: BrainEdge[] };

const agentKey = (name: string) => catalogKey(name, BUILT_IN_AGENTS);
const sourceKey = (name: string) => catalogKey(name, BUILT_IN_SOURCES);
export const agentNodeId = (name: string) => `agent:${agentKey(name)}`;
export const sourceNodeId = (name: string) => `source:${sourceKey(name)}`;
export const toolNodeId = (name: string) => `tool:${name.trim().toLowerCase()}`;
export const edgeId = (source: string, target: string) => `${source}->${target}`;

/** Backend statuses are free text; only these words change how a node looks. */
export function toCanvasStatus(status: string | undefined): CanvasStatus {
  const s = (status ?? "").toLowerCase();
  if (!s) return "idle";
  if (["running", "started", "in_progress", "pending"].includes(s)) return "running";
  if (["queued", "waiting"].includes(s)) return "queued";
  if (["failed", "error", "rejected_by_system"].includes(s)) return "failed";
  return "succeeded";
}

export const byTime = (a: FieldOperation, b: FieldOperation) =>
  a.at === b.at ? a.id.localeCompare(b.id) : Date.parse(a.at) - Date.parse(b.at);

function humanize(name: string) {
  const words = name.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Unnamed";
}

export function buildBrainGraph(operations: FieldOperation[]): BrainGraph {
  const ops = [...operations].sort(byTime);
  const nodes = new Map<string, BrainNode>();
  const edges = new Map<string, BrainEdge>();
  const agentOfOp = new Map(ops.map((op) => [op.id, agentNodeId(op.agent)]));

  for (const agent of BUILT_IN_AGENTS)
    nodes.set(`agent:${agent.id}`, {
      id: `agent:${agent.id}`,
      kind: "agent",
      title: agent.title,
      brief: agent.brief,
      instructions: agent.instructions,
      status: "idle",
      operations: [],
    });
  for (const source of BUILT_IN_SOURCES)
    nodes.set(`source:${source.id}`, {
      id: `source:${source.id}`,
      kind: "source",
      title: source.title,
      brief: source.brief,
      status: "idle",
      operations: [],
    });

  const touch = (id: string, op: FieldOperation, make: () => Omit<BrainNode, "operations">) => {
    const node = nodes.get(id) ?? { ...make(), operations: [] };
    node.operations.push(op);
    node.lastAt = op.at;
    node.status = toCanvasStatus(op.status);
    nodes.set(id, node);
  };
  const link = (source: string, target: string) => {
    const id = edgeId(source, target);
    if (!edges.has(id)) edges.set(id, { id, source, target });
  };

  for (const op of ops) {
    const agent = agentNodeId(op.agent);
    const parentAgent = op.parentId ? agentOfOp.get(op.parentId) : undefined;
    const sub = parentAgent && parentAgent !== agent ? parentAgent : undefined;
    touch(agent, op, () => ({
      id: agent,
      kind: sub ? "subagent" : "agent",
      title: humanize(op.agent),
      brief: sub
        ? `Started by ${nodes.get(sub)?.title ?? "another agent"} to handle part of its work.`
        : "An agent recorded in the activity log.",
      status: "idle",
      parentId: sub,
    }));
    if (sub) link(sub, agent);
    if (op.source) {
      const source = sourceNodeId(op.source);
      touch(source, op, () => ({
        id: source,
        kind: "source",
        title: humanize(op.source ?? ""),
        brief: "A data source recorded in the activity log.",
        status: "idle",
      }));
      link(source, agent);
    }
    if (op.tool) {
      const tool = toolNodeId(op.tool);
      touch(tool, op, () => ({
        id: tool,
        kind: "tool",
        title: humanize(op.tool ?? ""),
        brief: "A tool an agent called.",
        status: "idle",
      }));
      link(agent, tool);
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/** The edges one operation travels, in order: source (or the agent that handed off) -> agent -> tool. */
export function pulsePath(op: FieldOperation, graph: BrainGraph): string[] {
  const agent = agentNodeId(op.agent);
  const parent = op.parentId
    ? graph.nodes.find(
        (n) =>
          (n.kind === "agent" || n.kind === "subagent") &&
          n.operations.some((o) => o.id === op.parentId),
      )
    : undefined;
  const path: string[] = [];
  if (op.source) path.push(edgeId(sourceNodeId(op.source), agent));
  else if (parent && parent.id !== agent) path.push(edgeId(parent.id, agent));
  if (op.tool) path.push(edgeId(agent, toolNodeId(op.tool)));
  const known = new Set(graph.edges.map((e) => e.id));
  return path.filter((id) => known.has(id));
}

/**
 * Split a delivery into operations already shown and new ones. `quiet` (the first load, a
 * reconnect) only remembers ids, so old work never replays as new.
 */
export function freshOperations(
  seen: ReadonlySet<string>,
  operations: FieldOperation[],
  quiet: boolean,
): { seen: Set<string>; fresh: FieldOperation[] } {
  const next = new Set(seen);
  const fresh: FieldOperation[] = [];
  for (const op of [...operations].sort(byTime)) {
    if (next.has(op.id)) continue;
    next.add(op.id);
    if (!quiet) fresh.push(op);
  }
  return { seen: next, fresh };
}

export type Pulse = { key: string; edgeId: string; delay: number };
export const PULSE_SECONDS = 0.7;

/** One dot per edge of each new operation; later hops wait for earlier ones. */
export function pulsesFor(fresh: FieldOperation[], graph: BrainGraph): Pulse[] {
  const pulses: Pulse[] = [];
  fresh.forEach((op, i) => {
    pulsePath(op, graph).forEach((id, hop) => {
      pulses.push({ key: `${op.id}:${hop}`, edgeId: id, delay: (i * 0.35 + hop) * PULSE_SECONDS });
    });
  });
  return pulses;
}

// Columns: sources, agents, sub-agents, tools. Rows fill in arrival order and never move.
const COLUMN_X: Record<BrainKind, number> = { source: 0, agent: 340, subagent: 620, tool: 900 };
const ROW = 140;
const COLUMN_TOP: Record<BrainKind, number> = { source: 0, agent: ROW, subagent: ROW / 2, tool: 0 };

export function layoutBrain(nodes: BrainNode[]): Map<string, { x: number; y: number }> {
  const used: Record<BrainKind, number> = { source: 0, agent: 0, subagent: 0, tool: 0 };
  const positions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const row = used[node.kind]++;
    positions.set(node.id, { x: COLUMN_X[node.kind], y: COLUMN_TOP[node.kind] + row * ROW });
  }
  return positions;
}

/** Ids connected to a node, with the direction of each link. */
export function neighbors(graph: BrainGraph, id: string) {
  const title = (nid: string) => graph.nodes.find((n) => n.id === nid);
  return {
    from: graph.edges.filter((e) => e.target === id).flatMap((e) => title(e.source) ?? []),
    to: graph.edges.filter((e) => e.source === id).flatMap((e) => title(e.target) ?? []),
  };
}
