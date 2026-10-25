import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FieldFinding } from "../types";
import type { SuggestionsState } from "./SuggestionsSection";
import { WorkerSections } from "./WorkerSections";
import type { WatchedRisk } from "./risks";
import { type EffectContext, toSuggestion } from "./suggestions";

// The flag queue shares field/parts.tsx with the auto-check switch, whose "@/" import the test
// runner does not resolve. The switch is not rendered in these sections.
vi.mock("../../ui/switch", () => ({ Switch: () => null }));

const context: EffectContext = {
  baseline: { cents: 182_702_845, week: "2027-01-25" },
  scenarios: new Map(),
  minimum: 300_000_000,
};
const noop = async () => {};

const render = (over: {
  suggestions?: SuggestionsState;
  risks?: WatchedRisk[];
  risksLoading?: boolean;
  findings?: FieldFinding[] | undefined;
}) =>
  renderToStaticMarkup(
    <WorkerSections
      suggestions={over.suggestions ?? { kind: "ready", list: [] }}
      context={context}
      onDecide={noop}
      onSimulate={noop}
      companyId="company123"
      risks={over.risks ?? []}
      risksLoading={over.risksLoading ?? false}
      findings={"findings" in over ? over.findings : []}
      now={Date.parse("2026-10-25T00:00:00Z")}
    />,
  );

const suggestion = (id: string, status: string) =>
  toSuggestion({
    id,
    scenarioId: "risk/old",
    runId: "run/old",
    snapshotVersion: 4,
    fix: { kind: "credit_line_draw", amountCents: 120_000_000, week: "2026-12-14" },
    effect: { lowPointCents: 302_702_845, lowPointWeek: "2027-01-25", staysAboveMinimum: true },
    recommendation: "Covers the gap at the low point.",
    status,
  });

describe("worker page sections", () => {
  it("shows suggestions, then risks, then flags", () => {
    const html = render({});
    const order = ["suggestions", "risks", "flags"].map((id) =>
      html.indexOf(`data-section="${id}"`),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html.indexOf("Suggestions")).toBeLessThan(html.indexOf("Risks we&#x27;re watching"));
    expect(html.indexOf("Risks we&#x27;re watching")).toBeLessThan(html.indexOf("Flags to review"));
  });

  it("says what will appear, and when, in each empty section", () => {
    const html = render({});
    expect(html).toContain("No suggestions waiting.");
    expect(html).toContain("No risk scenarios yet.");
    expect(html).toContain("appears here when the analysis finishes");
    expect(html).toContain("No flags to review.");
  });

  it("explains that suggestions are not switched on before the backend exists", () => {
    const html = render({ suggestions: { kind: "off" } });
    expect(html).toContain("Suggestions are not switched on yet.");
    expect(html).not.toContain("No suggestions waiting.");
  });

  it("shows loading states instead of empty claims", () => {
    const html = render({
      suggestions: { kind: "loading" },
      risksLoading: true,
      findings: undefined,
    });
    expect(html).toContain("Loading suggestions");
    expect(html).toContain("Loading risk scenarios");
    expect(html).toContain("Loading flags");
    expect(html).not.toContain("No flags to review.");
  });

  it("renders an open suggestion with its effect, actions and the money note", () => {
    const open = suggestion("s1", "open");
    const decided = suggestion("s2", "accepted");
    if (!open || !decided) throw new Error("fixture did not parse");
    const html = render({ suggestions: { kind: "ready", list: [open, decided] } });
    expect(html).toContain("Draw $1.2M on the credit line in the week of Dec 14");
    expect(html).toContain("Suggested by <span");
    expect(html).toContain("Engine advisors");
    expect(html).toContain("$1.8M"); // lowest cash now
    expect(html).toContain("$3M"); // with the fix, and the lender's minimum
    expect(html).toContain("Fixes it");
    expect(html).toContain("Try this fix</button>");
    expect(html).toContain("Dismiss</button>");
    expect(html).toContain("Simulated only. Nothing is paid or moved.");
    expect(html).toContain(
      "/field/analysis?companyId=company123&amp;runId=run%2Fold&amp;scenarioId=risk%2Fold&amp;fixKind=credit_line_draw",
    );
    // The accepted one sits in the collapsed Decided list.
    expect(html).toMatch(/<details[^>]*>.*Decided.*1 suggestion.*Accepted/s);
    expect(html).toContain("1 open");
  });

  it("links each risk to the timeline when it has a scenario there", () => {
    const html = render({
      risks: [
        {
          id: "r1",
          title: "Driftwood stops paying",
          source: "timeline",
          status: "below",
          rule: "the lender's minimum",
          week: "2026-12-28",
          low: { cents: 182_702_845, week: "2027-01-25" },
          shortfall: 117_297_155,
          href: "/c/kestrel/timeline?runId=r1",
        },
      ],
    });
    expect(html).toContain(
      "Falls below the lender&#x27;s minimum in the week of Dec 28, short $1.2M.",
    );
    expect(html).toContain('href="/c/kestrel/timeline?runId=r1"');
    expect(html).toContain("Open in timeline");
  });
});
