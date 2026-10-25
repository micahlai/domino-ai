import { type CompanyModel, type Snapshot, WorldStateSchema } from "@domino/contracts";
import { auditSnapshot, cashFlowStatement, engine, projectedCashFlow } from "@domino/engine";
import { describe, expect, it } from "vitest";
import { lastForecastSunday } from "../create.ts";
import { WINDOW_START, addDays } from "./basics.ts";
import {
  PROFILES,
  PROFILE_IDS,
  advanceProfileWeek,
  companyMetrics,
  createProfileCompany,
  isProfileWorld,
  lowestUsable,
  profileOpeningCash,
  profileTimeline,
} from "./index.ts";

const SEED = Number(process.env.SIM_SEED ?? 1);
const bpsOf = (amount: number, bps: number) => Math.floor((amount * bps) / 10_000);
const EMPTY: CompanyModel = { version: 1, customerDelayDays: {}, recurringSpend: [], rules: [] };
const MIN_CASH = 300_000_000;
const worlds = Object.fromEntries(
  PROFILE_IDS.map((id) => [id, createProfileCompany(id, SEED)]),
) as Record<(typeof PROFILE_IDS)[number], ReturnType<typeof createProfileCompany>>;
const metrics = (id: (typeof PROFILE_IDS)[number]) =>
  companyMetrics(profileTimeline(id, SEED), worlds[id].snapshot);

describe.each(PROFILE_IDS)("profile %s", (id) => {
  const world = worlds[id];
  const { snapshot } = world;

  it("is deterministic for a seed and differs for another seed", () => {
    expect(createProfileCompany(id, SEED)).toEqual(world);
    expect(createProfileCompany(id, SEED + 1).snapshot.bankTxns).not.toEqual(snapshot.bankTxns);
    expect(isProfileWorld(world)).toBe(true);
    expect(world.companyId).toBe(id);
    expect(PROFILES[id].story.length).toBeGreaterThan(200);
  });

  it("is a valid world with unique ids and nothing observed after today", () => {
    expect(WorldStateSchema.safeParse(world).success).toBe(true);
    for (const key of [
      "customers",
      "invoices",
      "bankTxns",
      "bills",
      "cardTxns",
      "payroll",
      "deals",
    ] as const) {
      const ids = snapshot[key].map((r) => r.id);
      expect(new Set(ids).size, key).toBe(ids.length);
    }
    expect(snapshot.bankTxns.every((t) => t.date >= WINDOW_START && t.date <= world.today)).toBe(
      true,
    );
    expect(snapshot.cardTxns.every((t) => t.date <= world.today)).toBe(true);
    expect(snapshot.invoices.every((i) => i.issued <= world.today)).toBe(true);
    expect(snapshot.invoices.every((i) => !i.paid || i.paid <= world.today)).toBe(true);
    expect(snapshot.bills.every((b) => !b.paid || b.paid <= world.today)).toBe(true);
    expect(snapshot.bankTxns.every((t) => Number.isSafeInteger(t.amount) && t.amount !== 0)).toBe(
      true,
    );
  });

  it("rolls the bank balance forward from the opening balance to the cent", () => {
    const opening = profileOpeningCash(id, SEED);
    let running = opening;
    for (const txn of snapshot.bankTxns) running += txn.amount;
    expect(running).toBe(snapshot.cashOnHand);
    const timeline = profileTimeline(id, SEED);
    expect(timeline.openingCash).toBe(opening);
    expect(timeline.balances.get(world.today)).toBe(snapshot.cashOnHand);
  });

  it("names its source record and a keyword in every bank description", () => {
    const ids = new Set(
      [snapshot.invoices, snapshot.bills, snapshot.payroll, snapshot.cardTxns].flatMap((list) =>
        list.map((r) => r.id),
      ),
    );
    for (const txn of snapshot.bankTxns) {
      const tokens = txn.description.split(/[^A-Za-z0-9_-]+/);
      const linked = tokens.some((t) => ids.has(t));
      const own = /\b(rev_draw|rev_repay|eq|int)_\d{4}-\d{2}(-\d{2})?\b/.test(txn.description);
      expect(linked || own, txn.description).toBe(true);
    }
  });

  it("classifies every actual and projected cash flow and ties every week", () => {
    const result = cashFlowStatement(snapshot, EMPTY, [], {
      openingCash: profileOpeningCash(id, SEED),
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.unclassified).toEqual([]);
    expect(result.value.weeks[0]?.weekStart).toBe(WINDOW_START);
    const total = (line: keyof (typeof result.value.weeks)[number]["lines"]) =>
      result.value.weeks.filter((w) => w.kind === "actual").reduce((s, w) => s + w.lines[line], 0);
    expect(total("customer_collections")).toBeGreaterThan(0);
    for (const line of [
      "payroll",
      "supplier_payments",
      "rent_facilities",
      "card_spend",
      "taxes_paid",
      "interest_paid",
      "capex",
      "capitalized_software",
    ] as const)
      expect(total(line), line).toBeLessThan(0);
    expect(total("other_operating"), "interest earned").toBeGreaterThan(0);
    expect(total("other_investing")).toBe(0);
    expect(total("other_financing")).toBe(0);
  });

  it("publishes only consistent records as the feed advances: no audit conflicts", () => {
    let previous = world;
    for (let k = 0; k < 4; k++) {
      const next = advanceProfileWeek(previous);
      expect(next.week).toBe(previous.week + 1);
      expect(next.today).toBe(addDays(previous.today, 7));
      // Earlier bank history never changes.
      expect(next.snapshot.bankTxns.slice(0, previous.snapshot.bankTxns.length)).toEqual(
        previous.snapshot.bankTxns,
      );
      const findings = auditSnapshot({
        snapshot: next.snapshot,
        previous: previous.snapshot,
        detectedAt: `${next.today}T00:00:00Z`,
      });
      const kinds = findings.filter((f) => f.kind !== "unusual_amount").map((f) => f.summary);
      expect(kinds, next.today).toEqual([]);
      previous = next;
    }
  });
});

describe("sanity ranges on generated data", () => {
  it("keeps the healthy company inside normal B2B SaaS ranges", () => {
    for (const id of ["kestrel", "kestrel-churn"] as const) {
      const m = metrics(id);
      expect(m.collectionDays, id).toBeGreaterThanOrEqual(40);
      expect(m.collectionDays, id).toBeLessThanOrEqual(75);
      // The receivables ratio swings with annual renewal timing; only a loose band.
      expect(m.dsoDays, id).toBeGreaterThanOrEqual(25);
      expect(m.dsoDays, id).toBeLessThanOrEqual(90);
      expect(m.payrollShareBps, id).toBeGreaterThanOrEqual(5_000);
      expect(m.payrollShareBps, id).toBeLessThanOrEqual(7_000);
      expect(m.grossMarginBps, id).toBeGreaterThanOrEqual(7_000);
      expect(m.grossMarginBps, id).toBeLessThanOrEqual(8_000);
      expect(m.arr, id).toBeGreaterThan(1_500_000_000);
      expect(m.arr, id).toBeLessThan(2_500_000_000);
    }
  });

  it("shows each profile's story in its metrics", () => {
    const base = metrics("kestrel");
    const late = metrics("kestrel-late");
    const churn = metrics("kestrel-churn");
    const crunch = metrics("kestrel-crunch");
    expect(late.collectionDays).toBeGreaterThanOrEqual(base.collectionDays + 5);
    expect(late.dsoDays).toBeGreaterThanOrEqual(base.dsoDays);
    // Halcyon's plan ends on November 15.
    const mrrAfter = (id: "kestrel" | "kestrel-churn") =>
      profileTimeline(id, SEED).book.mrrOn("2026-11-20");
    expect(churn.arr).toBe(base.arr);
    expect(mrrAfter("kestrel-churn")).toBeLessThan(mrrAfter("kestrel") - 9_000_000);
    expect(crunch.grossMarginBps).toBeGreaterThanOrEqual(7_000);
    expect(crunch.payrollShareBps).toBeLessThanOrEqual(7_500);
    expect(crunch.headcount).toBeGreaterThan(base.headcount);
    expect(crunch.monthlyNetCash).toBeLessThan(0);
    expect(crunch.revolverDrawn).toBeGreaterThan(0);
  });
});

describe("profile stories are visible in the records", () => {
  it("churn: the top customer's plan ends, its renewal is lost and its last invoice is overdue", () => {
    const s = worlds["kestrel-churn"].snapshot;
    expect(s.billingPlans?.find((p) => p.customerId === "cus_halcyon")?.endDate).toBe("2026-11-15");
    expect(s.deals.find((d) => d.customerId === "cus_halcyon")?.stage).toBe("lost");
    const open = s.invoices.find((i) => i.id === "inv_cus_halcyon_2026-08-16");
    expect(open?.paid).toBeUndefined();
    expect(open!.due < s.asOf).toBe(true);
    // It settles at 60% on November 20; healthy Kestrel's Halcyon pays it in full.
    const settle = (id: "kestrel" | "kestrel-churn") =>
      profileTimeline(id, SEED).book.invoices.find((i) => i.id === open!.id)!;
    expect(settle("kestrel-churn")).toMatchObject({ paidOn: "2026-11-20", paidAmount: 17_100_000 });
    expect(settle("kestrel").paidAmount).toBe(28_500_000);
  });

  it("late: large customers' recent invoices were paid 30 to 60 days late", () => {
    const s = worlds["kestrel-late"].snapshot;
    const late = s.invoices.filter(
      (i) =>
        i.paid &&
        i.issued >= "2026-04-01" &&
        (Date.parse(i.paid) - Date.parse(i.due)) / 864e5 >= 30,
    );
    expect(late.length).toBeGreaterThanOrEqual(5);
    const overdue = s.invoices.filter((i) => !i.paid && !i.writtenOff && i.due < s.asOf);
    expect(overdue.reduce((sum, i) => sum + i.amount, 0)).toBeGreaterThan(20_000_000);
  });
});

describe("13-week engine forecast with recurring billing", () => {
  const collectionsAndPayroll = (s: Snapshot) => {
    const result = projectedCashFlow(s, EMPTY, []);
    if (!result.ok) throw new Error(result.error.message);
    const sum = (line: "customer_collections" | "payroll") =>
      result.value.weeks.reduce((t, w) => t + w.lines[line], 0);
    return { collections: sum("customer_collections"), payroll: -sum("payroll") };
  };

  it("keeps healthy collections in a realistic ratio to payroll and above the lender's minimum", () => {
    for (const id of ["kestrel", "kestrel-churn", "kestrel-late"] as const) {
      const s = worlds[id].snapshot;
      const { collections, payroll } = collectionsAndPayroll(s);
      // About $20M ARR against about $16M of payroll a year; renewal timing moves a quarter.
      expect(collections, id).toBeGreaterThan(bpsOf(payroll, 7_000));
      expect(collections, id).toBeLessThan(payroll * 2);
      expect(engine.forecast(s, EMPTY, []).lowPoint.usable, id).toBeGreaterThan(MIN_CASH);
    }
  });

  it("crunch breaches the lender's minimum within 13 weeks, in the forecast and in fact", () => {
    const world = worlds["kestrel-crunch"];
    expect(world.snapshot.cashOnHand - world.snapshot.restrictedCash).toBeGreaterThan(MIN_CASH);
    const forecast = engine.forecast(world.snapshot, EMPTY, []);
    expect(forecast.lowPoint.usable).toBeLessThan(MIN_CASH);
    // What actually happens: advance the feed 13 weeks and replay the bank balance.
    let later = world;
    for (let k = 0; k < 13; k++) later = advanceProfileWeek(later);
    let running = profileOpeningCash("kestrel-crunch", SEED);
    let lowest = Number.POSITIVE_INFINITY;
    for (const txn of later.snapshot.bankTxns) {
      running += txn.amount;
      if (txn.date > world.today)
        lowest = Math.min(lowest, running - later.snapshot.restrictedCash);
    }
    expect(running).toBe(later.snapshot.cashOnHand);
    expect(lowest).toBeLessThan(MIN_CASH);
    const low = lowestUsable(
      profileTimeline("kestrel-crunch", SEED),
      addDays(world.today, 1),
      lastForecastSunday(world.today),
    );
    expect(low.usable).toBeLessThan(MIN_CASH);
  });
});
