"use client";

import { InvestigateWorkspace } from "@/components/investigate/InvestigateWorkspace";
import type {
  CanvasConnection,
  CanvasEdge,
  CanvasMessage,
  CanvasNode,
} from "@/components/investigate/types";
import { Button } from "@/components/ui/button";
import { useState } from "react";

// Manual fixtures only. Nothing here runs an agent, fetches data or calculates money.
// Every record changes only when a person presses a button below.

type Graph = { nodes: CanvasNode[]; edges: CanvasEdge[] };

const domino: CanvasNode = { id: "domino", kind: "domino", title: "Domino", status: "idle" };

const edge = (source: string, target: string): CanvasEdge => ({
  id: `${source}-${target}`,
  source,
  target,
});

function patch(graph: Graph, id: string, change: Partial<CanvasNode>): Graph {
  return { ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, ...change } : n)) };
}

function add(graph: Graph, node: CanvasNode, from: string): Graph {
  return { nodes: [...graph.nodes, node], edges: [...graph.edges, edge(from, node.id)] };
}

// A node reached from several parents (a shared dependency).
function addFrom(graph: Graph, node: CanvasNode, parents: string[]): Graph {
  return {
    nodes: [...graph.nodes, node],
    edges: [...graph.edges, ...parents.map((from) => edge(from, node.id))],
  };
}

type Step = { label: string; apply: (graph: Graph) => Graph };

const STEPS: Step[] = [
  { label: "Domino starts", apply: (g) => patch(g, "domino", { status: "running" }) },
  {
    label: "Source arrives",
    apply: (g) =>
      add(
        g,
        {
          id: "source-a",
          kind: "source",
          title: "Fixture filing",
          status: "succeeded",
          summary: "Fixture source with two evidence items",
          evidence: [
            {
              id: "ev-1",
              title: "Fixture evidence with a safe link",
              url: "https://example.com/fixture-filing",
              publishedAt: "2023-11-08",
              excerpt: "Fixture excerpt. Real excerpts come from saved evidence.",
            },
            {
              id: "ev-2",
              title: "Fixture evidence with an unsafe link (shown as text)",
              url: "javascript:alert(1)",
            },
          ],
          metadata: [{ label: "Source id", value: "fixture-source-a" }],
        },
        "domino",
      ),
  },
  {
    label: "Agent starts",
    apply: (g) =>
      add(
        g,
        {
          id: "agent-a",
          kind: "agent",
          title: "Evidence analyst",
          status: "running",
          profile: {
            role: "Fixture role: reads the saved evidence",
            workingStyle: "Fixture working style: cites each claim, says when evidence is missing.",
            instructions: "Fixture instructions. Real runs show the exact saved instructions.",
            version: "fixture-1",
            tools: ["Fixture evidence reader"],
            provider: "Fixture provider",
            model: "fixture-model",
            knowledgeCutoff: "2023-11-08",
          },
        },
        "source-a",
      ),
  },
  {
    label: "Agent finishes",
    apply: (g) =>
      patch(g, "agent-a", { status: "succeeded", outputText: "Fixture agent output text." }),
  },
  {
    label: "Tool starts",
    apply: (g) =>
      add(g, { id: "tool-a", kind: "tool", title: "Forecast tool", status: "running" }, "agent-a"),
  },
  {
    label: "Tool fails",
    apply: (g) =>
      patch(g, "tool-a", {
        status: "failed",
        error: "Fixture failure: the tool returned an error.",
      }),
  },
  {
    label: "Result arrives",
    apply: (g) =>
      add(
        g,
        {
          id: "output-a",
          kind: "output",
          title: "Forecast result",
          status: "succeeded",
          outputText:
            "Fixture result text. The chart slot below is where the parent renders the real chart.",
        },
        "tool-a",
      ),
  },
];

const EMPTY: Graph = { nodes: [domino], edges: [] };
const FULL = STEPS.reduce((graph, step) => step.apply(graph), EMPTY);

// Branching web for visual review: several sources, specialists and outputs, with shared dependencies.
const node = (id: string, kind: CanvasNode["kind"], title: string): CanvasNode => ({
  id,
  kind,
  title,
  status: "running",
});

const WEB_STEPS: Step[] = [
  { label: "Domino starts", apply: (g) => patch(g, "domino", { status: "running" }) },
  {
    label: "Three sources arrive",
    apply: (g) =>
      ["Fixture filing", "Fixture news", "Fixture call transcript"].reduce(
        (acc, title, i) =>
          add(acc, { ...node(`src-${i}`, "source", title), status: "succeeded" }, "domino"),
        g,
      ),
  },
  {
    label: "Two specialists start",
    apply: (g) =>
      addFrom(
        add(g, node("agent-0", "agent", "Filing specialist"), "src-0"),
        node("agent-1", "agent", "Market specialist (reads news and the call)"),
        ["src-1", "src-2"],
      ),
  },
  {
    label: "Specialists finish",
    apply: (g) =>
      patch(patch(g, "agent-0", { status: "succeeded" }), "agent-1", { status: "succeeded" }),
  },
  {
    label: "Two tools start",
    apply: (g) =>
      add(
        add(g, node("tool-0", "tool", "Fixture forecast tool"), "agent-0"),
        node("tool-1", "tool", "Fixture comparison tool"),
        "agent-1",
      ),
  },
  {
    label: "Tools finish",
    apply: (g) =>
      patch(patch(g, "tool-0", { status: "succeeded" }), "tool-1", { status: "failed" }),
  },
  {
    label: "Three results arrive",
    apply: (g) =>
      add(
        add(
          addFrom(g, { ...node("out-0", "output", "Fixture summary"), status: "succeeded" }, [
            "tool-0",
            "tool-1",
          ]),
          { ...node("out-1", "output", "Fixture risk list"), status: "succeeded" },
          "tool-1",
        ),
        { ...node("out-2", "output", "Fixture forecast chart"), status: "succeeded" },
        "tool-0",
      ),
  },
];

const run = (steps: Step[]) => steps.reduce((graph, step) => step.apply(graph), EMPTY);
const SCENARIOS = {
  chain: { steps: STEPS, full: FULL },
  web: { steps: WEB_STEPS, full: run(WEB_STEPS) },
};
type ScenarioKey = keyof typeof SCENARIOS;

const HISTORY: CanvasMessage[] = [
  { id: "m1", role: "user", text: "Fixture question" },
  { id: "m2", role: "assistant", text: "Fixture answer. Real answers come from saved messages." },
];

const CONNECTIONS: CanvasConnection[] = ["live", "loading", "offline", "unavailable", "preview"];

export function AgentCanvasFixtures() {
  const [session, setSession] = useState(1);
  const [graph, setGraph] = useState(EMPTY);
  const [scenario, setScenario] = useState<ScenarioKey>("chain");
  const [step, setStep] = useState(0);
  const [messages, setMessages] = useState<CanvasMessage[]>([]);
  const [connection, setConnection] = useState<CanvasConnection>("live");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [actions, setActions] = useState(false);
  const [chartSlot, setChartSlot] = useState(true);

  const { steps, full } = SCENARIOS[scenario];

  function restart(
    next: Graph,
    nextStep: number,
    nextMessages: CanvasMessage[],
    key: ScenarioKey = scenario,
  ) {
    setScenario(key);
    setSession((s) => s + 1);
    setGraph(next);
    setStep(nextStep);
    setMessages(nextMessages);
  }

  function deliver() {
    const next = steps[step];
    if (!next) return;
    setGraph(next.apply(graph));
    setStep(step + 1);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs">
        <p className="mr-2 font-medium">
          Manual fixtures. Nothing here is real: no agents run and no data is fetched.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="min-h-11"
          onClick={() => restart(EMPTY, 0, [], "chain")}
        >
          New empty session
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="min-h-11"
          onClick={() => restart(EMPTY, 0, [], "web")}
        >
          New branching web session (fixture)
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="min-h-11"
          onClick={() => restart(full, steps.length, HISTORY)}
        >
          Load saved history
        </Button>
        <Button size="sm" className="min-h-11" onClick={deliver} disabled={step >= steps.length}>
          {steps[step] ? `Deliver: ${steps[step]?.label}` : "All records delivered"}
        </Button>
        <label className="flex items-center gap-1.5">
          Connection
          <select
            value={connection}
            onChange={(event) => setConnection(event.target.value as CanvasConnection)}
            className="h-11 rounded-md border border-input bg-background px-2"
          >
            {CONNECTIONS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        {(
          [
            ["Pending", pending, setPending],
            ["Error", failed, setFailed],
            ["Reveal and alternative allowed", actions, setActions],
            ["Chart slot", chartSlot, setChartSlot],
          ] as const
        ).map(([label, value, set]) => (
          <label key={label} className="flex min-h-11 items-center gap-1.5">
            <input
              type="checkbox"
              checked={value}
              onChange={(event) => set(event.target.checked)}
            />
            {label}
          </label>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        <InvestigateWorkspace
          sessionId={`fixture-${session}`}
          nodes={graph.nodes}
          edges={graph.edges}
          messages={messages}
          connection={connection}
          pending={pending}
          error={failed ? "Fixture error: the last question could not be sent." : undefined}
          onSend={(text) =>
            setMessages((current) => [...current, { id: `u${current.length}`, role: "user", text }])
          }
          canReveal={actions}
          canAlternative={actions}
          onReveal={() =>
            setMessages((current) => [
              ...current,
              { id: `s${current.length}`, role: "system", text: "Fixture: reveal pressed." },
            ])
          }
          onAlternative={() =>
            setMessages((current) => [
              ...current,
              { id: `s${current.length}`, role: "system", text: "Fixture: alternative pressed." },
            ])
          }
          renderOutput={(node) =>
            chartSlot && node.kind === "output" ? (
              <div className="grid h-64 place-items-center rounded-lg border border-dashed px-4 text-center text-sm text-muted-foreground">
                Chart slot. The parent renders the existing financial chart here.
              </div>
            ) : null
          }
        />
      </div>
    </>
  );
}
