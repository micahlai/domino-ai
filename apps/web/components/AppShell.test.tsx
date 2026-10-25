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
  it("lists the six product pages, then the judge sandbox, in order and hides dev routes", () => {
    const html = render("/");
    const order = [
      "/",
      "/field",
      "/field/map",
      "/field/connect",
      "/c/kestrel",
      "/simulations",
      "/judge",
    ].map((h) => html.indexOf(`href="${h}"`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html.match(/<li class="flex shrink-0">/g)).toHaveLength(7);
    expect(html).toContain("Main navigation");
    // The 2U case study opens from the company switcher, not a separate top bar link.
    expect(html).toContain('aria-haspopup="menu"');
    for (const gone of [
      "/playground",
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
    expect(current(render("/simulations"))).toEqual(["Simulations"]);
    expect(current(render("/c/kestrel/simulations"))).toEqual(["Simulations"]);
    expect(current(render("/judge"))).toEqual(["Try it"]);
    expect(current(render("/case"))).toEqual([]);
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
