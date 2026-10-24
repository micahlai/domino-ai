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
    expect(html).not.toContain('stroke-dasharray="0 1"');
    expect(html).not.toMatch(/NaN|Infinity/);
  });
});
