import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FieldSeamHarness } from "./FieldSeamHarness";

describe("field seam harness", () => {
  it("exports the seed text and reports each fixture verification", async () => {
    const html = renderToStaticMarkup(await FieldSeamHarness());
    expect(html).toContain("Peer fixture");
    expect(html).toContain("Backend not configured");
    expect(html).toMatch(/fixture-validTwoUSeed.*?verified/);
    expect(html).toMatch(/fixture-mismatchedSeed.*?rejected/);
  });
});
