import {
  type BrainGraph,
  type BrainNode,
  type EdgeKind,
  type ToolChip,
  isAgent,
  toolChips,
} from "./graph";

// Deterministic web layout for the brain map. Every top-level agent is the center of a cluster;
// the copies and helpers it started sit on a ring around it, and finished copies fold into one
// "+N finished" stack in that cluster. The coordinator (Analyst) cluster sits in the middle and
// the other clusters are pushed out around it, each along its own fixed direction, until nothing
// overlaps. Data sources form a column on the left, outputs a column on the right. No randomness
// and no simulation: the same graph always gives the same positions.

export type Box = { x: number; y: number; w: number; h: number; depth: number };
export type Point = { x: number; y: number };
export type Route = {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  /** Start, control point(s), end. */
  points: Point[];
  path: string;
};
/**
 * Agents of one cluster folded into a single card: a manager's completed helpers, or (cluster
 * "idle") built-in agents with no work yet. `expanded` stacks show their members and offer to
 * fold them again.
 */
export type Stack = {
  id: string;
  clusterId: string;
  members: string[];
  box: Box;
  expanded?: boolean;
};
export type Cluster = { id: string; members: string[]; bounds: Box };
/** A heading above one lane: data sources, agents or outputs. Not a card. */
export type Lane = { id: "source" | "agent" | "output"; x: number; y: number; w: number };
export type MapLayout = {
  boxes: Map<string, Box>;
  routes: Route[];
  chips: Map<string, ToolChip[]>;
  stacks: Stack[];
  clusters: Cluster[];
  lanes: Lane[];
  width: number;
  height: number;
};

export const ROOT_W = 272;
export const ROOT_HEADER_H = 64;
export const PILL_H = 28;
export const PILL_GAP = 8;
export const PILL_PAD = 10;
export const INSTANCE_W = 240;
export const INSTANCE_H = 64;
export const STACK_W = 240;
export const STACK_H = 44;
export const SIDE_W = 240;
export const SIDE_H = 60;
export const LANE_H = 20;
const SIDE_GAP = 16;
/** Horizontal room between the side columns and the web, for the links to curve through. */
const SIDE_MARGIN = 110;
const CLUSTER_GAP = 52;
const CHILD_GAP = 16;
/** Room between a lane heading and the first card under it. */
const LANE_GAP = 12;
/** Rings hold at least this many slots, so a cluster keeps its size while copies come and go. */
const MIN_RING = 8;
const PAD = 8;
export const IDLE_CLUSTER = "idle";
export const IDLE_STACK = `stack:${IDLE_CLUSTER}`;

/** Port height on a card: the middle of its header row. */
export const PORT_Y = 32;

/** Chips sit two per row under an agent's header. */
export const rootHeight = (chips: number) =>
  ROOT_HEADER_H +
  2 + // card border
  (chips > 0
    ? 1 + PILL_PAD * 2 + Math.ceil(chips / 2) * PILL_H + (Math.ceil(chips / 2) - 1) * PILL_GAP
    : 0);

/** Fixed directions (degrees, 0 = right, 90 = down) for clusters around the center one. */
const DIRECTIONS = [-150, 150, -30, 30, -90, 90, 180, 0, -120, 120, -60, 60];

const late = (n: BrainNode) =>
  n.agentKind === "system" || n.agentKind === "simulator" || n.agentKind === "person" ? 1 : 0;

/** Top-level agent each agent belongs to: helpers and copies join their topmost starter. */
export function clusterRoots(graph: BrainGraph): Map<string, string> {
  const agents = new Map(graph.nodes.filter(isAgent).map((n) => [n.id, n]));
  const root = new Map<string, string>();
  const find = (n: BrainNode, seen: Set<string>): string => {
    const parent = n.kind === "subagent" && n.parentId ? agents.get(n.parentId) : undefined;
    if (!parent || seen.has(parent.id)) return n.id;
    seen.add(n.id);
    return find(parent, seen);
  };
  for (const n of agents.values()) root.set(n.id, find(n, new Set()));
  return root;
}

type Local = { id: string; cx: number; cy: number; w: number; h: number; depth: number };

const hit = (a: Local, b: Local, gap: number) =>
  Math.abs(a.cx - b.cx) * 2 < a.w + b.w + gap * 2 &&
  Math.abs(a.cy - b.cy) * 2 < a.h + b.h + gap * 2;

/** One cluster in its own coordinates: the root at (0, 0), its copies on a ring around it. */
function layoutCluster(rootId: string, rootH: number, items: Local[]): Local[] {
  const root: Local = { id: rootId, cx: 0, cy: 0, w: ROOT_W, h: rootH, depth: 0 };
  if (items.length === 0) return [root];
  if (items.length <= 2) {
    // One or two helpers sit side by side under their manager.
    const y = rootH / 2 + 26 + INSTANCE_H / 2;
    const step = INSTANCE_W + CHILD_GAP;
    return [
      root,
      ...items.map((it, i) => ({ ...it, cx: (i - (items.length - 1) / 2) * step, cy: y })),
    ];
  }
  const slots = Math.max(items.length, MIN_RING);
  // Spread the items over the slots so a half-full ring is still balanced.
  const slotOf = (i: number) => Math.round((i * slots) / items.length) % slots;
  const place = (rx: number, ry: number) =>
    items.map((it, i) => {
      const a = (-90 + (slotOf(i) * 360) / slots) * (Math.PI / 180);
      return { ...it, cx: Math.round(rx * Math.cos(a)), cy: Math.round(ry * Math.sin(a)) };
    });
  // Size the ring for every slot, filled or not, so it does not breathe as copies come and go.
  const probe = (rx: number, ry: number) =>
    Array.from({ length: slots }, (_, k) => {
      const a = (-90 + (k * 360) / slots) * (Math.PI / 180);
      return {
        id: `slot${k}`,
        cx: Math.round(rx * Math.cos(a)),
        cy: Math.round(ry * Math.sin(a)),
        w: INSTANCE_W,
        h: INSTANCE_H,
        depth: 1,
      };
    });
  let rx = ROOT_W / 2 + INSTANCE_W / 2 + 28;
  let ry = rootH / 2 + INSTANCE_H / 2 + 24;
  for (let guard = 0; guard < 200; guard++) {
    const ring = probe(rx, ry);
    const clash = ring.some(
      (s, i) => hit(s, root, CHILD_GAP) || ring.some((t, j) => j > i && hit(s, t, CHILD_GAP)),
    );
    if (!clash) break;
    rx += 12;
    ry += 8;
  }
  return [root, ...place(rx, ry)];
}

const boundsOf = (items: Local[]) => {
  const x0 = Math.min(...items.map((i) => i.cx - i.w / 2));
  const y0 = Math.min(...items.map((i) => i.cy - i.h / 2));
  const x1 = Math.max(...items.map((i) => i.cx + i.w / 2));
  const y1 = Math.max(...items.map((i) => i.cy + i.h / 2));
  return { x0, y0, x1, y1 };
};

export type LayoutOptions = {
  /** Completed helpers to fold into their cluster's "N completed helpers" stack. */
  collapsed?: ReadonlySet<string>;
  /** Top-level agents with no work: folded into one "not used yet" card of their own. */
  idle?: readonly string[];
  /** Cluster ids (or IDLE_CLUSTER) whose folded agents are shown, with a card to fold them. */
  expanded?: ReadonlySet<string>;
};

export function layoutMap(graph: BrainGraph, options: LayoutOptions = {}): MapLayout {
  const collapsed = options.collapsed ?? new Set<string>();
  const expanded = options.expanded ?? new Set<string>();
  const idle = new Set(options.idle ?? []);
  const showIdle = expanded.has(IDLE_CLUSTER);
  const chips = new Map<string, ToolChip[]>();
  for (const n of graph.nodes) if (isAgent(n)) chips.set(n.id, toolChips(n));

  // Clusters, in graph order (built-ins first), with plain code and people last.
  const roots = clusterRoots(graph);
  const agents = graph.nodes.filter(isAgent);
  const rootNodes = agents
    .filter((n) => roots.get(n.id) === n.id && (showIdle || !idle.has(n.id)))
    .map((n, i) => ({ n, i }))
    .sort((a, b) => late(a.n) - late(b.n) || a.i - b.i)
    .map(({ n }) => n);
  const idleIds = agents.filter((n) => idle.has(n.id)).map((n) => n.id);
  const center =
    rootNodes.find((n) => n.id === "agent:analyst") ??
    [...rootNodes].sort(
      (a, b) =>
        agents.filter((x) => roots.get(x.id) === b.id).length -
        agents.filter((x) => roots.get(x.id) === a.id).length,
    )[0];

  const locals = new Map<string, Local[]>();
  const stacks: Stack[] = [];
  for (const root of rootNodes) {
    const members = agents.filter((n) => n.id !== root.id && roots.get(n.id) === root.id);
    const folded = members.filter((n) => collapsed.has(n.id)).map((n) => n.id);
    const open = expanded.has(root.id);
    const items: Local[] = members
      .filter((n) => open || !collapsed.has(n.id))
      .map((n) => ({ id: n.id, cx: 0, cy: 0, w: INSTANCE_W, h: INSTANCE_H, depth: 1 }));
    const stackId = `stack:${root.id}`;
    if (folded.length) items.push({ id: stackId, cx: 0, cy: 0, w: STACK_W, h: STACK_H, depth: 1 });
    locals.set(root.id, layoutCluster(root.id, rootHeight(chips.get(root.id)?.length ?? 0), items));
    if (folded.length)
      stacks.push({
        id: stackId,
        clusterId: root.id,
        members: folded,
        box: { x: 0, y: 0, w: STACK_W, h: STACK_H, depth: 1 },
        ...(open && { expanded: true }),
      });
  }
  // Agents not used yet: one card of their own, placed like a cluster after the rest.
  if (idleIds.length) {
    locals.set(IDLE_CLUSTER, [{ id: IDLE_STACK, cx: 0, cy: 0, w: STACK_W, h: STACK_H, depth: 0 }]);
    stacks.push({
      id: IDLE_STACK,
      clusterId: IDLE_CLUSTER,
      members: idleIds,
      box: { x: 0, y: 0, w: STACK_W, h: STACK_H, depth: 0 },
      ...(showIdle && { expanded: true }),
    });
  }

  // Place clusters: the center one at the origin, the rest pushed out along fixed directions.
  type Rect = { x0: number; y0: number; x1: number; y1: number };
  const placed: Rect[] = [];
  const offset = new Map<string, Point>();
  const overlapsAny = (r: Rect) =>
    placed.some(
      (p) =>
        r.x0 < p.x1 + CLUSTER_GAP &&
        p.x0 < r.x1 + CLUSTER_GAP &&
        r.y0 < p.y1 + CLUSTER_GAP &&
        p.y0 < r.y1 + CLUSTER_GAP,
    );
  const order = [
    ...(center ? [center, ...rootNodes.filter((n) => n !== center)] : rootNodes).map((n) => n.id),
    ...(idleIds.length ? [IDLE_CLUSTER] : []),
  ];
  order.forEach((rootId, i) => {
    const b = boundsOf(locals.get(rootId) ?? []);
    const deg =
      i === 0
        ? 0
        : (DIRECTIONS[(i - 1) % DIRECTIONS.length] ?? 0) +
          7 * Math.floor((i - 1) / DIRECTIONS.length);
    const a = (deg * Math.PI) / 180;
    // A wide screen: spread clusters further sideways than up and down.
    const dx = Math.cos(a);
    const dy = Math.sin(a) * 0.9;
    let d = 0;
    let at: Point = { x: 0, y: 0 };
    for (let guard = 0; guard < 2000; guard++) {
      at = { x: Math.round(dx * d), y: Math.round(dy * d) };
      const r = { x0: at.x + b.x0, y0: at.y + b.y0, x1: at.x + b.x1, y1: at.y + b.y1 };
      if (i === 0 || !overlapsAny(r)) {
        placed.push(r);
        break;
      }
      d += 8;
    }
    offset.set(rootId, at);
  });

  const boxes = new Map<string, Box>();
  const clusters: Cluster[] = [];
  for (const rootId of order) {
    const at = offset.get(rootId) ?? { x: 0, y: 0 };
    const items = locals.get(rootId) ?? [];
    for (const it of items) {
      const box = {
        x: at.x + it.cx - it.w / 2,
        y: at.y + it.cy - it.h / 2,
        w: it.w,
        h: it.h,
        depth: it.depth,
      };
      const stack = stacks.find((s) => s.id === it.id);
      if (stack) stack.box = box;
      else boxes.set(it.id, box);
    }
    const b = boundsOf(items);
    clusters.push({
      id: rootId,
      members: items.map((i) => i.id).filter((id) => !id.startsWith("stack:")),
      bounds: { x: at.x + b.x0, y: at.y + b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0, depth: 0 },
    });
  }

  // Side columns, each item next to the agents it links to.
  const web = {
    x0: Math.min(0, ...clusters.map((c) => c.bounds.x)),
    x1: Math.max(0, ...clusters.map((c) => c.bounds.x + c.bounds.w)),
    y0: Math.min(0, ...clusters.map((c) => c.bounds.y)),
    y1: Math.max(0, ...clusters.map((c) => c.bounds.y + c.bounds.h)),
  };
  const drawn = graph.edges.filter((e) => e.kind !== "uses");
  const column = (kind: "source" | "output", x: number) => {
    const items = graph.nodes.filter((n) => n.kind === kind);
    const partnerY = (id: string) => {
      const ys = drawn
        .filter((e) => (kind === "source" ? e.source === id : e.target === id))
        .flatMap((e) => boxes.get(kind === "source" ? e.target : e.source) ?? [])
        .map((b) => b.y + Math.min(PORT_Y, b.h / 2));
      return ys.length ? Math.min(...ys) : Number.POSITIVE_INFINITY;
    };
    const sorted = items
      .map((n, i) => ({ n, i, y: partnerY(n.id) }))
      .sort((a, b) => a.y - b.y || a.i - b.i);
    const height = items.length * SIDE_H + Math.max(0, items.length - 1) * SIDE_GAP;
    const linked = sorted.filter((s) => Number.isFinite(s.y));
    const mid = linked.length
      ? linked.reduce((sum, s) => sum + s.y, 0) / linked.length
      : (web.y0 + web.y1) / 2;
    const top = Math.min(Math.max(mid - height / 2, web.y0), Math.max(web.y0, web.y1 - height));
    sorted.forEach(({ n }, i) =>
      boxes.set(n.id, { x, y: top + i * (SIDE_H + SIDE_GAP), w: SIDE_W, h: SIDE_H, depth: 0 }),
    );
    return top;
  };
  const above = (top: number) => top - LANE_H - LANE_GAP;
  const sourceX = web.x0 - SIDE_MARGIN - SIDE_W;
  const outputX = web.x1 + SIDE_MARGIN;
  const lanes: Lane[] = [
    { id: "source", x: sourceX, y: above(column("source", sourceX)), w: SIDE_W },
    { id: "agent", x: web.x0, y: above(web.y0), w: Math.max(ROOT_W, web.x1 - web.x0) },
    { id: "output", x: outputX, y: above(column("output", outputX)), w: SIDE_W },
  ];

  // Shift everything so the top-left corner is (PAD, PAD).
  const all = [...boxes.values(), ...stacks.map((s) => s.box)];
  const minX = Math.min(...all.map((b) => b.x));
  const minY = Math.min(...all.map((b) => b.y), ...lanes.map((l) => l.y));
  const shift = (b: { x: number; y: number }) => {
    b.x = Math.round(b.x - minX + PAD);
    b.y = Math.round(b.y - minY + PAD);
  };
  for (const b of boxes.values()) shift(b);
  for (const s of stacks) shift(s.box);
  for (const c of clusters) shift(c.bounds);
  for (const l of lanes) shift(l);

  const routes: Route[] = [];
  for (const e of drawn) {
    const a = boxes.get(e.source);
    const b = boxes.get(e.target);
    if (!a || !b) continue;
    routes.push(routeFor(e.id, e.source, e.target, e.kind, a, b));
  }

  let width = 0;
  let height = 0;
  for (const b of [...boxes.values(), ...stacks.map((s) => s.box)]) {
    width = Math.max(width, b.x + b.w);
    height = Math.max(height, b.y + b.h);
  }
  return {
    boxes,
    routes,
    chips,
    stacks,
    clusters,
    lanes,
    width: width + PAD,
    height: height + PAD,
  };
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const fmt = (p: Point) => `${r1(p.x)},${r1(p.y)}`;

/** Where the line from a box's center toward `toward` leaves the box. */
function exitPoint(b: Box, toward: Point): Point {
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const t = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : b.w / 2 / Math.abs(dx),
    dy === 0 ? Number.POSITIVE_INFINITY : b.h / 2 / Math.abs(dy),
  );
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/**
 * Light curves. Sources and outputs use a horizontal S-curve into an agent's header port; links
 * between agents bow slightly to one side so a pair's link never hides under a straight line.
 */
function routeFor(
  id: string,
  source: string,
  target: string,
  kind: EdgeKind,
  a: Box,
  b: Box,
): Route {
  if (kind === "feeds" || kind === "produces") {
    const from =
      kind === "feeds"
        ? { x: a.x + a.w, y: a.y + a.h / 2 }
        : { x: a.x + a.w, y: a.y + Math.min(PORT_Y, a.h / 2) };
    const to =
      kind === "feeds"
        ? { x: b.x, y: b.y + Math.min(PORT_Y, b.h / 2) }
        : { x: b.x, y: b.y + b.h / 2 };
    const k = Math.max(48, Math.abs(to.x - from.x) * 0.45);
    const c1 = { x: from.x + k, y: from.y };
    const c2 = { x: to.x - k, y: to.y };
    return {
      id,
      source,
      target,
      kind,
      points: [from, c1, c2, to],
      path: `M${fmt(from)} C${fmt(c1)} ${fmt(c2)} ${fmt(to)}`,
    };
  }
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const from = exitPoint(a, cb);
  const to = exitPoint(b, ca);
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const bend = Math.min(56, len * (kind === "handoff" ? 0.08 : 0.16));
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const control = {
    x: mid.x - ((to.y - from.y) / len) * bend,
    y: mid.y + ((to.x - from.x) / len) * bend,
  };
  return {
    id,
    source,
    target,
    kind,
    points: [from, control, to],
    path: `M${fmt(from)} Q${fmt(control)} ${fmt(to)}`,
  };
}

/** Card pairs that overlap on screen, stacks included. */
export function overlaps(layout: MapLayout, gap = 0): [string, string][] {
  const found: [string, string][] = [];
  const all: [string, Box][] = [
    ...layout.boxes.entries(),
    ...layout.stacks.map((s): [string, Box] => [s.id, s.box]),
  ];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const [ia, a] = all[i] as [string, Box];
      const [ib, b] = all[j] as [string, Box];
      if (
        a.x < b.x + b.w + gap &&
        b.x < a.x + a.w + gap &&
        a.y < b.y + b.h + gap &&
        b.y < a.y + a.h + gap
      )
        found.push([ia, ib]);
    }
  return found;
}
