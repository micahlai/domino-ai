import { HistoricalCaseSchema, HistoricalRunSchema } from "@domino/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
// Server evidence JSON is read here, in tests only. Client code never imports it.
import rawCase from "../../../../../data/historical/2u/case.json";
import protocol from "../../../../../data/historical/2u/protocol.json";
import { CompanyKnowledgeView } from "./CompanyKnowledge";

const FULL = HistoricalCaseSchema.parse(rawCase);
const RUN_ID = "baseline-0123456789abcdef";
const inputs = {
  sourceIds: protocol.inputs.sourceIds,
  factIds: protocol.inputs.factIds,
  assumptionIds: protocol.inputs.baselineAssumptionIds,
};
const pick = <T extends { id: string }>(items: T[], ids: string[]) =>
  items.filter((i) => ids.includes(i.id));

// The saved getRun payload, roles included, as the backend returns it.
function saved() {
  const run = HistoricalRunSchema.parse({
    id: RUN_ID,
    caseId: FULL.id,
    createdAt: "2026-10-24T18:00:00.000Z",
    knowledgeCutoff: protocol.knowledgeCutoff,
    originBalanceDate: protocol.originBalanceDate,
    inputs,
    inputHash: "a".repeat(64),
    method: protocol.method,
    riskRules: [],
    predictions: [...protocol.nowcast, ...protocol.baselineForecast].map((p, i) => ({
      ...p,
      id: `pred-${i}`,
    })),
    branch: { kind: "baseline" },
  });
  return {
    runId: RUN_ID,
    run,
    riskRulesNote: protocol.riskRulesNote,
    inputSnapshot: {
      caseId: FULL.id,
      currency: FULL.currency,
      method: protocol.method,
      roles: {
        knowledgeCutoff: protocol.knowledgeCutoff,
        originBalanceDate: protocol.originBalanceDate,
        usableCashFactId: "F01",
        totalCashFactId: "F03",
        operatingYtdFactId: "F05",
        investingYtdFactId: "F06",
        financingAssumptionId: "AS-FIN0",
        fxAssumptionId: "AS-FX0",
      },
      sources: pick(FULL.sources, inputs.sourceIds),
      facts: pick(FULL.facts, inputs.factIds),
      assumptions: pick(FULL.assumptions, inputs.assumptionIds),
    },
  };
}

const html = (runId: string | undefined, run: unknown) =>
  renderToStaticMarkup(<CompanyKnowledgeView runId={runId} raw={{ run }} />);

describe("CompanyKnowledgeView", () => {
  it("says structured data is pending before a baseline is saved, and reads nothing", () => {
    const out = html(undefined, saved());
    expect(out).toContain("No structured data saved yet");
    expect(out).not.toContain("Facts</h4>");
  });

  it("shows loading, not empty, while the saved run is unread", () => {
    const out = html(RUN_ID, undefined);
    expect(out).toContain("Loading the saved facts");
    expect(out).toContain('role="status"');
  });

  it("reports a failed read as an alert", () => {
    const out = html(RUN_ID, new Error("x"));
    expect(out).toContain("Could not load the saved facts");
    expect(out).toContain('role="alert"');
  });

  it("refuses a payload without roles, as the historical parser would have produced", () => {
    const run = saved();
    Reflect.deleteProperty(run.inputSnapshot, "roles");
    expect(html(RUN_ID, run)).toContain("not in the expected shape");
  });

  it("refuses non-object and malformed payloads", () => {
    expect(html(RUN_ID, null)).toContain("not in the expected shape");
    expect(html(RUN_ID, { nope: 1 })).toContain("not in the expected shape");
  });

  it("refuses another session's run instead of showing it", () => {
    const out = html("baseline-other", saved());
    expect(out).toContain("does not match this investigation");
    expect(out).not.toContain("Facts</h4>");
  });

  it("shows cutoff, reported and derived facts, assumptions and costs", () => {
    const out = html(RUN_ID, saved());
    expect(out).toContain("Knowledge cutoff Nov 10, 2023");
    expect(out).toContain("nothing published later");
    // F01 is reported usable cash: $41.1M on Sep 30, 2023, with its table locator and publication date.
    expect(out).toContain("Cash and equivalents");
    expect(out).toContain("$41.1M");
    expect(out).toContain("Reported: S7 Condensed Consolidated Balance Sheets");
    expect(out).toContain("Published Nov 9, 2023.");
    expect(out).toContain("Assumptions</h4>");
    expect(out).toContain("Assumed, not reported");
    expect(out).toContain("Sep 30, 2023");
  });

  it("leaves source links to the saved sources section, so none repeat per fact", () => {
    const run = saved();
    const source = run.inputSnapshot.sources[0];
    if (source) source.url = "javascript:alert(1)";
    const out = html(RUN_ID, run);
    expect(out).not.toContain("<a ");
    expect(out).not.toContain("javascript:");
  });

  it("names the source per fact only when several sources exist", () => {
    const run = saved();
    const first = run.inputSnapshot.sources[0];
    if (!first) throw new Error("fixture needs a source");
    expect(html(RUN_ID, run)).not.toContain(`Reported in ${first.title}`);
  });

  it("keeps IDs, method and hash behind technical details, with no learnings claim", () => {
    const out = html(RUN_ID, saved());
    const [before, after] = out.split("<details");
    expect(before).not.toContain(RUN_ID);
    expect(before).not.toContain("a".repeat(64));
    expect(after).toContain(RUN_ID);
    expect(after).toContain("a".repeat(64));
    expect(after).toContain(`${protocol.method.id} ${protocol.method.version}`);
    expect(out).not.toMatch(/learning/i);
  });

  it("is unchanged by what a reveal later publishes: only saved inputs are shown", () => {
    const out = html(RUN_ID, saved());
    for (const id of protocol.observation.sourceIds) {
      const later = FULL.sources.find((s) => s.id === id);
      if (later) expect(out).not.toContain(later.title);
    }
  });
});
