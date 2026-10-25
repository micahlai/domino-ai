/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import {
  type Change,
  type CompanyModel,
  type Constraint,
  type WeeklySeedV1,
  contentHashPreimage,
  parseWeeklyResultRefJson,
} from "@domino/contracts";
import { weeklyBoundaryFixtures as wfx } from "@domino/contracts/fixtures";
import { engine } from "@domino/engine";
import { cashSchedule } from "@domino/engine/src/forecast";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import { baselineRefs } from "./refs";
import { WORKSPACE_METHOD_VERSION } from "./workspace";
import { workspaceRefs as w } from "./workspaceRefs";
import { ruleReceipts } from "./workspaceRules";

// Vite writes this folder's files as "./x.ts"; convex-test resolves paths from the convex root.
const modules = Object.fromEntries(
  Object.entries(
    import.meta.glob(["../**/*.ts", "../_generated/*.js", "!../**/*.test.ts", "!./*.test.ts"]),
  ).map(([path, load]) => [path.replace(/^\.\//, "../timeline/"), load]),
);
const setup = () => convexTest(schema, modules);
type T = ReturnType<typeof setup>;

afterEach(() => vi.restoreAllMocks());

// Kestrel: asOf 2026-10-30; forecast weeks 2026-11-02..2027-01-25 (ends Sunday 2027-01-31).
// Neutral usable-cash low point is 268,900,000 cents in the week of 2026-11-16.
const seed = wfx.validKestrelWeeklySeed as WeeklySeedV1;
const snapshot = seed.snapshot;
const NEUTRAL: CompanyModel = { version: 0, customerDelayDays: {}, recurringSpend: [], rules: [] };
const EVIDENCE = { source: "document", ref: "timeline:assumption", note: "Stated by the user" };
const minCash = (limit: number, id = "user_min_cash"): Constraint => ({
  id,
  label: "Keep usable cash above the minimum",
  kind: "min_cash",
  limit,
  evidence: EVIDENCE as Constraint["evidence"],
});
const payBy = (billId: string, limit: number, id = "pay_agency"): Constraint => ({
  id,
  label: `Pay ${billId} on time`,
  kind: "pay_by_date",
  limit,
  billId,
  evidence: EVIDENCE as Constraint["evidence"],
});
const runway = (limit: number): Constraint => ({
  id: "user_runway",
  label: "Keep runway",
  kind: "min_runway_months",
  limit,
  evidence: EVIDENCE as Constraint["evidence"],
});
const spend = (amount: number, date = "2026-11-10", label = "Equipment purchase"): Change => ({
  kind: "remove_cash",
  date,
  amount,
  label,
});

async function sha256Hex(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
/** The same records under another company id, re-hashed. */
async function otherCompanySeed() {
  const next: WeeklySeedV1 = {
    ...structuredClone(seed),
    id: "field:weekly_seed/other-co",
    company: { id: "other", name: "Other Co" },
    snapshot: { ...structuredClone(snapshot), companyId: "other" },
    scheduledItems: [],
    findings: [],
  };
  return JSON.stringify({ ...next, contentHash: await sha256Hex(contentHashPreimage(next)) });
}

async function saveBaseline(
  t: T,
  constraints: Constraint[] = [],
  over: { requestId?: string; seedJson?: string; model?: CompanyModel } = {},
) {
  const out = await t.mutation(baselineRefs.save, {
    requestId: over.requestId ?? "req-baseline-1",
    seedJson: over.seedJson ?? JSON.stringify(seed),
    modelJson: JSON.stringify(over.model ?? NEUTRAL),
    constraintsJson: JSON.stringify(constraints),
    assumptionNote: "Neutral model for workspace tests.",
    reviewed: true,
  });
  return out;
}

/** A saved baseline and its opened workspace root. */
async function root(t: T, constraints: Constraint[] = []) {
  const baseline = await saveBaseline(t, constraints);
  const opened = await t.mutation(w.open, {
    companyId: "kestrel",
    baselineRunId: baseline.runId,
    requestId: "req-open-1",
  });
  return { baselineRunId: baseline.runId, rootId: opened.runId, opened };
}

let counter = 0;
const nextId = () => `req-test-${++counter}`;
const simulate = (
  t: T,
  parentRunId: string,
  changes: Change[],
  over: Partial<{
    requestId: string;
    label: string;
    constraints: Constraint[];
    constraintNote: string;
    companyId: string;
    reviewed: boolean;
    changesJson: string;
  }> = {},
) =>
  t.mutation(w.simulate, {
    companyId: over.companyId ?? "kestrel",
    parentRunId,
    requestId: over.requestId ?? nextId(),
    label: over.label ?? "Test scenario",
    changesJson: over.changesJson ?? JSON.stringify(changes),
    reviewed: over.reviewed ?? true,
    ...(over.constraints ? { constraintsJson: JSON.stringify(over.constraints) } : {}),
    ...(over.constraintNote !== undefined ? { constraintNote: over.constraintNote } : {}),
  });
const revise = (
  t: T,
  parentRunId: string,
  constraints: Constraint[],
  over: Partial<{ requestId: string; note: string; reviewed: boolean; companyId: string }> = {},
) =>
  t.mutation(w.reviseConstraints, {
    companyId: over.companyId ?? "kestrel",
    parentRunId,
    requestId: over.requestId ?? nextId(),
    constraintsJson: JSON.stringify(constraints),
    note: over.note ?? "User-stated rule",
    reviewed: over.reviewed ?? true,
  });
const get = async (t: T, runId: string, companyId = "kestrel") => {
  const run = await t.query(w.get, { companyId, runId });
  if (!run) throw new Error(`expected saved run ${runId}`);
  return run;
};
const runCount = (t: T) =>
  t.run(async (ctx) => (await ctx.db.query("timelineRuns").collect()).length);

describe("timeline workspace: open and read", () => {
  it("opens one immutable root from a saved baseline and reuses it", async () => {
    const t = setup();
    const { baselineRunId, rootId, opened } = await root(t, [minCash(250_000_000)]);
    expect(opened).toMatchObject({ companyId: "kestrel", created: true });
    expect(rootId).toMatch(/^timeline:workspace\/[0-9a-f]{40}$/);
    // Same request retried, and a different request for the same baseline, reuse the root.
    for (const requestId of ["req-open-1", "req-open-2"])
      expect(await t.mutation(w.open, { companyId: "kestrel", baselineRunId, requestId })).toEqual({
        companyId: "kestrel",
        runId: rootId,
        created: false,
      });

    const run = await get(t, rootId);
    const baseline = await t.query(baselineRefs.get, {
      companyId: "kestrel",
      runId: baselineRunId,
    });
    expect(run).toMatchObject({
      runId: rootId,
      companyId: "kestrel",
      baselineRunId,
      parentRunId: null,
      kind: "baseline",
      methodVersion: WORKSPACE_METHOD_VERSION,
      ownChanges: [],
      changes: [],
      comparison: null,
      constraints: [minCash(250_000_000)],
    });
    expect(run.baseline).toEqual(baseline);
    expect(run.forecast).toEqual(baseline?.forecast);
    expect(run.dominoes).toEqual(baseline?.dominoes);
    expect(run.constraintVersion).toMatch(/^rules\/[0-9a-f]{16}$/);
    expect(run.receipts).toHaveLength(1);
    expect(run.operation).toMatchObject({
      ownerDomain: "timeline",
      status: "succeeded",
      outputRefs: [rootId],
      evidenceRefs: [{ kind: "domain", id: baselineRunId }],
    });
    expect(Object.keys(run).sort()).toEqual(
      [
        "runId",
        "companyId",
        "baselineRunId",
        "parentRunId",
        "kind",
        "label",
        "savedAt",
        "inputHash",
        "methodVersion",
        "constraintVersion",
        "constraintNote",
        "constraints",
        "ownChanges",
        "changes",
        "forecast",
        "dominoes",
        "receipts",
        "comparison",
        "baseline",
        "operation",
      ].sort(),
    );
    expect(await runCount(t)).toBe(1);
  });

  it("rejects an unknown baseline and a request id reused for another baseline", async () => {
    const t = setup();
    const { rootId } = await root(t);
    await expect(
      t.mutation(w.open, {
        companyId: "kestrel",
        baselineRunId: "timeline:baseline/missing",
        requestId: "req-open-9",
      }),
    ).rejects.toThrow(/No saved baseline/);
    await expect(
      t.mutation(w.open, {
        companyId: "kestrel",
        baselineRunId: "timeline:baseline/other",
        requestId: "req-open-1",
      }),
    ).rejects.toThrow(/REQUEST_CONFLICT|different inputs/);
    await expect(
      t.mutation(w.open, { companyId: "kestrel", baselineRunId: "x", requestId: "bad" }),
    ).rejects.toThrow(/requestId/);
    expect((await get(t, rootId)).runId).toBe(rootId);
    expect(await runCount(t)).toBe(1);
  });

  it("reads saved outputs only and scopes every read to the company", async () => {
    const t = setup();
    const { rootId } = await root(t, [minCash(250_000_000)]);
    const child = await simulate(t, rootId, [spend(30_000_000)]);
    const spies = (["forecast", "dominoes", "history", "pastEvents"] as const).map((k) =>
      vi.spyOn(engine, k),
    );
    await get(t, child.runId);
    await t.query(w.catalog, {
      companyId: "kestrel",
      paginationOpts: { numItems: 10, cursor: null },
    });
    await t.query(w.resultRef, { companyId: "kestrel", runId: child.runId });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    expect(await t.query(w.get, { companyId: "other", runId: child.runId })).toBeNull();
    expect(await t.query(w.resultRef, { companyId: "other", runId: child.runId })).toBeNull();
    expect(
      await t.query(w.get, { companyId: "kestrel", runId: "timeline:workspace/x" }),
    ).toBeNull();
  });

  it("fails closed on a tampered saved row", async () => {
    const t = setup();
    const { rootId } = await root(t);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("timelineRuns").first();
      if (row) await ctx.db.patch(row._id, { forecast: { weeks: [] } });
    });
    await expect(t.query(w.get, { companyId: "kestrel", runId: rootId })).rejects.toThrow(
      /integrity/,
    );
  });
});

describe("timeline workspace: rules (TL1C)", () => {
  it("adds, edits and removes rules as new runs; older runs reopen unchanged", async () => {
    const t = setup();
    const { rootId } = await root(t);
    const rootBefore = await get(t, rootId);
    expect(rootBefore.receipts).toEqual([]);

    const added = await revise(t, rootId, [minCash(250_000_000)], { note: "Keep $2.5M" });
    const addedRun = await get(t, added.runId);
    expect(addedRun).toMatchObject({
      kind: "rules",
      parentRunId: rootId,
      constraintNote: "Keep $2.5M",
      constraints: [minCash(250_000_000)],
      ownChanges: [],
      changes: [],
    });
    expect(addedRun.forecast).toEqual(rootBefore.forecast);
    expect(addedRun.comparison?.weekly.every((x) => x.usableDelta === 0)).toBe(true);
    expect(addedRun.comparison?.lowPointDelta).toBe(0);
    expect(addedRun.receipts[0]).toMatchObject({ status: "clear", relation: "clear" });

    const edited = await revise(t, added.runId, [minCash(300_000_000)], { note: "Raise to $3M" });
    const editedRun = await get(t, edited.runId);
    expect(editedRun.constraintVersion).not.toBe(addedRun.constraintVersion);
    expect(editedRun.receipts[0]?.constraintVersion).not.toBe(
      addedRun.receipts[0]?.constraintVersion,
    );
    // The plan already falls below $3M: a rule edit never blames an action.
    expect(editedRun.receipts[0]).toMatchObject({
      status: "breached",
      relation: "pre_existing",
      actionLabels: [],
      value: 268_900_000,
      shortfall: 31_100_000,
      weekStart: "2026-11-16",
      date: "2026-11-22",
      unit: "cents",
    });

    const removed = await revise(t, edited.runId, [], { note: "Remove the minimum" });
    expect((await get(t, removed.runId)).constraints).toEqual([]);
    expect((await get(t, removed.runId)).receipts).toEqual([]);

    // Reopen: earlier nodes keep their own rules and receipts.
    expect(await get(t, rootId)).toEqual(rootBefore);
    expect(await get(t, added.runId)).toEqual(addedRun);
    expect(await get(t, edited.runId)).toEqual(editedRun);
    expect(await runCount(t)).toBe(4);
  });

  it("requires confirmation and a real change, and validates rule targets", async () => {
    const t = setup();
    const { rootId } = await root(t, [minCash(250_000_000)]);
    await expect(revise(t, rootId, [], { reviewed: false })).rejects.toThrow(/Confirm the rules/);
    await expect(revise(t, rootId, [], { note: " " })).rejects.toThrow(/Rule note/);
    await expect(revise(t, rootId, [minCash(250_000_000)])).rejects.toThrow(/same as the current/);
    await expect(revise(t, rootId, [payBy("bill_missing", 0)])).rejects.toThrow(
      /exist exactly once/,
    );
    await expect(revise(t, rootId, [minCash(1.5)])).rejects.toThrow(/integer cents/);
    await expect(revise(t, rootId, [runway(500)])).rejects.toThrow(/runway months/);
    await expect(revise(t, rootId, [minCash(1), minCash(2)])).rejects.toThrow(/repeated/);
    await expect(
      t.mutation(w.reviseConstraints, {
        companyId: "kestrel",
        parentRunId: rootId,
        requestId: nextId(),
        constraintsJson: JSON.stringify([{ ...minCash(1), severity: "high" }]),
        note: "x",
        reviewed: true,
      }),
    ).rejects.toThrow(/not part of the contract/);
    expect(await runCount(t)).toBe(1);
  });
});

describe("timeline workspace: scenarios (TL2)", () => {
  it("names the action behind a new minimum-cash breach with engine values", async () => {
    const t = setup();
    const { rootId } = await root(t, [minCash(250_000_000)]);
    const out = await simulate(t, rootId, [spend(30_000_000)], { label: "Buy equipment" });
    const run = await get(t, out.runId);
    const expected = engine.forecast(snapshot, NEUTRAL, [spend(30_000_000)]);
    expect(run.forecast).toEqual(expected);
    expect(run.kind).toBe("scenario");
    expect(run.receipts[0]).toMatchObject({
      constraintId: "user_min_cash",
      status: "breached",
      relation: "new",
      actionLabels: ["Equipment purchase"],
      value: 238_900_000,
      shortfall: 11_100_000,
      weekStart: "2026-11-16",
      date: "2026-11-22",
    });
    expect(run.comparison).toMatchObject({ parentRunId: rootId, lowPointDelta: -30_000_000 });
    expect(run.comparison?.weekly[0]).toEqual({ weekStart: "2026-11-02", usableDelta: 0 });
    expect(run.comparison?.weekly[1]).toEqual({
      weekStart: "2026-11-09",
      usableDelta: -30_000_000,
    });
    expect(run.dominoes).toEqual(
      engine.dominoes(expected, [minCash(250_000_000)], snapshot, {
        model: NEUTRAL,
        changes: [spend(30_000_000)],
        baseline: engine.forecast(snapshot, NEUTRAL, []),
      }),
    );
  });

  it("labels a breach the parent already had as pre-existing, and a cure as resolved", async () => {
    const t = setup();
    const { rootId } = await root(t, [minCash(300_000_000)]);
    expect((await get(t, rootId)).receipts[0]).toMatchObject({ relation: "pre_existing" });
    const worse = await get(t, (await simulate(t, rootId, [spend(1_000_000)])).runId);
    expect(worse.receipts[0]).toMatchObject({ relation: "pre_existing", actionLabels: [] });
    const cure: Change = {
      kind: "add_cash",
      date: "2026-11-03",
      amount: 50_000_000,
      label: "Loan",
    };
    const better = await get(t, (await simulate(t, rootId, [cure])).runId);
    expect(better.receipts[0]).toMatchObject({
      status: "clear",
      relation: "resolved",
      value: 318_900_000,
      shortfall: null,
    });
  });

  it("applies rules and changes as one atomic step, judging the parent under the new rules", async () => {
    const t = setup();
    const { rootId } = await root(t);
    const out = await simulate(t, rootId, [spend(30_000_000)], {
      constraints: [minCash(250_000_000)],
      constraintNote: "Keep $2.5M usable",
    });
    const run = await get(t, out.runId);
    expect(run).toMatchObject({
      constraints: [minCash(250_000_000)],
      constraintNote: "Keep $2.5M usable",
    });
    expect(run.receipts[0]).toMatchObject({
      relation: "new",
      actionLabels: ["Equipment purchase"],
    });
    await expect(
      simulate(t, rootId, [spend(1)], { constraintNote: "note without rules" }),
    ).rejects.toThrow(/rule note needs rules/);
    await expect(simulate(t, rootId, [spend(1)], { constraints: [minCash(1)] })).rejects.toThrow(
      /rule note/,
    );
    // A bad rule rejects the whole step: no run is saved.
    await expect(
      simulate(t, rootId, [spend(1)], { constraints: [payBy("nope", 0)], constraintNote: "x" }),
    ).rejects.toThrow(/exist exactly once/);
    expect(await runCount(t)).toBe(2);
  });

  it("checks a targeted payment deadline, including one beyond the forecast", async () => {
    const t = setup();
    const rules = [payBy("bill_agency_nov", 0), payBy("bill_cloud_q1", 60, "pay_cloud")];
    const { rootId } = await root(t, rules);
    const rootRun = await get(t, rootId);
    expect(rootRun.receipts[0]).toMatchObject({
      status: "clear",
      relation: "clear",
      unit: "days",
      date: "2026-11-15",
    });
    expect(rootRun.receipts[1]).toMatchObject({
      status: "beyond_horizon",
      relation: "outside_horizon",
      date: "2027-03-02",
      value: null,
    });
    expect(rootRun.receipts[1]?.evidence.join(" ")).toMatch(
      /after the forecast ends on 2027-01-31/,
    );

    const late: Change = { kind: "delay_bill", billId: "bill_agency_nov", days: 20 };
    const run = await get(t, (await simulate(t, rootId, [late])).runId);
    const receipt = run.receipts[0];
    expect(receipt).toMatchObject({
      status: "breached",
      relation: "new",
      actionLabels: ["Bill bill_agency_nov paid 20 days later"],
      date: "2026-11-15",
    });
    expect(receipt?.evidence.join(" ")).toMatch(/bill_agency_nov/);
    expect(receipt?.evidence.join(" ")).toMatch(/Deadline 2026-11-15/);
    expect(receipt?.evidence.join(" ")).toMatch(/Projected funding on 2026-12-05|not projected/);
  });

  it("reports runway status without inventing a runway figure", async () => {
    const t = setup();
    const { rootId } = await root(t, [runway(100)]);
    const receipt = (await get(t, rootId)).receipts[0];
    expect(receipt).toMatchObject({ kind: "min_runway_months", unit: "months", limit: 100 });
    expect(receipt?.value).toBeNull();
    expect(receipt?.shortfall).toBeNull();
    expect(["breached", "clear"]).toContain(receipt?.status);
  });

  it("applies nested ancestor changes exactly once to the original snapshot", async () => {
    const t = setup();
    const { rootId } = await root(t);
    const a = spend(10_000_000, "2026-11-10", "First purchase");
    const b = spend(5_000_000, "2026-12-01", "Second purchase");
    const one = await simulate(t, rootId, [a]);
    const rules = await revise(t, one.runId, [minCash(250_000_000)]);
    const two = await simulate(t, rules.runId, [b]);
    const run = await get(t, two.runId);
    expect(run.ownChanges).toEqual([b]);
    expect(run.changes).toEqual([a, b]);
    expect(run.forecast).toEqual(engine.forecast(snapshot, NEUTRAL, [a, b]));
    expect(run.comparison?.parentRunId).toBe(rules.runId);
    expect(run.comparison?.lowPointDelta).toBe(0);
    expect(run.comparison?.weekly[4]).toEqual({ weekStart: "2026-11-30", usableDelta: -5_000_000 });
    // The second scenario only names its own change.
    expect(run.receipts[0]).toMatchObject({ relation: "clear" });
  });

  it.each<[string, Change, RegExp]>([
    ["past spend", spend(100, "2026-10-15"), /HISTORICAL_CHANGE|Observed history/],
    ["spend on asOf", spend(100, "2026-10-30"), /Observed history/],
    [
      "paid invoice",
      { kind: "delay_invoice", invoiceId: "inv_acme_hist_1", days: 5 },
      /already paid/,
    ],
    ["paid bill", { kind: "delay_bill", billId: "bill_ops_00", days: 5 }, /already paid/],
    [
      "past churn",
      { kind: "churn", customerId: "cus_acme", fromDate: "2026-09-01" },
      /Observed history/,
    ],
    ["after horizon", spend(100, "2027-02-01"), /OUTSIDE_HORIZON|after the forecast ends/],
    [
      "early pay after horizon",
      { kind: "discount_early_pay", invoiceId: "inv_nw_q4", percent: 2, payOn: "2027-03-01" },
      /after the forecast ends/,
    ],
    ["critical bill", { kind: "delay_bill", billId: "bill_rent_nov", days: 5 }, /critical/],
    ["unknown invoice", { kind: "lose_invoice", invoiceId: "inv_none" }, /exist exactly once/],
    [
      "unknown customer",
      { kind: "churn", customerId: "cus_none", fromDate: "2026-11-10" },
      /not in the seed/,
    ],
    ["impossible date", spend(100, "2026-11-31"), /real calendar date/],
    ["fractional cents", spend(10.5), /Expected integer/],
    ["negative cents", spend(-100), /positive integer cents/],
    ["zero delay", { kind: "delay_invoice", invoiceId: "inv_nw_q4", days: 0 }, /1-366 days/],
    ["unsafe money", spend(Number.MAX_SAFE_INTEGER), /integer cents|too large/],
    ["blank label", spend(100, "2026-11-10", " "), /short label/],
  ])("rejects %s with a reason and saves nothing", async (_name, change, error) => {
    const t = setup();
    const { rootId } = await root(t);
    await expect(simulate(t, rootId, [change])).rejects.toThrow(error);
    expect(await runCount(t)).toBe(1);
  });

  it("enforces input, label, depth and total-change bounds", async () => {
    const t = setup();
    const { rootId } = await root(t);
    await expect(simulate(t, rootId, [])).rejects.toThrow(/at least one change/);
    await expect(simulate(t, rootId, [spend(1)], { reviewed: false })).rejects.toThrow(/Confirm/);
    await expect(simulate(t, rootId, [spend(1)], { label: "x".repeat(201) })).rejects.toThrow(
      /label must be/,
    );
    await expect(simulate(t, rootId, [], { changesJson: " ".repeat(70_000) })).rejects.toThrow(
      /too large/,
    );
    await expect(
      simulate(t, rootId, [], { changesJson: JSON.stringify([{ ...spend(1), extra: true }]) }),
    ).rejects.toThrow(/not part of the contract/);
    await expect(
      simulate(t, rootId, [spend(1, "2026-11-10", "a"), spend(1, "2026-11-11", "a")]),
    ).rejects.toThrow(/more than one change/);
    const many = Array.from({ length: 65 }, (_, i) => spend(1, "2026-11-10", `item ${i}`));
    await expect(simulate(t, rootId, many)).rejects.toThrow(/at most 64 changes/);

    let parent = rootId;
    for (let i = 0; i < 20; i++)
      parent = (await simulate(t, parent, [spend(1, "2026-11-10", `step ${i}`)])).runId;
    await expect(simulate(t, parent, [spend(1, "2026-11-10", "step 21")])).rejects.toThrow(
      /at most 20 earlier steps/,
    );
    expect(await runCount(t)).toBe(21);
  });
});

describe("timeline workspace: requests and isolation", () => {
  it("binds every reused root request to its original baseline and operation", async () => {
    const t = setup();
    const { baselineRunId, rootId } = await root(t);
    const args = { companyId: "kestrel", baselineRunId, requestId: "req-open-alias" };
    const replies = await Promise.all([t.mutation(w.open, args), t.mutation(w.open, args)]);
    expect(replies).toEqual([
      { companyId: "kestrel", runId: rootId, created: false },
      { companyId: "kestrel", runId: rootId, created: false },
    ]);
    const other = await saveBaseline(t, [], { requestId: "req-another-baseline" });
    await expect(t.mutation(w.open, { ...args, baselineRunId: other.runId })).rejects.toThrow(
      /different inputs/,
    );
    await expect(simulate(t, rootId, [spend(1)], { requestId: args.requestId })).rejects.toThrow(
      /different inputs/,
    );
    await expect(revise(t, rootId, [minCash(1)], { requestId: args.requestId })).rejects.toThrow(
      /different inputs/,
    );
    const receipts = await t.run((ctx) => ctx.db.query("timelineRunRequests").collect());
    expect(receipts.filter((r) => r.requestId === args.requestId)).toHaveLength(1);
    expect(await runCount(t)).toBe(1);
  });

  it("preserves legacy run request bindings and backfills receipts without recalculating", async () => {
    const t = setup();
    const { baselineRunId, rootId } = await root(t);
    const child = await simulate(t, rootId, [spend(100)], { requestId: "req-legacy-child" });
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("timelineRunRequests").collect())
        await ctx.db.delete(row._id);
    });
    const forecast = vi.spyOn(engine, "forecast");
    expect(
      await t.mutation(w.open, { companyId: "kestrel", baselineRunId, requestId: "req-open-1" }),
    ).toEqual({ companyId: "kestrel", runId: rootId, created: false });
    expect(await simulate(t, rootId, [spend(100)], { requestId: "req-legacy-child" })).toEqual({
      ...child,
      created: false,
    });
    expect(forecast).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("timelineRunRequests").collect())).toHaveLength(2);
    await expect(
      simulate(t, rootId, [spend(200)], { requestId: "req-legacy-child" }),
    ).rejects.toThrow(/different inputs/);
    await expect(revise(t, rootId, [minCash(1)], { requestId: "req-open-1" })).rejects.toThrow(
      /different inputs/,
    );
  });

  it("returns the saved run on retry, conflicts on changed input, survives concurrency", async () => {
    const t = setup();
    const { rootId } = await root(t);
    const first = await simulate(t, rootId, [spend(100)], { requestId: "req-sim-1" });
    expect(first.created).toBe(true);
    expect(await simulate(t, rootId, [spend(100)], { requestId: "req-sim-1" })).toEqual({
      ...first,
      created: false,
    });
    await expect(simulate(t, rootId, [spend(200)], { requestId: "req-sim-1" })).rejects.toThrow(
      /different inputs/,
    );
    await expect(revise(t, rootId, [], { requestId: "req-sim-1" })).rejects.toThrow(
      /different inputs/,
    );
    const [a, b] = await Promise.all([
      simulate(t, rootId, [spend(300)], { requestId: "req-sim-2" }),
      simulate(t, rootId, [spend(300)], { requestId: "req-sim-2" }),
    ]);
    expect(a.runId).toBe(b.runId);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect(await runCount(t)).toBe(3);
  });

  it("keeps companies apart: no cross-company parents, catalogs or request bindings", async () => {
    const t = setup();
    const { rootId } = await root(t);
    const other = await saveBaseline(t, [], {
      requestId: "req-baseline-other",
      seedJson: await otherCompanySeed(),
    });
    expect(other.companyId).toBe("other");
    // Kestrel's baseline cannot be opened under another company id.
    await expect(
      t.mutation(w.open, {
        companyId: "other",
        baselineRunId: (await get(t, rootId)).baselineRunId,
        requestId: "req-open-x",
      }),
    ).rejects.toThrow(/No saved baseline/);
    const otherRoot = await t.mutation(w.open, {
      companyId: "other",
      baselineRunId: other.runId,
      requestId: "req-open-1",
    });
    expect(otherRoot.created).toBe(true);
    await expect(simulate(t, rootId, [spend(1)], { companyId: "other" })).rejects.toThrow(
      /No saved run/,
    );
    await expect(revise(t, otherRoot.runId, [], { companyId: "kestrel" })).rejects.toThrow(
      /No saved run/,
    );
    // The same request id is independent per company.
    const k = await simulate(t, rootId, [spend(1)], { requestId: "req-shared-1" });
    const o = await simulate(t, otherRoot.runId, [spend(2)], {
      requestId: "req-shared-1",
      companyId: "other",
    });
    expect(k.runId).not.toBe(o.runId);
    const page = await t.query(w.catalog, {
      companyId: "kestrel",
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(page.page.every((e) => e.companyId === "kestrel")).toBe(true);
    expect(page.page).toHaveLength(2);
  });
});

describe("timeline workspace: effective schedule boundaries (TL5 repair)", () => {
  it("rejects unbounded hire intervals before calling the engine and accepts the exclusive horizon end", async () => {
    const t = setup();
    const { rootId } = await root(t);
    const hire: Change = {
      kind: "shift_hire",
      label: "Defer new hire",
      monthlyCost: 100_000,
      fromDate: "2026-11-02",
      toDate: "9999-12-31",
    };
    const forecast = vi.spyOn(engine, "forecast");
    await expect(simulate(t, rootId, [hire])).rejects.toThrow(/end it on or before 2027-02-01/);
    expect(forecast).not.toHaveBeenCalled();
    const bounded: Change = { ...hire, toDate: "2027-02-01" };
    const child = await simulate(t, rootId, [bounded]);
    expect((await get(t, child.runId)).forecast).toEqual(
      engine.forecast(snapshot, NEUTRAL, [bounded]),
    );
  });

  it.each<[Change, RegExp]>([
    [{ kind: "delay_invoice", invoiceId: "inv_nw_q4", days: -366 }, /Observed history/],
    [{ kind: "delay_bill", billId: "bill_agency_nov", days: -366 }, /Observed history/],
  ])(
    "rejects an effective historical payment with no run or receipt saved",
    async (change, error) => {
      const t = setup();
      const { rootId } = await root(t);
      await expect(simulate(t, rootId, [change])).rejects.toThrow(error);
      expect(await runCount(t)).toBe(1);
      expect(await t.run((ctx) => ctx.db.query("timelineRunRequests").collect())).toHaveLength(1);
    },
  );

  it("checks cumulative invoice delays against the frozen model instead of the raw due date", async () => {
    const t = setup();
    const invoice = snapshot.invoices.find((i) => i.id === "inv_nw_q4");
    if (!invoice) throw new Error("missing fixture invoice");
    const model: CompanyModel = {
      ...NEUTRAL,
      customerDelayDays: { [invoice.customerId]: { mean: 40, p90: 40, samples: 1 } },
    };
    const baseline = await saveBaseline(t, [], { model });
    const opened = await t.mutation(w.open, {
      companyId: "kestrel",
      baselineRunId: baseline.runId,
      requestId: "req-model-open",
    });
    const first: Change = { kind: "delay_invoice", invoiceId: invoice.id, days: -70 };
    const one = await simulate(t, opened.runId, [first]);
    const schedule = cashSchedule(snapshot, model, [first]);
    expect(schedule.items.find((i) => i.kind === "invoice" && i.id === invoice.id)?.date).toBe(
      "2026-10-31",
    );
    await expect(
      simulate(t, one.runId, [{ kind: "delay_invoice", invoiceId: invoice.id, days: -1 }]),
    ).rejects.toThrow(/Observed history/);
    expect(await runCount(t)).toBe(2);
    expect((await get(t, one.runId)).forecast).toEqual(engine.forecast(snapshot, model, [first]));
  });

  it("permits removing in-horizon cash by delay, then rejects edits wholly beyond the horizon", async () => {
    const t = setup();
    const { rootId } = await root(t);
    const delay: Change = { kind: "delay_invoice", invoiceId: "inv_nw_q4", days: 120 };
    const one = await simulate(t, rootId, [delay]);
    expect((await get(t, one.runId)).forecast).toEqual(engine.forecast(snapshot, NEUTRAL, [delay]));
    await expect(
      simulate(t, one.runId, [{ kind: "delay_invoice", invoiceId: "inv_nw_q4", days: 1 }]),
    ).rejects.toThrow(/both, after the forecast/);
    await expect(
      simulate(t, one.runId, [{ kind: "lose_invoice", invoiceId: "inv_nw_q4" }]),
    ).rejects.toThrow(/after the forecast/);
    // Moving it back into the horizon is a real future effect.
    const back = await simulate(t, one.runId, [
      { kind: "delay_invoice", invoiceId: "inv_nw_q4", days: -120 },
    ]);
    expect((await get(t, back.runId)).forecast).toEqual((await get(t, rootId)).forecast);
  });

  it("rejects changes to cash already removed by ancestor loss, churn or full discount", async () => {
    const t = setup();
    const { rootId } = await root(t);
    for (const change of [
      { kind: "lose_invoice", invoiceId: "inv_nw_q4" },
      { kind: "churn", customerId: "cus_northwind", fromDate: "2026-10-31" },
      { kind: "discount_early_pay", invoiceId: "inv_nw_q4", percent: 100, payOn: "2026-11-02" },
    ] satisfies Change[]) {
      const one = await simulate(t, rootId, [change]);
      await expect(
        simulate(t, one.runId, [{ kind: "delay_invoice", invoiceId: "inv_nw_q4", days: 1 }]),
      ).rejects.toThrow(/no remaining expected cash/);
    }
  });

  it("rejects churn with no remaining affected cash and early payment that changes nothing", async () => {
    const t = setup();
    const { rootId } = await root(t);
    await expect(
      simulate(t, rootId, [{ kind: "churn", customerId: "cus_northwind", fromDate: "2027-01-31" }]),
    ).rejects.toThrow(/no remaining expected cash/);
    const first: Change = {
      kind: "discount_early_pay",
      invoiceId: "inv_nw_q4",
      percent: 100,
      payOn: "2026-11-02",
    };
    const child = await simulate(t, rootId, [first]);
    await expect(simulate(t, child.runId, [first])).rejects.toThrow(/no remaining expected cash/);
  });

  it("rejects changes that round to no cash effect before saving a run", async () => {
    const t = setup();
    const { rootId } = await root(t);
    await expect(
      simulate(t, rootId, [
        {
          kind: "discount_early_pay",
          invoiceId: "inv_nw_q4",
          percent: 0.000000000001,
          payOn: "2026-11-30",
        },
      ]),
    ).rejects.toThrow(/does not change any expected cash/);
    await expect(
      simulate(t, rootId, [
        {
          kind: "shift_hire",
          label: "A fraction of a cent saved",
          monthlyCost: 1,
          fromDate: "2026-11-02",
          toDate: "2026-11-03",
        },
      ]),
    ).rejects.toThrow(/does not change any expected cash/);
    expect(await runCount(t)).toBe(1);
  });

  it("retains supported fractional runway limits and identifies group attribution honestly", async () => {
    const t = setup();
    const { rootId } = await root(t, [minCash(250_000_000), runway(4.5)]);
    const child = await simulate(t, rootId, [
      { kind: "add_cash", date: "2026-11-10", amount: 100, label: "Cash injection" },
      spend(30_000_100),
    ]);
    const run = await get(t, child.runId);
    expect(run.constraints[1]?.limit).toBe(4.5);
    expect(run.receipts[0]?.actionLabels).toEqual(["Cash injection", "Equipment purchase"]);
    expect(run.receipts[0]?.evidence.join(" ")).toMatch(
      /as a whole.*individual causes were not tested/,
    );
  });

  it("does not claim a newly caused breach when the parent rule cannot be evaluated", () => {
    const rule = minCash(250_000_000);
    const changes = [spend(30_000_000)];
    const forecast = engine.forecast(snapshot, NEUTRAL, changes);
    const incompatibleParent = structuredClone(engine.forecast(snapshot, NEUTRAL, []));
    incompatibleParent.weeks[0]!.usable += 1;
    const [receipt] = ruleReceipts({
      snapshot,
      model: NEUTRAL,
      rules: [rule],
      versionOf: () => "test-version",
      plan: { forecast, changes },
      parent: { forecast: incompatibleParent, changes: [] },
      ownChanges: changes,
      horizonEnd: "2027-01-31",
    });
    expect(receipt).toMatchObject({ status: "breached", relation: "unable", actionLabels: [] });
    expect(receipt?.evidence.join(" ")).toMatch(/starting plan could not be evaluated/);
  });
});

describe("timeline workspace: catalog, graph and result ref (TL4)", () => {
  it("pages the company catalog newest first and lists one baseline's graph oldest first", async () => {
    const t = setup();
    const { baselineRunId, rootId } = await root(t);
    const ids = [rootId];
    for (let i = 0; i < 4; i++) ids.push((await simulate(t, rootId, [spend(i + 1)])).runId);

    const first = await t.query(w.catalog, {
      companyId: "kestrel",
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(first.page.map((e) => e.runId)).toEqual([ids[4], ids[3]]);
    expect(first.isDone).toBe(false);
    expect(Object.keys(first).sort()).toEqual(["continueCursor", "isDone", "page"]);
    const second = await t.query(w.catalog, {
      companyId: "kestrel",
      paginationOpts: { numItems: 2, cursor: first.continueCursor },
    });
    expect(second.page.map((e) => e.runId)).toEqual([ids[2], ids[1]]);
    const third = await t.query(w.catalog, {
      companyId: "kestrel",
      paginationOpts: { numItems: 2, cursor: second.continueCursor },
    });
    expect(third.page.map((e) => e.runId)).toEqual([ids[0]]);
    expect(third.isDone).toBe(true);

    const entry = first.page[0];
    expect(entry).toMatchObject({
      companyId: "kestrel",
      baselineRunId,
      parentRunId: rootId,
      kind: "scenario",
      lowPointWeek: "2026-11-16",
      lowPointCents: 268_900_000 - 4,
    });
    expect(Object.keys(entry ?? {}).sort()).toEqual(
      [
        "runId",
        "companyId",
        "baselineRunId",
        "parentRunId",
        "kind",
        "label",
        "savedAt",
        "lowPointCents",
        "lowPointWeek",
        "constraintVersion",
        "startsOn",
      ].sort(),
    );

    for (const numItems of [0, 101, 1.5])
      await expect(
        t.query(w.catalog, { companyId: "kestrel", paginationOpts: { numItems, cursor: null } }),
      ).rejects.toThrow(/Page size/);
    expect(
      (
        await t.query(w.catalog, {
          companyId: "other",
          paginationOpts: { numItems: 5, cursor: null },
        })
      ).page,
    ).toEqual([]);

    const graph = await t.query(w.graph, { companyId: "kestrel", baselineRunId });
    expect(graph.map((e) => e.runId)).toEqual(ids);
    expect(await t.query(w.graph, { companyId: "other", baselineRunId })).toEqual([]);
  });

  it("returns a canonical WeeklyResultRefV1 for a saved run", async () => {
    const t = setup();
    const { rootId } = await root(t);
    const child = await simulate(t, rootId, [spend(1)]);
    for (const [runId, kind] of [
      [rootId, "forecast"],
      [child.runId, "scenario"],
    ] as const) {
      const text = await t.query(w.resultRef, { companyId: "kestrel", runId });
      const parsed = parseWeeklyResultRefJson(text);
      if (!parsed.success) throw new Error("expected a valid result ref");
      expect(parsed.data).toEqual({
        seedId: seed.id,
        seedHash: seed.contentHash,
        kind,
        branchIds: [runId],
        route: `/c/kestrel/timeline?runId=${encodeURIComponent(runId)}`,
      });
    }
    expect(
      await t.query(w.resultRef, { companyId: "kestrel", runId: "timeline:workspace/x" }),
    ).toBeNull();
  });
});
