import { type BrainGraph, type BrainNode, type ToolChip, isAgent, toolChips } from "./graph";

// Deterministic three-lane layout for the brain map: positions, sizes and every link's route.
// Links are orthogonal with rounded corners and consistent ports: sources enter an agent's left
// port, outputs leave its right port, and a manager's link to its helper runs down a tree rail.
// Each agent's sources (and outputs) are placed as one block next to it, below the previous
// agent's port, so links into different agents never share a trunk or cross.

export type Box = { x: number; y: number; w: number; h: number; depth: number };
export type Point = { x: number; y: number };
export type Route = { id: string; source: string; target: string; points: Point[]; path: string };
export type Lane = { id: "source" | "agent" | "output"; title: string; x: number; w: number };
export type MapLayout = {
  boxes: Map<string, Box>;
  routes: Route[];
  chips: Map<string, ToolChip[]>;
  lanes: Lane[];
  width: number;
  height: number;
};

export const LANES: Lane[] = [
  { id: "source", title: "Data sources", x: 0, w: 232 },
  { id: "agent", title: "Agents", x: 352, w: 312 },
  { id: "output", title: "Outputs", x: 784, w: 232 },
];
const [SOURCE_LANE, AGENT_LANE, OUTPUT_LANE] = LANES as [Lane, Lane, Lane];

/** First card row; the lane header sits above it. */
export const TOP = 56;
export const SOURCE_H = 56;
export const OUTPUT_H = 56;
export const ITEM_GAP = 12;
export const AGENT_HEADER_H = 60;
export const CHIP_H = 28;
export const CHIP_PAD = 8;
/** Port height on a card: the middle of its header row. */
export const PORT_Y = 28;
const INDENT = 28;
const ROOT_GAP = 24;
const CHILD_GAP = 12;
/** Offset of the trunk for links that are not an item's main link. */
const SECONDARY = 14;
const RADIUS = 10;

export const agentHeight = (chips: number) =>
  AGENT_HEADER_H + (chips > 0 ? chips * CHIP_H + CHIP_PAD * 2 + 1 : 0);

/** Agents top to bottom: each manager directly followed by its helpers (depth first). */
function agentOrder(graph: BrainGraph): { node: BrainNode; depth: number }[] {
  const agents = graph.nodes.filter(isAgent);
  const parent = new Map<string, string>();
  for (const e of graph.edges)
    if (e.kind === "handoff" && !parent.has(e.target) && e.source !== e.target)
      parent.set(e.target, e.source);
  const late = (n: BrainNode) =>
    n.agentKind === "system" || n.agentKind === "simulator" || n.agentKind === "person" ? 1 : 0;
  const roots = agents
    .filter((n) => !parent.has(n.id) || !agents.some((a) => a.id === parent.get(n.id)))
    .map((n, i) => ({ n, i }))
    .sort((a, b) => late(a.n) - late(b.n) || a.i - b.i)
    .map(({ n }) => n);
  const out: { node: BrainNode; depth: number }[] = [];
  const seen = new Set<string>();
  const visit = (node: BrainNode, depth: number) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    out.push({ node, depth });
    for (const child of agents) if (parent.get(child.id) === node.id) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  // A handoff cycle has no root; show what is left at the top level rather than drop it.
  for (const node of agents) visit(node, 0);
  return out;
}

/** Stack items next to the agents they connect to: one block per agent, in agent order. */
function placeSide(
  items: BrainNode[],
  primaryOf: (id: string) => string | undefined,
  agentRank: Map<string, number>,
  portY: Map<string, number>,
  itemH: number,
): Map<string, number> {
  const rank = (id: string) => {
    const p = primaryOf(id);
    return p === undefined ? Number.POSITIVE_INFINITY : (agentRank.get(p) ?? 1e9);
  };
  const sorted = items
    .map((n, i) => ({ n, i }))
    .sort((a, b) => rank(a.n.id) - rank(b.n.id) || a.i - b.i);
  const groups: { agent?: string; ids: string[] }[] = [];
  for (const { n } of sorted) {
    const agent = primaryOf(n.id);
    const last = groups.at(-1);
    if (last && last.agent === agent) last.ids.push(n.id);
    else groups.push({ agent, ids: [n.id] });
  }
  const ys = new Map<string, number>();
  let cursor = TOP;
  let floor = TOP;
  for (const g of groups) {
    const height = g.ids.length * itemH + (g.ids.length - 1) * ITEM_GAP;
    const port = g.agent ? portY.get(g.agent) : undefined;
    let start = port === undefined ? cursor : port - height / 2;
    // Below the previous block and strictly below the previous agent's port: trunks never meet.
    start = Math.max(start, cursor, floor);
    g.ids.forEach((id, i) => ys.set(id, start + i * (itemH + ITEM_GAP)));
    cursor = start + height + ITEM_GAP;
    if (port !== undefined) floor = Math.max(floor, port + ITEM_GAP);
  }
  return ys;
}

export function layoutMap(graph: BrainGraph): MapLayout {
  const boxes = new Map<string, Box>();
  const chips = new Map<string, ToolChip[]>();

  // Agents lane.
  const order = agentOrder(graph);
  const agentRank = new Map(order.map((a, i) => [a.node.id, i]));
  const portY = new Map<string, number>();
  let y = TOP;
  order.forEach(({ node, depth }, i) => {
    const mine = toolChips(node);
    chips.set(node.id, mine);
    if (i > 0) y += depth > 0 ? CHILD_GAP : ROOT_GAP;
    const indent = Math.min(depth, 3) * INDENT;
    const h = agentHeight(mine.length);
    boxes.set(node.id, { x: AGENT_LANE.x + indent, y, w: AGENT_LANE.w - indent, h, depth });
    portY.set(node.id, y + PORT_Y);
    y += h;
  });

  // Side lanes: each item's main agent is the highest one it links to.
  const drawn = graph.edges.filter((e) => e.kind !== "uses");
  const primary = (links: { item: string; agent: string }[]) => {
    const best = new Map<string, string>();
    for (const { item, agent } of links) {
      const current = best.get(item);
      if (!agentRank.has(agent)) continue;
      if (current === undefined || (agentRank.get(agent) ?? 0) < (agentRank.get(current) ?? 0))
        best.set(item, agent);
    }
    return best;
  };
  const feeds = drawn.filter((e) => e.kind === "feeds");
  const produces = drawn.filter((e) => e.kind === "produces");
  const sourceMain = primary(feeds.map((e) => ({ item: e.source, agent: e.target })));
  const outputMain = primary(produces.map((e) => ({ item: e.target, agent: e.source })));
  const sources = graph.nodes.filter((n) => n.kind === "source");
  const outputs = graph.nodes.filter((n) => n.kind === "output");
  const sy = placeSide(sources, (id) => sourceMain.get(id), agentRank, portY, SOURCE_H);
  const oy = placeSide(outputs, (id) => outputMain.get(id), agentRank, portY, OUTPUT_H);
  for (const n of sources)
    boxes.set(n.id, {
      x: SOURCE_LANE.x,
      y: sy.get(n.id) ?? TOP,
      w: SOURCE_LANE.w,
      h: SOURCE_H,
      depth: 0,
    });
  for (const n of outputs)
    boxes.set(n.id, {
      x: OUTPUT_LANE.x,
      y: oy.get(n.id) ?? TOP,
      w: OUTPUT_LANE.w,
      h: OUTPUT_H,
      depth: 0,
    });

  // Routes.
  const leftBus = (SOURCE_LANE.x + SOURCE_LANE.w + AGENT_LANE.x) / 2;
  const rightBus = (AGENT_LANE.x + AGENT_LANE.w + OUTPUT_LANE.x) / 2;
  const routes: Route[] = [];
  for (const e of drawn) {
    const a = boxes.get(e.source);
    const b = boxes.get(e.target);
    if (!a || !b) continue;
    let points: Point[];
    if (e.kind === "feeds") {
      const bus = leftBus + (sourceMain.get(e.source) === e.target ? 0 : SECONDARY);
      const from = { x: a.x + a.w, y: a.y + a.h / 2 };
      const to = { x: b.x, y: b.y + PORT_Y };
      points = [from, { x: bus, y: from.y }, { x: bus, y: to.y }, to];
    } else if (e.kind === "produces") {
      const bus = rightBus - (outputMain.get(e.target) === e.source ? 0 : SECONDARY);
      const from = { x: a.x + a.w, y: a.y + PORT_Y };
      const to = { x: b.x, y: b.y + b.h / 2 };
      points = [from, { x: bus, y: from.y }, { x: bus, y: to.y }, to];
    } else {
      // Manager -> helper: down a rail just inside the manager's left edge, then into the helper.
      const rail = a.x + INDENT / 2;
      const to = { x: b.x, y: b.y + PORT_Y };
      points =
        b.x > rail
          ? [{ x: rail, y: a.y + a.h }, { x: rail, y: to.y }, to]
          : [
              { x: a.x + a.w / 2, y: a.y + a.h },
              { x: a.x + a.w / 2, y: b.y },
            ];
    }
    points = simplify(points);
    routes.push({
      id: e.id,
      source: e.source,
      target: e.target,
      points,
      path: roundedPath(points),
    });
  }

  let height = TOP;
  for (const b of boxes.values()) height = Math.max(height, b.y + b.h);
  return {
    boxes,
    routes,
    chips,
    lanes: LANES,
    width: OUTPUT_LANE.x + OUTPUT_LANE.w,
    height: height + 24,
  };
}

/** Drop repeated and collinear points, so a straight link is one segment. */
function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    const prev = out.at(-2);
    if (last && prev) {
      const sameX = Math.abs(prev.x - last.x) < 0.5 && Math.abs(last.x - p.x) < 0.5;
      const sameY = Math.abs(prev.y - last.y) < 0.5 && Math.abs(last.y - p.y) < 0.5;
      if (sameX || sameY) out.pop();
    }
    out.push(p);
  }
  return out;
}

/** SVG path through orthogonal points with rounded corners. */
export function roundedPath(points: Point[], radius = RADIUS): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points as [Point, ...Point[]];
  let d = `M${first.x},${first.y}`;
  for (let i = 0; i < rest.length; i++) {
    const corner = rest[i] as Point;
    const prev = points[i] as Point;
    const next = rest[i + 1];
    if (!next) {
      d += ` L${corner.x},${corner.y}`;
      break;
    }
    const inLen = Math.hypot(corner.x - prev.x, corner.y - prev.y);
    const outLen = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const a = {
      x: corner.x - ((corner.x - prev.x) / inLen) * r,
      y: corner.y - ((corner.y - prev.y) / inLen) * r,
    };
    const b = {
      x: corner.x + ((next.x - corner.x) / outLen) * r,
      y: corner.y + ((next.y - corner.y) / outLen) * r,
    };
    d += ` L${a.x},${a.y} Q${corner.x},${corner.y} ${b.x},${b.y}`;
  }
  return d;
}

type Segment = { a: Point; b: Point };
const segments = (points: Point[]): Segment[] =>
  points.slice(1).map((b, i) => ({ a: points[i] as Point, b }));
const between = (v: number, p: number, q: number) => v > Math.min(p, q) && v < Math.max(p, q);
const overlap = (p1: number, q1: number, p2: number, q2: number) =>
  Math.min(Math.max(p1, q1), Math.max(p2, q2)) - Math.max(Math.min(p1, q1), Math.min(p2, q2)) > 0;

function segmentsMeet(s: Segment, t: Segment): boolean {
  const sH = s.a.y === s.b.y;
  const tH = t.a.y === t.b.y;
  if (sH && tH) return s.a.y === t.a.y && overlap(s.a.x, s.b.x, t.a.x, t.b.x);
  if (!sH && !tH) return s.a.x === t.a.x && overlap(s.a.y, s.b.y, t.a.y, t.b.y);
  const [h, v] = sH ? [s, t] : [t, s];
  return between(v.a.x, h.a.x, h.b.x) && between(h.a.y, v.a.y, v.b.y);
}

/**
 * Pairs of links that cross or run on top of each other. Links that share an end node are
 * bundled on purpose (one trunk into one port), so they are not counted.
 */
export function crossings(layout: MapLayout): [string, string][] {
  const found: [string, string][] = [];
  const { routes } = layout;
  for (let i = 0; i < routes.length; i++)
    for (let j = i + 1; j < routes.length; j++) {
      const r = routes[i] as Route;
      const q = routes[j] as Route;
      const shared = [r.source, r.target].some((id) => id === q.source || id === q.target);
      if (shared) continue;
      const hit = segments(r.points).some((s) =>
        segments(q.points).some((t) => segmentsMeet(s, t)),
      );
      if (hit) found.push([r.id, q.id]);
    }
  return found;
}

/** Card pairs that overlap on screen. */
export function overlaps(layout: MapLayout): [string, string][] {
  const found: [string, string][] = [];
  const all = [...layout.boxes.entries()];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const [ia, a] = all[i] as [string, Box];
      const [ib, b] = all[j] as [string, Box];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)
        found.push([ia, ib]);
    }
  return found;
}
