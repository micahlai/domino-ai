import { isProfileId } from "@domino/sim";
import { describe, expect, it } from "vitest";
import { emptyOverlay, newWorld, servedSnapshot } from "../fieldFeed";
import {
  JUDGE_STARTS,
  JudgeInputError,
  SURPRISE_PRESETS,
  ScenarioSchema,
  csvRecords,
  csvTemplate,
  judgeChecklist,
  judgeSourcePlan,
  judgeStartOf,
  parseCsv,
  parseDollars,
  plantVendorBankChange,
  rankCustomers,
  surpriseScenario,
  validateCsvRows,
  zodMessage,
} from "../lib/judge";
import { scaleCents } from "../lib/judgeOverlay";

const base = { started: true, scenarioVersions: [], snapshotVersion: 1, decisions: 0 };
const done = (i: Parameters<typeof judgeChecklist>[0]) => judgeChecklist(i).map((s) => s.done);

describe("judge checklist", () => {
  it("ticks each step only from stored state, in order", () => {
    expect(judgeChecklist({ ...base, decisionLogged: false }).map((s) => s.label)).toEqual([
      "Start company",
      "Add a scenario",
      "Watch the agents",
      "Decide a flag",
      "See the record",
    ]);
    expect(done({ ...base, started: false, decisionLogged: false })).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(done({ ...base, decisionLogged: false })).toEqual([true, false, false, false, false]);
    // Submitted on version 1, nothing newer ingested yet.
    expect(done({ ...base, scenarioVersions: [1], decisionLogged: false })).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(
      done({ ...base, scenarioVersions: [1, 2], snapshotVersion: 2, decisionLogged: false }),
    ).toEqual([true, true, true, false, false]);
    expect(
      done({
        ...base,
        scenarioVersions: [1],
        snapshotVersion: 2,
        decisions: 1,
        decisionLogged: false,
      }),
    ).toEqual([true, true, true, true, false]);
    expect(
      done({
        ...base,
        scenarioVersions: [1],
        snapshotVersion: 2,
        decisions: 1,
        decisionLogged: true,
      }),
    ).toEqual([true, true, true, true, true]);
  });
});

describe("scenario validation", () => {
  const msg = (input: unknown) => {
    const r = ScenarioSchema.safeParse(input);
    return r.success ? "ok" : zodMessage(r.error);
  };
  it("checks bounds, integer cents and weeks 1 to 13", () => {
    expect(msg({ kind: "unplanned_expense", amountCents: 100, week: 1 })).toBe("ok");
    expect(msg({ kind: "unplanned_expense", amountCents: 99, week: 1 })).toBe("At least $1");
    expect(msg({ kind: "unplanned_expense", amountCents: 100, week: 0 })).toBe("Weeks run 1 to 13");
    expect(msg({ kind: "unplanned_expense", amountCents: 100.5, week: 1 })).toBe(
      "Amounts are whole cents",
    );
    expect(msg({ kind: "bank_stripe_mismatch", amountCents: -50 })).toContain("between $1");
    expect(msg({ kind: "bank_stripe_mismatch", amountCents: -500 })).toBe("ok");
    expect(msg({ kind: "late_payment", customerId: "c", days: 121 })).toBe("At most 120 days late");
    expect(msg({ kind: "payroll_raise", percent: 5, extra: 1 })).toBe("Unexpected field: extra");
  });
});

describe("CSV", () => {
  it("parses quotes, doubled quotes and CRLF", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n\n1,2')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["1", "2"],
    ]);
  });

  it("parses dollars to integer cents without floats", () => {
    expect(parseDollars("1,250.5")).toBe(125_050);
    expect(parseDollars("-$80")).toBe(-8_000);
    expect(parseDollars("0.07")).toBe(7);
    expect(parseDollars("12.345")).toBeNull();
    expect(parseDollars("1,25")).toBeNull();
    expect(parseDollars("abc")).toBeNull();
    expect(scaleCents(10_001, 1_000)).toBe(11_001);
  });

  it("checks headers and every row", () => {
    expect(csvRecords("bills", "vendor,amount\nA,1")).toEqual({ error: "Missing column: due" });
    expect(csvRecords("bills", "vendor,amount,due,color\nA,1,2026-01-01")).toEqual({
      error: "Unknown column: color",
    });
    const asOf = "2026-10-23";
    const r = csvRecords("invoices", csvTemplate("invoices", asOf, "cus_1"));
    if (!("records" in r)) throw new Error(r.error);
    const ok = validateCsvRows("invoices", r.records, { asOf, customerIds: new Set(["cus_1"]) });
    expect(ok.every((x) => x.errors.length === 0 && x.entry)).toBe(true);
    const bad = validateCsvRows(
      "bankTxns",
      [
        { date: "2027-12-01", amount: "0", description: "x" },
        { date: "2026-10-20", amount: "-15.00", description: "Coffee", counterparty: "Cafe" },
      ],
      { asOf, customerIds: new Set() },
    );
    expect(bad[0]).toEqual({
      line: 2,
      errors: ["date 2027-12-01 is outside 2026-06-25 to 2027-04-21", "amount is zero"],
    });
    expect(bad[1]?.entry).toEqual({
      kind: "bankTxns",
      row: { date: "2026-10-20", amount: -1_500, description: "Coffee", counterparty: "Cafe" },
    });
    const late = validateCsvRows(
      "invoices",
      [{ customer_id: "cus_2", amount: "-5", issued: "2026-10-30", due: "2026-10-01" }],
      { asOf, customerIds: new Set(["cus_1"]) },
    );
    expect(late[0]?.errors).toEqual([
      "customer_id cus_2 is not a customer of this company",
      "amount must be positive",
      "issued 2026-10-30 is after today (2026-10-23)",
      "due is before issued",
    ]);
  });
});

describe("simple judge flow", () => {
  it("maps the four company cards to the four simulator profiles", () => {
    expect(JUDGE_STARTS.map((s) => [s.id, s.profile])).toEqual([
      ["healthy", "kestrel"],
      ["losing_customer", "kestrel-churn"],
      ["late_payers", "kestrel-late"],
      ["cash_crunch", "kestrel-crunch"],
    ]);
    for (const s of JUDGE_STARTS) {
      expect(isProfileId(s.profile)).toBe(true);
      expect(judgeStartOf(s.profile)).toBe(s);
      expect(s.story.length).toBeGreaterThan(0);
      expect(s.outcome).toMatch(/^Expect: /);
    }
    expect(judgeStartOf(null)).toBeUndefined();
  });

  it("plans data sources: all six by default, the bank required, Plaid never on", () => {
    expect(judgeSourcePlan()).toEqual({
      on: ["nessie", "stripe", "ramp", "qbo", "gusto", "hubspot"],
      off: ["plaid"],
    });
    expect(judgeSourcePlan(["stripe", "nessie", "stripe"])).toEqual({
      on: ["nessie", "stripe"],
      off: ["ramp", "qbo", "gusto", "hubspot", "plaid"],
    });
    expect(() => judgeSourcePlan(["stripe", "qbo"])).toThrow(
      "Keep the bank connected: the forecast starts from its cash balance",
    );
    expect(() => judgeSourcePlan([])).toThrow(JudgeInputError);
    expect(() => judgeSourcePlan(["nessie", "plaid"])).toThrow("Unknown data source: plaid");
    // HubSpot deals point at Stripe invoices; without Stripe the first ingest would fail.
    expect(() => judgeSourcePlan(["nessie", "qbo", "hubspot"])).toThrow(
      "HubSpot needs Stripe: its deals point at Stripe invoices",
    );
  });

  it("turns each of the three presets into a valid scenario", () => {
    const served = servedSnapshot(newWorld(1, "kestrel"), emptyOverlay());
    expect(SURPRISE_PRESETS).toEqual([
      "late_big_customer",
      "unexpected_bill",
      "bank_stripe_mismatch",
      "vendor_bank_change",
    ]);
    const top = rankCustomers(served, 1)[0];
    expect(surpriseScenario("late_big_customer", served)).toEqual({
      kind: "late_payment",
      customerId: top?.id,
      days: 45,
    });
    expect(surpriseScenario("unexpected_bill", served)).toEqual({
      kind: "unplanned_expense",
      amountCents: 75_000_000,
      week: 3,
      label: "Unexpected bill",
    });
    expect(surpriseScenario("bank_stripe_mismatch", served)).toEqual({
      kind: "bank_stripe_mismatch",
      amountCents: -1_840_000,
    });
    for (const p of SURPRISE_PRESETS.filter((x) => x !== "vendor_bank_change"))
      expect(ScenarioSchema.safeParse(surpriseScenario(p, served)).success).toBe(true);
    const planted = plantVendorBankChange(served, emptyOverlay(), "1_1");
    expect(planted.overlay.payeeChanges).toHaveLength(1);
    expect(planted.overlay.bills.at(-1)?.id).toBe("judge_payee_1_1");
    expect(() => servedSnapshot(newWorld(1, "kestrel"), planted.overlay)).not.toThrow();
    expect(() => surpriseScenario("late_big_customer", { ...served, customers: [] })).toThrow(
      "This company has no customers to pay late",
    );
  });
});
