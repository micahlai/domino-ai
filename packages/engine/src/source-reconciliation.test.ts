import {
  type LearnedRuleVersion,
  type ObservationKey,
  ObservationKeySchema,
  ReconciliationReceiptSchema,
  type SourcePackage,
  SourcePackageSchema,
} from "@domino/contracts";
import { describe, expect, it } from "vitest";
import * as engineIndex from "./index";
import { readSecSource } from "./source-normalization";
import {
  CASH_TERMS,
  type CashTerm,
  type ConflictResolution,
  type KeyOutcome,
  type ReconcileArgs,
  type ReconciledValue,
  type Reconciliation,
  cashIdentity,
  keyDifference,
  quarterFlow,
  reconcileSources,
  valueFor,
} from "./source-reconciliation";

type Fs = { readFileSync(path: URL): Uint8Array };
const fs = (
  globalThis as unknown as { process: { getBuiltinModule(id: "node:fs"): Fs } }
).process.getBuiltinModule("node:fs");

function unwrap<T>(r: { ok: true; value: T } | { ok: false; errors: string[] }): T {
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.value;
}

// ---------- SYNTHETIC fixtures: invented company, invented filings, labelled as such ----------

const CIK = "0000000001";
const ORIG = "0000000001-22-000001"; // SYNTHETIC 10-Q for 2022-09-30, accepted 2022-11-03
const LATER = "0000000001-23-000001"; // SYNTHETIC 10-Q for 2023-09-30 with 2022 comparatives
const AMEND = "0000000001-23-000002"; // SYNTHETIC 10-Q/A amending ORIG, accepted 2023-01-10
const ANNUAL = "0000000001-22-000000"; // SYNTHETIC 10-K for 2021-12-31, accepted 2022-02-16
const FILINGS: SourcePackage["accessions"] = [
  {
    accession: ANNUAL,
    form: "10-K",
    acceptedAt: "2022-02-16T21:00:00.000Z",
    reportPeriod: { kind: "instant", date: "2021-12-31" },
  },
  {
    accession: ORIG,
    form: "10-Q",
    acceptedAt: "2022-11-03T20:00:00.000Z",
    reportPeriod: { kind: "instant", date: "2022-09-30" },
  },
  {
    accession: AMEND,
    form: "10-Q/A",
    acceptedAt: "2023-01-10T20:00:00.000Z",
    reportPeriod: { kind: "instant", date: "2022-09-30" },
    amends: ORIG,
  },
  {
    accession: LATER,
    form: "10-Q",
    acceptedAt: "2023-11-07T20:00:00.000Z",
    reportPeriod: { kind: "instant", date: "2023-09-30" },
  },
];
const TOTAL = "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents";
const USABLE = "CashAndCashEquivalentsAtCarryingValue";
const OCF = "NetCashProvidedByUsedInOperatingActivities";
const ICF = "NetCashProvidedByUsedInInvestingActivities";
const FCF = "NetCashProvidedByUsedInFinancingActivities";
const Q3_END = { kind: "instant", date: "2022-09-30" } as const;
const YTD_9M = { kind: "duration", start: "2022-01-01", end: "2022-09-30" } as const;

type Row = {
  tag: string;
  accession: string;
  raw: string;
  period: SourcePackage["records"][0]["period"];
};
/** A SYNTHETIC package. Row ids follow L1's "us-gaap:<tag>:USD:<index>" form. */
function synthetic(id: string, rows: Row[], opts: { hash?: string; retrievedAt?: string } = {}) {
  const counts = new Map<string, number>();
  return SourcePackageSchema.parse({
    schemaVersion: 1,
    id,
    format: "sec_companyfacts_v1",
    provenance: "synthetic_fixture",
    company: { cik: CIK, name: "SYNTHETIC Test Co" },
    originalUrl: `https://example.test/${id}.json`,
    retrievedAt: opts.retrievedAt ?? "2026-10-24T00:00:00Z",
    rawContentHash: opts.hash ?? "a".repeat(64),
    submissionsContentHash: "b".repeat(64),
    accessions: FILINGS,
    records: rows.map((r) => {
      const n = counts.get(r.tag) ?? 0;
      counts.set(r.tag, n + 1);
      return {
        id: `us-gaap:${r.tag}:USD:${n}`,
        accession: r.accession,
        taxonomy: "us-gaap",
        tag: r.tag,
        unit: "USD",
        pointer: `/facts/us-gaap/${r.tag}/units/USD/${n}`,
        rawValue: r.raw,
        period: r.period,
      };
    }),
  });
}

const METRIC: Record<string, ObservationKey["metric"]> = {
  [TOTAL]: "cash_including_restricted",
  [USABLE]: "cash_and_equivalents",
  [OCF]: "operating_cash_flow",
  [ICF]: "investing_cash_flow",
  [FCF]: "financing_cash_flow",
};
const keyOf = (tag: string, period: ObservationKey["period"], cik = CIK): ObservationKey =>
  ObservationKeySchema.parse({
    cik,
    scope: "consolidated",
    metric: METRIC[tag],
    definition: `us-gaap:${tag}@1`,
    currency: "USD",
    period,
  });

const BASE: Omit<ReconcileArgs, "packages"> = {
  id: "run1",
  cutoff: "2026-10-24T00:00:00Z",
  computedAt: "2026-10-24T12:00:00Z",
  sourceSignature: "sec_companyfacts_v1",
};
const run = (packages: SourcePackage[], extra: Partial<ReconcileArgs> = {}) =>
  unwrap(reconcileSources({ ...BASE, packages, ...extra }));
const entry = (rec: Reconciliation, key: ObservationKey) =>
  rec.keys.find((k) => keyDifference(k.key, key) === "same");
const selected = (rec: Reconciliation, key: ObservationKey): ReconciledValue => {
  const o = valueFor(rec, key);
  if (o.status !== "selected") throw new Error(`blocked: ${o.detail}`);
  return o.value;
};

describe("agreement and duplicates", () => {
  it("SYNTHETIC: two distinct filings with the same value corroborate", () => {
    const rec = run([
      synthetic("p1", [
        { tag: TOTAL, accession: ORIG, raw: "248100000", period: Q3_END },
        { tag: TOTAL, accession: LATER, raw: "248100000", period: Q3_END },
      ]),
    ]);
    const k = entry(rec, keyOf(TOTAL, Q3_END));
    expect(k?.receipt?.classification).toBe("corroborated");
    expect(k?.receipt?.outcome).toEqual({
      kind: "selected",
      selectedIds: [`p1/obs/us-gaap:${TOTAL}:USD:0`, `p1/obs/us-gaap:${TOTAL}:USD:1`],
      authority: {
        kind: "deterministic_method",
        methodId: "source-reconciliation",
        version: "1.0.0",
      },
    });
    // Source row "248100000" dollars -> 24810000000 cents.
    expect(k?.value?.cents).toBe(24_810_000_000);
    // Latest candidate availability, not the computation time.
    expect(k?.receipt?.sourceAvailableAt).toBe("2023-11-07T20:00:00.000Z");
    expect(k?.receipt?.eligibleAt).toBe("2023-11-07T20:00:00.000Z");
    expect(k?.receipt?.recordedAt).toBe(BASE.computedAt);
    expect(() => ReconciliationReceiptSchema.parse(k?.receipt)).not.toThrow();
  });

  it("SYNTHETIC: the same filing seen through two URLs is a duplicate, one origin", () => {
    const rows: Row[] = [{ tag: TOTAL, accession: ORIG, raw: "248100000", period: Q3_END }];
    const rec = run([synthetic("url-a", rows), synthetic("url-b", rows)]);
    const k = entry(rec, keyOf(TOTAL, Q3_END));
    expect(k?.receipt?.classification).toBe("duplicate");
    expect(k?.candidates.map((c) => c.originalUrl)).toEqual([
      "https://example.test/url-a.json",
      "https://example.test/url-b.json",
    ]);
    expect(k?.receipt?.rationale).toContain("one origin is one vote");
  });

  it("SYNTHETIC: two copies of one origin do not outvote a distinct origin (no majority)", () => {
    const shared: Row[] = [{ tag: TOTAL, accession: ORIG, raw: "248100000", period: Q3_END }];
    const rec = run([
      synthetic("url-a", shared),
      synthetic("url-b", shared),
      synthetic("p-later", [{ tag: TOTAL, accession: LATER, raw: "248100500", period: Q3_END }], {
        hash: "c".repeat(64),
      }),
    ]);
    const k = entry(rec, keyOf(TOTAL, Q3_END));
    expect(k?.receipt?.classification).toBe("conflict");
    expect(k?.receipt?.outcome.kind).toBe("blocked");
    expect(k?.value).toBeUndefined();
    expect(k?.receipt?.candidateIds).toHaveLength(3);
    expect(k?.receipt?.rationale).toContain("3 candidates from 2 origins disagree");
  });

  it("SYNTHETIC: never prefers the later retrieval of the same filing", () => {
    const early = synthetic(
      "retrieved-2023",
      [{ tag: TOTAL, accession: ORIG, raw: "248100000", period: Q3_END }],
      { retrievedAt: "2023-12-01T00:00:00Z", hash: "1".repeat(64) },
    );
    const late = synthetic(
      "retrieved-2026",
      [{ tag: TOTAL, accession: ORIG, raw: "248100001", period: Q3_END }],
      { retrievedAt: "2026-10-01T00:00:00Z", hash: "2".repeat(64) },
    );
    const o = valueFor(run([early, late]), keyOf(TOTAL, Q3_END));
    expect(o).toMatchObject({ status: "blocked", reason: "unresolved_conflict" });
  });
});

describe("non-comparable keys", () => {
  const JUN = { kind: "instant", date: "2022-06-30" } as const;

  it("SYNTHETIC: distinct dates are a timing difference, never a conflict", () => {
    const rec = run([
      synthetic("p1", [
        { tag: TOTAL, accession: ORIG, raw: "310875000", period: JUN },
        { tag: TOTAL, accession: ORIG, raw: "248100000", period: Q3_END },
      ]),
    ]);
    expect(keyDifference(keyOf(TOTAL, JUN), keyOf(TOTAL, Q3_END))).toBe("timing");
    expect(rec.keys.map((k) => k.receipt?.classification)).toEqual(["single", "single"]);
    expect(selected(rec, keyOf(TOTAL, JUN)).cents).toBe(31_087_500_000);
    expect(selected(rec, keyOf(TOTAL, Q3_END)).cents).toBe(24_810_000_000);
  });

  it("SYNTHETIC: total vs usable cash and YTD vs quarter are definition/period differences", () => {
    const quarter = { kind: "duration", start: "2022-07-01", end: "2022-09-30" } as const;
    const rec = run([
      synthetic("p1", [
        { tag: TOTAL, accession: ORIG, raw: "248100000", period: Q3_END },
        { tag: USABLE, accession: ORIG, raw: "247248000", period: Q3_END },
        { tag: OCF, accession: ORIG, raw: "-786000", period: YTD_9M },
        { tag: OCF, accession: ORIG, raw: "-3139000", period: quarter },
      ]),
    ]);
    expect(keyDifference(keyOf(TOTAL, Q3_END), keyOf(USABLE, Q3_END))).toBe("definition");
    expect(keyDifference(keyOf(OCF, YTD_9M), keyOf(OCF, quarter))).toBe("period");
    expect(keyDifference(keyOf(TOTAL, Q3_END), keyOf(TOTAL, Q3_END, "0000000002"))).toBe("company");
    expect(rec.keys).toHaveLength(4);
    expect(rec.keys.every((k) => k.receipt?.classification === "single")).toBe(true);
  });

  it("a segment-scoped key cannot be built, so segment values are never compared", () => {
    expect(
      ObservationKeySchema.safeParse({ ...keyOf(TOTAL, Q3_END), scope: "segment" }).success,
    ).toBe(false);
  });
});

describe("exact cents (no rounding tolerance)", () => {
  // SYNTHETIC: ORIG reports exact dollars; LATER may present the comparative in thousands.
  const pair = (orig: string, later: string) => [
    synthetic("p1", [
      { tag: TOTAL, accession: ORIG, raw: orig, period: Q3_END },
      { tag: TOTAL, accession: LATER, raw: later, period: Q3_END },
    ]),
  ];
  const ids = [`p1/obs/us-gaap:${TOTAL}:USD:0`, `p1/obs/us-gaap:${TOTAL}:USD:1`];

  it("SYNTHETIC: a rounding-sized difference is a conflict that blocks", () => {
    // $248,100,123 vs $248,100,000: $123 apart. companyfacts has no XBRL decimals, so no
    // rounding precision is authenticated and the cents must match exactly.
    const rec = run(pair("248100123", "248100000"));
    const k = entry(rec, keyOf(TOTAL, Q3_END));
    expect(k?.receipt?.classification).toBe("conflict");
    expect(valueFor(rec, keyOf(TOTAL, Q3_END))).toMatchObject({
      status: "blocked",
      reason: "unresolved_conflict",
    });
    // Even a one-cent difference blocks.
    expect(valueFor(run(pair("248100000.01", "248100000")), keyOf(TOTAL, Q3_END)).status).toBe(
      "blocked",
    );
  });

  it("SYNTHETIC: an accepted dated resolution can still select one of the values", () => {
    const k = entry(
      run(pair("248100123", "248100000"), {
        resolutions: [
          {
            id: "res-exact",
            userId: "user1",
            status: "accepted",
            key: keyOf(TOTAL, Q3_END),
            consideredIds: ids,
            selectedIds: [ids[0] as string],
            recordedAt: "2024-01-05T00:00:00Z",
            effectiveFrom: "2024-01-05T00:00:00Z",
          },
        ],
      }),
      keyOf(TOTAL, Q3_END),
    );
    expect(k?.receipt?.outcome).toMatchObject({
      kind: "selected",
      authority: { kind: "user_resolution", userId: "user1" },
    });
    // Source row "248100123" dollars -> 24810012300 cents.
    expect(k?.value?.cents).toBe(24_810_012_300);
    expect(k?.value?.availableAt).toBe("2023-11-07T20:00:00.000Z");
    expect(k?.value?.eligibleAt).toBe("2024-01-05T00:00:00Z");
  });

  it("caller-supplied rounding disclosures are refused, not silently applied", () => {
    // The audit forgery: an unverifiable locator would have turned $1,000 vs $1,001 into a
    // deterministic selection. It is now an input error.
    const args = {
      ...BASE,
      packages: pair("1000", "1001"),
      roundings: [{ accession: ORIG, unitCents: 1000, locator: "/does/not/exist" }],
    } as ReconcileArgs;
    expect(reconcileSources(args)).toMatchObject({ ok: false });
    expect(valueFor(run(pair("1000", "1001")), keyOf(TOTAL, Q3_END)).status).toBe("blocked");
  });
});

describe("conflicts, amendments and decisions", () => {
  // SYNTHETIC: the 10-Q/A restates ORIG's 2022-09-30 total cash from $248,100,000 to $247,900,000.
  const rows: Row[] = [
    { tag: TOTAL, accession: ORIG, raw: "248100000", period: Q3_END },
    { tag: TOTAL, accession: AMEND, raw: "247900000", period: Q3_END },
    { tag: USABLE, accession: ORIG, raw: "247248000", period: Q3_END },
  ];
  const pkg = synthetic("p1", rows);
  const totalKey = keyOf(TOTAL, Q3_END);
  const rule = (over: Partial<LearnedRuleVersion> = {}): LearnedRuleVersion => ({
    id: "rule-v1",
    ruleId: "rule",
    version: 1,
    feedbackId: "fb1",
    scope: { kind: "company", cik: CIK, schemaVersion: 1, sourceSignature: "sec_companyfacts_v1" },
    action: {
      kind: "authority_preference",
      metric: "cash_including_restricted",
      prefer: "latest_amendment",
    },
    rationale: "SYNTHETIC test rule",
    evidenceRefs: ["SYNTHETIC"],
    status: "accepted",
    validatorVersion: "1.0.0",
    recordedAt: "2023-02-01T00:00:00Z",
    effectiveFrom: "2023-02-01T00:00:00Z",
    ...over,
  });
  const resolution = (over: Partial<ConflictResolution> = {}): ConflictResolution => ({
    id: "res1",
    userId: "user1",
    status: "accepted",
    key: totalKey,
    consideredIds: [`p1/obs/us-gaap:${TOTAL}:USD:0`, `p1/obs/us-gaap:${TOTAL}:USD:1`],
    selectedIds: [`p1/obs/us-gaap:${TOTAL}:USD:0`],
    recordedAt: "2023-03-01T00:00:00Z",
    effectiveFrom: "2023-03-01T00:00:00Z",
    ...over,
  });

  it("an amendment accepted after the cutoff is ineligible and kept as lineage", () => {
    const rec = run([pkg], { cutoff: "2022-12-15T00:00:00-05:00" });
    const k = entry(rec, totalKey);
    expect(k?.receipt?.classification).toBe("single");
    expect(k?.value?.cents).toBe(24_810_000_000);
    expect(k?.excluded).toMatchObject([
      { id: `p1/obs/us-gaap:${TOTAL}:USD:1`, accession: AMEND, reason: "after_cutoff" },
    ]);
    expect(k?.receipt?.candidateIds).toEqual([`p1/obs/us-gaap:${TOTAL}:USD:0`]);
    expect(k?.receipt?.eligibleAt).toBe("2022-11-03T20:00:00.000Z");
    expect(k?.receipt?.rationale).toContain("(after_cutoff)");
  });

  it("once eligible, the amendment is a separate dated source that conflicts and blocks", () => {
    const rec = run([pkg]);
    const k = entry(rec, totalKey);
    expect(k?.receipt).toMatchObject({
      classification: "conflict",
      outcome: { kind: "blocked" },
      eligibleAt: "2023-01-10T20:00:00.000Z",
    });
    expect(valueFor(rec, totalKey)).toMatchObject({
      status: "blocked",
      reason: "unresolved_conflict",
    });
    // The blocked total does not block the unrelated usable-cash key.
    expect(selected(rec, keyOf(USABLE, Q3_END)).cents).toBe(24_724_800_000);
  });

  it("an applicable dated authority rule selects; eligibility is the latest of the three times", () => {
    const k = entry(run([pkg], { rules: [rule()] }), totalKey);
    expect(k?.receipt?.classification).toBe("conflict");
    expect(k?.receipt?.outcome).toEqual({
      kind: "selected",
      selectedIds: [`p1/obs/us-gaap:${TOTAL}:USD:1`],
      authority: { kind: "authority_rule", ruleVersionId: "rule-v1" },
    });
    expect(k?.value?.cents).toBe(24_790_000_000);
    expect(k?.value?.availableAt).toBe("2023-01-10T20:00:00.000Z");
    expect(k?.receipt?.eligibleAt).toBe("2023-02-01T00:00:00Z");
    expect(k?.value?.eligibleAt).toBe("2023-02-01T00:00:00Z");
    const orig = entry(
      run([pkg], {
        rules: [
          rule({
            action: {
              kind: "authority_preference",
              metric: "cash_including_restricted",
              prefer: "original_filing",
            },
          }),
        ],
      }),
      totalKey,
    );
    expect(orig?.value?.cents).toBe(24_810_000_000);
  });

  it("a rule recorded after the cutoff, out of scope, or for another metric does not apply", () => {
    const cutoff = "2023-06-01T00:00:00Z";
    const blocked = (rules: LearnedRuleVersion[]) =>
      valueFor(run([pkg], { cutoff, rules }), totalKey).status;
    expect(
      blocked([
        rule({ recordedAt: "2023-07-01T00:00:00Z", effectiveFrom: "2023-07-01T00:00:00Z" }),
      ]),
    ).toBe("blocked");
    expect(
      blocked([
        rule({
          scope: {
            kind: "company",
            cik: "0000000002",
            schemaVersion: 1,
            sourceSignature: "sec_companyfacts_v1",
          },
        }),
      ]),
    ).toBe("blocked");
    expect(
      blocked([
        rule({
          action: {
            kind: "authority_preference",
            metric: "cash_and_equivalents",
            prefer: "latest_amendment",
          },
        }),
      ]),
    ).toBe("blocked");
    expect(blocked([rule({ status: "rejected" })])).toBe("blocked");
    expect(blocked([rule()])).toBe("selected");
    const k = entry(
      run([pkg], {
        cutoff,
        rules: [
          rule({ recordedAt: "2023-07-01T00:00:00Z", effectiveFrom: "2023-07-01T00:00:00Z" }),
        ],
      }),
      totalKey,
    );
    expect(k?.receipt?.rationale).toContain("rule rule-v1 not applied: after_cutoff");
  });

  it("two applicable decisions block instead of depending on order", () => {
    const rules = [
      rule(),
      rule({
        id: "rule2-v1",
        ruleId: "rule2",
        action: {
          kind: "authority_preference",
          metric: "cash_including_restricted",
          prefer: "original_filing",
        },
      }),
    ];
    expect(valueFor(run([pkg], { rules }), totalKey).status).toBe("blocked");
    expect(
      valueFor(run([pkg], { rules: [rule()], resolutions: [resolution()] }), totalKey).status,
    ).toBe("blocked");
  });

  it("an accepted user resolution selects; rejected, stale or late ones do not", () => {
    const k = entry(run([pkg], { resolutions: [resolution()] }), totalKey);
    expect(k?.receipt?.outcome).toMatchObject({
      kind: "selected",
      authority: { kind: "user_resolution", userId: "user1" },
    });
    expect(k?.value?.cents).toBe(24_810_000_000);
    expect(k?.receipt?.eligibleAt).toBe("2023-03-01T00:00:00Z");
    const status = (r: ConflictResolution, cutoff = BASE.cutoff) =>
      valueFor(run([pkg], { cutoff, resolutions: [r] }), totalKey).status;
    expect(status(resolution({ status: "rejected" }))).toBe("blocked");
    expect(status(resolution({ consideredIds: [`p1/obs/us-gaap:${TOTAL}:USD:0`] }))).toBe(
      "blocked",
    );
    expect(status(resolution(), "2023-02-01T00:00:00Z")).toBe("blocked");
    expect(
      status(
        resolution({
          selectedIds: [`p1/obs/us-gaap:${TOTAL}:USD:0`, `p1/obs/us-gaap:${TOTAL}:USD:1`],
        }),
      ),
    ).toBe("blocked");
  });
});

describe("YTD subtraction", () => {
  const H1 = { kind: "duration", start: "2022-01-01", end: "2022-06-30" } as const;
  const rows: Row[] = [
    { tag: OCF, accession: ORIG, raw: "-786000", period: YTD_9M },
    { tag: OCF, accession: ANNUAL, raw: "2353000", period: H1 },
    { tag: ICF, accession: ANNUAL, raw: "-3788000", period: H1 },
  ];
  const rec = run([synthetic("p1", rows)]);

  it("SYNTHETIC: matching start, scope, currency and definition derive the quarter", () => {
    const q = unwrap(quarterFlow(selected(rec, keyOf(OCF, YTD_9M)), selected(rec, keyOf(OCF, H1))));
    // -786000 - 2353000 = -3139000 dollars -> -313900000 cents for 2022-07-01..2022-09-30.
    expect(q.cents).toBe(-313_900_000);
    expect(q.key.period).toEqual({ kind: "duration", start: "2022-07-01", end: "2022-09-30" });
    expect(q.receiptIds).toHaveLength(2);
    expect(q.observationIds).toEqual([
      `p1/obs/us-gaap:${OCF}:USD:0`,
      `p1/obs/us-gaap:${OCF}:USD:1`,
    ]);
    expect(q.availableAt).toBe("2022-11-03T20:00:00.000Z");
  });

  it("incompatible YTD inputs are rejected", () => {
    const ytd = selected(rec, keyOf(OCF, YTD_9M));
    const h1 = selected(rec, keyOf(OCF, H1));
    // Different definition (investing vs operating).
    expect(quarterFlow(ytd, selected(rec, keyOf(ICF, H1))).ok).toBe(false);
    // Different start (fiscal year mismatch).
    const shifted = {
      ...h1,
      key: {
        ...h1.key,
        period: { kind: "duration" as const, start: "2021-10-01", end: "2022-06-30" },
      },
    };
    expect(quarterFlow(ytd, shifted).ok).toBe(false);
    // Different currency.
    expect(quarterFlow(ytd, { ...h1, key: { ...h1.key, currency: "EUR" } }).ok).toBe(false);
    // Different dictionary version of the same tag.
    expect(quarterFlow(ytd, { ...h1, key: { ...h1.key, definition: `us-gaap:${OCF}@2` } }).ok).toBe(
      false,
    );
    // Prior must end first.
    expect(quarterFlow(h1, ytd).ok).toBe(false);
    expect(quarterFlow(ytd, ytd).ok).toBe(false);
  });
});

describe("cash identity", () => {
  const BEGIN = { kind: "instant", date: "2021-12-31" } as const;
  const fx = (cents: number): KeyOutcome => ({
    status: "selected",
    value: {
      // SYNTHETIC FX term: the dictionary has no FX tag, so this is a test input.
      key: ObservationKeySchema.parse({
        cik: CIK,
        scope: "consolidated",
        metric: "fx_effect_on_cash",
        definition: "SYNTHETIC:fx@1",
        currency: "USD",
        period: YTD_9M,
      }),
      cents,
      availableAt: "2022-11-03T20:00:00.000Z",
      eligibleAt: "2022-11-03T20:00:00.000Z",
      receiptIds: ["SYNTHETIC-fx"],
      observationIds: ["SYNTHETIC-fx"],
    },
  });
  const terms = (rec: Reconciliation, fxTerm: KeyOutcome): Record<CashTerm, KeyOutcome> => ({
    beginning: valueFor(rec, keyOf(TOTAL, BEGIN)),
    operating: valueFor(rec, keyOf(OCF, YTD_9M)),
    investing: valueFor(rec, keyOf(ICF, YTD_9M)),
    financing: valueFor(rec, keyOf(FCF, YTD_9M)),
    fx: fxTerm,
    ending: valueFor(rec, keyOf(TOTAL, Q3_END)),
  });
  const book = (ending: string, values = ["1000000.00", "-250000.25", "-100000.50", "40000"]) =>
    synthetic("p1", [
      { tag: TOTAL, accession: ANNUAL, raw: values[0] as string, period: BEGIN },
      { tag: OCF, accession: ORIG, raw: values[1] as string, period: YTD_9M },
      { tag: ICF, accession: ORIG, raw: values[2] as string, period: YTD_9M },
      { tag: FCF, accession: ORIG, raw: values[3] as string, period: YTD_9M },
      { tag: TOTAL, accession: ORIG, raw: ending, period: Q3_END },
    ]);

  it("SYNTHETIC: ties exactly with hand-derived cents", () => {
    // 1,000,000.00 - 250,000.25 - 100,000.50 + 40,000.00 - 1,234.56 = 688,764.69 dollars.
    const r = unwrap(cashIdentity(terms(run([book("688764.69")]), fx(-123_456))));
    expect(r).toMatchObject({
      status: "ties",
      computedEndingCents: "68876469",
      reportedEndingCents: "68876469",
      differenceCents: "0",
    });
    if (r.status === "blocked") return;
    expect(r.receiptIds).toHaveLength(6);
    expect(r.availableAt).toBe("2022-11-03T20:00:00.000Z");
  });

  it("SYNTHETIC: one cent off breaks", () => {
    const r = unwrap(cashIdentity(terms(run([book("688764.70")]), fx(-123_456))));
    expect(r).toMatchObject({ status: "breaks", differenceCents: "-1" });
  });

  it("SYNTHETIC: terms presented in thousands get no tolerance", () => {
    // 1,000,000 - 250,000 - 100,000 + 40,000 - 1,000 = 689,000 computed vs 692,000 reported:
    // -3,000 dollars = -300000 cents. Under the removed rounding bound this tied; now it breaks.
    const values = ["1000000", "-250000", "-100000", "40000"];
    const r = unwrap(cashIdentity(terms(run([book("692000", values)]), fx(-100_000))));
    expect(r).toMatchObject({
      status: "breaks",
      computedEndingCents: "68900000",
      differenceCents: "-300000",
    });
    const exact = unwrap(cashIdentity(terms(run([book("689000", values)]), fx(-100_000))));
    expect(exact).toMatchObject({ status: "ties", differenceCents: "0" });
  });

  it("SYNTHETIC: an unresolved used term blocks the identity; it is never zero", () => {
    const rec = run([
      book("688764.69"),
      synthetic("p2", [{ tag: FCF, accession: LATER, raw: "40001", period: YTD_9M }], {
        hash: "d".repeat(64),
      }),
    ]);
    const r = unwrap(cashIdentity(terms(rec, fx(-123_456))));
    expect(r).toMatchObject({
      status: "blocked",
      blocked: [{ term: "financing", reason: "unresolved_conflict" }],
    });
    // Unrelated terms still resolve.
    expect(valueFor(rec, keyOf(OCF, YTD_9M)).status).toBe("selected");
  });

  it("SYNTHETIC: rejects mismatched periods or metrics", () => {
    const t = terms(run([book("688764.69")]), fx(-123_456));
    const wrongFx: KeyOutcome = fx(-123_456);
    if (wrongFx.status === "selected")
      wrongFx.value.key = {
        ...wrongFx.value.key,
        period: { kind: "duration", start: "2022-07-01", end: "2022-09-30" },
      };
    expect(cashIdentity({ ...t, fx: wrongFx }).ok).toBe(false);
    expect(cashIdentity({ ...t, ending: t.beginning, beginning: t.ending }).ok).toBe(false);
    expect(cashIdentity({ ...t, operating: t.investing }).ok).toBe(false);
    const { fx: _omit, ...partial } = t;
    expect(cashIdentity(partial as Record<CashTerm, KeyOutcome>).ok).toBe(false);
    expect(CASH_TERMS).toHaveLength(6);
  });
});

describe("order independence", () => {
  it("SYNTHETIC: permuting packages, rows and resolutions changes nothing", () => {
    const rows: Row[] = [
      { tag: TOTAL, accession: ORIG, raw: "248100000", period: Q3_END },
      { tag: TOTAL, accession: AMEND, raw: "247900000", period: Q3_END },
      { tag: TOTAL, accession: LATER, raw: "247900000", period: Q3_END },
      { tag: USABLE, accession: ORIG, raw: "247248123", period: Q3_END },
      { tag: USABLE, accession: LATER, raw: "247248000", period: Q3_END },
      { tag: OCF, accession: ORIG, raw: "-786000", period: YTD_9M },
    ];
    const a = synthetic("pa", rows);
    const b = synthetic("pb", rows.slice(0, 2), { hash: "e".repeat(64) });
    const reversed = { ...a, records: [...a.records].reverse() };
    const res: ConflictResolution = {
      id: "r1",
      userId: "u1",
      status: "rejected",
      key: keyOf(TOTAL, Q3_END),
      consideredIds: [],
      selectedIds: ["x"],
      recordedAt: "2023-03-01T00:00:00Z",
      effectiveFrom: "2023-03-01T00:00:00Z",
    };
    const res2 = { ...res, id: "r2", status: "accepted" as const };
    const one = run([a, b], { resolutions: [res, res2] });
    const two = run([b, reversed], {
      resolutions: [res2, res],
    });
    expect(two).toEqual(one);
    expect(JSON.stringify(two)).toBe(JSON.stringify(one));
    expect(entry(one, keyOf(USABLE, Q3_END))?.receipt?.classification).toBe("conflict");
    expect(entry(one, keyOf(TOTAL, Q3_END))?.receipt?.classification).toBe("conflict");
  });
});

describe("input validation", () => {
  const p = synthetic("p1", [{ tag: TOTAL, accession: ORIG, raw: "1", period: Q3_END }]);

  it("rejects duplicate package ids and inconsistent filing metadata", () => {
    expect(reconcileSources({ ...BASE, packages: [p, p] }).ok).toBe(false);
    const forged = SourcePackageSchema.parse({
      ...p,
      id: "p2",
      accessions: p.accessions.map((f) =>
        f.accession === ORIG ? { ...f, acceptedAt: "2022-10-01T00:00:00.000Z" } : f,
      ),
    });
    expect(reconcileSources({ ...BASE, packages: [p, forged] })).toMatchObject({ ok: false });
  });

  it("rejects bad times, empty packages and non-plain input", () => {
    const bad = (extra: Partial<ReconcileArgs>) =>
      reconcileSources({ ...BASE, packages: [p], ...extra }).ok;
    expect(bad({ cutoff: "2022-12-15" })).toBe(false);
    expect(bad({ packages: [] })).toBe(false);
    const withFunction = { ...p, extra: () => 1 } as unknown as SourcePackage;
    expect(bad({ packages: [withFunction] })).toBe(false);
  });

  it("a key with only unvalidated rows has no receipt and reports why", () => {
    const eur = SourcePackageSchema.parse({
      ...p,
      records: p.records.map((r) => ({ ...r, unit: "EUR" })),
    });
    const rec = run([eur]);
    expect(rec.keys[0]?.receipt).toBeUndefined();
    expect(valueFor(rec, keyOf(TOTAL, Q3_END))).toMatchObject({
      status: "blocked",
      reason: "missing_input",
    });
    expect(valueFor(rec, keyOf(USABLE, Q3_END))).toMatchObject({ reason: "missing_input" });
    const subcent = SourcePackageSchema.parse({
      ...p,
      records: p.records.map((r) => ({ ...r, rawValue: "1.001" })),
    });
    expect(valueFor(run([subcent]), keyOf(TOTAL, Q3_END))).toMatchObject({
      reason: "unsafe_value",
    });
    expect(
      valueFor(run([p], { cutoff: "2022-11-01T00:00:00Z" }), keyOf(TOTAL, Q3_END)),
    ).toMatchObject({
      reason: "after_cutoff",
    });
  });
});

describe("eligibility ordering and private input snapshots", () => {
  const H1 = { kind: "duration", start: "2022-01-01", end: "2022-06-30" } as const;
  const BEGIN = { kind: "instant", date: "2021-12-31" } as const;
  // SYNTHETIC hand-built values; cents are the Amplitude-shaped -786000 and 2353000 dollars.
  const value = (
    tag: string,
    period: ObservationKey["period"],
    cents: number,
    over: Partial<ReconciledValue> = {},
  ): ReconciledValue => ({
    key: keyOf(tag, period),
    cents,
    availableAt: "2022-11-03T20:00:00Z",
    eligibleAt: "2022-11-03T20:00:00Z",
    receiptIds: [`SYNTHETIC-${tag}`],
    observationIds: [`SYNTHETIC-${tag}`],
    ...over,
  });
  const ytd = value(OCF, YTD_9M, -78_600_000);
  const h1 = value(OCF, H1, 235_300_000);

  it("SYNTHETIC: YTD inputs eligible (2020) before their source (2022) are rejected", () => {
    const back = { eligibleAt: "2020-01-01T00:00:00Z" };
    const r = quarterFlow({ ...ytd, ...back }, { ...h1, ...back });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain("eligibleAt is before availableAt");
    expect(quarterFlow(ytd, { ...h1, ...back }).ok).toBe(false);
  });

  it("SYNTHETIC: derived eligibility is the latest input availability or eligibility", () => {
    const decided = unwrap(quarterFlow({ ...ytd, eligibleAt: "2025-01-01T00:00:00Z" }, h1));
    expect(decided.eligibleAt).toBe("2025-01-01T00:00:00Z");
    expect(decided.availableAt).toBe("2022-11-03T20:00:00Z");
    const laterSource = unwrap(
      quarterFlow(ytd, {
        ...h1,
        availableAt: "2023-01-10T00:00:00Z",
        eligibleAt: "2023-01-10T00:00:00Z",
      }),
    );
    expect(laterSource).toMatchObject({
      availableAt: "2023-01-10T00:00:00Z",
      eligibleAt: "2023-01-10T00:00:00Z",
    });
  });

  it("SYNTHETIC: a cash identity with a backdated term is rejected", () => {
    const sel = (v: ReconciledValue): KeyOutcome => ({ status: "selected", value: v });
    const fxKey = { ...keyOf(OCF, YTD_9M), metric: "fx_effect_on_cash" as const };
    // 1,000.00 - 100.00 + 0.00 + 0.00 - 0.01 = 899.99 dollars.
    const t: Record<CashTerm, KeyOutcome> = {
      beginning: sel(value(TOTAL, BEGIN, 100_000)),
      operating: sel(value(OCF, YTD_9M, -10_000)),
      investing: sel(value(ICF, YTD_9M, 0)),
      financing: sel(value(FCF, YTD_9M, 0)),
      fx: sel({ ...value(OCF, YTD_9M, -1), key: fxKey }),
      ending: sel(value(TOTAL, Q3_END, 89_999)),
    };
    expect(unwrap(cashIdentity(t))).toMatchObject({ status: "ties", differenceCents: "0" });
    const backdated = {
      ...t,
      ending: sel(value(TOTAL, Q3_END, 89_999, { eligibleAt: "2020-01-01T00:00:00Z" })),
    };
    expect(cashIdentity(backdated).ok).toBe(false);
    const decided = {
      ...t,
      ending: sel(value(TOTAL, Q3_END, 89_999, { eligibleAt: "2024-01-01T00:00:00Z" })),
    };
    expect(unwrap(cashIdentity(decided))).toMatchObject({
      status: "ties",
      availableAt: "2022-11-03T20:00:00Z",
      eligibleAt: "2024-01-01T00:00:00Z",
    });
  });

  it("SYNTHETIC: an accessor on a value is read once; validation and arithmetic agree", () => {
    let reads = 0;
    const tricky = {
      ...ytd,
      get cents() {
        reads += 1;
        return reads === 1 ? -78_600_000 : 123;
      },
    };
    // -786000 - 2353000 = -3139000 dollars = -313900000 cents.
    expect(unwrap(quarterFlow(tricky, h1)).cents).toBe(-313_900_000);
    expect(reads).toBe(1);
  });

  it("SYNTHETIC: resolution and nested package accessors are read once", () => {
    const pkg = synthetic("p1", [
      { tag: TOTAL, accession: ORIG, raw: "1000", period: Q3_END },
      { tag: TOTAL, accession: LATER, raw: "1001", period: Q3_END },
    ]);
    const ids = [`p1/obs/us-gaap:${TOTAL}:USD:0`, `p1/obs/us-gaap:${TOTAL}:USD:1`];
    let selReads = 0;
    const res = {
      id: "res1",
      userId: "u1",
      status: "accepted" as const,
      key: keyOf(TOTAL, Q3_END),
      consideredIds: ids,
      get selectedIds() {
        selReads += 1;
        return selReads === 1 ? [ids[0] as string] : [ids[1] as string];
      },
      recordedAt: "2024-01-01T00:00:00Z",
      effectiveFrom: "2024-01-01T00:00:00Z",
    };
    let rawReads = 0;
    const first = pkg.records[0] as SourcePackage["records"][0];
    const records = [
      {
        ...first,
        get rawValue() {
          rawReads += 1;
          return rawReads === 1 ? "1000" : "999999";
        },
      },
      ...pkg.records.slice(1),
    ];
    const rec = run([{ ...pkg, records }], { resolutions: [res] });
    // "1000" dollars -> 100000 cents, from the first (and only) read.
    expect(entry(rec, keyOf(TOTAL, Q3_END))?.value?.cents).toBe(100_000);
    expect(selReads).toBe(1);
    expect(rawReads).toBe(1);
  });

  it("SYNTHETIC: editing caller objects afterwards cannot change a returned result", () => {
    const pkg = synthetic("p1", [{ tag: TOTAL, accession: ORIG, raw: "1000", period: Q3_END }]);
    const rec = run([pkg]);
    const before = JSON.stringify(rec);
    (pkg.records[0] as { rawValue: string }).rawValue = "5";
    (pkg.accessions[1] as { acceptedAt: string }).acceptedAt = "2020-01-01T00:00:00Z";
    expect(JSON.stringify(rec)).toBe(before);
  });
});

// ---------- REAL development package: Amplitude, Inc. (data/evaluation/development) ----------

describe("development package (real SEC companyfacts, read-only)", () => {
  const dir = new URL("../../../data/evaluation/development/raw/", import.meta.url);
  const AMPLITUDE = "0001866692";
  const load = async (id: string, url: string) =>
    unwrap(
      await readSecSource({
        id,
        provenance: "evidence",
        originalUrl: url,
        retrievedAt: "2026-10-24T00:00:00Z",
        companyFacts: fs.readFileSync(new URL("amplitude-companyfacts.json", dir)),
        submissions: fs.readFileSync(new URL("amplitude-submissions.json", dir)),
      }),
    ).source.package;
  const k = (tag: string, period: ObservationKey["period"]) => keyOf(tag, period, AMPLITUDE);
  const DEC21 = { kind: "instant", date: "2021-12-31" } as const;
  const H1 = { kind: "duration", start: "2022-01-01", end: "2022-06-30" } as const;
  const cutoff = "2022-12-15T00:00:00-05:00";

  it("byte-identical payloads from two URLs are one origin; distinct filings corroborate", async () => {
    const a = await load("amp-a", "https://data.sec.gov/api/xbrl/companyfacts/CIK0001866692.json");
    const b = await load("amp-b", "https://mirror.example.test/CIK0001866692.json");
    expect(a.rawContentHash).toBe(b.rawContentHash);
    const rec = run([a, b], { cutoff });
    // TOTAL end 2022-09-30 val 248100000, only accn 0000950170-22-021850 by this cutoff.
    const q3 = entry(rec, k(TOTAL, Q3_END));
    expect(q3?.receipt?.classification).toBe("duplicate");
    expect(q3?.value?.cents).toBe(24_810_000_000);
    expect(q3?.excluded.map((e) => e.accession)).toEqual([
      "0000950170-23-060240",
      "0000950170-23-060240",
    ]);
    // TOTAL end 2021-12-31 val 308295000 in 10-K 22-001372 and 10-Qs 22-007901, 22-014805,
    // 22-021850: four origins, eight copies.
    const dec = entry(rec, k(TOTAL, DEC21));
    expect(dec?.receipt?.classification).toBe("corroborated");
    expect(dec?.candidates).toHaveLength(8);
    expect(new Set(dec?.candidates.map((c) => c.accession)).size).toBe(4);
    expect(dec?.value?.cents).toBe(30_829_500_000);
    expect(run([b, a], { cutoff })).toEqual(rec);
  });

  it("has no conflicting dictionary values across every filing", async () => {
    const rec = run([await load("amp", "https://data.sec.gov/x.json")]);
    expect(rec.keys.length).toBeGreaterThan(100);
    expect(rec.keys.filter((x) => x.receipt?.outcome.kind === "blocked")).toEqual([]);
  });

  it("derives Q3 2022 operating cash flow from two YTD rows", async () => {
    const rec = run([await load("amp", "https://data.sec.gov/x.json")], { cutoff });
    // OCF 2022-01-01..2022-09-30 val -786000 (22-021850, accepted 2022-11-03T20:08:14.000Z)
    // minus 2022-01-01..2022-06-30 val 2353000 (22-014805) = -3139000 dollars.
    const q = unwrap(quarterFlow(selected(rec, k(OCF, YTD_9M)), selected(rec, k(OCF, H1))));
    expect(q.cents).toBe(-313_900_000);
    expect(q.availableAt).toBe("2022-11-03T20:08:14.000Z");
  });

  it("the 9M 2022 identity is blocked on the missing FX line, never zero-filled", async () => {
    const rec = run([await load("amp", "https://data.sec.gov/x.json")], { cutoff });
    // Reported rows: beginning 308295000, OCF -786000, ICF -64641000, FCF 5232000,
    // ending 248100000. No FX tag exists in the package, so the identity cannot be checked.
    const fxKey = ObservationKeySchema.parse({
      ...k(OCF, YTD_9M),
      metric: "fx_effect_on_cash",
      definition:
        "us-gaap:EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents@1",
    });
    const r = unwrap(
      cashIdentity({
        beginning: valueFor(rec, k(TOTAL, DEC21)),
        operating: valueFor(rec, k(OCF, YTD_9M)),
        investing: valueFor(rec, k(ICF, YTD_9M)),
        financing: valueFor(rec, k(FCF, YTD_9M)),
        fx: valueFor(rec, fxKey),
        ending: valueFor(rec, k(TOTAL, Q3_END)),
      }),
    );
    expect(r).toMatchObject({
      status: "blocked",
      blocked: [{ term: "fx", reason: "missing_input" }],
    });
    expect(selected(rec, k(FCF, YTD_9M)).cents).toBe(523_200_000);
    expect(selected(rec, k(ICF, YTD_9M)).cents).toBe(-6_464_100_000);
  });
});

it("is exported from the engine index", () => {
  expect(engineIndex.reconcileSources).toBe(reconcileSources);
  expect(engineIndex.cashIdentity).toBe(cashIdentity);
  expect(engineIndex.quarterFlow).toBe(quarterFlow);
  expect(engineIndex.valueFor).toBe(valueFor);
  expect(engineIndex.keyDifference).toBe(keyDifference);
  expect(engineIndex.SOURCE_RECONCILER.version).toBe("1.0.0");
});
