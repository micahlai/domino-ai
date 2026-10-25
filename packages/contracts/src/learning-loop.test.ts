import { describe, expect, it } from "vitest";
import { historicalFixtures as fx } from "./fixtures";
import {
  type CompanyKnowledgeSnapshot,
  CompanyKnowledgeSnapshotSchema,
  EvaluationManifestSchema,
  type EvaluationReport,
  EvaluationReportSchema,
  EvaluationSealSchema,
  FeedbackRecordSchema,
  type LearnedRuleVersion,
  LearnedRuleVersionSchema,
  type MappingReceipt,
  MappingReceiptSchema,
  type NormalizedObservation,
  NormalizedObservationSchema,
  type ReconciliationReceipt,
  ReconciliationReceiptSchema,
  type SourcePackage,
  SourcePackageSchema,
  dollarLexemeToCents,
  observationKeyId,
  ruleEligibility,
} from "./index";

// SYNTHETIC: invented CIKs, accessions, hashes and amounts. Not any company's record.
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const h = (c: string) => c.repeat(64);
const g = (c: string) => c.repeat(40);
const CIK = "0000000001";
const ACC_Q = "0000000001-31-000001";
const ACC_A = "0000000001-31-000002";
const messages = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.success ? [] : r.error!.issues.map((i) => i.message);
const mutated = <T>(
  schema: { safeParse: (v: unknown) => unknown },
  base: T,
  edit: (v: T) => void,
) => {
  const v = clone(base);
  edit(v);
  return messages(schema.safeParse(v) as Parameters<typeof messages>[0]);
};

const pkg: SourcePackage = {
  schemaVersion: 1,
  id: "pkg1",
  format: "sec_companyfacts_v1",
  provenance: "synthetic_fixture",
  company: { cik: CIK, name: "Synthetic Co" },
  originalUrl: "https://example.test/companyfacts/CIK0000000001.json",
  retrievedAt: "2031-12-01T10:00:00-05:00",
  rawContentHash: h("a"),
  submissionsContentHash: h("b"),
  accessions: [
    {
      accession: ACC_Q,
      form: "10-Q",
      acceptedAt: "2031-11-09T16:45:46-05:00",
      reportPeriod: { kind: "duration", start: "2031-07-01", end: "2031-09-30" },
    },
    {
      accession: ACC_A,
      form: "10-Q/A",
      acceptedAt: "2031-11-20T09:00:00-05:00",
      reportPeriod: { kind: "duration", start: "2031-07-01", end: "2031-09-30" },
      amends: ACC_Q,
    },
  ],
  records: [
    {
      id: "r1",
      accession: ACC_Q,
      taxonomy: "us-gaap",
      tag: "CashAndCashEquivalentsAtCarryingValue",
      unit: "USD",
      pointer: "/facts/us-gaap/CashAndCashEquivalentsAtCarryingValue/units/USD/0",
      rawValue: "123456789.01",
      period: { kind: "instant", date: "2031-09-30" },
    },
  ],
};

const key = {
  cik: CIK,
  scope: "consolidated" as const,
  metric: "cash_and_equivalents" as const,
  definition: "us-gaap:CashAndCashEquivalentsAtCarryingValue@1",
  currency: "USD",
  period: { kind: "instant" as const, date: "2031-09-30" },
};

const mapping: MappingReceipt = {
  id: "m1",
  sourcePackageId: "pkg1",
  sourceHash: h("a"),
  recordId: "r1",
  pointer: "/facts/us-gaap/CashAndCashEquivalentsAtCarryingValue/units/USD/0",
  tag: "CashAndCashEquivalentsAtCarryingValue",
  unit: "USD",
  key,
  transform: "usd_dollars_to_cents",
  status: "validated",
  mapperVersion: "0.1.0",
  dictionaryVersion: "1.0.0",
  validationErrors: [],
};

const obs: NormalizedObservation = {
  id: "o1",
  key,
  sourcePackageId: "pkg1",
  recordId: "r1",
  accession: ACC_Q,
  mappingReceiptId: "m1",
  transform: "usd_dollars_to_cents",
  rawValue: "123456789.01",
  cents: 12345678901,
  availableAt: "2031-11-09T16:45:46-05:00",
};

const receipt: ReconciliationReceipt = {
  id: "rc1",
  key,
  candidateIds: ["o1", "o2"],
  classification: "conflict",
  outcome: {
    kind: "selected",
    selectedIds: ["o1"],
    authority: { kind: "user_resolution", userId: "u1" },
  },
  rationale: "Synthetic: user picked the original filing.",
  sourceAvailableAt: "2031-11-09T16:45:46-05:00",
  recordedAt: "2031-11-10T12:00:00-05:00",
  effectiveFrom: "2031-11-10T12:00:00-05:00",
  eligibleAt: "2031-11-10T12:00:00-05:00",
};

const rule: LearnedRuleVersion = {
  id: "rv1",
  ruleId: "rule1",
  version: 1,
  feedbackId: "fb1",
  scope: {
    kind: "company",
    cik: CIK,
    schemaVersion: 1,
    sourceSignature: "sec_companyfacts_v1:us-gaap",
  },
  action: {
    kind: "authority_preference",
    metric: "cash_and_equivalents",
    prefer: "original_filing",
  },
  rationale: "Synthetic: prefer original accession.",
  evidenceRefs: ["rc1"],
  status: "accepted",
  validatorVersion: "0.1.0",
  recordedAt: "2031-11-10T12:00:00-05:00",
  effectiveFrom: "2031-11-10T12:00:00-05:00",
};
const task = {
  cik: CIK,
  schemaVersion: 1 as const,
  sourceSignature: "sec_companyfacts_v1:us-gaap",
  cutoff: fx.cutoff,
};

const snapshot: CompanyKnowledgeSnapshot = {
  schemaVersion: 1,
  id: "ks1",
  cik: CIK,
  sourceSignature: task.sourceSignature,
  cutoff: fx.cutoff,
  sourcePackageIds: ["pkg1"],
  mappingReceiptIds: ["m1"],
  reconciliations: [receipt],
  rules: [rule],
  case: {
    ...clone(fx.historicalCase),
    facts: clone(fx.historicalCase.facts).filter(
      (f) => Date.parse(f.availableAt) <= Date.parse(fx.cutoff),
    ),
  },
  roles: [
    { role: "usable_cash", status: "validated", factId: fx.historicalCase.facts[0]!.id },
    {
      role: "fx_ytd",
      status: "blocked",
      reason: "missing_input",
      detail: "No FX effect record; not assumed zero.",
    },
  ],
  completeness: "incomplete",
  contentHash: h("c"),
};

describe("source package provenance", () => {
  it("accepts a synthetic package and keeps raw lexemes", () => {
    expect(SourcePackageSchema.parse(pkg).records[0]?.rawValue).toBe("123456789.01");
  });
  it("requires verified acceptance, ordered amendments and known accessions", () => {
    expect(
      mutated(SourcePackageSchema, pkg, (p) => {
        p.accessions[0]!.acceptedAt = "2031-11-09";
      }),
    ).toContain("expected an ISO timestamp with an explicit offset");
    expect(
      mutated(SourcePackageSchema, pkg, (p) => {
        p.accessions[1]!.acceptedAt = "2031-11-01T09:00:00-05:00";
      }),
    ).toContain("an amendment must be accepted after the original");
    expect(
      mutated(SourcePackageSchema, pkg, (p) => {
        p.accessions[1]!.amends = undefined;
      }),
    ).toContain("an amendment form needs amends, and only amendments have it");
    expect(
      mutated(SourcePackageSchema, pkg, (p) => {
        p.records[0]!.accession = "0000000001-31-000009";
      }),
    ).toContain("record accession not in package");
    expect(
      mutated(SourcePackageSchema, pkg, (p) => {
        p.accessions[0]!.acceptedAt = "2031-12-02T00:00:00-05:00";
      }),
    ).toContain("accepted after the package was retrieved");
    expect(
      mutated(SourcePackageSchema, pkg, (p) => {
        (p as { provenance: string }).provenance = "unknown";
      }).length,
    ).toBeGreaterThan(0);
  });
  it("rejects re-serialized numbers as raw values", () => {
    expect(
      mutated(SourcePackageSchema, pkg, (p) => {
        p.records[0]!.rawValue = "1.2e8";
      }),
    ).toContain("expected a plain decimal lexeme");
  });
});

describe("exact units", () => {
  it.each([
    ["123456789.01", 12345678901],
    ["-5", -500],
    ["0.1", 10],
    ["7.250", 725],
  ])("converts %s dollars to exact cents", (lexeme, cents) =>
    expect(dollarLexemeToCents(lexeme)).toBe(cents),
  );
  it.each(["0.001", "1e3", "90071992547409.92", ""])("rejects %s", (lexeme) =>
    expect(dollarLexemeToCents(lexeme)).toBeUndefined(),
  );
  it("checks normalized cents against the raw lexeme and transform", () => {
    expect(NormalizedObservationSchema.safeParse(obs).success).toBe(true);
    expect(
      mutated(NormalizedObservationSchema, obs, (o) => {
        o.cents = 12345678900;
      }),
    ).toContain("cents do not equal the raw value under the transform");
    expect(
      mutated(NormalizedObservationSchema, obs, (o) => {
        o.transform = "negated_usd_dollars_to_cents";
        o.cents = -12345678901;
      }),
    ).toEqual([]);
    expect(
      mutated(NormalizedObservationSchema, obs, (o) => {
        o.rawValue = "1.005";
      }),
    ).toContain("raw value is not exact safe cents");
  });
  it("rejects a USD transform on a non-USD observation", () => {
    expect(
      mutated(NormalizedObservationSchema, obs, (o) => {
        o.key.currency = "EUR";
      }),
    ).toContain("a USD transform needs a USD observation");
    expect(
      mutated(MappingReceiptSchema, mapping, (m) => {
        m.key.currency = "EUR";
        m.unit = "EUR";
      }),
    ).toContain("a USD transform needs a USD observation");
  });
  it("needs metric/period agreement and keys compare by value", () => {
    expect(
      mutated(MappingReceiptSchema, mapping, (m) => {
        m.key.period = { kind: "duration", start: "2031-07-01", end: "2031-09-30" };
      }),
    ).toContain("a balance metric needs an instant period");
    expect(observationKeyId(key)).toBe(
      observationKeyId({ ...clone(key), period: { date: "2031-09-30", kind: "instant" } }),
    );
  });
});

describe("mapping and missing input", () => {
  it("accepts validated and needs_input receipts", () => {
    expect(MappingReceiptSchema.safeParse(mapping).success).toBe(true);
    const ask = {
      ...clone(mapping),
      status: "needs_input",
      unit: "EUR",
      validationErrors: ["unsupported unit EUR"],
      question: "Which currency should this record use?",
    };
    expect(MappingReceiptSchema.safeParse(ask).success).toBe(true);
  });
  it("rejects silent failures and unit mismatches", () => {
    expect(
      mutated(MappingReceiptSchema, mapping, (m) => {
        m.status = "needs_input";
      }),
    ).toContain("rejected or needs_input needs errors; other statuses have none");
    expect(
      mutated(MappingReceiptSchema, mapping, (m) => {
        m.unit = "shares";
      }),
    ).toContain("a validated money mapping needs the unit to equal the key currency");
    expect(
      mutated(MappingReceiptSchema, mapping, (m) => {
        (m as { transform: string }).transform = "eval";
      }).length,
    ).toBeGreaterThan(0);
    expect(
      mutated(MappingReceiptSchema, mapping, (m) => {
        m.mapperVersion = "latest";
      }),
    ).toContain("expected an exact x.y.z version");
  });
  it("blocks a role instead of filling zero", () => {
    expect(CompanyKnowledgeSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(
      mutated(CompanyKnowledgeSnapshotSchema, snapshot, (s) => {
        s.completeness = "complete";
      }),
    ).toContain("complete exactly when no role is blocked");
    expect(
      mutated(CompanyKnowledgeSnapshotSchema, snapshot, (s) => {
        s.roles[0] = { role: "usable_cash", status: "validated", factId: "nope" };
      }),
    ).toContain("role fact not in case");
  });
});

describe("conflict receipts", () => {
  it("accepts a user resolution eligible at max(source, recorded, effective)", () => {
    expect(ReconciliationReceiptSchema.safeParse(receipt).success).toBe(true);
  });
  it("rejects backdated eligibility, deterministic conflict picks and foreign selections", () => {
    expect(
      mutated(ReconciliationReceiptSchema, receipt, (r) => {
        r.eligibleAt = r.sourceAvailableAt;
      }),
    ).toContain("a decision is eligible at max(source availability, recordedAt, effectiveFrom)");
    expect(
      mutated(ReconciliationReceiptSchema, receipt, (r) => {
        r.outcome = {
          kind: "selected",
          selectedIds: ["o1"],
          authority: { kind: "deterministic_method", methodId: "dedup", version: "0.1.0" },
        };
        r.eligibleAt = r.sourceAvailableAt;
      }),
    ).toContain("a genuine conflict needs an authority rule or user resolution");
    expect(
      mutated(ReconciliationReceiptSchema, receipt, (r) => {
        if (r.outcome.kind === "selected") r.outcome.selectedIds = ["o9"];
      }),
    ).toContain("selected id is not a candidate");
  });
  it("lets deterministic dedup use source availability and keeps blocked conflicts", () => {
    expect(
      mutated(ReconciliationReceiptSchema, receipt, (r) => {
        r.classification = "duplicate";
        r.outcome = {
          kind: "selected",
          selectedIds: ["o1"],
          authority: { kind: "deterministic_method", methodId: "dedup", version: "0.1.0" },
        };
        r.eligibleAt = r.sourceAvailableAt;
      }),
    ).toEqual([]);
    expect(
      mutated(ReconciliationReceiptSchema, receipt, (r) => {
        r.outcome = { kind: "blocked", reason: "Two eligible values disagree." };
        r.eligibleAt = r.sourceAvailableAt;
      }),
    ).toEqual([]);
  });
  it("rejects a snapshot using a receipt decided after its cutoff", () => {
    expect(
      mutated(CompanyKnowledgeSnapshotSchema, snapshot, (s) => {
        s.reconciliations[0]!.recordedAt = "2031-11-11T00:00:00-05:00";
        s.reconciliations[0]!.effectiveFrom = s.reconciliations[0]!.recordedAt;
        s.reconciliations[0]!.eligibleAt = s.reconciliations[0]!.recordedAt;
      }),
    ).toContain("receipt is not eligible at the cutoff");
  });
});

describe("scoped, versioned rule eligibility", () => {
  it("accepts feedback separate from rules", () => {
    expect(
      FeedbackRecordSchema.safeParse({
        id: "fb1",
        cik: CIK,
        actorId: "u1",
        text: "Use the original filing.",
        recordedAt: rule.recordedAt,
      }).success,
    ).toBe(true);
    expect(LearnedRuleVersionSchema.safeParse(rule).success).toBe(true);
  });
  it("is eligible only when accepted, in scope and not after the cutoff", () => {
    expect(ruleEligibility(rule, task)).toEqual({ eligible: true });
    // Audit P2 (finding 6): invalid instants fail closed.
    expect(ruleEligibility(rule, { ...task, cutoff: "invalid" })).toEqual({
      eligible: false,
      reason: "invalid_time",
    });
    expect(ruleEligibility({ ...rule, recordedAt: "nope" }, task)).toEqual({
      eligible: false,
      reason: "invalid_time",
    });
    expect(ruleEligibility({ ...rule, status: "rejected" }, task)).toEqual({
      eligible: false,
      reason: "not_accepted",
    });
    expect(ruleEligibility(rule, { ...task, cik: "0000000002" })).toEqual({
      eligible: false,
      reason: "out_of_scope",
    });
    expect(ruleEligibility(rule, { ...task, sourceSignature: "other" })).toEqual({
      eligible: false,
      reason: "out_of_scope",
    });
    expect(ruleEligibility({ ...rule, effectiveFrom: "2031-11-11T00:00:00-05:00" }, task)).toEqual({
      eligible: false,
      reason: "after_cutoff",
    });
    expect(
      ruleEligibility(
        { ...rule, scope: { kind: "global", userChoiceId: "c1" } },
        { ...task, cik: "0000000002" },
      ),
    ).toEqual({ eligible: true });
  });
  it("rejects backdating, code actions and malformed revocations", () => {
    expect(
      mutated(LearnedRuleVersionSchema, rule, (r) => {
        r.effectiveFrom = "2031-01-01T00:00:00-05:00";
      }),
    ).toContain("a rule cannot take effect before it was recorded (no backdating)");
    expect(
      mutated(LearnedRuleVersionSchema, rule, (r) => {
        r.status = "revoked";
      }),
    ).toContain("a revoked record names what it revokes, and only it does");
    expect(
      mutated(LearnedRuleVersionSchema, rule, (r) => {
        (r.action as Record<string, unknown>).code = "x()";
      }).length,
    ).toBeGreaterThan(0);
  });
  it("rejects a snapshot that applies an ineligible rule", () => {
    expect(
      mutated(CompanyKnowledgeSnapshotSchema, snapshot, (s) => {
        s.rules[0]!.scope = {
          kind: "company",
          cik: "0000000002",
          schemaVersion: 1,
          sourceSignature: task.sourceSignature,
        };
      }),
    ).toContain("rule is not eligible: out_of_scope");
  });
});

describe("evaluator seals", () => {
  const pin = {
    methodId: "quarterly_cash_bridge",
    version: "0.1.0",
    gitCommit: g("1"),
    gitTree: g("2"),
  };
  const seal = {
    protocol: { id: "quarterly-cash-eval", version: "1.0.0", contentHash: h("d") },
    manifestHash: h("e"),
    datasetHash: h("f"),
    sourceHashes: [h("a")],
    baseline: pin,
    candidate: { ...pin, methodId: "last_quarter_flow" },
    ruleVersionIds: [] as string[],
    normalizerHash: h("1"),
    reconcilerHash: h("2"),
    evaluatorHash: h("3"),
    dependencyLockHash: h("4"),
    sealedAt: "2031-12-01T10:00:00-05:00",
  };
  it("accepts exact pins and rejects placeholders", () => {
    expect(EvaluationSealSchema.safeParse(seal).success).toBe(true);
    expect(
      mutated(EvaluationSealSchema, seal, (s) => {
        s.candidate.version = "latest";
      }),
    ).toContain("expected an exact x.y.z version");
    expect(
      mutated(EvaluationSealSchema, seal, (s) => {
        s.baseline.gitCommit = "HEAD";
      }),
    ).toContain("expected a full git hash");
    expect(
      mutated(EvaluationSealSchema, seal, (s) => {
        s.evaluatorHash = "";
      }),
    ).toContain("expected a lowercase sha256 hex digest");
  });
  it("puts only label hashes in the manifest and requires origin inside the target quarter", () => {
    const manifest = {
      protocol: seal.protocol,
      sourceHashes: [h("a")],
      pairs: [
        {
          pairId: "p1",
          cik: CIK,
          targetQuarter: "2031Q4",
          targetDate: "2031-12-31",
          originAccession: ACC_Q,
          originAcceptedAt: "2031-11-09T16:45:46-05:00",
          originSliceHash: h("5"),
          labelHash: h("6"),
        },
      ],
    };
    expect(EvaluationManifestSchema.safeParse(manifest).success).toBe(true);
    expect(
      mutated(EvaluationManifestSchema, manifest, (m) => {
        m.pairs[0]!.originAcceptedAt = "2031-09-30T16:00:00-04:00";
      }),
    ).toContain("origin must fall strictly inside the target quarter");
    expect(
      mutated(EvaluationManifestSchema, manifest, (m) => {
        (m.pairs[0] as Record<string, unknown>).observedCents = 1;
      }).length,
    ).toBeGreaterThan(0);
  });
  const planned = Array.from({ length: 16 }, (_, i) => ({
    pairId: `p${i}`,
    cik: i < 8 ? CIK : "0000000002",
    targetQuarter: `${2024 + Math.floor((i % 8) / 4)}Q${(i % 4) + 1}`,
    targetDate: `${2024 + Math.floor((i % 8) / 4)}-${["03-31", "06-30", "09-30", "12-31"][i % 4]}`,
    originAccession: ACC_Q,
    originAcceptedAt: `${2024 + Math.floor((i % 8) / 4)}-${["02", "05", "08", "11"][i % 4]}-09T16:45:46-05:00`,
    originSliceHash: h("5"),
    labelHash: h("6"),
  }));
  const plannedManifest = { protocol: seal.protocol, sourceHashes: [h("a")], pairs: planned };
  const outcome = (prediction: number, observed: number) => ({
    status: "predicted" as const,
    predictionCents: prediction,
    signedErrorCents: String(prediction - observed),
    absErrorCents: String(Math.abs(prediction - observed)),
  });
  const row = (id: string, cik: string, b: number, c: number) => ({
    pairId: id,
    cik,
    observedCents: 0,
    baseline: outcome(b, 0),
    candidate: outcome(c, 0),
  });
  // 9 of 16 strict wins; 100 * 1510 <= 95 * 1600; each company no worse.
  const report: EvaluationReport = {
    seal,
    sealHash: h("7"),
    manifest: plannedManifest,
    rows: planned.map((p, i) => row(p.pairId, p.cik, -100, i < 9 ? 90 : 100)),
    baselineAbsErrorSum: "1600",
    candidateAbsErrorSum: "1510",
    pass: true,
  };
  it("accepts a complete passing report with exact errors", () => {
    expect(messages(EvaluationReportSchema.safeParse(report))).toEqual([]);
    expect(
      mutated(EvaluationReportSchema, report, (r) => {
        r.rows[0]!.baseline = { ...outcome(-100, 0), signedErrorCents: "100" };
      }),
    ).toContain("signed error is not prediction minus observed");
  });
  it("fails pass when any planned pair is ineligible", () => {
    expect(
      mutated(EvaluationReportSchema, report, (r) => {
        r.rows[15]!.candidate = { status: "ineligible", reason: "Missing prior quarter." };
        r.candidateAbsErrorSum = "1410";
      }),
    ).toContain("pass does not match the frozen acceptance rule");
  });
  it("binds rows to every planned pair and the full 2 x 8 cohort", () => {
    // Audit P1: one winning row from one company must not pass.
    const short = {
      ...clone(report),
      manifest: { ...plannedManifest, pairs: [planned[0]!] },
      rows: [row("p0", CIK, -100, 90)],
      baselineAbsErrorSum: "100",
      candidateAbsErrorSum: "90",
      pass: true,
    };
    expect(messages(EvaluationReportSchema.safeParse(short))).toContain(
      "pass does not match the frozen acceptance rule",
    );
    expect(
      mutated(EvaluationReportSchema, report, (r) => {
        r.rows.pop();
        r.baselineAbsErrorSum = "1500";
        r.candidateAbsErrorSum = "1410";
      }),
    ).toContain("planned pair has no report row");
    expect(
      mutated(EvaluationReportSchema, report, (r) => {
        r.rows[0]!.pairId = "extra";
      }),
    ).toContain("report row is not a planned pair");
    expect(
      mutated(EvaluationReportSchema, report, (r) => {
        r.rows[0]!.cik = "0000000002";
      }),
    ).toContain("report row company differs from the planned pair");
  });
  it("rejects repeated quarters and quarters outside the planned v1 set", () => {
    // Audit round 2, finding 1: unique pair IDs cannot hide one repeated quarter.
    const repeated = (r: EvaluationReport) => {
      const pairs = r.manifest.pairs.map((p) => ({
        ...p,
        targetQuarter: "2024Q1",
        targetDate: "2024-03-31",
        originAcceptedAt: "2024-02-09T16:45:46-05:00",
      }));
      return { ...r, manifest: { ...r.manifest, pairs } };
    };
    const msgs = messages(EvaluationReportSchema.safeParse(repeated(clone(report))));
    expect(msgs).toContain("duplicate company quarter");
    expect(msgs).toContain("pass does not match the frozen acceptance rule");
    expect(
      messages(EvaluationManifestSchema.safeParse(repeated(clone(report)).manifest)),
    ).toContain("duplicate company quarter");
    // Eight unique quarters, but not the planned 2024Q1-2025Q4 set.
    const shifted = clone(report) as EvaluationReport;
    const moved = shifted.manifest.pairs.map((p) =>
      p.targetQuarter === "2025Q4"
        ? {
            ...p,
            targetQuarter: "2026Q1",
            targetDate: "2026-03-31",
            originAcceptedAt: "2026-02-09T16:45:46-05:00",
          }
        : p,
    );
    expect(
      messages(
        EvaluationReportSchema.safeParse({
          ...shifted,
          manifest: { ...shifted.manifest, pairs: moved },
        }),
      ),
    ).toContain("pass does not match the frozen acceptance rule");
  });
  it("binds the manifest protocol to the seal protocol", () => {
    // Audit round 2, finding 3.
    for (const edit of [{ id: "other-protocol" }, { version: "1.0.1" }, { contentHash: h("9") }]) {
      const r = clone(report) as EvaluationReport;
      const out = {
        ...r,
        manifest: { ...r.manifest, protocol: { ...r.manifest.protocol, ...edit } },
      };
      expect(messages(EvaluationReportSchema.safeParse(out))).toContain(
        "manifest protocol differs from the sealed protocol",
      );
    }
  });
  it("uses one shared observation per pair", () => {
    // Audit P2 (finding 2): sides cannot carry different observed values.
    expect(
      mutated(EvaluationReportSchema, report, (r) => {
        (r.rows[0]!.candidate as Record<string, unknown>).observedCents = 5;
      }).length,
    ).toBeGreaterThan(0);
  });
  it("keeps differences beyond the safe range exact", () => {
    const max = Number.MAX_SAFE_INTEGER;
    const huge = {
      ...clone(report),
      manifest: { ...plannedManifest, pairs: [planned[0]!] },
      rows: [
        {
          pairId: "p0",
          cik: CIK,
          observedCents: -max,
          baseline: {
            status: "predicted",
            predictionCents: max,
            signedErrorCents: "18014398509481982",
            absErrorCents: "18014398509481982",
          },
          candidate: { status: "ineligible", reason: "x" },
        },
      ],
      baselineAbsErrorSum: "18014398509481982",
      candidateAbsErrorSum: "0",
      pass: false,
    };
    expect(messages(EvaluationReportSchema.safeParse(huge))).toEqual([]);
  });
  it("rejects blank, padded or latest seal identities and freezes the parse", () => {
    for (const bad of [" ", "", "latest", " rv1", "LATEST"]) {
      expect(
        mutated(EvaluationSealSchema, seal, (s) => {
          s.ruleVersionIds = [bad];
        }).length,
      ).toBeGreaterThan(0);
      expect(
        mutated(EvaluationSealSchema, seal, (s) => {
          s.candidate.methodId = bad;
        }).length,
      ).toBeGreaterThan(0);
      expect(
        mutated(EvaluationSealSchema, seal, (s) => {
          s.protocol.id = bad;
        }).length,
      ).toBeGreaterThan(0);
    }
    const parsed = EvaluationSealSchema.parse(seal);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.candidate)).toBe(true);
    expect(Object.isFrozen(parsed.ruleVersionIds)).toBe(true);
  });
});
