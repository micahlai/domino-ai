import { describe, expect, it } from "vitest";
import { fieldOriginHref } from "./fieldOrigin";

describe("saved Field suggestion origin", () => {
  it("keeps the exact run, scenario and fix through a Timeline baseline note", () => {
    const params = new URLSearchParams({
      companyId: "field/company",
      runId: "analyst/old",
      scenarioId: "risk/1",
      fixKind: "delay_bill",
    });
    const href = fieldOriginHref(`Illustrative books.\nField trace: /field/analysis?${params}`);
    expect(href).not.toBeNull();
    const url = new URL(href!, "https://domino.local");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      companyId: "field/company",
      runId: "analyst/old",
      scenarioId: "risk/1",
      fixKind: "delay_bill",
    });
  });

  it("does not invent an origin from ordinary or partial notes", () => {
    expect(fieldOriginHref("Ordinary saved plan.")).toBeNull();
    expect(fieldOriginHref("Field trace: /field/analysis?runId=old")).toBeNull();
    expect(
      fieldOriginHref(
        "Field trace: https://other.test/field/analysis?companyId=a&runId=b&scenarioId=c&fixKind=d",
      ),
    ).toBeNull();
  });
});
