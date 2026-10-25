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
  isAgent,
  neighbors,
  pulsePath,
  pulsesFor,
  toCanvasStatus,
  toolChips,
} from "./graph";
import { crossings, layoutMap, overlaps } from "./map-layout";
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
  return graphs;
}

describe("map layout", () => {
  for (const [name, graph] of sampleGraphs()) {
    it(`draws ${name} with no crossing links and no overlapping cards`, () => {
      const layout = layoutMap(graph);
      expect(crossings(layout)).toEqual([]);
      expect(overlaps(layout)).toEqual([]);
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

    it(`nests helpers in ${name} directly under their manager`, () => {
      const layout = layoutMap(graph);
      for (const helper of graph.nodes.filter((n) => n.kind === "subagent")) {
        const own = layout.boxes.get(helper.id);
        const boss = layout.boxes.get(helper.parentId ?? "");
        expect(own && boss && own.x > boss.x && own.y > boss.y).toBe(true);
      }
    });
  }

  it("draws one link per source -> agent pair", () => {
    const graph = sampleGraphs()[2]?.[1] as BrainGraph;
    const feeds = graph.edges.filter((e) => e.kind === "feeds").map((e) => e.id);
    expect(new Set(feeds).size).toBe(feeds.length);
    expect(graph.nodes.filter(isAgent).length).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    const graph = sampleGraphs()[1]?.[1] as BrainGraph;
    const a = layoutMap(graph);
    const b = layoutMap(graph);
    expect([...a.boxes]).toEqual([...b.boxes]);
    expect(a.routes).toEqual(b.routes);
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
