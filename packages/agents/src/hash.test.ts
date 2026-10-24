import { fixtures } from "@domino/contracts/fixtures";
import { describe, expect, it } from "vitest";
import { canonicalJson, hashInput, hashJobInput } from "./hash";
import { AGENT_SCHEMA_VERSION } from "./schemas";

describe("canonicalJson", () => {
  it("sorts keys at every depth, keeps array order and drops undefined properties", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null }, e: undefined })).toBe(
      '{"a":{"c":null,"d":[2,1]},"b":1}',
    );
    expect(canonicalJson([3, "x", true, -0])).toBe('[3,"x",true,0]');
  });

  it("accepts repeated non-cyclic references", () => {
    const shared = { a: 1 };
    expect(canonicalJson({ x: shared, y: shared })).toBe('{"x":{"a":1},"y":{"a":1}}');
  });

  it.each([
    [
      "a cycle",
      (() => {
        const value: Record<string, unknown> = {};
        value.self = value;
        return value;
      })(),
    ],
    ["NaN", { n: Number.NaN }],
    ["Infinity", [Number.POSITIVE_INFINITY]],
    ["a bigint", { n: 1n }],
    ["a function", { f: () => 1 }],
    ["a symbol", { s: Symbol("x") }],
    ["a Date", { d: new Date(0) }],
    ["a Map", new Map()],
    ["undefined in an array", [undefined]],
    ["undefined at the top level", undefined],
  ])("rejects %s", (_, value) => {
    expect(() => canonicalJson(value)).toThrow(TypeError);
  });
});

describe("hashInput", () => {
  it("is SHA-256 hex of canonical JSON", async () => {
    expect(await hashInput({})).toBe(
      "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    );
  });

  it("ignores key order but not array order or values", async () => {
    const a = await hashInput({ x: 1, y: [1, 2] });
    expect(await hashInput({ y: [1, 2], x: 1 })).toBe(a);
    expect(await hashInput({ x: 1, y: [2, 1] })).not.toBe(a);
    expect(await hashInput({ x: 2, y: [1, 2] })).not.toBe(a);
  });

  it("separates jobs and schema versions for the same input", async () => {
    const input = fixtures.branches[1];
    const explain = await hashJobInput("explain", input);
    expect(explain).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashJobInput("weeklyBrief", input)).not.toBe(explain);
    expect(await hashInput({ job: "explain", schemaVersion: AGENT_SCHEMA_VERSION, input })).toBe(
      explain,
    );
    expect(await hashInput({ job: "explain", schemaVersion: "other", input })).not.toBe(explain);
  });
});
