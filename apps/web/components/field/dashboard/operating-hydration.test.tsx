import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "./Dashboard";

vi.mock("../company", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../company")>()),
  // Model a Convex list result already cached in the browser on route navigation.
  useSelectedCompany: () => ({ companyId: "cached-2u-feed", error: null }),
}));

const previousUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
afterEach(() => {
  process.env.NEXT_PUBLIC_CONVEX_URL = previousUrl;
});

describe("operating dashboard hydration", () => {
  it("renders the loading shell during SSR even if the selected feed is cached", () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.invalid";
    const html = renderToStaticMarkup(<Dashboard />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Reading the latest books...");
    expect(html).not.toContain("Loading the latest books");
  });
});
