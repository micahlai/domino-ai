import { readFileSync } from "node:fs";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setStyle, syncStyleFromSearch } from "./style";
import {
  DEFAULT_STYLE,
  STYLES,
  STYLE_STORAGE_KEY,
  parseStyle,
  resolveStyle,
  styleInitScript,
} from "./style-registry";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("style registry", () => {
  it("accepts every registered id and defaults to the light Ramp-style theme", () => {
    for (const { id } of STYLES) expect(parseStyle(id)).toBe(id);
    expect(DEFAULT_STYLE).toBe("ramp");
    expect(STYLES[0].id).toBe(DEFAULT_STYLE);
  });

  it("falls back to the default for invalid values", () => {
    for (const bad of [null, undefined, "", "RAMP", " ramp", "ramp;x", "<script>", 3, {}])
      expect(parseStyle(bad)).toBe(DEFAULT_STYLE);
  });

  it("lets a valid URL value override storage, and ignores an invalid one", () => {
    expect(resolveStyle("ramp", "hyphenate")).toBe("ramp");
    expect(resolveStyle("original", "hyphenate")).toBe("original");
    expect(resolveStyle(null, "bogus")).toBe(DEFAULT_STYLE);
    expect(resolveStyle(null, null)).toBe(DEFAULT_STYLE);
  });

  it("treats a present but invalid URL override as the default, whatever is stored", () => {
    expect(resolveStyle("bogus", "hyphenate")).toBe(DEFAULT_STYLE);
    expect(resolveStyle("", "hyphenate")).toBe(DEFAULT_STYLE);
    expect(resolveStyle("ORIGINAL", "original")).toBe(DEFAULT_STYLE);
  });

  it("keeps server code free of the client store", () => {
    expect(source("./style-registry.ts")).not.toMatch(/from "react"|useSyncExternalStore/);
    expect(source("../app/layout.tsx")).not.toMatch(/lib\/style"/);
    expect(source("../app/layout.tsx")).not.toMatch(/"use client"/);
  });

  it("keeps the pre-paint script in step with the registry rules", () => {
    const run = (search: string, stored: string | null | "throws") => {
      const root = { dataset: {} as Record<string, string> };
      new Function("location", "localStorage", "document", styleInitScript)(
        { search },
        {
          getItem: () => {
            if (stored === "throws") throw new Error("blocked");
            return stored;
          },
        },
        { documentElement: root },
      );
      return root.dataset.style;
    };
    expect(run("?style=ramp", "hyphenate")).toBe("ramp");
    expect(run("?style=x", "hyphenate")).toBe(DEFAULT_STYLE);
    expect(run("?style=", "hyphenate")).toBe(DEFAULT_STYLE);
    expect(run("?style=original", "throws")).toBe("original");
    expect(run("", "throws")).toBe(DEFAULT_STYLE);
    expect(run("?other=1", "hyphenate")).toBe("hyphenate");
    expect(run("", "<b>")).toBe(DEFAULT_STYLE);
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
    setStyle("original");
    expect(root.dataset.style).toBe("original");
  });

  it("re-derives the style after client navigation, including a removed override", () => {
    const { root, store } = stubPage("http://x/");
    store.set(STYLE_STORAGE_KEY, "hyphenate");
    syncStyleFromSearch("style=original");
    expect(root.dataset.style).toBe("original");
    syncStyleFromSearch("style=bogus");
    expect(root.dataset.style).toBe(DEFAULT_STYLE);
    syncStyleFromSearch("");
    expect(root.dataset.style).toBe("hyphenate");
    expect(store.get(STYLE_STORAGE_KEY)).toBe("hyphenate");
  });

  it("does not rewrite the page attribute when navigation leaves the style unchanged", () => {
    stubPage("http://x/");
    setStyle("original"); // also resets the in-memory choice left by earlier tests
    let writes = 0;
    let value = "original";
    const dataset = {
      get style() {
        return value;
      },
      set style(next: string) {
        writes += 1;
        value = next;
      },
    };
    vi.stubGlobal("document", { documentElement: { dataset } });
    syncStyleFromSearch("a=1");
    expect(writes).toBe(0);
  });

  it("keeps an explicit choice across navigation when storage is blocked", () => {
    const { root } = stubPage("http://x/");
    const blocked = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", { setItem: blocked, getItem: blocked });
    setStyle("shadcn");
    syncStyleFromSearch("");
    expect(root.dataset.style).toBe("shadcn");
  });

  it("renders the selector as the default on the server, matching the first client render", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { StyleSelector } = await import("../components/StyleSelector");
    const html = renderToStaticMarkup(createElement(StyleSelector));
    expect(html.match(/<input[^>]*checked=""[^>]*>/g)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`checked=""[^>]*value="${DEFAULT_STYLE}"`));
  });
});
