import { describe, expect, it } from "vitest";
import { buildBrainGraph, isWorking, pulsePath, pulsesFor, toolChips } from "./graph";
import {
  type LiveLogRow,
  type LiveStatus,
  type SwarmLogFields,
  toOperations,
  toStatus,
} from "./live";

let n = 0;
const row = (over: Partial<LiveLogRow> & SwarmLogFields & { action: string }): LiveLogRow =>
  ({
    _id: `log_${++n}`,
    _creationTime: n,
    companyId: "c1",
    at: `2026-10-30T10:00:${String(n).padStart(2, "0")}Z`,
    actor: "connector",
    refs: [],
    ...over,
  }) as LiveLogRow;

describe("live log mapping", () => {
  it("maps a real ingest run to source -> ingestion -> audit -> output on the brain map", () => {
    const rows = [
      row({ action: "ingest.started", agent: "field.ingest", runId: "r1", refs: ["manual"] }),
      row({
        action: "ingest.pulled",
        agent: "field.ingest",
        tool: "mock.cards.list",
        source: "ramp",
        runId: "r1",
      }),
      row({
        action: "audit.escalated",
        actor: "engine",
        agent: "field.audit",
        tool: "engine.auditSnapshot",
        runId: "r1",
        summary: "Card spike",
      }),
    ].reverse(); // field.log is newest first
    const ops = toOperations(rows);
    expect(ops.map((o) => o.kind)).toEqual(["run", "pull", "audit"]);
    expect(ops[0]?.status).toBe("running");
    expect(ops[1]).toMatchObject({ agent: "Ingestion agent", source: "cards" });
    expect(ops[2]).toMatchObject({ agent: "Audit agent", parentId: ops[0]?.id });
    const graph = buildBrainGraph(ops);
    expect(graph.edges.map((e) => e.id)).toEqual(
      expect.arrayContaining([
        "source:cards->agent:ingestion",
        "agent:ingestion->tool:mock.cards.list",
        "agent:ingestion->agent:audit",
        "agent:audit->tool:engine.auditsnapshot",
      ]),
    );
    expect(pulsePath(ops[2] as (typeof ops)[number], graph)).toEqual([
      "agent:ingestion->agent:audit",
      "agent:audit->output:flags",
    ]);
    expect(ops[2]?.actor).toBe("engine");
  });

  it("puts the Connect page's tools on the same vendor nodes as the mock feed", () => {
    const rows = ["qbo", "gusto", "hubspot", "plaid"].map((tool) =>
      row({
        action: "connections.connected",
        actor: "person",
        agent: "field.ingest",
        tool: `${tool}.consent`,
        source: tool,
      }),
    );
    const sources = toOperations(rows).map((o) => o.source);
    expect(sources).toEqual(["books", "payroll", "crm", "plaid"]);
    const graph = buildBrainGraph(toOperations(rows));
    expect(graph.nodes.find((n) => n.id === "source:plaid")).toMatchObject({
      title: "Plaid",
      vendor: "plaid",
    });
  });

  it("marks failures and reads lastAdvanceAt from the feed log", () => {
    const rows = [
      row({ action: "feed.advanced", agent: "mock.feed", at: "2026-10-30T09:00:00Z" }),
      row({ action: "ingest.failed", agent: "field.ingest" }),
    ];
    expect(toOperations(rows).map((o) => o.status)).toEqual(["succeeded", "failed"]);
    const status = {
      auto: true,
      lastIngestAt: "2026-10-30T10:00:00Z",
      lastIngestStatus: "failed",
      lastError: "boom",
      snapshotVersion: 2,
      openFindings: 3,
      openEscalations: 1,
      asOf: "2026-11-02",
      week: 5,
      sources: [{ lastPull: "2026-11-02" }, { lastPull: null }],
    } as unknown as LiveStatus;
    expect(toStatus(status, rows)).toMatchObject({
      feed: { lastAdvanceAt: "2026-10-30T09:00:00Z" },
      ingest: { enabled: true, lastStatus: "failed" },
      counts: { sources: 1, snapshots: 2, openFindings: 3 },
      lastError: "boom",
    });
  });

  it("maps swarm rows: copies, parents, status steps, messages and Apify tools", () => {
    const base = { actor: "engine" as const, runId: "run1" };
    const forecaster = (
      i: number,
      over: Partial<LiveLogRow> & SwarmLogFields & { action: string },
    ) =>
      row({
        ...base,
        agent: `forecaster#${i}`,
        agentId: `forecaster#${i}`,
        parentAgentId: "analyst#1",
        agentKind: "domino",
        steps: 4,
        ...over,
      });
    const rows = [
      row({
        ...base,
        action: "analyst.working",
        agent: "analyst#1",
        agentId: "analyst#1",
        agentKind: "domino",
        event: "status",
        status: "working",
        currentTask: "Test events",
      }),
      ...[1, 2, 3].map((i) =>
        forecaster(i, {
          action: "agent.spawned",
          event: "status",
          status: "spawned",
          currentTask: `Event ${i}`,
        }),
      ),
      row({
        ...base,
        action: "agent.message",
        agent: "analyst#1",
        agentId: "analyst#1",
        event: "message",
        fromAgentId: "analyst#1",
        toAgentId: "forecaster#2",
        summary: "Run event 2",
      }),
      forecaster(2, {
        action: "agent.working",
        event: "status",
        status: "working",
        step: 2,
        currentTask: "Event 2",
      }),
      forecaster(2, {
        action: "agent.message",
        event: "message",
        fromAgentId: "forecaster#2",
        toAgentId: "analyst#1",
        summary: "Week 5 low",
      }),
      forecaster(2, { action: "agent.done", event: "status", status: "done", step: 4 }),
      row({
        ...base,
        action: "agent.tool",
        agent: "research#1",
        agentId: "research#1",
        parentAgentId: "analyst#1",
        agentKind: "creao",
        event: "tool",
        tool: "apify/demo-news-search",
        toolCategory: "apify",
        toolLabel: "demo actor",
        source: "apify",
      }),
    ].reverse();
    const ops = toOperations(rows);
    expect(ops[1]).toMatchObject({
      instanceId: "forecaster#1",
      parentAgentId: "Analyst",
      status: "spawned",
      kind: "spawn",
    });
    expect(ops[4]).toMatchObject({ kind: "message", from: "Analyst", to: "forecaster#2" });
    expect(ops[5]?.progress).toBe(0.5);
    // The top-level analyst#1 is the built-in Analyst; its copies stay instances.
    expect(ops[0]).toMatchObject({ agent: "Analyst", status: "working" });
    expect(ops[0]?.instanceId).toBeUndefined();
    const graph = buildBrainGraph(ops);
    const node = (id: string) => graph.nodes.find((n) => n.id === id);
    expect(node("agent:forecaster#2")).toMatchObject({
      kind: "subagent",
      parentId: "agent:analyst",
      title: "Forecaster 2",
      lifecycle: "done",
      progress: 1,
      currentTask: "Event 2",
    });
    expect(node("agent:forecaster#2")?.messages).toHaveLength(2);
    expect(node("agent:forecaster#1") && isWorking(node("agent:forecaster#1") as never)).toBe(true);
    // One shared link per pair: the spawn link carries both messages, the reply backwards.
    expect(
      graph.edges
        .filter((e) => e.source.includes("forecaster#2") || e.target.includes("forecaster#2"))
        .map((e) => `${e.kind} ${e.id}`),
    ).toEqual(["handoff agent:analyst->agent:forecaster#2"]);
    const pulses = pulsesFor([ops[4], ops[6]] as never, graph);
    expect(pulses.map((p) => [p.edgeId, p.reverse])).toEqual([
      ["agent:analyst->agent:forecaster#2", false],
      ["agent:analyst->agent:forecaster#2", true],
    ]);
    const research = node("agent:research#1");
    expect(research).toMatchObject({ agentKind: "creao", kind: "subagent", title: "Research 1" });
    expect(node("tool:apify/demo-news-search")?.tool).toMatchObject({
      label: "News search",
      demoActor: true,
    });
    expect(node("source:apify")).toMatchObject({ vendor: "apify" });
    expect(research && toolChips(research).map((c) => [c.label, c.category])).toEqual([
      ["Apify actors", "apify"],
    ]);
  });
});
