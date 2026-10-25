import { describe, expect, it } from "vitest";
import { verifyWeeklySeedText, weeklyFixtureText } from "../../lib/feature-boundary/verify";
import {
  demoAdvanceFeed,
  demoDecide,
  demoIngest,
  demoRecordExport,
  initialDemoState,
} from "./fixture";
import {
  type BrainGraph,
  activityFor,
  buildBrainGraph,
  freshOperations,
  idleAgents,
  isAgent,
  mapCounts,
  mapSources,
  neighbors,
  pulsePath,
  pulsesFor,
  recentCalls,
  toCanvasStatus,
  toolChips,
  withSavedState,
} from "./graph";
import {
  CENTER_ID,
  IDLE_CLUSTER,
  IDLE_STACK,
  clusterRoots,
  layoutMap,
  overlaps,
} from "./map-layout";
import { initialSwarm, swarmStep } from "./swarm-demo";
import { describeTool } from "./tool-names";
import type { FieldOperation } from "./types";

const op = (over: Partial<FieldOperation> & { id: string }): FieldOperation => ({
  at: "2026-10-30T10:00:00Z",
  agent: "ingestion",
  kind: "pull",
  status: "succeeded",
  summary: "did a thing",
  ...over,
});

describe("buildBrainGraph", () => {
  it("projects a generic saved bank read onto connected Plaid, including old reads outside the log", () => {
    const read = op({ id: "bank-read", source: "bank", tool: "plaid.read" });
    const recent = withSavedState(buildBrainGraph([read]), {
      sources: [{ id: "bank", lastPull: "2023-09-30" }],
    });
    const plaid = mapSources(recent, new Set(["plaid"]));
    expect(plaid.nodes.find((n) => n.id === "source:plaid")).toMatchObject({
      title: "Plaid",
      vendor: "plaid",
      saved: "Data through Sep 30",
      operations: [read],
    });
    expect(plaid.nodes.some((n) => n.id === "source:bank")).toBe(false);
    expect(plaid.edges).toContainEqual({
      id: "source:plaid->agent:ingestion",
      source: "source:plaid",
      target: "agent:ingestion",
      kind: "feeds",
    });
    expect(mapCounts(plaid).sources).toBe(1);

    const oldRead = mapSources(
      withSavedState(buildBrainGraph([]), {
        sources: [{ id: "bank", lastPull: "2023-09-30" }],
      }),
      new Set(["plaid"]),
    );
    expect(oldRead.nodes.find((n) => n.id === "source:plaid")?.saved).toBe("Data through Sep 30");
    expect(mapCounts(oldRead).sources).toBe(1);
  });

  it("keeps the generic bank read on Capital One for a connected legacy Nessie feed", () => {
    const graph = withSavedState(
      buildBrainGraph([op({ id: "nessie-read", source: "bank", tool: "nessie.read" })]),
      {
        sources: [{ id: "bank", lastPull: "2026-11-02" }],
      },
    );
    const nessie = mapSources(graph, new Set(["capitalone"]));
    expect(nessie.nodes.find((n) => n.id === "source:bank")).toMatchObject({
      vendor: "capitalone",
      saved: "Data through Nov 2",
    });
    expect(nessie.nodes.some((n) => n.id === "source:plaid")).toBe(false);
    expect(mapCounts(nessie).sources).toBe(1);
  });

  it("always shows the built-in agents, sources and outputs, idle until the log says otherwise", () => {
    const graph = buildBrainGraph([]);
    expect(graph.nodes.filter((n) => n.kind === "agent").map((n) => n.id)).toEqual([
      "agent:ingestion",
      "agent:audit",
      "agent:forecaster",
      "agent:analyst",
    ]);
    expect(graph.nodes.filter((n) => n.kind === "source").map((n) => n.vendor)).toEqual([
      "stripe",
      "hubspot",
      "ramp",
      "qbo",
      "gusto",
      "capitalone",
      "plaid",
    ]);
    expect(graph.nodes.filter((n) => n.kind === "output")).toHaveLength(4);
    expect(graph.nodes.every((n) => n.status === "idle")).toBe(true);
    expect(graph.edges).toEqual([]);
  });

  it("links source -> agent, agent -> tool and agent -> output, keeping the latest status", () => {
    const graph = buildBrainGraph([
      op({
        id: "b",
        at: "2026-10-30T11:00:00Z",
        source: "cards",
        tool: "read_feed",
        status: "failed",
      }),
      op({ id: "a", source: "Cards", tool: "read_feed" }),
      op({ id: "c", at: "2026-10-30T12:00:00Z", kind: "snapshot", tool: "save_snapshot" }),
    ]);
    expect(graph.edges.map((e) => `${e.kind} ${e.id}`)).toEqual([
      "feeds source:cards->agent:ingestion",
      "uses agent:ingestion->tool:read_feed",
      "uses agent:ingestion->tool:save_snapshot",
      "produces agent:ingestion->output:books",
    ]);
    const tool = graph.nodes.find((n) => n.id === "tool:read_feed");
    expect(tool?.operations.map((o) => o.id)).toEqual(["a", "b"]);
    expect(tool?.status).toBe("failed");
    expect(tool?.title).toBe("Read new entries");
    expect(tool?.tool?.raw).toBe("read_feed");
    expect(graph.nodes.find((n) => n.id === "source:cards")).toMatchObject({
      title: "Ramp",
      vendor: "ramp",
    });
  });

  it("treats a new agent started from another agent's operation as its sub-agent", () => {
    const graph = buildBrainGraph([
      op({ id: "a1", agent: "audit", kind: "audit", tool: "check_entries" }),
      op({ id: "s1", agent: "Timing checker", kind: "spawn", parentId: "a1", tool: "compare" }),
    ]);
    const sub = graph.nodes.find((n) => n.id === "agent:timing-checker");
    expect(sub).toMatchObject({
      kind: "subagent",
      parentId: "agent:audit",
      title: "Timing checker",
    });
    expect(neighbors(graph, "agent:timing-checker").from.map((n) => n.id)).toEqual(["agent:audit"]);
    expect(
      pulsePath(graph.nodes.find((n) => n.id === sub?.id)?.operations[0] as FieldOperation, graph),
    ).toEqual(["agent:audit->agent:timing-checker"]);
    // A helper's work rolls up into its manager: no output link of its own.
    expect(graph.edges.some((e) => e.source === sub?.id && e.kind === "produces")).toBe(false);
    expect(graph.edges.map((e) => e.id)).toContain("agent:audit->output:flags");
  });

  it("names agents by who runs them", () => {
    const graph = buildBrainGraph([
      op({ id: "c1", agent: "Risk scout", actor: "agent:claude", kind: "run" }),
      op({ id: "c2", agent: "Peer research", actor: "agent:creao", kind: "run" }),
      op({ id: "c3", agent: "Mock feed", kind: "feed", tool: "sim.advanceWeek" }),
      op({ id: "c4", agent: "Reviewer", kind: "decision" }),
      op({ id: "c5", agent: "Engine", kind: "forecast" }),
    ]);
    const kind = (id: string) => graph.nodes.find((n) => n.id === id)?.agentKind;
    expect(kind("agent:ingestion")).toBe("domino");
    expect(kind("agent:risk-scout")).toBe("claude");
    expect(kind("agent:peer-research")).toBe("creao");
    expect(kind("agent:mock-feed")).toBe("simulator");
    expect(kind("agent:reviewer")).toBe("person");
    expect(kind("agent:engine")).toBe("system");
  });
});

describe("friendly tool names", () => {
  it("maps raw tool ids to plain labels and categories", () => {
    expect(describeTool("mock.bank.list")).toMatchObject({
      label: "Read bank (Capital One)",
      category: "read",
    });
    expect(describeTool("convex.snapshots")).toMatchObject({
      label: "Save books version",
      category: "save",
    });
    expect(describeTool("engine.recompute")).toMatchObject({
      label: "Update forecast",
      category: "forecast",
    });
    expect(describeTool("engine.auditSnapshot")).toMatchObject({
      label: "Check entries",
      category: "audit",
    });
    expect(describeTool("field.tieOut")).toMatchObject({
      label: "Tie out balances",
      category: "audit",
    });
    expect(describeTool("sim.advanceWeek")).toMatchObject({
      label: "New entries (demo feed)",
      category: "simulate",
    });
    expect(describeTool("gusto.consent")).toMatchObject({
      label: "Connect Gusto",
      category: "connect",
    });
    expect(describeTool("vendor.fetchInvoices")).toMatchObject({
      label: "Fetch invoices",
      category: "read",
    });
  });

  it("labels a live Apify run by its actor name and only demo rows as demo actors", () => {
    expect(
      describeTool("apify/google-search-scraper", "apify", "Google Search Results Scraper"),
    ).toEqual({
      label: "Google Search Results Scraper",
      category: "apify",
      group: "category:apify",
    });
    expect(describeTool("apify/demo-news-search", "apify", "demo actor")).toMatchObject({
      label: "News search",
      demoActor: true,
    });
    // The offline fixture logs no label: still a demo actor.
    expect(describeTool("apify.google-search-scraper", "apify").demoActor).toBe(true);
  });

  it("collapses an agent's read tools into one chip and keeps the rest apart", () => {
    const graph = buildBrainGraph([
      op({ id: "1", tool: "mock.billing.list", source: "stripe" }),
      op({ id: "2", tool: "mock.bank.list", source: "nessie" }),
      op({ id: "3", tool: "mock.bank.list", source: "nessie" }),
      op({ id: "4", tool: "convex.snapshots", kind: "snapshot" }),
    ]);
    const agent = graph.nodes.find((n) => n.id === "agent:ingestion");
    const chips = agent ? toolChips(agent) : [];
    expect(chips.map((c) => [c.label, c.calls, c.tools.length])).toEqual([
      ["Read data", 3, 2],
      ["Save books version", 1, 1],
    ]);
  });
});

describe("motion only for new operations", () => {
  it("stays quiet on the first delivery and pulses only unseen ids after", () => {
    const first = [op({ id: "a", source: "bank", tool: "read_feed" })];
    const quiet = freshOperations(new Set(), first, true);
    expect(quiet.fresh).toEqual([]);
    const next = [
      ...first,
      op({ id: "b", at: "2026-10-30T12:00:00Z", source: "bank", tool: "read_feed" }),
    ];
    const live = freshOperations(quiet.seen, next, false);
    expect(live.fresh.map((o) => o.id)).toEqual(["b"]);
    const withSave = [
      ...next,
      op({ id: "c", at: "2026-10-30T12:00:01Z", kind: "snapshot", tool: "save_snapshot" }),
    ];
    const pulses = pulsesFor(
      [...live.fresh, withSave[2] as FieldOperation],
      buildBrainGraph(withSave),
    );
    expect(pulses.map((p) => p.edgeId)).toEqual([
      "source:bank->agent:ingestion",
      "agent:ingestion->output:books",
    ]);
    expect(pulses[1]?.delay).toBeGreaterThan(pulses[0]?.delay ?? 0);
    const lit = activityFor(live.fresh);
    expect([...lit.keys()]).toEqual([
      "agent:ingestion",
      "agent:ingestion|category:read",
      "source:bank",
    ]);
    // Redelivering the same log (reconnect, re-render) is not news.
    expect(freshOperations(live.seen, next, false).fresh).toEqual([]);
  });
});

/** Realistic graphs: the demo history, the demo after every batch, and a live-shaped log. */
function sampleGraphs(): [string, BrainGraph][] {
  let demo = initialDemoState();
  const graphs: [string, BrainGraph][] = [["demo history", buildBrainGraph(demo.operations)]];
  for (let i = 0; i < 5; i++) {
    demo = demoAdvanceFeed(demo, `2026-10-31T10:0${i}:00Z`);
    demo = demoIngest(demo, `2026-10-31T10:0${i}:30Z`);
  }
  demo = demoRecordExport(demo, "2026-10-31T11:00:00Z");
  const finding = demo.findings.find((f) => f.status === "open");
  demo = demoDecide(
    demo,
    { findingId: finding?.id ?? "", decision: "approved", note: "" },
    "2026-10-31T11:01:00Z",
  );
  graphs.push(["demo after every batch", buildBrainGraph(demo.operations)]);
  const live: FieldOperation[] = [];
  const add = (o: Partial<FieldOperation> & { agent: string }) =>
    live.push(
      op({
        id: `l${live.length}`,
        at: `2026-10-30T10:00:${String(live.length).padStart(2, "0")}Z`,
        ...o,
      }),
    );
  add({ agent: "Mock feed", kind: "feed", tool: "sim.createCompany" });
  for (const tool of ["stripe", "ramp", "qbo", "gusto", "hubspot", "plaid"])
    add({
      agent: "Ingestion agent",
      kind: "run",
      tool: `${tool}.consent`,
      source:
        tool === "stripe"
          ? "billing"
          : tool === "ramp"
            ? "cards"
            : tool === "qbo"
              ? "books"
              : tool === "gusto"
                ? "payroll"
                : tool === "hubspot"
                  ? "crm"
                  : "plaid",
    });
  add({ agent: "Ingestion agent", kind: "run", tool: "connectors.pullAll" });
  const start = live.length;
  add({ agent: "Ingestion agent", kind: "run" });
  const first = live[start]?.id;
  for (const [tool, source] of [
    ["mock.billing.list", "billing"],
    ["mock.crm.list", "crm"],
    ["mock.cards.list", "cards"],
    ["mock.books.list", "books"],
    ["mock.payroll.list", "payroll"],
    ["mock.bank.list", "bank"],
  ])
    add({ agent: "Ingestion agent", kind: "pull", tool, source });
  add({ agent: "Ingestion agent", kind: "map", tool: "field.tieOut", source: "billing" });
  add({ agent: "Ingestion agent", kind: "map", tool: "field.map" });
  add({ agent: "Ingestion agent", kind: "snapshot", tool: "convex.snapshots" });
  add({ agent: "Audit agent", kind: "audit", tool: "engine.auditSnapshot", parentId: first });
  add({ agent: "Ingestion agent", kind: "forecast", tool: "engine.recompute" });
  add({ agent: "Mock feed", kind: "feed", tool: "sim.advanceWeek" });
  add({ agent: "Mock feed", kind: "feed", tool: "mock.plant" });
  add({ agent: "Reviewer", kind: "decision" });
  graphs.push(["live-shaped log", buildBrainGraph(live)]);
  // The demo swarm mid-round: 8 forecasters working, a finished round of history.
  let swarm = initialSwarm(Date.parse("2026-10-31T10:00:00Z"));
  for (let i = 0; i < 12; i++)
    swarm = swarmStep(swarm, new Date(Date.parse("2026-10-31T10:00:00Z") + i * 1100).toISOString());
  graphs.push(["demo swarm", buildBrainGraph([...demo.operations, ...swarm.ops])]);
  return graphs;
}

describe("map layout", () => {
  for (const [name, graph] of sampleGraphs()) {
    it(`draws ${name} with no overlapping cards, even with room to spare`, () => {
      const layout = layoutMap(graph);
      expect(overlaps(layout, 8)).toEqual([]);
      // Every drawn link has a route; tools are never separate cards.
      expect(layout.routes).toHaveLength(graph.edges.filter((e) => e.kind !== "uses").length);
      expect([...layout.boxes.keys()].some((id) => id.startsWith("tool:"))).toBe(false);
    });

    it(`groups every tool in ${name} under an agent that used it`, () => {
      const layout = layoutMap(graph);
      const chipped = new Set([...layout.chips.values()].flat().flatMap((c) => c.tools));
      for (const tool of graph.nodes.filter((n) => n.kind === "tool"))
        expect(chipped).toContain(tool.id);
    });

    it(`keeps helpers in ${name} in their manager's cluster, close to it`, () => {
      const layout = layoutMap(graph);
      const roots = clusterRoots(graph);
      for (const helper of graph.nodes.filter((n) => n.kind === "subagent")) {
        const cluster = layout.clusters.find((c) => c.members.includes(helper.id));
        expect(cluster?.id).toBe(roots.get(helper.id));
        const own = layout.boxes.get(helper.id);
        if (!own) throw new Error("missing box");
        // Inside its own cluster's area and clear of every other cluster's area.
        const inside = (b: { x: number; y: number; w: number; h: number }) =>
          own.x >= b.x && own.y >= b.y && own.x + own.w <= b.x + b.w && own.y + own.h <= b.y + b.h;
        const touches = (b: { x: number; y: number; w: number; h: number }) =>
          own.x < b.x + b.w && b.x < own.x + own.w && own.y < b.y + b.h && b.y < own.y + own.h;
        expect(cluster && inside(cluster.bounds)).toBe(true);
        for (const other of layout.clusters.filter((c) => c !== cluster))
          expect(touches(other.bounds)).toBe(false);
      }
    });

    it(`puts sources left of every agent and outputs right of them in ${name}`, () => {
      const layout = layoutMap(graph);
      const box = (n: { id: string }) => layout.boxes.get(n.id);
      const agents = graph.nodes.filter(isAgent).flatMap((n) => box(n) ?? []);
      const left = Math.min(...agents.map((b) => b.x));
      const right = Math.max(...agents.map((b) => b.x + b.w));
      for (const s of graph.nodes.filter((n) => n.kind === "source"))
        expect((box(s)?.x ?? 0) + (box(s)?.w ?? 0)).toBeLessThan(left);
      for (const o of graph.nodes.filter((n) => n.kind === "output"))
        expect(box(o)?.x ?? 0).toBeGreaterThan(right);
    });
  }

  it("puts the coordinator in the middle with its copies on a ring around it", () => {
    const graph = sampleGraphs()[3]?.[1] as BrainGraph;
    const layout = layoutMap(graph);
    const analyst = layout.boxes.get("agent:analyst");
    const copies = graph.nodes.filter(
      (n) => n.parentId === "agent:analyst" && n.role === "forecaster",
    );
    expect(copies.length).toBeGreaterThanOrEqual(8);
    if (!analyst) throw new Error("no analyst");
    const cx = analyst.x + analyst.w / 2;
    const cy = analyst.y + analyst.h / 2;
    const sides = new Set(
      copies
        .flatMap((n) => layout.boxes.get(n.id) ?? [])
        .map((b) => `${b.x + b.w / 2 < cx}${b.y + b.h / 2 < cy}`),
    );
    expect(sides.size).toBe(4);
    // The analyst cluster is the one nearest the middle of all agent clusters.
    const centers = layout.clusters.map((c) => ({
      id: c.id,
      x: c.bounds.x + c.bounds.w / 2,
      y: c.bounds.y + c.bounds.h / 2,
    }));
    const mx = centers.reduce((s, c) => s + c.x, 0) / centers.length;
    const my = centers.reduce((s, c) => s + c.y, 0) / centers.length;
    const nearest = [...centers].sort(
      (a, b) => Math.hypot(a.x - mx, a.y - my) - Math.hypot(b.x - mx, b.y - my),
    )[0];
    expect(nearest?.id).toBe("agent:analyst");
  });

  it("folds finished copies into one stack per cluster without overlaps", () => {
    const graph = sampleGraphs()[3]?.[1] as BrainGraph;
    const finished = graph.nodes.filter((n) => n.lifecycle === "done" && n.kind === "subagent");
    expect(finished.length).toBeGreaterThanOrEqual(9);
    const layout = layoutMap(graph, { collapsed: new Set(finished.map((n) => n.id)) });
    expect(layout.stacks).toHaveLength(1);
    expect(layout.stacks[0]).toMatchObject({ clusterId: "agent:analyst" });
    expect(layout.stacks[0]?.members.length).toBe(finished.length);
    for (const n of finished) expect(layout.boxes.has(n.id)).toBe(false);
    expect(
      layout.routes.some((r) => finished.some((n) => n.id === r.source || n.id === r.target)),
    ).toBe(false);
    expect(overlaps(layout, 8)).toEqual([]);
  });

  it("draws one link per source -> agent pair", () => {
    const graph = sampleGraphs()[2]?.[1] as BrainGraph;
    const feeds = graph.edges.filter((e) => e.kind === "feeds").map((e) => e.id);
    expect(new Set(feeds).size).toBe(feeds.length);
    expect(graph.nodes.filter(isAgent).length).toBeGreaterThan(0);
  });

  it("folds unused built-in agents and completed helpers, expandable, without overlaps", () => {
    for (const [name, graph] of sampleGraphs()) {
      // The coordinator holds the middle even before it has work; it never folds away.
      const idle = idleAgents(graph).filter((id) => id !== CENTER_ID);
      expect(layoutMap(graph, { idle: idleAgents(graph) }).boxes.has(CENTER_ID)).toBe(true);
      const done = new Set(
        graph.nodes.filter((n) => n.kind === "subagent" && n.lifecycle === "done").map((n) => n.id),
      );
      const folded = layoutMap(graph, { collapsed: done, idle: idleAgents(graph) });
      expect(overlaps(folded, 8), name).toEqual([]);
      for (const id of [...idle, ...done])
        expect(folded.boxes.has(id), `${name} ${id}`).toBe(false);
      if (idle.length)
        expect(folded.stacks.find((s) => s.id === IDLE_STACK)?.members).toEqual(idle);
      // Expanding every stack shows its members and keeps a card to fold them again.
      const open = new Set([IDLE_CLUSTER, ...folded.stacks.map((s) => s.clusterId)]);
      const shown = layoutMap(graph, { collapsed: done, idle: idleAgents(graph), expanded: open });
      expect(overlaps(shown, 8), name).toEqual([]);
      for (const id of [...idle, ...done]) expect(shown.boxes.has(id), `${name} ${id}`).toBe(true);
      expect(shown.stacks.every((s) => s.expanded)).toBe(true);
    }
  });

  it("puts lane headings above their lane, clear of every card", () => {
    for (const [name, graph] of sampleGraphs()) {
      const layout = layoutMap(graph, { idle: idleAgents(graph) });
      const cards = [...layout.boxes.values(), ...layout.stacks.map((s) => s.box)];
      for (const lane of layout.lanes) {
        const clash = cards.some(
          (b) =>
            lane.x < b.x + b.w && b.x < lane.x + lane.w && lane.y < b.y + b.h && b.y < lane.y + 20,
        );
        expect(clash, `${name} ${lane.id}`).toBe(false);
      }
      const side = (kind: "source" | "output") =>
        graph.nodes.filter((n) => n.kind === kind).flatMap((n) => layout.boxes.get(n.id) ?? []);
      const top = (kind: "source" | "output") => Math.min(...side(kind).map((b) => b.y));
      expect(layout.lanes.find((l) => l.id === "source")?.y).toBeLessThan(top("source"));
      expect(layout.lanes.find((l) => l.id === "output")?.y).toBeLessThan(top("output"));
    }
  });

  it("uses one count definition for the headline and the lanes", () => {
    const graph = withSavedState(buildBrainGraph([]), {
      booksVersions: 3,
      flags: { total: 2, open: 1 },
      sources: [{ id: "billing", lastPull: "2026-11-02" }],
    });
    expect(mapCounts(graph)).toMatchObject({ agents: 2, sources: 1, outputs: 2 });
    expect(graph.nodes.find((n) => n.id === "output:flags")?.saved).toBe("2 flags, 1 open");
    // Saved reads and books show the pipeline ran even when its rows are older than the loaded
    // log page; other unused built-ins fold away.
    expect(graph.nodes.find((n) => n.id === "agent:ingestion")?.saved).toBe("Data through Nov 2");
    expect(graph.nodes.find((n) => n.id === "agent:audit")?.saved).toBe("2 flags raised");
    expect(idleAgents(graph)).toEqual(["agent:forecaster", "agent:analyst"]);
  });

  it("is deterministic", () => {
    for (const [, graph] of sampleGraphs()) {
      const a = layoutMap(graph);
      // Same log delivered in a different order (newest first, as field.log pages it).
      const ops = new Map(
        graph.nodes.flatMap((n) => [...n.operations, ...n.messages]).map((o) => [o.id, o]),
      );
      const b = layoutMap(buildBrainGraph([...ops.values()].reverse()));
      expect([...a.boxes].sort()).toEqual([...b.boxes].sort());
      expect([...a.routes].sort((x, y) => x.id.localeCompare(y.id))).toEqual(
        [...b.routes].sort((x, y) => x.id.localeCompare(y.id)),
      );
    }
  });
});

describe("pipeline homes", () => {
  // The log is paged, so the order rows arrive in is not the pipeline order. Here the sim clock,
  // the engine and the audit agent all show up before the ingestion agent does.
  const rows = [
    op({
      id: "clock",
      agent: "sim.clock",
      tool: "sim.advanceDay",
      source: "mock",
      at: "2026-10-30T10:00:00Z",
    }),
    op({ id: "engine", agent: "Engine", kind: "forecast", at: "2026-10-30T10:00:01Z" }),
    op({ id: "audit", agent: "Audit agent", kind: "audit", at: "2026-10-30T10:00:02Z" }),
    op({
      id: "plan",
      agent: "Analyst",
      tool: "creao.coordinatorPlan",
      source: "creao",
      at: "2026-10-30T10:00:03Z",
    }),
    op({ id: "read", agent: "Ingestion agent", source: "billing", at: "2026-10-30T10:00:04Z" }),
  ];
  it("keeps sources, ingestion, audit, the analyst and the rest in that order, however rows arrive", () => {
    let memory: ReturnType<typeof layoutMap>["memory"] | undefined;
    let last: ReturnType<typeof layoutMap> | undefined;
    // Grow one row at a time, passing memory along as the map does.
    for (let i = 1; i <= rows.length; i++) {
      const graph = mapSources(buildBrainGraph(rows.slice(0, i)), new Set(["stripe"]));
      last = layoutMap(graph, { idle: idleAgents(graph), memory });
      memory = last.memory;
    }
    const x = (id: string) => last?.boxes.get(id)?.x ?? Number.NaN;
    expect(x("source:billing")).toBeLessThan(x("agent:ingestion"));
    expect(x("agent:ingestion")).toBeLessThan(x("agent:audit"));
    expect(x("agent:audit")).toBeLessThan(x(CENTER_ID));
    expect(x(CENTER_ID)).toBeLessThan(x("agent:engine"));
    // The sim clock feeds the pipeline: above the ingestion agent, not in the middle.
    expect(x("agent:sim-clock")).toBe(x("agent:ingestion"));
    expect(last?.boxes.get("agent:sim-clock")?.y).toBeLessThan(
      last?.boxes.get("agent:ingestion")?.y ?? 0,
    );
  });
  it("shows only data connectors as sources, not CREAO or the simulator feed", () => {
    const graph = mapSources(buildBrainGraph(rows), new Set(["stripe"]));
    expect(graph.nodes.filter((n) => n.kind === "source").map((n) => n.id)).toEqual([
      "source:billing",
    ]);
    // Without connections (demo), still only connectors with recorded work.
    const demo = mapSources(buildBrainGraph(rows));
    expect(demo.nodes.filter((n) => n.kind === "source").map((n) => n.id)).toEqual([
      "source:billing",
    ]);
  });
});

describe("setup gaps", () => {
  let seq = 0;
  const status = (id: string, status: FieldOperation["status"], summary: string, action: string) =>
    op({ id, seq: ++seq, agent: "Analyst", kind: "spawn", status, summary, inputs: { action } });
  it("reads a failure on missing setup as waiting, and a real failure as failed", () => {
    const waiting = buildBrainGraph([
      status("w", "working", "Analyst started", "analyst.working"),
      status("f", "failed", "AI summary unavailable (ANTHROPIC_API_KEY not set)", "agent.failed"),
    ]).nodes.find((n) => n.id === CENTER_ID);
    expect(waiting).toMatchObject({ lifecycle: "failed", waitingFor: "Waiting for an AI key" });
    const failed = buildBrainGraph([
      status("w", "working", "Analyst started", "analyst.working"),
      status("f", "failed", "Run abandoned after its completion deadline", "analyst.failed"),
    ]).nodes.find((n) => n.id === CENTER_ID);
    expect(failed?.lifecycle).toBe("failed");
    expect(failed?.waitingFor).toBeUndefined();
  });
  it("does not restart a finished agent on a later skipped or unavailable note", () => {
    const node = buildBrainGraph([
      status("w", "working", "Started", "agent.spawned"),
      status("d", "done", "Done", "agent.done"),
      status("n", "working", "CREAO unavailable (app not configured)", "research.creaoUnavailable"),
    ]).nodes.find((n) => n.id === CENTER_ID);
    expect(node?.lifecycle).toBe("done");
  });
});

describe("demo fixture", () => {
  it("runs feed -> ingest -> audit -> decision and keeps counts honest", () => {
    let s = initialDemoState();
    expect(s.status.counts).toEqual({ sources: 6, snapshots: 1, openFindings: 1 });
    s = demoAdvanceFeed(s, "2026-10-31T10:00:00Z");
    expect(s.status.feed.lastAdvanceAt).toBe("2026-10-31T10:00:00Z");
    const before = s.operations.length;
    s = demoIngest(s, "2026-10-31T10:00:02Z");
    const added = s.operations.slice(before);
    expect(added.map((o) => o.kind)).toEqual(["pull", "map", "snapshot", "audit"]);
    expect(added[3]?.parentId).toBe(added[2]?.id);
    expect(s.status.counts.openFindings).toBe(2);
    const finding = s.findings.at(-1);
    expect(finding?.kind).toBe("duplicate");
    s = demoDecide(
      s,
      { findingId: finding?.id ?? "", decision: "approved", note: "same charge" },
      "2026-10-31T10:01:00Z",
    );
    expect(s.findings.at(-1)).toMatchObject({ status: "approved", note: "same charge" });
    expect(s.operations.at(-1)?.kind).toBe("decision");
    expect(s.status.counts.openFindings).toBe(1);
    // A decided finding cannot be decided again.
    expect(
      demoDecide(s, { findingId: finding?.id ?? "", decision: "rejected", note: "" }, "x"),
    ).toBe(s);
  });

  it("records an empty check when nothing new arrived", () => {
    const s = demoIngest(initialDemoState(), "2026-10-31T10:00:00Z");
    expect(s.operations.at(-1)?.summary).toMatch(/No new entries/);
    expect(s.findings).toHaveLength(1);
  });

  it("exports a seed that passes the shared verifier", async () => {
    const s = demoRecordExport(initialDemoState(), "2026-10-31T10:00:00Z");
    expect(s.operations.at(-1)?.kind).toBe("export");
    const result = await verifyWeeklySeedText(weeklyFixtureText("validKestrelWeeklySeed"));
    expect(result.ok).toBe(true);
  });

  it("maps free-text statuses to the map's few looks", () => {
    expect(toCanvasStatus("ok")).toBe("succeeded");
    expect(toCanvasStatus("running")).toBe("running");
    expect(toCanvasStatus("error")).toBe("failed");
    expect(toCanvasStatus(undefined)).toBe("idle");
  });
});

describe("recentCalls", () => {
  const apify = (id: string, at: string, agent = "Research agent") =>
    op({
      id,
      at,
      agent,
      tool: "apify.google-search-scraper",
      toolCategory: "apify",
      source: "apify",
      status: "succeeded",
    });

  it("draws one line per agent and provider for recorded calls only, counted once", () => {
    const calls = recentCalls(
      buildBrainGraph([
        apify("a1", "2026-10-30T10:00:00Z"),
        apify("a2", "2026-10-30T10:01:00Z"),
        op({ id: "r1", agent: "ingestion", source: "stripe", tool: "stripe.read" }),
      ]),
    );
    expect(calls.get("agent:research-agent->toolbox:apify")).toMatchObject({
      via: "tool",
      targetName: "Apify",
      calls: 2,
      lastAt: "2026-10-30T10:01:00Z",
    });
    const read = [...calls.values()].find((c) => c.via === "data");
    expect(read?.routeId.endsWith("->agent:ingestion")).toBe(true);
    expect([...calls.values()].every((c) => c.calls > 0)).toBe(true);
  });

  it("keeps the calling agent's latest run only and marks it in flight while it works", () => {
    const calls = recentCalls(
      buildBrainGraph([
        apify("old", "2026-10-30T08:00:00Z", "Other agent"),
        op({ id: "s1", agent: "Research agent", status: "working", at: "2026-10-30T10:00:00Z" }),
        apify("a1", "2026-10-30T10:00:30Z"),
      ]),
    );
    expect(calls.has("agent:other-agent->toolbox:apify")).toBe(false);
    expect(calls.get("agent:research-agent->toolbox:apify")).toMatchObject({
      calls: 1,
      inFlight: true,
    });
  });
});
