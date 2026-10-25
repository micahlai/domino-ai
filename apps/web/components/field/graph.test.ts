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
  buildBrainGraph,
  freshOperations,
  layoutBrain,
  neighbors,
  pulsePath,
  pulsesFor,
  toCanvasStatus,
} from "./graph";
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
  it("always shows the built-in agents and sources, idle until the log says otherwise", () => {
    const graph = buildBrainGraph([]);
    expect(graph.nodes.filter((n) => n.kind === "agent").map((n) => n.id)).toEqual([
      "agent:ingestion",
      "agent:audit",
      "agent:forecaster",
      "agent:analyst",
    ]);
    expect(graph.nodes.filter((n) => n.kind === "source")).toHaveLength(6);
    expect(graph.nodes.every((n) => n.status === "idle")).toBe(true);
    expect(graph.edges).toEqual([]);
  });

  it("links source -> agent -> tool from recorded operations and keeps the latest status", () => {
    const graph = buildBrainGraph([
      op({
        id: "b",
        at: "2026-10-30T11:00:00Z",
        source: "cards",
        tool: "read_feed",
        status: "failed",
      }),
      op({ id: "a", source: "Cards", tool: "read_feed" }),
    ]);
    expect(graph.edges.map((e) => e.id)).toEqual([
      "source:cards->agent:ingestion",
      "agent:ingestion->tool:read_feed",
    ]);
    const tool = graph.nodes.find((n) => n.id === "tool:read_feed");
    expect(tool?.operations.map((o) => o.id)).toEqual(["a", "b"]);
    expect(tool?.status).toBe("failed");
    expect(graph.nodes.find((n) => n.id === "source:cards")?.title).toBe("Card spending");
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
    ).toEqual(["agent:audit->agent:timing-checker", "agent:timing-checker->tool:compare"]);
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
    const pulses = pulsesFor(live.fresh, buildBrainGraph(next));
    expect(pulses.map((p) => p.edgeId)).toEqual([
      "source:bank->agent:ingestion",
      "agent:ingestion->tool:read_feed",
    ]);
    expect(pulses[1]?.delay).toBeGreaterThan(pulses[0]?.delay ?? 0);
    // Redelivering the same log (reconnect, re-render) is not news.
    expect(freshOperations(live.seen, next, false).fresh).toEqual([]);
  });

  it("gives existing nodes the same slot when new ones arrive", () => {
    const before = layoutBrain(buildBrainGraph([op({ id: "a", tool: "x" })]).nodes);
    const after = layoutBrain(
      buildBrainGraph([op({ id: "a", tool: "x" }), op({ id: "b", tool: "y" })]).nodes,
    );
    for (const [id, at] of before) expect(after.get(id)).toEqual(at);
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
