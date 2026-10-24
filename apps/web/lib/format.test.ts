import { describe, expect, it } from "vitest";
import { formatCents, formatDate } from "./format";

describe("formatCents", () => {
  it.each([
    [290_000_000, "$2.9M"],
    [24_000_000, "$240K"],
    [480_000, "$4,800"],
    [0, "$0"],
    [-24_000_000, "-$240K"],
    [1, "$0.01"],
    [999_999, "$9,999.99"],
    [1_000_000, "$10K"],
    [289_999_999, "$2.9M"],
    [100_000_000_000, "$1B"],
  ])("formats %i cents as %s", (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });
  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects non-integer or unsafe cents: %s",
    (cents) => expect(() => formatCents(cents)).toThrow(),
  );
});

describe("formatDate", () => {
  it.each([
    ["2026-11-30", "Nov 30"],
    ["2026-01-01", "Jan 1"],
    ["2028-02-29", "Feb 29"],
  ])("formats %s without a local timezone shift", (iso, expected) =>
    expect(formatDate(iso)).toBe(expected),
  );
  it.each(["2026-02-29", "2026-13-01", "2026-11-31", "11/30/2026", "2026-11-30T00:00:00Z"])(
    "rejects invalid calendar input: %s",
    (iso) => expect(() => formatDate(iso)).toThrow(),
  );
});
