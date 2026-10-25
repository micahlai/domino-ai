import { describe, expect, it } from "vitest";
import { importSpecs } from "./import-specs.mjs";

const specs = (text: string) => importSpecs(text).map((s) => s.spec);

describe("lane import scan", () => {
  it("finds named, re-export, dynamic and side-effect imports", () => {
    const text = [
      'import { a } from "../a";',
      'export * from "./b";',
      'const c = await import("./c");',
      'import "../../historical/live";',
      'import"./tight";',
    ].join("\n");
    expect(specs(text)).toEqual(["../a", "./b", "./c", "../../historical/live", "./tight"]);
  });

  it("finds a side-effect import on the first line", () => {
    expect(specs('import "./first";\nconst x = 1;')).toEqual(["./first"]);
  });
});
