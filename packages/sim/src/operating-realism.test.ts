import { engine } from "@domino/engine";
import { describe, expect, it } from "vitest";
import { createOperatingDemo } from "./operating/index.ts";

const empty = { version: 1 as const, customerDelayDays: {}, recurringSpend: [], rules: [] };
const companies = ["2u", "asana-current", "gitlab-current"] as const;

describe("realistic operating books", () => {
  const books = companies.map((company) => ({
    company,
    s: createOperatingDemo({ company, scenario: "baseline" }, 1).world.snapshot,
  }));

  it.each(books)("$company has a payment mix, taxes, insurance, pipeline and hiring", ({ s }) => {
    const late = (i: (typeof s.invoices)[number]) =>
      Date.parse(i.paid!) - Date.parse(i.due) > 10 * 86_400_000;
    expect(s.invoices.some((i) => i.paid && late(i))).toBe(true);
    expect(s.invoices.some((i) => i.paid && i.paid < i.due)).toBe(true);
    expect(s.invoices.some((i) => !i.paid && i.due < s.asOf)).toBe(true);
    expect(s.bills.filter((b) => /sales and use tax/.test(b.vendor) && b.paid).length).toBe(
      s.asOf.startsWith("2023") ? 3 : 2,
    );
    expect(s.bills.some((b) => /insurance/.test(b.vendor) && !b.paid && b.due > s.asOf)).toBe(true);
    expect(
      s.deals.filter((d) => d.stage === "open" && d.kind === "expansion").length,
    ).toBeGreaterThan(2);
    const runs = s.payroll.filter((p) => p.date <= s.asOf);
    expect(runs[runs.length - 1]!.amount).toBeGreaterThan(runs[0]!.amount);
    expect(s.customers[0]!.name).not.toMatch(/Synthetic/);
  });

  it("gives each company its own risk list", () => {
    const lists = books.map(({ company, s }) => {
      const d = createOperatingDemo({ company, scenario: "baseline" }, 1);
      return engine.scanRisks(s, empty, d.constraints).map((r) => r.label);
    });
    for (const list of lists) expect(list.length).toBeGreaterThanOrEqual(3);
    expect(new Set(lists.flat()).size).toBe(lists.flat().length);
  });
});
