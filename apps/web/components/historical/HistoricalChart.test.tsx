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

describe("HistoricalChart edge labels", () => {
  it("right-aligns a label at the right edge and keeps an inner label left-aligned", () => {
    reduced.on = false;
    const view = previewView("observed");
    const html = renderToStaticMarkup(
      createElement(HistoricalChart, {
        view: { ...view, dates: { ...view.dates, revealedOn: "2024-09-30" } },
        onSelect: () => {},
      }),
    );
    expect(html).toMatch(/x="692"[^>]*text-anchor="end"[^>]*>Disclosure published</);
    expect(html).toMatch(/text-anchor="start"[^>]*>Knowledge cutoff</);
    expect(html).toContain("min-w-[720px]");
  });
});
