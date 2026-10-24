import { describe, expect, it } from "vitest";
import { fixtures } from "./fixtures";
import {
  BranchSchema,
  ConstraintConsequenceSchema,
  ConstraintSchema,
  DealSchema,
  DominoContextSchema,
  type Engine,
  FixCandidateSchema,
  FixScoreContextSchema,
  SnapshotSchema,
} from "./index";

const invoice = fixtures.snapshot.invoices[0]!;
const linkedDeal = {
  ...fixtures.snapshot.deals[0]!,
  invoiceId: invoice.id,
  kind: "renewal" as const,
};
const linkedSnapshot = () => ({ ...fixtures.snapshot, deals: [linkedDeal] });

describe("deal invoice identity", () => {
  it("preserves omitted, null and explicit links and all deal kinds", () => {
    const { invoiceId: _, kind: __, ...legacy } = linkedDeal;
    expect(DealSchema.parse(legacy)).toEqual(legacy);
    expect(DealSchema.parse({ ...legacy, invoiceId: null }).invoiceId).toBeNull();
    for (const kind of ["new_business", "renewal", "expansion"] as const) {
      const deal = { ...linkedDeal, kind };
      expect(DealSchema.parse(JSON.parse(JSON.stringify(deal)))).toEqual(deal);
    }
    expect(DealSchema.safeParse({ ...legacy, kind: "unknown" }).success).toBe(false);
    expect(DealSchema.safeParse({ ...legacy, invoiceId: "" }).success).toBe(false);
  });

  it("accepts legacy snapshots without guessing links or rejecting unrelated duplicates", () => {
    const snapshot = {
      ...fixtures.snapshot,
      deals: fixtures.snapshot.deals.map(({ invoiceId: _, kind: __, ...deal }) => deal),
    };
    snapshot.invoices = [...snapshot.invoices, invoice];
    expect(SnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(
      SnapshotSchema.parse({ ...snapshot, deals: [{ ...linkedDeal, invoiceId: null }] }),
    ).toHaveProperty("deals.0.invoiceId", null);
  });

  it("retains full links even when the invoice is already paid", () => {
    const snapshot = linkedSnapshot();
    snapshot.invoices = snapshot.invoices.map((item) => ({ ...item, paid: "2026-10-30" }));
    expect(SnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
  });

  it.each(["missing", "duplicate", "customer", "amount", "shared"])(
    "rejects an explicit %s link error at the deal reference",
    (error) => {
      const snapshot = linkedSnapshot();
      if (error === "missing") snapshot.deals = [{ ...linkedDeal, invoiceId: "missing" }];
      if (error === "duplicate") snapshot.invoices = [...snapshot.invoices, invoice];
      if (error === "customer") snapshot.deals = [{ ...linkedDeal, customerId: "other" }];
      if (error === "amount") snapshot.deals = [{ ...linkedDeal, amount: linkedDeal.amount + 1 }];
      if (error === "shared") snapshot.deals = [linkedDeal, { ...linkedDeal, id: "other" }];
      const result = SnapshotSchema.safeParse(snapshot);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path[0] === "deals")).toBe(true);
      }
    },
  );
});

describe("constraint execution metadata", () => {
  const legacy = { ...fixtures.constraints[0]!, kind: "pay_by_date" as const, limit: 2 };
  const consequence = { label: "Service may pause", evidence: legacy.evidence };

  it("accepts omitted targets and retains an explicit bill and evidenced consequence", () => {
    expect(ConstraintSchema.parse(legacy)).toEqual(legacy);
    expect(ConstraintConsequenceSchema.parse(consequence)).toEqual(consequence);
    const constraint = { ...legacy, billId: "bill_cloud_q1", consequence };
    expect(ConstraintSchema.parse(JSON.parse(JSON.stringify(constraint)))).toEqual(constraint);
    expect(ConstraintSchema.parse({ ...constraint, limit: 0 }).limit).toBe(0);
  });

  it.each([-1, 0.5])("rejects pay_by_date limit %s", (limit) => {
    expect(ConstraintSchema.safeParse({ ...legacy, limit }).success).toBe(false);
  });

  it.each(["min_cash", "min_runway_months"])("rejects a bill target for %s", (kind) => {
    expect(ConstraintSchema.safeParse({ ...legacy, kind, billId: "bill_cloud_q1" }).success).toBe(
      false,
    );
  });

  it("rejects empty bill IDs and incomplete consequences", () => {
    expect(ConstraintSchema.safeParse({ ...legacy, billId: "" }).success).toBe(false);
    expect(ConstraintConsequenceSchema.safeParse({ ...consequence, label: "" }).success).toBe(
      false,
    );
    expect(
      ConstraintSchema.safeParse({ ...legacy, consequence: { label: "Unproven" } }).success,
    ).toBe(false);
  });
});

describe("calculation contexts", () => {
  const forecast = fixtures.branches[0]!.forecast;
  const changes = fixtures.branches[1]!.changes;

  it("requires complete model and changes, and retains an optional baseline", () => {
    const context = { model: fixtures.model, changes };
    expect(DominoContextSchema.parse(context)).toEqual(context);
    expect(DominoContextSchema.parse({ ...context, baseline: forecast })).toEqual({
      ...context,
      baseline: forecast,
    });
    for (const invalid of [
      { model: fixtures.model },
      { changes },
      { ...context, changes: [{}] },
      { ...context, baseline: { weeks: [] } },
    ]) {
      expect(DominoContextSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("requires explicit ancestry, including an empty sequence", () => {
    expect(FixScoreContextSchema.parse({ ancestorChanges: [] })).toEqual({ ancestorChanges: [] });
    expect(FixScoreContextSchema.parse({ ancestorChanges: changes })).toEqual({
      ancestorChanges: changes,
    });
    expect(FixScoreContextSchema.safeParse({}).success).toBe(false);
    expect(FixScoreContextSchema.safeParse({ ancestorChanges: [{}] }).success).toBe(false);
  });

  it("keeps legacy implementations and calls compatible with optional trailing contexts", () => {
    const legacy: Pick<Engine, "dominoes" | "scoreFix"> = {
      dominoes: (_forecast, _constraints, _snapshot) => [],
      scoreFix: (parent, _fix, _snapshot, _model, _constraints) => parent,
    };
    expect(legacy.dominoes(forecast, fixtures.constraints, fixtures.snapshot)).toEqual([]);
    expect(
      legacy.dominoes(forecast, fixtures.constraints, fixtures.snapshot, {
        model: fixtures.model,
        changes,
      }),
    ).toEqual([]);
    const args = [
      fixtures.branches[0]!,
      fixtures.fixes[0]!,
      fixtures.snapshot,
      fixtures.model,
      fixtures.constraints,
    ] as const;
    expect(legacy.scoreFix(...args)).toBe(args[0]);
    expect(legacy.scoreFix(...args, { ancestorChanges: [] })).toBe(args[0]);
  });
});

describe("explicit risk targets", () => {
  it("preserves missing, empty and nonempty branch and fix targets", () => {
    const { riskIds: _, ...legacyBranch } = fixtures.branches[0]!;
    const { targetRiskIds: __, ...legacyFix } = fixtures.fixes[0]!;
    expect(BranchSchema.parse(legacyBranch)).toEqual(legacyBranch);
    expect(FixCandidateSchema.parse(legacyFix)).toEqual(legacyFix);
    for (const ids of [[], ["risk_acme_late", "risk_nw_churn"]]) {
      expect(BranchSchema.parse({ ...legacyBranch, riskIds: ids }).riskIds).toEqual(ids);
      expect(FixCandidateSchema.parse({ ...legacyFix, targetRiskIds: ids }).targetRiskIds).toEqual(
        ids,
      );
    }
  });

  it.each([["risk_acme_late", "risk_acme_late"], [""]])(
    "rejects invalid target list %s",
    (...ids) => {
      expect(BranchSchema.safeParse({ ...fixtures.branches[0], riskIds: ids }).success).toBe(false);
      expect(
        FixCandidateSchema.safeParse({ ...fixtures.fixes[0], targetRiskIds: ids }).success,
      ).toBe(false);
    },
  );

  it("gives fixtures explicit identity and cumulative targets", () => {
    expect(fixtures.snapshot.deals[0]).toMatchObject({
      invoiceId: "inv_acme_2027",
      kind: "renewal",
    });
    expect(fixtures.snapshot.deals[1]).toMatchObject({ invoiceId: null, kind: "expansion" });
    expect(fixtures.branches.map((branch) => branch.riskIds)).toEqual([
      [],
      ["risk_acme_late"],
      ["risk_acme_late"],
      ["risk_acme_late"],
      ["risk_nw_churn"],
    ]);
    expect(fixtures.fixes.map((fix) => fix.targetRiskIds)).toEqual([
      ["risk_acme_late"],
      ["risk_acme_late"],
    ]);
    expect(fixtures.risks[1]?.evidence).toEqual([
      { source: "stripe", ref: "inv_nw_q4", note: expect.stringContaining("hypothetical") },
    ]);
  });

  it("includes each applicable fixture fix once and leaves other universes unchanged", () => {
    for (const universe of fixtures.resilienceWithFixes.universes) {
      const applicable = fixtures.fixes.filter(
        (fix) =>
          fix.targetRiskIds?.some((id) => universe.riskIds.includes(id)) ||
          fix.targetRiskIds?.length === 0,
      );
      expect(universe.fixIds).toEqual(applicable.map((fix) => fix.id));
      if (!applicable.length) {
        const baseline = fixtures.resilience.universes.find(
          (candidate) => candidate.riskIds.join() === universe.riskIds.join(),
        );
        expect(universe.forecast).toEqual(baseline?.forecast);
      }
    }
  });
});
