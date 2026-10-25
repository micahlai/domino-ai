// How the brain map grows. Pure: given the nodes and links that are new, it says when each node
// pops in and when each link draws itself. A new node first gets a link extending out from a
// parent already on screen (the root first), and pops in at its end. On first load the order is
// root, then data sources, agents, outputs, swarms (helpers and their stacks), then tools, with
// a stagger so the web visibly grows. Later nodes grow the same way.

export type GrowKind = "root" | "source" | "agent" | "output" | "swarm" | "tool";
export type GrowNode = { id: string; kind: Exclude<GrowKind, "root"> };
export type GrowLink = { id: string; source: string; target: string };
/** When a link draws (seconds from now), and whether it grows from its target end. */
export type Draw = { delay: number; reverse: boolean };
export type Growth = { pop: Map<string, number>; draw: Map<string, Draw> };

/** A link takes this long to extend; its node pops in as it arrives. */
export const EDGE_SECONDS = 0.6;
/** A parent is clearly on screen this long after it starts to pop. */
const SETTLE = 0.35;
const PHASES: GrowKind[] = ["root", "source", "agent", "output", "swarm", "tool"];
const STAGGER: Record<GrowKind, number> = {
  root: 0.2,
  source: 0.14,
  agent: 0.2,
  output: 0.14,
  swarm: 0.1,
  tool: 0.14,
};

/**
 * @param fresh nodes appearing now, in graph order
 * @param links links appearing now
 * @param known nodes already planned or shown: seconds from now until each pops (<= 0: shown)
 * @param root where the web grows from, when it is among the fresh nodes
 */
export function growthPlan(
  fresh: readonly GrowNode[],
  links: readonly GrowLink[],
  known: ReadonlyMap<string, number>,
  root?: string,
): Growth {
  const pop = new Map<string, number>();
  const draw = new Map<string, Draw>();
  const at = (id: string) => pop.get(id) ?? known.get(id);
  const phase = (n: GrowNode): GrowKind => (n.id === root ? "root" : n.kind);
  const order = fresh
    .map((n, i) => ({ n, i }))
    .sort((a, b) => PHASES.indexOf(phase(a.n)) - PHASES.indexOf(phase(b.n)) || a.i - b.i)
    .map(({ n }) => n);
  let cursor = 0;
  for (const n of order) {
    const other = (l: GrowLink) => (l.source === n.id ? l.target : l.source);
    const parents = links
      .filter((l) => (l.source === n.id || l.target === n.id) && at(other(l)) !== undefined)
      .sort((a, b) => {
        const ra = other(a) === root ? -1 : 0;
        const rb = other(b) === root ? -1 : 0;
        return ra - rb || (at(other(a)) ?? 0) - (at(other(b)) ?? 0);
      });
    const via = parents[0];
    if (via) {
      const start = Math.max(cursor, Math.max(0, (at(other(via)) ?? 0) + SETTLE));
      draw.set(via.id, { delay: start, reverse: via.target === other(via) });
      pop.set(n.id, start + EDGE_SECONDS);
      cursor = start + STAGGER[phase(n)];
    } else {
      pop.set(n.id, cursor);
      cursor += STAGGER[phase(n)];
    }
  }
  // Every other new link draws once both of its ends are on screen.
  for (const l of links) {
    if (draw.has(l.id)) continue;
    const a = at(l.source);
    const b = at(l.target);
    if (a === undefined || b === undefined) continue;
    draw.set(l.id, { delay: Math.max(0, a, b) + SETTLE, reverse: false });
  }
  return { pop, draw };
}
