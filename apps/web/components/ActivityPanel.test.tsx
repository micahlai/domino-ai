import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { STYLES } from "../lib/style-registry";
import { ActivityPanel } from "./ActivityPanel";
import { ActivitySimulation } from "./ActivitySimulation";

describe("ActivityPanel", () => {
  it("says it is not connected and shows no events when there is no feed", () => {
    const html = renderToStaticMarkup(createElement(ActivityPanel, { source: "unavailable" }));
    expect(html).toContain("Not connected");
    expect(html).toContain("Nothing is running");
    expect(html).not.toContain("<ul");
  });

  it("labels the simulation and starts empty rather than showing fake work", () => {
    const html = renderToStaticMarkup(createElement(ActivitySimulation));
    expect(html).toContain("Simulation preview");
    expect(html).toContain("No activity yet");
    expect(html).toContain("Replay");
  });

  it("renders identical markup under every style, so a style change cannot replay entrances", () => {
    // Style is only a data-style attribute on an ancestor; the panel never reads it.
    const html = renderToStaticMarkup(createElement(ActivityPanel, { source: "unavailable" }));
    for (const { id } of STYLES) {
      const wrapped = renderToStaticMarkup(
        createElement(
          "div",
          { "data-style": id },
          createElement(ActivityPanel, { source: "unavailable" }),
        ),
      );
      expect(wrapped).toContain(html);
    }
  });
});
