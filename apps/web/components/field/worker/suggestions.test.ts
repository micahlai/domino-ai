import { CompanyModelSchema } from "@domino/contracts";
import { projectedCashFlow } from "@domino/engine";
import { createProfileCompany } from "@domino/sim";
import { describe, expect, it } from "vitest";
import { buildDemo } from "../dashboard/data";
import { day, introLine, money, weekOf } from "./format";
import {
  type EffectContext,
  type Suggestion,
  applyDecision,
  cashEffect,
  decideArgs,
  demoSuggestions,
  fixSentence,
  isNotDeployed,
  readSimulationResult,
  roomLine,
  scenarioTitle,
  simulationArgs,
  splitSuggestions,
  toSuggestion,
} from "./suggestions";

const row = (over: Record<string, unknown> = {}) => ({
  id: "sug_1",
  runId: "run_1",
  snapshotVersion: 1,
  scenarioId: "late_biggest_invoice",
  fix: { kind: "credit_draw", amountCents: 120_000_000, week: "2026-12-14" },
  effect: { lowPointCents: 302_702_845, lowPointWeek: "2027-01-25", staysAboveMinimum: true },
  recommendation: "Covers the gap at the low point.",
  status: "open",
  ...over,
});
const suggestion = (over: Record<string, unknown> = {}) => toSuggestion(row(over)) as Suggestion;

describe("worker formatting", () => {
  it("preserves notes for Timeline and rejects unsafe navigation results", () => {
    const note = "  Keep the optional note exactly.\n  ";
    expect(simulationArgs("company/one", suggestion(), note).note).toBe(note);
    expect(() => simulationArgs("company/one", suggestion(), "x".repeat(501))).toThrow();
    const result = {
      timelineCompanyId: "kestrel",
      baselineRunId: "base",
      rootRunId: "root",
      scenarioRunId: "risk",
      fixRunId: "fix",
      conversationId: "chat",
      reused: false,
      scenarioLow: { cents: 100, weekStart: "2026-11-02" },
      fixLow: { cents: 200, weekStart: "2026-11-02" },
      route: "/c/kestrel/timeline?runId=fix&conversationId=chat#timeline-chat",
    };
    expect(readSimulationResult(result)).toEqual(result);
    for (const route of [
      "https://example.com",
      "/c/other/timeline?runId=fix&conversationId=chat#timeline-chat",
      "/c/kestrel/timeline?runId=risk&conversationId=chat#timeline-chat",
    ])
      expect(() => readSimulationResult({ ...result, route })).toThrow();
    expect(() => readSimulationResult({ ...result, conversationId: undefined })).toThrow();
  });
  it("formats money and dates without throwing on bad backend values", () => {
    expect(money(120_000_000)).toBe("$1.2M");
    expect(money(-33_000_000)).toBe("−$330K");
    expect(money(1234.6)).toBe("$12.35");
    expect(money(null)).toBe("unknown");
    expect(day("2026-12-14")).toBe("Dec 14");
    expect(day("2026-12-14T08:00:00.000Z")).toBe("Dec 14");
    expect(day("2026-02-31")).toBeNull();
    expect(weekOf("")).toBeNull();
    expect(weekOf("2026-12-14")).toBe("the week of Dec 14");
  });

  it("writes the one-line intro from the open counts", () => {
    expect(introLine({ suggestions: 2, risks: 1, flags: 3 })).toBe(
      "Here's what needs you: 2 suggestions, 1 risk below the minimum and 3 flags.",
    );
    expect(introLine({ suggestions: 1, risks: 0, flags: 0 })).toBe(
      "Here's what needs you: 1 suggestion.",
    );
    expect(introLine({ suggestions: 0, risks: 0, flags: 0 })).toBe(
      "Here's what needs you: nothing right now.",
    );
    expect(introLine({ suggestions: null, risks: null, flags: null })).toBe(
      "Here's what needs you.",
    );
  });

  it("says the fix in plain words", () => {
    expect(fixSentence(row().fix)).toBe("Draw $1.2M on the credit line in the week of Dec 14");
    expect(fixSentence({ label: "Draw on the credit line", cents: 50_000_000 })).toBe(
      "Draw $500K on the credit line",
    );
    expect(fixSentence({ label: "Delay the Q1 hire", weekStart: "2027-01-04" })).toBe(
      "Delay the Q1 hire in the week of Jan 4",
    );
    expect(fixSentence("Ask Driftwood to pay on time")).toBe("Ask Driftwood to pay on time");
    expect(fixSentence({})).toBe("Suggested fix");
  });
});

describe("suggestions adapter", () => {
  it("passes exact saved suggestion identity and refuses incomplete legacy rows", () => {
    const saved = suggestion({
      id: "suggestion/old",
      runId: "analyst/old",
      scenarioId: "scenario/old",
      snapshotVersion: 4,
      fix: { kind: "delay_bill", label: "Delay a bill" },
    });
    expect(simulationArgs("company/one", saved)).toEqual({
      companyId: "company/one",
      runId: "analyst/old",
      scenarioId: "scenario/old",
      snapshotVersion: 4,
      suggestionId: "suggestion/old",
      fixKind: "delay_bill",
    });
    expect(() => simulationArgs("company/one", suggestion({ runId: undefined }))).toThrow(
      /older suggestion/,
    );
    expect(() => simulationArgs("company/one", suggestion({ snapshotVersion: undefined }))).toThrow(
      /older suggestion/,
    );
    expect(() => simulationArgs("company/one", suggestion({ scenarioId: null }))).toThrow(
      /older suggestion/,
    );
  });
  it("reads backend rows defensively and defaults the author", () => {
    expect(suggestion()).toMatchObject({ id: "sug_1", status: "open", by: "Engine advisors" });
    expect(toSuggestion(row({ id: undefined, _id: "doc1" }))?.id).toBe("doc1");
    expect(toSuggestion(row({ status: "maybe" }))).toBeNull();
    expect(toSuggestion(row({ effect: { lowPointWeek: "2027-01-25" } }))).toBeNull();
    expect(toSuggestion(null)).toBeNull();
  });

  it("reads the swarm API contract and keeps the effect from the same snapshot", () => {
    const s = toSuggestion({
      id: "scenario:credit_line_draw",
      scenarioId: "scenario",
      scenarioTitle: "Largest customer pays late",
      fix: { kind: "credit_line_draw", label: "Draw $1.2M on the credit line" },
      effect: {
        lowPoint: 310_000_000,
        lowWeekStart: "2027-01-25",
        survives: true,
        scenarioLow: 190_000_000,
        lenderMinimum: 300_000_000,
      },
      recommendation: { text: "Covers the gap.", provider: "creao" },
      status: "open",
    });
    expect(s).toMatchObject({ recommendation: "Covers the gap.", by: "CREAO advisor" });
    if (!s) throw new Error("swarm row did not parse");
    const ctx: EffectContext = { baseline: null, scenarios: new Map(), minimum: null };
    expect(cashEffect(s, ctx)).toEqual({
      before: { cents: 190_000_000, week: null },
      after: { cents: 310_000_000, week: "2027-01-25" },
      minimum: 300_000_000,
      stays: true,
    });
    expect(scenarioTitle(s, ctx)).toBe("Largest customer pays late");
    expect(toSuggestion({ ...row(), recommendation: null })?.by).toBe("Engine advisors");
    expect(toSuggestion(row({ effect: { lowPoint: 1.5 } }))).toBeNull();
  });

  it("recognizes the error of a backend that is not deployed yet", () => {
    expect(
      isNotDeployed(new Error("Could not find public function for 'fieldSuggestions:list'")),
    ).toBe(true);
    expect(isNotDeployed(new Error("Server Error"))).toBe(false);
  });

  it("compares the low point before and after against the lender's minimum", () => {
    const ctx: EffectContext = {
      baseline: { cents: 182_702_845, week: "2027-01-25" },
      scenarios: new Map([
        [
          "late_biggest_invoice",
          { cents: 150_000_000, week: null, title: "Driftwood pays 30 days late" },
        ],
      ]),
      minimum: 300_000_000,
    };
    expect(cashEffect(suggestion(), ctx)).toEqual({
      before: { cents: 150_000_000, week: null },
      after: { cents: 302_702_845, week: "2027-01-25" },
      minimum: 300_000_000,
      stays: true,
    });
    expect(scenarioTitle(suggestion(), ctx)).toBe("Driftwood pays 30 days late");
    expect(roomLine(cashEffect(suggestion(), ctx))).toBe("$27K above the minimum");
    expect(roomLine(cashEffect(suggestion({ effect: { lowPointCents: 180_000_000 } }), ctx))).toBe(
      "$1.2M short",
    );
    expect(roomLine(cashEffect(suggestion(), { ...ctx, minimum: null }))).toBeNull();
    // No matching scenario: compared with the plan's own low point.
    expect(cashEffect(suggestion({ scenarioId: "other" }), ctx).before).toEqual(ctx.baseline);
  });

  it("records a decision once, with a trimmed note, and splits decided from open", () => {
    const list = [suggestion(), suggestion({ id: "sug_2" })];
    const after = applyDecision(list, "sug_1", "declined", "  too costly ");
    expect(after[0]).toMatchObject({ status: "declined", note: "too costly" });
    expect(after[1]?.status).toBe("open");
    // A decided suggestion is not decided again.
    expect(applyDecision(after, "sug_1", "accepted", "")[0]?.status).toBe("declined");
    const { open, decided } = splitSuggestions(after);
    expect(open.map((s) => s.id)).toEqual(["sug_2"]);
    expect(decided.map((s) => s.id)).toEqual(["sug_1"]);
  });

  it("sends the decision with the note only when there is one", () => {
    expect(() => decideArgs("company_1", suggestion({ runId: undefined }), "accepted", "")).toThrow(
      "Reload suggestions",
    );
    expect(decideArgs("company_1", suggestion(), "accepted", "  ")).toEqual({
      companyId: "company_1",
      id: "sug_1",
      expectedRunId: "run_1",
      expectedSnapshotVersion: 1,
      decision: "accepted",
    });
    expect(decideArgs("company_1", suggestion(), "declined", " later ")).toEqual({
      companyId: "company_1",
      id: "sug_1",
      expectedRunId: "run_1",
      expectedSnapshotVersion: 1,
      decision: "declined",
      note: "later",
    });
  });
});

describe("demo suggestions", () => {
  it("are empty for books that stay above the minimum", () => {
    const demo = buildDemo("kestrel").result;
    expect(demo.ok && demoSuggestions(demo.view)).toEqual([]);
  });

  it("offer the engine-tested credit line draw for each sample risk that needs one", () => {
    const demo = buildDemo("kestrel-crunch").result;
    if (!demo.ok) throw new Error("demo books did not tie out");
    const view = demo.view;
    const list = demoSuggestions(view);
    const withFix = view.risks.filter((r) => r.fix);
    expect(list).toHaveLength(withFix.length);
    const base = view.lowest?.usable ?? 0;
    for (const [i, r] of withFix.entries()) {
      const s = list[i] as Suggestion;
      expect(s.status).toBe("open");
      expect(s.scenarioId).toBe(r.id);
      expect(s.effect.staysAboveMinimum).toBe(r.fix?.survives);
      expect(s.effect.lowPointCents).toBe(base + r.impact + (r.fix?.cents ?? 0));
    }
  });

  it("rely on a start-of-forecast draw raising the low point by exactly its amount", () => {
    // The claim demoSuggestions makes, checked on the engine with the plan's own books.
    const { snapshot } = createProfileCompany("kestrel-crunch", 1);
    const model = CompanyModelSchema.parse({
      version: 1,
      customerDelayDays: {},
      recurringSpend: [],
      rules: [],
    });
    const demo = buildDemo("kestrel-crunch").result;
    if (!demo.ok) throw new Error("demo books did not tie out");
    const low = (amount: number) => {
      const r = projectedCashFlow(
        snapshot,
        model,
        amount
          ? [{ kind: "add_cash", date: demo.view.forecastStart, amount, label: "Credit line draw" }]
          : [],
      );
      if (!r.ok) throw new Error(r.error.message);
      return Math.min(...r.value.weeks.map((w) => w.endingCash - snapshot.restrictedCash));
    };
    expect(low(120_000_000) - low(0)).toBe(120_000_000);
  });
});
