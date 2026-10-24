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

describe("AppShell navigation", () => {
  it("leads to the investigation and drops dev and demo links from the product shell", () => {
    const html = render("/historical");
    expect(html).toContain('href="/investigate"');
    expect(html).toContain('href="/historical"');
    for (const gone of ["/playground", "/connect", "/c/kestrel", "Theme", "Style"])
      expect(html).not.toContain(gone);
  });

  it("shows demo sub-navigation only inside the old demo routes", () => {
    expect(render("/c/kestrel/record")).toContain('href="/c/kestrel/learning"');
  });

  it("leaves /investigate full-window", () => {
    expect(render("/investigate")).not.toContain("<header");
  });
});
