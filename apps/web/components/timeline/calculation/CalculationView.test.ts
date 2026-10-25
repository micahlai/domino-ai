import { describe, expect, it } from "vitest";
import { assumptionSummary } from "./assumptions";

describe("saved calculation source note", () => {
  it("keeps structured import bookkeeping out of the main story", () => {
    const note = JSON.stringify({
      label: "Reported quarter",
      reportedPeriodStart: "2026-05-01",
      reportedPeriodEnd: "2026-07-31",
      knowledgeCutoff: "2026-09-05",
      sourceRecords: [{ secret: "technical" }],
    });
    const summary = assumptionSummary(note);
    expect(summary).toContain("Reported quarter");
    expect(summary).toContain("2026-05-01 to 2026-07-31");
    expect(summary).toContain("Known as of 2026-09-05");
    expect(summary).not.toContain("sourceRecords");
  });

  it("bounds a plain note and does not echo unknown JSON", () => {
    expect(assumptionSummary("A".repeat(500))).toHaveLength(240);
    expect(assumptionSummary('{"unknown":{"raw":"detail"}}')).toContain("Technical details");
  });
});
