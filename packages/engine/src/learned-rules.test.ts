import {
  type FeedbackRecord,
  type HistoricalCase,
  type LearnedRuleVersion,
  ObservationKeySchema,
  type RuleAction,
  type RuleTask,
  type SourcePackage,
  SourcePackageSchema,
  observationKeyId,
} from "@domino/contracts";
import { describe, expect, it } from "vitest";
import * as engineIndex from "./index";
import {
  type FeedbackDecision,
  QUARTER_METHOD_SLOT,
  type RuledForecast,
  type RuledReconciliation,
  decideFeedback,
  quarterForecastWithRules,
  reconcileWithRules,
  resolveRules,
  revokeRuleVersion,
  rollbackRule,
  selectQuarterMethod,
} from "./learned-rules";
import { type QuarterCandidateInput, quarterCandidate } from "./period-candidate";

function unwrap<T>(r: { ok: true; value: T } | { ok: false; errors: string[] }): T {
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.value;
}

// SYNTHETIC times. Present-day decisions are labelled test instants, never historical facts.
const FEEDBACK_AT = "2026-10-24T10:00:00Z";
const V1_AT = "2026-10-24T12:00:00Z";
const NOW1 = "2026-10-25T00:00:00Z";
const V2_AT = "2026-10-26T12:00:00Z";
const NOW2 = "2026-10-27T00:00:00Z";
const ROLLBACK_AT = "2026-10-28T12:00:00Z";
const NOW3 = "2026-10-29T00:00:00Z";
/** A historical cutoff, after both SYNTHETIC filings but years before any decision. */
const OLD = "2023-02-01T00:00:00Z";
const SIG = "sec_companyfacts_v1";

// ---------- SYNTHETIC packages: invented companies, invented filings ----------

const A = "0000000001";
const B = "0000000002"; // unrelated SYNTHETIC company with the same tags and filing layout
const OCF = "NetCashProvidedByUsedInOperatingActivities";
const ICF = "NetCashProvidedByUsedInInvestingActivities";
const YTD_9M = { kind: "duration", start: "2022-01-01", end: "2022-09-30" } as const;

/** Original 10-Q says OCF 9M -786,000; its 10-Q/A says -800,000. A genuine conflict. */
function pkg(cik: string): SourcePackage {
  const p = (n: string) => `${cik}-${n}`;
  const rows = [
    { accession: p("22-000001"), raw: "-786000" },
    { accession: p("23-000002"), raw: "-800000" },
  ];
  return SourcePackageSchema.parse({
    schemaVersion: 1,
    id: `synthetic-${cik}`,
    format: "sec_companyfacts_v1",
    provenance: "synthetic_fixture",
    company: { cik, name: `SYNTHETIC Co ${cik}` },
    originalUrl: `https://example.test/${cik}.json`,
    retrievedAt: "2026-10-24T00:00:00Z",
    rawContentHash: "a".repeat(64),
    submissionsContentHash: "b".repeat(64),
    accessions: [
      {
        accession: p("22-000001"),
        form: "10-Q",
        acceptedAt: "2022-11-03T20:00:00.000Z",
        reportPeriod: { kind: "instant", date: "2022-09-30" },
      },
      {
        accession: p("23-000002"),
        form: "10-Q/A",
        acceptedAt: "2023-01-10T20:00:00.000Z",
        reportPeriod: { kind: "instant", date: "2022-09-30" },
        amends: p("22-000001"),
      },
    ],
    records: rows.map((r, i) => ({
      id: `us-gaap:${OCF}:USD:${i}`,
      accession: r.accession,
      taxonomy: "us-gaap",
      tag: OCF,
      unit: "USD",
      pointer: `/facts/us-gaap/${OCF}/units/USD/${i}`,
      rawValue: r.raw,
      period: YTD_9M,
    })),
  });
}
const ocfKeyId = (cik: string) =>
  observationKeyId(
    ObservationKeySchema.parse({
      cik,
      scope: "consolidated",
      metric: "operating_cash_flow",
      definition: `us-gaap:${OCF}@1`,
      currency: "USD",
      period: YTD_9M,
    }),
  );

const ORIGINAL: RuleAction = {
  kind: "authority_preference",
  metric: "operating_cash_flow",
  prefer: "original_filing",
};
const AMENDMENT: RuleAction = { ...ORIGINAL, prefer: "latest_amendment" };
const CANDIDATE: RuleAction = {
  kind: "method_selection",
  methodId: "quarterly_cash_last_quarter",
  version: "0.1.0",
};

const fb = (id: string, action: RuleAction, cik = A, at = FEEDBACK_AT): FeedbackRecord => ({
  id,
  cik,
  actorId: "user_analyst",
  text: `SYNTHETIC feedback ${id}`,
  proposedAction: action,
  recordedAt: at,
});
/** A decision plus the backend ingestion stamp it was recorded at (SYNTHETIC instant). */
const decision = (
  ruleId: string,
  at: string,
  d: Partial<FeedbackDecision> = {},
): { decision: FeedbackDecision; recordedAt: string } => ({
  decision: {
    status: "accepted",
    ruleId,
    scope: { kind: "company", sourceSignature: SIG },
    rationale: `SYNTHETIC rationale for ${ruleId}`,
    evidenceRefs: ["review/synthetic-1"],
    ...d,
  },
  recordedAt: at,
});
const accept = (
  history: readonly LearnedRuleVersion[],
  feedback: FeedbackRecord,
  d: ReturnType<typeof decision>,
) => unwrap(decideFeedback({ history, feedback, ...d }));

const reconcile = (cik: string, cutoff: string, history: readonly LearnedRuleVersion[]) =>
  unwrap(
    reconcileWithRules({
      id: "run",
      cik,
      cutoff,
      computedAt: "2026-10-24T12:00:00Z",
      sourceSignature: SIG,
      packages: [pkg(A), pkg(B)],
      history,
    }),
  );
const ocfOf = (r: RuledReconciliation, cik = A) =>
  r.reconciliation.keys.find((k) => k.keyId === ocfKeyId(cik));

/** v1 prefers the original filing; accepted today, eligible from V1_AT. */
const withV1 = () => accept([], fb("fb1", ORIGINAL), decision("ocf-authority", V1_AT));
/** v2 of the same rule prefers the latest amendment. */
const withV2 = () =>
  accept(withV1().history, fb("fb2", AMENDMENT, A, V1_AT), decision("ocf-authority", V2_AT));

describe("accepted scoped rules change later work only", () => {
  it("an accepted correction changes later reconciliation, with a change receipt", () => {
    expect(ocfOf(reconcile(A, NOW1, []))?.receipt?.outcome.kind).toBe("blocked");
    const v1 = withV1();
    expect(v1.record).toMatchObject({
      id: "ocf-authority/v1",
      version: 1,
      status: "accepted",
      feedbackId: "fb1",
      scope: { kind: "company", cik: A, schemaVersion: 1, sourceSignature: SIG },
    });
    expect(v1.receipt).toMatchObject({
      kind: "accepted",
      previous: null,
      next: { id: "ocf-authority/v1", version: 1, action: ORIGINAL },
      reason: "SYNTHETIC rationale for ocf-authority",
      affectedFields: ["reconciliation.operating_cash_flow.conflict_selection"],
      eligibleAt: V1_AT,
      conflictsWith: [],
    });
    const r = reconcile(A, NOW1, v1.history);
    // Original 10-Q value -786,000 dollars = -78,600,000 cents.
    expect(ocfOf(r)?.value?.cents).toBe(-78_600_000);
    expect(ocfOf(r)?.receipt?.outcome).toMatchObject({
      kind: "selected",
      authority: { kind: "authority_rule", ruleVersionId: "ocf-authority/v1" },
    });
    expect(ocfOf(r)?.value?.eligibleAt).toBe(V1_AT);
    expect(r.applications).toEqual([
      expect.objectContaining({
        ruleId: "ocf-authority",
        version: expect.objectContaining({ id: "ocf-authority/v1" }),
        previous: null,
        reason: "SYNTHETIC rationale for ocf-authority",
        affectedFields: [ocfKeyId(A)],
      }),
    ]);
  });

  it("work before the rule's eligibility is unchanged, even when computed afterwards", () => {
    const { history } = withV1();
    for (const cutoff of [OLD, "2026-10-24T11:59:59Z"]) {
      const without = reconcile(A, cutoff, []);
      const withRule = reconcile(A, cutoff, history);
      expect(withRule.reconciliation).toEqual(without.reconciliation);
      expect(withRule.applications).toEqual([]);
      expect(withRule.resolution.considered).toEqual([
        { id: "ocf-authority/v1", ruleId: "ocf-authority", use: "after_cutoff" },
      ]);
    }
  });

  it("a new version supersedes for new work; prior results stay immutable", () => {
    const v1 = withV1();
    const r1 = reconcile(A, NOW1, v1.history);
    const r1Copy = structuredClone(r1);
    const v1Record = structuredClone(v1.record);
    const v2 = withV2();
    expect(v2.record).toMatchObject({ id: "ocf-authority/v2", supersedes: "ocf-authority/v1" });
    expect(v2.receipt).toMatchObject({
      previous: { id: "ocf-authority/v1" },
      next: { id: "ocf-authority/v2", action: AMENDMENT },
      eligibleAt: V2_AT,
    });
    const r2 = reconcile(A, NOW2, v2.history);
    // Amendment value -800,000 dollars.
    expect(ocfOf(r2)?.value?.cents).toBe(-80_000_000);
    expect(r2.applications[0]).toMatchObject({
      version: { id: "ocf-authority/v2" },
      previous: { id: "ocf-authority/v1" },
      affectedFields: [ocfKeyId(A)],
    });
    // The earlier result is unchanged, frozen, and reproduced by re-running its cutoff.
    expect(r1).toEqual(r1Copy);
    expect(Object.isFrozen(r1) && Object.isFrozen(ocfOf(r1))).toBe(true);
    expect(reconcile(A, NOW1, v2.history).reconciliation).toEqual(r1.reconciliation);
    // The log only grows; the old log and record are not edited.
    expect(v1.history).toHaveLength(1);
    expect(v2.history.find((r) => r.id === "ocf-authority/v1")).toEqual(v1Record);
    expect(Object.isFrozen(v2.history)).toBe(true);
  });

  it("rejection records a decision and changes nothing", () => {
    const v1 = withV1();
    const rej = accept(
      v1.history,
      fb("fb2", AMENDMENT, A, V1_AT),
      decision("ocf-authority", V2_AT, { status: "rejected" }),
    );
    expect(rej.record).toMatchObject({ status: "rejected", version: 2 });
    expect(rej.record.supersedes).toBeUndefined();
    expect(rej.receipt).toMatchObject({
      kind: "rejected",
      previous: { id: "ocf-authority/v1" },
      next: { id: "ocf-authority/v1" },
      affectedFields: [],
    });
    const before = reconcile(A, NOW2, v1.history);
    const after = reconcile(A, NOW2, rej.history);
    expect(after.reconciliation).toEqual(before.reconciliation);
    expect(after.applications).toEqual(before.applications);
    expect(after.resolution.slots).toEqual(before.resolution.slots);
    // A rejected first proposal leaves the conflict blocked.
    const only = accept([], fb("fbx", ORIGINAL), decision("r", V1_AT, { status: "rejected" }));
    expect(ocfOf(reconcile(A, NOW1, only.history))?.receipt?.outcome.kind).toBe("blocked");
  });

  it("revocation is a new record; the revoked version stays as it was", () => {
    const v1 = withV1();
    const rev = unwrap(
      revokeRuleVersion({
        history: v1.history,
        targetId: "ocf-authority/v1",
        revocation: {
          rationale: "SYNTHETIC: wrong preference",
          evidenceRefs: ["review/synthetic-2"],
        },
        recordedAt: V2_AT,
      }),
    );
    expect(rev.record).toMatchObject({
      id: "ocf-authority/v2",
      status: "revoked",
      revokes: "ocf-authority/v1",
      action: ORIGINAL,
    });
    expect(rev.history).toHaveLength(2);
    expect(rev.history.find((r) => r.id === "ocf-authority/v1")).toEqual(v1.record);
    expect(rev.receipt).toMatchObject({
      kind: "revoked",
      previous: { id: "ocf-authority/v1" },
      next: null,
    });
    expect(ocfOf(reconcile(A, NOW2, rev.history))?.receipt?.outcome.kind).toBe("blocked");
    expect(ocfOf(reconcile(A, NOW1, rev.history))?.value?.cents).toBe(-78_600_000);
    // Revoking twice, or revoking a revocation, is refused.
    const again = revokeRuleVersion({
      history: rev.history,
      targetId: "ocf-authority/v1",
      revocation: { rationale: "x", evidenceRefs: ["r"] },
      recordedAt: NOW2,
    });
    expect(again).toMatchObject({ ok: false });
  });

  it("rollback selects the preceding version for new work only", () => {
    const v2 = withV2();
    const roll = unwrap(
      rollbackRule({
        history: v2.history,
        ruleId: "ocf-authority",
        revocation: {
          rationale: "SYNTHETIC: amendment preference was premature",
          evidenceRefs: ["review/synthetic-3"],
        },
        recordedAt: ROLLBACK_AT,
      }),
    );
    expect(roll.record).toMatchObject({ id: "ocf-authority/v3", revokes: "ocf-authority/v2" });
    expect(roll.receipt).toMatchObject({
      previous: { id: "ocf-authority/v2" },
      next: { id: "ocf-authority/v1" },
      affectedFields: ["reconciliation.operating_cash_flow.conflict_selection"],
    });
    const after = reconcile(A, NOW3, roll.history);
    expect(ocfOf(after)?.value?.cents).toBe(-78_600_000);
    expect(after.applications[0]).toMatchObject({
      version: { id: "ocf-authority/v1" },
      previous: null,
    });
    // Work at the v2 cutoff still sees v2.
    expect(ocfOf(reconcile(A, NOW2, roll.history))?.value?.cents).toBe(-80_000_000);
    expect(after.resolution.considered.map((c) => c.use)).toEqual([
      "selected",
      "revoked",
      "revocation",
    ]);
  });
});

describe("scope, conflicts and time", () => {
  it("isolates an unrelated company with the same tag and filing layout (SYNTHETIC)", () => {
    const { history } = withV1();
    const forB = reconcile(B, NOW1, history);
    expect(ocfOf(forB, B)?.receipt?.outcome.kind).toBe("blocked");
    expect(forB.resolution.considered).toEqual([
      { id: "ocf-authority/v1", ruleId: "ocf-authority", use: "out_of_scope" },
    ]);
    // Even in A's run, B's key in the same reconciliation stays blocked.
    const forA = reconcile(A, NOW1, history);
    expect(ocfOf(forA, A)?.value?.cents).toBe(-78_600_000);
    expect(ocfOf(forA, B)?.receipt?.outcome.kind).toBe("blocked");
    // Feedback about A can only scope a company rule to A.
    expect(withV1().record.scope).toMatchObject({ cik: A });
    // Another source signature is another scope.
    const other = unwrap(
      resolveRules(history, {
        cik: A,
        schemaVersion: 1,
        sourceSignature: "other_v1",
        cutoff: NOW1,
      }),
    );
    expect(other.slots).toEqual([]);
  });

  it("conflicting equally applicable rules block, independent of order", () => {
    const one = withV1();
    const two = accept(one.history, fb("fb2", AMENDMENT, A, V1_AT), decision("ocf-other", V2_AT));
    expect(two.receipt.conflictsWith).toEqual(["ocf-authority/v1"]);
    const r = reconcile(A, NOW2, two.history);
    expect(ocfOf(r)?.receipt?.outcome.kind).toBe("blocked");
    expect(r.applications).toEqual([]);
    expect(r.resolution.slots).toEqual([
      expect.objectContaining({
        status: "blocked",
        slot: "authority_preference:operating_cash_flow",
      }),
    ]);
    const reversed = reconcile(A, NOW2, [...two.history].reverse());
    expect(reversed).toEqual(r);
    // Agreeing rules from different rule ids also block: nothing picks one by order.
    const same = accept(one.history, fb("fb3", ORIGINAL, A, V1_AT), decision("ocf-dup", V2_AT));
    expect(ocfOf(reconcile(A, NOW2, same.history))?.receipt?.outcome.kind).toBe("blocked");
    // A global rule and a company rule are equally applicable.
    const global = accept(
      one.history,
      fb("fb4", AMENDMENT, A, V1_AT),
      decision("ocf-global", V2_AT, { scope: { kind: "global", userChoiceId: "choice_1" } }),
    );
    expect(unwrap(resolveRules(global.history, task(NOW2))).slots[0]?.status).toBe("blocked");
  });

  it("a present-day rule is rejected for an older cutoff and never backdated", () => {
    const { history } = withV1();
    const old = unwrap(resolveRules(history, task(OLD)));
    expect(old.slots).toEqual([]);
    expect(old.considered[0]?.use).toBe("after_cutoff");
    // effectiveFrom before recordedAt is refused by the contract.
    const back = decideFeedback({
      history: [],
      feedback: fb("fb9", ORIGINAL),
      ...decision("r9", V1_AT, { effectiveFrom: "2022-01-01T00:00:00Z" }),
    });
    expect(back).toMatchObject({
      ok: false,
      errors: [expect.stringContaining("before its recorded time")],
    });
    // A decision before its feedback, or dated before the log's latest decision, is refused.
    const early = decideFeedback({
      history: [],
      feedback: fb("fb9", ORIGINAL),
      ...decision("r9", "2026-10-24T09:00:00Z"),
    });
    expect(early).toMatchObject({ ok: false });
    const stale = decideFeedback({
      history,
      feedback: fb("fb9", AMENDMENT, A, "2022-01-01T00:00:00Z"),
      ...decision("r9", "2023-01-01T00:00:00Z"),
    });
    expect(stale).toMatchObject({ ok: false, errors: [expect.stringContaining("never backdate")] });
    // The stamp is the backend's: a decision cannot carry its own recordedAt.
    const own = decideFeedback({
      history: [],
      feedback: fb("fb9", ORIGINAL),
      ...decision("r9", V1_AT, { recordedAt: "2022-11-03T20:00:00Z" } as never),
    });
    expect(own).toMatchObject({ ok: false, errors: [expect.stringContaining("backend stamp")] });
    // Auditor repro: a decision dated 2022 but recorded (stamped) today is refused, and
    // the same decision with no claimed date only takes effect at its stamp.
    const claimed = decideFeedback({
      history: [],
      feedback: fb("fb9", CANDIDATE),
      ...decision("m9", V1_AT, { effectiveFrom: "2022-11-03T20:00:00Z" }),
    });
    expect(claimed).toMatchObject({
      ok: false,
      errors: [expect.stringContaining("before its recorded time")],
    });
    const stampedToday = accept([], fb("fb9", CANDIDATE), decision("m9", V1_AT));
    const historical = { ...task("2022-11-03T20:08:14Z"), cik: A };
    expect(unwrap(selectQuarterMethod(stampedToday.history, historical))).toMatchObject({
      source: "default",
    });
    expect(unwrap(selectQuarterMethod(stampedToday.history, task(NOW1)))).toMatchObject({
      source: "rule",
    });
    // A revocation is stamped the same way.
    expect(
      revokeRuleVersion({
        history: stampedToday.history,
        targetId: "m9/v1",
        revocation: { rationale: "x", evidenceRefs: ["r"], effectiveFrom: "2022-01-01T00:00:00Z" },
        recordedAt: NOW1,
      }),
    ).toMatchObject({ ok: false, errors: [expect.stringContaining("before its recorded time")] });
    // A future effectiveFrom applies only from then.
    const later = accept([], fb("fb5", ORIGINAL), decision("r5", V1_AT, { effectiveFrom: NOW2 }));
    expect(unwrap(resolveRules(later.history, task(NOW1))).slots).toEqual([]);
    expect(unwrap(resolveRules(later.history, task(NOW3))).slots[0]?.status).toBe("selected");
  });

  it("validates the log and decisions without throwing", () => {
    const { history, record } = withV1();
    const bad = [
      [record, record],
      [{ ...record, id: "x/v1" }, record],
      [{ ...record, status: "revoked" }],
      [{ ...record, id: "r/v2", version: 2, revokes: "missing", status: "revoked" }, record],
      "nope",
      [null],
    ];
    for (const h of bad) {
      const r = resolveRules(h as never, task(NOW1));
      expect(r.ok).toBe(false);
    }
    expect(resolveRules(history, { ...task(NOW1), cutoff: "2026-10-25" })).toMatchObject({
      ok: false,
    });
    expect(resolveRules(history, null as never)).toMatchObject({ ok: false });
    // Free text alone is never a rule.
    const { proposedAction: _, ...noAction } = fb("fb6", ORIGINAL);
    expect(
      decideFeedback({ history: [], feedback: noAction, ...decision("r6", V1_AT) }),
    ).toMatchObject({
      ok: false,
    });
    // One decision per feedback.
    expect(
      decideFeedback({ history, feedback: fb("fb1", ORIGINAL), ...decision("r7", NOW1) }),
    ).toMatchObject({ ok: false, errors: [expect.stringContaining("already decided")] });
    // An unregistered method cannot be accepted.
    expect(
      decideFeedback({
        history: [],
        feedback: fb("fb8", {
          kind: "method_selection",
          methodId: "secret_sauce",
          version: "1.0.0",
        }),
        ...decision("m", V1_AT),
      }),
    ).toMatchObject({ ok: false });
    // A rule keeps one behavior and one scope.
    expect(
      decideFeedback({
        history,
        feedback: fb("fb10", CANDIDATE),
        ...decision("ocf-authority", NOW1),
      }),
    ).toMatchObject({ ok: false });
    // Caller-owned getters are read once.
    let reads = 0;
    const args = {
      history,
      feedback: fb("fb11", AMENDMENT),
      ...decision("ocf-authority", NOW1),
    } as Parameters<typeof decideFeedback>[0];
    const d = args.decision;
    Object.defineProperty(args, "decision", {
      enumerable: true,
      get: () => {
        reads += 1;
        return reads === 1 ? d : { ...d, status: "rejected" };
      },
    });
    expect(unwrap(decideFeedback(args)).record.status).toBe("accepted");
    expect(reads).toBe(1);
    // reconcileWithRules refuses raw rules: versions must be resolved here.
    expect(
      reconcileWithRules({
        id: "r",
        cik: A,
        cutoff: NOW1,
        computedAt: NOW1,
        sourceSignature: SIG,
        packages: [pkg(A)],
        rules: history,
      } as never),
    ).toMatchObject({ ok: false });
  });
});

const task = (cutoff: string, cik = A): RuleTask => ({
  cik,
  schemaVersion: 1,
  sourceSignature: SIG,
  cutoff,
});

// ---------- Method selection: SYNTHETIC quarter cases ----------

/**
 * SYNTHETIC Q3 case in a given year, same hand math as period-candidate.test.ts, with a
 * SYNTHETIC package whose rows the case's YTD facts are (L1 fact shape).
 */
function quarterInput(year: number, cik = A): QuarterCandidateInput {
  const yy = String(year).slice(2);
  const cur = `${cik}-${yy}-000002`;
  const pri = `${cik}-${yy}-000001`;
  const at = `${year}-11-05T21:00:00Z`;
  const origin = `${year}-09-30`;
  const rows = [
    { tag: OCF, acc: cur, raw: "-90000", end: origin },
    { tag: ICF, acc: cur, raw: "-30000", end: origin },
    { tag: OCF, acc: pri, raw: "-40000", end: `${year}-06-30` },
    { tag: ICF, acc: pri, raw: "-10000", end: `${year}-06-30` },
  ];
  const records = rows.map((r, i) => ({
    id: `us-gaap:${r.tag}:USD:${i >> 1}`,
    accession: r.acc,
    taxonomy: "us-gaap",
    tag: r.tag,
    unit: "USD",
    pointer: `/facts/us-gaap/${r.tag}/units/USD/${i >> 1}`,
    rawValue: r.raw,
    period: { kind: "duration", start: `${year}-01-01`, end: r.end },
  }));
  const pkgQ = SourcePackageSchema.parse({
    schemaVersion: 1,
    id: `synthetic-q-${cik}`,
    format: "sec_companyfacts_v1",
    provenance: "synthetic_fixture",
    company: { cik, name: `SYNTHETIC Co ${cik}` },
    originalUrl: `https://example.test/q-${cik}.json`,
    retrievedAt: "2040-01-01T00:00:00Z",
    rawContentHash: "c".repeat(64),
    submissionsContentHash: "d".repeat(64),
    accessions: [
      {
        accession: cur,
        form: "10-Q",
        acceptedAt: at,
        reportPeriod: { kind: "instant", date: origin },
      },
      {
        accession: pri,
        form: "10-Q",
        acceptedAt: `${year}-08-05T21:00:00Z`,
        reportPeriod: { kind: "instant", date: `${year}-06-30` },
      },
    ],
    records,
  });
  const source = `source/${cur}`;
  const base = {
    currency: "USD",
    availableAt: at,
    sourceId: source,
    reportedScale: "ones" as const,
  };
  const ytd = { kind: "duration" as const, start: `${year}-01-01`, end: origin };
  const zero = (id: string) => ({
    id,
    label: "synthetic" as const,
    description: `SYNTHETIC zero ${id}`,
    basisFactIds: [],
    value: { unit: "cents" as const, low: 0, high: 0 },
    effectiveFrom: origin,
    dependsOn: [],
    feasibleAtCutoff: "yes" as const,
    selectedAfterReveal: false,
  });
  const c: HistoricalCase = {
    id: "synthetic",
    companyName: "SYNTHETIC Co",
    provenance: "synthetic_fixture",
    currency: "USD",
    sources: [
      {
        id: source,
        title: "SYNTHETIC 10-Q",
        url: "https://example.test/q.json",
        publishedAt: at,
        timezone: "America/New_York",
        retrievedOn: "2026-10-24",
        contentHash: "c".repeat(64),
      },
    ],
    facts: [
      {
        ...base,
        id: "usable",
        kind: "reported",
        metric: "cash_and_equivalents",
        period: { kind: "instant", date: origin },
        cents: 95_000_000,
        locator: "SYNTHETIC usable",
      },
      {
        ...base,
        id: "total",
        kind: "reported",
        metric: "cash_including_restricted",
        period: { kind: "instant", date: origin },
        cents: 100_000_000,
        locator: "SYNTHETIC total",
      },
      {
        ...base,
        id: "ocf",
        kind: "reported",
        metric: "operating_cash_flow",
        period: ytd,
        cents: -9_000_000,
        locator: records[0]?.pointer as string,
      },
      {
        ...base,
        id: "icf",
        kind: "reported",
        metric: "investing_cash_flow",
        period: ytd,
        cents: -3_000_000,
        locator: records[1]?.pointer as string,
      },
    ],
    assumptions: [zero("fin"), zero("fx")],
  };
  return {
    cik,
    case: c,
    knowledgeCutoff: `${year}-11-10T12:00:00Z`,
    originBalanceDate: origin,
    usableCashFactId: "usable",
    totalCashFactId: "total",
    operatingYtdFactId: "ocf",
    investingYtdFactId: "icf",
    financingAssumptionId: "fin",
    fxAssumptionId: "fx",
    sources: {
      packages: [pkgQ],
      sourceSignature: SIG,
      reconciliationId: "rec",
      computedAt: "2026-10-24T12:00:00Z",
    },
  };
}
const totalOf = (r: RuledForecast | ReturnType<typeof quarterForecastWithRules>) => {
  const o = ("ok" in r ? unwrap(r) : r).outcome;
  const f =
    o.status === "baseline"
      ? o.bridge.forecast
      : o.status === "candidate"
        ? o.candidate.forecast
        : [];
  return f.find((p) => p.id === "target_total")?.cents;
};

describe("caller throws never escape", () => {
  it("maps a revoked proxy thrown from caller code to an error at every entry point", () => {
    const r = Proxy.revocable({}, {});
    r.revoke();
    const evil = () =>
      Object.defineProperty({}, "x", {
        enumerable: true,
        get: () => {
          throw r.proxy;
        },
      });
    const calls: [string, () => { ok: boolean }][] = [
      ["decideFeedback", () => decideFeedback(evil() as never)],
      ["resolveRules", () => resolveRules(evil() as never, task(NOW1))],
      ["selectQuarterMethod", () => selectQuarterMethod([], evil() as never)],
      ["revokeRuleVersion", () => revokeRuleVersion(evil() as never)],
      ["rollbackRule", () => rollbackRule(evil() as never)],
      ["reconcileWithRules", () => reconcileWithRules(evil() as never)],
      ["quarterForecastWithRules", () => quarterForecastWithRules(evil() as never)],
      ["quarterCandidate", () => quarterCandidate(evil() as never)],
    ];
    for (const [name, call] of calls) {
      let out: { ok: boolean } | undefined;
      expect(() => {
        out = call();
      }, name).not.toThrow();
      expect(out?.ok, name).toBe(false);
    }
    // A revoked proxy as the argument itself is also an error, not a throw.
    expect(resolveRules(r.proxy as never, task(NOW1)).ok).toBe(false);
    expect(quarterCandidate(r.proxy as never).ok).toBe(false);
  });
});

describe("method selection", () => {
  const methodRule = () =>
    accept(
      [],
      fb("fbm", CANDIDATE),
      decision("quarter-method", V1_AT, { rationale: "SYNTHETIC: try C" }),
    );

  it("an accepted method rule changes a later forecast, with affected fields", () => {
    const { history, receipt } = methodRule();
    expect(receipt.affectedFields).toEqual([
      "forecast.method",
      "forecast.target_total",
      "forecast.target_usable",
    ]);
    // A SYNTHETIC present-day quarter (cutoff 2026-11-10, after the rule) uses C.
    const now = unwrap(
      quarterForecastWithRules({
        history,
        input: quarterInput(2026),
      }),
    );
    expect(now.selection).toMatchObject({
      status: "selected",
      source: "rule",
      method: { methodId: "quarterly_cash_last_quarter" },
    });
    expect(now.outcome.status).toBe("candidate");
    // Same hand math as the candidate's Q3 test: 94,336,957 vs B's 96,000,000.
    expect(totalOf(now)).toBe(94_336_957);
    expect(now.application).toMatchObject({
      slot: QUARTER_METHOD_SLOT,
      previous: null,
      reason: "SYNTHETIC: try C",
      affectedFields: ["forecast.method", "forecast.target_total", "forecast.target_usable"],
    });
  });

  it("the same rule cannot reach a forecast whose cutoff precedes it", () => {
    const { history } = methodRule();
    const old = unwrap(
      quarterForecastWithRules({
        history,
        input: quarterInput(2022),
      }),
    );
    expect(old.selection).toMatchObject({ status: "selected", source: "default" });
    expect(old.outcome.status).toBe("baseline");
    expect(totalOf(old)).toBe(96_000_000);
    expect(old.resolution.considered[0]?.use).toBe("after_cutoff");
    // Another company keeps the default too.
    expect(unwrap(selectQuarterMethod(history, task(NOW1, B)))).toMatchObject({
      source: "default",
    });
  });

  it("company A's method rule never reaches company B's forecast (SYNTHETIC)", () => {
    const { history } = methodRule();
    const forB = unwrap(quarterForecastWithRules({ history, input: quarterInput(2026, B) }));
    expect(forB.selection).toMatchObject({ source: "default" });
    expect(forB.resolution.considered[0]?.use).toBe("out_of_scope");
    // A's input carrying B's packages is refused, and a separate company argument is too.
    const mixed = { ...quarterInput(2026), sources: quarterInput(2026, B).sources };
    expect(quarterForecastWithRules({ history, input: mixed })).toMatchObject({ ok: false });
    expect(
      quarterForecastWithRules({ history, input: quarterInput(2026, B), cik: A } as never),
    ).toMatchObject({ ok: false });
  });

  it("competing method rules block the forecast; nothing falls back", () => {
    const one = methodRule();
    const two = accept(
      one.history,
      fb("fbm2", { ...CANDIDATE, methodId: "quarterly_cash_bridge" }, A, V1_AT),
      decision("quarter-method-2", V2_AT),
    );
    const r = unwrap(
      quarterForecastWithRules({
        history: two.history,
        input: quarterInput(2026),
      }),
    );
    expect(r.outcome.status).toBe("blocked");
    expect(r.selection).toMatchObject({
      status: "blocked",
      ruleIds: ["quarter-method-2/v1", "quarter-method/v1"],
    });
  });

  it("rolling a method rule back restores the baseline for new work", () => {
    const one = methodRule();
    const roll = unwrap(
      rollbackRule({
        history: one.history,
        ruleId: "quarter-method",
        revocation: {
          rationale: "SYNTHETIC: back to B",
          evidenceRefs: ["r"],
        },
        recordedAt: "2026-11-11T00:00:00Z",
      }),
    );
    expect(roll.receipt.next).toBeNull();
    const later = quarterInput(2027);
    expect(
      totalOf(
        quarterForecastWithRules({
          history: roll.history,
          input: later,
        }),
      ),
    ).toBe(96_000_000);
    // A 2026 forecast (cutoff 2026-11-10) predates the rollback and still uses C.
    expect(
      totalOf(
        quarterForecastWithRules({
          history: roll.history,
          input: quarterInput(2026),
        }),
      ),
    ).toBe(94_336_957);
  });
});

it("is exported from the engine index", () => {
  expect(engineIndex.decideFeedback).toBe(decideFeedback);
  expect(engineIndex.resolveRules).toBe(resolveRules);
  expect(engineIndex.reconcileWithRules).toBe(reconcileWithRules);
  expect(engineIndex.rollbackRule).toBe(rollbackRule);
  expect(engineIndex.quarterForecastWithRules).toBe(quarterForecastWithRules);
});
