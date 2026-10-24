import { describe, expect, it } from "vitest";
import {
  TWOU_CUTOFF,
  TWOU_REVEAL,
  twoUCase,
  twoUComparisons,
  twoUPacket,
  twoURuns,
} from "./historical-2u.test-support";
import {
  type HistoricalCitation,
  type HistoricalComparison,
  type HistoricalSpecialistInput,
  HistoricalSpecialistInputSchema,
  type HistoricalSpecialistOutput,
  HistoricalSpecialistOutputSchema,
  HISTORICAL_SPECIALIST_LIMITS as L,
  checkHistoricalSpecialistOutput,
  historicalCitationRefs,
} from "./index";

// Real 2U case, protocol runs and engine-matching comparisons; negatives mutate copies.
type Packet = Awaited<ReturnType<typeof twoUPacket>>;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const packets = {
  analystCutoff: await twoUPacket("evidence_analyst", "cutoff"),
  reviewerCutoff: await twoUPacket("scenario_reviewer", "cutoff"),
  analystReveal: await twoUPacket("evidence_analyst", "reveal"),
  reviewerReveal: await twoUPacket("scenario_reviewer", "reveal"),
};
const { baseline, response } = await twoURuns();
const issues = (x: unknown) => {
  const r = HistoricalSpecialistInputSchema.safeParse(x);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};
const rejects = (x: unknown) => expect(issues(x)).not.toEqual([]);
const mutate = (p: Packet, edit: (x: Packet) => void): Packet => {
  const x = clone(p);
  edit(x);
  return x;
};

describe("specialist input: real 2U packets", () => {
  it.each(Object.entries(packets))("accepts %s", (_name, p) => {
    expect(issues(p)).toEqual([]);
  });

  it("before the reveal the case holds S7 and its cash facts only", () => {
    const c = HistoricalSpecialistInputSchema.parse(packets.reviewerCutoff).case;
    expect(c.sources.map((s) => s.id)).toEqual(["S7"]);
    expect(c.facts.every((f) => f.id.startsWith("F"))).toBe(true);
    expect(c.assumptions.map((a) => a.id)).toContain("A1-DOWNSIDE");
  });

  it("comparisons are the engine's exact 2U errors", () => {
    const scored = (cs: HistoricalComparison[]) =>
      cs.flatMap((x) => (x.status === "scored" ? [[x.observationFactId, x.errorCents]] : []));
    // Literals from packages/engine/src/period-2u.test.ts compareRun.
    expect(scored(twoUComparisons(baseline))).toEqual([
      ["H03", 3_758_000_000],
      ["H01", 3_758_000_000],
    ]);
    expect(scored(twoUComparisons(response))).toEqual([
      ["H03", 4_184_250_000],
      ["H01", 4_184_250_000],
    ]);
  });

  it("strips unknown keys inside the case and runs so they never reach the model", () => {
    const p = mutate(packets.analystCutoff, (x) => {
      Object.assign(x.case.sources[0]!, { note: "FUTURE-S8" });
      Object.assign(x.run, { revealed: "FUTURE-S8" });
    });
    expect(JSON.stringify(HistoricalSpecialistInputSchema.parse(p))).not.toContain("FUTURE");
    rejects({ ...packets.analystCutoff, revealNote: "FUTURE" });
  });
});

describe("specialist input: run closure and hindsight (audit 1)", () => {
  const p = packets.analystCutoff;
  const futureFact = twoUCase(TWOU_REVEAL).facts.find((f) => f.id === "H03")!;
  const hindsight = {
    id: "AS-HINDSIGHT",
    label: "hindsight" as const,
    description: "Uses a later outcome.",
    basisFactIds: [],
    value: { unit: "cents" as const, low: 0, high: 0 },
    effectiveFrom: "2023-11-11",
    dependsOn: [],
    feasibleAtCutoff: "unknown" as const,
    selectedAfterReveal: true,
  };
  it.each<[string, (x: Packet) => void]>([
    ["missing run", (x) => Reflect.deleteProperty(x, "run")],
    ["unknown run source", (x) => x.run.inputs.sourceIds.push("S8")],
    ["unknown run fact", (x) => x.run.inputs.factIds.push("H03")],
    ["unknown run assumption", (x) => x.run.inputs.assumptionIds.push("missing-costs")],
    [
      "rule citing an undisclosed source",
      (x) =>
        x.run.riskRules.push({
          id: "rule",
          metric: "cash_and_equivalents",
          breachWhen: "below",
          thresholdCents: 100,
          basis: "disclosed_term",
          sourceIds: ["undisclosed-term"],
        }),
    ],
    ["future fact in the visible case", (x) => x.case.facts.push(futureFact)],
    [
      "visible time before the run cutoff",
      (x) => {
        x.visibleThrough = "2023-11-10T00:00:00-05:00";
      },
    ],
    ["unused hindsight assumption before the reveal", (x) => x.case.assumptions.push(hindsight)],
    [
      "excerpt for a source not in the case",
      (x) => x.excerpts.push({ sourceId: "S8", text: "later" }),
    ],
  ])("rejects %s", (_name, edit) => rejects(mutate(p, edit)));

  it("rejects a baseline that uses a hindsight assumption, even after the reveal", () => {
    rejects(
      mutate(packets.analystReveal, (x) => {
        x.case.assumptions.push(hindsight);
        x.run.inputs.assumptionIds.push(hindsight.id);
      }),
    );
  });
});

describe("specialist input: comparisons (audit 2)", () => {
  const p = packets.analystReveal;
  const scoredAt = (x: Packet) => x.comparisons.findIndex((c) => c.status === "scored");
  const edit = (change: Record<string, unknown>) => (x: Packet) =>
    Object.assign(x.comparisons[scoredAt(x)]!, change);
  it.each<[string, (x: Packet) => void]>([
    ["nonexistent prediction", edit({ predictionId: "nonexistent-prediction" })],
    [
      "nonexistent rule",
      edit({ ruleOutcomes: [{ ruleId: "nope", predictedBreach: false, observedBreach: false }] }),
    ],
    ["invented observed value", edit({ observedCents: 999_999 })],
    ["invented error", edit({ errorCents: 0, absErrorCents: 0 })],
    ["mismatched metric", edit({ observationFactId: "H02" })],
    ["mismatched period", edit({ observationFactId: "D01" })],
    ["observation available at the cutoff", edit({ observationFactId: "F03" })],
    ["comparison for a run not supplied", edit({ runId: "run-other" })],
    [
      "duplicate engine id",
      (x) => {
        x.comparisons[1]!.id = x.run.id;
      },
    ],
    [
      "comparison before the reveal",
      (x) => {
        x.visibleThrough = TWOU_CUTOFF;
        x.case = twoUCase(TWOU_CUTOFF);
        x.comparisons = x.comparisons.filter((c) => c.status === "unscored");
      },
    ],
  ])("rejects %s", (_name, change) => rejects(mutate(p, change)));
});

describe("specialist input: alternative and baseline (audit 3)", () => {
  const p = packets.reviewerCutoff;
  const branch = (x: Packet) => {
    if (x.run.branch.kind !== "alternative") throw new Error("expected alternative");
    return x.run.branch;
  };
  it.each<[string, (x: Packet) => void]>([
    ["missing baseline", (x) => Reflect.deleteProperty(x, "baseline")],
    [
      "self baseline",
      (x) => {
        branch(x).baselineRunId = x.run.id;
        x.baseline = { ...x.baseline!, id: x.run.id };
      },
    ],
    [
      "baseline that is an alternative",
      (x) => {
        x.baseline = clone(x.run);
      },
    ],
    [
      "decision not in the run inputs",
      (x) => {
        branch(x).decisionAssumptionIds = ["nonexistent"];
      },
    ],
    ["decision dropped from inputs", (x) => x.run.inputs.assumptionIds.pop()],
    ["extra non-decision input", (x) => x.run.inputs.assumptionIds.push("A1-DOWNSIDE")],
    ["baseline input dropped", (x) => x.run.inputs.assumptionIds.shift()],
    [
      "different cutoff",
      (x) => {
        x.baseline!.knowledgeCutoff = "2023-11-10T12:00:00-05:00";
      },
    ],
    [
      "different nowcast",
      (x) => {
        x.run.predictions[0]!.cents += 1;
      },
    ],
    [
      "baseline run for the reviewer",
      (x) => {
        x.run = clone(baseline);
      },
    ],
  ])("rejects %s", (_name, edit) => rejects(mutate(p, edit)));

  it("rejects an alternative or a second run for the evidence analyst", () => {
    rejects({ ...packets.reviewerCutoff, role: "evidence_analyst" });
    rejects({ ...packets.analystCutoff, baseline });
  });
});

describe("specialist input: bounds and messages", () => {
  const p = packets.analystCutoff;
  it.each<[string, (x: Packet) => void]>([
    [
      "oversized question",
      (x) => {
        x.question = "q".repeat(L.questionChars + 1);
      },
    ],
    [
      "too many history turns",
      (x) => {
        x.history = Array.from({ length: L.historyTurns + 1 }, () => ({
          speaker: "user",
          text: "hi",
        }));
      },
    ],
    [
      "oversized excerpt",
      (x) => x.excerpts.push({ sourceId: "S7", text: "e".repeat(L.sourceExcerptChars + 1) }),
    ],
    [
      "duplicate excerpt",
      (x) => x.excerpts.push({ sourceId: "S7", text: "a" }, { sourceId: "S7", text: "b" }),
    ],
  ])("rejects %s", (_name, edit) => rejects(mutate(p, edit)));

  it("accepts a bounded excerpt of a visible source", () => {
    const title = p.case.sources[0]!.title;
    expect(issues(mutate(p, (x) => x.excerpts.push({ sourceId: "S7", text: title })))).toEqual([]);
  });

  it("does not echo input ids in issue messages", () => {
    const bad = mutate(p, (x) => x.run.inputs.factIds.push("PRIVATE_MARKER"));
    expect(issues(bad).join()).not.toContain("PRIVATE_MARKER");
  });
});

describe("specialist output schema", () => {
  const ok = {
    assessment: "Cash fell.",
    citations: [{ kind: "fact", id: "F01" }],
    uncertainties: ["x"],
  };
  it("rejects an extra field", () => {
    expect(
      HistoricalSpecialistOutputSchema.safeParse({ ...ok, reasoning: "because" }).success,
    ).toBe(false);
  });
  it("rejects a duplicate citation", () => {
    expect(
      HistoricalSpecialistOutputSchema.safeParse({
        ...ok,
        citations: [ok.citations[0], ok.citations[0]],
      }).success,
    ).toBe(false);
  });
});

describe("checkHistoricalSpecialistOutput", () => {
  const analyst: HistoricalSpecialistInput = HistoricalSpecialistInputSchema.parse(
    packets.analystCutoff,
  );
  const reviewer: HistoricalSpecialistInput = HistoricalSpecialistInputSchema.parse(
    packets.reviewerReveal,
  );
  const out = (over: Partial<HistoricalSpecialistOutput> = {}): HistoricalSpecialistOutput => ({
    assessment: "Cash fell through Q3 2023 and the 13 weeks after it are unobserved.",
    citations: [{ kind: "fact", id: "F03" }],
    uncertainties: ["Only quarterly evidence is available."],
    ...over,
  });
  const reviewerOut = (over: Partial<HistoricalSpecialistOutput> = {}) =>
    out({ citations: [{ kind: "engine", id: "run-2u-response" }], ...over });

  it("lists engine refs as run, baseline, then comparisons and hides disallowed kinds", () => {
    expect(historicalCitationRefs(reviewer).engine.slice(0, 3)).toEqual([
      "run-2u-response",
      "run-2u-baseline",
      "cmp-run-2u-response-P-NOW-TOTAL",
    ]);
    expect(historicalCitationRefs(analyst).assumption).toEqual([]);
    expect(historicalCitationRefs(analyst).fact).not.toContain("H03");
  });

  it("accepts plain text with years, quarters and week counts", () => {
    expect(checkHistoricalSpecialistOutput(analyst, out())).toEqual([]);
    expect(checkHistoricalSpecialistOutput(reviewer, reviewerOut())).toEqual([]);
  });

  it.each<[string, HistoricalCitation]>([
    ["unknown id", { kind: "fact", id: "fact-nope" }],
    ["fact published after the cutoff", { kind: "fact", id: "H03" }],
    ["id of another kind", { kind: "source", id: "F03" }],
    ["assumption from evidence analyst", { kind: "assumption", id: "A1" }],
    ["engine only for evidence analyst", { kind: "engine", id: "run-2u-baseline" }],
  ])("rejects %s for the analyst", (_name, citation) => {
    expect(checkHistoricalSpecialistOutput(analyst, out({ citations: [citation] }))).not.toEqual(
      [],
    );
  });

  it("returns a fixed diagnostic without the unknown id (audit 5)", () => {
    const problems = checkHistoricalSpecialistOutput(
      analyst,
      out({ citations: [{ kind: "fact", id: "PRIVATE_DATA_MARKER" }] }),
    );
    expect(problems).toContain("citation not allowed");
    expect(problems.join()).not.toContain("PRIVATE_DATA_MARKER");
  });

  it("requires an engine citation for the scenario reviewer", () => {
    expect(
      checkHistoricalSpecialistOutput(reviewer, out({ citations: [{ kind: "fact", id: "F03" }] })),
    ).toEqual(["scenario reviewer must cite an engine result"]);
  });

  // Audit 4: ordinary cautious statements pass.
  it.each([
    "This analysis does not show that bankruptcy could have been prevented.",
    "There is no guarantee of a positive outcome.",
    "Domino cannot guarantee any result.",
    "The evidence never shows the response would avoid bankruptcy.",
    "It isn't possible to say whether bankruptcy was avoidable.",
  ])("accepts the caveat: %s", (text) => {
    expect(checkHistoricalSpecialistOutput(analyst, out({ assessment: text }))).toEqual([]);
    expect(checkHistoricalSpecialistOutput(analyst, out({ uncertainties: [text] }))).toEqual([]);
  });

  it.each([
    "Cash fell by $40 million.",
    "Cash fell 12%.",
    "Cash was 1,250,000 at the end.",
    "Cash was 125000 at the end.",
    "This would have prevented bankruptcy.",
    "Bankruptcy could be avoided.",
    "The plan is guaranteed.",
    "We guarantee a positive outcome.",
    "The company will go bankrupt.",
    "This is not a forecast, but the cut would have prevented bankruptcy.",
    "There is no doubt. The response would have averted bankruptcy.",
  ])("rejects %s in the assessment and in an uncertainty", (text) => {
    expect(checkHistoricalSpecialistOutput(analyst, out({ assessment: text }))).not.toEqual([]);
    expect(checkHistoricalSpecialistOutput(analyst, out({ uncertainties: [text] }))).not.toEqual(
      [],
    );
  });

  it("never puts output text in problems", () => {
    expect(
      checkHistoricalSpecialistOutput(analyst, out({ assessment: "SECRET $40 million" })).join(),
    ).not.toContain("SECRET");
  });
});
