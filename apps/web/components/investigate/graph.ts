import type { Node, XYPosition } from "@xyflow/react";
import type {
  CanvasConnection,
  CanvasEdge,
  CanvasEvidence,
  CanvasNode,
  CanvasNodeKind,
  CanvasStatus,
} from "./types";

// `enter`: fade this node in once. `live`: the latest delivery was real work, so a status change may animate.
export type FlowData = { node: CanvasNode; enter: boolean; live: boolean };
export type FlowNode = Node<FlowData, "canvas">;

export const IDLE_DOMINO: CanvasNode = {
  id: "domino",
  kind: "domino",
  title: "Domino",
  status: "idle",
};

export const KIND_LABEL: Record<CanvasNodeKind, string> = {
  domino: "Domino",
  agent: "Agent",
  source: "Source",
  tool: "Tool",
  output: "Result",
  knowledge: "Knowledge",
};

export const STATUS_LABEL: Record<CanvasStatus, string> = {
  idle: "Idle",
  queued: "Waiting",
  running: "Running",
  succeeded: "Done",
  failed: "Failed",
};

// Every node is NODE_W wide with its shape in a CIRCLE_ROW tall row at the top, so a shape always
// centers at (NODE_W / 2, CIRCLE_ROW / 2) and layout can reason in centers.
export const NODE_W = 144;
export const CIRCLE_ROW = 72;
// A rendered node is NODE_W x NODE_H: shape row 72, gap 6, two-line title 32, status line 16.
// NODE_BOX adds a gap, so two nodes closer than this on both axes overlap or nearly touch.
export const NODE_H = 126;
export const NODE_BOX = { w: NODE_W + 8, h: NODE_H + 12 };
const PUSH = 12; // small steps so a pushed node sits just clear, not a whole step too far
const MAX_PUSH = 600;

// Company map: Domino in the middle, Sources left, Toolbox right, specialists above, saved
// knowledge just below Domino and result cards under that. Slots depend on kind and arrival order
// only (never on edges), so a node's slot is the same whatever else has arrived.
const SIDE_X = 260; // centre of the first Sources / Toolbox column
const COL_GAP = 168; // next column, further out
const ROW_GAP = 140; // vertical step inside a column
const ACROSS = 190; // horizontal step inside a specialist or result row
const PER_LANE = 3; // slots per column or row before the next one starts
const AGENT_Y = 320;
const KNOWLEDGE_Y = 190;
const OUTPUT_Y = 360;
const BAND = 160; // next row of specialists or results

/** 0, +1, -1: fill the middle first so a lane grows evenly both ways. */
const spread = (i: number) => (i === 0 ? 0 : i % 2 ? (i + 1) / 2 : -i / 2);

function slot(kind: CanvasNodeKind, index: number): XYPosition {
  const lane = index % PER_LANE;
  const band = Math.floor(index / PER_LANE);
  const k = spread(lane);
  switch (kind) {
    case "domino":
      return { x: 0, y: 0 };
    case "source":
      return { x: -(SIDE_X + band * COL_GAP), y: k * ROW_GAP };
    case "tool":
      return { x: SIDE_X + band * COL_GAP, y: k * ROW_GAP };
    case "agent":
      return { x: k * ACROSS, y: -(AGENT_Y + band * BAND) };
    case "knowledge":
      return { x: k * ACROSS, y: KNOWLEDGE_Y + band * BAND };
    case "output":
      return { x: k * ACROSS, y: OUTPUT_Y + band * BAND };
  }
}

const topLeft = (c: XYPosition): XYPosition => ({
  x: Math.round(c.x - NODE_W / 2),
  y: Math.round(c.y - CIRCLE_ROW / 2),
});

const nodeClass =
  "rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function nodeLabel(node: CanvasNode): string {
  if (node.kind === "knowledge")
    return `${node.title}, a view of the saved evidence, not an agent. Press Enter for details.`;
  const kind = node.kind === "domino" ? "" : `, ${KIND_LABEL[node.kind].toLowerCase()}`;
  return `${node.title}${kind}, ${STATUS_LABEL[node.status].toLowerCase()}. Press Enter for details.`;
}

/** Top-left slot for every node, in arrival order within its kind. Positions only; deterministic. */
export function layout(nodes: CanvasNode[]): Map<string, XYPosition> {
  const used = new Map<CanvasNodeKind, number>();
  const positions = new Map<string, XYPosition>();
  for (const node of nodes) {
    if (positions.has(node.id)) continue;
    const index = used.get(node.kind) ?? 0;
    used.set(node.kind, index + 1);
    positions.set(node.id, topLeft(slot(node.kind, index)));
  }
  return positions;
}

// Presentation groups. They only frame real members: nothing runs "in" a group.
export type Group = "sources" | "toolbox";
export const GROUP_OF: Partial<Record<CanvasNodeKind, Group>> = {
  source: "sources",
  tool: "toolbox",
};
const GROUPS: { id: Group; kind: CanvasNodeKind }[] = [
  { id: "sources", kind: "source" },
  { id: "toolbox", kind: "tool" },
];
const ZONE_PAD = 20;
const ZONE_HEAD = 48; // room for the two-line label above the first member

export type ZoneData = { group: Group; count: number };
export type ZoneNode = Node<ZoneData, "zone">;

/**
 * Bounding box of each group's current members (so a dragged member keeps its frame). An empty
 * group frames the slot its first member would take, so "none yet" is visible, not hidden.
 * Nothing is drawn for a lone idle Domino.
 */
export function zones(nodes: FlowNode[]): ZoneNode[] {
  if (!nodes.some((node) => node.data.node.kind !== "domino")) return [];
  return GROUPS.map(({ id, kind }) => {
    const members = nodes.filter((node) => node.data.node.kind === kind);
    const spots = members.length ? members.map((node) => node.position) : [topLeft(slot(kind, 0))];
    const x = Math.min(...spots.map((p) => p.x)) - ZONE_PAD;
    const y = Math.min(...spots.map((p) => p.y)) - ZONE_HEAD;
    const right = Math.max(...spots.map((p) => p.x)) + NODE_W + ZONE_PAD;
    const bottom = Math.max(...spots.map((p) => p.y)) + NODE_H + ZONE_PAD;
    return {
      id: `zone-${id}`,
      type: "zone",
      position: { x, y },
      width: right - x,
      height: bottom - y,
      data: { group: id, count: members.length },
      zIndex: -1,
      selectable: false,
      draggable: false,
      focusable: false,
      connectable: false,
      deletable: false,
      ariaRole: "group",
      ariaLabel: `${id === "sources" ? "Sources" : "Toolbox"}: ${members.length} ${members.length === 1 ? "item" : "items"}`,
      className: "pointer-events-none",
    };
  });
}

export const KNOWLEDGE_ID = "company-knowledge";

/**
 * Company knowledge is a view of evidence already saved on source records, so it is derived here
 * and never invents a fact. It appears only once some source carries evidence.
 */
export function withKnowledge(nodes: CanvasNode[]): CanvasNode[] {
  const items = new Map<string, CanvasEvidence>();
  for (const node of nodes) {
    if (node.kind !== "source") continue;
    for (const item of node.evidence ?? []) if (!items.has(item.id)) items.set(item.id, item);
  }
  if (items.size === 0) return nodes;
  return [
    ...nodes,
    {
      id: KNOWLEDGE_ID,
      kind: "knowledge",
      title: "Company knowledge",
      status: "succeeded",
      summary:
        "A view of the evidence already saved for this investigation. It is not an agent and does nothing on its own.",
      evidence: [...items.values()],
    },
  ];
}

export const away = (c: CanvasConnection) =>
  c === "loading" || c === "offline" || c === "unavailable";

/** Content identity of a snapshot (ids and statuses), so a re-parsed identical array is not news. */
export const fingerprint = (nodes: CanvasNode[]) =>
  nodes.map((node) => `${node.id}:${node.status}`).join("|");

/** Quiet-until-changed latch. `print` is the last snapshot seen; `held` means a recovery is pending. */
export type Recovery = { held: boolean; print: string };

/**
 * Decide whether a delivery is history. Loading, offline and unavailable hold a latch. Once the
 * connection is back, unchanged (cached) snapshots stay quiet, and so does the first changed one
 * (the catch-up), which then releases the latch. Convex reports the socket connected before the
 * query catches up and carries no freshness marker, so a genuine live step that is the very first
 * change after a reconnect is also shown without motion. That is the deliberate conservative
 * tradeoff: a missed pulse is better than replaying old work as new.
 */
export function settle(
  recovery: Recovery,
  connection: CanvasConnection,
  incoming: CanvasNode[],
): { quiet: boolean; recovery: Recovery } {
  const print = fingerprint(incoming);
  const held = recovery.held || away(connection);
  if (!held) return { quiet: false, recovery: { held: false, print } };
  const release = !away(connection) && print !== recovery.print;
  return { quiet: true, recovery: { held: !release, print } };
}

export type Pulse = { key: string; edgeId: string };

/**
 * Pulses for newly recorded step activity: a node that is now running or done for the first time
 * lights each dependency that points at it, once. A failed step never pulses, and quiet
 * deliveries (restored history, reconnect) only remember what was already there. This marks
 * recorded activity, not measured data transfer.
 */
export function pulsesFor(
  seen: ReadonlySet<string>,
  incoming: CanvasNode[],
  edges: CanvasEdge[],
  quiet: boolean,
): { seen: Set<string>; pulses: Pulse[] } {
  const next = new Set(seen);
  const pulses: Pulse[] = [];
  for (const node of incoming) {
    const key = `${node.id}:${node.status}`;
    if (next.has(key)) continue;
    next.add(key);
    if (quiet || (node.status !== "running" && node.status !== "succeeded")) continue;
    for (const edge of edges) {
      if (edge.target === node.id)
        pulses.push({ key: `${edge.id}:${node.status}`, edgeId: edge.id });
    }
  }
  return { seen: next, pulses };
}

export const overlaps = (a: XYPosition, b: XYPosition) =>
  Math.abs(a.x - b.x) < NODE_BOX.w && Math.abs(a.y - b.y) < NODE_BOX.h;

/** Push a new node outward along its ray from the anchor until it clears everything, so nodes already on screen never move. */
function freeSlot(slot: XYPosition, taken: XYPosition[]): XYPosition {
  const cx = slot.x + NODE_W / 2;
  const cy = slot.y + CIRCLE_ROW / 2;
  const length = Math.hypot(cx, cy);
  const dir = length ? { x: cx / length, y: cy / length } : { x: 1, y: 0 };
  let at = slot;
  for (let step = 0; step < MAX_PUSH; step++) {
    at = {
      x: Math.round(slot.x + dir.x * PUSH * step),
      y: Math.round(slot.y + dir.y * PUSH * step),
    };
    if (!taken.some((spot) => overlaps(at, spot))) break;
  }
  return at;
}

/**
 * Turn a delivery into flow nodes. Known ids keep their dragged position, selection and
 * measurements; only new ids get a layout slot. `quiet` deliveries (restored history) never animate:
 * not the node entrance and not a status change on a node that is already on screen.
 */
export function toFlowNodes(
  current: FlowNode[],
  incoming: CanvasNode[],
  quiet: boolean,
): FlowNode[] {
  const known = new Map(current.map((node) => [node.id, node]));
  const positions = layout(incoming);
  // Layout alone only knows this delivery; sequential siblings would land on top of earlier ones.
  const taken = incoming.flatMap((node) => known.get(node.id)?.position ?? []);
  return incoming.map((node) => {
    const previous = known.get(node.id);
    if (previous) {
      return {
        ...previous,
        data: { node, enter: previous.data.enter, live: !quiet },
        ariaLabel: nodeLabel(node),
      };
    }
    const position = freeSlot(positions.get(node.id) ?? { x: 0, y: 0 }, taken);
    taken.push(position);
    return {
      id: node.id,
      type: "canvas",
      position,
      data: { node, enter: !quiet, live: !quiet },
      deletable: false,
      ariaLabel: nodeLabel(node),
      className: nodeClass,
    };
  });
}

// Shared by the initial fit, the Fit View button and auto-follow so a lone node never jumps to maxZoom.
export const loneFit = { padding: 0.8, maxZoom: 1 };
// No zoom floor of its own: a full fit must show the whole web. The person zooms in to read.
export const graphFit = { padding: 0.2, maxZoom: 1 };

/**
 * One delivery: the next nodes plus the fit to run, if any. The view follows new nodes until the
 * person moves it, and a quiet (history) or reduced-motion delivery jumps instead of animating.
 */
export function deliver(
  current: FlowNode[],
  incoming: CanvasNode[],
  options: { quiet: boolean; follow: boolean; reduced: boolean },
) {
  const nodes = toFlowNodes(current, incoming, options.quiet);
  const added = nodes.some((node) => !current.some((known) => known.id === node.id));
  const fit =
    added && options.follow
      ? {
          ...(nodes.length > 1 ? graphFit : loneFit),
          duration: options.quiet || options.reduced ? 0 : 300,
        }
      : null;
  return { nodes, fit };
}

/** Only http(s) evidence becomes a link; anything else (javascript:, data:, junk) stays text. */
export function safeHref(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}
