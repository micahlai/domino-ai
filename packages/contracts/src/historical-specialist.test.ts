import { describe, expect, it } from "vitest";
import {
  type HistoricalCitation,
  type HistoricalRun,
  type HistoricalSpecialistInput,
  HistoricalSpecialistInputSchema,
  type HistoricalSpecialistOutput,
  HistoricalSpecialistOutputSchema,
  type HistoricalSpecialistRole,
  HISTORICAL_SPECIALIST_LIMITS as L,
  checkHistoricalSpecialistOutput,
  historicalCitationRefs,
} from "./index";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const baseRun: HistoricalRun = {
  id: "run-base",
  caseId: "case-x",
  createdAt: "2031-11-10T00:00:00Z",
  knowledgeCutoff: "2031-11-10T00:00:00Z",
  originBalanceDate: "2031-09-30",
  inputs: { sourceIds: ["src-q2"], factIds: ["fact-cash-q2"], assumptionIds: [] },
  inputHash: "a".repeat(64),
  method: { id: "method-x", version: "1" },
  predictions: [
    {
      id: "pred-1",
      kind: "forecast",
      metric: "cash_and_equivalents",
      period: { kind: "instant", date: "2031-12-31" },
      currency: "USD",
      cents: 100,
    },
  ],
  riskRules: [],
  branch: { kind: "baseline" },
};
const altRun: HistoricalRun = {
  ...baseRun,
  id: "run-alt",
  inputs: { ...baseRun.inputs, assumptionIds: ["asm-1"] },
  branch: {
    kind: "alternative",
    baselineRunId: "run-base",
    decisionAssumptionIds: ["asm-1"],
    postHoc: false,
  },
};

function input(role: HistoricalSpecialistRole = "evidence_analyst"): HistoricalSpecialistInput {
  return HistoricalSpecialistInputSchema.parse({
    role,
    caseId: "case-x",
    companyName: "Synthetic Co",
    visibleThrough: "2031-11-10T00:00:00Z",
    question: "What changed in cash?",
    history: [{ speaker: "user", text: "hello" }],
    sources: [{ id: "src-q2", title: "Q2 report", publishedAt: "2031-08-01T00:00:00Z" }],
    facts: [
      {
        id: "fact-cash-q2",
        kind: "reported",
        metric: "cash_and_equivalents",
        period: { kind: "instant", date: "2031-09-30" },
        currency: "USD",
        cents: 100,
        availableAt: "2031-08-01T00:00:00Z",
        sourceId: "src-q2",
        locator: "balance sheet",
        reportedScale: "ones",
      },
    ],
    assumptions:
      role === "scenario_reviewer"
        ? [
            {
              id: "asm-1",
              label: "counterfactual",
              description: "synthetic",
              basisFactIds: ["fact-cash-q2"],
              value: { unit: "cents", low: 1, high: 2 },
              effectiveFrom: "2031-11-11",
              feasibleAtCutoff: "unknown",
              selectedAfterReveal: false,
            },
          ]
        : [],
    runs: role === "scenario_reviewer" ? [baseRun, altRun] : [baseRun],
    comparisons: [],
  });
}

const out = (over: Partial<HistoricalSpecialistOutput> = {}): HistoricalSpecialistOutput => ({
  assessment: "Cash was reported at the end of Q3 2023 over 13 weeks.",
  citations: [{ kind: "fact", id: "fact-cash-q2" }],
  uncertainties: ["Only one disclosure is available."],
  ...over,
});
const reviewerOut = (over: Partial<HistoricalSpecialistOutput> = {}) =>
  out({ citations: [{ kind: "engine", id: "run-alt" }], ...over });

describe("specialist input", () => {
  it("parses both roles", () => {
    expect(input("evidence_analyst").role).toBe("evidence_analyst");
    expect(input("scenario_reviewer").runs).toHaveLength(2);
  });

  const raw = () => clone(input());
  const src0 = () => raw().sources[0]!;
  const fact0 = () => raw().facts[0]!;
  const future = "2031-12-01T00:00:00Z";
  it.each<[string, Record<string, unknown>]>([
    ["oversized question", { question: "q".repeat(L.questionChars + 1) }],
    [
      "too many history turns",
      {
        history: Array.from({ length: L.historyTurns + 1 }, () => ({
          speaker: "user",
          text: "hi",
        })),
      },
    ],
    [
      "oversized excerpt",
      { sources: [{ ...src0(), excerpt: "e".repeat(L.sourceExcerptChars + 1) }] },
    ],
    ["future source", { sources: [{ ...src0(), publishedAt: future }] }],
    ["future fact", { facts: [{ ...fact0(), availableAt: future }] }],
    ["unknown reported-fact source", { facts: [{ ...fact0(), sourceId: "src-missing" }] }],
    ["duplicate source id", { sources: [src0(), src0()] }],
    ["alternative run for evidence analyst", { runs: [baseRun, altRun] }],
  ])("rejects %s", (_name, patch) => {
    expect(HistoricalSpecialistInputSchema.safeParse({ ...raw(), ...patch }).success).toBe(false);
  });

  it("rejects a scenario reviewer without an alternative", () => {
    const x = clone(input("scenario_reviewer"));
    x.runs = [baseRun];
    x.assumptions = [];
    expect(HistoricalSpecialistInputSchema.safeParse(x).success).toBe(false);
  });

  it("does not echo input text in issue messages", () => {
    const r = HistoricalSpecialistInputSchema.safeParse({
      ...raw(),
      sources: [{ ...src0(), publishedAt: future }],
    });
    expect(JSON.stringify(r.success ? [] : r.error.issues.map((i) => i.message))).not.toContain(
      "src-q2",
    );
  });
});

describe("specialist output schema", () => {
  it("rejects an extra field", () => {
    expect(
      HistoricalSpecialistOutputSchema.safeParse({ ...out(), reasoning: "because" }).success,
    ).toBe(false);
  });

  it("rejects a duplicate citation", () => {
    const c = { kind: "fact", id: "fact-cash-q2" } as const;
    expect(HistoricalSpecialistOutputSchema.safeParse(out({ citations: [c, c] })).success).toBe(
      false,
    );
  });
});

describe("checkHistoricalSpecialistOutput", () => {
  const analyst = input("evidence_analyst");
  const reviewer = input("scenario_reviewer");

  it("lists engine refs as runs then comparisons and hides disallowed kinds", () => {
    expect(historicalCitationRefs(reviewer).engine).toEqual(["run-base", "run-alt"]);
    expect(historicalCitationRefs(analyst).assumption).toEqual([]);
  });

  it("accepts plain text with years, quarters and week counts", () => {
    expect(checkHistoricalSpecialistOutput(analyst, out())).toEqual([]);
    expect(checkHistoricalSpecialistOutput(reviewer, reviewerOut())).toEqual([]);
  });

  it.each<[string, HistoricalCitation]>([
    ["unknown id", { kind: "fact", id: "fact-nope" }],
    ["id of another kind", { kind: "source", id: "fact-cash-q2" }],
    ["assumption from evidence analyst", { kind: "assumption", id: "asm-1" }],
    ["engine only for evidence analyst", { kind: "engine", id: "run-base" }],
  ])("rejects %s for the analyst", (_name, citation) => {
    expect(checkHistoricalSpecialistOutput(analyst, out({ citations: [citation] }))).not.toEqual(
      [],
    );
  });

  it("requires an engine citation for the scenario reviewer", () => {
    expect(
      checkHistoricalSpecialistOutput(
        reviewer,
        out({ citations: [{ kind: "fact", id: "fact-cash-q2" }] }),
      ),
    ).toEqual(["scenario reviewer must cite an engine result"]);
  });

  it.each([
    "Cash fell by $40 million.",
    "Cash fell 12%.",
    "Cash was 1,250,000 at the end.",
    "Cash was 125000 at the end.",
    "This would have prevented bankruptcy.",
    "Bankruptcy could be avoided.",
    "The plan is guaranteed.",
  ])("rejects %s in the assessment and in an uncertainty", (text) => {
    expect(checkHistoricalSpecialistOutput(analyst, out({ assessment: text }))).not.toEqual([]);
    expect(checkHistoricalSpecialistOutput(analyst, out({ uncertainties: [text] }))).not.toEqual(
      [],
    );
  });

  it("never puts output text in problems", () => {
    const secret = "SECRET $40 million";
    expect(
      checkHistoricalSpecialistOutput(analyst, out({ assessment: secret })).join(),
    ).not.toContain("SECRET");
  });
});
