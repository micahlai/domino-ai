import { describe, expect, it } from "vitest";
import {
  findMoneyText,
  formatCents,
  mondayOf,
  parseDateText,
  parseDaysText,
  parseMoneyText,
} from "./parse";

describe("question parsers", () => {
  it.each([
    ["$80,000", 8_000_000],
    ["$80k", 8_000_000],
    ["$1.2M", 120_000_000],
    ["$3 million", 300_000_000],
    ["$12.34", 1_234],
    ["5000 dollars", 500_000],
    ["$0.1k", 10_000],
  ])("reads %s as exact cents", (text, cents) => {
    expect(parseMoneyText(text)).toBe(cents);
  });

  it.each(["$10.005", "$99999999999999999", "80k", "$"])("refuses %s", (text) => {
    expect(parseMoneyText(text)).toBeNull();
  });

  it("finds the money phrase as written", () => {
    expect(findMoneyText("pay $80,000 to Atlas")).toBe("$80,000");
  });

  it("reads dates relative to the forecast start and rejects invalid ones", () => {
    expect(parseDateText("Nov 18", "2026-11-02")).toBe("2026-11-18");
    expect(parseDateText("January 5", "2026-11-02")).toBe("2027-01-05");
    expect(parseDateText("18 Nov 2026", "2026-11-02")).toBe("2026-11-18");
    expect(parseDateText("2026-11-31", "2026-11-02")).toBeNull();
    expect(parseDateText("Feb 30", "2026-11-02")).toBeNull();
  });

  it("reads day counts and week starts", () => {
    expect(parseDaysText("14 days")).toBe(14);
    expect(parseDaysText("two weeks")).toBe(14);
    expect(parseDaysText("a week")).toBe(7);
    expect(mondayOf("2026-11-18")).toBe("2026-11-16");
    expect(mondayOf("2026-11-16")).toBe("2026-11-16");
  });

  it("formats cents for display only", () => {
    expect(formatCents(8_000_000)).toBe("$80,000");
    expect(formatCents(-123_456)).toBe("-$1,234.56");
  });
});
