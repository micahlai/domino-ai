import {
  type BrainGraph,
  type BrainNode,
  type EdgeKind,
  type ToolChip,
  type ToolboxGroup,
  isAgent,
  toolChips,
} from "./graph";

// Deterministic web layout for the brain map. Every node is a compact card. The coordinator
// (Analyst) sits at the origin with rows of reserved helper slots above and below it. Left of it,
// in fixed homes by role, sit the audit swarm and then the ingestion agent (feeds above it), so
// the map always reads sources -> ingestion -> audit -> analyst -> outputs, whatever order the
// log shows them in. Every other top-level agent is a satellite in a column right of the
// coordinator, with its helpers in rows of reserved slots under it. Sources form a column on the left, outputs
// a column on the right, and outside tools (Apify, Claude, CREAO) a toolbox under the outputs.
// No randomness and no simulation.
//
// Stability: pass the previous layout's `memory` back in and nodes keep their places. A helper
// keeps its slot, a cluster keeps its direction and distance (it only moves outward, and only if
// something grew into it), reserved slots never shrink, and the side lanes and toolbox keep their
// anchors. New nodes take the next free reserved slot, so existing nodes never move on updates.

export type Box = { x: number; y: number; w: number; h: number; depth: number };
export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
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
/** A heading above one lane. Not a card. */
export type Lane = {
  id: "source" | "agent" | "output" | "toolbox";
  x: number;
  y: number;
  w: number;
};
/** What a layout remembers so the next one keeps every existing node in place. */
export type LayoutMemory = {
  center?: string;
  /** Clusters other than the center, in first-seen order. */
  order: string[];
  /** Cluster -> its side of the center (-1 left, 1 right, 0 below) and its place. */
  side: Map<string, number>;
  at: Map<string, Point>;
  /** Cluster -> reserved helper tiers (center: rings, satellites: rows). Never shrinks. */
  tiers: Map<string, number>;
  /** Helper id -> its slot in its cluster. */
  slots: Map<string, number>;
  /** Right edge of the sources lane, left edge of the outputs lane, and each lane's top. */
  sourceRight?: number;
  outputLeft?: number;
  top: Partial<Record<"source" | "output" | "toolbox", number>>;
  /** Toolbox cards in first-seen order. */
  toolbox: string[];
};
export type MapLayout = {
  boxes: Map<string, Box>;
  routes: Route[];
  chips: Map<string, ToolChip[]>;
  stacks: Stack[];
  clusters: Cluster[];
  lanes: Lane[];
  /** The cards and lane headings drawn now (no reserved room): what the camera fits. */
  bounds: Rect;
  memory: LayoutMemory;
};

export const CENTER_W = 240;
export const ROOT_W = 208;
export const ROOT_HEADER_H = 56;
export const PILL_H = 26;
export const PILL_GAP = 6;
export const PILL_PAD = 8;
/** Root cards show at most this many tool chips; the rest fold into a "+N" chip. */
export const MAX_CHIPS = 4;
export const INSTANCE_W = 176;
export const INSTANCE_H = 52;
export const STACK_W = 176;
export const STACK_H = 40;
export const SIDE_W = 160;
export const SIDE_H = 48;
export const TOOLBOX_W = SIDE_W;
export const TOOLBOX_HEADER_H = 44;
export const TOOL_ROW_H = 24;
/** Tool rows a toolbox card shows (the last says "+N more" when there are more). */
export const TOOLBOX_ROWS = 4;
const TOOLBOX_GAP = 12;
export const LANE_H = 20;
const GAP = 10;
const SIDE_GAP = 8;
const CLUSTER_GAP = 24;
/** Room between the side lanes and the web, for the links to curve through. */
const SIDE_MARGIN = 44;
const LANE_GAP = 12;
/** Satellites: helpers in rows of two under the agent; slot 1 (row 0, right) holds the stack. */
const ROW = 2;
const ROW_STACK = 1;
const STEP = 4;
export const IDLE_CLUSTER = "idle";
export const IDLE_STACK = `stack:${IDLE_CLUSTER}`;
export const CENTER_ID = "agent:analyst";

/**
 * Fixed homes left of the coordinator, by role. Column 0 sits next to it. Placement never depends
 * on which agent the loaded log window happens to show first: the log is paged (latest rows
 * only), so arrival order is not the pipeline order. `above` agents stack upward from row 0.
 */
const HOMES: Record<string, { column: number; above?: boolean }> = {
  "agent:audit": { column: 0 },
  "agent:ingestion": { column: 1 },
  "agent:mock-feed": { column: 1, above: true },
  "agent:sim-clock": { column: 1, above: true },
};
const HOME_COLUMNS = 2;

/** Port height on a card: the middle of its header row. */
export const PORT_Y = 28;

/** Chips sit two per row under an agent's header; at most MAX_CHIPS show. */
export const rootHeight = (chips: number) => {
  const rows = Math.ceil(Math.min(chips, MAX_CHIPS) / 2);
  return (
    ROOT_HEADER_H + 2 + (rows > 0 ? 1 + PILL_PAD * 2 + rows * PILL_H + (rows - 1) * PILL_GAP : 0)
  );
};
/** Every root card reserves room for its tallest form, so growing chips never move a neighbor. */
const ROOT_RESERVED_H = rootHeight(MAX_CHIPS);
export const toolboxHeight = (items: number) =>
  TOOLBOX_HEADER_H + Math.max(1, items) * TOOL_ROW_H + 8;

/** Satellite columns hold clusters this far above and below the center before a new column. */
const COLUMN_HALF = 240;

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

/** One card in its cluster's coordinates: `h` is the room it reserves, `real` its drawn height. */
type Local = {
  id: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  real: number;
  depth: number;
};

const card = (id: string, w: number, h: number, depth: number, real = h): Local => ({
  id,
  cx: 0,
  cy: 0,
  w,
  h,
  real,
  depth,
});

// --- Reserved slot geometry ---------------------------------------------------------------

type Shape = {
  stackSlot: number;
  tierOf: (slot: number) => number;
  slotCount: (tiers: number) => number;
  at: (slot: number) => Point;
  /** Helper slots of one tier in fill order, without the stack slot. */
  fill: (tier: number) => number[];
};

/** Distance from a root card's center to the middle of its k-th helper row. */
const rowY = (k: number) => ROOT_RESERVED_H / 2 + GAP + INSTANCE_H / 2 + k * (INSTANCE_H + GAP);

/**
 * The coordinator's helpers: rows of two, alternating below and above it (row 0 below, row 1
 * above, row 2 below...), so the cluster stays as narrow as a satellite and the pipeline row
 * reads left to right without a wide empty ring. Slot 1 (row 0, right) holds its stack.
 */
const CENTER_SHAPE: Shape = {
  stackSlot: ROW_STACK,
  tierOf: (slot) => Math.floor(slot / ROW),
  slotCount: (tiers) => tiers * ROW,
  at: (slot) => {
    const row = Math.floor(slot / ROW);
    const col = slot % ROW === 0 ? -1 : 1;
    const y = rowY(Math.floor(row / 2));
    return { x: (col * (INSTANCE_W + GAP)) / 2, y: row % 2 === 0 ? y : -y };
  },
  fill: (tier) =>
    Array.from({ length: ROW }, (_, i) => tier * ROW + i).filter((s) => s !== ROW_STACK),
};

const SATELLITE_SHAPE: Shape = {
  stackSlot: ROW_STACK,
  tierOf: (slot) => Math.floor(slot / ROW),
  slotCount: (tiers) => tiers * ROW,
  at: (slot) => {
    const row = Math.floor(slot / ROW);
    const col = slot % ROW === 0 ? -1 : 1;
    return {
      x: (col * (INSTANCE_W + GAP)) / 2,
      y: rowY(row),
    };
  },
  fill: (tier) =>
    Array.from({ length: ROW }, (_, i) => tier * ROW + i).filter((s) => s !== ROW_STACK),
};

/**
 * Slots for a cluster's helpers: each keeps its remembered slot, new ones take the next free slot
 * in fill order. Returns the slot of every helper and how many tiers are reserved.
 */
function assignSlots(
  shape: Shape,
  ids: readonly string[],
  hasStack: boolean,
  remembered: ReadonlyMap<string, number>,
  minTiers: number,
): { slots: Map<string, number>; tiers: number } {
  const slots = new Map<string, number>();
  const taken = new Set<number>(hasStack ? [shape.stackSlot] : []);
  for (const id of ids) {
    const s = remembered.get(id);
    if (s === undefined || s === shape.stackSlot || taken.has(s)) continue;
    slots.set(id, s);
    taken.add(s);
  }
  let tier = 0;
  let order = shape.fill(0);
  let cursor = 0;
  for (const id of ids) {
    if (slots.has(id)) continue;
    for (;;) {
      if (cursor >= order.length) {
        tier += 1;
        order = shape.fill(tier);
        cursor = 0;
      }
      const s = order[cursor++] as number;
      if (taken.has(s)) continue;
      slots.set(id, s);
      taken.add(s);
      break;
    }
  }
  const top = Math.max(-1, ...taken);
  return { slots, tiers: Math.max(minTiers, top < 0 ? 0 : shape.tierOf(top) + 1) };
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
  /** Outside tools by provider, one toolbox card each (toolboxGroups()). */
  toolbox?: readonly ToolboxGroup[];
  /** The previous layout's memory, so existing nodes keep their places. */
  memory?: LayoutMemory;
};

export function layoutMap(graph: BrainGraph, options: LayoutOptions = {}): MapLayout {
  const collapsed = options.collapsed ?? new Set<string>();
  const expanded = options.expanded ?? new Set<string>();
  const mem = options.memory;
  const showIdle = expanded.has(IDLE_CLUSTER);
  const chips = new Map<string, ToolChip[]>();
  for (const n of graph.nodes) if (isAgent(n)) chips.set(n.id, toolChips(n));

  const roots = clusterRoots(graph);
  const agents = graph.nodes.filter(isAgent);
  const isRoot = (n: BrainNode) => roots.get(n.id) === n.id;
  const size = (id: string) => agents.filter((x) => roots.get(x.id) === id).length;
  // The coordinator always holds the middle, even before it has work, so nothing moves when it
  // starts. Without one, the biggest cluster takes the middle.
  const optionIdle = new Set(options.idle ?? []);
  const centerId =
    (mem?.center && agents.some((n) => n.id === mem.center) ? mem.center : undefined) ??
    (agents.some((n) => n.id === CENTER_ID) ? CENTER_ID : undefined) ??
    agents
      .filter((n) => isRoot(n) && !optionIdle.has(n.id))
      .sort((a, b) => size(b.id) - size(a.id))[0]?.id;
  const idle = new Set([...optionIdle].filter((id) => id !== centerId));
  const rootNodes = agents
    .filter((n) => isRoot(n) && (showIdle || !idle.has(n.id)))
    .map((n, i) => ({ n, i }))
    .sort((a, b) => late(a.n) - late(b.n) || a.i - b.i)
    .map(({ n }) => n);
  const idleIds = agents.filter((n) => idle.has(n.id)).map((n) => n.id);

  const memory: LayoutMemory = {
    ...(centerId && { center: centerId }),
    order: [],
    side: new Map(mem?.side),
    at: new Map(),
    tiers: new Map(mem?.tiers),
    slots: new Map(),
    top: { ...mem?.top },
    toolbox: [...(mem?.toolbox ?? [])],
  };

  // Each cluster in its own coordinates: the agent at (0, 0), helpers in reserved slots.
  const locals = new Map<string, Local[]>();
  const reserves = new Map<string, Local[]>();
  const stacks: Stack[] = [];
  for (const root of rootNodes) {
    const center = root.id === centerId;
    const shape = center ? CENTER_SHAPE : SATELLITE_SHAPE;
    const members = agents.filter((n) => n.id !== root.id && roots.get(n.id) === root.id);
    const folded = members.filter((n) => collapsed.has(n.id)).map((n) => n.id);
    const open = expanded.has(root.id);
    const shown = members.filter((n) => !collapsed.has(n.id)).map((n) => n.id);
    // Live helpers first so they keep their slots; opened folded ones fill in after them.
    const ids = open ? [...shown, ...folded] : shown;
    const stackId = `stack:${root.id}`;
    const placed = assignSlots(
      shape,
      ids,
      folded.length > 0,
      mem?.slots ?? new Map(),
      Math.max(center ? 1 : 0, mem?.tiers.get(root.id) ?? 0),
    );
    memory.tiers.set(root.id, placed.tiers);
    for (const [id, s] of placed.slots) memory.slots.set(id, s);
    const items: Local[] = [
      card(
        root.id,
        center ? CENTER_W : ROOT_W,
        ROOT_RESERVED_H,
        0,
        rootHeight(chips.get(root.id)?.length ?? 0),
      ),
    ];
    for (const [id, s] of placed.slots) {
      const p = shape.at(s);
      items.push({ ...card(id, INSTANCE_W, INSTANCE_H, 1), cx: p.x, cy: p.y });
    }
    if (folded.length) {
      const p = shape.at(shape.stackSlot);
      items.push({ ...card(stackId, STACK_W, STACK_H, 1), cx: p.x, cy: p.y });
      stacks.push({
        id: stackId,
        clusterId: root.id,
        members: folded,
        box: { x: 0, y: 0, w: STACK_W, h: STACK_H, depth: 1 },
        ...(open && { expanded: true }),
      });
    }
    // Reserve every slot of every tier, filled or not, so the cluster keeps its size.
    const reserve = Array.from({ length: shape.slotCount(placed.tiers) }, (_, s) => {
      const p = shape.at(s);
      return { ...card(`slot${s}`, INSTANCE_W, INSTANCE_H, 1), cx: p.x, cy: p.y };
    });
    locals.set(root.id, items);
    reserves.set(root.id, [...items, ...reserve]);
  }
  if (idleIds.length) {
    const tile = card(IDLE_STACK, STACK_W, STACK_H, 0);
    locals.set(IDLE_CLUSTER, [tile]);
    reserves.set(IDLE_CLUSTER, [tile]);
    stacks.push({
      id: IDLE_STACK,
      clusterId: IDLE_CLUSTER,
      members: idleIds,
      box: { x: 0, y: 0, w: STACK_W, h: STACK_H, depth: 0 },
      ...(showIdle && { expanded: true }),
    });
  }

  // Place clusters: the center at the origin, pipeline agents in their fixed homes on the left,
  // other satellites in columns on the right (each as near the middle as it fits), idle agents
  // straight below. Remembered right-side clusters keep their place and only move outward, and
  // only if something grew into them.
  type R = { x0: number; y0: number; x1: number; y1: number };
  const placedRects: R[] = [];
  const offset = new Map<string, Point>();
  const overlapsAny = (r: R) =>
    placedRects.some(
      (p) =>
        r.x0 < p.x1 + CLUSTER_GAP &&
        p.x0 < r.x1 + CLUSTER_GAP &&
        r.y0 < p.y1 + CLUSTER_GAP &&
        p.y0 < r.y1 + CLUSTER_GAP,
    );
  const present = [
    ...(idleIds.length ? [IDLE_CLUSTER] : []),
    ...rootNodes.filter((n) => n.id !== centerId).map((n) => n.id),
  ];
  const known = mem?.order ?? [];
  const seen = [
    ...known.filter((id) => present.includes(id)),
    ...present.filter((id) => !known.includes(id)),
  ];
  memory.order = [...known, ...seen.filter((id) => !known.includes(id))];
  // Homes first (row 0 before the agents stacked above it), so they never depend on the rest.
  const homeRank = (id: string) => {
    const home = HOMES[id];
    // The "not used yet" card comes last, beside whatever sits right of the coordinator.
    return home ? (home.above ? 1 : 0) : id === IDLE_CLUSTER ? 3 : 2;
  };
  const order = seen
    .map((id, i) => ({ id, i }))
    .sort((a, b) => homeRank(a.id) - homeRank(b.id) || a.i - b.i)
    .map(({ id }) => id);
  const reserved = (id: string) => boundsOf(reserves.get(id) ?? []);
  const core =
    centerId && locals.has(centerId) ? reserved(centerId) : { x0: 0, y0: 0, x1: 0, y1: 0 };
  if (centerId && locals.has(centerId)) {
    placedRects.push(core);
    offset.set(centerId, { x: 0, y: 0 });
  }
  const rectAt = (b: R, at: Point): R => ({
    x0: at.x + b.x0,
    y0: at.y + b.y0,
    x1: at.x + b.x1,
    y1: at.y + b.y1,
  });
  // Each home column is as wide as its widest cluster (a lone card until helpers arrive), and
  // always reserved, so the sources lane does not move when the pipeline first shows up.
  const homeWidth = Array.from({ length: HOME_COLUMNS }, (_, column) =>
    Math.max(
      ROOT_W,
      ...order
        .filter((id) => HOMES[id]?.column === column)
        .map((id) => reserved(id).x1 - reserved(id).x0),
    ),
  );
  const homeRight = (column: number) =>
    core.x0 - CLUSTER_GAP - homeWidth.slice(0, column).reduce((sum, w) => sum + w + CLUSTER_GAP, 0);
  const homeX = (column: number) => homeRight(column) - (homeWidth[column] ?? ROOT_W) / 2;
  for (const id of order) {
    const b = reserved(id);
    const home = HOMES[id];
    const side = home ? -1 : 1;
    memory.side.set(id, side);
    const before = home ? undefined : mem?.at.get(id);
    let at: Point | undefined;
    if (home) {
      // Row 0 lines up with the coordinator; feeds stack upward from above it. Helpers grow
      // downward, so neither ever pushes the other.
      const x = homeX(home.column);
      let y = home.above ? -ROOT_RESERVED_H / 2 - CLUSTER_GAP - b.y1 : 0;
      for (let guard = 0; guard < 400 && overlapsAny(rectAt(b, { x, y })); guard++)
        y += home.above ? -STEP : STEP;
      at = { x, y };
    }
    if (!at && before && !overlapsAny(rectAt(b, before))) at = before;
    for (let column = 0; !at; column++) {
      const x =
        side < 0
          ? core.x0 - CLUSTER_GAP - b.x1 - column * (ROOT_W + CLUSTER_GAP)
          : core.x1 + CLUSTER_GAP - b.x0 + column * (ROOT_W + CLUSTER_GAP);
      // A remembered cluster only moves outward: away from the center, then a column out.
      if (before && Math.abs(x) < Math.abs(before.x)) continue;
      for (let k = 0; k * STEP <= COLUMN_HALF; k++) {
        for (const sign of k === 0 ? [1] : [-1, 1]) {
          const y = sign * k * STEP;
          if (before && Math.abs(x) === Math.abs(before.x) && Math.abs(y) < Math.abs(before.y))
            continue;
          if (!overlapsAny(rectAt(b, { x, y }))) {
            at = { x, y };
            break;
          }
        }
        if (at) break;
      }
      if (column > 40) at = { x, y: 0 };
    }
    placedRects.push(rectAt(b, at));
    memory.at.set(id, at);
    offset.set(id, at);
  }
  // Clusters not on the map now keep their remembered place for when they return.
  for (const [id, p] of mem?.at ?? []) if (!memory.at.has(id)) memory.at.set(id, p);

  const boxes = new Map<string, Box>();
  const clusters: Cluster[] = [];
  for (const rootId of [...(centerId && offset.has(centerId) ? [centerId] : []), ...order]) {
    const at = offset.get(rootId) ?? { x: 0, y: 0 };
    const items = locals.get(rootId) ?? [];
    for (const it of items) {
      // Cards hang from the top of their reserved room, so a growing card never moves.
      const box: Box = {
        x: at.x + it.cx - it.w / 2,
        y: at.y + it.cy - it.h / 2,
        w: it.w,
        h: it.real,
        depth: it.depth,
      };
      const stack = stacks.find((s) => s.id === it.id);
      if (stack) stack.box = box;
      else boxes.set(it.id, box);
    }
    const b = reserved(rootId);
    clusters.push({
      id: rootId,
      members: items.map((i) => i.id).filter((id) => !id.startsWith("stack:")),
      bounds: { x: at.x + b.x0, y: at.y + b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0, depth: 0 },
    });
  }

  // The web reserves the home columns on the left and one satellite column on the right, so the
  // side lanes do not move when the first agents arrive.
  const wing = CLUSTER_GAP + ROOT_W;
  const web = {
    x0: Math.min(
      homeRight(HOME_COLUMNS - 1) - (homeWidth[HOME_COLUMNS - 1] ?? ROOT_W),
      ...clusters.map((c) => c.bounds.x),
    ),
    x1: Math.max(core.x1 + wing, ...clusters.map((c) => c.bounds.x + c.bounds.w)),
    y0: Math.min(0, ...clusters.map((c) => c.bounds.y)),
    y1: Math.max(0, ...clusters.map((c) => c.bounds.y + c.bounds.h)),
  };
  memory.sourceRight = Math.min(mem?.sourceRight ?? Number.POSITIVE_INFINITY, web.x0 - SIDE_MARGIN);
  memory.outputLeft = Math.max(mem?.outputLeft ?? Number.NEGATIVE_INFINITY, web.x1 + SIDE_MARGIN);
  // Side lanes: items in graph order (built-ins first, new ones appended at the end).
  const column = (kind: "source" | "output") => {
    const items = graph.nodes.filter((n) => n.kind === kind);
    const step = SIDE_H + SIDE_GAP;
    // Room for the built-in set, so sources arriving one by one fill in downward.
    const planned = Math.max(kind === "source" ? 7 : 4, items.length);
    const top = memory.top[kind] ?? Math.round(-(planned * step) / 2);
    memory.top[kind] = top;
    const x =
      kind === "source" ? (memory.sourceRight as number) - SIDE_W : (memory.outputLeft as number);
    items.forEach((n, i) => {
      boxes.set(n.id, { x, y: top + i * step, w: SIDE_W, h: SIDE_H, depth: 0 });
    });
    return { x, top, bottom: top + planned * step - SIDE_GAP };
  };
  const above = (top: number) => top - LANE_H - LANE_GAP;
  const src = column("source");
  const out = column("output");

  // Toolbox: provider cards under the outputs, each with room reserved for TOOLBOX_ROWS tools,
  // so a new tool or provider arrives without moving anything.
  const groups = options.toolbox ?? [];
  for (const g of groups) if (!memory.toolbox.includes(g.id)) memory.toolbox.push(g.id);
  const toolTop = memory.top.toolbox ?? out.bottom + LANE_GAP * 2 + LANE_H + LANE_GAP;
  memory.top.toolbox = toolTop;
  const toolStep = toolboxHeight(TOOLBOX_ROWS) + TOOLBOX_GAP;
  for (const g of groups) {
    const i = memory.toolbox.indexOf(g.id);
    boxes.set(g.id, {
      x: out.x,
      y: toolTop + i * toolStep,
      w: TOOLBOX_W,
      h: toolboxHeight(Math.min(g.items.length, TOOLBOX_ROWS)),
      depth: 0,
    });
  }
  const toolReserve: Rect = {
    x: out.x,
    y: toolTop,
    w: TOOLBOX_W,
    h: Math.max(1, memory.toolbox.length) * toolStep - TOOLBOX_GAP,
  };

  const agentCards = [
    ...graph.nodes.filter(isAgent).flatMap((n) => boxes.get(n.id) ?? []),
    ...stacks.map((st) => st.box),
  ];
  const agentTop = agentCards.length ? Math.min(...agentCards.map((b) => b.y)) : web.y0;
  const lanes: Lane[] = [
    { id: "source", x: src.x, y: above(src.top), w: Math.max(SIDE_W, 180) },
    // Above the agent cards on the map now, not the reserved room, so no empty band shows.
    { id: "agent", x: web.x0, y: above(agentTop), w: Math.max(ROOT_W, web.x1 - web.x0) },
    { id: "output", x: out.x, y: above(out.top), w: Math.max(SIDE_W, 180) },
    { id: "toolbox", x: out.x, y: above(toolTop), w: Math.max(TOOLBOX_W, 180) },
  ];

  const routes: Route[] = [];
  for (const e of graph.edges.filter((x) => x.kind !== "uses")) {
    const a = boxes.get(e.source);
    const b = boxes.get(e.target);
    if (!a || !b) continue;
    routes.push(routeFor(e.id, e.source, e.target, e.kind, a, b));
  }
  // Toolbox links: drawn for recent calls, there for growth and for data moving to and from a
  // tool. A finished helper folded into a stack links from that stack, once per stack.
  for (const g of groups)
    for (const user of g.users) {
      const stack = boxes.has(user) ? undefined : stacks.find((s) => s.members.includes(user));
      const from = stack ? stack.id : user;
      const a = stack ? stack.box : boxes.get(user);
      const b = boxes.get(g.id);
      const id = `${from}->${g.id}`;
      if (a && b && !routes.some((r) => r.id === id))
        routes.push(routeFor(id, from, g.id, "uses", a, b));
    }

  // What the camera fits: the cards and lane headings drawn now, not reserved room, so the map
  // fills the canvas. Growth past it eases the camera out (BrainMapCamera.ts).
  const all: Rect[] = [
    ...[...boxes.values(), ...stacks.map((s) => s.box)],
    ...lanes.map((l) => ({ x: l.x, y: l.y, w: Math.min(l.w, 180), h: LANE_H })),
  ];
  const x0 = Math.min(...all.map((b) => b.x));
  const y0 = Math.min(...all.map((b) => b.y));
  const x1 = Math.max(...all.map((b) => b.x + b.w));
  const y1 = Math.max(...all.map((b) => b.y + b.h));
  return {
    boxes,
    routes,
    chips,
    stacks,
    clusters,
    lanes,
    bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
    memory,
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
 * between agents (and to the toolbox) bow slightly to one side so a pair's link never hides
 * under a straight line.
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
