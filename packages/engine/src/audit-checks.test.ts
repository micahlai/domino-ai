import { FindingSchema, type Snapshot } from "@domino/contracts";
import { fixtures } from "@domino/contracts/fixtures";
import { describe, expect, it } from "vitest";
import { auditSnapshot } from "./audit";
import {
  AUDIT_CHECKERS,
  type CheckerResult,
  type SwarmAuditInput,
  mergeAuditFindings,
  runAuditCheck,
} from "./audit-checks";

const AT = "2026-10-30T18:00:00Z";
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const base = (): Snapshot => clone(fixtures.snapshot);
type Bill = Snapshot["bills"][number];
type Invoice = Snapshot["invoices"][number];

const swarm = (input: SwarmAuditInput, order: readonly string[] = AUDIT_CHECKERS) =>
  mergeAuditFindings(
    order.map((c) => ({
      checker: c as CheckerResult["checker"],
      drafts: runAuditCheck(c as CheckerResult["checker"], input),
    })),
    AT,
  ).findings;

/** A snapshot with something for most legacy checks: a duplicate bill and a changed invoice. */
function messy(): { snapshot: Snapshot; previous: Snapshot } {
  const previous = base();
  const snapshot = base();
  snapshot.bills.push({ ...(snapshot.bills[1] as Bill), id: "bill_agency_nov_2" });
  (snapshot.invoices[0] as Invoice).amount += 100_000;
  snapshot.bankTxns.push({
    id: "txn_future",
    date: "2026-11-20",
    amount: -50_000,
    description: "Future",
  });
  return { snapshot, previous };
}

describe("audit swarm checks", () => {
  it("merged legacy checks equal auditSnapshot exactly", () => {
    const { snapshot, previous } = messy();
    const legacy = auditSnapshot({ snapshot, previous, detectedAt: AT });
    expect(legacy.length).toBeGreaterThanOrEqual(3);
    expect(swarm({ snapshot, previous, detectedAt: AT })).toEqual(legacy);
  });

  it("merge is deterministic whatever order the checkers finish in", () => {
    const { snapshot, previous } = messy();
    const input: SwarmAuditInput = {
      snapshot,
      previous,
      detectedAt: AT,
      tieOut: [
        { name: "Stripe payout = bank deposit", ref: "po_1", detail: "12300 vs 12000 cents" },
      ],
    };
    const forward = swarm(input);
    const backward = swarm(input, [...AUDIT_CHECKERS].reverse());
    const shuffled = swarm(input, [
      "timing",
      "billingEnds",
      "duplicates",
      "crossToolTieOut",
      "amounts",
      "missingExpected",
      "overdueCustomers",
    ]);
    expect(backward).toEqual(forward);
    expect(shuffled).toEqual(forward);
    for (const f of forward) expect(FindingSchema.safeParse(f).success).toBe(true);
  });

  it("drops a finding a second checker reports again, keeping the first checker's", () => {
    const draft = {
      kind: "duplicate" as const,
      severity: "high" as const,
      summary: "x",
      refs: ["b", "a"],
    };
    const { findings, dropped } = mergeAuditFindings(
      [
        { checker: "timing", drafts: [{ ...draft, summary: "from timing", refs: ["a", "b"] }] },
        { checker: "duplicates", drafts: [draft] },
      ],
      AT,
    );
    expect(dropped).toBe(1);
    expect(findings.map((f) => f.summary)).toEqual(["x"]);
  });

  it("turns failed cross-tool checks into conflicts, amount mismatches high", () => {
    const drafts = runAuditCheck("crossToolTieOut", {
      snapshot: base(),
      previous: null,
      detectedAt: AT,
      tieOut: [
        { name: "Gusto payroll = bank debit", ref: "pr_1", detail: "500000 vs 490000 cents" },
        {
          name: "QuickBooks bill payment = bank debit",
          ref: "bill_9",
          detail: "no bank debit with reference bill_9",
        },
        { name: "Gusto payroll = bank debit", ref: "pr_1", detail: "500000 vs 490000 cents" },
      ],
    });
    expect(drafts).toEqual([
      {
        kind: "conflict",
        severity: "high",
        summary: "Gusto payroll = bank debit does not tie out for pr_1: $5000.00 vs $4900.00.",
        refs: ["pr_1"],
      },
      expect.objectContaining({ kind: "conflict", severity: "medium", refs: ["bill_9"] }),
    ]);
  });

  it("flags customers with invoices more than 30 days past due, oldest first", () => {
    const s = base();
    s.asOf = "2027-01-15";
    const drafts = runAuditCheck("overdueCustomers", {
      snapshot: s,
      previous: null,
      detectedAt: AT,
    });
    const acme = drafts.find((d) => d.refs[0] === "cus_acme");
    expect(acme).toMatchObject({
      kind: "unusual_timing",
      severity: "medium",
      refs: ["cus_acme", "inv_acme_2027"],
    });
    const cobalt = drafts.find((d) => d.refs[0] === "cus_cobalt");
    expect(cobalt?.severity).toBe("high");
    // Paid, written off or with an agreed payment date: not overdue.
    for (const i of s.invoices) i.collection = { payOn: "2027-01-20", amount: i.amount };
    expect(
      runAuditCheck("overdueCustomers", { snapshot: s, previous: null, detectedAt: AT }),
    ).toEqual([]);
    expect(
      runAuditCheck("overdueCustomers", { snapshot: base(), previous: null, detectedAt: AT }),
    ).toEqual([]);
  });
});
