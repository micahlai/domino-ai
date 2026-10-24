import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConversationPanel } from "./ConversationPanel";
import { DominoNodeCard, NodeDetails } from "./InvestigateWorkspace";

const noop = () => {};

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
