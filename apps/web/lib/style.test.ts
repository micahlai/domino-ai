import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_STYLE,
  STYLES,
  STYLE_STORAGE_KEY,
  parseStyle,
  resolveStyle,
  setStyle,
  styleInitScript,
} from "./style";

describe("style registry", () => {
  it("accepts every registered id and defaults to Original", () => {
    for (const { id } of STYLES) expect(parseStyle(id)).toBe(id);
    expect(DEFAULT_STYLE).toBe("original");
  });

  it("falls back to Original for invalid values", () => {
    for (const bad of [null, undefined, "", "RAMP", " ramp", "ramp;x", "<script>", 3, {}])
      expect(parseStyle(bad)).toBe("original");
  });

  it("lets a valid URL value override storage, and ignores an invalid one", () => {
    expect(resolveStyle("ramp", "hyphenate")).toBe("ramp");
    expect(resolveStyle("bogus", "hyphenate")).toBe("hyphenate");
    expect(resolveStyle(null, "bogus")).toBe("original");
    expect(resolveStyle(null, null)).toBe("original");
  });

  it("keeps the pre-paint script in step with the registry rules", () => {
    const run = (search: string, stored: string | null) => {
      const root = { dataset: {} as Record<string, string> };
      new Function("location", "localStorage", "document", styleInitScript)(
        { search },
        { getItem: () => stored },
        { documentElement: root },
      );
      return root.dataset.style;
    };
    expect(run("?style=ramp", "hyphenate")).toBe("ramp");
    expect(run("?style=x", "hyphenate")).toBe("hyphenate");
    expect(run("", "<b>")).toBe("original");
    expect(run("?style=shadcn", null)).toBe("shadcn");
  });
});

describe("setStyle", () => {
  const stubPage = (href: string) => {
    const store = new Map<string, string>();
    const root = { dataset: {} as Record<string, string> };
    const replaced: string[] = [];
    vi.stubGlobal("document", { documentElement: root });
    vi.stubGlobal("localStorage", {
      setItem: (k: string, v: string) => store.set(k, v),
      getItem: (k: string) => store.get(k) ?? null,
    });
    vi.stubGlobal("location", { href });
    vi.stubGlobal("history", {
      state: null,
      replaceState: (_: unknown, __: string, u: URL) => replaced.push(String(u)),
    });
    return { store, root, replaced };
  };
  afterEach(() => vi.unstubAllGlobals());

  it("sets the page attribute and stores the choice without touching other URL params", () => {
    const { store, root, replaced } = stubPage("http://x/c/kestrel?cutoff=1");
    setStyle("hyphenate");
    expect(root.dataset.style).toBe("hyphenate");
    expect(store.get(STYLE_STORAGE_KEY)).toBe("hyphenate");
    expect(replaced).toEqual([]);
  });

  it("keeps an existing review override in step with the selection", () => {
    const { replaced } = stubPage("http://x/playground?style=ramp&a=b");
    setStyle("shadcn");
    expect(replaced).toEqual(["http://x/playground?style=shadcn&a=b"]);
  });

  it("still applies the style when storage is blocked", () => {
    const { root } = stubPage("http://x/");
    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw new Error("blocked");
      },
    });
    setStyle("ramp");
    expect(root.dataset.style).toBe("ramp");
  });

  it("renders the selector as Original on the server, matching the first client render", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { StyleSelector } = await import("../components/StyleSelector");
    const html = renderToStaticMarkup(createElement(StyleSelector));
    expect(html.match(/<input[^>]*checked=""[^>]*>/g)).toHaveLength(1);
    expect(html).toMatch(/checked=""[^>]*value="original"/);
  });
});
