import { describe, expect, it } from "vitest";
import {
  type AdvisorInput,
  advisorCreaoJob,
  buildFieldCreaoPrompt,
  checkAdvisorPick,
  fieldCreaoProfileVersion,
} from "./fieldCreao";

const input: AdvisorInput = {
  company: "Osprey",
  asOf: "2026-10-30",
  snapshotVersion: 3,
  scenario: {
    id: "top_customer_leaves",
    title: "Halcyon leaves",
    lowPoint: "$2.64M",
    lenderMinimum: "$3.00M",
    breaksWeek: 3,
  },
  options: [
    {
      fixId: "advise_credit_line_draw",
      label: "Draw $400K on a credit line before week 3",
      costNote: "Interest until repaid",
      risk: "medium",
      lowPointWithFix: "$3.04M",
      survives: true,
      gainVsScenario: "$400K",
    },
    {
      fixId: "advise_delay_bill",
      label: "Delay 1 non-critical vendor bill 30 days",
      costNote: "Late fees",
      risk: "medium",
      lowPointWithFix: "$2.64M",
      survives: false,
      gainVsScenario: "$0",
    },
  ],
};

describe("advisor CREAO job", () => {
  it("accepts a known fix id and strips new money from the rationale", () => {
    const out = checkAdvisorPick(input, {
      fixId: "advise_credit_line_draw",
      rationale: "It is the only fix that survives; it costs $12,345 in fees.",
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.fixId).toBe("advise_credit_line_draw");
      expect(out.value.rationale).not.toContain("12,345");
    }
    expect(
      checkAdvisorPick(input, { result: { fixId: "advise_delay_bill", rationale: "ok" } }).ok,
    ).toBe(true);
  });

  it("rejects an unknown fix id with a reason", () => {
    const out = checkAdvisorPick(input, { fixId: "advise_bridge", rationale: "x" });
    expect(out).toMatchObject({ ok: false });
    if (!out.ok) expect(out.issues[0]).toContain("advise_credit_line_draw");
  });

  it("is a self-contained job with its own profile version", async () => {
    const job = advisorCreaoJob(input);
    const prompt = JSON.parse(buildFieldCreaoPrompt(job));
    expect(prompt.task).toBe("fieldRecommendFix");
    expect(prompt.outputSchema.properties.fixId.enum).toEqual([
      "advise_credit_line_draw",
      "advise_delay_bill",
    ]);
    expect(await fieldCreaoProfileVersion("advisor")).toMatch(/^field_advisor@creao-[0-9a-f]{12}$/);
    expect(() => advisorCreaoJob({ ...input, options: [] })).toThrow();
  });
});
