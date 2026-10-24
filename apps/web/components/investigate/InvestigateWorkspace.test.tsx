import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConversationPanel } from "./ConversationPanel";
import {
  DominoNodeCard,
  InvestigateWorkspace,
  NodeCard,
  NodeDetails,
} from "./InvestigateWorkspace";
import {
  CIRCLE_ROW,
  IDLE_DOMINO,
  NODE_H,
  NODE_W,
  type Recovery,
  deliver,
  fingerprint,
  graphFit,
  layout,
  overlaps,
  pulsesFor,
  safeHref,
  settle,
  toFlowNodes,
  withKnowledge,
  zones,
} from "./graph";
import type { CanvasConnection, CanvasNode } from "./types";

const noop = () => {};

const agent: CanvasNode = {
  id: "agent-7f3a",
  kind: "agent",
  title: "Evidence analyst",
  status: "running",
  profile: {
    role: "Reads saved evidence",
    workingStyle: "Cites every claim",
    instructions: "Use only the supplied filings.",
    version: "v3",
    tools: ["Evidence reader", "Date filter"],
    provider: "Acme",
    model: "acme-large",
    knowledgeCutoff: "2023-11-08",
  },
  metadata: [{ label: "Method", value: "evidence.read" }],
};

const source: CanvasNode = {
  id: "src-1",
  kind: "source",
  title: "Quarterly filing",
  status: "succeeded",
  evidence: [
    { id: "e1", title: "Safe link", url: "https://example.com/a" },
    { id: "e2", title: "Unsafe link", url: "javascript:alert(1)" },
  ],
};

describe("ConversationPanel", () => {
  const html = renderToStaticMarkup(createElement(ConversationPanel));

  it("has a labelled message box and a disabled Send button", () => {
    expect(html).toMatch(/<label[^>]*for="([^"]+)"[^>]*>Message Domino<\/label>/);
    expect(html).toContain("<textarea");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Send/);
  });

  it("wires the honest helper text to the message box", () => {
    const helpId = html.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(helpId).toBeTruthy();
    expect(html).toContain(`id="${helpId}"`);
    expect(html).toContain("connected yet");
    expect(html).toContain("Your draft stays on this device");
  });

  it("does not claim conversations are saved or stored", () => {
    expect(html).not.toMatch(/\b(saved|stored|history)\b/i);
  });

  it("renders supplied messages as text, never as markup", () => {
    const out = renderToStaticMarkup(
      createElement(ConversationPanel, {
        connection: "live",
        onSend: noop,
        messages: [{ id: "1", role: "assistant", text: "<img src=x onerror=alert(1)>" }],
      }),
    );
    expect(out).toContain("&lt;img");
    expect(out).not.toContain("<img");
  });

  it("keeps offline, unavailable, loading, pending and errors distinct from empty", () => {
    const render = (props: Parameters<typeof ConversationPanel>[0]) =>
      renderToStaticMarkup(createElement(ConversationPanel, props));
    expect(render({ connection: "offline" })).toContain("offline. Reconnect to send");
    expect(render({ connection: "unavailable" })).toContain("run investigations right now");
    const loading = render({ connection: "loading" });
    expect(loading).toContain("Loading the conversation");
    expect(loading).not.toContain("Ask Domino to look into a company");
    expect(render({ connection: "live", pending: true, onSend: noop })).toContain(
      "Domino is working on your question",
    );
    expect(render({ connection: "live", error: "Could not send" })).toMatch(
      /role="alert"[^>]*>Could not send/,
    );
  });

  it("shows reveal and alternative only when the parent allows and handles them", () => {
    const render = (props: Parameters<typeof ConversationPanel>[0]) =>
      renderToStaticMarkup(createElement(ConversationPanel, props));
    expect(render({ canReveal: true })).not.toContain("Show what happened");
    expect(render({ onReveal: noop })).not.toContain("Show what happened");
    const both = render({
      canReveal: true,
      onReveal: noop,
      canAlternative: true,
      onAlternative: noop,
    });
    expect(both).toContain("Show what happened");
    expect(both).toContain("Try an alternative");
  });
});

describe("Domino node", () => {
  it("shows an idle node with no technical text", () => {
    const html = renderToStaticMarkup(createElement(DominoNodeCard, { selected: false }));
    expect(html).toContain("Idle");
    expect(html).toContain("Waiting for a question");
  });

  it("details say nothing has run and expose no ids or method names", () => {
    const html = renderToStaticMarkup(createElement(NodeDetails, { onClose: noop }));
    expect(html).toContain('aria-label="Domino details"');
    expect(html).toContain('aria-label="Close details"');
    expect(html).toContain("Idle");
    expect(html).toContain("Nothing has run yet");
    expect(html).toContain("no evidence or output to show");
    expect(html).not.toMatch(/\bdomino\b/);
    expect(html).not.toMatch(/method|\bid\b/i);
  });
});

describe("Truthful empty states", () => {
  const bare = (status: CanvasNode["status"]): CanvasNode => ({
    id: "n",
    kind: "source",
    title: "Filing",
    status,
  });
  const render = (status: CanvasNode["status"]) =>
    renderToStaticMarkup(
      createElement(NodeDetails, { node: bare(status), onClose: noop, connection: "live" }),
    );

  it("never says nothing has run for a node that finished or failed", () => {
    expect(render("succeeded")).not.toContain("Nothing has run yet");
    expect(render("succeeded")).toContain("Finished");
    expect(render("failed")).not.toContain("Nothing has run yet");
    expect(render("failed")).toContain("Failed, and no reason was given");
    expect(render("idle")).toContain("Nothing has run yet");
  });

  it("tells an explicit empty investigation from an omitted nodes prop", () => {
    const empty = renderToStaticMarkup(
      createElement(InvestigateWorkspace, { nodes: [], connection: "live" }),
    );
    expect(empty).toContain("No steps to show yet");
    const loading = renderToStaticMarkup(
      createElement(InvestigateWorkspace, { nodes: [], connection: "loading" }),
    );
    expect(loading).toContain("Loading the investigation");
    const omitted = renderToStaticMarkup(createElement(InvestigateWorkspace));
    expect(omitted).not.toContain("No steps to show yet");
    expect(omitted).not.toContain("Loading the investigation");
    expect(omitted).toContain("Preview");
  });
});

describe("Workspace map", () => {
  const render = (nodes: CanvasNode[]) =>
    renderToStaticMarkup(createElement(InvestigateWorkspace, { nodes, connection: "live" }));

  it("explains that pulses mark recorded activity, only once there is something to connect", () => {
    expect(render([IDLE_DOMINO])).not.toContain("not data moved");
    const html = render([IDLE_DOMINO, source]);
    expect(html).toContain("not data moved");
    expect(html).not.toMatch(/bytes|transfer|throughput/i);
  });
});

describe("Canvas nodes", () => {
  it("labels each kind and status in plain words", () => {
    const html = renderToStaticMarkup(createElement(NodeCard, { node: agent, selected: false }));
    expect(html).toContain("Evidence analyst");
    expect(html).toContain("Agent · Running");
    expect(html).not.toContain("agent-7f3a");
  });

  it("agent details show the supplied profile and hide ids in collapsed technical details", () => {
    const html = renderToStaticMarkup(createElement(NodeDetails, { node: agent, onClose: noop }));
    expect(html).toContain("Instructions and working style");
    expect(html).not.toMatch(/personality/i);
    for (const text of [
      "Reads saved evidence",
      "Cites every claim",
      "Use only the supplied filings.",
      "version v3",
      "Evidence reader, Date filter",
      "Acme · acme-large",
      "2023-11-08",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain("<details");
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
    const visible = html.split("<details")[0] ?? "";
    expect(visible).not.toContain("agent-7f3a");
    expect(visible).not.toContain("evidence.read");
  });

  it("links only http(s) evidence and opens it safely", () => {
    const html = renderToStaticMarkup(createElement(NodeDetails, { node: source, onClose: noop }));
    expect(html).toContain('href="https://example.com/a"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain("javascript:");
    expect(html).toContain("Unsafe link");
  });

  it("puts the parent's output slot inside details", () => {
    const html = renderToStaticMarkup(
      createElement(NodeDetails, {
        node: { id: "o", kind: "output", title: "Forecast", status: "succeeded" },
        onClose: noop,
        output: createElement("figure", null, "chart"),
      }),
    );
    expect(html).toContain("<figure>chart</figure>");
  });
});

describe("graph", () => {
  const edges = [
    { id: "a", source: "domino", target: "src-1" },
    { id: "b", source: "src-1", target: "agent-7f3a" },
  ];

  const centerOf = (p: { x: number; y: number } | undefined) => ({
    x: (p?.x ?? 0) + NODE_W / 2,
    y: (p?.y ?? 0) + CIRCLE_ROW / 2,
  });
  const node = (id: string, kind: CanvasNode["kind"] = "source"): CanvasNode => ({
    ...source,
    id,
    kind,
  });
  const link = (a: string, b: string) => ({ id: `${a}-${b}`, source: a, target: b });
  const noOverlap = (positions: { x: number; y: number }[]) => {
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        expect(overlaps(positions[i] as never, positions[j] as never)).toBe(false);
      }
    }
  };
  // A full company: several sources, specialists, tools and results.
  const company = (): CanvasNode[] => [
    IDLE_DOMINO,
    ...["s0", "s1", "s2", "s3", "s4"].map((id) => node(id, "source")),
    ...["a0", "a1", "a2", "a3"].map((id) => node(id, "agent")),
    ...["t0", "t1"].map((id) => node(id, "tool")),
    ...["o0", "o1", "o2"].map((id) => node(id, "output")),
  ];

  it("centers Domino with Sources left, Toolbox right, specialists above and results below", () => {
    const out = layout(company());
    expect(centerOf(out.get("domino"))).toEqual({ x: 0, y: 0 });
    for (const id of ["s0", "s1", "s2", "s3", "s4"])
      expect(centerOf(out.get(id)).x).toBeLessThan(-NODE_W);
    for (const id of ["t0", "t1"]) expect(centerOf(out.get(id)).x).toBeGreaterThan(NODE_W);
    for (const id of ["a0", "a1", "a2", "a3"]) expect(centerOf(out.get(id)).y).toBeLessThan(-200);
    for (const id of ["o0", "o1", "o2"]) expect(centerOf(out.get(id)).y).toBeGreaterThan(200);
  });

  it("is deterministic, never overlaps, and never adds a record", () => {
    const all = company();
    const a = layout(all);
    expect([...a]).toEqual([...layout(all)]);
    expect(a.size).toBe(all.length);
    noOverlap([...a.values()]);
  });

  it("gives a node the same slot whatever arrives after it", () => {
    const some = layout([IDLE_DOMINO, node("s0"), node("s1")]);
    const more = layout(company());
    expect(more.get("s0")).toEqual(some.get("s0"));
    expect(more.get("s1")).toEqual(some.get("s1"));
  });

  it("is safe for empty input and places a lone Domino at the origin", () => {
    expect(layout([]).size).toBe(0);
    expect(centerOf(layout([IDLE_DOMINO]).get("domino"))).toEqual({ x: 0, y: 0 });
  });

  describe("Sources and Toolbox groups", () => {
    const flow = (all: CanvasNode[]) => toFlowNodes([], all, true);
    const rect = (z: { position: { x: number; y: number }; width?: number; height?: number }) => ({
      l: z.position.x,
      t: z.position.y,
      r: z.position.x + (z.width ?? 0),
      b: z.position.y + (z.height ?? 0),
    });
    const inside = (z: ReturnType<typeof rect>, n: { position: { x: number; y: number } }) =>
      n.position.x >= z.l &&
      n.position.y >= z.t &&
      n.position.x + NODE_W <= z.r &&
      n.position.y + NODE_H <= z.b;

    it("draws nothing around a lone idle Domino", () => {
      expect(zones(flow([IDLE_DOMINO]))).toEqual([]);
    });

    it("groups real members by kind with counts, and only those", () => {
      const nodes = flow(company());
      const [sources, toolbox] = zones(nodes);
      expect(sources?.data).toEqual({ group: "sources", count: 5 });
      expect(toolbox?.data).toEqual({ group: "toolbox", count: 2 });
      for (const n of nodes) {
        const kind = n.data.node.kind;
        const inSources = inside(rect(sources as never), n);
        const inToolbox = inside(rect(toolbox as never), n);
        expect(inSources).toBe(kind === "source");
        expect(inToolbox).toBe(kind === "tool");
      }
    });

    it("keeps both frames visible and honest when a group is empty", () => {
      const [sources, toolbox] = zones(flow([IDLE_DOMINO, node("a0", "agent")]));
      expect(sources?.data.count).toBe(0);
      expect(toolbox?.data.count).toBe(0);
      expect(sources?.width).toBeGreaterThan(NODE_W);
    });

    it("keeps frames apart and out of the way of non-members", () => {
      const nodes = flow(company());
      const [a, b] = zones(nodes).map((z) => rect(z));
      if (!a || !b) throw new Error("missing frames");
      expect(a.r < b.l || b.r < a.l).toBe(true);
      for (const n of nodes) {
        const kind = n.data.node.kind;
        if (kind === "source" || kind === "tool") continue;
        expect(inside(a, n) || inside(b, n)).toBe(false);
        // Not even partly under a frame.
        for (const z of [a, b])
          expect(
            n.position.x < z.r &&
              n.position.x + NODE_W > z.l &&
              n.position.y < z.b &&
              n.position.y + NODE_H > z.t,
          ).toBe(false);
      }
    });

    it("never takes clicks, focus or selection, so it cannot block a child or the drag", () => {
      for (const z of zones(flow(company()))) {
        expect(z.selectable).toBe(false);
        expect(z.draggable).toBe(false);
        expect(z.focusable).toBe(false);
        expect(z.className).toContain("pointer-events-none");
        expect(z.zIndex).toBeLessThan(0);
      }
    });

    it("follows a member the person dragged, so the frame still fits it", () => {
      const moved = flow(company()).map((n) =>
        n.id === "s0" ? { ...n, position: { x: -1500, y: 40 } } : n,
      );
      const sources = zones(moved)[0];
      expect(inside(rect(sources as never), { position: { x: -1500, y: 40 } })).toBe(true);
    });
  });

  describe("company knowledge", () => {
    it("is absent until a source carries saved evidence", () => {
      const bare = [IDLE_DOMINO, { ...source, evidence: [] }];
      expect(withKnowledge(bare)).toBe(bare);
    });

    it("is a distinct view of the saved evidence, without duplicates or invented facts", () => {
      const other: CanvasNode = {
        ...source,
        id: "src-2",
        evidence: [
          { id: "e1", title: "Safe link" },
          { id: "e3", title: "Another" },
        ],
      };
      const out = withKnowledge([IDLE_DOMINO, source, other]);
      const view = out.find((n) => n.kind === "knowledge");
      expect(out).toHaveLength(4);
      expect(view?.id).not.toBe("domino");
      expect(view?.evidence?.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
      expect(view?.summary).toContain("not an agent");
    });

    it("sits below Domino and above the results, and has no run status in words", () => {
      const out = layout(withKnowledge([IDLE_DOMINO, source, node("o0", "output")]));
      const y = (id: string) => centerOf(out.get(id)).y;
      expect(y("company-knowledge")).toBeGreaterThan(y("domino"));
      expect(y("company-knowledge")).toBeLessThan(y("o0"));
      const html = renderToStaticMarkup(
        createElement(NodeCard, {
          node: withKnowledge([source])[1] as CanvasNode,
          selected: false,
        }),
      );
      expect(html).toContain("Saved evidence · 2");
      expect(html).not.toMatch(/Running|Done|Failed/);
    });

    it("details show saved sources, the optional slot, and that no learnings exist", () => {
      const view = withKnowledge([source])[1] as CanvasNode;
      const html = renderToStaticMarkup(
        createElement(NodeDetails, {
          node: view,
          onClose: noop,
          knowledge: createElement("p", null, "slot content"),
        }),
      );
      expect(html).toContain("Saved sources");
      expect(html).toContain("slot content");
      expect(html).toContain("No validated learnings are recorded");
    });
  });

  describe("node shapes", () => {
    it("gives each kind its own shape and colour", () => {
      const kinds = ["agent", "source", "tool", "output", "knowledge"] as const;
      const shapes = kinds.map((kind) => {
        const html = renderToStaticMarkup(
          createElement(NodeCard, {
            node: { ...node("n", kind), status: "idle" },
            selected: false,
          }),
        );
        return html.match(/<span class="([^"]+)"/)?.[1];
      });
      expect(new Set(shapes).size).toBe(kinds.length);
      const domino = renderToStaticMarkup(createElement(DominoNodeCard, { selected: false }));
      expect(domino).toContain("rounded-full");
      for (const shape of shapes) expect(shape).not.toContain("rounded-full");
    });

    it("keeps failure and running outlines over the kind colour", () => {
      const html = (status: CanvasNode["status"]) =>
        renderToStaticMarkup(
          createElement(NodeCard, { node: { ...node("n", "tool"), status }, selected: false }),
        );
      expect(html("failed")).toContain("border-destructive/70");
      expect(html("running")).toContain("border-primary");
      expect(html("succeeded")).toContain("border-amber-400/50");
    });
  });

  it("restored history is quiet and later arrivals animate once", () => {
    const restored = toFlowNodes([], [IDLE_DOMINO, source], true);
    expect(restored.every((node) => !node.data.enter)).toBe(true);
    const next = toFlowNodes(restored, [IDLE_DOMINO, source, agent], false);
    expect(next.find((node) => node.id === "agent-7f3a")?.data.enter).toBe(true);
    expect(next.find((node) => node.id === "src-1")?.data.enter).toBe(false);
  });

  it("keeps dragged positions and selection across deliveries", () => {
    const moved = toFlowNodes([], [IDLE_DOMINO, source], true).map((node) =>
      node.id === "src-1" ? { ...node, position: { x: 999, y: -5 }, selected: true } : node,
    );
    const next = toFlowNodes(moved, [IDLE_DOMINO, { ...source, status: "failed" }, agent], false);
    const kept = next.find((node) => node.id === "src-1");
    expect(kept?.position).toEqual({ x: 999, y: -5 });
    expect(kept?.selected).toBe(true);
    expect(kept?.data.node.status).toBe("failed");
  });

  describe("incremental delivery", () => {
    const first = [IDLE_DOMINO, source];
    const second = node("src-2");

    it("places a sibling delivered later clear of the first without moving it", () => {
      const one = toFlowNodes([], first, true);
      const two = toFlowNodes(one, [...first, second], false);
      const a = two.find((n) => n.id === "src-1");
      const b = two.find((n) => n.id === "src-2");
      expect(a?.position).toEqual(one.find((n) => n.id === "src-1")?.position);
      expect(overlaps(a?.position as never, b?.position as never)).toBe(false);
    });

    it("steers around a node the person dragged into the slot", () => {
      const ideal = layout([...first, second]).get("src-2") as { x: number; y: number };
      const one = toFlowNodes([], first, true).map((n) =>
        n.id === "src-1" ? { ...n, position: { ...ideal } } : n,
      );
      const two = toFlowNodes(one, [...first, second], false);
      const a = two.find((n) => n.id === "src-1");
      const b = two.find((n) => n.id === "src-2");
      expect(a?.position).toEqual(ideal);
      expect(overlaps(a?.position as never, b?.position as never)).toBe(false);
    });

    it("keeps a new two-line node clear of an old node's actual rendered box", () => {
      // A node renders 144 x 126 (shape 72 + gap 6 + two-line title 32 + status 16), so the
      // rectangles themselves, not NODE_BOX, must not intersect.
      const [W, H] = [NODE_W, NODE_H];
      const twoLine = (id: string): CanvasNode => ({
        ...node(id),
        title: "A sufficiently long title that wraps onto two lines",
      });
      const nodes = [IDLE_DOMINO, twoLine("old"), twoLine("new")];
      const ideal = layout(nodes).get("new") as { x: number; y: number };
      for (const dy of [-126, -116, 0, 100, 116, 126]) {
        const one = toFlowNodes([], nodes.slice(0, 2), true).map((n) =>
          n.id === "old" ? { ...n, position: { x: ideal.x, y: ideal.y + dy } } : n,
        );
        const two = toFlowNodes(one, nodes, false);
        const a = two.find((n) => n.id === "old")?.position as { x: number; y: number };
        const b = two.find((n) => n.id === "new")?.position as { x: number; y: number };
        expect(a).toEqual({ x: ideal.x, y: ideal.y + dy });
        expect(Math.abs(a.x - b.x) >= W || Math.abs(a.y - b.y) >= H).toBe(true);
      }
    });

    it("fits the whole map without its own zoom floor", () => {
      expect(graphFit).not.toHaveProperty("minZoom");
    });

    it("keeps every node apart across many single-record deliveries", () => {
      let current = toFlowNodes([], [IDLE_DOMINO], true);
      let nodes: CanvasNode[] = [IDLE_DOMINO];
      const kinds = ["source", "agent", "tool", "output"] as const;
      for (let n = 1; n <= 24; n++) {
        nodes = [...nodes, node(`s${n}`, kinds[n % kinds.length])];
        current = toFlowNodes(current, nodes, false);
      }
      noOverlap(current.map((n) => n.position));
    });

    it("separates a whole delivery that arrives at once", () => {
      const kids = Array.from({ length: 12 }, (_, i) => node(`k${i}`));
      const out = toFlowNodes([], [IDLE_DOMINO, ...kids], true);
      noOverlap(out.map((n) => n.position));
    });

    it("never adds or drops a record", () => {
      const out = toFlowNodes([], [IDLE_DOMINO, source, agent], false);
      expect(out.map((n) => n.id)).toEqual(["domino", "src-1", "agent-7f3a"]);
    });
  });

  describe("quiet history versus live work", () => {
    const idleOnly = toFlowNodes([], [IDLE_DOMINO], true);
    const fresh = { quiet: false, follow: true, reduced: false };

    it("fits instantly when saved history adds nodes", () => {
      const out = deliver(idleOnly, [IDLE_DOMINO, source], { ...fresh, quiet: true });
      expect(out.fit?.duration).toBe(0);
    });

    it("animates the fit for a real new node, but not under reduced motion", () => {
      expect(deliver(idleOnly, [IDLE_DOMINO, source], fresh).fit?.duration).toBe(300);
      const reduced = deliver(idleOnly, [IDLE_DOMINO, source], { ...fresh, reduced: true });
      expect(reduced.fit?.duration).toBe(0);
    });

    it("does not touch the view once the person has moved it, or when nothing was added", () => {
      expect(deliver(idleOnly, [IDLE_DOMINO, source], { ...fresh, follow: false }).fit).toBeNull();
      const same = deliver(idleOnly, [IDLE_DOMINO], fresh);
      expect(same.fit).toBeNull();
    });

    it("lets a status change on a mounted node animate only when the delivery is live", () => {
      const shown = toFlowNodes([], [IDLE_DOMINO, source], true);
      const done = { ...source, status: "failed" as const };
      const quiet = deliver(shown, [IDLE_DOMINO, done], { ...fresh, quiet: true });
      expect(quiet.nodes.find((node) => node.id === "src-1")?.data.live).toBe(false);
      const live = deliver(shown, [IDLE_DOMINO, done], fresh);
      expect(live.nodes.find((node) => node.id === "src-1")?.data.live).toBe(true);
    });

    it("fades a new node in only on a live delivery, and never replays it for old nodes", () => {
      const quiet = deliver(idleOnly, [IDLE_DOMINO, source], { ...fresh, quiet: true });
      expect(quiet.nodes.every((node) => !node.data.enter)).toBe(true);
      const live = deliver(quiet.nodes, [IDLE_DOMINO, source, agent], fresh);
      expect(live.nodes.filter((node) => node.data.enter).map((node) => node.id)).toEqual([
        "agent-7f3a",
      ]);
    });
  });

  describe("reconnect recovery latch", () => {
    const wires = [link("domino", "s0"), link("s0", "a0")];
    const at = (status: CanvasNode["status"]) => [
      IDLE_DOMINO,
      { ...node("s0"), status: "succeeded" as const },
      { ...node("a0", "agent"), status },
    ];
    // One render of the workspace effect: settle, then pulse against what was already seen.
    const sequence = (steps: [CanvasConnection, CanvasNode[]][]) => {
      const first = steps[0]?.[1] ?? [];
      let recovery: Recovery = { held: false, print: fingerprint(first) };
      let seen = pulsesFor(new Set(), first, wires, true).seen;
      return steps.map(([connection, incoming]) => {
        const settled = settle(recovery, connection, incoming);
        recovery = settled.recovery;
        const next = pulsesFor(seen, incoming, wires, settled.quiet);
        seen = next.seen;
        return next.pulses.map((p) => p.key);
      });
    };

    it("keeps offline -> cached queued -> catch-up quiet, then pulses true live work", () => {
      const out = sequence([
        ["live", at("queued")],
        ["offline", at("queued")],
        ["live", at("queued")], // socket back, cached snapshot
        ["live", [...at("queued")]], // same content, new array identity
        ["live", at("queued")],
        ["live", at("succeeded")], // catch-up of work done while away
        ["live", at("succeeded")],
      ]);
      expect(out.every((pulses) => pulses.length === 0)).toBe(true);
      // The catch-up releases the latch, so the next real transition pulses again.
      const resumed = sequence([
        ["offline", at("queued")],
        ["live", at("queued")],
        ["live", at("running")],
        ["live", at("succeeded")],
      ]);
      expect(resumed).toEqual([[], [], [], ["s0-a0:succeeded"]]);
    });

    it("stays held through repeated unchanged cached snapshots", () => {
      let r: Recovery = { held: false, print: fingerprint(at("queued")) };
      for (const c of ["offline", "live", "live", "preview"] as const) {
        const s = settle(r, c, at("queued"));
        r = s.recovery;
        expect(s.quiet).toBe(true);
      }
      expect(r.held).toBe(true);
      expect(settle(r, "live", at("running")).recovery.held).toBe(false);
    });

    it("changes in loading, offline or unavailable never release it", () => {
      for (const c of ["loading", "offline", "unavailable"] as const) {
        const s = settle({ held: true, print: "" }, c, at("running"));
        expect(s).toMatchObject({ quiet: true, recovery: { held: true } });
      }
    });

    it("is not held while simply live", () => {
      const s = settle({ held: false, print: fingerprint(at("queued")) }, "live", at("running"));
      expect(s.quiet).toBe(false);
    });
  });

  describe("operation pulses", () => {
    const wires = [link("domino", "s0"), link("s0", "a0"), link("s0", "t0")];
    const run = (status: CanvasNode["status"]) => [
      IDLE_DOMINO,
      { ...node("s0"), status: "succeeded" as const },
      { ...node("a0", "agent"), status },
    ];

    it("restored history and reconnects stay quiet but are remembered", () => {
      const restored = pulsesFor(new Set(), run("succeeded"), wires, true);
      expect(restored.pulses).toEqual([]);
      // The same snapshot delivered live afterwards is still not news.
      expect(pulsesFor(restored.seen, run("succeeded"), wires, false).pulses).toEqual([]);
    });

    it("a new live step pulses the dependency that points at it, once", () => {
      const quiet = pulsesFor(new Set(), run("queued"), wires, true);
      const live = pulsesFor(quiet.seen, run("running"), wires, false);
      expect(live.pulses).toEqual([{ key: "s0-a0:running", edgeId: "s0-a0" }]);
      // Polling again with nothing new does not repeat it.
      expect(pulsesFor(live.seen, run("running"), wires, false).pulses).toEqual([]);
    });

    it("a later recorded transition pulses again, with its own identity", () => {
      const running = pulsesFor(new Set(), run("running"), wires, true);
      const done = pulsesFor(running.seen, run("succeeded"), wires, false);
      expect(done.pulses.map((p) => p.key)).toEqual(["s0-a0:succeeded"]);
    });

    it("work that finished between polls pulses without inventing a running step", () => {
      const before = pulsesFor(new Set(), [IDLE_DOMINO, node("s0")], [link("domino", "s0")], true);
      const after = pulsesFor(before.seen, run("succeeded"), wires, false);
      expect(after.pulses.map((p) => p.key)).toEqual(["s0-a0:succeeded"]);
      expect(after.pulses.some((p) => p.key.endsWith(":running"))).toBe(false);
    });

    it("never celebrates failed or waiting work, and Domino has nothing to pulse", () => {
      const quiet = pulsesFor(new Set(), [IDLE_DOMINO, node("s0")], wires, true);
      expect(pulsesFor(quiet.seen, run("failed"), wires, false).pulses).toEqual([]);
      expect(pulsesFor(quiet.seen, run("queued"), wires, false).pulses).toEqual([]);
      const dominoRuns = [{ ...IDLE_DOMINO, status: "running" as const }];
      expect(pulsesFor(new Set(), dominoRuns, wires, false).pulses).toEqual([]);
    });

    it("follows only actual dependency edges, never a group or an unrelated pair", () => {
      const live = pulsesFor(new Set(), run("succeeded"), wires, false);
      const real = new Set(wires.map((w) => w.id));
      expect(live.pulses.length).toBeGreaterThan(0);
      for (const pulse of live.pulses) expect(real.has(pulse.edgeId)).toBe(true);
    });
  });

  it("rejects non-http evidence links", () => {
    expect(safeHref("https://example.com/x")).toBe("https://example.com/x");
    expect(safeHref("http://example.com/x")).toBe("http://example.com/x");
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("data:text/html,hi")).toBeUndefined();
    expect(safeHref("not a url")).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
  });
});
