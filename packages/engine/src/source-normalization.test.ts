import type { HistoricalCase } from "@domino/contracts";
import { describe, expect, it } from "vitest";
import * as engineIndex from "./index";
import { quarterBridge } from "./period";
import {
  type CompanySnapshotResult,
  type QuarterRole,
  type ReadSecSource,
  type SecSource,
  companySnapshot,
  readSecSource,
} from "./source-normalization";

type Fs = { readFileSync(path: URL, encoding?: "utf8"): Uint8Array & string };
const fs = (
  globalThis as unknown as { process: { getBuiltinModule(id: "node:fs"): Fs } }
).process.getBuiltinModule("node:fs");
const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

const ALL_ROLES: QuarterRole[] = [
  "usable_cash",
  "total_cash",
  "restricted_cash",
  "operating_ytd",
  "investing_ytd",
  "financing_ytd",
  "fx_ytd",
];

function unwrap<T>(r: { ok: true; value: T } | { ok: false; errors: string[] }): T {
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.value;
}
const role = (r: CompanySnapshotResult, name: QuarterRole) =>
  r.snapshot.roles.find((b) => b.role === name);
const cents = (r: CompanySnapshotResult, name: QuarterRole): number | undefined => {
  const b = role(r, name);
  if (b?.status !== "validated") return undefined;
  return r.snapshot.case.facts.find((f) => f.id === b.factId)?.cents;
};
const snap = (source: SecSource, cutoff: string, roles: QuarterRole[] = ALL_ROLES) =>
  companySnapshot(source, {
    id: "snap1",
    cik: source.package.company.cik,
    sourceSignature: "sec_companyfacts_v1",
    cutoff,
    roles,
  });

// ---------- REAL development package: Amplitude, Inc. (data/evaluation/development) ----------

describe("development package (real SEC companyfacts, read-only)", () => {
  const dir = new URL("../../../data/evaluation/development/raw/", import.meta.url);
  const load = () =>
    readSecSource({
      id: "dev-pkg",
      provenance: "evidence",
      originalUrl: "https://data.sec.gov/api/xbrl/companyfacts/CIK0001866692.json",
      retrievedAt: "2026-10-24T00:00:00Z",
      companyFacts: fs.readFileSync(new URL("amplitude-companyfacts.json", dir)),
      submissions: fs.readFileSync(new URL("amplitude-submissions.json", dir)),
    });

  it("reads 2022-09-30 roles from the 10-Q accepted 2022-11-03, values from source rows", async () => {
    const { source } = unwrap(await load());
    const r = unwrap(await snap(source, "2022-12-15T00:00:00-05:00"));
    expect(r.originBalanceDate).toBe("2022-09-30");
    // Source rows, accession 0000950170-22-021850 (10-Q, accepted 2022-11-03T20:08:14.000Z):
    // CashAndCashEquivalentsAtCarryingValue end 2022-09-30 val 247248000 -> 24724800000 cents
    expect(cents(r, "usable_cash")).toBe(24_724_800_000);
    // CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents end 2022-09-30 val 248100000
    expect(cents(r, "total_cash")).toBe(24_810_000_000);
    // RestrictedCashCurrent val 0 + RestrictedCashNoncurrent val 852000 = 852000 dollars,
    // and 248100000 - 247248000 = 852000 dollars -> 85200000 cents
    expect(cents(r, "restricted_cash")).toBe(85_200_000);
    // NetCashProvidedByUsedInOperatingActivities 2022-01-01..2022-09-30 val -786000
    expect(cents(r, "operating_ytd")).toBe(-78_600_000);
    // NetCashProvidedByUsedInInvestingActivities same period val -64641000
    expect(cents(r, "investing_ytd")).toBe(-6_464_100_000);
    // NetCashProvidedByUsedInFinancingActivities same period val 5232000
    expect(cents(r, "financing_ytd")).toBe(523_200_000);
    // The package has no FX tag: blocked, never zero.
    expect(role(r, "fx_ytd")).toMatchObject({ status: "blocked", reason: "missing_input" });
    expect(r.snapshot.completeness).toBe("incomplete");
    const usable = r.snapshot.case.facts.find((f) => f.metric === "cash_and_equivalents");
    expect(usable).toMatchObject({
      kind: "reported",
      sourceId: "source/0000950170-22-021850",
      availableAt: "2022-11-03T20:08:14.000Z",
      locator: "/facts/us-gaap/CashAndCashEquivalentsAtCarryingValue/units/USD/23",
      reportedScale: "ones",
    });
  });

  it("the bridge roles feed quarterBridge unchanged", async () => {
    const { source } = unwrap(await load());
    const r = unwrap(await snap(source, "2022-12-15T00:00:00-05:00"));
    expect(r.bridge).toBeDefined();
    if (!r.bridge) return;
    // SYNTHETIC test assumptions: financing/FX are method inputs, not source facts.
    const zeroRange = { unit: "cents" as const, low: 0, high: 0 };
    const assumption = (id: string) => ({
      id,
      label: "synthetic" as const,
      description: "SYNTHETIC test assumption",
      basisFactIds: [],
      value: zeroRange,
      effectiveFrom: "2022-10-01",
      dependsOn: [],
      feasibleAtCutoff: "yes" as const,
      selectedAfterReveal: false,
    });
    const withAssumptions: HistoricalCase = {
      ...r.bridge.case,
      assumptions: [assumption("AS-FIN"), assumption("AS-FX")],
    };
    const bridge = quarterBridge({
      ...r.bridge,
      case: withAssumptions,
      financingAssumptionId: "AS-FIN",
      fxAssumptionId: "AS-FX",
    });
    expect(bridge.targetDate).toBe("2022-12-31");
    expect(bridge.elapsedQuarters).toBe(3);
  });

  it("2022-12-31: ambiguous RestrictedCashAndCashEquivalents and a missing component block restricted cash", async () => {
    const { source } = unwrap(await load());
    const r = unwrap(await snap(source, "2023-03-15T00:00:00-04:00"));
    expect(r.originBalanceDate).toBe("2022-12-31");
    // Accession 0000950170-23-003045 (10-K): CashAndCashEquivalentsAtCarryingValue 218494000,
    // total 219349000, OCF 2022-01-01..2022-12-31 -5384000, ICF -89393000, FCF 5831000.
    expect(cents(r, "usable_cash")).toBe(21_849_400_000);
    expect(cents(r, "total_cash")).toBe(21_934_900_000);
    expect(cents(r, "operating_ytd")).toBe(-538_400_000);
    expect(cents(r, "investing_ytd")).toBe(-8_939_300_000);
    expect(cents(r, "financing_ytd")).toBe(583_100_000);
    // That 10-K reports RestrictedCashNoncurrent 855000 but no RestrictedCashCurrent, and
    // RestrictedCashAndCashEquivalents 219349000 (equal to the total, not restricted only).
    expect(role(r, "restricted_cash")).toMatchObject({ status: "blocked", reason: "needs_input" });
    const ambiguous = r.mapped.receipts.find(
      (m) =>
        m.tag === "RestrictedCashAndCashEquivalents" &&
        m.key.period.kind === "instant" &&
        m.key.period.date === "2022-12-31",
    );
    expect(ambiguous?.status).toBe("needs_input");
    expect(ambiguous?.question).toMatch(/restricted cash only/);
    expect(r.snapshot.case.facts.some((f) => f.metric === "restricted_cash")).toBe(false);
  });

  it("cutoff is inclusive of the acceptance instant and excludes one second earlier", async () => {
    const { source } = unwrap(await load());
    // 10-K 0000950170-23-003045 acceptanceDateTime 2023-02-16T21:06:58.000Z
    const before = unwrap(await snap(source, "2023-02-16T21:06:57Z"));
    const at = unwrap(await snap(source, "2023-02-16T21:06:58Z"));
    expect(before.originBalanceDate).toBe("2022-09-30");
    expect(at.originBalanceDate).toBe("2022-12-31");
    expect(before.snapshot.case.sources.some((s) => s.accession === "0000950170-23-003045")).toBe(
      false,
    );
  });
});

// ---------- SYNTHETIC fixtures: invented company, accessions and amounts ----------

const CIK = "9999999999"; // SYNTHETIC
const Q1 = "9999999999-24-000001";
const Q1A = "9999999999-24-000002";
type Row = {
  tag: string;
  accn?: string;
  unit?: string;
  form?: string;
  start?: string;
  end?: string;
  /** Lexeme written into the JSON exactly, unquoted. */
  val: string;
  extra?: Record<string, unknown>;
};
type FilingRow = { accn: string; form: string; acceptedAt?: string; reportDate?: string };

const BASE_ROWS: Row[] = [
  { tag: "CashAndCashEquivalentsAtCarryingValue", val: "1000.50" },
  { tag: "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", val: "1200.50" },
  { tag: "RestrictedCashCurrent", val: "150" },
  { tag: "RestrictedCashNoncurrent", val: "50" },
  { tag: "NetCashProvidedByUsedInOperatingActivities", start: "2024-01-01", val: "-300.25" },
  { tag: "NetCashProvidedByUsedInInvestingActivities", start: "2024-01-01", val: "-100" },
  { tag: "NetCashProvidedByUsedInFinancingActivities", start: "2024-01-01", val: "40" },
];
const BASE_FILINGS: FilingRow[] = [
  { accn: Q1, form: "10-Q", acceptedAt: "2024-05-01T20:00:00.000Z", reportDate: "2024-03-31" },
];
const CUTOFF = "2024-05-15T00:00:00Z";

function synthetic(
  rows: Row[] = BASE_ROWS,
  filings: FilingRow[] = BASE_FILINGS,
  edit: { fiscalYearEnd?: string | null; factsCik?: string; usGaap?: Record<string, unknown> } = {},
) {
  const usGaap: Record<string, { units: Record<string, unknown[]> }> = {};
  for (const r of rows) {
    const concept = usGaap[r.tag] ?? { units: {} };
    usGaap[r.tag] = concept;
    const unit = r.unit ?? "USD";
    const list = concept.units[unit] ?? [];
    concept.units[unit] = list;
    const accn = r.accn ?? Q1;
    list.push({
      ...(r.start ? { start: r.start } : {}),
      ...(r.end === "" ? {} : { end: r.end ?? "2024-03-31" }),
      val: `@@${r.val}@@`,
      accn,
      fy: 2024,
      fp: "Q1",
      form: r.form ?? filings.find((f) => f.accn === accn)?.form ?? "10-Q",
      filed: "2024-05-01",
      ...r.extra,
    });
  }
  const facts = {
    cik: `@@${edit.factsCik ?? "9999999999"}@@`,
    entityName: "SYNTHETIC FIXTURE CO",
    facts: { "us-gaap": { ...usGaap, ...edit.usGaap } },
  };
  const subs = {
    cik: CIK,
    name: "SYNTHETIC FIXTURE CO (not a real company)",
    ...(edit.fiscalYearEnd === null ? {} : { fiscalYearEnd: edit.fiscalYearEnd ?? "1231" }),
    filings: {
      recent: {
        accessionNumber: filings.map((f) => f.accn),
        form: filings.map((f) => f.form),
        acceptanceDateTime: filings.map((f) => f.acceptedAt ?? ""),
        reportDate: filings.map((f) => f.reportDate ?? ""),
      },
      files: [],
    },
  };
  const lexemes = (o: unknown) => JSON.stringify(o).replace(/"@@(.*?)@@"/g, "$1");
  return readSecSource({
    id: "synthetic-pkg",
    provenance: "synthetic_fixture",
    originalUrl: "https://example.test/SYNTHETIC/companyfacts.json",
    retrievedAt: "2024-07-01T00:00:00Z",
    companyFacts: bytes(lexemes(facts)),
    submissions: bytes(lexemes(subs)),
  });
}
const replace = (tag: string, row: Partial<Row>): Row[] =>
  BASE_ROWS.map((r) => (r.tag === tag ? { ...r, ...row } : r));
const without = (tag: string): Row[] => BASE_ROWS.filter((r) => r.tag !== tag);
const read = async (...args: Parameters<typeof synthetic>): Promise<ReadSecSource> =>
  unwrap(await synthetic(...args));
const snapOf = async (
  args: Parameters<typeof synthetic>,
  cutoff = CUTOFF,
): Promise<CompanySnapshotResult> => unwrap(await snap((await read(...args)).source, cutoff));

describe("SYNTHETIC: exact decimal money", () => {
  it("converts the written lexeme to exact cents (hand-derived)", async () => {
    const r = await snapOf([]);
    // usable 1000.50 -> 100050; total 1200.50 -> 120050; restricted 150 + 50 = 200 dollars
    // = 120050 - 100050 = 20000 cents; OCF -300.25 -> -30025; ICF -100 -> -10000; FCF 40 -> 4000
    expect(cents(r, "usable_cash")).toBe(100_050);
    expect(cents(r, "total_cash")).toBe(120_050);
    expect(cents(r, "restricted_cash")).toBe(20_000);
    expect(cents(r, "operating_ytd")).toBe(-30_025);
    expect(cents(r, "investing_ytd")).toBe(-10_000);
    expect(cents(r, "financing_ytd")).toBe(4_000);
    expect(r.bridge?.originBalanceDate).toBe("2024-03-31");
  });

  it("keeps trailing zeros in the lexeme and accepts them as exact", async () => {
    const r = await snapOf([replace("CashAndCashEquivalentsAtCarryingValue", { val: "1000.500" })]);
    const obs = r.mapped.observations.find(
      (o) => o.key.metric === "cash_and_equivalents" && o.rawValue === "1000.500",
    );
    expect(obs?.cents).toBe(100_050);
  });

  it("rejects sub-cent values instead of rounding", async () => {
    const r = await snapOf([
      replace("NetCashProvidedByUsedInOperatingActivities", { val: "12.345" }),
    ]);
    expect(role(r, "operating_ytd")).toMatchObject({ status: "blocked", reason: "unsafe_value" });
    const m = r.mapped.receipts.find((x) => x.tag === "NetCashProvidedByUsedInOperatingActivities");
    expect(m?.status).toBe("rejected");
    expect(m?.validationErrors.join()).toMatch(/sub-cent/);
  });

  it("accepts the largest safe cents and rejects one cent more (overflow)", async () => {
    // Number.MAX_SAFE_INTEGER = 9007199254740991 cents = 90071992547409.91 dollars
    const max = await snapOf([
      replace("NetCashProvidedByUsedInOperatingActivities", { val: "90071992547409.91" }),
    ]);
    expect(cents(max, "operating_ytd")).toBe(9_007_199_254_740_991);
    const over = await snapOf([
      replace("NetCashProvidedByUsedInOperatingActivities", { val: "90071992547409.92" }),
    ]);
    expect(role(over, "operating_ytd")).toMatchObject({ reason: "unsafe_value" });
  });

  it("never passes a value through a float: a 21-digit lexeme survives verbatim and is rejected", async () => {
    const { source } = await read(
      replace("NetCashProvidedByUsedInOperatingActivities", { val: "123456789012345678901" }),
    );
    const rec = source.package.records.find(
      (r) => r.tag === "NetCashProvidedByUsedInOperatingActivities",
    );
    expect(rec?.rawValue).toBe("123456789012345678901");
    const r = unwrap(await snap(source, CUTOFF));
    expect(role(r, "operating_ytd")).toMatchObject({ reason: "unsafe_value" });
  });

  it("skips exponent notation as not a plain decimal lexeme", async () => {
    const { skipped } = await read(
      replace("NetCashProvidedByUsedInOperatingActivities", { val: "-3.0025e2" }),
    );
    expect(skipped.map((s) => s.reason)).toContain("value is not a plain decimal lexeme");
  });

  it("rejects a negative balance", async () => {
    const r = await snapOf([replace("CashAndCashEquivalentsAtCarryingValue", { val: "-1" })]);
    expect(role(r, "usable_cash")).toMatchObject({ status: "blocked", reason: "missing_input" });
  });
});

describe("SYNTHETIC: units, dates and scope fail closed", () => {
  it("rejects non-USD and never converts it", async () => {
    const r = await snapOf([replace("CashAndCashEquivalentsAtCarryingValue", { unit: "EUR" })]);
    const m = r.mapped.receipts.find((x) => x.tag === "CashAndCashEquivalentsAtCarryingValue");
    expect(m).toMatchObject({ status: "rejected", unit: "EUR" });
    expect(m?.validationErrors).toContain("unit EUR is not USD");
    expect(role(r, "usable_cash")).toMatchObject({ status: "blocked", reason: "missing_input" });
    expect(r.bridge).toBeUndefined();
  });

  it("skips a concept with no units and a blank unit", async () => {
    const { skipped, source } = await read(
      without("CashAndCashEquivalentsAtCarryingValue"),
      BASE_FILINGS,
      {
        usGaap: {
          CashAndCashEquivalentsAtCarryingValue: { units: {} },
          RestrictedCashCurrent: { units: { "": [] } },
        },
      },
    );
    expect(skipped.map((s) => s.pointer)).toEqual(
      expect.arrayContaining([
        "/facts/us-gaap/CashAndCashEquivalentsAtCarryingValue",
        "/facts/us-gaap/RestrictedCashCurrent/units/",
      ]),
    );
    const r = unwrap(await snap(source, CUTOFF));
    expect(role(r, "usable_cash")).toMatchObject({ reason: "missing_input" });
    expect(role(r, "restricted_cash")).toMatchObject({ status: "blocked" });
  });

  it("skips a fact row without an end date", async () => {
    const { skipped } = await read(replace("CashAndCashEquivalentsAtCarryingValue", { end: "" }));
    expect(skipped).toContainEqual({
      pointer: "/facts/us-gaap/CashAndCashEquivalentsAtCarryingValue/units/USD/0",
      reason: "period dates are missing or invalid",
    });
  });

  it("drops a filing without an acceptance instant and every fact it carries", async () => {
    const result = await synthetic(BASE_ROWS, [
      { accn: Q1, form: "10-Q", reportDate: "2024-03-31" },
    ]);
    // The only filing is ineligible, so no package can be built.
    expect(result.ok).toBe(false);
    const withOld = await read(
      [...BASE_ROWS, { tag: "CashAndCashEquivalentsAtCarryingValue", accn: Q1A, val: "5" }],
      [...BASE_FILINGS, { accn: Q1A, form: "10-Q", reportDate: "2024-03-31" }],
    );
    expect(withOld.skipped.map((s) => s.reason)).toContain(
      "acceptance instant is missing or invalid; availability is unknown",
    );
    expect(withOld.source.package.records.some((r) => r.accession === Q1A)).toBe(false);
  });

  it("skips dimensioned (segment) facts: consolidated scope only", async () => {
    const { skipped, source } = await read(
      replace("CashAndCashEquivalentsAtCarryingValue", { extra: { segment: { axis: "x" } } }),
    );
    expect(skipped[0]?.reason).toMatch(/unsupported fact qualifier "segment"/);
    const r = unwrap(await snap(source, CUTOFF));
    expect(role(r, "usable_cash")).toMatchObject({ reason: "missing_input" });
  });
});

describe("SYNTHETIC: tag ambiguity and components", () => {
  it("does not treat current restricted cash alone as total restricted cash", async () => {
    const r = await snapOf([without("RestrictedCashNoncurrent")]);
    const b = role(r, "restricted_cash");
    expect(b).toMatchObject({ status: "blocked", reason: "missing_input" });
    expect(b?.status === "blocked" && b.detail).toMatch(/never assumed zero/);
  });

  it("never maps RestrictedCashAndCashEquivalents to restricted cash", async () => {
    const r = await snapOf([
      [
        ...without("RestrictedCashNoncurrent").filter((x) => x.tag !== "RestrictedCashCurrent"),
        { tag: "RestrictedCashAndCashEquivalents", val: "200" },
      ],
    ]);
    expect(role(r, "restricted_cash")).toMatchObject({ status: "blocked", reason: "needs_input" });
    expect(r.mapped.observations.some((o) => o.key.metric === "restricted_cash")).toBe(false);
  });

  it("blocks when full components disagree with total minus usable", async () => {
    // 150 + 60 = 210 dollars, but 1200.50 - 1000.50 = 200 dollars
    const r = await snapOf([replace("RestrictedCashNoncurrent", { val: "60" })]);
    expect(role(r, "restricted_cash")).toMatchObject({ reason: "unresolved_conflict" });
  });

  it("does not sum components across filings", async () => {
    const r = await snapOf([
      [
        ...without("RestrictedCashNoncurrent"),
        { tag: "RestrictedCashNoncurrent", accn: Q1A, form: "10-Q/A", val: "50" },
      ],
      [
        ...BASE_FILINGS,
        {
          accn: Q1A,
          form: "10-Q/A",
          acceptedAt: "2024-05-02T20:00:00.000Z",
          reportDate: "2024-03-31",
        },
      ],
    ]);
    expect(role(r, "restricted_cash")).toMatchObject({ reason: "missing_input" });
  });
});

describe("SYNTHETIC: fiscal calendar must be evidenced", () => {
  it("fails without a fiscalYearEnd in submissions", async () => {
    const r = await synthetic(BASE_ROWS, BASE_FILINGS, { fiscalYearEnd: null });
    expect(r.ok).toBe(false);
  });

  it("refuses a non-12-31 fiscal year even when rows carry a calendar frame label", async () => {
    const rows = BASE_ROWS.map((r) => ({ ...r, extra: { frame: "CY2024Q1I" } }));
    const { source } = await read(rows, BASE_FILINGS, { fiscalYearEnd: "0630" });
    const r = await snap(source, CUTOFF);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.errors.join()).toMatch(/fiscal year ends 0630/);
  });
});

describe("SYNTHETIC: cutoff and amendments", () => {
  const amended: Parameters<typeof synthetic> = [
    [
      ...BASE_ROWS,
      {
        tag: "NetCashProvidedByUsedInOperatingActivities",
        accn: Q1A,
        start: "2024-01-01",
        val: "-310.00",
      },
    ],
    [
      ...BASE_FILINGS,
      {
        accn: Q1A,
        form: "10-Q/A",
        acceptedAt: "2024-06-10T20:00:00.000Z",
        reportDate: "2024-03-31",
      },
    ],
  ];

  it("keeps an amendment as a separate dated source linked to its original", async () => {
    const { source } = await read(...amended);
    expect(source.package.accessions.find((a) => a.accession === Q1A)).toMatchObject({
      form: "10-Q/A",
      amends: Q1,
      acceptedAt: "2024-06-10T20:00:00.000Z",
    });
  });

  it("excludes an amendment accepted after the cutoff; the original binds", async () => {
    const r = await snapOf(amended, CUTOFF);
    // original row: OCF -300.25 -> -30025 cents
    expect(cents(r, "operating_ytd")).toBe(-30_025);
    expect(r.snapshot.case.sources.map((s) => s.accession)).toEqual([Q1]);
  });

  it("with both eligible, blocks instead of preferring the later amendment", async () => {
    const r = await snapOf(amended, "2024-06-30T00:00:00Z");
    expect(role(r, "operating_ytd")).toMatchObject({ reason: "unresolved_conflict" });
    const amendment = r.snapshot.case.sources.find((s) => s.accession === Q1A);
    expect(amendment?.amends).toBe(`source/${Q1}`);
  });

  it("reports a role found only after the cutoff as after_cutoff", async () => {
    const r = await snapOf(
      [
        [
          ...without("NetCashProvidedByUsedInInvestingActivities"),
          {
            tag: "NetCashProvidedByUsedInInvestingActivities",
            accn: Q1A,
            start: "2024-01-01",
            val: "-100",
          },
        ],
        amended[1],
      ],
      CUTOFF,
    );
    expect(role(r, "investing_ytd")).toMatchObject({ status: "blocked", reason: "after_cutoff" });
  });
});

describe("SYNTHETIC: role completeness and company identity", () => {
  it("reports a missing role as missing, adds no zero fact and no bridge", async () => {
    const r = await snapOf([without("NetCashProvidedByUsedInInvestingActivities")]);
    expect(role(r, "investing_ytd")).toMatchObject({ status: "blocked", reason: "missing_input" });
    expect(r.snapshot.case.facts.some((f) => f.metric === "investing_cash_flow")).toBe(false);
    expect(r.snapshot.completeness).toBe("incomplete");
    expect(r.bridge).toBeUndefined();
  });

  it("is complete exactly when every requested role validates", async () => {
    const r = unwrap(
      await snap((await read()).source, CUTOFF, [
        "usable_cash",
        "total_cash",
        "operating_ytd",
        "investing_ytd",
      ]),
    );
    expect(r.snapshot.completeness).toBe("complete");
    expect(r.snapshot.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const again = unwrap(
      await snap((await read()).source, CUTOFF, [
        "usable_cash",
        "total_cash",
        "operating_ytd",
        "investing_ytd",
      ]),
    );
    expect(again.snapshot.contentHash).toBe(r.snapshot.contentHash);
  });

  it("refuses to build a snapshot for another company", async () => {
    const { source } = await read();
    const r = await companySnapshot(source, {
      id: "s",
      cik: "0000000002",
      sourceSignature: "sec_companyfacts_v1",
      cutoff: CUTOFF,
      roles: ALL_ROLES,
    });
    expect(r.ok).toBe(false);
  });

  it("refuses companyfacts and submissions from different companies", async () => {
    const r = await synthetic(BASE_ROWS, BASE_FILINGS, { factsCik: "9999999998" });
    expect(r.ok ? "" : r.errors.join()).toMatch(/differs from submissions CIK/);
  });

  it("module source names no company or CIK", () => {
    const src = fs.readFileSync(new URL("./source-normalization.ts", import.meta.url), "utf8");
    expect(src.toLowerCase()).not.toMatch(/amplitude|freshworks|tenable|varonis|1866692/);
  });

  it("is exported from the engine index", () => {
    expect(engineIndex.companySnapshot).toBe(companySnapshot);
    expect(engineIndex.readSecSource).toBe(readSecSource);
  });
});
