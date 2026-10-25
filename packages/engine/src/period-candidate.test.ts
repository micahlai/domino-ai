import { type HistoricalCase, type ObservationKey, ObservationKeySchema } from "@domino/contracts";
import { describe, expect, it } from "vitest";
import * as engineIndex from "./index";
import { type QuarterBridgeInput, quarterBridge } from "./period";
import {
  type CandidateIneligible,
  type LastQuarterFlow,
  QUARTER_CANDIDATE_METHOD,
  type QuarterCandidate,
  type QuarterCandidateInput,
  quarterCandidate,
} from "./period-candidate";
import { BRIDGE_ROLES, companySnapshot, readSecSource } from "./source-normalization";
import { type KeyOutcome, reconcileSources, valueFor } from "./source-reconciliation";

type Fs = { readFileSync(path: URL): Uint8Array };
const fs = (
  globalThis as unknown as { process: { getBuiltinModule(id: "node:fs"): Fs } }
).process.getBuiltinModule("node:fs");

function unwrap<T>(r: { ok: true; value: T } | { ok: false; errors: string[] }): T {
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.value;
}
const predicted = (r: ReturnType<typeof quarterCandidate>): QuarterCandidate => {
  const v = unwrap(r);
  if (v.status !== "predicted") throw new Error(`ineligible: ${v.reason}: ${v.detail}`);
  return v;
};
const ineligible = (r: ReturnType<typeof quarterCandidate>): CandidateIneligible => {
  const v = unwrap(r);
  if (v.status !== "ineligible") throw new Error("expected ineligible");
  return v;
};
const cents = (c: QuarterCandidate, id: string) => c.forecast.find((p) => p.id === id)?.cents;

// ---------- SYNTHETIC fixtures: invented company, invented values, labelled as such ----------

const CIK = "0000000001";
const OCF_DEF = "us-gaap:NetCashProvidedByUsedInOperatingActivities@1";
const ICF_DEF = "us-gaap:NetCashProvidedByUsedInInvestingActivities@1";
type Flow = "operating_cash_flow" | "investing_cash_flow";

/** A SYNTHETIC L2 selected value for one duration. */
function val(
  metric: Flow,
  start: string,
  end: string,
  c: number,
  o: { at: string; eligibleAt?: string; id: string; definition?: string; cik?: string },
): KeyOutcome {
  return {
    status: "selected",
    value: {
      key: ObservationKeySchema.parse({
        cik: o.cik ?? CIK,
        scope: "consolidated",
        metric,
        definition: o.definition ?? (metric === "operating_cash_flow" ? OCF_DEF : ICF_DEF),
        currency: "USD",
        period: { kind: "duration", start, end },
      }),
      cents: c,
      availableAt: o.at,
      eligibleAt: o.eligibleAt ?? o.at,
      receiptIds: [`rec/${o.id}`],
      observationIds: [`obs/${o.id}`],
    },
  };
}

type Spec = {
  origin: string;
  cutoff: string;
  ytdStart: string;
  published: string;
  total: number;
  usable: number;
  ocfYtd: number;
  icfYtd: number;
  fin?: [number, number];
};

/** A SYNTHETIC baseline B input: origin balances, YTD flows and explicit financing/FX. */
function bridgeInput(s: Spec): QuarterBridgeInput {
  const flow = (id: string, metric: Flow, c: number) => ({
    id,
    kind: "reported" as const,
    metric,
    period: { kind: "duration" as const, start: s.ytdStart, end: s.origin },
    currency: "USD",
    cents: c,
    availableAt: s.published,
    sourceId: "src",
    locator: `SYNTHETIC ${metric}`,
    reportedScale: "ones" as const,
  });
  const assumption = (id: string, low: number, high: number) => ({
    id,
    label: "synthetic" as const,
    description: `SYNTHETIC model assumption ${id}`,
    basisFactIds: [],
    value: { unit: "cents" as const, low, high },
    effectiveFrom: s.origin,
    dependsOn: [],
    feasibleAtCutoff: "yes" as const,
    selectedAfterReveal: false,
  });
  const c: HistoricalCase = {
    id: "synthetic_case",
    companyName: "SYNTHETIC Test Co",
    provenance: "synthetic_fixture",
    currency: "USD",
    sources: [
      {
        id: "src",
        title: "SYNTHETIC periodic filing",
        url: "https://example.test/filing.json",
        publishedAt: s.published,
        timezone: "America/New_York",
        retrievedOn: "2026-10-24",
        contentHash: "a".repeat(64),
      },
    ],
    facts: [
      {
        id: "usable",
        kind: "reported",
        metric: "cash_and_equivalents",
        period: { kind: "instant", date: s.origin },
        currency: "USD",
        cents: s.usable,
        availableAt: s.published,
        sourceId: "src",
        locator: "SYNTHETIC usable",
        reportedScale: "ones",
      },
      {
        id: "total",
        kind: "reported",
        metric: "cash_including_restricted",
        period: { kind: "instant", date: s.origin },
        currency: "USD",
        cents: s.total,
        availableAt: s.published,
        sourceId: "src",
        locator: "SYNTHETIC total",
        reportedScale: "ones",
      },
      flow("ocf_ytd", "operating_cash_flow", s.ocfYtd),
      flow("icf_ytd", "investing_cash_flow", s.icfYtd),
    ],
    assumptions: [assumption("fin", ...(s.fin ?? [0, 0])), assumption("fx", 0, 0)],
  };
  return {
    case: c,
    knowledgeCutoff: s.cutoff,
    originBalanceDate: s.origin,
    usableCashFactId: "usable",
    totalCashFactId: "total",
    operatingYtdFactId: "ocf_ytd",
    investingYtdFactId: "icf_ytd",
    financingAssumptionId: "fin",
    fxAssumptionId: "fx",
  };
}

// SYNTHETIC Q3 origin. Cents: T0 = 100,000,000, usable 95,000,000 (restricted 5,000,000).
// 9M YTD OCF -9,000,000, ICF -3,000,000; H1 YTD OCF -4,000,000, ICF -1,000,000.
const AT_Q3 = "2030-11-05T21:00:00Z";
const AT_H1 = "2030-08-05T21:00:00Z";
const Q3: Spec = {
  origin: "2030-09-30",
  cutoff: "2030-11-10T12:00:00Z",
  ytdStart: "2030-01-01",
  published: AT_Q3,
  total: 100_000_000,
  usable: 95_000_000,
  ocfYtd: -9_000_000,
  icfYtd: -3_000_000,
};
const q3Flows = (): QuarterCandidateInput["lastQuarter"] => ({
  operating: {
    ytd: val("operating_cash_flow", "2030-01-01", "2030-09-30", -9_000_000, {
      at: AT_Q3,
      id: "o9",
    }),
    prior: val("operating_cash_flow", "2030-01-01", "2030-06-30", -4_000_000, {
      at: AT_H1,
      id: "o6",
    }),
  },
  investing: {
    ytd: val("investing_cash_flow", "2030-01-01", "2030-09-30", -3_000_000, {
      at: AT_Q3,
      id: "i9",
    }),
    prior: val("investing_cash_flow", "2030-01-01", "2030-06-30", -1_000_000, {
      at: AT_H1,
      id: "i6",
    }),
  },
});
const q3Input = (lastQuarter = q3Flows(), spec: Spec = Q3): QuarterCandidateInput => ({
  ...bridgeInput(spec),
  lastQuarter,
});

describe("candidate C hand math (SYNTHETIC)", () => {
  it("Q3: nine-month minus six-month YTD replaces only the post-cutoff interval", () => {
    const c = predicted(quarterCandidate(q3Input()));
    // D = 2030-09-30 -> 2030-12-31 = 92 days; e = 2030-09-30 -> 2030-11-10 = 41 days.
    expect([c.quarterDays, c.cutoffDays]).toEqual([92, 41]);
    // Bq = (-9,000,000 + -3,000,000) / 3 = -4,000,000 per quarter (B's estimate).
    // Q3 OCF = -9,000,000 - (-4,000,000) = -5,000,000; Q3 ICF = -3,000,000 - (-1,000,000)
    // = -2,000,000; Cq = -7,000,000.
    expect(c.lastQuarter.operating).toMatchObject({
      cents: -5_000_000,
      ytdCents: -9_000_000,
      priorCents: -4_000_000,
      derivation: "nine-month YTD minus six-month YTD",
    });
    expect(c.lastQuarter.operating.key.period).toEqual({
      kind: "duration",
      start: "2030-07-01",
      end: "2030-09-30",
    });
    expect(c.lastQuarter.investing.cents).toBe(-2_000_000);
    expect(c.exact.baselineQuarter.mid).toBe("-4000000/1");
    expect(c.exact.candidateQuarter.mid).toBe("-7000000/1");
    // total = 100,000,000 + (-4,000,000 * 41 + -7,000,000 * 51) / 92
    //       = 100,000,000 - 521,000,000 / 92 = 2,169,750,000 / 23 = 94,336,956.52... -> 94,336,957
    expect(c.exact.targetTotal.mid).toBe("2169750000/23");
    expect(cents(c, "target_total")).toBe(94_336_957);
    // usable = 94,336,957 - restricted 5,000,000 = 89,336,957
    expect(cents(c, "target_usable")).toBe(89_336_957);
    // B: 100,000,000 - 4,000,000 = 96,000,000; nowcast 100,000,000 - 4,000,000*41/92
    // = 98,217,391.30 -> 98,217,391, shared unchanged (the same objects).
    expect(c.baseline.forecast.find((p) => p.id === "target_total")?.cents).toBe(96_000_000);
    expect(c.nowcast).toBe(c.baseline.nowcast);
    expect(c.nowcast.find((p) => p.id === "nowcast_total")?.cents).toBe(98_217_391);
    expect(c.inputs).toEqual(c.baseline.inputs);
    expect(c.forecast.every((p) => p.range === undefined)).toBe(true);
    expect(c.resolutionIds).toEqual(["rec/i6", "rec/i9", "rec/o6", "rec/o9"]);
    expect(c.observationIds).toEqual(["obs/i6", "obs/i9", "obs/o6", "obs/o9"]);
    expect(c.method).toEqual(QUARTER_CANDIDATE_METHOD);
    expect(c.method.experimental).toBe("retrospective");
  });

  it("Q1: the three-month YTD is the quarter, so C equals B exactly", () => {
    const at = "2030-05-01T21:00:00Z";
    const spec: Spec = {
      origin: "2030-03-31",
      cutoff: "2030-05-05T12:00:00Z",
      ytdStart: "2030-01-01",
      published: at,
      total: 100_000_000,
      usable: 95_000_000,
      ocfYtd: -6_000_000,
      icfYtd: -1_000_000,
    };
    const c = predicted(
      quarterCandidate(
        q3Input(
          {
            operating: {
              ytd: val("operating_cash_flow", "2030-01-01", "2030-03-31", -6_000_000, {
                at,
                id: "o3",
              }),
            },
            investing: {
              ytd: val("investing_cash_flow", "2030-01-01", "2030-03-31", -1_000_000, {
                at,
                id: "i3",
              }),
            },
          },
          spec,
        ),
      ),
    );
    // D = 91 (Apr 30 + May 31 + Jun 30), e = 35. Bq = Cq = -7,000,000.
    // total = 100,000,000 - 7,000,000 * (35 + 56) / 91 = 93,000,000 exactly.
    expect([c.quarterDays, c.cutoffDays]).toEqual([91, 35]);
    expect(c.lastQuarter.operating.derivation).toBe("three-month YTD is the quarter");
    expect(c.lastQuarter.operating.priorCents).toBeUndefined();
    expect(cents(c, "target_total")).toBe(93_000_000);
    expect(cents(c, "target_usable")).toBe(88_000_000);
    expect(c.forecast).toEqual(c.baseline.forecast);
  });

  it("Q2: six-month minus three-month YTD", () => {
    const at = "2030-08-01T21:00:00Z";
    const atQ1 = "2030-05-01T21:00:00Z";
    const spec: Spec = {
      origin: "2030-06-30",
      cutoff: "2030-08-04T12:00:00Z",
      ytdStart: "2030-01-01",
      published: at,
      total: 100_000_000,
      usable: 95_000_000,
      ocfYtd: -10_000_000,
      icfYtd: -2_000_000,
    };
    const c = predicted(
      quarterCandidate(
        q3Input(
          {
            operating: {
              ytd: val("operating_cash_flow", "2030-01-01", "2030-06-30", -10_000_000, {
                at,
                id: "o6",
              }),
              prior: val("operating_cash_flow", "2030-01-01", "2030-03-31", -3_000_000, {
                at: atQ1,
                id: "o3",
              }),
            },
            investing: {
              ytd: val("investing_cash_flow", "2030-01-01", "2030-06-30", -2_000_000, {
                at,
                id: "i6",
              }),
              prior: val("investing_cash_flow", "2030-01-01", "2030-03-31", -500_000, {
                at: atQ1,
                id: "i3",
              }),
            },
          },
          spec,
        ),
      ),
    );
    // D = 92, e = 35. Bq = -12,000,000 / 2 = -6,000,000.
    // Q2 OCF = -10,000,000 + 3,000,000 = -7,000,000; ICF = -2,000,000 + 500,000 = -1,500,000.
    // total = 100,000,000 - (6,000,000*35 + 8,500,000*57)/92 = 100,000,000 - 694,500,000/92
    //       = 2,126,375,000/23 = 92,451,086.96 -> 92,451,087
    expect(c.lastQuarter.operating.derivation).toBe("six-month YTD minus three-month YTD");
    expect(c.lastQuarter.investing.cents).toBe(-1_500_000);
    expect(c.exact.targetTotal.mid).toBe("2126375000/23");
    expect(cents(c, "target_total")).toBe(92_451_087);
    expect(cents(c, "target_usable")).toBe(87_451_087);
  });

  it("Q4: twelve-month (FY) minus nine-month YTD", () => {
    const at = "2031-02-15T21:00:00Z";
    const at9 = "2030-11-05T21:00:00Z";
    const spec: Spec = {
      origin: "2030-12-31",
      cutoff: "2031-02-20T12:00:00Z",
      ytdStart: "2030-01-01",
      published: at,
      total: 100_000_000,
      usable: 95_000_000,
      ocfYtd: -16_000_000,
      icfYtd: -4_000_000,
    };
    const c = predicted(
      quarterCandidate(
        q3Input(
          {
            operating: {
              ytd: val("operating_cash_flow", "2030-01-01", "2030-12-31", -16_000_000, {
                at,
                id: "o12",
              }),
              prior: val("operating_cash_flow", "2030-01-01", "2030-09-30", -9_000_000, {
                at: at9,
                id: "o9",
              }),
            },
            investing: {
              ytd: val("investing_cash_flow", "2030-01-01", "2030-12-31", -4_000_000, {
                at,
                id: "i12",
              }),
              prior: val("investing_cash_flow", "2030-01-01", "2030-09-30", -3_000_000, {
                at: at9,
                id: "i9",
              }),
            },
          },
          spec,
        ),
      ),
    );
    // D = 2030-12-31 -> 2031-03-31 = 90, e = 51. Bq = -20,000,000 / 4 = -5,000,000.
    // Q4 OCF = -7,000,000, ICF = -1,000,000, Cq = -8,000,000.
    // total = 100,000,000 - (5,000,000*51 + 8,000,000*39)/90 = 100,000,000 - 6,300,000 = 93,700,000
    expect([c.quarterDays, c.cutoffDays]).toEqual([90, 51]);
    expect(c.lastQuarter.operating.derivation).toBe("twelve-month YTD minus nine-month YTD");
    expect(c.lastQuarter.operating.key.period).toEqual({
      kind: "duration",
      start: "2030-10-01",
      end: "2030-12-31",
    });
    expect(cents(c, "target_total")).toBe(93_700_000);
    expect(cents(c, "target_usable")).toBe(88_700_000);
  });

  it("uses B's financing/FX assumptions identically, low/mid/high each rounded once", () => {
    const c = predicted(quarterCandidate(q3Input(q3Flows(), { ...Q3, fin: [-9_200_000, 0] })));
    // Financing f adds f*(e/D + (D-e)/D) = f. mid f = -4,600,000:
    // 2,169,750,000/23 - 4,600,000 = 2,063,950,000/23 = 89,736,956.52 -> 89,736,957
    // low f = -9,200,000 -> 85,136,957; high f = 0 -> 94,336,957.
    const total = c.forecast.find((p) => p.id === "target_total");
    expect(total?.cents).toBe(89_736_957);
    expect(total?.range).toEqual({ low: 85_136_957, high: 94_336_957 });
    expect(c.exact.targetTotal).toEqual({
      low: "1958150000/23",
      mid: "2063950000/23",
      high: "2169750000/23",
    });
    expect(c.forecast.find((p) => p.id === "target_usable")?.range).toEqual({
      low: 80_136_957,
      high: 89_336_957,
    });
  });

  it("rounds once at the final target, never adding a rounded nowcast", () => {
    // SYNTHETIC cents. Q2 origin 2030-06-30, cutoff 2030-08-15: D = 92, e = 46 (half).
    // H1 OCF 6 -> Bq = 6/2 = 3; Q1 OCF 1 -> Q2 OCF 5 = Cq. T0 = 1,000, usable 900.
    // exact total = 1,000 + 3*46/92 + 5*46/92 = 1,000 + 1.5 + 2.5 = 1,004.
    // B's rounded nowcast is round(1,001.5) = 1,002; adding round(2.5) = 3 would give 1,005.
    const at = "2030-08-01T21:00:00Z";
    const atQ1 = "2030-05-01T21:00:00Z";
    const spec: Spec = {
      origin: "2030-06-30",
      cutoff: "2030-08-15T12:00:00Z",
      ytdStart: "2030-01-01",
      published: at,
      total: 1_000,
      usable: 900,
      ocfYtd: 6,
      icfYtd: 0,
    };
    const flow = (m: Flow, ytd: number, q1: number, p: string) => ({
      ytd: val(m, "2030-01-01", "2030-06-30", ytd, { at, id: `${p}6` }),
      prior: val(m, "2030-01-01", "2030-03-31", q1, { at: atQ1, id: `${p}3` }),
    });
    const c = predicted(
      quarterCandidate(
        q3Input(
          {
            operating: flow("operating_cash_flow", 6, 1, "o"),
            investing: flow("investing_cash_flow", 0, 0, "i"),
          },
          spec,
        ),
      ),
    );
    expect(c.nowcast.find((p) => p.id === "nowcast_total")?.cents).toBe(1_002);
    expect(c.exact.targetTotal.mid).toBe("1004/1");
    expect(cents(c, "target_total")).toBe(1_004);
    expect(cents(c, "target_usable")).toBe(904);
    expect(c.baseline.forecast.find((p) => p.id === "target_total")?.cents).toBe(1_003);
  });
});

describe("candidate C eligibility (SYNTHETIC): ineligible, never zero", () => {
  const withFlow = (
    name: "operating" | "investing",
    f: Partial<LastQuarterFlow> & { ytd?: KeyOutcome },
  ) => {
    const flows = q3Flows();
    flows[name] = { ...flows[name], ...f } as LastQuarterFlow;
    return flows;
  };

  it("a missing predecessor is ineligible", () => {
    const flows = q3Flows();
    flows.investing = { ytd: flows.investing.ytd };
    const r = ineligible(quarterCandidate(q3Input(flows)));
    expect(r.reason).toBe("missing_predecessor");
    expect(r).not.toHaveProperty("forecast");
  });

  it("an L2-blocked predecessor carries the block reason", () => {
    const missing = ineligible(
      quarterCandidate(
        q3Input(
          withFlow("operating", {
            prior: { status: "blocked", reason: "missing_input", detail: "no candidate" },
          }),
        ),
      ),
    );
    expect(missing.reason).toBe("missing_predecessor");
    const conflict = ineligible(
      quarterCandidate(
        q3Input(
          withFlow("operating", {
            prior: { status: "blocked", reason: "unresolved_conflict", detail: "two values" },
          }),
        ),
      ),
    );
    expect(conflict.reason).toBe("unresolved_conflict");
    const ytd = ineligible(
      quarterCandidate(
        q3Input(
          withFlow("investing", {
            ytd: { status: "blocked", reason: "needs_input", detail: "ambiguous" },
          }),
        ),
      ),
    );
    expect(ytd.reason).toBe("needs_input");
  });

  it("a definition, start or span mismatch is a definition conflict", () => {
    const def = val("operating_cash_flow", "2030-01-01", "2030-06-30", -4_000_000, {
      at: AT_H1,
      id: "o6x",
      definition: "us-gaap:NetCashProvidedByUsedInOperatingActivitiesContinuingOperations@1",
    });
    const start = val("operating_cash_flow", "2030-02-01", "2030-06-30", -4_000_000, {
      at: AT_H1,
      id: "o6s",
    });
    // A three-month predecessor leaves a six-month remainder, not the single quarter.
    const span = val("operating_cash_flow", "2030-01-01", "2030-03-31", -1_000_000, {
      at: AT_H1,
      id: "o3",
    });
    const other = val("operating_cash_flow", "2030-01-01", "2030-06-30", -4_000_000, {
      at: AT_H1,
      id: "o6c",
      cik: "0000000002",
    });
    for (const prior of [def, start, span, other]) {
      const r = ineligible(quarterCandidate(q3Input(withFlow("operating", { prior }))));
      expect(r.reason).toBe("definition_conflict");
    }
  });

  it("an L2 YTD that is not B's YTD fact is a definition conflict", () => {
    const ytd = val("operating_cash_flow", "2030-01-01", "2030-09-30", -9_000_001, {
      at: AT_Q3,
      id: "o9x",
    });
    const r = ineligible(quarterCandidate(q3Input(withFlow("operating", { ytd }))));
    expect(r.reason).toBe("definition_conflict");
    expect(r.detail).toContain("ocf_ytd");
  });

  it("a value eligible only after the cutoff is ineligible (no backdated resolution)", () => {
    const prior = val("operating_cash_flow", "2030-01-01", "2030-06-30", -4_000_000, {
      at: AT_H1,
      // A user resolution recorded after the cutoff gates eligibility, not the source date.
      eligibleAt: "2031-01-15T00:00:00Z",
      id: "o6late",
    });
    const r = ineligible(quarterCandidate(q3Input(withFlow("operating", { prior }))));
    expect(r.reason).toBe("after_cutoff");
  });

  it("a predecessor supplied for a first quarter is a definition conflict", () => {
    const at = "2030-05-01T21:00:00Z";
    const spec: Spec = {
      ...Q3,
      origin: "2030-03-31",
      cutoff: "2030-05-05T12:00:00Z",
      published: at,
      ocfYtd: -6_000_000,
      icfYtd: -1_000_000,
    };
    const r = ineligible(
      quarterCandidate(
        q3Input(
          {
            operating: {
              ytd: val("operating_cash_flow", "2030-01-01", "2030-03-31", -6_000_000, {
                at,
                id: "o3",
              }),
              prior: val("operating_cash_flow", "2030-01-01", "2030-02-28", -2_000_000, {
                at,
                id: "o2",
              }),
            },
            investing: {
              ytd: val("investing_cash_flow", "2030-01-01", "2030-03-31", -1_000_000, {
                at,
                id: "i3",
              }),
            },
          },
          spec,
        ),
      ),
    );
    expect(r.reason).toBe("definition_conflict");
  });

  it("a pair B cannot forecast is ineligible for C too", () => {
    const r = ineligible(
      quarterCandidate(q3Input(q3Flows(), { ...Q3, cutoff: "2031-01-05T00:00:00Z" })),
    );
    expect(r.reason).toBe("baseline_unavailable");
    expect(r.detail).toContain("cutoff must fall inside the target quarter");
  });
});

describe("candidate C input boundary", () => {
  it("never throws on malformed input; returns errors", () => {
    for (const bad of [null, undefined, 1, "x", {}, { lastQuarter: 1 }, [] as unknown]) {
      const r = quarterCandidate(bad as QuarterCandidateInput);
      expect(r.ok).toBe(false);
    }
    const r = quarterCandidate({
      ...q3Input(),
      lastQuarter: { operating: {}, investing: {} },
    } as never);
    expect(r).toMatchObject({ ok: false });
    class Box {
      constructor(readonly v: number) {}
    }
    expect(quarterCandidate({ ...q3Input(), extra: new Box(1) } as never)).toMatchObject({
      ok: false,
      errors: [expect.stringContaining("not a plain object")],
    });
  });

  it("returns an error for a throwing getter or an offset-less cutoff", () => {
    const input = q3Input();
    Object.defineProperty(input, "lastQuarter", {
      enumerable: true,
      get: () => {
        throw new Error("boom");
      },
    });
    expect(quarterCandidate(input)).toMatchObject({
      ok: false,
      errors: [expect.stringContaining("boom")],
    });
    expect(quarterCandidate({ ...q3Input(), knowledgeCutoff: "2030-11-10" })).toMatchObject({
      ok: false,
    });
  });

  it("reads each caller property once and never mutates the input", () => {
    const flows = q3Flows();
    const real = flows.operating.prior;
    let reads = 0;
    const operating = { ytd: flows.operating.ytd } as LastQuarterFlow;
    Object.defineProperty(operating, "prior", {
      enumerable: true,
      get: () => {
        reads += 1;
        // A second read would see a conflicting predecessor.
        return reads === 1
          ? real
          : val("operating_cash_flow", "2030-01-01", "2030-06-30", 123, { at: AT_H1, id: "evil" });
      },
    });
    const input = q3Input({ operating, investing: flows.investing });
    const c = predicted(quarterCandidate(input));
    expect(reads).toBe(1);
    expect(cents(c, "target_total")).toBe(94_336_957);
    const frozen = structuredClone(q3Input());
    const before = JSON.stringify(frozen);
    predicted(quarterCandidate(frozen));
    expect(JSON.stringify(frozen)).toBe(before);
  });

  it("does not depend on property order or lineage order", () => {
    const a = q3Input();
    const flows = q3Flows();
    const rev = (o: KeyOutcome): KeyOutcome =>
      o.status === "selected"
        ? {
            status: "selected",
            value: {
              observationIds: [...o.value.observationIds, "obs/z"].reverse(),
              receiptIds: [...o.value.receiptIds, "rec/z"].reverse(),
              eligibleAt: o.value.eligibleAt,
              availableAt: o.value.availableAt,
              cents: o.value.cents,
              key: o.value.key,
            },
          }
        : o;
    const b = Object.fromEntries(Object.entries(q3Input()).reverse()) as QuarterCandidateInput;
    b.lastQuarter = {
      investing: { prior: rev(flows.investing.prior!), ytd: rev(flows.investing.ytd) },
      operating: { prior: rev(flows.operating.prior!), ytd: rev(flows.operating.ytd) },
    };
    const ca = predicted(quarterCandidate(a));
    const cb = predicted(quarterCandidate(b));
    expect(cb.forecast).toEqual(ca.forecast);
    expect(cb.resolutionIds).toEqual([...ca.resolutionIds, "rec/z"].sort());
  });
});

// ---------- REAL development package: Amplitude, Inc. (data/evaluation/development) ----------

describe("development package: Amplitude 2022Q4 target (real SEC companyfacts, read-only)", () => {
  const dir = new URL("../../../data/evaluation/development/raw/", import.meta.url);
  const AMPLITUDE = "0001866692";
  // Protocol origin: acceptance of the Q3 2022 10-Q 0000950170-22-021850.
  const cutoff = "2022-11-03T20:08:14.000Z";
  const k = (metric: Flow, tag: string, start: string, end: string): ObservationKey =>
    ObservationKeySchema.parse({
      cik: AMPLITUDE,
      scope: "consolidated",
      metric,
      definition: `us-gaap:${tag}@1`,
      currency: "USD",
      period: { kind: "duration", start, end },
    });

  it("C from source rows through L1 snapshot and L2 reconciliation, hand-derived", async () => {
    const source = unwrap(
      await readSecSource({
        id: "amp",
        provenance: "evidence",
        originalUrl: "https://data.sec.gov/api/xbrl/companyfacts/CIK0001866692.json",
        retrievedAt: "2026-10-24T00:00:00Z",
        companyFacts: fs.readFileSync(new URL("amplitude-companyfacts.json", dir)),
        submissions: fs.readFileSync(new URL("amplitude-submissions.json", dir)),
      }),
    ).source;
    const snap = unwrap(
      await companySnapshot(source, {
        id: "amp-2022q4",
        cik: AMPLITUDE,
        sourceSignature: "sec_companyfacts_v1",
        cutoff,
        roles: BRIDGE_ROLES,
      }),
    );
    const roles = snap.bridge;
    if (!roles) throw new Error("bridge roles incomplete");
    expect(snap.originBalanceDate).toBe("2022-09-30");
    const zero = (id: string) => ({
      id,
      label: "synthetic" as const,
      description: `Protocol v1 model assumption: ${id} forecast zero (not a reported value)`,
      basisFactIds: [],
      value: { unit: "cents" as const, low: 0, high: 0 },
      effectiveFrom: "2022-09-30",
      dependsOn: [],
      feasibleAtCutoff: "yes" as const,
      selectedAfterReveal: false,
    });
    const rec = unwrap(
      reconcileSources({
        id: "amp-rec",
        cutoff,
        computedAt: "2026-10-24T12:00:00Z",
        sourceSignature: "sec_companyfacts_v1",
        packages: [source.package],
      }),
    );
    const OCF = "NetCashProvidedByUsedInOperatingActivities";
    const ICF = "NetCashProvidedByUsedInInvestingActivities";
    const input: QuarterCandidateInput = {
      ...roles,
      case: { ...roles.case, assumptions: [zero("financing"), zero("fx")] },
      financingAssumptionId: "financing",
      fxAssumptionId: "fx",
      lastQuarter: {
        operating: {
          ytd: valueFor(rec, k("operating_cash_flow", OCF, "2022-01-01", "2022-09-30")),
          prior: valueFor(rec, k("operating_cash_flow", OCF, "2022-01-01", "2022-06-30")),
        },
        investing: {
          ytd: valueFor(rec, k("investing_cash_flow", ICF, "2022-01-01", "2022-09-30")),
          prior: valueFor(rec, k("investing_cash_flow", ICF, "2022-01-01", "2022-06-30")),
        },
      },
    };
    const c = predicted(quarterCandidate(input));
    // Source rows (USD dollars, accession, acceptance):
    //   total cash 2022-09-30 248,100,000 and usable 247,248,000 (22-021850, 2022-11-03T20:08:14Z)
    //   OCF 9M -786,000; ICF 9M -64,641,000 (22-021850)
    //   OCF H1 2,353,000; ICF H1 -3,788,000 (22-014805, 2022-08-04T20:35:56Z)
    // Q3 OCF = -786,000 - 2,353,000 = -3,139,000; Q3 ICF = -64,641,000 + 3,788,000 = -60,853,000
    expect(c.lastQuarter.operating.cents).toBe(-313_900_000);
    expect(c.lastQuarter.investing.cents).toBe(-6_085_300_000);
    // Bq = (-786,000 - 64,641,000) / 3 = -21,809,000; Cq = -63,992,000 (dollars).
    expect(c.exact.baselineQuarter.mid).toBe("-2180900000/1");
    expect(c.exact.candidateQuarter.mid).toBe("-6399200000/1");
    // D = 92, e = 2022-09-30 -> 2022-11-03 = 34, D - e = 58.
    // total = 248,100,000 + (-21,809,000*34 - 63,992,000*58)/92 = 248,100,000 - 4,453,042,000/92
    //       = $199,697,369.565... = 459,303,950,000/23 cents -> 19,969,736,957 cents
    expect([c.quarterDays, c.cutoffDays]).toEqual([92, 34]);
    expect(c.exact.targetTotal.mid).toBe("459303950000/23");
    expect(cents(c, "target_total")).toBe(19_969_736_957);
    // usable = 19,969,736,957 - (24,810,000,000 - 24,724,800,000) = 19,884,536,957
    expect(cents(c, "target_usable")).toBe(19_884_536_957);
    // B unchanged: 248,100,000 - 21,809,000 = $226,291,000; nowcast $240,040,152.17
    expect(c.baseline.forecast.find((p) => p.id === "target_total")?.cents).toBe(22_629_100_000);
    expect(c.nowcast.find((p) => p.id === "nowcast_total")?.cents).toBe(24_004_015_217);
    expect(c.lastQuarter.operating.availableAt).toBe("2022-11-03T20:08:14.000Z");
    expect(c.resolutionIds.length).toBe(4);
    expect(c.resolutionIds.every((id) => id.startsWith("amp-rec/rec/"))).toBe(true);
    // Same input, B alone, is the accepted bridge unchanged.
    expect(quarterBridge(input).forecast).toEqual(c.baseline.forecast);
  });
});

it("is exported from the engine index", () => {
  expect(engineIndex.quarterCandidate).toBe(quarterCandidate);
  expect(engineIndex.QUARTER_CANDIDATE_METHOD).toBe(QUARTER_CANDIDATE_METHOD);
});
