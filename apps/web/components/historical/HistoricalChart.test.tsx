import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HistoricalChart } from "./HistoricalChart";
import { previewView } from "./preview";

const reduced = vi.hoisted(() => ({ on: false }));
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => reduced.on,
}));

const render = () =>
  renderToStaticMarkup(
    createElement(HistoricalChart, { view: previewView("observed"), onSelect: () => {} }),
  );

describe("HistoricalChart forecast line", () => {
  for (const on of [false, true]) {
    it(`keeps the dashed pattern and never animates pathLength (reduced motion: ${on})`, () => {
      reduced.on = on;
      const html = render();
      expect(html).toMatch(/stroke-dasharray="6 4"[^>]*clip-path="url\(#forecast-reveal-/);
      expect(html).not.toMatch(/pathLength|path-length/i);
    });
  }

  it("starts the wipe closed only when motion is allowed", () => {
    reduced.on = false;
    expect(render()).toMatch(/<clipPath[^>]*><rect[^>]*width="0(px)?"/);
    reduced.on = true;
    expect(render()).toMatch(/<clipPath[^>]*><rect[^>]*width="720"/);
  });
});
