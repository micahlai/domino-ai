import type {
  HistoricalAssumption,
  HistoricalFact,
  HistoricalRun,
  HistoricalSource,
} from "@domino/contracts";
import { describe, expect, it } from "vitest";
import { projectRunKnowledge } from "./investigation-knowledge";

// Synthetic saved payload in getRun's shape, with no HistoricalCase metadata.
const publishedAt = "2023-11-09T16:00:00-05:00";
const knowledgeCutoff = "2023-11-10T23:59:59-05:00";
const source: HistoricalSource = {
  id: "q3",
  title: "Synthetic quarterly disclosure",
  url: "https://example.com/q3",
  accession: "synthetic-q3",
  publishedAt,
  timezone: "America/New_York",
  period: { kind: "duration", start: "2023-01-01", end: "2023-09-30" },
  retrievedOn: "2026-10-24",
  contentHash: "a".repeat(64),
};
const facts: HistoricalFact[] = [
  {
    id: "cash",
    kind: "reported",
    metric: "cash_and_equivalents",
    period: { kind: "instant", date: "2023-09-30" },
    currency: "USD",
    cents: 7000000001,
    availableAt: publishedAt,
    sourceId: "q3",
    locator: "Balance sheet, cash",
    reportedScale: "thousands",
  },
  {
    id: "total",
    kind: "derived",
    metric: "cash_including_restricted",
    period: { kind: "instant", date: "2023-09-30" },
    currency: "USD",
    cents: 7000000001,
    availableAt: publishedAt,
    derivedFrom: ["cash"],
    derivation: "Cash carried into synthetic total; no restricted balance in this fixture",
  },
  {
    id: "operating",
    kind: "reported",
    metric: "operating_cash_flow",
    period: { kind: "duration", start: "2023-01-01", end: "2023-09-30" },
    currency: "USD",
    cents: -1500000001,
    availableAt: publishedAt,
    sourceId: "q3",
    locator: "Cash flow statement, operating activities",
    reportedScale: "thousands",
  },
  {
    id: "investing",
    kind: "reported",
    metric: "investing_cash_flow",
    period: { kind: "duration", start: "2023-01-01", end: "2023-09-30" },
    currency: "USD",
    cents: -200000003,
    availableAt: publishedAt,
    sourceId: "q3",
    locator: "Cash flow statement, investing activities",
    reportedScale: "thousands",
  },
];
const assumptions: HistoricalAssumption[] = [
  {
    id: "financing",
    label: "synthetic",
    description: "Explicit financing range, not reported cash",
    basisFactIds: ["cash"],
    value: { unit: "cents", low: -101, high: 203 },
    effectiveFrom: "2023-11-11",
    oneTimeCost: { unit: "cents", low: 101, high: 999 },
    benefitLagDays: 30,
    dependsOn: [],
    feasibleAtCutoff: "unknown",
    selectedAfterReveal: false,
  },
  {
    id: "fx",
    label: "synthetic",
    description: "Explicit zero exchange-rate assumption",
    basisFactIds: ["operating"],
    value: { unit: "cents", low: 0, high: 0 },
    effectiveFrom: "2023-11-11",
    dependsOn: ["financing"],
    feasibleAtCutoff: "yes",
    selectedAfterReveal: false,
  },
];

function savedRun() {
  const run: HistoricalRun = {
    id: "baseline-saved",
    caseId: "synthetic-case",
    createdAt: "2026-10-24T12:00:00Z",
    knowledgeCutoff,
    originBalanceDate: "2023-09-30",
    inputs: {
      sourceIds: ["q3"],
      factIds: ["cash", "total", "operating", "investing"],
      assumptionIds: ["financing", "fx"],
    },
    inputHash: "b".repeat(64),
    method: { id: "quarterly_cash_bridge", version: "0.1.0" },
    predictions: [
      {
        id: "forecast",
        kind: "forecast",
        metric: "cash_and_equivalents",
        period: { kind: "instant", date: "2023-12-31" },
        currency: "USD",
        cents: 6000000001,
        range: { low: 5000000000, high: 7000000001 },
      },
    ],
    riskRules: [
      {
        id: "minimum",
        metric: "cash_and_equivalents",
        breachWhen: "below",
        thresholdCents: 100000000,
        basis: "disclosed_term",
        sourceIds: ["q3"],
      },
    ],
    branch: { kind: "baseline" },
  };
  return {
    runId: "baseline-saved",
    run,
    inputSnapshot: {
      caseId: "synthetic-case",
      currency: "USD",
      method: { id: "quarterly_cash_bridge", version: "0.1.0" },
      roles: {
        knowledgeCutoff,
        originBalanceDate: "2023-09-30",
        usableCashFactId: "cash",
        totalCashFactId: "total",
        operatingYtdFactId: "operating",
        investingYtdFactId: "investing",
        financingAssumptionId: "financing",
        fxAssumptionId: "fx",
      },
      sources: structuredClone([source]),
      facts: structuredClone(facts),
      assumptions: structuredClone(assumptions),
    },
    riskRulesNote: "Synthetic threshold for validation only",
  };
}

type SavedRun = ReturnType<typeof savedRun>;

describe("projectRunKnowledge", () => {
  it("projects exact saved records, dates, provenance and assumption costs", () => {
    const packet = projectRunKnowledge(savedRun());
    expect(packet).toEqual({
      caseId: "synthetic-case",
      runId: "baseline-saved",
      knowledgeCutoff: "2023-11-10T23:59:59-05:00",
      inputHash: "b".repeat(64),
      currency: "USD",
      method: { id: "quarterly_cash_bridge", version: "0.1.0" },
      sources: [source],
      facts,
      assumptions,
    });
    expect(packet.assumptions[0]?.oneTimeCost).toEqual({ unit: "cents", low: 101, high: 999 });
    expect(packet.facts[2]?.cents).toBe(-1500000001);
  });

  it("returns a deeply frozen, detached packet without freezing or changing its input", () => {
    const data = savedRun();
    const before = structuredClone(data);
    const packet = projectRunKnowledge(data);
    expect(data).toEqual(before);
    expect(Object.isFrozen(data.inputSnapshot.facts)).toBe(false);
    const checkFrozen = (value: unknown): void => {
      if (value !== null && typeof value === "object") {
        expect(Object.isFrozen(value)).toBe(true);
        for (const child of Object.values(value)) checkFrozen(child);
      }
    };
    checkFrozen(packet);
    data.inputSnapshot.facts[0]!.cents = 1;
    data.inputSnapshot.assumptions[0]!.oneTimeCost!.low = 2;
    data.inputSnapshot.sources[0]!.title = "Changed after reveal";
    data.run.method.version = "later";
    expect(packet.facts).toEqual(facts);
    expect(packet.assumptions).toEqual(assumptions);
    expect(packet.sources).toEqual([source]);
    expect(packet.method).toEqual({ id: "quarterly_cash_bridge", version: "0.1.0" });
  });

  it("is deterministic and ignores later case/reveal/assessment fields", () => {
    const data = savedRun();
    const expected = projectRunKnowledge(data);
    expect(
      projectRunKnowledge({
        ...data,
        ...{
          case: { facts: [{ cents: 1, availableAt: "2024-03-01T00:00:00Z" }] },
          comparisons: [{ observedCents: 1 }],
          assessment: "A later assessment",
        },
      }),
    ).toEqual(expected);
    expect(projectRunKnowledge(data)).toEqual(expected);
  });

  it("preserves valid amendment provenance and inherited availability", () => {
    const data = savedRun();
    const amendment: HistoricalSource = {
      ...source,
      id: "amended",
      amends: "q3",
      publishedAt: "2023-11-10T16:00:00-05:00",
      contentHash: "c".repeat(64),
    };
    data.inputSnapshot.sources.push(amendment);
    data.run.inputs.sourceIds.push("amended");
    const cash = data.inputSnapshot.facts[0]!;
    if (cash.kind === "reported") cash.sourceId = "amended";
    cash.availableAt = amendment.publishedAt;
    data.inputSnapshot.facts[1]!.availableAt = amendment.publishedAt;
    const packet = projectRunKnowledge(data);
    expect(packet.sources).toEqual([source, amendment]);
    expect(packet.facts[1]).toEqual({ ...facts[1], availableAt: amendment.publishedAt });
  });

  it("accepts publication exactly at the cutoff, comparing instants across offsets", () => {
    const data = savedRun();
    const atCutoff = "2023-11-11T04:59:59Z";
    data.inputSnapshot.sources[0]!.publishedAt = atCutoff;
    for (const fact of data.inputSnapshot.facts) fact.availableAt = atCutoff;
    const packet = projectRunKnowledge(data);
    expect(packet.sources).toEqual([{ ...source, publishedAt: atCutoff }]);
    expect(packet.facts).toEqual(facts.map((fact) => ({ ...fact, availableAt: atCutoff })));
  });

  it("carries the server hash as metadata, without claiming to authenticate input content", () => {
    const data = savedRun();
    // Only loadRun can verify that content matches the stored hash. Local consistency
    // checks cannot detect an otherwise valid changed amount with the same inputHash.
    data.inputSnapshot.facts[2]!.cents = -123;
    const packet = projectRunKnowledge(data);
    expect(packet.inputHash).toBe("b".repeat(64));
    expect(packet.facts[2]).toEqual({ ...facts[2], cents: -123 });
  });

  const invalidCases: [string, (data: SavedRun) => void, string][] = [
    [
      "run membership",
      (d) => {
        d.runId = "other";
      },
      "runId differs",
    ],
    [
      "case membership",
      (d) => {
        d.inputSnapshot.caseId = "other";
      },
      "another case",
    ],
    [
      "cutoff",
      (d) => {
        d.inputSnapshot.roles.knowledgeCutoff = publishedAt;
      },
      "cutoff differs",
    ],
    [
      "origin",
      (d) => {
        d.inputSnapshot.roles.originBalanceDate = "2023-09-29";
      },
      "origin balance date differs",
    ],
    [
      "method id",
      (d) => {
        d.inputSnapshot.method.id = "other";
      },
      "method differs",
    ],
    [
      "method version",
      (d) => {
        d.inputSnapshot.method.version = "2";
      },
      "method differs",
    ],
    [
      "missing roles",
      (d) => {
        Reflect.deleteProperty(d.inputSnapshot, "roles");
      },
      "roles",
    ],
    [
      "missing source input",
      (d) => {
        d.inputSnapshot.sources = [];
      },
      "source IDs",
    ],
    [
      "extra source",
      (d) => {
        d.inputSnapshot.sources.push({ ...source, id: "extra" });
      },
      "source IDs",
    ],
    [
      "missing fact",
      (d) => {
        d.inputSnapshot.facts.pop();
      },
      "fact IDs",
    ],
    [
      "reordered facts",
      (d) => {
        d.inputSnapshot.facts.reverse();
      },
      "fact IDs",
    ],
    [
      "duplicate fact",
      (d) => {
        d.inputSnapshot.facts.push(d.inputSnapshot.facts[0]!);
        d.run.inputs.factIds.push("cash");
      },
      "fact IDs",
    ],
    [
      "missing assumption",
      (d) => {
        d.inputSnapshot.assumptions.pop();
      },
      "assumption IDs",
    ],
    [
      "future source",
      (d) => {
        d.inputSnapshot.sources[0]!.publishedAt = "2023-11-11T05:00:00Z";
      },
      "source published after",
    ],
    [
      "future fact",
      (d) => {
        d.inputSnapshot.facts[0]!.availableAt = "2023-11-11T05:00:00Z";
      },
      "fact available after",
    ],
    [
      "missing publication",
      (d) => {
        Reflect.deleteProperty(d.inputSnapshot.sources[0]!, "publishedAt");
      },
      "publishedAt",
    ],
    [
      "missing locator",
      (d) => {
        Reflect.deleteProperty(d.inputSnapshot.facts[0]!, "locator");
      },
      "locator",
    ],
    [
      "missing source hash",
      (d) => {
        Reflect.deleteProperty(d.inputSnapshot.sources[0]!, "contentHash");
      },
      "contentHash",
    ],
    [
      "unlinked source",
      (d) => {
        const f = d.inputSnapshot.facts[0]!;
        if (f.kind === "reported") f.sourceId = "absent";
      },
      "fact source",
    ],
    [
      "reported availability",
      (d) => {
        d.inputSnapshot.facts[0]!.availableAt = "2023-11-09T20:00:00Z";
      },
      "availability differs",
    ],
    [
      "missing derived input",
      (d) => {
        const f = d.inputSnapshot.facts[1]!;
        if (f.kind === "derived") f.derivedFrom = ["absent"];
      },
      "derived inputs",
    ],
    [
      "cyclic derivation",
      (d) => {
        const f = d.inputSnapshot.facts[1]!;
        if (f.kind === "derived") f.derivedFrom = ["total"];
      },
      "derived inputs",
    ],
    [
      "derived availability",
      (d) => {
        d.inputSnapshot.facts[1]!.availableAt = "2023-11-10T00:00:00Z";
      },
      "latest input availability",
    ],
    [
      "missing amendment original",
      (d) => {
        d.inputSnapshot.sources[0]!.amends = "absent";
      },
      "amended source not found",
    ],
    [
      "self amendment",
      (d) => {
        d.inputSnapshot.sources[0]!.amends = "q3";
      },
      "amendment must",
    ],
    [
      "wrong fact currency",
      (d) => {
        d.inputSnapshot.facts[0]!.currency = "EUR";
      },
      "fact currency",
    ],
    [
      "wrong prediction currency",
      (d) => {
        d.run.predictions[0]!.currency = "EUR";
      },
      "prediction currency",
    ],
    [
      "missing origin balance",
      (d) => {
        d.run.originBalanceDate = "2023-09-29";
        d.inputSnapshot.roles.originBalanceDate = "2023-09-29";
      },
      "no input balance",
    ],
    [
      "missing basis",
      (d) => {
        d.inputSnapshot.assumptions[0]!.basisFactIds = ["absent"];
      },
      "assumption basis",
    ],
    [
      "missing dependency",
      (d) => {
        d.inputSnapshot.assumptions[0]!.dependsOn = ["absent"];
      },
      "assumption dependencies",
    ],
    [
      "forward dependency",
      (d) => {
        d.inputSnapshot.assumptions[0]!.dependsOn = ["fx"];
      },
      "assumption dependencies",
    ],
    [
      "hindsight",
      (d) => {
        d.inputSnapshot.assumptions[0]!.label = "hindsight";
      },
      "baseline cannot use hindsight",
    ],
    [
      "post-reveal selection",
      (d) => {
        d.inputSnapshot.assumptions[0]!.selectedAfterReveal = true;
      },
      "post-reveal assumptions",
    ],
    [
      "missing role fact",
      (d) => {
        d.inputSnapshot.roles.operatingYtdFactId = "absent";
      },
      "roles must reference",
    ],
    [
      "missing role assumption",
      (d) => {
        d.inputSnapshot.roles.fxAssumptionId = "absent";
      },
      "roles must reference",
    ],
    [
      "missing rule source",
      (d) => {
        d.run.riskRules[0]!.sourceIds = ["absent"];
      },
      "rule source",
    ],
    [
      "unproven disclosed rule",
      (d) => {
        d.run.riskRules[0]!.sourceIds = [];
      },
      "disclosed term needs",
    ],
    [
      "fractional cents",
      (d) => {
        d.inputSnapshot.facts[0]!.cents = 1.5;
      },
      "cents",
    ],
    [
      "unsafe cents",
      (d) => {
        d.inputSnapshot.facts[0]!.cents = Number.MAX_SAFE_INTEGER + 1;
      },
      "cents",
    ],
    [
      "negative cost",
      (d) => {
        d.inputSnapshot.assumptions[0]!.oneTimeCost!.low = -1;
      },
      "oneTimeCost",
    ],
    [
      "reversed range",
      (d) => {
        d.inputSnapshot.assumptions[0]!.value.low = 999;
      },
      "low is above high",
    ],
    [
      "alternative",
      (d) => {
        d.run.branch = {
          kind: "alternative",
          baselineRunId: "baseline",
          decisionAssumptionIds: ["financing"],
          postHoc: false,
        };
      },
      "alternative runs are not supported",
    ],
  ];

  it.each(invalidCases)("rejects %s", (_name, mutate, message) => {
    const data = savedRun();
    mutate(data);
    expect(() => projectRunKnowledge(data)).toThrow("Invalid company knowledge input:");
    expect(() => projectRunKnowledge(data)).toThrow(message);
  });
});
