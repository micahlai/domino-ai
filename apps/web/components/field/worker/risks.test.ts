import { describe, expect, it } from "vitest";
import { fixtureAnalysis } from "../../timeline/analysis/fixtures";
import type { FinancialOutput } from "../../timeline/analysis/output";
import { buildDemo } from "../dashboard/data";
import type { AnalystLatest } from "../dashboard/risks";
import type { TimelineLink } from "../dashboard/timeline";
import {
  type WatchedRisk,
  orderRisks,
  riskSentence,
  sampleRisks,
  timelineRisks,
  triageRisks,
  watchedRisks,
} from "./risks";

const risk = (over: Partial<WatchedRisk>): WatchedRisk => ({
  id: "r",
  title: "Risk",
  source: "triage",
  status: "below",
  rule: "the lender's minimum",
  week: "2026-12-28",
  low: { cents: 182_702_845, week: null },
  shortfall: 117_297_155,
  href: null,
  ...over,
});

const latest = (scenarios: NonNullable<AnalystLatest>["scenarios"]): AnalystLatest => ({
  asOf: "2026-10-30",
  scenarios,
});
const scenario = (over: Partial<NonNullable<AnalystLatest>["scenarios"][number]>) => ({
  id: "s1",
  title: "Driftwood stops paying",
  status: "done",
  survives: false,
  breaksAt: "2026-12-14",
  low: 250_000_000,
  lowPointImpact: -50_000_000,
  bestFix: null,
  ...over,
});

describe("risks we're watching", () => {
  it("says what happens, the week and the shortfall", () => {
    expect(riskSentence(risk({}))).toBe(
      "Falls below the lender's minimum in the week of Dec 28, short $1.2M.",
    );
    expect(riskSentence(risk({ week: null, shortfall: null }))).toBe(
      "Falls below the lender's minimum.",
    );
    expect(riskSentence(risk({ status: "rule", rule: "minimum runway", shortfall: null }))).toBe(
      "Breaks minimum runway in the week of Dec 28.",
    );
    expect(riskSentence(risk({ status: "holds", low: { cents: 1_419_452_372, week: null } }))).toBe(
      "Stays above the lender's minimum for all 13 weeks. Lowest cash $14.2M.",
    );
  });

  it("puts breaking risks first, then the lowest cash", () => {
    const rows = orderRisks([
      risk({ id: "a", status: "holds", low: { cents: 1, week: null } }),
      risk({ id: "b", low: { cents: 200, week: null } }),
      risk({ id: "c", low: { cents: 100, week: null } }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("reads Field triage scenarios with the gap to the minimum", () => {
    const rows = triageRisks(
      latest([
        scenario({}),
        scenario({ id: "s2", survives: true, breaksAt: null, low: 900_000_000 }),
        scenario({ id: "s3", status: "running", low: null, survives: null }),
      ]),
      300_000_000,
      "/c/kestrel/timeline/analysis?runId=r1",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      status: "below",
      week: "2026-12-14",
      shortfall: 50_000_000,
      href: "/c/kestrel/timeline/analysis?runId=r1",
    });
    expect(rows[1]).toMatchObject({ status: "holds", week: null, shortfall: null });
  });

  it("uses the labelled sample events until Timeline or the analyst has scenarios", () => {
    const demo = buildDemo("kestrel-crunch").result;
    if (!demo.ok) throw new Error("demo books did not tie out");
    const rows = watchedRisks({ timeline: undefined, latest: undefined, view: demo.view });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.source === "sample" && r.href === null)).toBe(true);
    expect(rows).toEqual(orderRisks(sampleRisks(demo.view)));
    const base = demo.view.lowest?.usable ?? 0;
    for (const r of rows) {
      const sample = demo.view.risks.find((s) => s.id === r.id);
      expect(r.low?.cents).toBe(base + (sample?.impact ?? 0));
      expect(r.status).toBe(sample?.failsWeek ? "below" : "holds");
    }
    // Triage replaces the samples.
    expect(
      watchedRisks({ timeline: undefined, latest: latest([scenario({})]), view: demo.view }).map(
        (r) => r.source,
      ),
    ).toEqual(["triage"]);
  });

  it("lists Timeline's saved scenarios first, each linked to the timeline", () => {
    const output = {
      receipts: [],
      chart: { lowPoint: { weekStart: "2026-11-09", usable: 290_000_000 } },
    } as unknown as FinancialOutput;
    const link = {
      timelineCompanyId: "kestrel",
      runId: "run1",
      analysisId: fixtureAnalysis.analysisId,
    } as TimelineLink;
    const timeline = { state: "ready" as const, link, output, analysis: fixtureAnalysis };
    const rows = timelineRisks(timeline);
    expect(rows).toHaveLength(fixtureAnalysis.risks.length);
    for (const r of rows) {
      expect(r.source).toBe("timeline");
      expect(r.href).toMatch(/^\/c\/kestrel\/timeline/);
    }
    const all = watchedRisks({ timeline, latest: latest([scenario({})]), view: null });
    expect(all.map((r) => r.source)).toEqual([...rows.map(() => "timeline"), "triage"]);
    // Still running: nothing from Timeline yet.
    expect(
      timelineRisks({ ...timeline, analysis: { ...fixtureAnalysis, status: "running" } }),
    ).toEqual([]);
  });
});
