import { type HistoricalCase, type SourcePackage, SourcePackageSchema } from "@domino/contracts";
import { describe, expect, it } from "vitest";
import * as engineIndex from "./index";
import { quarterBridge } from "./period";
import {
  type CandidateIneligible,
  QUARTER_CANDIDATE_METHOD,
  type QuarterCandidate,
  type QuarterCandidateInput,
  quarterCandidate,
} from "./period-candidate";
import { BRIDGE_ROLES, companySnapshot, readSecSource } from "./source-normalization";

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

// ---------- SYNTHETIC fixtures: invented companies and filings, labelled as such ----------

const A = "0000000001";
const B = "0000000002";
const SIG = "sec_companyfacts_v1";
const OCF = "NetCashProvidedByUsedInOperatingActivities";
const ICF = "NetCashProvidedByUsedInInvestingActivities";

/** Exact dollar lexeme for integer cents, as companyfacts writes it. */
const lexeme = (c: number): string => {
  const a = Math.abs(c);
  return `${c < 0 ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
};

type Row = { tag: string; acc: string; c: number; start: string; end: string };
type Filing = SourcePackage["accessions"][number];
type Spec = {
  cik?: string;
  origin: string;
  cutoff: string;
  ytdStart: string;
  /** Acceptance of the origin filing. */
  published: string;
  /** Acceptance of the filing with the preceding YTD. */
  priorAt: string;
  total: number;
  usable: number;
  ocfYtd: number;
  icfYtd: number;
  /** Absent for a first quarter. */
  ocfPrior?: number;
  icfPrior?: number;
  fin?: [number, number];
  /** Extra SYNTHETIC filings and rows (conflicts, late filings, other tags). */
  filings?: Filing[];
  rows?: Row[];
};

/** Last day of the quarter before the origin's quarter. */
const priorEndOf = (origin: string): string =>
  new Date(Date.UTC(Number(origin.slice(0, 4)), Number(origin.slice(5, 7)) - 3, 0))
    .toISOString()
    .slice(0, 10);

const acc = (cik: string, yy: string, n: number) => `${cik}-${yy}-${String(n).padStart(6, "0")}`;

/** A SYNTHETIC package and a baseline case whose YTD facts are that package's rows. */
function synth(s: Spec): QuarterCandidateInput {
  const cik = s.cik ?? A;
  const yy = s.origin.slice(2, 4);
  const cur = acc(cik, yy, 2);
  const pri = acc(cik, yy, 1);
  const priorEnd = priorEndOf(s.origin);
  const filings: Filing[] = [
    {
      accession: cur,
      form: s.origin.endsWith("12-31") ? "10-K" : "10-Q",
      acceptedAt: s.published,
      reportPeriod: { kind: "instant", date: s.origin },
    },
  ];
  const rows: Row[] = [
    { tag: OCF, acc: cur, c: s.ocfYtd, start: s.ytdStart, end: s.origin },
    { tag: ICF, acc: cur, c: s.icfYtd, start: s.ytdStart, end: s.origin },
  ];
  if (s.ocfPrior !== undefined || s.icfPrior !== undefined) {
    filings.push({
      accession: pri,
      form: "10-Q",
      acceptedAt: s.priorAt,
      reportPeriod: { kind: "instant", date: priorEnd },
    });
    if (s.ocfPrior !== undefined)
      rows.push({ tag: OCF, acc: pri, c: s.ocfPrior, start: s.ytdStart, end: priorEnd });
    if (s.icfPrior !== undefined)
      rows.push({ tag: ICF, acc: pri, c: s.icfPrior, start: s.ytdStart, end: priorEnd });
  }
  filings.push(...(s.filings ?? []));
  rows.push(...(s.rows ?? []));
  const counts = new Map<string, number>();
  const records = rows.map((r) => {
    const n = counts.get(r.tag) ?? 0;
    counts.set(r.tag, n + 1);
    return {
      id: `us-gaap:${r.tag}:USD:${n}`,
      accession: r.acc,
      taxonomy: "us-gaap",
      tag: r.tag,
      unit: "USD",
      pointer: `/facts/us-gaap/${r.tag}/units/USD/${n}`,
      rawValue: lexeme(r.c),
      period: { kind: "duration", start: r.start, end: r.end },
    };
  });
  const pkg = SourcePackageSchema.parse({
    schemaVersion: 1,
    id: `synthetic-${cik}`,
    format: "sec_companyfacts_v1",
    provenance: "synthetic_fixture",
    company: { cik, name: `SYNTHETIC Co ${cik}` },
    originalUrl: `https://example.test/${cik}.json`,
    retrievedAt: "2040-01-01T00:00:00Z",
    rawContentHash: "a".repeat(64),
    submissionsContentHash: "b".repeat(64),
    accessions: filings,
    records,
  });
  const source = `source/${cur}`;
  // L1's fact shape: sourceId names the accession, locator is the row pointer.
  const flowFact = (
    id: string,
    metric: "operating_cash_flow" | "investing_cash_flow",
    i: number,
  ) => ({
    id,
    kind: "reported" as const,
    metric,
    period: { kind: "duration" as const, start: s.ytdStart, end: s.origin },
    currency: "USD",
    cents: rows[i]?.c as number,
    availableAt: s.published,
    sourceId: source,
    locator: records[i]?.pointer as string,
    reportedScale: "ones" as const,
  });
  const balance = (
    id: string,
    metric: "cash_and_equivalents" | "cash_including_restricted",
    c: number,
  ) => ({
    id,
    kind: "reported" as const,
    metric,
    period: { kind: "instant" as const, date: s.origin },
    currency: "USD",
    cents: c,
    availableAt: s.published,
    sourceId: source,
    locator: `/facts/us-gaap/SYNTHETIC/${id}`,
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
    companyName: `SYNTHETIC Co ${cik}`,
    provenance: "synthetic_fixture",
    currency: "USD",
    sources: [
      {
        id: source,
        title: "SYNTHETIC periodic filing",
        url: `https://example.test/${cik}.json`,
        publishedAt: s.published,
        timezone: "America/New_York",
        retrievedOn: "2026-10-24",
        contentHash: "a".repeat(64),
      },
    ],
    facts: [
      balance("usable", "cash_and_equivalents", s.usable),
      balance("total", "cash_including_restricted", s.total),
      flowFact("ocf_ytd", "operating_cash_flow", 0),
      flowFact("icf_ytd", "investing_cash_flow", 1),
    ],
    assumptions: [assumption("fin", ...(s.fin ?? [0, 0])), assumption("fx", 0, 0)],
  };
  return {
    cik,
    case: c,
    knowledgeCutoff: s.cutoff,
    originBalanceDate: s.origin,
    usableCashFactId: "usable",
    totalCashFactId: "total",
    operatingYtdFactId: "ocf_ytd",
    investingYtdFactId: "icf_ytd",
    financingAssumptionId: "fin",
    fxAssumptionId: "fx",
    sources: {
      packages: [pkg],
      sourceSignature: SIG,
      reconciliationId: "rec",
      computedAt: "2026-10-24T12:00:00Z",
    },
  };
}

// SYNTHETIC Q3 origin. Cents: T0 = 100,000,000, usable 95,000,000 (restricted 5,000,000).
// 9M YTD OCF -9,000,000, ICF -3,000,000; H1 YTD OCF -4,000,000, ICF -1,000,000.
const Q3: Spec = {
  origin: "2030-09-30",
  cutoff: "2030-11-10T12:00:00Z",
  ytdStart: "2030-01-01",
  published: "2030-11-05T21:00:00Z",
  priorAt: "2030-08-05T21:00:00Z",
  total: 100_000_000,
  usable: 95_000_000,
  ocfYtd: -9_000_000,
  icfYtd: -3_000_000,
  ocfPrior: -4_000_000,
  icfPrior: -1_000_000,
};

describe("candidate C hand math (SYNTHETIC)", () => {
  it("Q3: nine-month minus six-month YTD replaces only the post-cutoff interval", () => {
    const c = predicted(quarterCandidate(synth(Q3)));
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
    expect(c.lastQuarter.operating.key).toMatchObject({
      cik: A,
      definition: `us-gaap:${OCF}@1`,
      period: { kind: "duration", start: "2030-07-01", end: "2030-09-30" },
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
    // Four L2 receipts from C's own run: YTD and predecessor for each flow.
    expect(c.reconciliationId).toBe("rec");
    expect(c.resolutionIds).toHaveLength(4);
    expect(c.resolutionIds.every((id) => id.startsWith("rec/rec/"))).toBe(true);
    expect(c.observationIds).toHaveLength(4);
    expect(c.method).toEqual(QUARTER_CANDIDATE_METHOD);
    expect(c.method.experimental).toBe("retrospective");
  });

  it("Q1: the three-month YTD is the quarter, so C equals B exactly", () => {
    const c = predicted(
      quarterCandidate(
        synth({
          ...Q3,
          origin: "2030-03-31",
          cutoff: "2030-05-05T12:00:00Z",
          published: "2030-05-01T21:00:00Z",
          ocfYtd: -6_000_000,
          icfYtd: -1_000_000,
          ocfPrior: undefined,
          icfPrior: undefined,
        }),
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
    const c = predicted(
      quarterCandidate(
        synth({
          ...Q3,
          origin: "2030-06-30",
          cutoff: "2030-08-04T12:00:00Z",
          published: "2030-08-01T21:00:00Z",
          priorAt: "2030-05-01T21:00:00Z",
          ocfYtd: -10_000_000,
          icfYtd: -2_000_000,
          ocfPrior: -3_000_000,
          icfPrior: -500_000,
        }),
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
    const c = predicted(
      quarterCandidate(
        synth({
          ...Q3,
          origin: "2030-12-31",
          cutoff: "2031-02-20T12:00:00Z",
          published: "2031-02-15T21:00:00Z",
          priorAt: "2030-11-05T21:00:00Z",
          ocfYtd: -16_000_000,
          icfYtd: -4_000_000,
          ocfPrior: -9_000_000,
          icfPrior: -3_000_000,
        }),
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
    const c = predicted(quarterCandidate(synth({ ...Q3, fin: [-9_200_000, 0] })));
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
    const c = predicted(
      quarterCandidate(
        synth({
          ...Q3,
          origin: "2030-06-30",
          cutoff: "2030-08-15T12:00:00Z",
          published: "2030-08-01T21:00:00Z",
          priorAt: "2030-05-01T21:00:00Z",
          total: 1_000,
          usable: 900,
          ocfYtd: 6,
          icfYtd: 0,
          ocfPrior: 1,
          icfPrior: 0,
        }),
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
  it("a missing predecessor is ineligible", () => {
    const r = ineligible(quarterCandidate(synth({ ...Q3, icfPrior: undefined })));
    expect(r.reason).toBe("missing_predecessor");
    expect(r).not.toHaveProperty("forecast");
  });

  it("a predecessor only under an unrelated tag is missing, not borrowed", () => {
    const priorEnd = "2030-06-30";
    const r = ineligible(
      quarterCandidate(
        synth({
          ...Q3,
          ocfPrior: undefined,
          rows: [
            {
              tag: "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
              acc: acc(A, "30", 1),
              c: -4_000_000,
              start: "2030-01-01",
              end: priorEnd,
            },
          ],
        }),
      ),
    );
    expect(r.reason).toBe("missing_predecessor");
  });

  it("conflicting predecessors stay blocked; a resolution after the cutoff cannot rescue them", () => {
    const amend = acc(A, "30", 3);
    const spec: Spec = {
      ...Q3,
      filings: [
        {
          accession: amend,
          form: "10-Q/A",
          acceptedAt: "2030-09-01T21:00:00Z",
          reportPeriod: { kind: "instant", date: "2030-06-30" },
          amends: acc(A, "30", 1),
        },
      ],
      rows: [{ tag: ICF, acc: amend, c: -1_100_000, start: "2030-01-01", end: "2030-06-30" }],
    };
    expect(ineligible(quarterCandidate(synth(spec))).reason).toBe("unresolved_conflict");
    const input = synth(spec);
    const key = {
      cik: A,
      scope: "consolidated" as const,
      metric: "investing_cash_flow" as const,
      definition: `us-gaap:${ICF}@1`,
      currency: "USD",
      period: { kind: "duration" as const, start: "2030-01-01", end: "2030-06-30" },
    };
    const late = {
      ...input,
      sources: {
        ...input.sources,
        resolutions: [
          {
            id: "res1",
            userId: "u1",
            status: "accepted" as const,
            key,
            consideredIds: [
              "synthetic-0000000001/obs/us-gaap:NetCashProvidedByUsedInInvestingActivities:USD:1",
              "synthetic-0000000001/obs/us-gaap:NetCashProvidedByUsedInInvestingActivities:USD:2",
            ],
            selectedIds: [
              "synthetic-0000000001/obs/us-gaap:NetCashProvidedByUsedInInvestingActivities:USD:1",
            ],
            recordedAt: "2031-01-15T00:00:00Z",
            effectiveFrom: "2031-01-15T00:00:00Z",
          },
        ],
      },
    };
    expect(ineligible(quarterCandidate(late)).reason).toBe("unresolved_conflict");
    // The same resolution recorded before the cutoff selects -1,000,000: C predicts.
    const timely = structuredClone(late);
    const [res] = timely.sources.resolutions ?? [];
    if (!res) throw new Error("fixture");
    Object.assign(res, {
      recordedAt: "2030-11-08T00:00:00Z",
      effectiveFrom: "2030-11-08T00:00:00Z",
    });
    const c = predicted(quarterCandidate(timely));
    expect(c.lastQuarter.investing.cents).toBe(-2_000_000);
    expect(c.lastQuarter.investing.eligibleAt).toBe("2030-11-08T00:00:00Z");
  });

  it("a predecessor known only after the cutoff is after_cutoff", () => {
    const r = ineligible(quarterCandidate(synth({ ...Q3, priorAt: "2030-12-01T21:00:00Z" })));
    expect(r.reason).toBe("after_cutoff");
  });

  it("refuses caller-supplied flow values, even with intact lineage ids", () => {
    const forged = {
      ...synth(Q3),
      lastQuarter: {
        operating: {
          ytd: { status: "selected", value: { cents: -9_000_000, receiptIds: ["rec/x"] } },
          prior: { status: "selected", value: { cents: 0, receiptIds: ["rec/y"] } },
        },
      },
    };
    expect(quarterCandidate(forged as never)).toMatchObject({
      ok: false,
      errors: [expect.stringContaining("not accepted")],
    });
  });

  it("B's YTD fact must be the company's reconciled row: tampered cents or a foreign row fail", () => {
    const tampered = synth(Q3);
    const f = tampered.case.facts.find((x) => x.id === "ocf_ytd");
    if (!f) throw new Error("fixture");
    f.cents = -9_000_100;
    expect(ineligible(quarterCandidate(tampered)).reason).toBe("definition_conflict");
    // Same cents, but the locator names another row: not bound.
    const moved = synth(Q3);
    const g = moved.case.facts.find((x) => x.id === "icf_ytd");
    if (g?.kind !== "reported") throw new Error("fixture");
    g.locator = "/facts/us-gaap/OtherTag/units/USD/0";
    expect(ineligible(quarterCandidate(moved)).reason).toBe("definition_conflict");
  });

  it("never mixes companies: other-company packages, or A's case with B's packages", () => {
    const a = synth(Q3);
    const b = synth({ ...Q3, cik: B });
    // Packages of another company under A.
    expect(quarterCandidate({ ...a, sources: b.sources })).toMatchObject({ ok: false });
    // Company B's input (identical tags, layout and values) with A's case: not bound.
    expect(ineligible(quarterCandidate({ ...b, case: a.case })).reason).toBe("definition_conflict");
    // A package mix is refused outright.
    expect(
      quarterCandidate({
        ...a,
        sources: { ...a.sources, packages: [...a.sources.packages, ...b.sources.packages] },
      }),
    ).toMatchObject({ ok: false, errors: [expect.stringContaining("never mix companies")] });
    // B on its own is fine.
    expect(cents(predicted(quarterCandidate(b)), "target_total")).toBe(94_336_957);
  });

  it("a pair B cannot forecast is ineligible for C too", () => {
    const r = ineligible(quarterCandidate(synth({ ...Q3, cutoff: "2031-01-05T00:00:00Z" })));
    expect(r.reason).toBe("baseline_unavailable");
    expect(r.detail).toContain("cutoff must fall inside the target quarter");
  });
});

describe("candidate C input boundary", () => {
  it("never throws on malformed input; returns errors", () => {
    for (const bad of [null, undefined, 1, "x", {}, { sources: 1 }, [] as unknown]) {
      expect(quarterCandidate(bad as QuarterCandidateInput).ok).toBe(false);
    }
    class Box {
      constructor(readonly v: number) {}
    }
    expect(quarterCandidate({ ...synth(Q3), extra: new Box(1) } as never)).toMatchObject({
      ok: false,
      errors: [expect.stringContaining("not a plain object")],
    });
    expect(quarterCandidate({ ...synth(Q3), knowledgeCutoff: "2030-11-10" })).toMatchObject({
      ok: false,
    });
  });

  it("maps any caller throw, even a revoked proxy, to a fixed error", () => {
    const r = Proxy.revocable({}, {});
    r.revoke();
    const throwers: unknown[] = [
      Object.defineProperty({}, "x", {
        enumerable: true,
        get: () => {
          throw r.proxy;
        },
      }),
      Object.defineProperty({}, "x", {
        enumerable: true,
        get: () => {
          throw new Error("boom");
        },
      }),
      r.proxy,
      new Proxy(
        {},
        {
          ownKeys: () => {
            throw r.proxy;
          },
        },
      ),
    ];
    for (const t of throwers) {
      const out = quarterCandidate({ ...synth(Q3), sources: t } as never);
      expect(out).toEqual({
        ok: false,
        errors: ["input could not be read: caller code threw while it was copied"],
      });
    }
  });

  it("reads each caller property once and never mutates the input", () => {
    const input = synth(Q3);
    const fact = input.case.facts.find((f) => f.id === "ocf_ytd");
    if (!fact) throw new Error("fixture");
    let reads = 0;
    Object.defineProperty(fact, "cents", {
      enumerable: true,
      get: () => {
        reads += 1;
        return reads === 1 ? -9_000_000 : 0;
      },
    });
    const shared = { ...input, again: fact };
    expect(cents(predicted(quarterCandidate(shared)), "target_total")).toBe(94_336_957);
    expect(reads).toBe(1);
    const plain = synth(Q3);
    const before = JSON.stringify(plain);
    predicted(quarterCandidate(plain));
    expect(JSON.stringify(plain)).toBe(before);
  });

  it("does not depend on property, record or package order", () => {
    const a = synth(Q3);
    const b = Object.fromEntries(Object.entries(synth(Q3)).reverse()) as QuarterCandidateInput;
    const [pkg] = b.sources.packages;
    if (!pkg) throw new Error("fixture");
    // A byte-identical copy at another URL is one origin; reversed package order and records.
    const copy = {
      ...pkg,
      id: "synthetic-mirror",
      originalUrl: "https://mirror.example.test/a.json",
    };
    b.sources = {
      ...b.sources,
      packages: [{ ...copy, records: [...copy.records].reverse() }, pkg],
    };
    const ca = predicted(quarterCandidate(a));
    const cb = predicted(quarterCandidate(b));
    expect(cb.forecast).toEqual(ca.forecast);
    expect(cb.lastQuarter.operating.cents).toBe(ca.lastQuarter.operating.cents);
  });
});

// ---------- REAL development package: Amplitude, Inc. (data/evaluation/development) ----------

describe("development package: Amplitude 2022Q4 target (real SEC companyfacts, read-only)", () => {
  const dir = new URL("../../../data/evaluation/development/raw/", import.meta.url);
  const AMPLITUDE = "0001866692";
  // Protocol origin: acceptance of the Q3 2022 10-Q 0000950170-22-021850.
  const cutoff = "2022-11-03T20:08:14.000Z";

  const build = async (): Promise<QuarterCandidateInput> => {
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
        sourceSignature: SIG,
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
    return {
      ...roles,
      case: { ...roles.case, assumptions: [zero("financing"), zero("fx")] },
      financingAssumptionId: "financing",
      fxAssumptionId: "fx",
      cik: AMPLITUDE,
      sources: {
        packages: [source.package],
        sourceSignature: SIG,
        reconciliationId: "amp-rec",
        computedAt: "2026-10-24T12:00:00Z",
      },
    };
  };

  it("C from source rows through L1 snapshot and its own L2 reconciliation, hand-derived", async () => {
    const input = await build();
    const c = predicted(quarterCandidate(input));
    // Source rows (USD dollars, accession, acceptance):
    //   total cash 2022-09-30 248,100,000 and usable 247,248,000 (22-021850, 2022-11-03T20:08:14Z)
    //   OCF 9M -786,000; ICF 9M -64,641,000 (22-021850)
    //   OCF H1 2,353,000; ICF H1 -3,788,000 (22-014805, 2022-08-04T20:35:56Z)
    // Q3 OCF = -786,000 - 2,353,000 = -3,139,000; Q3 ICF = -64,641,000 + 3,788,000 = -60,853,000
    expect(c.lastQuarter.operating.cents).toBe(-313_900_000);
    expect(c.lastQuarter.operating.priorCents).toBe(235_300_000);
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
    expect(c.resolutionIds).toHaveLength(4);
    expect(c.resolutionIds.every((id) => id.startsWith("amp-rec/rec/"))).toBe(true);
    expect(quarterBridge(input).forecast).toEqual(c.baseline.forecast);
  });

  it("a tampered baseline YTD fact (ids intact) is not bound to the real row", async () => {
    const input = await build();
    const f = input.case.facts.find((x) => x.id === input.operatingYtdFactId);
    if (!f) throw new Error("fixture");
    f.cents = 0;
    expect(ineligible(quarterCandidate(input)).reason).toBe("definition_conflict");
  });
});

it("is exported from the engine index", () => {
  expect(engineIndex.quarterCandidate).toBe(quarterCandidate);
  expect(engineIndex.QUARTER_CANDIDATE_METHOD).toBe(QUARTER_CANDIDATE_METHOD);
});
