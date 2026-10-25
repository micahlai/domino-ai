import { type Snapshot, SnapshotSchema } from "@domino/contracts";
import { fixtures } from "@domino/contracts/fixtures";
import { cashFlowStatement, cashFlowSummary, engine } from "@domino/engine";
import { createProfileCompany, simulator } from "@domino/sim";
import { describe, expect, it } from "vitest";
import { buildDemo, liveHeader } from "./data";
import { ACTUAL_WEEKS, type DashboardView, deriveDashboard } from "./derive";

const MODEL = { version: 1, customerDelayDays: {}, recurringSpend: [], rules: [] };
const kestrel = () => simulator.createCompany("kestrel", 1).snapshot;

function view(snapshot: Snapshot, constraints = fixtures.constraints): DashboardView {
  const r = deriveDashboard({ snapshot, model: MODEL, constraints });
  if (!r.ok) throw new Error(r.message);
  return r.view;
}

describe("deriveDashboard", () => {
  const s = kestrel();
  const v = view(s);

  it("matches the engine cash flow statement and forecast exactly", () => {
    const st = cashFlowStatement(s, MODEL, [], { weeks: ACTUAL_WEEKS + 1 });
    if (!st.ok) throw new Error(st.error.message);
    const sum = cashFlowSummary(st.value, ACTUAL_WEEKS);
    expect(v.netChange13).toBe(sum.projectedTotals.netChange);
    expect(v.totals.operating).toBe(sum.projectedTotals.operating);
    expect(v.runway.weeks).toBe(sum.runway.weeks);
    expect(v.lowest).toEqual({
      weekStart: sum.lowestProjected?.weekStart,
      usable: sum.lowestProjected?.usable,
    });
    const f = engine.forecast(s, MODEL, []);
    expect(v.cashLine.slice(1).map((p) => p.usable)).toEqual(
      f.weeks.map((w) => w.closing - s.restrictedCash),
    );
    expect(v.lowest?.usable).toBe(f.lowPoint.usable);
  });

  it("keeps every money field an integer and every value JSON-plain", () => {
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
    const walk = (x: unknown): void => {
      if (typeof x === "number") expect(Number.isInteger(x)).toBe(true);
      else if (x && typeof x === "object") Object.values(x).forEach(walk);
      else expect(x).not.toBeUndefined();
    };
    walk(v);
  });

  it("shows actual weeks then 13 projected, and the cash line starts today", () => {
    expect(v.bars.filter((b) => b.kind === "actual")).toHaveLength(ACTUAL_WEEKS + 1);
    expect(v.bars.filter((b) => b.kind === "projected")).toHaveLength(13);
    expect(v.bars.filter((b) => b.partial)).toHaveLength(1);
    expect(v.cashLine[0]).toEqual({
      weekStart: s.asOf,
      label: "today",
      usable: s.cashOnHand - s.restrictedCash,
    });
    expect(v.cashLine).toHaveLength(14);
  });

  it("finds the first week below the lender's minimum and rates it at risk", () => {
    const min = fixtures.constraints.find((c) => c.kind === "min_cash")!.limit;
    const first = v.cashLine.find((p) => p.label === "week" && p.usable < min);
    expect(v.firstBreach).toBe(first?.weekStart ?? null);
    expect(v.health.rating).toBe(first ? "at_risk" : v.health.rating);
    if (first && v.lowest) expect(v.health.cents).toBe(min - v.lowest.usable);
    expect(v.roomToday).toBe(s.cashOnHand - s.restrictedCash - min);
  });

  it("rates OK when the low point stays well above the minimum", () => {
    const rich = SnapshotSchema.parse({ ...s, cashOnHand: s.cashOnHand + 2_000_000_000 });
    const ok = view(rich);
    expect(ok.firstBreach).toBeNull();
    expect(ok.health.rating).toBe("ok");
    expect(ok.health.cents).toBe(ok.roomAtLow);
  });

  it("works without a lender's minimum", () => {
    const none = view(s, []);
    expect(none.lenderMinimum).toBeNull();
    expect(none.roomAtLow).toBeNull();
  });

  it("splits next two weeks into money in and out from the scheduled items", () => {
    const { inflows, outflows, items, weeks } = v.next2Weeks;
    expect(weeks).toEqual([v.forecastStart, "2026-11-09"]);
    expect(inflows).toBeGreaterThan(0);
    expect(outflows).toBeLessThan(0);
    expect(items.every((i) => weeks.includes(i.dueWeek))).toBe(true);
  });

  it("buckets overdue invoices by days late", () => {
    const late = SnapshotSchema.parse({
      ...s,
      invoices: [
        ...s.invoices,
        {
          id: "inv_t1",
          customerId: s.customers[0]!.id,
          amount: 10_000,
          issued: "2026-08-01",
          due: "2026-10-20",
        },
        {
          id: "inv_t2",
          customerId: s.customers[0]!.id,
          amount: 20_000,
          issued: "2026-05-01",
          due: "2026-07-01",
        },
      ],
    });
    const o = view(late).overdue;
    expect(o.count).toBe(v.overdue.count + 2);
    expect(o.buckets[0]!.cents - v.overdue.buckets[0]!.cents).toBe(10_000);
    expect(o.buckets[3]!.cents - v.overdue.buckets[3]!.cents).toBe(20_000);
  });

  it("returns up to three sample risks computed through the engine", () => {
    expect(v.risks.length).toBeGreaterThan(0);
    expect(v.risks.length).toBeLessThanOrEqual(3);
    for (const r of v.risks) expect(r.impact).toBeLessThanOrEqual(0);
  });

  it("is deterministic", () => {
    expect(view(kestrel())).toEqual(v);
  });
});

describe("dashboard adapter", () => {
  it("builds the demo from the selected picker company through the same derivation", () => {
    for (const [profile, name, rating] of [
      ["kestrel", "Kestrel Data", "ok"],
      ["kestrel-crunch", "Osprey Insights", "at_risk"],
    ] as const) {
      const d = buildDemo(profile);
      const snapshot = createProfileCompany(profile, 1).snapshot;
      expect(d.result).toEqual(
        deriveDashboard({ snapshot, model: MODEL, constraints: fixtures.constraints }),
      );
      expect(d.header.name).toBe(name);
      expect(d.header.agent.state).toBe("demo");
      expect(d.header.asOf).toBe(snapshot.asOf);
      expect(d.result.ok && d.result.view.health.rating).toBe(rating);
    }
  });

  it("maps the live summary into the header", () => {
    const h = liveHeader({
      companyId: "c1",
      name: "Kestrel Data (live feed)",
      asOf: "2026-10-30",
      lastSnapshotAt: "2026-10-30T10:00:00.000Z",
      lastIngestStatus: "failed",
      lastError: "bank timeout",
      auto: true,
      autoIntervalMs: 45_000,
      sources: { total: 6, connected: 5 },
      openFindings: 4,
      openEscalations: 1,
      result: null,
    });
    expect(h.name).toBe("Kestrel Data");
    expect(h.agent).toEqual({ state: "failed", intervalMs: 45_000, lastError: "bank timeout" });
    expect(h.tools).toEqual({ connected: 5, total: 6, off: [] });
    expect(h.updatedAt).toBe("2026-10-30T10:00:00.000Z");
  });
});
