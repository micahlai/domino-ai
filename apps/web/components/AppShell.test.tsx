import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

let path = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => path,
  useRouter: () => ({ push: () => {} }),
}));
// StyleSync pulls in "@/" imports that vitest does not resolve, and it renders nothing anyway.
vi.mock("./StyleSync", () => ({ StyleSync: () => null }));

import { AppShell } from "./AppShell";

const render = (at: string) => {
  path = at;
  return renderToStaticMarkup(createElement(AppShell, null, "page"));
};

// The link marked as the current page, by its label.
const current = (html: string) =>
  [...html.matchAll(/<a[^>]*aria-current="page"[^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);

describe("AppShell navigation", () => {
  it("lists the five product pages, then the judge sandbox, in order and hides dev routes", () => {
    const html = render("/");
    const order = [
      "/",
      "/field",
      "/field/map",
      "/field/connect",
      "/c/operating%2F2u%2Fbaseline/timeline",
      "/judge",
    ].map((h) => html.indexOf(`href="${h}"`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html.match(/<li class="flex shrink-0">/g)).toHaveLength(6);
    expect(html).toContain("Main navigation");
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain("Company and scenario");
    expect(html).toContain("2U (historical)");
    expect(html).toContain("Simulated books");
    expect(html).toContain("based on 2U, Inc. filings · as of Sep 30, 2023");
    // Full dates live in the Sources sheet; the row never repeats the long filing sentence.
    expect(html).toContain('aria-label="Sources and cash bridge"');
    expect(html).not.toContain("Starting reconstructed books as of");
    expect(html).not.toContain("Based on 2U public filings, with reconstructed operating data.");
    expect(html).not.toContain("<select");
    for (const gone of [
      "/playground",
      'href="/simulations"',
      'href="/connect"',
      "/investigate",
      "/historical",
      'href="/case"',
      "Theme",
      "Style",
    ])
      expect(html).not.toContain(gone);
  });

  it("marks exactly one page as current", () => {
    expect(current(render("/"))).toEqual(["Dashboard"]);
    expect(current(render("/field"))).toEqual(["Worker"]);
    expect(current(render("/field/map"))).toEqual(["Brain map"]);
    expect(current(render("/field/connect"))).toEqual(["Connected tools"]);
    expect(current(render("/simulations"))).toEqual([]);
    expect(current(render("/c/kestrel/simulations"))).toEqual(["Timeline"]);
    expect(current(render("/judge"))).toEqual(["Try it"]);
    expect(current(render("/case"))).toEqual([]);
  });

  it("opens Timeline's own pages without the old demo sub-navigation", () => {
    const html = render("/c/kestrel-crunch/timeline");
    expect(current(html)).toEqual(["Timeline"]);
    expect(html).toContain("flex h-dvh flex-col");
    expect(render("/c/kestrel-crunch/timeline/analysis")).not.toContain("flex h-dvh flex-col");
    expect(html).not.toContain("/c/kestrel-crunch/learning");
    expect(current(render("/c/kestrel-crunch/timeline/analysis"))).toEqual(["Timeline"]);
  });

  it("keeps legacy operating Timeline books out of the current picker and source banner", () => {
    const html = render("/c/operating%2Fasana-inspired%2Fbaseline/timeline");
    expect(current(html)).toEqual(["Timeline"]);
    expect(html).toContain("Legacy operating demo");
    expect(html).not.toContain('aria-haspopup="menu"');
    expect(html).not.toContain("Simulated books");
    const currentHtml = render("/c/operating%2Fasana-current%2Fbaseline/timeline");
    expect(currentHtml).toContain('aria-haspopup="menu"');
    // The default selection is 2U, whose books are its public filings.
    expect(currentHtml).toMatch(/Simulated books|Public filings/);
  });

  it("shows saved calculation routes without the live company picker, feed strip or clock", () => {
    for (const at of [
      "/field/analysis",
      "/c/operating%2Fasana-current%2Fbaseline/timeline/calculation",
      "/c/operating%2Fasana-inspired%2Fbaseline/timeline/calculation",
      "/c/kestrel/timeline/calculation",
    ]) {
      const html = render(at);
      expect(html).toContain("Recorded run");
      expect(html).not.toContain('aria-haspopup="menu"');
      expect(html).not.toContain("Simulated books");
      expect(html).not.toContain("Simulated date");
    }
    const current = render("/c/operating%2Fasana-current%2Fbaseline/timeline/calculation");
    expect(current).toContain('href="/c/operating%2Fasana-current%2Fbaseline/timeline"');
  });

  it("keeps the Timeline sub-navigation inside the company routes", () => {
    const html = render("/c/kestrel/record");
    expect(current(html)).toEqual(["Timeline", "Decision record"]);
    expect(html).toContain('href="/c/kestrel/learning"');
    expect(render("/field")).not.toContain("/c/kestrel/learning");
  });

  it("keeps the same top bar above the full-window dark pages", () => {
    for (const at of ["/investigate", "/case/2u", "/case/2u/company"]) {
      const html = render(at);
      expect(html).toContain("Main navigation");
      expect(html).toContain('class="flex h-dvh flex-col"');
      expect(html).toContain('<main id="main" class="min-h-0 flex-1">');
      expect(current(html)).toEqual([]);
    }
  });
});
