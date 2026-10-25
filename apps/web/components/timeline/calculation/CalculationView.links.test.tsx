import { useQueries } from "convex/react";
import { useSearchParams } from "next/navigation";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { fixtureBaseline, fixtureScenario } from "../workspace/fixtures";
import { CalculationView } from "./CalculationView";

vi.mock("convex/react", () => ({ useQueries: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: vi.fn() }));

describe("saved calculation navigation", () => {
  it("returns to the exact saved Timeline run instead of the latest one", () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams({ runId: fixtureScenario.runId }) as ReturnType<typeof useSearchParams>,
    );
    vi.mocked(useQueries).mockImplementation(
      (requests) =>
        ("run" in requests
          ? { run: fixtureScenario }
          : { baseline: fixtureBaseline }) as ReturnType<typeof useQueries>,
    );
    const html = renderToStaticMarkup(<CalculationView companyId={fixtureScenario.companyId} />);
    expect(html).toContain('href="/c/kestrel/timeline?runId=timeline%3Arun%2Fkestrel-acme-late"');
    expect(html).toContain("Back to Timeline");
  });
});
