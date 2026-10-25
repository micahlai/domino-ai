import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

let path = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => path,
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
  it("lists the weekly product pages in order, plus the 2U case study", () => {
    const html = render("/");
    const order = ["/", "/field", "/field/map", "/c/kestrel", "/simulations"].map((h) =>
      html.indexOf(`href="${h}"`),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain("Main navigation");
    expect(html).toContain('href="/case"');
    for (const gone of ["/playground", "/connect", "Theme", "Style"])
      expect(html).not.toContain(gone);
  });

  it("marks exactly one page as current", () => {
    expect(current(render("/"))).toEqual(["Dashboard"]);
    expect(current(render("/field"))).toEqual(["Worker"]);
    expect(current(render("/field/map"))).toEqual(["Brain map"]);
    expect(current(render("/simulations"))).toEqual(["Simulations"]);
    expect(current(render("/c/kestrel/simulations"))).toEqual(["Simulations"]);
    expect(current(render("/case"))).toEqual(["2U case study"]);
  });

  it("keeps the Timeline sub-navigation inside the company routes", () => {
    const html = render("/c/kestrel/record");
    expect(current(html)).toEqual(["Timeline", "Decision record"]);
    expect(html).toContain('href="/c/kestrel/learning"');
    expect(render("/field")).not.toContain("/c/kestrel/learning");
  });

  it("leaves /investigate full-window", () => {
    expect(render("/investigate")).not.toContain("<header");
  });

  it("leaves the case workspace full-window", () => {
    const html = render("/case/2u/company");
    expect(html).not.toContain("<header");
    expect(html).not.toContain("Main navigation");
  });
});
