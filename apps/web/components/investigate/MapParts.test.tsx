import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FlowEdge, ZoneView } from "./MapParts";

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("motion/react", async (original) => ({
  ...(await original<typeof import("motion/react")>()),
  useReducedMotion: () => motion.reduced,
}));

const edge = (pulse?: string) =>
  renderToStaticMarkup(
    createElement(
      "svg",
      null,
      createElement(FlowEdge, {
        id: "e",
        source: "a",
        target: "b",
        sourceX: 0,
        sourceY: 0,
        targetX: 100,
        targetY: 0,
        data: pulse ? { pulse } : {},
      } as never),
    ),
  );

describe("FlowEdge", () => {
  beforeEach(() => {
    motion.reduced = false;
  });

  it("draws the dependency, and a dot only while a pulse is set", () => {
    expect(edge()).toContain("<path");
    expect(edge()).not.toContain("<circle");
    const html = edge("e:running");
    expect(html).toContain('data-pulse="e:running"');
    expect(html).toContain("<circle");
  });

  it("travels once: no loop, no repeat", () => {
    expect(edge("e:running")).not.toMatch(/repeat|infinite/i);
  });

  it("draws no dot under reduced motion, but keeps the line", () => {
    motion.reduced = true;
    const html = edge("e:running");
    expect(html).toContain("<path");
    expect(html).not.toContain("<circle");
  });
});

describe("ZoneView", () => {
  const zone = (group: "sources" | "toolbox", count: number) =>
    renderToStaticMarkup(createElement(ZoneView, { data: { group, count } } as never));

  it("labels the group with its real count", () => {
    expect(zone("sources", 3)).toContain("Sources · 3");
    expect(zone("toolbox", 2)).toContain("Toolbox · 2");
  });

  it("says plainly when a group is empty, without implying use", () => {
    expect(zone("sources", 0)).toContain("None loaded yet");
    expect(zone("toolbox", 0)).toContain("None used yet");
    expect(zone("toolbox", 0)).not.toContain("Tools this run used");
  });
});
