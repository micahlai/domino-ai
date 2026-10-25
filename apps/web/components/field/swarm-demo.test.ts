import { describe, expect, it } from "vitest";
import { buildBrainGraph, collapsedInstances, isWorking } from "./graph";
import { SWARM_BEAT_MS, initialSwarm, scriptRound, swarmStep } from "./swarm-demo";

const T0 = Date.parse("2026-10-31T10:00:00Z");
const at = (i: number) => new Date(T0 + i * SWARM_BEAT_MS).toISOString();

describe("demo swarm", () => {
  it("is the same script every time", () => {
    expect(scriptRound(2)).toEqual(scriptRound(2));
    expect(initialSwarm(T0)).toEqual(initialSwarm(T0));
  });

  it("starts with one finished round, then runs 8 forecasters in parallel", () => {
    let s = initialSwarm(T0);
    const history = buildBrainGraph(s.ops);
    // The whole first round is done and old enough to fold away.
    const done = collapsedInstances(history, T0, 3000);
    expect(done.size).toBe(9);
    let peak = 0;
    for (let i = 0; i < 40; i++) {
      s = swarmStep(s, at(i));
      const g = buildBrainGraph(s.ops);
      peak = Math.max(peak, g.nodes.filter((n) => n.role === "forecaster" && isWorking(n)).length);
    }
    expect(peak).toBeGreaterThanOrEqual(6);
    const g = buildBrainGraph(s.ops);
    expect(g.nodes.find((n) => n.id === "agent:analyst")?.messages.length).toBeGreaterThan(10);
    expect(g.nodes.find((n) => n.id === "agent:research-agent")?.agentKind).toBe("creao");
    expect(g.nodes.some((n) => n.agentKind === "claude" && n.kind === "subagent")).toBe(true);
    expect(g.nodes.some((n) => n.kind === "tool" && n.tool?.category === "apify")).toBe(true);
  });

  it("keeps a bounded history on a long run", () => {
    let s = initialSwarm(T0);
    for (let i = 0; i < 400; i++) s = swarmStep(s, at(i));
    expect(s.round).toBeGreaterThan(8);
    const rounds = new Set(s.ops.map((o) => o.id.split("-")[1]));
    expect(rounds.size).toBeLessThanOrEqual(4);
  });
});
