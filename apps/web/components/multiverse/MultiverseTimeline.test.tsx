import { fixtures } from "@domino/contracts/fixtures";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MultiverseTimeline } from "./MultiverseTimeline";

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  return { ...actual, useReducedMotion: () => true };
});

describe("timeline without animation", () => {
  it("renders every future with geometry and an accessible selector in the first HTML", () => {
    const html = renderToStaticMarkup(
      <MultiverseTimeline
        history={fixtures.history}
        pastEvents={fixtures.pastEvents}
        today={fixtures.snapshot.asOf}
        report={fixtures.resilience}
        limit={300_000_000}
        onSelectUniverse={() => undefined}
        showFixes={false}
      />,
    );
    const hitPaths = html.match(/<path[^>]*stroke="transparent"[^>]*>/g) ?? [];
    expect(hitPaths).toHaveLength(fixtures.resilience.universes.length);
    expect(hitPaths.every((path) => / d="M/.test(path))).toBe(true);
    expect(html).toContain("Select a scenario");
    expect(html).toContain('aria-label="Time scale"');
    expect(html).toContain('aria-label="Cash scale"');
    expect(html).toContain("Reset scales");
    expect(html).not.toContain('type="range"');
    expect(html).not.toContain("Inspect week");
    expect(html.match(/aria-haspopup="dialog"/g)).toHaveLength(fixtures.pastEvents.length);
    expect(html).toContain("Show event details");
    expect(html).toContain("Focus the chart");
    expect(html).not.toContain('stroke-dasharray="0 1"');
    expect(html).not.toMatch(/NaN|Infinity/);
    expect(html).not.toContain("<canvas");
    expect(html).not.toContain("Hide particles");
  });
});
