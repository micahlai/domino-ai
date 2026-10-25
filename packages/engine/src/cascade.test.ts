import {
  type Change,
  ChangeSchema,
  type CompanyModel,
  type Constraint,
  type Snapshot,
} from "@domino/contracts";
import { describe, expect, it } from "vitest";
import { type CascadeInput, cascade } from "./cascade";
import { forecast } from "./forecast";

const noModel: CompanyModel = { version: 0, customerDelayDays: {}, recurringSpend: [], rules: [] };
const doc = { source: "document" as const, ref: "loan.pdf#7", note: "Terms" };
const K = 100_000; // $1,000 in cents

// asOf Friday 2026-10-30; the forecast runs to Sunday 2027-01-31.
function company(cash: number): Snapshot {
  const inv = (id: string, customerId: string, amount: number, due: string) => ({
    id,
    customerId,
    amount,
    issued: "2026-10-01",
    due,
  });
  const bill = (id: string, vendor: string, amount: number, due: string) => ({
    id,
    vendor,
    amount,
    due,
    critical: false,
  });
  return {
    companyId: "t",
    asOf: "2026-10-30",
    cashOnHand: cash,
    restrictedCash: 0,
    customers: [
      { id: "north", name: "Northwind", paymentTermsDays: 30 },
      { id: "acme", name: "Acme", paymentTermsDays: 30 },
      { id: "bolt", name: "Bolt", paymentTermsDays: 30 },
    ],
    invoices: [
      inv("i_n1", "north", 400 * K, "2026-11-10"),
      inv("i_n2", "north", 400 * K, "2026-12-10"),
      inv("i_a1", "acme", 60 * K, "2026-11-20"),
      inv("i_b1", "bolt", 40 * K, "2026-11-25"),
    ],
    bankTxns: [],
    bills: [
      bill("b_aws", "Cloudco", 80 * K, "2026-11-12"),
      bill("b_aws2", "Cloudco", 80 * K, "2026-12-12"),
      bill("b_ads", "Adco", 30 * K, "2026-11-18"),
    ],
    cardTxns: [],
    payroll: [
      { id: "p1", date: "2026-11-06", amount: 150 * K },
      { id: "p2", date: "2026-11-20", amount: 150 * K },
      { id: "p3", date: "2026-12-04", amount: 150 * K },
      { id: "p4", date: "2026-12-18", amount: 150 * K },
      { id: "p5", date: "2027-01-01", amount: 150 * K },
      { id: "p6", date: "2027-01-15", amount: 150 * K },
      { id: "p7", date: "2027-01-29", amount: 150 * K },
    ],
    deals: [],
  };
}
const floor: Constraint = {
  id: "con_min",
  label: "Lender's minimum",
  kind: "min_cash",
  limit: 300 * K,
  evidence: doc,
};
const late: Change[] = [
  { kind: "delay_invoice", invoiceId: "i_n1", days: 30 },
  { kind: "delay_invoice", invoiceId: "i_n2", days: 30 },
];
const input = (over: Partial<CascadeInput> = {}): CascadeInput => ({
  snapshot: company(500 * K),
  model: noModel,
  constraints: [floor],
  baseChanges: [],
  eventChanges: late,
  eventLabel: "Northwind pays 30 days late",
  ...over,
});

describe("cascade", () => {
  it("fires on a lender-minimum breach with waiver and freeze branches", () => {
    const out = cascade(input());
    const top = out.nodes.filter((n) => n.parentId === null);
    expect(top.map((n) => n.trigger.kind)).toContain("lender_minimum");
    const breach = top.filter((n) => n.trigger.kind === "lender_minimum");
    expect(breach.map((n) => n.branchLabel)).toEqual(["Waiver (fee)", "Credit line frozen"]);
    expect(breach[0]?.changes[0]).toMatchObject({ kind: "remove_cash", amount: 10_000 * 100 });
  });

  it("fires on a cash gap before the breach and offers stretch vs draw", () => {
    const out = cascade(input({ snapshot: company(200 * K) }));
    const top = out.nodes.filter((n) => n.parentId === null);
    expect(top[0]?.trigger.kind).toBe("cash_gap");
    expect(top.map((n) => n.branchLabel)).toEqual(["Stretch vendors", "Draw credit line"]);
    const draw = top[1];
    // The draw itself has a consequence: monthly interest.
    expect(out.nodes.some((n) => n.parentId === draw?.id && n.trigger.kind === "credit_draw")).toBe(
      true,
    );
    // The scenario runs out of cash. Stretching vendors does not rescue it, so that branch is
    // terminal (no ordinary knock-ons); the credit draw rescues it, so its effects continue.
    expect(out.outOfCash?.weekStart).toBeDefined();
    expect(top[0]?.outOfCash).not.toBeNull();
    expect(out.nodes.filter((n) => n.parentId === top[0]?.id)).toEqual([]);
    expect(draw?.outOfCash).toBeNull();
  });

  it("fires on the largest customer churning: pause hiring and peers pay later", () => {
    const out = cascade(
      input({
        snapshot: company(5_000 * K),
        eventChanges: [{ kind: "churn", customerId: "north", fromDate: "2026-11-01" }],
      }),
    );
    const shock = out.nodes.filter((n) => n.trigger.kind === "customer_shock");
    expect(shock.map((n) => n.branchLabel)).toEqual(["Pause hiring", "Peers pay later"]);
    expect(shock[1]?.changes).toEqual([
      { kind: "delay_invoice", invoiceId: "i_a1", days: 7 },
      { kind: "delay_invoice", invoiceId: "i_b1", days: 7 },
    ]);
  });

  it("good event: a large new contract pulls hiring forward", () => {
    const out = cascade(
      input({
        snapshot: company(5_000 * K),
        eventChanges: [
          { kind: "add_cash", date: "2026-11-09", amount: 2_000 * K, label: "New contract" },
        ],
      }),
    );
    const top = out.nodes.filter((n) => n.parentId === null);
    expect(top[0]?.trigger.kind).toBe("windfall");
    expect(top[0]?.branchLabel).toBe("Hire sooner");
    expect(top[0]?.lowPoint.usable).toBeLessThan(out.forecast.lowPoint.usable + 1);
  });

  it("good event with a drawn credit line also offers early repayment", () => {
    const draw: Change = {
      kind: "add_cash",
      date: "2026-11-02",
      amount: 500 * K,
      label: "Credit line draw",
    };
    const out = cascade(
      input({
        snapshot: company(5_000 * K),
        baseChanges: [draw],
        eventChanges: [
          { kind: "add_cash", date: "2026-11-09", amount: 2_000 * K, label: "New contract" },
        ],
      }),
    );
    const top = out.nodes.filter((n) => n.parentId === null);
    expect(top.map((n) => n.branchLabel)).toEqual(["Hire sooner", "Prepay debt"]);
    expect(top[1]?.changes[0]).toMatchObject({ kind: "remove_cash", amount: 500 * K });
  });

  it("respects depth, fan-out and node bounds", () => {
    for (const cash of [100 * K, 200 * K, 500 * K]) {
      const out = cascade(input({ snapshot: company(cash) }));
      expect(out.nodes.length).toBeLessThanOrEqual(8);
      expect(Math.max(...out.nodes.map((n) => n.depth))).toBeLessThanOrEqual(3);
      const kids = new Map<string | null, number>();
      for (const n of out.nodes) kids.set(n.parentId, (kids.get(n.parentId) ?? 0) + 1);
      for (const count of kids.values()) expect(count).toBeLessThanOrEqual(2);
      for (const n of out.nodes)
        if (n.parentId !== null) expect(out.nodes.some((p) => p.id === n.parentId)).toBe(true);
    }
    const small = cascade(input({ snapshot: company(200 * K) }), {
      maxDepth: 1,
      maxBranches: 1,
      maxNodes: 8,
    });
    expect(small.nodes).toHaveLength(1);
  });

  it("is deterministic and every number equals forecast() on the applied changes", () => {
    const a = cascade(input({ snapshot: company(200 * K) }));
    const b = cascade(input({ snapshot: company(200 * K) }));
    expect(a).toEqual(b);
    expect(a.nodes.length).toBeGreaterThan(2);
    const s = company(200 * K);
    for (const n of a.nodes) {
      const parent = a.nodes.find((p) => p.id === n.parentId);
      expect(n.allChanges).toEqual([...(parent?.allChanges ?? late), ...n.changes]);
      expect(n.forecast).toEqual(forecast(s, noModel, n.allChanges));
      expect(n.lowPoint).toEqual(n.forecast.lowPoint);
      for (const c of n.changes) expect(ChangeSchema.parse(c)).toEqual(c);
      for (const c of n.changes) if ("date" in c) expect(c.date >= n.trigger.weekStart).toBe(true);
      // Labels stay unique across the complete list (the engine keys added cash by label).
      const labels = n.allChanges.flatMap((c) => ("label" in c ? [c.label] : []));
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it("stops when nothing new is triggered", () => {
    const out = cascade(
      input({
        snapshot: company(50_000 * K),
        eventChanges: [
          { kind: "remove_cash", date: "2026-11-09", amount: 10 * K, label: "Small bill" },
        ],
      }),
    );
    expect(out.nodes).toEqual([]);
  });
});
