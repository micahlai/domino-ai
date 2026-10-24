import type { Node, XYPosition } from "@xyflow/react";
import type { CanvasEdge, CanvasNode, CanvasNodeKind, CanvasStatus } from "./types";

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
};

export const STATUS_LABEL: Record<CanvasStatus, string> = {
  idle: "Idle",
  queued: "Waiting",
  running: "Running",
  succeeded: "Done",
  failed: "Failed",
};

// Every node is NODE_W wide with its circle in a CIRCLE_ROW tall row at the top, so a circle always
// centers at (NODE_W / 2, CIRCLE_ROW / 2) and layout can reason in circle centers.
export const NODE_W = 144;
export const CIRCLE_ROW = 72;
// A rendered node is NODE_W x NODE_H: circle row 72, gap 6, two-line title 32, status line 16.
// NODE_BOX adds a gap, so two nodes closer than this on both axes overlap or nearly touch.
const NODE_H = 126;
export const NODE_BOX = { w: NODE_W + 8, h: NODE_H + 12 };
// Rings stay close so outputs are not far from the anchor and a full fit stays readable.
const RING_FIRST = 196; // a diagonal neighbour of the anchor still clears NODE_BOX
const RING_STEP = 140;
const ARC = 140; // least ring length each node on a ring needs, so crowded rings grow instead of overlap
const BEND = 0.6; // radians a lone child turns away from its parent, so a chain curves instead of lining up
const MAX_FAN = (2 * Math.PI) / 3;
const PUSH = 12; // small steps so a pushed node sits just clear, not a whole step too far
const MAX_PUSH = 600;

const nodeClass =
  "rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function nodeLabel(node: CanvasNode): string {
  const kind = node.kind === "domino" ? "" : `, ${KIND_LABEL[node.kind].toLowerCase()}`;
  return `${node.title}${kind}, ${STATUS_LABEL[node.status].toLowerCase()}. Press Enter for details.`;
}

/**
 * Radial web around the anchor (Domino, else the first node). Rings follow distance in the supplied
 * edges; each subtree gets a wedge sized by its leaf count. Positions only: no node or edge is added.
 * Cycles and shared dependencies keep their first (shortest) route, and a record with no route to
 * the anchor sits on the first ring. Returns top-left positions. Deterministic.
 */
export function layout(nodes: CanvasNode[], edges: CanvasEdge[]): Map<string, XYPosition> {
  const ids = [...new Set(nodes.map((node) => node.id))];
  const first = ids[0];
  if (first === undefined) return new Map();
  const anchor = nodes.find((node) => node.kind === "domino")?.id ?? first;

  const near = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const edge of edges) {
    if (edge.source === edge.target || !near.has(edge.source) || !near.has(edge.target)) continue;
    near.get(edge.source)?.push(edge.target);
    near.get(edge.target)?.push(edge.source);
  }

  const depth = new Map([[anchor, 0]]);
  const kids = new Map<string, string[]>(ids.map((id) => [id, []]));
  const queue = [anchor];
  let head = 0;
  const grow = () => {
    for (; head < queue.length; head++) {
      const from = queue[head] as string;
      for (const next of near.get(from) ?? []) {
        if (depth.has(next)) continue;
        depth.set(next, (depth.get(from) ?? 0) + 1);
        kids.get(from)?.push(next);
        queue.push(next);
      }
    }
  };
  grow();
  for (const id of ids) {
    if (depth.has(id)) continue;
    depth.set(id, 1);
    kids.get(anchor)?.push(id);
    queue.push(id);
    grow();
  }

  const leaves = new Map<string, number>();
  const countLeaves = (id: string): number => {
    const children = kids.get(id) ?? [];
    const total = children.length ? children.reduce((sum, c) => sum + countLeaves(c), 0) : 1;
    leaves.set(id, total);
    return total;
  };
  countLeaves(anchor);

  const crowd = new Map<number, number>();
  for (const level of depth.values()) crowd.set(level, (crowd.get(level) ?? 0) + 1);
  const radius = [0];
  for (let level = 1; level <= Math.max(...depth.values()); level++) {
    const base = level === 1 ? RING_FIRST : (radius[level - 1] ?? 0) + RING_STEP;
    radius[level] = Math.max(base, ((crowd.get(level) ?? 0) * ARC) / (2 * Math.PI));
  }

  const centers = new Map<string, XYPosition>([[anchor, { x: 0, y: 0 }]]);
  const place = (id: string, theta: number, lo: number, hi: number) => {
    const children = kids.get(id) ?? [];
    // Past the anchor a wedge stays near the direction the node already points.
    const from = id === anchor ? lo : Math.max(lo, theta - MAX_FAN / 2);
    const to = id === anchor ? hi : Math.min(hi, theta + MAX_FAN / 2);
    const ring = radius[(depth.get(id) ?? 0) + 1] ?? 0;
    let edge = from;
    for (const child of children) {
      const start = edge;
      edge += ((to - from) * (leaves.get(child) ?? 1)) / (leaves.get(id) ?? 1);
      const angle =
        children.length === 1 ? Math.min(to, Math.max(from, theta + BEND)) : (start + edge) / 2;
      centers.set(child, { x: ring * Math.cos(angle), y: ring * Math.sin(angle) });
      // A lone child keeps the open wedge so a chain can keep curving; branches split it.
      if (children.length === 1) place(child, angle, lo, hi);
      else place(child, angle, start, edge);
    }
  };
  place(anchor, -Math.PI / 2, -Math.PI, Math.PI);

  const positions = new Map<string, XYPosition>();
  for (const [id, c] of centers) {
    positions.set(id, {
      x: Math.round(c.x - NODE_W / 2),
      y: Math.round(c.y - CIRCLE_ROW / 2),
    });
  }
  return positions;
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
  edges: CanvasEdge[],
  quiet: boolean,
): FlowNode[] {
  const known = new Map(current.map((node) => [node.id, node]));
  const positions = layout(incoming, edges);
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
  edges: CanvasEdge[],
  options: { quiet: boolean; follow: boolean; reduced: boolean },
) {
  const nodes = toFlowNodes(current, incoming, edges, options.quiet);
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
