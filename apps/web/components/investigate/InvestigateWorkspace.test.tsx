import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConversationPanel } from "./ConversationPanel";
import { DominoNodeCard, NodeCard, NodeDetails } from "./InvestigateWorkspace";
import { IDLE_DOMINO, layout, safeHref, toFlowNodes } from "./graph";
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

  it("lays out columns by distance from Domino", () => {
    const positions = layout([IDLE_DOMINO, source, agent], edges);
    expect(positions.get("domino")?.x).toBe(0);
    expect(positions.get("src-1")?.x).toBeGreaterThan(0);
    expect(positions.get("agent-7f3a")?.x).toBeGreaterThan(positions.get("src-1")?.x ?? 0);
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

  it("rejects non-http evidence links", () => {
    expect(safeHref("https://example.com/x")).toBe("https://example.com/x");
    expect(safeHref("http://example.com/x")).toBe("http://example.com/x");
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("data:text/html,hi")).toBeUndefined();
    expect(safeHref("not a url")).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
  });
});
