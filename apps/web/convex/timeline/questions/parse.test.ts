import { describe, expect, it } from "vitest";
import {
  findDaysText,
  findMoneyText,
  findMonthsText,
  formatCents,
  mondayOf,
  moneyTokens,
  parseDateText,
  parseDaysText,
  parseMoneyText,
  parseMonthsText,
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
    ["80k", 8_000_000],
    ["50m", 5_000_000_000],
    ["2.5 million", 250_000_000],
  ])("reads %s as exact cents", (text, cents) => {
    expect(parseMoneyText(text)).toBe(cents);
  });

  it.each(["$10.005", "$99999999999999999", "80", "$"])("refuses %s", (text) => {
    expect(parseMoneyText(text)).toBeNull();
  });

  it("reads amounts and dates typed without a currency sign or space", () => {
    expect(moneyTokens("50m lawsuit what if")).toEqual(["50m"]);
    expect(moneyTokens("runway is 28.2 months")).toEqual([]);
    expect(parseDateText("nov2nd 2026", "2026-10-26")).toBe("2026-11-02");
    expect(parseDateText("16nov", "2026-10-26")).toBe("2026-11-16");
  });

  it("finds the money phrase as written", () => {
    expect(findMoneyText("pay $80,000 to Atlas")).toBe("$80,000");
  });

  it("reads whole money tokens, preserving malformed grouping and signs", () => {
    for (const text of [
      "$80,00",
      "-$80",
      "$-80",
      "+$80",
      "$80.005",
      "$80, 000",
      "$80 000",
      "$80, 00",
    ]) {
      const token = findMoneyText(`Pay ${text} to Atlas.`);
      expect(token).toBe(text);
      expect(parseMoneyText(token ?? "")).toBeNull();
    }
    expect(moneyTokens("Keep usable cash above $2600000.")).toEqual(["$2600000"]);
    expect(parseMoneyText(findMoneyText("Keep usable cash above $2600000.") ?? "")).toBe(
      260_000_000,
    );
  });

  it("never matches a fractional count by its suffix", () => {
    expect(findDaysText("Acme pays 1.5 days late")).toBe("1.5 days");
    expect(parseDaysText(findDaysText("Acme pays 1.5 days late") ?? "")).toBeNull();
    expect(findMonthsText("Keep at least 4.5 months of runway")).toBe("4.5 months");
    expect(parseMonthsText("4.5 months")).toBe(4.5);
    expect(parseMonthsText("4,5 months")).toBeNull();
    expect(parseDaysText("-5 days")).toBeNull();
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
