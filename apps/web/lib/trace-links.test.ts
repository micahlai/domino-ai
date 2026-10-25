import { describe, expect, it } from "vitest";
import { fieldTraceHref, timelineCalculationHref } from "./trace-links";

describe("saved calculation links", () => {
  it("preserves exact Field company, run, scenario and fix identity", () => {
    const href = fieldTraceHref({
      companyId: "company/one",
      runId: "run/old?1",
      scenarioId: "scenario/2",
      fixKind: "delay_bill",
    });
    const url = new URL(href, "https://example.test");
    expect(url.pathname).toBe("/field/analysis");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      companyId: "company/one",
      runId: "run/old?1",
      scenarioId: "scenario/2",
      fixKind: "delay_bill",
    });
  });

  it("keeps slash-containing Timeline company IDs in one route segment", () => {
    const href = timelineCalculationHref("operating/current/asana", "timeline:workspace/old");
    const url = new URL(href, "https://example.test");
    expect(url.pathname).toBe("/c/operating%2Fcurrent%2Fasana/timeline/calculation");
    expect(url.searchParams.get("runId")).toBe("timeline:workspace/old");
  });
});
