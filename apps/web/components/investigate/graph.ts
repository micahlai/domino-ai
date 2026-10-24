import type { Node, XYPosition } from "@xyflow/react";
import type { CanvasEdge, CanvasNode, CanvasNodeKind, CanvasStatus } from "./types";

export type FlowData = { node: CanvasNode; enter: boolean };
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

/**
 * Turn a delivery into flow nodes. Known ids keep their dragged position, selection and
 * measurements; only new ids get a layout slot. `quiet` deliveries (restored history) never animate.
 */
export function toFlowNodes(
  current: FlowNode[],
  incoming: CanvasNode[],
  edges: CanvasEdge[],
  quiet: boolean,
): FlowNode[] {
  const known = new Map(current.map((node) => [node.id, node]));
  const positions = layout(incoming, edges);
  return incoming.map((node) => {
    const previous = known.get(node.id);
    if (previous) {
      return {
        ...previous,
        data: { node, enter: previous.data.enter },
        ariaLabel: nodeLabel(node),
      };
    }
    return {
      id: node.id,
      type: "canvas",
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      data: { node, enter: !quiet },
      deletable: false,
      ariaLabel: nodeLabel(node),
      className: nodeClass,
    };
  });
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
