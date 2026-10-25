import { describe, expect, it } from "vitest";
import {
  type CameraEvent,
  INITIAL_CAMERA,
  cameraStep,
  fitViewport,
  grownViewport,
} from "./BrainMapCamera";
import { EDGE_SECONDS, type GrowNode, growthPlan } from "./BrainMapGrowth";
import { demoAdvanceFeed, demoIngest, initialDemoState } from "./fixture";
import {
  type BrainGraph,
  buildBrainGraph,
  collapsedInstances,
  growthRoot,
  idleAgents,
  isAgent,
  mapSources,
  toolboxGroups,
} from "./graph";
import { CENTER_ID, type LayoutMemory, type MapLayout, layoutMap, overlaps } from "./map-layout";
import { initialSwarm, swarmStep } from "./swarm-demo";
import type { FieldOperation } from "./types";

const T0 = Date.parse("2026-10-31T10:00:00Z");
/** Grace before a finished helper folds away; the map uses the same value. */
const GRACE = 3200;

/** The map canvas on a 1440 x 900 screen: page gutters 32 px each side, 240 px of header. */
const CANVAS = { w: 1440 - 64 - 2, h: 900 - 240 - 2 };

function demoOps(): FieldOperation[] {
  let demo = initialDemoState();
  demo = demoIngest(demo, "2026-10-31T10:00:00Z");
  demo = demoAdvanceFeed(demo, "2026-10-31T10:01:00Z");
  demo = demoIngest(demo, "2026-10-31T10:02:00Z");
  return demo.operations;
}

/** What the map lays out: connected sources only, and outside tools in the toolbox. */
function mapOf(ops: FieldOperation[], now?: number, memory?: LayoutMemory) {
  const full = buildBrainGraph(ops);
  const graph = mapSources(full);
  const layout = layoutMap(graph, {
    ...(now !== undefined && { collapsed: collapsedInstances(graph, now, GRACE) }),
    idle: idleAgents(graph),
    toolbox: toolboxGroups(full),
    memory,
  });
  return { full, graph, layout };
}

/** The demo swarm beat by beat, each beat laid out with the previous beat's memory. */
function swarmFrames(beats: number) {
  const base = demoOps();
  let swarm = initialSwarm(T0);
  let memory: LayoutMemory | undefined;
  const frames: { graph: BrainGraph; layout: MapLayout }[] = [];
  for (let i = 0; i < beats; i++) {
    const now = T0 + i * 1100;
    swarm = swarmStep(swarm, new Date(now).toISOString());
    const { graph, layout } = mapOf([...base, ...swarm.ops], now, memory);
    memory = layout.memory;
    frames.push({ graph, layout });
  }
  return frames;
}

const moved = (a: MapLayout, b: MapLayout) => {
  const out: string[] = [];
  for (const [id, box] of a.boxes) {
    const next = b.boxes.get(id);
    if (next && (next.x !== box.x || next.y !== box.y)) out.push(id);
  }
  for (const s of a.stacks) {
    const next = b.stacks.find((t) => t.id === s.id);
    if (next && (next.box.x !== s.box.x || next.box.y !== s.box.y)) out.push(s.id);
  }
  return out;
};

describe("brain map layout", () => {
  it("is deterministic: the same graph gives the same positions", () => {
    const a = mapOf(demoOps()).layout;
    const b = mapOf(demoOps()).layout;
    expect([...a.boxes.entries()]).toEqual([...b.boxes.entries()]);
    expect(a.routes.map((r) => r.path)).toEqual(b.routes.map((r) => r.path));
  });

  it("never moves an existing node while the swarm runs, and never overlaps", () => {
    const frames = swarmFrames(160);
    for (let i = 1; i < frames.length; i++) {
      const prev = frames[i - 1]?.layout as MapLayout;
      const next = frames[i]?.layout as MapLayout;
      expect(moved(prev, next), `beat ${i}`).toEqual([]);
      expect(overlaps(next, 8), `beat ${i}`).toEqual([]);
    }
    // New helpers really did come and go, so the check above was not vacuous.
    const helpers = new Set(
      frames.flatMap((f) => [...f.layout.boxes.keys()].filter((id) => id.includes("#"))),
    );
    expect(helpers.size).toBeGreaterThan(30);
    // Apify reached the toolbox while the swarm ran.
    expect(frames.at(-1)?.layout.boxes.has("toolbox:apify")).toBe(true);
  });

  it("never moves an existing node as the log grows one row at a time", () => {
    const ops = demoOps();
    let memory: LayoutMemory | undefined;
    let prev: MapLayout | undefined;
    for (let k = 0; k <= ops.length; k++) {
      const { layout } = mapOf(ops.slice(0, k), undefined, memory);
      if (prev) expect(moved(prev, layout), `row ${k}`).toEqual([]);
      expect(overlaps(layout, 8), `row ${k}`).toEqual([]);
      memory = layout.memory;
      prev = layout;
    }
  });

  it("keeps the analyst at the center with its helpers close around it", () => {
    const { graph, layout } = swarmFrames(40).at(-1) as { graph: BrainGraph; layout: MapLayout };
    const analyst = layout.boxes.get(CENTER_ID);
    if (!analyst) throw new Error("no analyst");
    expect(analyst.w).toBeGreaterThan(layout.boxes.get("agent:ingestion")?.w ?? 0);
    const cx = analyst.x + analyst.w / 2;
    const cy = analyst.y + analyst.h / 2;
    const helpers = graph.nodes
      .filter((n) => n.kind === "subagent" && n.parentId === CENTER_ID)
      .flatMap((n) => layout.boxes.get(n.id) ?? []);
    expect(helpers.length).toBeGreaterThan(4);
    for (const b of helpers) {
      expect(Math.abs(b.x + b.w / 2 - cx)).toBeLessThan(330);
      expect(Math.abs(b.y + b.h / 2 - cy)).toBeLessThan(190);
    }
  });

  it("fits everything inside the canvas at the first fit on a 1440 x 900 screen", () => {
    const cases: [string, MapLayout][] = [
      ["demo", mapOf(demoOps()).layout],
      ["swarm", (swarmFrames(40).at(-1) as { layout: MapLayout }).layout],
    ];
    for (const [name, layout] of cases) {
      const vp = fitViewport(layout.bounds, CANVAS.w, CANVAS.h);
      // Readable: text stays at least 75% of its size (the pipeline's two left columns, ingestion
      // then audit, cost a little zoom).
      expect(vp.zoom, name).toBeGreaterThanOrEqual(0.75);
      const rects = [...layout.boxes.values(), ...layout.stacks.map((s) => s.box)];
      for (const b of rects) {
        const x = b.x * vp.zoom + vp.x;
        const y = b.y * vp.zoom + vp.y;
        expect(x, name).toBeGreaterThanOrEqual(0);
        expect(y, name).toBeGreaterThanOrEqual(0);
        expect(x + b.w * vp.zoom, name).toBeLessThanOrEqual(CANVAS.w);
        expect(y + b.h * vp.zoom, name).toBeLessThanOrEqual(CANVAS.h);
      }
    }
  });

  it("puts every source left of every agent and every output right of them", () => {
    const { graph, layout } = swarmFrames(40).at(-1) as { graph: BrainGraph; layout: MapLayout };
    const agents = graph.nodes.filter(isAgent).flatMap((n) => layout.boxes.get(n.id) ?? []);
    const left = Math.min(...agents.map((b) => b.x));
    const right = Math.max(...agents.map((b) => b.x + b.w));
    for (const n of graph.nodes.filter((x) => x.kind === "source"))
      expect((layout.boxes.get(n.id)?.x ?? 0) + (layout.boxes.get(n.id)?.w ?? 0)).toBeLessThan(
        left,
      );
    for (const n of graph.nodes.filter((x) => x.kind === "output"))
      expect(layout.boxes.get(n.id)?.x ?? 0).toBeGreaterThan(right);
  });
});

describe("sources and toolbox", () => {
  const apifyOps = (): FieldOperation[] => [
    {
      id: "a1",
      at: "2026-10-31T10:00:00Z",
      agent: "Research agent",
      kind: "pull",
      source: "apify",
      tool: "apify.google-search-scraper",
      toolCategory: "apify",
      status: "succeeded",
      summary: "Searched.",
    },
    {
      id: "a2",
      at: "2026-10-31T10:00:01Z",
      agent: "Ingestion agent",
      kind: "pull",
      source: "billing",
      tool: "read_feed",
      status: "succeeded",
      summary: "Read.",
    },
  ];

  it("moves Apify out of the data sources into the toolbox", () => {
    const full = buildBrainGraph(apifyOps());
    expect(full.nodes.some((n) => n.kind === "source" && n.vendor === "apify")).toBe(true);
    const graph = mapSources(full);
    expect(graph.nodes.some((n) => n.kind === "source" && n.vendor === "apify")).toBe(false);
    const [apify] = toolboxGroups(full);
    expect(apify?.provider).toBe("apify");
    expect(apify?.users).toEqual(["agent:research-agent"]);
    expect(apify?.items).toContain("tool:apify.google-search-scraper");
  });

  it("shows only connected sources, so disconnecting removes one from the map", () => {
    const full = buildBrainGraph(apifyOps());
    const ids = (g: BrainGraph) => g.nodes.filter((n) => n.kind === "source").map((n) => n.id);
    expect(ids(mapSources(full, new Set(["stripe", "hubspot"])))).toEqual([
      "source:billing",
      "source:crm",
    ]);
    const without = mapSources(full, new Set(["hubspot"]));
    expect(ids(without)).toEqual(["source:crm"]);
    expect(without.edges.some((e) => e.source === "source:billing")).toBe(false);
    // Without a connections table (demo), a source shows once it has work.
    expect(ids(mapSources(full))).toEqual(["source:billing"]);
  });
});

describe("growth", () => {
  it("grows the first load from the root: sources, then agents, then swarms", () => {
    const { full, graph, layout } = mapOf(demoOps());
    const root = growthRoot(full);
    expect(root).toBe("agent:ingestion");
    const kind = (id: string): GrowNode["kind"] => {
      if (id.startsWith("toolbox:")) return "tool";
      if (id.startsWith("stack:")) return "swarm";
      const n = graph.nodes.find((x) => x.id === id);
      if (n?.kind === "source") return "source";
      if (n?.kind === "output") return "output";
      return n?.kind === "subagent" ? "swarm" : "agent";
    };
    const ids = [...layout.boxes.keys(), ...layout.stacks.map((s) => s.id)];
    const plan = growthPlan(
      ids.map((id) => ({ id, kind: kind(id) })),
      layout.routes,
      new Map(),
      root,
    );
    const at = (id: string) => plan.pop.get(id) ?? Number.NaN;
    expect(at(root as string)).toBe(0);
    const sources = ids.filter((id) => kind(id) === "source");
    const agents = ids.filter((id) => kind(id) === "agent" && id !== root);
    expect(sources.length).toBeGreaterThan(0);
    expect(Math.max(...sources.map(at))).toBeLessThan(Math.min(...agents.map(at)) + EDGE_SECONDS);
    // Every card that grows along a link pops after the link has reached it.
    for (const [routeId, d] of plan.draw) {
      const route = layout.routes.find((r) => r.id === routeId);
      if (!route) throw new Error("unknown route");
      const from = d.reverse ? route.target : route.source;
      const to = d.reverse ? route.source : route.target;
      expect(at(from)).toBeLessThanOrEqual(d.delay);
      if (at(to) > d.delay) expect(at(to)).toBeCloseTo(d.delay + EDGE_SECONDS, 5);
    }
    // It visibly takes a while, but not forever.
    const last = Math.max(...ids.map(at));
    expect(last).toBeGreaterThan(1.5);
    expect(last).toBeLessThan(10);
  });

  it("grows a later node from a parent already on screen", () => {
    const plan = growthPlan(
      [{ id: "agent:new#1", kind: "swarm" }],
      [{ id: "agent:analyst->agent:new#1", source: "agent:analyst", target: "agent:new#1" }],
      new Map([["agent:analyst", -5]]),
    );
    expect(plan.draw.get("agent:analyst->agent:new#1")).toEqual({ delay: 0, reverse: false });
    expect(plan.pop.get("agent:new#1")).toBeCloseTo(EDGE_SECONDS, 5);
  });

  it("draws a source link from the agent end when the agent was there first", () => {
    const plan = growthPlan(
      [{ id: "source:billing", kind: "source" }],
      [
        {
          id: "source:billing->agent:ingestion",
          source: "source:billing",
          target: "agent:ingestion",
        },
      ],
      new Map([["agent:ingestion", 0]]),
    );
    expect(plan.draw.get("source:billing->agent:ingestion")?.reverse).toBe(true);
  });
});

describe("map camera", () => {
  const run = (events: CameraEvent[]) => {
    let state = INITIAL_CAMERA;
    const fits: boolean[] = [];
    for (const e of events) {
      const step = cameraStep(state, e);
      state = step.state;
      fits.push(step.fit);
    }
    return { state, fits };
  };

  it("fits once on the first load and never again on data updates", () => {
    const { fits } = run(["ready", "data", "data", "ready", "data"]);
    expect(fits).toEqual([true, false, false, false, false]);
  });

  it("does not touch the view on data updates even before the first fit", () => {
    const step = cameraStep(INITIAL_CAMERA, "data");
    expect(step).toEqual({ state: INITIAL_CAMERA, fit: false, grow: false });
  });

  it("may ease out on data updates only after the fit and before the person moves", () => {
    const grows = (events: CameraEvent[]) => {
      let state = INITIAL_CAMERA;
      let grow: boolean | undefined;
      for (const e of events) ({ state, grow } = cameraStep(state, e));
      return grow;
    };
    expect(grows(["ready", "data"])).toBe(true);
    expect(grows(["ready", "user-move", "data"])).toBe(false);
    expect(grows(["ready", "user-move", "fit", "data"])).toBe(true);
  });

  it("eases out only when the map outgrew the view, and never zooms in", () => {
    const view = { x: 500, y: 300, zoom: 1 };
    // Still inside a 1000 x 600 canvas: no move.
    expect(grownViewport(view, { x: -400, y: -250, w: 800, h: 500 }, 1000, 600)).toBeUndefined();
    // Grew past the right edge: zoom out to fit, never above the current zoom.
    const out = grownViewport(view, { x: -400, y: -250, w: 1400, h: 500 }, 1000, 600);
    expect(out?.zoom).toBeLessThan(1);
    const zoomedOut = { x: 500, y: 300, zoom: 0.6 };
    const pan = grownViewport(zoomedOut, { x: 0, y: 0, w: 1200, h: 100 }, 1000, 600);
    expect(pan?.zoom).toBeLessThanOrEqual(0.6);
  });

  it("never refits on a resize, moved or not", () => {
    expect(run(["ready", "resize"]).fits).toEqual([true, false]);
    expect(run(["ready", "user-move", "resize", "data"]).fits).toEqual([true, false, false, false]);
  });

  it("refits only when the person presses the fit button", () => {
    const { fits, state } = run(["ready", "user-move", "fit", "resize", "data"]);
    expect(fits).toEqual([true, false, true, false, false]);
    expect(state).toEqual({ fitted: true, moved: false });
  });

  it("centers the bounds and caps zoom at 100%", () => {
    const vp = fitViewport({ x: -100, y: -50, w: 200, h: 100 }, 1000, 600);
    expect(vp).toEqual({ x: 500, y: 300, zoom: 1 });
    const small = fitViewport({ x: 0, y: 0, w: 4000, h: 1000 }, 1000, 600);
    expect(small.zoom).toBe(0.5);
  });
});
