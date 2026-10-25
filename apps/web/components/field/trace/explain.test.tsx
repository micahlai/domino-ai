import type { FieldTrace } from "@/lib/field-trace-contract";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HowWeGotHere } from "./HowWeGotHere";
import { traceExplain } from "./explain";
import {
  agentTitle,
  describeChange,
  distinct,
  moneyOf,
  plural,
  readableLabel,
} from "./explain-model";

const legacy = {
  run: {
    companyId: "c1",
    runId: "r1",
    snapshotId: "s1",
    snapshotVersion: 3,
    asOf: "2026-10-25",
    trigger: "manual",
    status: "done",
    summary: null,
  },
  evidence: "legacy",
  selection: { scenarioId: null, fixKind: null },
  inputs: null,
  scenarios: [],
  candidates: [],
  operations: [],
  providers: [],
  aiSummary: null,
  coordinator: null,
  limitations: [],
  truncation: { operations: false, providers: false, scenarios: false, candidates: false },
} as unknown as FieldTrace;

const op = (o: Record<string, unknown>) => ({
  id: `op-${o.at}`,
  action: "agent.tool",
  summary: "",
  refs: [],
  agentId: null,
  agentKind: "domino",
  parentAgentId: null,
  event: null,
  status: null,
  task: null,
  tool: null,
  toolCategory: null,
  toolLabel: null,
  fromAgentId: null,
  toAgentId: null,
  ...o,
});

const recorded = {
  ...legacy,
  evidence: "frozen",
  inputs: {
    company: { name: "CodeHarbor", datasetId: "d", datasetVersion: 1 },
    snapshot: { asOf: "2026-10-25", cashOnHand: 50_000_000_000, restrictedCash: 0 },
    model: { id: "m", version: 1 },
    constraints: [],
    sources: [
      { kind: "billing", tieOut: "ok", step: "read" },
      { kind: "books", tieOut: "ok", step: "read" },
    ],
    provenance: null,
  },
  selection: { scenarioId: "late", fixKind: "delay_bill" },
  scenarios: [
    {
      id: "late",
      agentId: "forecaster#2",
      title: "Late payments",
      basis: "Invoice synthetic/plan/17/invoice/2026-10-18 delayed.",
      changes: [
        { kind: "delay_invoice", invoiceId: "synthetic/plan/17/invoice/2026-10-18", days: 14 },
      ],
      work: {
        weeks: Array.from({ length: 13 }, (_, i) => ({
          weekStart: `2026-11-${10 + i}`,
          usable: 1,
        })),
        baseLow: 45_000_000_000,
        low: 43_971_512_017,
        lowWeek: 2,
        survives: true,
      },
    },
  ],
  candidates: [
    {
      scenarioId: "late",
      agentId: "advisor.delay_bill",
      scenarioTitle: "Late payments",
      fix: { id: "fix-1", kind: "delay_bill", label: "Delay a bill", costNote: "Vendor goodwill" },
      effect: {
        survives: true,
        lowPoint: 43_971_512_017,
        lowWeekStart: "2026-11-09",
        gain: 0,
        scenarioLow: 43_000_000_000,
        lenderMinimum: 7_833_466_667,
      },
      recommendation: { text: "Keeps the minimum clear.", provider: "creao" },
    },
  ],
  operations: [
    op({
      at: "2026-10-25T10:00:00Z",
      agentId: "analyst#1",
      tool: "engine.scanRisks",
      refs: ["late", "other"],
    }),
    op({
      at: "2026-10-25T10:00:01Z",
      agentId: "forecaster#2",
      parentAgentId: "analyst#1",
      refs: ["late"],
      status: "spawned",
    }),
    op({
      at: "2026-10-25T10:00:02Z",
      agentId: "forecaster#1",
      parentAgentId: "analyst#1",
      refs: ["other"],
    }),
    op({
      at: "2026-10-25T10:00:03Z",
      agentId: "forecaster#2",
      tool: "engine.forecast",
      refs: ["late"],
    }),
    op({
      at: "2026-10-25T10:00:04Z",
      agentId: "forecaster#2",
      tool: "engine.stressTest",
      refs: ["late"],
    }),
    op({
      at: "2026-10-25T10:00:05Z",
      agentId: "advisor.delay_bill",
      parentAgentId: "analyst#1",
      tool: "engine.adviseFix",
      refs: ["late"],
    }),
    op({
      at: "2026-10-25T10:00:06Z",
      agentId: "advisor.delay_bill",
      tool: "creao.recommendFix",
      refs: ["fix-1"],
    }),
  ],
} as unknown as FieldTrace;

describe("plain wording and formatting", () => {
  it("pluralizes and keeps exact money beside compact money", () => {
    expect(plural(1, "change")).toBe("1 change");
    expect(plural(13, "week")).toBe("13 weeks");
    expect(moneyOf(7_833_466_667)).toEqual({
      cents: 7_833_466_667,
      short: "$78.3M",
      exact: "$78,334,666.67",
    });
    expect(moneyOf(1.5)).toBeNull();
    // Near-equal amounts are shown exactly so "below" never reads as "$3.2M vs $3.2M".
    const [a, b] = distinct(moneyOf(315_000_000), moneyOf(316_000_000));
    expect([a?.short, b?.short]).toEqual(["$3,150,000.00", "$3,160,000.00"]);
  });

  it("names the customer instead of the record id, with a dated fallback", () => {
    const change = { kind: "delay_invoice" as const, invoiceId: "plan/17/invoice/x", days: 14 };
    expect(
      describeChange(change, {
        invoice: () => ({ customer: "Customer cohort 18", amount: 120_000_00, due: "2026-11-02" }),
      }),
    ).toEqual({
      text: "Customer cohort 18 pays 14 days late",
      money: { cents: 12_000_000, short: "$120K", exact: "$120,000.00" },
      amountLabel: "Invoice amount",
    });
    expect(
      describeChange(change, {
        invoice: () => ({ customer: null, amount: 100, due: "2026-10-18" }),
      }).text,
    ).toBe("An invoice due Oct 18, 2026 is paid 14 days late");
    expect(describeChange({ ...change, days: 1 }).text).toBe("An invoice is paid 1 day late");
    expect(
      readableLabel(
        "Invoice plan/17/invoice/x is paid 14 additional days late",
        ["plan/17/invoice/x"],
        "Plain",
      ),
    ).toBe("Plain");
    expect(agentTitle("forecaster#2")).toBe("Forecaster 2");
    expect(agentTitle("analyst#1")).toBe("Analyst");
    expect(agentTitle("advisor.delay_bill")).toBe("Bill timing advisor");
  });
});

describe("Field run explanation", () => {
  it("states when a legacy receipt cannot support a result", () => {
    const e = traceExplain(legacy);
    expect(e.data.headline).toContain("not saved");
    expect(e.calc.headline).toContain("No completed scenario calculation");
    expect(e.result.tone).toBe("unknown");
    expect(e.result.low).toBeNull();
    expect(e.limits).toEqual(["Some older run inputs were not saved."]);
    expect(e.map.agentWork).toBe(false);
  });

  it("uses only the chosen run's saved option, values and rationale", () => {
    const e = traceExplain(recorded);
    expect(e.title).toBe("Why Delay a bill?");
    expect(e.data.logos?.map((l) => l.label)).toEqual(["Stripe", "QuickBooks"]);
    expect(e.change.facts[0]?.text).toBe("An invoice is paid 14 days late");
    expect(JSON.stringify([e.title, e.subtitle, e.change, e.data])).not.toContain("synthetic/");
    expect(e.result).toMatchObject({ tone: "above", badge: "Stays above", lowWeek: "Nov 9, 2026" });
    expect(e.result.low?.short).toBe("$439.7M");
    expect(e.result.floor?.short).toBe("$78.3M");
    expect(e.result.quote?.text).toBe("Keeps the minimum clear.");
  });

  it("derives the map snapshot from this result's recorded operations only", () => {
    const { map } = traceExplain(recorded);
    const ids = map.nodes.map((n) => n.id);
    expect(ids).toEqual([
      "sources",
      "agent:analyst#1",
      "agent:forecaster#2",
      "agent:advisor.delay_bill",
      "ai:creao",
      "engine",
      "result",
    ]);
    expect(ids).not.toContain("agent:forecaster#1");
    expect(ids).not.toContain("agent:advisor.credit_line_draw");
    expect(map.edges.map((e) => `${e.from}>${e.to}`)).toEqual([
      "agent:analyst#1>agent:forecaster#2",
      "agent:analyst#1>agent:advisor.delay_bill",
      "agent:advisor.delay_bill>ai:creao",
      "agent:analyst#1>engine",
      "agent:forecaster#2>engine",
      "agent:advisor.delay_bill>engine",
      "sources>agent:analyst#1",
      "engine>result",
      "ai:creao>result",
    ]);
    const forecaster = map.nodes.find((n) => n.id === "agent:forecaster#2");
    expect(forecaster).toMatchObject({ col: 2, order: 3, sub: "Run forecast, Stress test" });
    expect(map.nodes.find((n) => n.id === "ai:creao")?.col).toBe(3);
    expect(map.nodes[0]).toMatchObject({ label: "2 sources", sub: "Stripe, QuickBooks" });
    expect(map.note).toContain("AI used: CREAO");
  });

  it("renders the story, map caption and a Details disclosure", () => {
    const html = renderToStaticMarkup(
      <HowWeGotHere explain={traceExplain(recorded)} back={<a href="/field">Back</a>} />,
    );
    expect(html).toContain("What worked on this result");
    expect(html).toContain("Stays above");
    expect(html).toContain('title="$439,715,120.17"');
    expect(html).toContain("<summary");
    expect(html).toContain("Details");
  });
});
