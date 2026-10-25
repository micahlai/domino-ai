import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReplayGuard } from "./ReplayGuard";
import { Dashboard } from "./dashboard/Dashboard";

describe("operating demo without a backend", () => {
  it("does not display legacy books under the 2U default", () => {
    const dashboard = renderToStaticMarkup(<Dashboard />);
    const field = renderToStaticMarkup(
      <ReplayGuard>
        <p>Legacy fixture content</p>
      </ReplayGuard>,
    );
    expect(dashboard).toContain("Operating demo needs the backend");
    expect(dashboard).toContain("/case/2u");
    expect(dashboard).not.toContain("Kestrel");
    expect(field).toContain("Operating demo needs the backend");
    expect(field).not.toContain("Legacy fixture content");
  });
});
