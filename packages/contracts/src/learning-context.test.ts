import { describe, expect, it } from "vitest";
import { fixtures } from "./fixtures";
import {
  type BankTxn,
  type CompanyModel,
  type Engine,
  type Forecast,
  type GradeContext,
  GradeContextSchema,
  type LearnContext,
  LearnContextSchema,
  type LearningExample,
  LearningExampleSchema,
  type Snapshot,
} from "./index";

const origin = fixtures.snapshot;
const quietBank: BankTxn[] = [];
const laterBank: BankTxn[] = [
  { id: "txn_after", date: "2026-11-03", amount: 1_000_00, description: "Deposit" },
];
const grade = { forecastAsOf: "2026-10-30", asOf: "2026-11-08", bankWindowComplete: true };
const example = {
  snapshot: origin,
  actualBank: laterBank,
  asOf: "2026-11-08",
  bankWindowComplete: true,
};
const roundTrip = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe("grade context", () => {
  it("round trips an explicit observation window", () => {
    expect(GradeContextSchema.parse(roundTrip(grade))).toEqual(grade);
    const typed: GradeContext = GradeContextSchema.parse(grade);
    expect(typed.bankWindowComplete).toBe(true);
  });

  it.each([
    ["2028-02-28", "2028-02-29"],
    ["2028-02-29", "2028-03-01"],
    ["2026-12-31", "2027-01-01"],
  ])("accepts real calendar dates %s -> %s", (forecastAsOf, asOf) => {
    expect(GradeContextSchema.safeParse({ ...grade, forecastAsOf, asOf }).success).toBe(true);
  });

  it.each([
    ["forecastAsOf", "2026-02-29"],
    ["forecastAsOf", "2026-04-31"],
    ["asOf", "2026-13-01"],
    ["asOf", "2026-11-00"],
    ["asOf", "1900-02-29"],
    ["asOf", "2026-11-8"],
  ])("rejects unreal %s %s at that field", (field, value) => {
    const result = GradeContextSchema.safeParse({ ...grade, [field]: value });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues.map((issue) => issue.path)).toContainEqual([field]);
  });

  it.each([
    ["equal", "2026-10-30"],
    ["reversed", "2026-10-29"],
  ])("rejects %s cutoffs", (_label, asOf) => {
    const result = GradeContextSchema.safeParse({ ...grade, asOf });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues.map((issue) => issue.path)).toContainEqual(["asOf"]);
  });

  it.each([undefined, false, "true", 1])(
    "requires the literal bank window assertion, not %s",
    (flag) => {
      expect(GradeContextSchema.safeParse({ ...grade, bankWindowComplete: flag }).success).toBe(
        false,
      );
    },
  );
});

describe("learning example", () => {
  it("round trips an authentic origin snapshot, including a known quiet window", () => {
    expect(LearningExampleSchema.parse(roundTrip(example))).toEqual(example);
    const quiet: LearningExample = LearningExampleSchema.parse({
      ...example,
      actualBank: quietBank,
    });
    expect(quiet.actualBank).toEqual([]);
  });

  it("accepts plans and expectations dated after the origin", () => {
    const planned: Snapshot = {
      ...origin,
      invoices: origin.invoices.map((invoice) => ({ ...invoice, due: "2027-03-01" })),
      payroll: [...origin.payroll, { id: "pay_future", date: "2027-01-15", amount: 600_000_00 }],
      deals: origin.deals.map((deal) => ({ ...deal, expectedClose: "2027-02-01" })),
    };
    expect(LearningExampleSchema.safeParse({ ...example, snapshot: planned }).success).toBe(true);
  });

  it("accepts observations dated exactly on the origin cutoff", () => {
    const onCutoff: Snapshot = {
      ...origin,
      invoices: origin.invoices.map((invoice) => ({ ...invoice, paid: origin.asOf })),
      bills: origin.bills.map((bill) => ({ ...bill, paid: origin.asOf })),
      cardTxns: origin.cardTxns.map((txn) => ({ ...txn, date: origin.asOf })),
    };
    expect(LearningExampleSchema.safeParse({ ...example, snapshot: onCutoff }).success).toBe(true);
  });

  it.each([
    ["invoices", "paid"],
    ["bills", "paid"],
    ["bankTxns", "date"],
    ["cardTxns", "date"],
  ] as const)("rejects future %s %s in the origin at that record", (records, field) => {
    const snapshot = { ...origin, [records]: [...origin[records]] } as Snapshot;
    const list = snapshot[records] as Record<string, unknown>[];
    list[0] = { ...list[0], [field]: "2026-10-31" };
    const result = LearningExampleSchema.safeParse({ ...example, snapshot });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path)).toContainEqual([
        "snapshot",
        records,
        0,
        field,
      ]);
    }
  });

  it.each([
    ["equal", "2026-10-30"],
    ["reversed", "2026-10-01"],
  ])("rejects %s cutoffs", (_label, asOf) => {
    const result = LearningExampleSchema.safeParse({ ...example, asOf });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues.map((issue) => issue.path)).toContainEqual(["asOf"]);
  });

  it("rejects unreal origin and cutoff dates", () => {
    for (const invalid of [
      { ...example, snapshot: { ...origin, asOf: "2026-02-29" } },
      { ...example, asOf: "2026-11-31" },
    ]) {
      expect(LearningExampleSchema.safeParse(invalid).success).toBe(false);
    }
    const leap = { ...example, snapshot: { ...origin, asOf: "2028-02-29" }, asOf: "2028-03-06" };
    expect(LearningExampleSchema.safeParse(leap).success).toBe(true);
  });

  it("requires the literal bank window assertion and a valid origin snapshot", () => {
    const { bankWindowComplete: _, ...missing } = example;
    for (const invalid of [
      missing,
      { ...example, bankWindowComplete: false },
      {
        ...example,
        snapshot: { ...origin, deals: [{ ...origin.deals[0], invoiceId: "missing" }] },
      },
      { ...example, actualBank: [{ id: "txn", date: "2026-11-02", amount: 1.5, description: "" }] },
    ]) {
      expect(LearningExampleSchema.safeParse(invalid).success).toBe(false);
    }
  });
});

describe("learn context", () => {
  const later = { ...example, snapshot: { ...origin, asOf: "2026-11-06" }, asOf: "2026-11-15" };
  const otherCompany = { ...example, snapshot: { ...origin, companyId: "co_other" } };

  it("accepts empty and distinct origins", () => {
    expect(LearnContextSchema.parse({ examples: [] })).toEqual({ examples: [] });
    const context = { examples: [example, later, otherCompany] };
    const typed: LearnContext = LearnContextSchema.parse(roundTrip(context));
    expect(typed).toEqual(context);
    expect(LearnContextSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a repeated origin identity even with a different cutoff", () => {
    const repeated = { ...example, asOf: "2026-11-15", actualBank: quietBank };
    const result = LearnContextSchema.safeParse({ examples: [example, later, repeated] });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues.map((issue) => issue.path)).toEqual([["examples", 2]]);
  });

  it("rejects an invalid nested example", () => {
    const contaminated = {
      ...example,
      snapshot: { ...origin, bankTxns: [{ ...origin.bankTxns[0]!, date: "2026-11-01" }] },
    };
    expect(LearnContextSchema.safeParse({ examples: [contaminated] }).success).toBe(false);
  });
});

describe("engine grading and learning signatures", () => {
  const previous: Forecast = fixtures.branches[0]!.forecast;
  const gradeContext = GradeContextSchema.parse(grade);
  const learnContext = LearnContextSchema.parse({ examples: [example] });

  it("keeps legacy implementations and calls compatible with optional trailing contexts", () => {
    const legacy: Pick<Engine, "grade" | "learn"> = {
      grade: (_previous, _actualBank) => ({ errorPct: 0, misses: [] }),
      learn: (_snapshot, model, _history) => model,
    };
    expect(legacy.grade(previous, quietBank)).toEqual({ errorPct: 0, misses: [] });
    expect(legacy.grade(previous, quietBank, gradeContext)).toEqual({ errorPct: 0, misses: [] });
    expect(legacy.learn(origin, fixtures.model, [previous])).toBe(fixtures.model);
    expect(legacy.learn(origin, fixtures.model, [], learnContext)).toBe(fixtures.model);
  });

  it("accepts implementations that read the contexts without changing output shapes", () => {
    const current: Pick<Engine, "grade" | "learn"> = {
      grade: (_previous, _actualBank, context?: GradeContext) => ({
        errorPct: context ? 1 : 0,
        misses: [],
      }),
      learn: (_snapshot, model, _history, context?: LearnContext): CompanyModel =>
        context?.examples.length ? { ...model, version: model.version + 1 } : model,
    };
    expect(current.grade(previous, quietBank, gradeContext).errorPct).toBe(1);
    expect(current.learn(origin, fixtures.model, [], learnContext).version).toBe(
      fixtures.model.version + 1,
    );
    expect(current.learn(origin, fixtures.model, [])).toBe(fixtures.model);
  });
});
