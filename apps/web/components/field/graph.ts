import type { AgentKind } from "../icons/AgentIcon";
import type { ToolCategory } from "../icons/ToolIcon";
import { VENDORS, type VendorId, vendorFor } from "../icons/vendors";
import type { CanvasStatus } from "../investigate/types";
import {
  BUILT_IN_AGENTS,
  BUILT_IN_OUTPUTS,
  BUILT_IN_SOURCES,
  OTHER_ACTORS,
  catalogKey,
} from "./catalog";
import { GROUP_LABEL, type ToolInfo, describeTool } from "./tool-names";
import type { FieldOperation, OperationKind } from "./types";

// Brain map model: built only from the operation log plus the built-in catalog. Pure and
// deterministic so it is easy to test; map-layout.ts adds positions, the React layer motion.
//
// Three lanes: data sources -> agents -> outputs. Tools are not lanes of their own: each tool is
// kept as a node (for its details) but drawn as a chip inside the agent card that used it.

export type BrainKind = "agent" | "subagent" | "tool" | "source" | "output";
export type EdgeKind = "feeds" | "handoff" | "uses" | "produces";

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
  /** Agents only: who runs it (Domino, Claude, CREAO, plain code, a person). */
  agentKind?: AgentKind;
  /** Sources only. */
  vendor?: VendorId;
  /** Sources: what the data is ("Billing"). Outputs: its category, for the icon. */
  subtitle?: string;
  /** Tools: the raw id as recorded, with its plain label and category. */
  tool?: ToolInfo & { raw: string };
  /** Outputs only: which tool category produces it, for the icon. */
  category?: ToolCategory;
};

export type BrainEdge = { id: string; source: string; target: string; kind: EdgeKind };
export type BrainGraph = { nodes: BrainNode[]; edges: BrainEdge[] };

const agentKey = (name: string) => catalogKey(name, BUILT_IN_AGENTS);
const sourceKey = (name: string) => catalogKey(name, BUILT_IN_SOURCES);
export const agentNodeId = (name: string) => `agent:${agentKey(name)}`;
export const sourceNodeId = (name: string) => `source:${sourceKey(name)}`;
export const toolNodeId = (name: string) => `tool:${name.trim().toLowerCase()}`;
export const outputNodeId = (id: string) => `output:${id}`;
export const edgeId = (source: string, target: string) => `${source}->${target}`;
export const isAgent = (n: BrainNode) => n.kind === "agent" || n.kind === "subagent";

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
  a.at === b.at
    ? (a.seq ?? 0) - (b.seq ?? 0) || a.id.localeCompare(b.id)
    : Date.parse(a.at) - Date.parse(b.at);

function humanize(name: string) {
  const words = name.replace(/[_.-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Unnamed";
}

const SYSTEM_KIND: Record<string, AgentKind> = {
  "mock-feed": "simulator",
  engine: "system",
  connector: "system",
  unknown: "system",
  reviewer: "person",
};

/** Who an agent is, from the log's actor field first, then its name. */
export function agentKindOf(key: string, op?: FieldOperation): AgentKind {
  const actor = op?.actor ?? "";
  if (actor === "agent:claude" || /claude/.test(key)) return "claude";
  if (actor === "agent:creao" || /creao/.test(key)) return "creao";
  return SYSTEM_KIND[key] ?? "domino";
}

/** Which output a step produced. Reads, mapping, checks of balances and the demo feed make none. */
const OUTPUT_OF_CATEGORY: Partial<Record<ToolCategory, string>> = {
  save: "books",
  audit: "flags",
  forecast: "forecast",
  export: "export",
};
const OUTPUT_OF_KIND: Partial<Record<OperationKind, string>> = {
  snapshot: "books",
  audit: "flags",
  decision: "flags",
  forecast: "forecast",
  export: "export",
};
/** Tie-out results are stored with the sources, not as flags. */
const NO_OUTPUT = new Set(["field.tieout"]);

export function outputOf(op: FieldOperation): string | undefined {
  if (op.tool) {
    const key = op.tool.trim().toLowerCase();
    return NO_OUTPUT.has(key) ? undefined : OUTPUT_OF_CATEGORY[describeTool(key).category];
  }
  return OUTPUT_OF_KIND[op.kind];
}

const OUTPUT_CATEGORY: Record<string, ToolCategory> = {
  books: "save",
  flags: "audit",
  forecast: "forecast",
  export: "export",
};

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
      agentKind: "domino",
    });
  for (const source of BUILT_IN_SOURCES) {
    const vendor = vendorFor(source.id);
    nodes.set(`source:${source.id}`, {
      id: `source:${source.id}`,
      kind: "source",
      title: source.title,
      brief: source.brief,
      status: "idle",
      operations: [],
      vendor,
      subtitle: VENDORS[vendor].category,
    });
  }
  for (const output of BUILT_IN_OUTPUTS)
    nodes.set(outputNodeId(output.id), {
      id: outputNodeId(output.id),
      kind: "output",
      title: output.title,
      brief: output.brief,
      status: "idle",
      operations: [],
      category: OUTPUT_CATEGORY[output.id] ?? "other",
    });

  const touch = (id: string, op: FieldOperation, make: () => Omit<BrainNode, "operations">) => {
    const node = nodes.get(id) ?? { ...make(), operations: [] };
    node.operations.push(op);
    node.lastAt = op.at;
    node.status = toCanvasStatus(op.status);
    nodes.set(id, node);
  };
  const link = (source: string, target: string, kind: EdgeKind) => {
    const id = edgeId(source, target);
    if (!edges.has(id)) edges.set(id, { id, source, target, kind });
  };

  for (const op of ops) {
    const agent = agentNodeId(op.agent);
    const key = agentKey(op.agent);
    const parentAgent = op.parentId ? agentOfOp.get(op.parentId) : undefined;
    const sub = parentAgent && parentAgent !== agent ? parentAgent : undefined;
    touch(agent, op, () => ({
      id: agent,
      kind: sub ? "subagent" : "agent",
      title: humanize(op.agent),
      brief: sub
        ? `Started by ${nodes.get(sub)?.title ?? "another agent"} to handle part of its work.`
        : (OTHER_ACTORS[key] ?? "An agent recorded in the activity log."),
      status: "idle",
      parentId: sub,
      agentKind: agentKindOf(key, op),
    }));
    const node = nodes.get(agent);
    if (node && op.actor && (op.actor === "agent:claude" || op.actor === "agent:creao"))
      node.agentKind = agentKindOf(key, op);
    if (sub) link(sub, agent, "handoff");
    if (op.source) {
      const source = sourceNodeId(op.source);
      const vendor = vendorFor(sourceKey(op.source));
      touch(source, op, () => ({
        id: source,
        kind: "source",
        title: vendor === "generic" ? humanize(op.source ?? "") : VENDORS[vendor].name,
        brief: "A data source recorded in the activity log.",
        status: "idle",
        vendor,
        subtitle: VENDORS[vendor].category,
      }));
      link(source, agent, "feeds");
    }
    if (op.tool) {
      const tool = toolNodeId(op.tool);
      const info = describeTool(op.tool);
      touch(tool, op, () => ({
        id: tool,
        kind: "tool",
        title: info.label,
        brief: "A tool an agent called.",
        status: "idle",
        tool: { ...info, raw: op.tool ?? "" },
      }));
      link(agent, tool, "uses");
    }
    // A helper's work rolls up into its manager's output, so helpers draw no output link. A
    // built-in agent handed work by another (ingestion -> audit) still produces its own.
    const output = nodes.get(agent)?.kind === "subagent" ? undefined : outputOf(op);
    if (output) {
      const id = outputNodeId(output);
      touch(id, op, () => ({
        id,
        kind: "output",
        title: humanize(output),
        brief: "An output recorded in the activity log.",
        status: "idle",
        category: "other",
      }));
      link(agent, id, "produces");
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/** The tools one agent used, collapsed into chips: one per tool, reads and connects grouped. */
export type ToolChip = {
  id: string;
  agentId: string;
  label: string;
  category: ToolCategory;
  /** Tool node ids in this chip, in first-use order. */
  tools: string[];
  /** This agent's calls to these tools. */
  calls: number;
  operations: FieldOperation[];
  status: CanvasStatus;
  lastAt?: string;
};

export const chipId = (agentId: string, group: string) => `${agentId}|${group}`;

export function toolChips(agent: BrainNode): ToolChip[] {
  const chips = new Map<string, ToolChip>();
  for (const op of agent.operations) {
    if (!op.tool) continue;
    const info = describeTool(op.tool);
    const id = chipId(agent.id, info.group);
    const chip = chips.get(id) ?? {
      id,
      agentId: agent.id,
      label: info.label,
      category: info.category,
      tools: [],
      calls: 0,
      operations: [],
      status: "idle" as CanvasStatus,
    };
    const tool = toolNodeId(op.tool);
    if (!chip.tools.includes(tool)) chip.tools.push(tool);
    chip.calls += 1;
    chip.operations.push(op);
    chip.status = toCanvasStatus(op.status);
    chip.lastAt = op.at;
    if (chip.tools.length > 1) chip.label = GROUP_LABEL[info.category] ?? chip.label;
    chips.set(id, chip);
  }
  return [...chips.values()];
}

/** The chip an operation lights up, if it called a tool. */
export function chipOf(op: FieldOperation): string | undefined {
  return op.tool ? chipId(agentNodeId(op.agent), describeTool(op.tool).group) : undefined;
}

/**
 * The drawn links one operation travels, in order: the source it read (or the agent that handed
 * off to it) into the agent, then the agent into the output it produced.
 */
export function pulsePath(op: FieldOperation, graph: BrainGraph): string[] {
  const agent = agentNodeId(op.agent);
  const parent = op.parentId
    ? graph.nodes.find((n) => isAgent(n) && n.operations.some((o) => o.id === op.parentId))
    : undefined;
  const path: string[] = [];
  if (op.source) path.push(edgeId(sourceNodeId(op.source), agent));
  else if (parent && parent.id !== agent) path.push(edgeId(parent.id, agent));
  const output = outputOf(op);
  if (output) path.push(edgeId(agent, outputNodeId(output)));
  const drawn = new Set(graph.edges.filter((e) => e.kind !== "uses").map((e) => e.id));
  return path.filter((id) => drawn.has(id));
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
export const PULSE_SECONDS = 0.9;

/** One dot per link of each new operation; later hops wait for earlier ones. */
export function pulsesFor(fresh: FieldOperation[], graph: BrainGraph): Pulse[] {
  const pulses: Pulse[] = [];
  fresh.forEach((op, i) => {
    pulsePath(op, graph).forEach((id, hop) => {
      pulses.push({ key: `${op.id}:${hop}`, edgeId: id, delay: (i * 0.3 + hop) * PULSE_SECONDS });
    });
  });
  return pulses;
}

/** Nodes and tool chips an arriving operation lights up, keyed by id, with when it starts. */
export function activityFor(fresh: FieldOperation[]): Map<string, number> {
  const active = new Map<string, number>();
  fresh.forEach((op, i) => {
    const delay = i * 0.3 * PULSE_SECONDS;
    const mark = (id: string | undefined, extra = 0) => {
      if (id && !active.has(id)) active.set(id, delay + extra);
    };
    mark(agentNodeId(op.agent), op.source || op.parentId ? PULSE_SECONDS * 0.8 : 0);
    mark(chipOf(op), op.source || op.parentId ? PULSE_SECONDS * 0.8 : 0);
    if (op.source) mark(sourceNodeId(op.source));
  });
  return active;
}

/** Nodes linked to a node by drawn links, with the direction of each. Tool links excluded. */
export function neighbors(graph: BrainGraph, id: string) {
  const find = (nid: string) => graph.nodes.find((n) => n.id === nid);
  const drawn = graph.edges.filter((e) => e.kind !== "uses");
  return {
    from: drawn.filter((e) => e.target === id).flatMap((e) => find(e.source) ?? []),
    to: drawn.filter((e) => e.source === id).flatMap((e) => find(e.target) ?? []),
  };
}

/** Agents that called a tool. */
export function toolOwners(graph: BrainGraph, toolId: string): BrainNode[] {
  return graph.edges
    .filter((e) => e.kind === "uses" && e.target === toolId)
    .flatMap((e) => graph.nodes.find((n) => n.id === e.source) ?? []);
}
