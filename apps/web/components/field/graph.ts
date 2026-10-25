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
import { type AgentLifecycle, type FieldOperation, type OperationKind, isLifecycle } from "./types";

// Brain map model: built only from the operation log plus the built-in catalog. Pure and
// deterministic so it is easy to test; map-layout.ts adds positions, the React layer motion.
//
// Three lanes: data sources -> agents -> outputs. Tools are not lanes of their own: each tool is
// kept as a node (for its details) but drawn as a chip inside the agent card that used it.

export type BrainKind = "agent" | "subagent" | "tool" | "source" | "output";
export type EdgeKind = "feeds" | "handoff" | "message" | "uses" | "produces";

export type BrainNode = {
  id: string;
  kind: BrainKind;
  title: string;
  brief: string;
  instructions?: string;
  status: CanvasStatus;
  /** Operations that touched this node, oldest first. Messages are kept apart. */
  operations: FieldOperation[];
  /** Agents only: messages this agent sent or received, oldest first. */
  messages: FieldOperation[];
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
  /** Agent copies: the instance id ("forecaster#3") and its role ("forecaster"). */
  instanceId?: string;
  role?: string;
  /** Agents with status rows: spawned, working, done or failed. */
  lifecycle?: AgentLifecycle;
  currentTask?: string;
  /** When the agent was started and when it finished, from its status rows. */
  startedAt?: string;
  endedAt?: string;
  progress?: number;
  /**
   * Sources and outputs: what saved state says, independent of how much of the log is loaded
   * ("Data through Nov 2", "12 versions saved"). Set by withSavedState().
   */
  saved?: string;
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
  if (["running", "started", "in_progress", "pending", "spawned", "working"].includes(s))
    return "running";
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
    return NO_OUTPUT.has(key)
      ? undefined
      : OUTPUT_OF_CATEGORY[describeTool(key, op.toolCategory, op.toolLabel).category];
  }
  return OUTPUT_OF_KIND[op.kind];
}

const OUTPUT_CATEGORY: Record<string, ToolCategory> = {
  books: "save",
  flags: "audit",
  forecast: "forecast",
  export: "export",
};

/** A log reference to an agent, an instance id ("forecaster#3") or a name ("Analyst"), -> node id. */
export function instanceNodeId(ref: string): string {
  const key = ref.trim().toLowerCase();
  return key.includes("#") ? `agent:${key.replace(/\s+/g, "-")}` : agentNodeId(ref);
}

/** The agent node an operation belongs to: its running copy when the log names one. */
export const opAgentId = (op: FieldOperation) =>
  op.instanceId ? instanceNodeId(op.instanceId) : agentNodeId(op.agent);

/** "forecaster#3" + "Forecaster" -> "Forecaster 3". */
function instanceTitle(ref: string, name?: string): string {
  const [role = "", n] = ref.split("#");
  const base = name && !name.includes("#") ? name : humanize(role);
  return n ? `${base} ${n}` : humanize(name ?? ref);
}

const BUILT_IN_IDS = new Set(BUILT_IN_AGENTS.map((a) => `agent:${a.id}`));

export function buildBrainGraph(operations: FieldOperation[]): BrainGraph {
  const ops = [...operations].sort(byTime);
  const nodes = new Map<string, BrainNode>();
  const edges = new Map<string, BrainEdge>();
  const agentOfOp = new Map(ops.map((op) => [op.id, opAgentId(op)]));

  for (const agent of BUILT_IN_AGENTS)
    nodes.set(`agent:${agent.id}`, {
      id: `agent:${agent.id}`,
      kind: "agent",
      title: agent.title,
      brief: agent.brief,
      instructions: agent.instructions,
      status: "idle",
      operations: [],
      messages: [],
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
      messages: [],
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
      messages: [],
      category: OUTPUT_CATEGORY[output.id] ?? "other",
    });

  const touch = (
    id: string,
    op: FieldOperation,
    make: () => Omit<BrainNode, "operations" | "messages">,
  ) => {
    const node = nodes.get(id) ?? { ...make(), operations: [], messages: [] };
    node.operations.push(op);
    node.lastAt = op.at;
    node.status = toCanvasStatus(op.status);
    nodes.set(id, node);
    return node;
  };
  const link = (source: string, target: string, kind: EdgeKind) => {
    const id = edgeId(source, target);
    // Two agents share one link, whichever way their messages and handoffs go.
    const pair = kind === "handoff" || kind === "message";
    if (pair && edges.has(edgeId(target, source))) return;
    if (!edges.has(id)) edges.set(id, { id, source, target, kind });
  };
  /** An agent named only by reference (a message, a parent): known name, or a new idle node. */
  const ensureAgent = (id: string, ref: string, op?: FieldOperation) => {
    const found = nodes.get(id);
    if (found) return found;
    const key = id.slice("agent:".length);
    const node: BrainNode = {
      id,
      kind: "agent",
      title: instanceTitle(ref),
      brief: OTHER_ACTORS[key] ?? "An agent recorded in the activity log.",
      status: "idle",
      operations: [],
      messages: [],
      agentKind: agentKindOf(key, op),
      ...(ref.includes("#") && { instanceId: ref, role: ref.split("#")[0] }),
    };
    nodes.set(id, node);
    return node;
  };

  for (const op of ops) {
    if (op.kind === "message") {
      const fromRef = op.from ?? op.instanceId ?? op.agent;
      const from = ensureAgent(instanceNodeId(fromRef), fromRef, op);
      const to = op.to ? ensureAgent(instanceNodeId(op.to), op.to) : undefined;
      for (const n of to && to !== from ? [from, to] : [from]) {
        n.messages.push(op);
        n.lastAt = op.at;
      }
      if (to && to.id !== from.id) link(from.id, to.id, "message");
      continue;
    }
    const agent = opAgentId(op);
    const key = agent.slice("agent:".length);
    const parentAgent = op.parentAgentId
      ? ensureAgent(instanceNodeId(op.parentAgentId), op.parentAgentId).id
      : op.parentId
        ? agentOfOp.get(op.parentId)
        : undefined;
    const sub = parentAgent && parentAgent !== agent ? parentAgent : undefined;
    const node = touch(agent, op, () => ({
      id: agent,
      kind: sub ? "subagent" : "agent",
      title: op.instanceId ? instanceTitle(op.instanceId, op.agent) : humanize(op.agent),
      brief: sub
        ? `Started by ${nodes.get(sub)?.title ?? "another agent"} to handle part of its work.`
        : (OTHER_ACTORS[catalogKey(op.agent, BUILT_IN_AGENTS)] ??
          "An agent recorded in the activity log."),
      status: "idle",
      parentId: sub,
      agentKind: agentKindOf(key, op),
      ...(op.instanceId && { instanceId: op.instanceId, role: op.instanceId.split("#")[0] }),
    }));
    // Named first by a message or as someone's parent, then started by a parent: a helper.
    if (sub && node.kind === "agent" && !BUILT_IN_IDS.has(node.id)) {
      node.kind = "subagent";
      node.parentId = sub;
      node.brief = `Started by ${nodes.get(sub)?.title ?? "another agent"} to handle part of its work.`;
    }
    if (op.instanceId && op.agent && !op.agent.includes("#"))
      node.title = instanceTitle(op.instanceId, op.agent);
    if (op.agentKind) node.agentKind = op.agentKind;
    else if (op.actor === "agent:claude" || op.actor === "agent:creao")
      node.agentKind = agentKindOf(key, op);
    if (op.instructions) node.instructions = op.instructions;
    if (op.currentTask) node.currentTask = op.currentTask;
    if (typeof op.progress === "number") node.progress = Math.max(0, Math.min(1, op.progress));
    if (isLifecycle(op.status)) {
      const running = op.status === "spawned" || op.status === "working";
      const ended = node.lifecycle === "done" || node.lifecycle === "failed";
      // A long-lived agent that finished and starts again begins a new run.
      if (running && (!node.startedAt || ended)) {
        node.startedAt = op.at;
        node.endedAt = undefined;
      }
      if (!running) node.endedAt = op.at;
      if (op.status === "done" && node.progress !== undefined) node.progress = 1;
      node.lifecycle = op.status;
    }
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
      const info = describeTool(op.tool, op.toolCategory, op.toolLabel);
      touch(tool, op, () => ({
        id: tool,
        kind: "tool",
        title: info.label,
        brief: info.demoActor
          ? "An Apify demo actor an agent called."
          : info.category === "apify"
            ? "An Apify actor run an agent started."
            : "A tool an agent called.",
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
    const info = describeTool(op.tool, op.toolCategory, op.toolLabel);
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
    if (chip.tools.length > 1 || info.category === "apify") chip.label = GROUP_LABEL[info.category];
    chips.set(id, chip);
  }
  return [...chips.values()];
}

/** The chip an operation lights up, if it called a tool. */
export function chipOf(op: FieldOperation): string | undefined {
  return op.tool
    ? chipId(opAgentId(op), describeTool(op.tool, op.toolCategory, op.toolLabel).group)
    : undefined;
}

/**
 * The drawn links one operation travels, in order: the source it read (or the agent that handed
 * off to it) into the agent, then the agent into the output it produced.
 */
export function pulsePath(op: FieldOperation, graph: BrainGraph): string[] {
  if (op.kind === "message") return [];
  const agent = opAgentId(op);
  const parent = op.parentId
    ? graph.nodes.find((n) => isAgent(n) && n.operations.some((o) => o.id === op.parentId))
    : undefined;
  const path: string[] = [];
  const boss = op.parentAgentId ? instanceNodeId(op.parentAgentId) : parent?.id;
  if (op.source) path.push(edgeId(sourceNodeId(op.source), agent));
  else if (boss && boss !== agent) path.push(edgeId(boss, agent));
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

/** One dot on one link. `reverse` runs it target -> source (a reply on a shared agent link). */
export type Pulse = { key: string; edgeId: string; delay: number; reverse?: boolean };

/** The agent link a message travels, and which way, if both agents are drawn and linked. */
export function messageRoute(
  op: FieldOperation,
  graph: BrainGraph,
): { edgeId: string; reverse: boolean } | undefined {
  if (op.kind !== "message" || !op.to) return undefined;
  const from = instanceNodeId(op.from ?? op.instanceId ?? op.agent);
  const to = instanceNodeId(op.to);
  const ids = new Set(graph.edges.map((e) => e.id));
  if (ids.has(edgeId(from, to))) return { edgeId: edgeId(from, to), reverse: false };
  if (ids.has(edgeId(to, from))) return { edgeId: edgeId(to, from), reverse: true };
  return undefined;
}
export const PULSE_SECONDS = 0.9;

/** One dot per link of each new operation; later hops wait for earlier ones. */
export function pulsesFor(fresh: FieldOperation[], graph: BrainGraph): Pulse[] {
  const pulses: Pulse[] = [];
  fresh.forEach((op, i) => {
    const message = messageRoute(op, graph);
    if (message) pulses.push({ key: `${op.id}:m`, ...message, delay: i * 0.3 * PULSE_SECONDS });
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
    if (op.kind === "message") {
      mark(instanceNodeId(op.from ?? op.instanceId ?? op.agent));
      if (op.to) mark(instanceNodeId(op.to), PULSE_SECONDS * 0.8);
      return;
    }
    const handed = op.source || op.parentId || op.parentAgentId;
    mark(opAgentId(op), handed ? PULSE_SECONDS * 0.8 : 0);
    mark(chipOf(op), handed ? PULSE_SECONDS * 0.8 : 0);
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

/** Agents running now: a working lifecycle, or (older logs) a running status. */
export const isWorking = (n: BrainNode) =>
  isAgent(n) &&
  (n.lifecycle ? n.lifecycle === "spawned" || n.lifecycle === "working" : n.status === "running");

/**
 * Ms since a helper finished, or undefined while it runs or after it failed (failures stay in
 * view). Helpers without status rows count as finished from their last recorded step.
 */
export function finishedAge(n: BrainNode, now: number): number | undefined {
  if (n.kind !== "subagent") return undefined;
  const done = n.lifecycle ? n.lifecycle === "done" : n.status === "succeeded";
  const end = n.lifecycle ? n.endedAt : n.lastAt;
  if (!done || !end) return undefined;
  const at = Date.parse(end);
  return Number.isNaN(at) ? undefined : Math.max(0, now - at);
}

/** A node with recorded work: log rows, messages, or saved state. */
export const hasWork = (n: BrainNode) =>
  n.operations.length > 0 || n.messages.length > 0 || n.saved !== undefined;

/** Built-in agents with no recorded work and no helpers: the map folds them into one card. */
export function idleAgents(graph: BrainGraph): string[] {
  const parents = new Set(graph.nodes.flatMap((n) => (n.parentId ? [n.parentId] : [])));
  return graph.nodes
    .filter((n) => BUILT_IN_IDS.has(n.id) && !hasWork(n) && !parents.has(n.id))
    .map((n) => n.id);
}

/** Saved state the map reads besides the log (field.status and field.findings). */
export type SavedState = {
  /** Catalog source id -> the company date its data runs through, with the saved step line. */
  sources?: { id: string; lastPull: string | null; step?: string | null }[];
  /** Books versions saved so far. */
  booksVersions?: number;
  /** Flags recorded so far, and how many are still open. */
  flags?: { total: number; open: number };
};

const shortDate = (iso: string) => {
  const at = Date.parse(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return Number.isNaN(at)
    ? iso
    : new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};

/**
 * Marks sources and outputs that saved state says have work, so a source read before the
 * loaded part of the log still counts. Returns a new graph; the input is not changed.
 */
export function withSavedState(graph: BrainGraph, saved: SavedState): BrainGraph {
  const notes = new Map<string, string>();
  for (const s of saved.sources ?? [])
    if (s.lastPull) notes.set(sourceNodeId(s.id), `Data through ${shortDate(s.lastPull)}`);
  const versions = saved.booksVersions ?? 0;
  if (versions > 0)
    notes.set(
      outputNodeId("books"),
      `${versions} ${versions === 1 ? "version" : "versions"} saved`,
    );
  const flags = saved.flags;
  if (flags && flags.total > 0)
    notes.set(
      outputNodeId("flags"),
      `${flags.total} ${flags.total === 1 ? "flag" : "flags"}, ${flags.open} open`,
    );
  if (!notes.size) return graph;
  return {
    edges: graph.edges,
    nodes: graph.nodes.map((n) => {
      const note = notes.get(n.id);
      return note ? { ...n, saved: note } : n;
    }),
  };
}

/** The one set of counts the headline, lane headings and stats all use. */
export function mapCounts(graph: BrainGraph) {
  const agents = graph.nodes.filter(isAgent);
  return {
    agents: agents.filter(hasWork).length,
    working: agents.filter(isWorking).length,
    sources: graph.nodes.filter((n) => n.kind === "source" && hasWork(n)).length,
    outputs: graph.nodes.filter((n) => n.kind === "output" && hasWork(n)).length,
    completedHelpers: agents.filter(
      (n) =>
        n.kind === "subagent" && (n.lifecycle ? n.lifecycle === "done" : n.status === "succeeded"),
    ).length,
    /** Each message touches both agents, so count message rows once. */
    messages: new Set(agents.flatMap((n) => n.messages.map((m) => m.id))).size,
  };
}

/** Finished agent copies that have faded out: the map folds them into a "+N finished" stack. */
export function collapsedInstances(graph: BrainGraph, now: number, graceMs: number): Set<string> {
  const out = new Set<string>();
  for (const n of graph.nodes) {
    const age = finishedAge(n, now);
    if (age !== undefined && age >= graceMs) out.add(n.id);
  }
  return out;
}

/** Outside providers whose tools the map shows in its toolbox. Domino's own tools stay chips. */
export type ToolProvider = "apify" | "claude" | "creao";
export const TOOL_PROVIDERS: readonly ToolProvider[] = ["apify", "claude", "creao"];
export const toolboxId = (provider: ToolProvider) => `toolbox:${provider}`;

/** The toolbox provider of a tool node (or of an Apify node recorded as a source). */
export function toolProvider(n: BrainNode): ToolProvider | undefined {
  if (n.kind === "source") return n.vendor === "apify" ? "apify" : undefined;
  if (n.kind !== "tool" || !n.tool) return undefined;
  const raw = n.tool.raw.trim().toLowerCase();
  if (n.tool.category === "apify" || raw.startsWith("apify")) return "apify";
  if (raw.startsWith("claude.")) return "claude";
  if (raw.startsWith("creao.")) return "creao";
  return undefined;
}

/** One toolbox card: an outside provider, the tools of it agents used, and those agents. */
export type ToolboxGroup = {
  id: string;
  provider: ToolProvider;
  /** Tool node ids (an Apify node recorded as a source too), in first-use order. */
  items: string[];
  /** Agents that used them. */
  users: string[];
};

/** Toolbox cards in the order their provider was first used; Apify actors group under Apify. */
export function toolboxGroups(graph: BrainGraph): ToolboxGroup[] {
  const groups = new Map<ToolProvider, ToolboxGroup>();
  const items = graph.nodes
    .flatMap((n) => {
      const provider = toolProvider(n);
      return provider ? [{ n, provider, at: n.operations[0]?.at ?? "" }] : [];
    })
    .sort((a, b) => (a.at === b.at ? 0 : a.at < b.at ? -1 : 1));
  for (const { n, provider } of items) {
    const group = groups.get(provider) ?? {
      id: toolboxId(provider),
      provider,
      items: [],
      users: [],
    };
    group.items.push(n.id);
    for (const e of graph.edges) {
      const user =
        e.kind === "uses" && e.target === n.id
          ? e.source
          : e.kind === "feeds" && e.source === n.id
            ? e.target
            : undefined;
      if (user && !group.users.includes(user)) group.users.push(user);
    }
    groups.set(provider, group);
  }
  return [...groups.values()];
}

/** Connector vendors a company connects on the Connect page; others are not connections. */
const CONNECTOR_VENDORS = new Set<VendorId>([
  "stripe",
  "ramp",
  "qbo",
  "gusto",
  "hubspot",
  "plaid",
  "capitalone",
]);

/**
 * The data sources the map shows. Apify is a tool, not a source: it moves to the toolbox. With
 * the company's connections known, a connector shows only while connected (disconnecting it
 * removes it from the map); without them (demo, loading) a source shows once it has work.
 */
export function mapSources(graph: BrainGraph, connected?: ReadonlySet<VendorId>): BrainGraph {
  // The saved bank row is historically keyed `nessie`/`bank`, even when Plaid supplied an
  // operating feed. Project that generic read onto the sole connected bank vendor. This also
  // retains reads older than the loaded event window and their source -> agent links.
  const bank = graph.nodes.find((n) => n.id === "source:bank");
  const plaid = graph.nodes.find((n) => n.id === "source:plaid");
  const plaidOnly = connected?.has("plaid") && !connected.has("capitalone");
  let projected = graph;
  if (plaidOnly && bank && plaid && hasWork(bank)) {
    const operations = [
      ...new Map([...bank.operations, ...plaid.operations].map((op) => [op.id, op])).values(),
    ].sort(byTime);
    const latest = operations.at(-1);
    const merged: BrainNode = {
      ...plaid,
      operations,
      ...(bank.saved && { saved: bank.saved }),
      ...(latest && { lastAt: latest.at, status: toCanvasStatus(latest.status) }),
    };
    const edges = new Map<string, BrainEdge>();
    for (const edge of graph.edges) {
      const source = edge.source === bank.id ? plaid.id : edge.source;
      const id = edgeId(source, edge.target);
      edges.set(id, { ...edge, id, source });
    }
    projected = {
      nodes: graph.nodes
        .filter((n) => n.id !== bank.id)
        .map((n) => (n.id === plaid.id ? merged : n)),
      edges: [...edges.values()],
    };
  }
  const drop = new Set(
    projected.nodes
      .filter((n) => {
        if (n.kind !== "source") return false;
        if (n.vendor === "apify") return true;
        if (connected && n.vendor && CONNECTOR_VENDORS.has(n.vendor))
          return !connected.has(n.vendor);
        return !hasWork(n);
      })
      .map((n) => n.id),
  );
  if (!drop.size) return projected;
  return {
    nodes: projected.nodes.filter((n) => !drop.has(n.id)),
    edges: projected.edges.filter((e) => !drop.has(e.source) && !drop.has(e.target)),
  };
}

/**
 * Where the web grows from on load: an orchestrator or coordinator agent when the log has one,
 * else the ingestion agent, else the first agent with work.
 */
export function growthRoot(graph: BrainGraph): string | undefined {
  const agents = graph.nodes.filter((n) => n.kind === "agent" && hasWork(n));
  const lead = agents.find((n) => /orchestrat|coordinat/i.test(`${n.id} ${n.title}`));
  return (
    lead?.id ??
    agents.find((n) => n.id === "agent:ingestion")?.id ??
    graph.nodes.find((n) => n.id === "agent:ingestion")?.id ??
    agents[0]?.id
  );
}
