import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HistoricalReplay } from "./HistoricalReplay";
import { previewView } from "./preview";

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  return { ...actual, useReducedMotion: () => true };
});

const render = (stage: "baseline" | "observed" | "response") =>
  renderToStaticMarkup(<HistoricalReplay view={previewView(stage)} />);

describe("historical replay", () => {
  it("keeps later observations out before reveal", () => {
    const html = render("baseline");
    expect(html).not.toContain("Reported after forecast");
    expect(html).not.toContain("Disclosure published");
    expect(html).not.toContain("Saved forecast versus what was reported");
    expect(html).toContain("Knowledge cutoff");
    expect(html).toContain("Last reported");
  });

  it("shows observed results beside the saved forecast, keeping the miss", () => {
    const html = render("observed");
    expect(html).toContain("Reported after forecast, Mar 31, 2024: $28M");
    expect(html).toContain("Saved forecast, Mar 31, 2024: $34M");
    expect(html).toContain("Missed the saved range");
    expect(html).toContain("Not scored");
    expect(html).not.toContain("Post-hoc");
  });

  it("labels the alternative as projected and post-hoc with cost, benefit and downside", () => {
    const html = render("response");
    expect(html).toContain("Post-hoc: chosen after the reveal");
    expect(html).toContain("Cost up front");
    expect(html).toContain("Benefit later");
    expect(html).toContain("Downside");
    expect(html).toContain("Assumption");
    expect(html).toMatch(/Alternative \(projected\), Sep 30, 2024/);
  });

  it("draws no NaN geometry and no weekly points", () => {
    for (const stage of ["baseline", "observed", "response"] as const) {
      const html = render(stage);
      expect(html).not.toMatch(/NaN|Infinity/);
      expect(html).toContain("No weekly values");
    }
  });

  it("states loading, error and unavailable explicitly without data", () => {
    expect(renderToStaticMarkup(<HistoricalReplay status="loading" />)).toContain("Loading");
    expect(renderToStaticMarkup(<HistoricalReplay status="error" />)).toContain('role="alert"');
    expect(renderToStaticMarkup(<HistoricalReplay status="unavailable" />)).toContain(
      "not available yet",
    );
  });
});
