import { fixtures } from "@domino/contracts/fixtures";
import { createProfileCompany } from "@domino/sim";
import { describe, expect, it } from "vitest";
import { FIELD_COMPANIES } from "../../../convex/lib/fieldCompanies";
import { clampLabel, lowestProjectedIndex, stepWeek } from "./charts";
import { pickRisks } from "./data";
import { type CashPoint, type DashboardView, deriveDashboard } from "./derive";
import { type AnalystLatest, analystRisks, illustrativeRisks } from "./risks";
import { TIMELINE_PENDING_TEXT, timelineHref } from "./timeline";

const MODEL = { version: 1, customerDelayDays: {}, recurringSpend: [], rules: [] };

function viewOf(profile: (typeof FIELD_COMPANIES)[number]["id"]): DashboardView {
  const snapshot = createProfileCompany(profile, 1).snapshot;
  const r = deriveDashboard({ snapshot, model: MODEL, constraints: fixtures.constraints });
  if (!r.ok) throw new Error(r.message);
  return r.view;
}

describe("lowest projected cash", () => {
  it("is the same week and amount in the tile (view.lowest) and the chart", () => {
    for (const c of FIELD_COMPANIES) {
      const v = viewOf(c.id);
      const i = lowestProjectedIndex(v.cashLine);
      expect(v.cashLine[i]?.label).toBe("week");
      expect({ weekStart: v.cashLine[i]?.weekStart, usable: v.cashLine[i]?.usable }).toEqual(
        v.lowest,
      );
    }
  });

  it("never counts today, even when today is the lowest point", () => {
    const points: CashPoint[] = [
      { weekStart: "2026-11-01", label: "today", usable: 100 },
      { weekStart: "2026-11-02", label: "week", usable: 500 },
      { weekStart: "2026-11-09", label: "week", usable: 300 },
      { weekStart: "2026-11-16", label: "week", usable: 400 },
    ];
    expect(lowestProjectedIndex(points)).toBe(2);
    expect(lowestProjectedIndex(points.slice(0, 1))).toBe(-1);
  });

  it("keeps the first week on a tie, like the engine", () => {
    const points: CashPoint[] = [
      { weekStart: "2026-11-01", label: "today", usable: 900 },
      { weekStart: "2026-11-02", label: "week", usable: 300 },
      { weekStart: "2026-11-09", label: "week", usable: 300 },
    ];
    expect(lowestProjectedIndex(points)).toBe(1);
  });
});

describe("chart annotations and keys", () => {
  const plot = { left: 50, right: 450, top: 20, bottom: 280 };
  it("keeps labels 12px inside the plot", () => {
    expect(clampLabel(52, 400, plot, 100)).toEqual({ x: 62, y: 268, anchor: "start" });
    expect(clampLabel(448, 0, plot, 100)).toEqual({ x: 438, y: 38, anchor: "end" });
    expect(clampLabel(250, 150, plot, 100)).toEqual({ x: 250, y: 150, anchor: "middle" });
  });

  it("steps weeks with arrow keys and stops at the ends", () => {
    expect(stepWeek(0, "ArrowLeft", 14)).toBe(0);
    expect(stepWeek(0, "ArrowRight", 14)).toBe(1);
    expect(stepWeek(13, "ArrowRight", 14)).toBe(13);
    expect(stepWeek(5, "Home", 14)).toBe(0);
    expect(stepWeek(5, "End", 14)).toBe(13);
    expect(stepWeek(5, "Enter", 14)).toBeNull();
  });
});

describe("timeline links", () => {
  it("are disabled for every simulated company until the Timeline merge", () => {
    for (const c of FIELD_COMPANIES) expect(timelineHref(c.id)).toBeNull();
    expect(TIMELINE_PENDING_TEXT).toBe("Timeline opens after the Timeline merge");
  });
});

describe("risk cards", () => {
  const v = viewOf("kestrel-crunch");
  const latest = (scenarios: NonNullable<AnalystLatest>["scenarios"]): AnalystLatest => ({
    asOf: v.asOf,
    scenarios,
  });
  const scenario = (
    id: string,
    over: Partial<NonNullable<AnalystLatest>["scenarios"][number]>,
  ): NonNullable<AnalystLatest>["scenarios"][number] => ({
    id,
    title: `Scenario ${id}`,
    status: "done",
    survives: true,
    breaksAt: null,
    low: 900_000_000,
    lowPointImpact: -1_000,
    bestFix: null,
    ...over,
  });

  it("uses finished analyst scenarios, worst first, with lender-minimum wording", () => {
    const min = v.lenderMinimum?.cents ?? 0;
    const feed = analystRisks(
      latest([
        scenario("a", { lowPointImpact: -5 }),
        scenario("b", {
          survives: false,
          breaksAt: "2026-12-07",
          low: min - 1,
          lowPointImpact: -50,
          bestFix: { label: "Raise a bridge", costNote: "Costs fees", survivesWithFix: true },
        }),
        scenario("c", { status: "working", survives: null, low: null, lowPointImpact: null }),
        scenario("d", {
          survives: false,
          breaksAt: "2026-11-30",
          low: min + 1,
          lowPointImpact: -20,
        }),
        scenario("e", { lowPointImpact: -1 }),
      ]),
      v,
    );
    expect(feed?.source).toBe("analyst");
    expect(feed?.total).toBe(4);
    expect(feed?.cards.map((c) => c.id)).toEqual(["b", "d", "a"]);
    expect(feed?.cards[0]).toMatchObject({
      outcome: "falls_below",
      week: "2026-12-07",
      fix: { label: "Raise a bridge", note: "Costs fees", holds: true },
    });
    expect(feed?.cards[1]?.outcome).toBe("breaks_rule");
    expect(feed?.cards[2]).toMatchObject({ outcome: "stays_above", week: null });
  });

  it("falls back to the illustrative sample when the analyst has nothing finished", () => {
    expect(analystRisks(null, v)).toBeNull();
    expect(
      analystRisks(latest([scenario("x", { status: "working", survives: null })]), v),
    ).toBeNull();
    const result = { ok: true as const, view: v };
    expect(pickRisks(result, null)?.source).toBe("illustrative");
    expect(pickRisks(result, undefined)).toEqual(illustrativeRisks(v));
    expect(pickRisks(result, latest([scenario("a", {})]))?.source).toBe("analyst");
  });

  it("words the illustrative cards against the lender's minimum", () => {
    const feed = illustrativeRisks(v);
    expect(feed.cards.length).toBe(v.risks.length);
    for (const [i, c] of feed.cards.entries()) {
      const r = v.risks[i];
      expect(c.outcome === "stays_above").toBe(r?.failsWeek === null);
      if (c.outcome !== "stays_above") expect(c.outcome).toBe("falls_below");
    }
  });
});
