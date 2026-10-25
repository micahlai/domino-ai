import { describe, expect, it } from "vitest";
import { timelineRunHref } from "./cross-links";
import { demoAdvanceFeed, demoIngest, initialDemoState } from "./fixture";
import {
  buildBrainGraph,
  idleAgents,
  mapSources,
  recentCalls,
  toolboxGroups,
  toolboxId,
} from "./graph";
import { type LiveLogRow, type SwarmLogFields, toOperations } from "./live";
import { ASK_ID, CENTER_ID, type LayoutMemory, layoutMap, overlaps } from "./map-layout";
import { initialSwarm, swarmStep } from "./swarm-demo";
import type { FieldOperation } from "./types";

// Ask Domino rows as convex/timeline/chat/brainLog.ts writes them, on the Brain map.

let n = 0;
const row = (over: Partial<LiveLogRow> & SwarmLogFields & { action: string }): LiveLogRow =>
  ({
    _id: `chat_${++n}`,
    _creationTime: 1_000_000 + n,
    companyId: "c1",
    at: `2026-10-31T10:30:${String(n).padStart(2, "0")}Z`,
    actor: "engine",
    refs: [],
    agent: "chat#1",
    agentId: "chat#1",
    agentKind: "domino",
    ...over,
  }) as LiveLogRow;
const ref = "timeline:kestrel/timeline%3Arun%2Fabc";
const chatRows = () => [
  row({ action: "chat.tool", runId: "chat-a", event: "tool", tool: "lookup_forecast" }),
  row({
    action: "chat.claude",
    runId: "chat-a",
    event: "tool",
    tool: "claude.askDomino",
    status: "done",
  }),
  row({
    action: "chat.turn",
    runId: "chat-a",
    event: "status",
    status: "done",
    summary: "Answered a Timeline chat message",
  }),
  row({
    action: "chat.saved",
    runId: "chat-b",
    event: "tool",
    tool: "timeline.saveScenario",
    toolCategory: "forecast",
    status: "done",
    refs: [ref],
    summary: "Saved scenario: Northwind pays 30 days late",
  }),
  row({
    action: "chat.message",
    runId: "chat-b",
    event: "message",
    fromAgentId: "chat#1",
    toAgentId: "engine",
    refs: [ref],
    summary: "Engine computed the scenario",
  }),
];

function baseOps(): FieldOperation[] {
  let demo = initialDemoState();
  demo = demoIngest(demo, "2026-10-31T10:00:00Z");
  demo = demoAdvanceFeed(demo, "2026-10-31T10:01:00Z");
  demo = demoIngest(demo, "2026-10-31T10:02:00Z");
  let swarm = initialSwarm(Date.parse("2026-10-31T10:03:00Z"));
  for (let i = 0; i < 12; i++)
    swarm = swarmStep(swarm, new Date(Date.parse("2026-10-31T10:03:00Z") + i * 1100).toISOString());
  return [...demo.operations, ...swarm.ops];
}
function mapOf(ops: FieldOperation[], memory?: LayoutMemory) {
  const full = buildBrainGraph(ops);
  const graph = mapSources(full);
  return {
    full,
    graph,
    layout: layoutMap(graph, { idle: idleAgents(graph), toolbox: toolboxGroups(full), memory }),
  };
}

describe("Ask Domino on the Brain map", () => {
  it("draws one Ask Domino agent linked to Claude, the engine and the cash forecast", () => {
    const { full, layout } = mapOf([...baseOps(), ...toOperations(chatRows())]);
    const ask = full.nodes.find((x) => x.id === ASK_ID);
    expect(ask).toMatchObject({ title: "Ask Domino", kind: "agent", agentKind: "domino" });
    expect(ask?.brief).toMatch(/Timeline chat/);
    const edges = full.edges.map((e) => `${e.kind}:${e.id}`);
    expect(edges).toContain(`message:${ASK_ID}->agent:engine`);
    expect(edges).toContain(`produces:${ASK_ID}->output:forecast`);
    expect(toolboxGroups(full).find((g) => g.provider === "claude")?.users).toContain(ASK_ID);
    expect(recentCalls(full).get(`${ASK_ID}->${toolboxId("claude")}`)).toMatchObject({
      via: "tool",
      targetName: "Claude",
    });
    expect(layout.routes.map((r) => r.id)).toEqual(
      expect.arrayContaining([`${ASK_ID}->agent:engine`, `${ASK_ID}->output:forecast`]),
    );
  });

  it("sits in a fixed home right of the analyst and moves nothing when it first appears", () => {
    const before = mapOf(baseOps());
    // Live: the previous layout's memory is passed on, as the map does.
    const live = mapOf([...baseOps(), ...toOperations(chatRows())], before.layout.memory);
    // Fresh load: the same graph with the chat rows, no memory.
    const fresh = mapOf([...baseOps(), ...toOperations(chatRows())]);
    for (const after of [live.layout, fresh.layout]) {
      for (const [id, box] of before.layout.boxes) {
        const next = after.boxes.get(id);
        if (next) expect([id, next.x, next.y]).toEqual([id, box.x, box.y]);
      }
      expect(overlaps(after)).toEqual([]);
    }
    const ask = live.layout.boxes.get(ASK_ID);
    const center = live.layout.boxes.get(CENTER_ID);
    const output = live.layout.boxes.get("output:forecast");
    expect(ask && center && output).toBeTruthy();
    expect(ask?.x).toBeGreaterThan((center?.x ?? 0) + (center?.w ?? 0));
    expect((ask?.x ?? 0) + (ask?.w ?? 0)).toBeLessThan(output?.x ?? 0);
    expect(fresh.layout.boxes.get(ASK_ID)).toEqual(ask);
  });

  it("links a saved chat scenario row back to its Timeline run", () => {
    const saved = toOperations(chatRows()).find((o) => o.inputs?.action === "chat.saved");
    expect(timelineRunHref(saved?.outputs?.refs as string[])).toBe(
      "/c/kestrel/timeline?runId=timeline%3Arun%2Fabc",
    );
    expect(timelineRunHref(["scenario 1"])).toBeNull();
    expect(timelineRunHref(undefined)).toBeNull();
  });
});
