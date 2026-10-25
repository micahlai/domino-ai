import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { STYLES } from "../lib/style-registry";
import { StyleComparison } from "./StyleComparison";

describe("StyleComparison", () => {
  it("draws the same sample state once per registered style", () => {
    const html = renderToStaticMarkup(createElement(StyleComparison));
    for (const { id } of STYLES) expect(html).toContain(`data-style="${id}"`);
    expect(html.match(/Source \(open\)/g)).toHaveLength(STYLES.length);
    expect(html.match(/Error state/g)).toHaveLength(STYLES.length);
    expect(html.match(/Empty state/g)).toHaveLength(STYLES.length);
  });
});

describe("style tokens", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const block = (selector: string) => css.split(selector)[1]?.split("}")[0] ?? "";
  const required = [
    "background",
    "foreground",
    "card",
    "popover",
    "primary",
    "secondary",
    "muted",
    "accent",
    "destructive",
    "danger-text",
    "safe",
    "warning",
    "border",
    "input",
    "ring",
    "clay",
    "overlay",
    "primary-ink",
    "control-h",
    "row-h",
    "card-pad",
    "shadow-xs",
    "shadow",
    "shadow-lg",
  ];

  // Nested comparison scopes inherit any omitted token from the page style, so none may be omitted.
  it("defines every semantic colour in each style, so portals and charts never fall back", () => {
    for (const { id } of STYLES) {
      const body = block(`[data-style="${id}"] {`);
      for (const token of required) expect(body, `${id} --${token}`).toContain(`--${token}:`);
    }
  });
});
