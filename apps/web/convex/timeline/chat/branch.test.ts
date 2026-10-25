/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { WeeklySeedV1Schema } from "@domino/contracts";
import { weeklyBoundaryFixtures } from "@domino/contracts/fixtures";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { baselineRefs } from "../refs";
import { changeStart, scenarioStart } from "../scenarioStart";
import { workspaceRefs } from "../workspaceRefs";
import { chatRefs } from "./refs";

const modules = Object.fromEntries(
  Object.entries(
    import.meta.glob([
      "../../**/*.ts",
      "../../_generated/*.js",
      "!../../**/*.test.ts",
      "!../../**/*.test-support.ts",
    ]),
  ).map(([path, load]) => [
    path.startsWith("../../")
      ? path
      : path.startsWith("../")
        ? `../../timeline/${path.slice(3)}`
        : `../../timeline/chat/${path.slice(2)}`,
    load,
  ]),
);
const setup = () => convexTest(schema, modules);
type T = ReturnType<typeof setup>;
let serial = 0;
const rid = () => `branch-test-${++serial}`;
const seed = WeeklySeedV1Schema.parse(weeklyBoundaryFixtures.validKestrelWeeklySeed);
const snapshot = seed.snapshot;

async function root(t: T) {
  const saved = await t.mutation(baselineRefs.save, {
    requestId: rid(),
    seedJson: JSON.stringify(seed),
    modelJson: JSON.stringify({ version: 0, customerDelayDays: {}, recurringSpend: [], rules: [] }),
    constraintsJson: "[]",
    assumptionNote: "Labelled synthetic Kestrel fixture",
    reviewed: true,
  });
  const opened = await t.mutation(workspaceRefs.open, {
    companyId: seed.company.id,
    baselineRunId: saved.runId,
    requestId: rid(),
  });
  return { companyId: seed.company.id, runId: opened.runId, baselineRunId: saved.runId };
}
const pay = (t: T, parentRunId: string, date: string, extra: object = {}) =>
  t.mutation(workspaceRefs.simulate, {
    companyId: seed.company.id,
    parentRunId,
    requestId: rid(),
    label: `Pay on ${date}`,
    changesJson: JSON.stringify([
      { kind: "remove_cash", amount: 5_000_000, date, label: `Payment ${date} #${serial}` },
    ]),
    reviewed: true,
    ...extra,
  });

describe("scenario start dates", () => {
  it("dates each change by when it first moves cash", () => {
    const invoice = snapshot.invoices[0];
    const bill = snapshot.bills[0];
    if (!invoice || !bill) throw new Error("fixture needs an invoice and a bill");
    expect(changeStart({ kind: "delay_invoice", invoiceId: invoice.id, days: 14 }, snapshot)).toBe(
      invoice.due,
    );
    expect(changeStart({ kind: "delay_bill", billId: bill.id, days: 7 }, snapshot)).toBe(bill.due);
    expect(
      changeStart(
        {
          kind: "shift_hire",
          label: "Hire",
          monthlyCost: 1,
          fromDate: "2026-12-07",
          toDate: "2026-11-30",
        },
        snapshot,
      ),
    ).toBe("2026-11-30");
    expect(
      scenarioStart(
        [
          { kind: "add_cash", amount: 1, date: "2026-12-01", label: "a" },
          { kind: "remove_cash", amount: 1, date: "2026-11-20", label: "b" },
        ],
        snapshot,
      ),
    ).toBe("2026-11-20");
    expect(scenarioStart([], snapshot)).toBeNull();
  });

  it("lists each run's start and requires a child to start on or after its parent", async () => {
    const t = setup();
    const base = await root(t);
    const first = await pay(t, base.runId, "2026-11-17");
    await expect(pay(t, first.runId, "2026-11-10")).rejects.toThrow(
      /before the scenario it builds on starts \(2026-11-17\)/,
    );
    const second = await pay(t, first.runId, "2026-11-17");
    const third = await pay(t, second.runId, "2026-12-08");
    // Automated responses may act before the risk they answer.
    await pay(t, third.runId, "2026-11-09", { allowEarlierStart: true });

    const graph = await t.query(workspaceRefs.graph, {
      companyId: base.companyId,
      baselineRunId: base.baselineRunId,
    });
    const startOf = (id: string) => graph.find((e) => e.runId === id)?.startsOn;
    expect(startOf(base.runId)).toBeNull();
    expect(startOf(first.runId)).toBe("2026-11-17");
    expect(startOf(third.runId)).toBe("2026-12-08");
  });

  it("explains the branch start in chat instead of proposing an earlier event", async () => {
    const t = setup();
    const base = await root(t);
    const first = await pay(t, base.runId, "2026-11-17");
    let r = await t.mutation(chatRefs.begin, {
      companyId: base.companyId,
      runId: first.runId,
      requestId: rid(),
    });
    r = await t.mutation(chatRefs.send, {
      companyId: r.companyId,
      conversationId: r.conversationId,
      requestId: rid(),
      expectedRevision: r.revision,
      text: "pay $10,000 to Atlas Legal on 2026-11-10",
    });
    expect(r.status).toBe("collecting");
    expect(r.proposal).toBeNull();
    expect(r.turns.at(-1)?.text).toMatch(/starts 2026-11-17.*on or after 2026-11-17/);
  });
});
