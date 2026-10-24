import { ChangeSchema } from "@domino/contracts";
import { describe, expect, it } from "vitest";
import { CalendarDate, Cents, Week, parse } from "../lib/parse";

describe("boundary validation", () => {
  it("validates exact integer cents, real dates and Monday weeks", () => {
    expect(parse(Cents, 480_000)).toBe(480_000);
    expect(parse(CalendarDate, "2028-02-29")).toBe("2028-02-29");
    expect(parse(Week, "2026-11-02")).toBe("2026-11-02");
    expect(() => parse(Cents, 1.5)).toThrow("INVALID_DATA");
    expect(() => parse(Cents, Number.MAX_SAFE_INTEGER + 1)).toThrow("INVALID_DATA");
    expect(() => parse(CalendarDate, "2026-02-29")).toThrow("INVALID_DATA");
    expect(() => parse(Week, "2026-11-03")).toThrow("INVALID_DATA");
  });
  it("does not echo rejected external values into errors", () => {
    try {
      parse(ChangeSchema, { kind: "private-external-value" });
      throw new Error("Expected a parse failure");
    } catch (error) {
      expect(String(error)).toContain("INVALID_DATA");
      expect(String(error)).not.toContain("private-external-value");
    }
  });
});
