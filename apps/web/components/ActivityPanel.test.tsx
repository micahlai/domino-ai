import { type ActivityEvent, ActivityEventSchema } from "@domino/contracts";
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
    expect(html).toContain("status is unknown");
    expect(html).toContain("cannot say whether anything is running or has been recorded");
    expect(html).not.toMatch(/nothing is running|nothing has been recorded/i);
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

  const ev = (
    id: string,
    sequence: number,
    status: ActivityEvent["status"],
    label = "Sample task",
  ) =>
    ActivityEventSchema.parse({
      id,
      sequence,
      occurredAt: `2026-01-01T09:00:0${sequence}Z`,
      caseId: "c1",
      kind: "agent_task",
      status,
      entity: { kind: "agent_task", id: "t1" },
      label,
    });
  const feed = (events: ActivityEvent[]) =>
    renderToStaticMarkup(
      createElement(ActivityPanel, { source: "live", events, scope: { caseId: "c1" } }),
    );

  it("shows a failure with the retry apart, and the full UTC time inside the text column", () => {
    const html = feed([ev("a", 1, "started"), ev("b", 2, "failed"), ev("c", 3, "started")]);
    expect(html).toContain("Failed");
    expect(html).toContain("Retry started");
    expect(html).toContain("2026-01-01 09:00:02 UTC");
    expect(html).toContain("2026-01-01 09:00:03 UTC");
    // Time lives in the same column as the label, so a narrow screen cannot clip or crush either.
    expect(html).not.toContain("shrink-0");
    expect(html).toContain("minmax(0,1fr)");
  });

  it("reports duplicate conflicting events once", () => {
    const html = feed([
      ev("a", 1, "started"),
      ev("a", 1, "started", "Other"),
      ev("a", 1, "started", "Other"),
    ]);
    expect(html).toContain("1 conflicting version of an event id was ignored");
  });
});
