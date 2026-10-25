/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import type { Change, CompanyModel, WeeklySeedV1 } from "@domino/contracts";
import { weeklyBoundaryFixtures as wfx } from "@domino/contracts/fixtures";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import type { PredictionReceipt } from "./predict/receipt";
import type { WorkspaceRun } from "./questions/context";
import { baselineRefs } from "./refs";
import { workspaceRefs as w } from "./workspaceRefs";

const agent = vi.hoisted(() => ({
  configured: false,
  answer: null as unknown,
  /** The first message the agents were sent, parsed. */
  told: null as Record<string, unknown> | null,
}));
vi.mock("./assistant/claude", async (load) => {
  const real = await load<typeof import("./assistant/claude")>();
  return {
    ...real,
    assistantConfig: () => (agent.configured ? { client: {}, model: "test" } : null),
    runStructured: async (opts: { messages: { content: unknown }[] }) => {
      const first = opts.messages[0]?.content;
      agent.told = typeof first === "string" ? JSON.parse(first) : null;
      return agent.answer;
    },
  };
});

const modules = Object.fromEntries(
  Object.entries(
    import.meta.glob(["../**/*.ts", "../_generated/*.js", "!../**/*.test.ts", "!./*.test.ts"]),
  ).map(([path, load]) => [path.replace(/^\.\//, "../timeline/"), load]),
);
const setup = () => convexTest(schema, modules);
type T = ReturnType<typeof setup>;

const p = {
  start: makeFunctionReference<
    "mutation",
    { companyId: string; runId: string; requestId: string },
    { predictionId: string; created: boolean }
  >("timeline/predict:start"),
  latest: makeFunctionReference<
    "query",
    { companyId: string; runId: string },
    PredictionReceipt | null
  >("timeline/predict:latest"),
};

const seed = wfx.validKestrelWeeklySeed as WeeklySeedV1;
const NEUTRAL: CompanyModel = { version: 0, customerDelayDays: {}, recurringSpend: [], rules: [] };
// Kestrel: asOf 2026-10-30; forecast weeks 2026-11-02..2027-01-25.
const purchase: Change = {
  kind: "remove_cash",
  date: "2026-11-10",
  amount: 100_000_000,
  label: "Equipment purchase",
};

async function scenario(t: T) {
  const baseline = await t.mutation(baselineRefs.save, {
    requestId: "req-baseline-1",
    seedJson: JSON.stringify(seed),
    modelJson: JSON.stringify(NEUTRAL),
    constraintsJson: "[]",
    assumptionNote: "Neutral model for prediction tests.",
    reviewed: true,
  });
  const root = await t.mutation(w.open, {
    companyId: "kestrel",
    baselineRunId: baseline.runId,
    requestId: "req-open-1",
  });
  const run = await t.mutation(w.simulate, {
    companyId: "kestrel",
    parentRunId: root.runId,
    requestId: "req-scenario-1",
    label: "Buy equipment",
    changesJson: JSON.stringify([purchase]),
    reviewed: true,
  });
  return { rootId: root.runId, runId: run.runId };
}

const get = async (t: T, runId: string) =>
  (await t.query(w.get, { companyId: "kestrel", runId })) as WorkspaceRun;

async function predictAndWait(t: T, runId: string) {
  await t.mutation(p.start, { companyId: "kestrel", runId, requestId: "req-predict-1" });
  // Minute steps: the job finishes in the first step, long before its six-minute expiry fires.
  await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(60_000));
  const receipt = await t.query(p.latest, { companyId: "kestrel", runId });
  if (!receipt) throw new Error("no prediction saved");
  return receipt;
}

beforeEach(() => {
  vi.useFakeTimers();
  agent.configured = false;
  agent.answer = null;
  agent.told = null;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("timeline/predict", () => {
  it("without a language model, saves a line that falls further behind through lost interest", async () => {
    const t = setup();
    const { rootId, runId } = await scenario(t);
    const receipt = await predictAndWait(t, runId);
    expect(receipt.status).toBe("done");
    expect(receipt.progress).toBe(100);
    expect(receipt.effects).toEqual([]);
    expect(receipt.warnings.join(" ")).toMatch(/not configured/);
    expect(receipt.interest?.netCents).toBeLessThan(0);
    const predicted = await get(t, receipt.resultRunId ?? "");
    expect(predicted.parentRunId).toBe(runId);
    expect(predicted.label).toBe("Predicted: Buy equipment");
    const root = await get(t, rootId);
    const plain = await get(t, runId);
    const last = root.forecast.weeks.length - 1;
    const gap = (r: WorkspaceRun) =>
      (root.forecast.weeks[last]?.closing ?? 0) - (r.forecast.weeks[last]?.closing ?? 0);
    expect(gap(plain)).toBe(purchase.kind === "remove_cash" ? purchase.amount : 0);
    expect(gap(predicted)).toBeGreaterThan(gap(plain));
  });

  it("applies the agents' screened effects and records rejected ones", async () => {
    const t = setup();
    const { runId } = await scenario(t);
    const open = seed.snapshot.invoices
      .filter((i) => i.paid === undefined && i.writtenOff === undefined && i.due > "2026-11-10")
      .sort((a, b) => (a.due < b.due ? -1 : 1));
    const invoice = open[0];
    if (!invoice) throw new Error("fixture needs an open invoice after the purchase");
    agent.configured = true;
    agent.answer = {
      summary: "The customer has paid late after past shocks.",
      effects: [
        {
          kind: "delay_invoice",
          recordId: invoice.id,
          days: 21,
          fromDate: null,
          title: "Pays three weeks late",
          reason: "Learned delay",
          likelihood: "possible",
          evidence: ["Brain map: learned payment delays"],
        },
        {
          kind: "churn",
          recordId: "cust_missing",
          days: null,
          fromDate: "2026-12-01",
          title: "Unknown customer leaves",
          reason: "None",
          likelihood: "possible",
          evidence: [],
        },
      ],
      response: null,
    };
    const receipt = await predictAndWait(t, runId);
    expect(receipt.status).toBe("done");
    expect(receipt.summary).toMatch(/paid late/);
    expect(receipt.effects.map((e) => e.change)).toEqual([
      { kind: "delay_invoice", invoiceId: invoice.id, days: 21 },
    ]);
    expect(receipt.rejected).toEqual([
      { title: "Unknown customer leaves", reason: "No customer cust_missing in these books" },
    ]);
    const predicted = await get(t, receipt.resultRunId ?? "");
    expect(predicted.ownChanges[0]).toEqual({
      kind: "delay_invoice",
      invoiceId: invoice.id,
      days: 21,
    });
  });

  it("returns the same prediction for a repeated request and refuses the base line", async () => {
    const t = setup();
    const { rootId, runId } = await scenario(t);
    const a = await t.mutation(p.start, { companyId: "kestrel", runId, requestId: "req-same-1" });
    const b = await t.mutation(p.start, { companyId: "kestrel", runId, requestId: "req-same-1" });
    expect(b).toEqual({ predictionId: a.predictionId, created: false });
    await expect(
      t.mutation(p.start, { companyId: "kestrel", runId: rootId, requestId: "req-root-1" }),
    ).rejects.toThrow(/Only a saved scenario/);
  });

  it("applies the agents' company response as engine spending and billing changes", async () => {
    const t = setup();
    const { runId } = await scenario(t);
    agent.configured = true;
    agent.answer = {
      summary: "Management cuts marketing right after the purchase.",
      effects: [],
      response: {
        respondFrom: "event",
        growthSpend: ["Northlight Marketing"],
        spendCutPercent: 50,
        reactionDays: 0,
        growthSensitivity: 0.3,
        revenueLagDays: 30,
        likelihood: "likely",
        reason: "The purchase was planned against marketing budget.",
        evidence: ["Ask Domino conversation"],
      },
    };
    const receipt = await predictAndWait(t, runId);
    expect(receipt.status).toBe("done");
    expect(receipt.response).toMatchObject({
      source: "agents",
      applied: true,
      growthSpend: ["Northlight Marketing"],
      trigger: { date: "2026-11-10", usable: null },
    });
    const predicted = await get(t, receipt.resultRunId ?? "");
    expect(predicted.ownChanges[0]).toEqual({
      kind: "scale_recurring",
      label: "Response: growth spending cut 50%",
      flows: "spend",
      names: ["Northlight Marketing"],
      percent: -50,
      fromDate: "2026-11-10",
    });
  });

  it("gives the agents the Ask Domino conversation that made the scenario", async () => {
    const t = setup();
    const { rootId, runId } = await scenario(t);
    const at = "2026-10-31T12:00:00.000Z";
    await t.run((ctx) =>
      ctx.db.insert("timelineChats", {
        companyId: "kestrel",
        conversationId: "timeline:chat/test",
        runId: rootId,
        data: {
          segmentStart: 0,
          draft: {},
          receipt: {
            schemaVersion: 1,
            methodVersion: "timeline_chat@1",
            companyId: "kestrel",
            conversationId: "timeline:chat/test",
            runId: rootId,
            inputHash: "a".repeat(64),
            constraintVersion: "c1",
            revision: 2,
            status: "saved",
            selectedWeek: null,
            selectedItemId: null,
            createdAt: at,
            updatedAt: at,
            turns: [
              {
                id: "t1",
                role: "user",
                text: "We have to buy new servers because the old ones failed an audit.",
                createdAt: at,
              },
              { id: "t2", role: "assistant", text: "Saved as a new scenario.", createdAt: at },
            ],
            proposal: {
              label: "Buy equipment",
              changes: [purchase],
              constraints: null,
              constraintNote: null,
            },
            linkedRunId: runId,
            pendingField: null,
          },
        },
      }),
    );
    agent.configured = true;
    agent.answer = { summary: "Servers replace failed ones.", effects: [], response: null };
    const receipt = await predictAndWait(t, runId);
    const stories = agent.told?.scenarioStories as {
      relation: string;
      askDomino: { conversation: { text: string }[] } | null;
    }[];
    expect(stories[0]?.relation).toBe("this scenario");
    expect(stories[0]?.askDomino?.conversation[0]?.text).toMatch(/failed an audit/);
    expect(agent.told?.spendNames).toEqual(["Northlight Marketing"]);
    expect(receipt.context).toEqual([
      { label: "Buy equipment", relation: "this scenario", sources: ["Ask Domino conversation"] },
    ]);
    // The agents said no response, so none is applied even though a default exists.
    expect(receipt.response).toBeNull();
  });
});
