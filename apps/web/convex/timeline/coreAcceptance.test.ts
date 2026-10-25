/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import {
  type Change,
  type Constraint,
  WeeklySeedV1Schema,
  parseOperationSummaryJson,
  parseWeeklyResultRefJson,
} from "@domino/contracts";
import { weeklyBoundaryFixtures } from "@domino/contracts/fixtures";
import { engine } from "@domino/engine";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import { baselineRefs } from "./refs";
import { workspaceRefs } from "./workspaceRefs";

// These tests use the real workspace and question modules together, with no fake financial API.
const modules = Object.fromEntries(
  Object.entries(
    import.meta.glob([
      "../**/*.ts",
      "../_generated/*.js",
      "!../**/*.test.ts",
      "!./*.test.ts",
      "!./*.test-support.ts",
    ]),
  ).map(([path, load]) => [path.replace(/^\.\//, "../timeline/"), load]),
);
const setup = () => convexTest(schema, modules);
type Test = ReturnType<typeof setup>;
const seed = WeeklySeedV1Schema.parse(weeklyBoundaryFixtures.validKestrelWeeklySeed);
const model = { version: 0, customerDelayDays: {}, recurringSpend: [], rules: [] };
const askRef = makeFunctionReference<
  "action",
  {
    companyId: string;
    runId: string;
    requestId: string;
    prompt: string;
    selectedWeek?: string;
  },
  unknown
>("timeline/questions:ask");
const listRef = makeFunctionReference<"query", { companyId: string; runId: string }, unknown>(
  "timeline/questions:list",
);
const linkRef = makeFunctionReference<
  "mutation",
  { companyId: string; questionId: string; resultRunId: string },
  unknown
>("timeline/questions:link");

// The UI's boundary parser proves the combined API also fits the actual screen projection.
import { readQuestion, readQuestions, readRun } from "../../components/timeline/workspace/api";

afterEach(() => vi.restoreAllMocks());

async function open(t: Test) {
  const baseline = await t.mutation(baselineRefs.save, {
    requestId: "tl5-acceptance-baseline",
    seedJson: JSON.stringify(seed),
    modelJson: JSON.stringify(model),
    constraintsJson: "[]",
    assumptionNote: "Reviewed neutral assumptions; labelled synthetic peer fixture.",
    reviewed: true,
  });
  const root = await t.mutation(workspaceRefs.open, {
    companyId: seed.company.id,
    baselineRunId: baseline.runId,
    requestId: "tl5-acceptance-root",
  });
  return { baseline, root, key: { companyId: seed.company.id, runId: root.runId } };
}

async function ask(
  t: Test,
  runId: string,
  requestId: string,
  prompt: string,
  selectedWeek?: string,
) {
  const key = { companyId: seed.company.id, runId };
  const raw = await t.action(askRef, {
    ...key,
    requestId,
    prompt,
    ...(selectedWeek ? { selectedWeek } : {}),
  });
  const q = readQuestion(raw, key);
  if (!q) throw new Error("Question output does not fit the screen interface");
  return q;
}

describe("TL5 complete weekly journey", () => {
  it("answers evidence, confirms a prompt rule/event, adds a child and quietly reopens", async () => {
    const t = setup();
    const { root, key } = await open(t);
    const rootBefore = await t.query(workspaceRefs.get, key);
    if (!rootBefore) throw new Error("missing root");
    expect(readRun(rootBefore, key).state).toBe("ready");
    const q = await ask(
      t,
      root.runId,
      "tl5-acceptance-why",
      "Why did cash drop this week?",
      "2026-11-02",
    );
    expect(q.status).toBe("answered");
    expect(q.answer).toContain("Payroll");
    expect(q.citations.some((c) => c.ref.includes("pay_1106"))).toBe(true);

    const prompt =
      "What if we spend $80,000 to Atlas Legal on 2026-11-17? Keep usable cash above $2,650,000.";
    const proposal = await ask(t, root.runId, "tl5-acceptance-proposal", prompt);
    expect(proposal.status).toBe("proposal");
    const p = proposal.proposal;
    if (!p?.constraints) throw new Error("expected rule and event proposal");
    expect(p.changes).toEqual([
      {
        kind: "remove_cash",
        date: "2026-11-17",
        amount: 8_000_000,
        label: "Payment to Atlas Legal",
      },
    ]);
    expect(p.constraints.some((c) => c.kind === "min_cash" && c.limit === 265_000_000)).toBe(true);
    const confirmed = await t.mutation(workspaceRefs.simulate, {
      companyId: key.companyId,
      parentRunId: root.runId,
      requestId: "tl5-acceptance-confirm",
      label: p.label,
      changesJson: JSON.stringify(p.changes),
      constraintsJson: JSON.stringify(p.constraints),
      constraintNote: p.constraintNote ?? "Confirmed proposal",
      reviewed: true,
    });
    await t.mutation(linkRef, {
      companyId: key.companyId,
      questionId: proposal.id,
      resultRunId: confirmed.runId,
    });
    const confirmedKey = { ...key, runId: confirmed.runId };
    const first = await t.query(workspaceRefs.get, confirmedKey);
    if (!first) throw new Error("missing confirmed run");
    expect(first.forecast).toEqual(engine.forecast(seed.snapshot, model, p.changes));
    expect(first.receipts[0]).toMatchObject({
      status: "breached",
      relation: "new",
      limit: 265_000_000,
    });
    expect(first.receipts[0]?.shortfall).toBe(265_000_000 - (first.receipts[0]?.value ?? 0));
    expect(readRun(first, confirmedKey).state).toBe("ready");

    const extra: Change = {
      kind: "remove_cash",
      date: "2026-12-01",
      amount: 1_000_000,
      label: "Planned follow-up expense",
    };
    const child = await t.mutation(workspaceRefs.simulate, {
      companyId: key.companyId,
      parentRunId: first.runId,
      requestId: "tl5-acceptance-child",
      label: "Follow-up expense",
      changesJson: JSON.stringify([extra]),
      reviewed: true,
    });
    const childKey = { ...key, runId: child.runId };
    const saved = await t.query(workspaceRefs.get, childKey);
    expect(saved?.changes).toEqual([...p.changes, extra]);
    expect(saved?.forecast).toEqual(engine.forecast(seed.snapshot, model, [...p.changes, extra]));
    expect(saved?.baseline.history).toEqual(rootBefore.baseline.history);
    expect(await t.query(workspaceRefs.get, key)).toEqual(rootBefore);

    const calls = [
      vi.spyOn(engine, "forecast"),
      vi.spyOn(engine, "dominoes"),
      vi.spyOn(globalThis, "fetch"),
    ];
    expect(await t.query(workspaceRefs.get, childKey)).toEqual(saved);
    const questions = readQuestions(await t.query(listRef, key), key);
    expect(questions.state).toBe("ready");
    if (questions.state === "ready")
      expect(questions.value.find((r) => r.id === proposal.id)?.linkedRunId).toBe(first.runId);
    expect(await ask(t, root.runId, "tl5-acceptance-proposal", prompt)).toMatchObject({
      id: proposal.id,
      linkedRunId: first.runId,
    });
    const catalog = await t.query(workspaceRefs.catalog, {
      companyId: key.companyId,
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(catalog.page).toHaveLength(2);
    expect(catalog.isDone).toBe(false);
    const pointer = parseWeeklyResultRefJson(await t.query(workspaceRefs.resultRef, childKey));
    expect(pointer.success).toBe(true);
    if (pointer.success) expect(pointer.data.branchIds).toContain(child.runId);
    expect(parseOperationSummaryJson(JSON.stringify(saved?.operation)).success).toBe(true);
    for (const spy of calls) expect(spy).not.toHaveBeenCalled();
  });

  it("keeps old rules and outputs after fractional runway edits and removal", async () => {
    const t = setup();
    const { key } = await open(t);
    const rule: Constraint = {
      id: "tl5-runway",
      label: "4.5 months of runway",
      kind: "min_runway_months",
      limit: 4.5,
      evidence: { source: "document", ref: "timeline:user/tl5", note: "User test assumption" },
    };
    const result = await t.mutation(workspaceRefs.reviseConstraints, {
      companyId: key.companyId,
      parentRunId: key.runId,
      requestId: "tl5-runway-rule",
      constraintsJson: JSON.stringify([rule]),
      note: "Reviewed runway assumption",
      reviewed: true,
    });
    const ruleKey = { ...key, runId: result.runId };
    const before = await t.query(workspaceRefs.get, ruleKey);
    expect(readRun(before, ruleKey).state).toBe("ready");
    const removed = await t.mutation(workspaceRefs.reviseConstraints, {
      companyId: key.companyId,
      parentRunId: result.runId,
      requestId: "tl5-remove-rule",
      constraintsJson: "[]",
      note: "Remove this test rule",
      reviewed: true,
    });
    expect(
      (await t.query(workspaceRefs.get, { ...key, runId: removed.runId }))?.constraints,
    ).toEqual([]);
    expect(await t.query(workspaceRefs.get, ruleKey)).toEqual(before);
  });
});

describe("TL5 rule-only question confirmation", () => {
  it("saves and links the exact proposed rule revision without creating an empty event", async () => {
    const t = setup();
    const { key } = await open(t);
    const proposal = await ask(t, key.runId, "tl5-rule-only", "Keep usable cash above $2,600,000.");
    expect(proposal.status).toBe("proposal");
    const p = proposal.proposal;
    if (!p?.constraints) throw new Error("expected proposed rules");
    expect(p.changes).toEqual([]);
    const revised = await t.mutation(workspaceRefs.reviseConstraints, {
      companyId: key.companyId,
      parentRunId: key.runId,
      requestId: "tl5-rule-only-confirm",
      constraintsJson: JSON.stringify(p.constraints),
      note: p.constraintNote ?? "Confirmed rules",
      reviewed: true,
    });
    expect(
      await t.mutation(linkRef, {
        companyId: key.companyId,
        questionId: proposal.id,
        resultRunId: revised.runId,
      }),
    ).toEqual({ linkedRunId: revised.runId });
    const saved = await t.query(workspaceRefs.get, { ...key, runId: revised.runId });
    expect(saved?.kind).toBe("rules");
    expect(saved?.constraints).toEqual(p.constraints);
    expect(saved?.changes).toEqual([]);
    expect(saved?.forecast).toEqual((await t.query(workspaceRefs.get, key))?.forecast);
  });
});
