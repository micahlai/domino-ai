import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type HistoricalCase,
  HistoricalCaseSchema,
  HistoricalComparisonContextSchema,
  HistoricalPredictionSchema,
  type HistoricalRun,
  HistoricalRunContextSchema,
} from "../../../packages/contracts/src/index";

const here = (p: string) => new URL(p, import.meta.url);
const text = (p: string) => readFileSync(here(p), "utf8");
const json = (p: string) => JSON.parse(text(p));

const raw = {
  S7: "raw/pre-cutoff/prnewswire-2u-q3-2023.html",
  S8: "raw/held-out/prnewswire-2u-q4-fy2023.html",
};
const c: HistoricalCase = HistoricalCaseSchema.parse(json("case.json"));
const proto = json("protocol.json");
const fact = (id: string) => c.facts.find((f) => f.id === id)!;
const cents = (id: string) => fact(id).cents;

/** Visible text of a PR Newswire page: tags and entities become spaces. */
const plain = (path: string) =>
  readFileSync(here(path), "utf8")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(nbsp|#160);/g, " ")
    .replace(/\s+/g, " ");

/** First number after a row label inside one statement, in the printed unit. */
function row(page: string, statement: RegExp, label: string): number {
  const start = page.search(statement);
  expect(start, `statement ${statement} found`).toBeGreaterThan(-1);
  const at = page.indexOf(label, start);
  expect(at, `row '${label}' found`).toBeGreaterThan(-1);
  const m = /(\()?\s*\$?\s*(\()?\s*(\d[\d,]*)/.exec(page.slice(at + label.length));
  const n = Number(m![3]!.replaceAll(",", ""));
  return m![1] || m![2] ? -n : n;
}

describe("2U cash-only case: raw sources", () => {
  it("raw bytes match the recorded hashes", () => {
    for (const s of c.sources) {
      const bytes = readFileSync(here(raw[s.id as "S7" | "S8"]));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(s.contentHash);
    }
  });

  it("publication times match the page metadata", () => {
    for (const s of c.sources) {
      const html = text(raw[s.id as "S7" | "S8"]);
      expect(html).toContain(`"datePublished": "${s.publishedAt}"`);
    }
    expect(c.sources.map((s) => s.publishedAt)).toEqual([
      "2023-11-09T16:01:00-05:00",
      "2024-02-12T16:01:00-05:00",
    ]);
  });

  it("every reported fact is the printed row, in thousands, times 100000 cents", () => {
    const reported = c.facts.filter((f) => f.kind === "reported");
    expect(reported).toHaveLength(14);
    for (const f of reported) {
      if (f.kind !== "reported") continue;
      const page = plain(raw[f.sourceId as "S7" | "S8"]);
      const isBalance = f.locator.includes("Balance Sheets");
      const statement = isBalance
        ? /Condensed Consolidated Balance Sheets \(in thousands/
        : /Condensed Consolidated Statements of Cash Flows \(in thousands\)/;
      const label = /'([^']+)'/.exec(f.locator)![1]!;
      expect(f.reportedScale).toBe("thousands");
      expect(row(page, statement, label) * 100000, f.id).toBe(f.cents);
    }
  });
});

describe("2U cash-only case: facts", () => {
  it("scope is cash only: no debt, narrative or non-cash metrics", () => {
    const allowed = new Set([
      "cash_and_equivalents",
      "restricted_cash",
      "cash_including_restricted",
      "operating_cash_flow",
      "investing_cash_flow",
      "financing_cash_flow",
      "fx_effect_on_cash",
    ]);
    expect(c.facts.every((f) => allowed.has(f.metric))).toBe(true);
  });

  it("scopes reconcile", () => {
    expect(cents("F01") + cents("F02")).toBe(cents("F03"));
    expect(cents("H01") + cents("H02")).toBe(cents("H03"));
    const q4 = ["D01", "D02", "D03", "D04"].reduce((s, id) => s + cents(id), 0);
    expect(q4).toBe(cents("H03") - cents("F03"));
    for (const [d, y, n] of [
      ["D01", "H04", "F05"],
      ["D02", "H05", "F06"],
      ["D03", "H06", "F07"],
      ["D04", "H07", "F08"],
    ] as const)
      expect(cents(d)).toBe(cents(y) - cents(n));
  });

  it("the cutoff-eligible set is exactly the S7 cash facts", () => {
    const cutoff = Date.parse(proto.knowledgeCutoff);
    const facts = c.facts.filter((f) => Date.parse(f.availableAt) <= cutoff).map((f) => f.id);
    expect(facts).toEqual(proto.inputs.factIds);
    expect(c.sources.filter((s) => Date.parse(s.publishedAt) <= cutoff).map((s) => s.id)).toEqual(
      proto.inputs.sourceIds,
    );
    // Everything else, including the derived Q4 flows, waits for S8.
    for (const id of proto.observation.factIds)
      expect(Date.parse(fact(id).availableAt)).toBeGreaterThan(cutoff);
  });

  it("holds no held-out narrative or debt text", () => {
    const banned =
      /going.concern|factoring|revolver|covenant|refinanc|convertible|term loan|noteholder|chapter 11|bankrupt|\b(H1[0-3]|R1|X1|C0\d)\b/i;
    expect(JSON.stringify(c)).not.toMatch(banned);
    expect(JSON.stringify(proto)).not.toMatch(banned);
  });
});

describe("2U cash-only case: protocol", () => {
  const p = proto.projection;
  const quarter = cents("F05") / 3 + cents("F06") / 3;

  it("recomputes from the facts in exact integer cents", () => {
    expect(Number.isInteger(cents("F05") / 3)).toBe(true);
    expect(Number.isInteger(cents("F06") / 3)).toBe(true);
    expect(p.operatingPerQuarterCents).toBe(cents("F05") / 3);
    expect(p.investingPerQuarterCents).toBe(cents("F06") / 3);
    expect(p.quarterChangeCents).toBe(quarter);
    expect(Number.isInteger(quarter / proto.target.quarterDays)).toBe(true);
    expect(p.dailyChangeCents).toBe(quarter / proto.target.quarterDays);
    expect(p.restrictedCashCents).toBe(cents("F02"));

    const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
    expect(days(proto.originBalanceDate, "2023-11-10")).toBe(proto.days.originToCutoff);
    expect(days("2023-11-10", proto.target.balanceDate)).toBe(proto.days.cutoffToTarget);
    expect(days("2023-09-30", "2023-12-31")).toBe(proto.target.quarterDays);

    const now = cents("F03") + proto.days.originToCutoff * p.dailyChangeCents;
    const target = now + proto.days.cutoffToTarget * p.dailyChangeCents;
    const byId = (list: { id: string; cents: number }[], id: string) =>
      list.find((x) => x.id === id)!.cents;
    expect(now).toBe(4_581_500_000);
    expect(target).toBe(3_581_900_000);
    expect(byId(proto.nowcast, "P-NOW-TOTAL")).toBe(now);
    expect(byId(proto.nowcast, "P-NOW-CASH")).toBe(now - p.restrictedCashCents);
    expect(byId(proto.baselineForecast, "P-B-TOTAL")).toBe(target);
    expect(byId(proto.baselineForecast, "P-B-CASH")).toBe(target - p.restrictedCashCents);
    const cost = proto.response.pointCostCents;
    expect(cost).toBe(
      (proto.response.oneTimeCostCents.low + proto.response.oneTimeCostCents.high) / 2,
    );
    expect(byId(proto.responseForecast, "P-R-TOTAL")).toBe(target - cost);
    expect(byId(proto.responseForecast, "P-R-CASH")).toBe(target - p.restrictedCashCents - cost);
  });

  it("response cost and lag follow the hypothetical assumption", () => {
    const a1 = c.assumptions.find((a) => a.id === "A1")!;
    expect(a1.label).toBe("counterfactual");
    expect(a1.feasibleAtCutoff).toBe("unknown");
    expect(a1.oneTimeCost).toEqual({ unit: "cents", ...proto.response.oneTimeCostCents });
    // First benefit lands after the target, so in-window savings stay 0.
    expect(a1.benefitLagDays).toBeGreaterThan(proto.days.cutoffToTarget);
    expect(a1.value).toEqual({ unit: "cents", low: 0, high: 0 });
    expect(proto.response.inWindowSavingsCents).toBe(0);
  });

  const predictions = (...lists: { id: string }[][]) => lists.flat();
  const run = (kind: "baseline" | "alternative"): HistoricalRun => ({
    id: kind === "baseline" ? "run-baseline" : "run-response",
    caseId: c.id,
    createdAt: "2026-10-24T12:00:00Z",
    knowledgeCutoff: proto.knowledgeCutoff,
    originBalanceDate: proto.originBalanceDate,
    inputs: {
      sourceIds: proto.inputs.sourceIds,
      factIds: proto.inputs.factIds,
      assumptionIds:
        kind === "baseline"
          ? proto.inputs.baselineAssumptionIds
          : proto.inputs.responseAssumptionIds,
    },
    inputHash: createHash("sha256")
      .update(JSON.stringify([kind, proto.inputs]))
      .digest("hex"),
    method: proto.method,
    predictions: predictions(
      proto.nowcast,
      kind === "baseline" ? proto.baselineForecast : proto.responseForecast,
    ) as HistoricalRun["predictions"],
    riskRules: proto.riskRules,
    branch:
      kind === "baseline"
        ? { kind }
        : {
            kind,
            baselineRunId: "run-baseline",
            decisionAssumptionIds: proto.response.decisionAssumptionIds,
            postHoc: proto.response.postHoc,
          },
  });

  it("predictions and both runs satisfy the contracts, with one shared nowcast", () => {
    for (const x of predictions(proto.nowcast, proto.baselineForecast, proto.responseForecast))
      HistoricalPredictionSchema.parse(x);
    const result = HistoricalRunContextSchema.safeParse({
      case: c,
      run: run("alternative"),
      baseline: run("baseline"),
    });
    expect(result.success ? [] : result.error.issues).toEqual([]);
    expect(HistoricalRunContextSchema.safeParse({ case: c, run: run("baseline") }).success).toBe(
      true,
    );
  });

  it("a run that reads S8 or a Q4 fact is rejected", () => {
    const leaky = run("baseline");
    leaky.inputs = {
      ...leaky.inputs,
      sourceIds: ["S7", "S8"],
      factIds: [...leaky.inputs.factIds, "H03"],
    };
    expect(HistoricalRunContextSchema.safeParse({ case: c, run: leaky }).success).toBe(false);
  });

  it("the baseline total scores against the S8 total after reveal", () => {
    const baseline = run("baseline");
    const predicted = proto.baselineForecast[0].cents;
    const result = HistoricalComparisonContextSchema.safeParse({
      case: c,
      run: baseline,
      revealedThrough: "2024-02-13T00:00:00-05:00",
      comparisons: [
        {
          id: "cmp-total",
          runId: baseline.id,
          predictionId: "P-B-TOTAL",
          status: "scored",
          observationFactId: "H03",
          predictedCents: predicted,
          observedCents: cents("H03"),
          errorCents: cents("H03") - predicted,
          absErrorCents: Math.abs(cents("H03") - predicted),
          ruleOutcomes: [],
        },
      ],
    });
    expect(result.success ? [] : result.error.issues).toEqual([]);
  });
});
