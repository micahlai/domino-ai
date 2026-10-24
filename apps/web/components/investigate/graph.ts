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

const COLUMN = 300;
const ROW = 120;

const nodeClass =
  "rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function nodeLabel(node: CanvasNode): string {
  const kind = node.kind === "domino" ? "" : `, ${KIND_LABEL[node.kind].toLowerCase()}`;
  return `${node.title}${kind}, ${STATUS_LABEL[node.status].toLowerCase()}. Press Enter for details.`;
}

/** Left-to-right columns by distance from the roots, in supplied order. Deterministic. */
// ponytail: O(nodes x edges) scan, fine for one investigation; index edges by source if graphs grow large.
export function layout(nodes: CanvasNode[], edges: CanvasEdge[]): Map<string, XYPosition> {
  const ids = new Set(nodes.map((node) => node.id));
  const live = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  const targets = new Set(live.map((edge) => edge.target));
  const queue = nodes.filter((node) => !targets.has(node.id)).map((node) => node.id);
  const depth = new Map(queue.map((id) => [id, 0]));
  for (let i = 0; i < queue.length; i++) {
    const from = queue[i] as string;
    for (const edge of live) {
      if (edge.source !== from || depth.has(edge.target)) continue;
      depth.set(edge.target, (depth.get(from) ?? 0) + 1);
      queue.push(edge.target);
    }
  }
  const columns = new Map<number, string[]>();
  for (const node of nodes) {
    const column = depth.get(node.id) ?? 0;
    columns.set(column, [...(columns.get(column) ?? []), node.id]);
  }
  const positions = new Map<string, XYPosition>();
  for (const [column, members] of columns) {
    members.forEach((id, row) => {
      positions.set(id, { x: column * COLUMN, y: (row - (members.length - 1) / 2) * ROW });
    });
  }
  return positions;
}

const clashes = (a: XYPosition, b: XYPosition) =>
  Math.abs(a.x - b.x) < COLUMN && Math.abs(a.y - b.y) < ROW;

/** Slide a new node down past anything it would overlap, so cards already on screen never move. */
function freeSlot(slot: XYPosition, taken: XYPosition[]): XYPosition {
  let at = slot;
  for (;;) {
    const hit = taken.find((spot) => clashes(at, spot));
    if (!hit) return at;
    at = { x: slot.x, y: hit.y + ROW };
  }
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
