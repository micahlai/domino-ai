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
  NODE_W,
  deliver,
  graphFit,
  layout,
  overlaps,
  safeHref,
  toFlowNodes,
} from "./graph";
import type { CanvasNode } from "./types";

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
  const ringOf = (p: { x: number; y: number } | undefined) =>
    Math.hypot(centerOf(p).x, centerOf(p).y);
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

  it("centers Domino and puts farther records on wider rings", () => {
    const positions = layout([IDLE_DOMINO, source, agent], edges);
    expect(ringOf(positions.get("domino"))).toBe(0);
    expect(ringOf(positions.get("src-1"))).toBeGreaterThan(0);
    expect(ringOf(positions.get("agent-7f3a"))).toBeGreaterThan(ringOf(positions.get("src-1")));
  });

  it("is deterministic", () => {
    const a = layout([IDLE_DOMINO, source, agent], edges);
    const b = layout([IDLE_DOMINO, source, agent], edges);
    expect([...a]).toEqual([...b]);
  });

  it("curves even a five-node chain instead of lining it up", () => {
    const ids = ["domino", "a", "b", "c", "d"];
    const chain = ids.map((id) => (id === "domino" ? IDLE_DOMINO : node(id)));
    const positions = layout(
      chain,
      ids.slice(1).map((id, i) => link(ids[i] as string, id)),
    );
    const [p0, p1, p4] = [ids[0], ids[1], ids[4]].map((id) =>
      centerOf(positions.get(id as string)),
    );
    if (!p0 || !p1 || !p4) throw new Error("missing chain positions");
    // Collinear points have a zero cross product; a curve does not.
    const cross = (p1.x - p0.x) * (p4.y - p0.y) - (p1.y - p0.y) * (p4.x - p0.x);
    expect(Math.abs(cross)).toBeGreaterThan(20000);
    noOverlap([...positions.values()]);
  });

  it("spreads branches around the anchor without adding records", () => {
    const kids = ["a", "b", "c", "d"].map((id) => node(id));
    const out = layout(
      [IDLE_DOMINO, ...kids],
      kids.map((k) => link("domino", k.id)),
    );
    expect(out.size).toBe(5);
    const angles = kids.map((k) =>
      Math.atan2(centerOf(out.get(k.id)).y, centerOf(out.get(k.id)).x),
    );
    expect(new Set(angles.map((a) => Math.round(a * 10))).size).toBe(4);
    noOverlap([...out.values()]);
  });

  it("handles shared dependencies, cycles, disconnected records and a missing anchor", () => {
    const ids = ["a", "b", "c", "x", "y"];
    const all = [IDLE_DOMINO, ...ids.map((id) => node(id))];
    const tangled = [
      link("domino", "a"),
      link("domino", "b"),
      link("a", "c"),
      link("b", "c"), // shared dependency
      link("c", "a"), // cycle
      link("c", "c"), // self loop
      link("a", "ghost"), // unknown id
    ];
    const out = layout(all, tangled);
    expect(out.size).toBe(all.length);
    for (const position of out.values()) {
      expect(Number.isFinite(position.x) && Number.isFinite(position.y)).toBe(true);
    }
    expect(ringOf(out.get("x"))).toBeGreaterThan(0); // disconnected, still placed around the anchor
    const noAnchor = layout([node("a"), node("b")], [link("a", "b")]);
    expect(ringOf(noAnchor.get("a"))).toBe(0);
    expect(ringOf(noAnchor.get("b"))).toBeGreaterThan(0);
  });

  it("is safe for empty input and places a lone anchor at the origin", () => {
    expect(layout([], []).size).toBe(0);
    const lone = layout([IDLE_DOMINO], []);
    expect(centerOf(lone.get("domino"))).toEqual({ x: 0, y: 0 });
  });

  it("restored history is quiet and later arrivals animate once", () => {
    const restored = toFlowNodes([], [IDLE_DOMINO, source], edges, true);
    expect(restored.every((node) => !node.data.enter)).toBe(true);
    const next = toFlowNodes(restored, [IDLE_DOMINO, source, agent], edges, false);
    expect(next.find((node) => node.id === "agent-7f3a")?.data.enter).toBe(true);
    expect(next.find((node) => node.id === "src-1")?.data.enter).toBe(false);
  });

  it("keeps dragged positions and selection across deliveries", () => {
    const moved = toFlowNodes([], [IDLE_DOMINO, source], edges, true).map((node) =>
      node.id === "src-1" ? { ...node, position: { x: 999, y: -5 }, selected: true } : node,
    );
    const next = toFlowNodes(
      moved,
      [IDLE_DOMINO, { ...source, status: "failed" }, agent],
      edges,
      false,
    );
    const kept = next.find((node) => node.id === "src-1");
    expect(kept?.position).toEqual({ x: 999, y: -5 });
    expect(kept?.selected).toBe(true);
    expect(kept?.data.node.status).toBe("failed");
  });

  describe("incremental delivery", () => {
    const first = [IDLE_DOMINO, source];
    const firstEdges = [link("domino", "src-1")];
    const second = node("src-2");
    const allEdges = [...firstEdges, link("domino", "src-2")];

    it("places a sibling delivered later clear of the first without moving it", () => {
      const one = toFlowNodes([], first, firstEdges, true);
      const two = toFlowNodes(one, [...first, second], allEdges, false);
      const a = two.find((n) => n.id === "src-1");
      const b = two.find((n) => n.id === "src-2");
      expect(a?.position).toEqual(one.find((n) => n.id === "src-1")?.position);
      expect(overlaps(a?.position as never, b?.position as never)).toBe(false);
    });

    it("steers around a node the person dragged into the slot", () => {
      const ideal = layout([...first, second], allEdges).get("src-2") as { x: number; y: number };
      const one = toFlowNodes([], first, firstEdges, true).map((n) =>
        n.id === "src-1" ? { ...n, position: { ...ideal } } : n,
      );
      const two = toFlowNodes(one, [...first, second], allEdges, false);
      const a = two.find((n) => n.id === "src-1");
      const b = two.find((n) => n.id === "src-2");
      expect(a?.position).toEqual(ideal);
      expect(overlaps(a?.position as never, b?.position as never)).toBe(false);
    });

    it("keeps a new two-line node clear of an old circle's actual rendered box", () => {
      // A node renders 144 x 126 (circle 72 + gap 6 + two-line title 32 + status 16), so the
      // rectangles themselves, not NODE_BOX, must not intersect.
      const [W, H] = [144, 126];
      const twoLine = (id: string): CanvasNode => ({
        ...node(id),
        title: "A sufficiently long title that wraps onto two lines",
      });
      const nodes = [IDLE_DOMINO, twoLine("old"), twoLine("new")];
      const all = [link("domino", "old"), link("domino", "new")];
      const ideal = layout(nodes, all).get("new") as { x: number; y: number };
      for (const dy of [-126, -116, 0, 100, 116, 126]) {
        const one = toFlowNodes([], nodes.slice(0, 2), all.slice(0, 1), true).map((n) =>
          n.id === "old" ? { ...n, position: { x: ideal.x, y: ideal.y + dy } } : n,
        );
        const two = toFlowNodes(one, nodes, all, false);
        const a = two.find((n) => n.id === "old")?.position as { x: number; y: number };
        const b = two.find((n) => n.id === "new")?.position as { x: number; y: number };
        expect(a).toEqual({ x: ideal.x, y: ideal.y + dy });
        expect(Math.abs(a.x - b.x) >= W || Math.abs(a.y - b.y) >= H).toBe(true);
      }
    });

    it("fits the whole web without its own zoom floor", () => {
      expect(graphFit).not.toHaveProperty("minZoom");
    });

    it("keeps every node apart across many single-record deliveries", () => {
      let current = toFlowNodes([], [IDLE_DOMINO], [], true);
      let nodes: CanvasNode[] = [IDLE_DOMINO];
      let all: { id: string; source: string; target: string }[] = [];
      for (let n = 1; n <= 14; n++) {
        // Alternate between hanging off Domino and off the previous record: a branching web.
        const parent = n % 3 === 0 ? `s${n - 1}` : "domino";
        nodes = [...nodes, node(`s${n}`)];
        all = [...all, link(parent, `s${n}`)];
        current = toFlowNodes(current, nodes, all, false);
      }
      noOverlap(current.map((n) => n.position));
    });

    it("separates a whole delivery that arrives at once", () => {
      const kids = Array.from({ length: 12 }, (_, i) => node(`k${i}`));
      const out = toFlowNodes(
        [],
        [IDLE_DOMINO, ...kids],
        kids.map((k) => link("domino", k.id)),
        true,
      );
      noOverlap(out.map((n) => n.position));
    });

    it("never adds or drops a record or edge", () => {
      const out = toFlowNodes([], [IDLE_DOMINO, source, agent], edges, false);
      expect(out.map((n) => n.id)).toEqual(["domino", "src-1", "agent-7f3a"]);
    });
  });

  describe("quiet history versus live work", () => {
    const edges = [{ id: "a", source: "domino", target: "src-1" }];
    const idleOnly = toFlowNodes([], [IDLE_DOMINO], [], true);
    const fresh = { quiet: false, follow: true, reduced: false };

    it("fits instantly when saved history adds nodes", () => {
      const out = deliver(idleOnly, [IDLE_DOMINO, source], edges, { ...fresh, quiet: true });
      expect(out.fit?.duration).toBe(0);
    });

    it("animates the fit for a real new node, but not under reduced motion", () => {
      expect(deliver(idleOnly, [IDLE_DOMINO, source], edges, fresh).fit?.duration).toBe(300);
      const reduced = deliver(idleOnly, [IDLE_DOMINO, source], edges, { ...fresh, reduced: true });
      expect(reduced.fit?.duration).toBe(0);
    });

    it("does not touch the view once the person has moved it, or when nothing was added", () => {
      expect(
        deliver(idleOnly, [IDLE_DOMINO, source], edges, { ...fresh, follow: false }).fit,
      ).toBeNull();
      const same = deliver(idleOnly, [IDLE_DOMINO], [], fresh);
      expect(same.fit).toBeNull();
    });

    it("lets a status change on a mounted node animate only when the delivery is live", () => {
      const shown = toFlowNodes([], [IDLE_DOMINO, source], edges, true);
      const done = { ...source, status: "failed" as const };
      const quiet = deliver(shown, [IDLE_DOMINO, done], edges, { ...fresh, quiet: true });
      expect(quiet.nodes.find((node) => node.id === "src-1")?.data.live).toBe(false);
      const live = deliver(shown, [IDLE_DOMINO, done], edges, fresh);
      expect(live.nodes.find((node) => node.id === "src-1")?.data.live).toBe(true);
    });

    it("fades a new node in only on a live delivery, and never replays it for old nodes", () => {
      const quiet = deliver(idleOnly, [IDLE_DOMINO, source], edges, { ...fresh, quiet: true });
      expect(quiet.nodes.every((node) => !node.data.enter)).toBe(true);
      const live = deliver(quiet.nodes, [IDLE_DOMINO, source, agent], edges, fresh);
      expect(live.nodes.filter((node) => node.data.enter).map((node) => node.id)).toEqual([
        "agent-7f3a",
      ]);
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
