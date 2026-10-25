/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { type Constraint, WeeklySeedV1Schema } from "@domino/contracts";
import { weeklyBoundaryFixtures } from "@domino/contracts/fixtures";
import { engine } from "@domino/engine";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import { projectRun } from "../questions/context";
import { baselineRefs } from "../refs";
import { workspaceRefs } from "../workspaceRefs";
import { validateProposal } from "./draft";
import type { ChatReceipt } from "./receipt";
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
const rid = () => `chat-test-${++serial}`;
async function source(t: T, constraints: Constraint[] = []) {
  const seed = WeeklySeedV1Schema.parse(weeklyBoundaryFixtures.validKestrelWeeklySeed);
  const saved = await t.mutation(baselineRefs.save, {
    requestId: rid(),
    seedJson: JSON.stringify(seed),
    modelJson: JSON.stringify({ version: 0, customerDelayDays: {}, recurringSpend: [], rules: [] }),
    constraintsJson: JSON.stringify(constraints),
    assumptionNote: "Labelled synthetic Kestrel fixture",
    reviewed: true,
  });
  const opened = await t.mutation(workspaceRefs.open, {
    companyId: seed.company.id,
    baselineRunId: saved.runId,
    requestId: rid(),
  });
  return { companyId: seed.company.id, runId: opened.runId };
}
const key = (r: ChatReceipt) => ({ companyId: r.companyId, conversationId: r.conversationId });
const send = (t: T, r: ChatReceipt, text: string, requestId = rid()) =>
  t.mutation(chatRefs.send, { ...key(r), requestId, expectedRevision: r.revision, text });
const start = async (t: T) =>
  t.mutation(chatRefs.begin, { ...(await source(t)), requestId: rid() });
const runs = (t: T) => t.run((ctx) => ctx.db.query("timelineRuns").collect());
afterEach(() => vi.restoreAllMocks());

describe("durable Timeline clarification chat", () => {
  it("clarifies amount, date and counterparty in typed turns; only explicit confirmation calculates", async () => {
    const t = setup();
    let r = await start(t);
    const before = (await runs(t)).length;
    const forecast = vi.spyOn(engine, "forecast");
    const network = vi.spyOn(globalThis, "fetch");
    r = await send(t, r, "pay");
    expect(r.pendingField).toBe("amount");
    r = await send(t, r, "$80,000");
    expect(r.pendingField).toBe("date");
    r = await send(t, r, "on 2026-11-17");
    expect(r.pendingField).toBe("counterparty");
    r = await send(t, r, "to Atlas Legal");
    expect(r.status).toBe("ready");
    expect(r.proposal?.changes).toEqual([
      {
        kind: "remove_cash",
        amount: 8_000_000,
        date: "2026-11-17",
        label: "Payment to Atlas Legal",
      },
    ]);
    expect(forecast).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    expect((await runs(t)).length).toBe(before);
    const args = { ...key(r), requestId: rid(), expectedRevision: r.revision, reviewed: true };
    const saved = await t.mutation(chatRefs.confirm, args);
    expect(saved.status).toBe("saved");
    expect(forecast).toHaveBeenCalled();
    expect((await runs(t)).length).toBe(before + 1);
    forecast.mockClear();
    expect(await t.mutation(chatRefs.confirm, args)).toEqual(saved);
    expect(await t.query(chatRefs.get, key(saved))).toEqual(saved);
    expect(
      await t.query(chatRefs.list, { companyId: saved.companyId, runId: saved.runId }),
    ).toEqual([saved]);
    expect(forecast).not.toHaveBeenCalled();
    const result = await t.query(workspaceRefs.get, {
      companyId: saved.companyId,
      runId: saved.linkedRunId!,
    });
    expect(result?.parentRunId).toBe(saved.runId);
    expect(result?.ownChanges).toEqual(r.proposal?.changes);
  });
  it("retains a complete event while clarifying a rule, preserves existing rules, and confirms atomically", async () => {
    const t = setup();
    const old: Constraint = {
      id: "old",
      kind: "min_runway_months",
      limit: 4.5,
      label: "Existing runway",
      evidence: { source: "document", ref: "test", note: "Reviewed" },
    };
    const src = await source(t, [old]);
    let r = await t.mutation(chatRefs.begin, { ...src, requestId: rid() });
    r = await send(t, r, "pay $80,000 to Atlas Legal on 2026-11-17; keep usable cash above");
    expect(r.pendingField).toBe("amount");
    r = await send(t, r, "$3M");
    expect(r.status).toBe("ready");
    expect(r.proposal?.changes).toHaveLength(1);
    expect(r.proposal?.constraints?.[0]).toEqual(old);
    expect(r.proposal?.constraints?.[1]?.limit).toBe(300_000_000);
    const saved = await t.mutation(chatRefs.confirm, {
      ...key(r),
      requestId: rid(),
      expectedRevision: r.revision,
      reviewed: true,
    });
    const result = await t.query(workspaceRefs.get, {
      companyId: saved.companyId,
      runId: saved.linkedRunId!,
    });
    expect(result?.constraints).toEqual(r.proposal?.constraints);
    expect(result?.ownChanges).toEqual(r.proposal?.changes);
  });
  it("compares retained rules by canonical content rather than object key order", async () => {
    const t = setup();
    const rule: Constraint = {
      id: "old",
      kind: "min_cash",
      limit: 265_000_000,
      label: "Minimum usable cash",
      evidence: { source: "document", ref: "fixture", note: "Reviewed" },
    };
    const src = await source(t, [rule]);
    const raw = await t.query(workspaceRefs.get, src);
    const run = projectRun(raw, src.companyId, src.runId);
    if (!run || run === "invalid") throw new Error("Invalid fixture");
    const reordered: Constraint = {
      evidence: { note: "Reviewed", ref: "fixture", source: "document" },
      label: rule.label,
      limit: rule.limit,
      kind: rule.kind,
      id: rule.id,
    };
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(run.constraints[0]));
    expect(() =>
      validateProposal(run, {
        label: "Retained rule",
        changes: [],
        constraints: [reordered],
        constraintNote: null,
      }),
    ).not.toThrow();
    expect(() =>
      validateProposal(run, {
        label: "Changed rule",
        changes: [],
        constraints: [{ ...reordered, limit: 265_000_001 }],
        constraintNote: null,
      }),
    ).toThrow(/CHAT_INTEGRITY/);
  });
  it("keeps repeated cash events distinct across saved ancestors, including the same date", async () => {
    const t = setup();
    const rule: Constraint = {
      id: "cash-min",
      kind: "min_cash",
      limit: 265_000_000,
      label: "Minimum usable cash",
      evidence: { source: "document", ref: "fixture", note: "Reviewed" },
    };
    const src = await source(t, [rule]);
    const ancestor = await t.mutation(workspaceRefs.simulate, {
      companyId: src.companyId,
      parentRunId: src.runId,
      requestId: rid(),
      label: "First Atlas payment",
      changesJson: JSON.stringify([
        {
          kind: "remove_cash",
          amount: 8_000_000,
          date: "2026-11-17",
          label: "Payment to Atlas Legal",
        },
      ]),
      reviewed: true,
    });
    let parentId = ancestor.runId;
    for (const [index, expectedLabel] of [
      "Payment to Atlas Legal (2026-11-18)",
      "Payment to Atlas Legal (2026-11-18 #2)",
    ].entries()) {
      let r = await t.mutation(chatRefs.begin, {
        companyId: src.companyId,
        runId: parentId,
        requestId: rid(),
      });
      r = await send(t, r, "What if we spend $500?");
      r = await send(t, r, "on 2026-11-18");
      r = await send(t, r, "Atlas Legal");
      expect(r.status).toBe("ready");
      expect(r.proposal?.changes).toEqual([
        { kind: "remove_cash", amount: 50_000, date: "2026-11-18", label: expectedLabel },
      ]);
      const args = { ...key(r), requestId: rid(), expectedRevision: r.revision, reviewed: true };
      const saved = await t.mutation(chatRefs.confirm, args);
      expect(await t.mutation(chatRefs.confirm, args)).toEqual(saved);
      const parent = await t.query(workspaceRefs.get, {
        companyId: src.companyId,
        runId: parentId,
      });
      const result = await t.query(workspaceRefs.get, {
        companyId: src.companyId,
        runId: saved.linkedRunId!,
      });
      expect(result?.constraints).toEqual([rule]);
      expect(result?.changes).toHaveLength(index + 2);
      expect(result?.changes[0]).toEqual({
        kind: "remove_cash",
        amount: 8_000_000,
        date: "2026-11-17",
        label: "Payment to Atlas Legal",
      });
      expect(result?.ownChanges).toEqual(r.proposal?.changes);
      expect(result!.forecast.weeks.at(-1)!.closing - parent!.forecast.weeks.at(-1)!.closing).toBe(
        -50_000,
      );
      parentId = saved.linkedRunId!;
    }
  });
  it("returns exact request snapshots across later turns and rejects changed payloads and stale revisions", async () => {
    const t = setup();
    const r = await start(t);
    const requestId = rid();
    const first = await send(t, r, "pay", requestId);
    const second = await send(t, first, "$80,000");
    expect(await send(t, r, "pay", requestId)).toEqual(first);
    await expect(send(t, r, "receive", requestId)).rejects.toThrow(/REQUEST_CONFLICT/);
    await expect(send(t, r, "$99")).rejects.toThrow(/STALE_REVISION/);
    expect(await t.query(chatRefs.get, key(r))).toEqual(second);
  });
  it.each(["$10.005", "$80,000 or $90,000", "-$50", "$9999999999999999999999"])(
    "keeps the amount question for unsafe or ambiguous reply %s",
    async (text) => {
      const t = setup();
      let r = await start(t);
      r = await send(t, r, "pay");
      r = await send(t, r, text);
      expect(r.pendingField).toBe("amount");
      expect(r.proposal).toBeNull();
      r = await send(t, r, "$80,000");
      expect(r.pendingField).toBe("date");
    },
  );
  it.each(["2026-11-31", "2026-11-17 or 2026-11-18", "2025-11-17", "2030-11-17"])(
    "keeps the date question for invalid reply %s",
    async (text) => {
      const t = setup();
      let r = await start(t);
      r = await send(t, r, "pay $80,000");
      r = await send(t, r, text);
      expect(r.pendingField).toBe("date");
      expect(r.proposal).toBeNull();
      r = await send(t, r, "2026-11-17");
      expect(r.pendingField).toBe("counterparty");
    },
  );
  it.each([
    "pay $80,000 or $90,000 to Atlas Legal on 2026-11-17",
    "keep cash above $3M daily",
    "hire two people",
    "receive $80,000 and pay $90,000 on 2026-11-17",
    "pay $80,000 to Atlas Legal on 2026-11-17 or 2026-11-18",
    "keep usable cash above $3M on 2026-12-01",
    "keep at least 6 months of runway until 2027-01-04",
  ])("does not guess ambiguous or unsupported initial request %s", async (text) => {
    const t = setup();
    let r = await start(t);
    const count = (await runs(t)).length;
    r = await send(t, r, text);
    expect(r.proposal).toBeNull();
    expect((await runs(t)).length).toBe(count);
  });
  it.each([
    "Pay $80k to Atlas on Nov 18 if Acme pays first",
    "Keep usable cash above $3M unless we raise capital",
    "Keep usable cash above $3M only for the US account",
    "Pay $80k to Atlas before Nov 18",
    "Receive $80k from Atlas after Nov 18",
    "Pay $80k to Atlas on Nov 18 excluding tax",
    "Pay $80k to Atlas on Nov 18 with a 10% discount",
    "Keep usable cash above $3M in the US account",
  ])("clarifies unsupported qualifiers without silently dropping them: %s", async (text) => {
    const t = setup();
    let r = await start(t);
    r = await send(t, r, text);
    expect(r.proposal).toBeNull();
    expect(r.pendingField).toBeNull();
    r = await send(t, r, "What if we spend $80,000?");
    expect(r.pendingField).toBe("date");
  });
  it.each([
    "Atlas 2026-11-19",
    "Atlas 90000",
    "Atlas and Beta",
    "Atlas then pay Beta",
    "Atlas receive 50k",
    "Atlas if Acme pays",
    "Atlas unless Acme pays",
    "Atlas before Friday",
  ])("keeps the counterparty question for mixed reply %s", async (text) => {
    const t = setup();
    let r = await start(t);
    r = await send(t, r, "pay $80,000 on 2026-11-17");
    expect(r.pendingField).toBe("counterparty");
    r = await send(t, r, text);
    expect(r.pendingField).toBe("counterparty");
    expect(r.proposal).toBeNull();
    r = await send(t, r, "Atlas Legal");
    expect(r.proposal?.changes).toEqual([
      {
        kind: "remove_cash",
        amount: 8_000_000,
        date: "2026-11-17",
        label: "Payment to Atlas Legal",
      },
    ]);
  });
  it("supports invoice, bill deadline and fractional runway with bounded typed clarification", async () => {
    const t = setup();
    let r = await start(t);
    r = await send(t, r, "invoice pays late");
    expect(r.pendingField).toBe("record");
    r = await send(t, r, "inv_acme_2027");
    expect(r.pendingField).toBe("late days");
    r = await send(t, r, "181 days");
    expect(r.pendingField).toBe("late days");
    r = await send(t, r, "14 days");
    expect(r.proposal?.changes).toEqual([
      { kind: "delay_invoice", invoiceId: "inv_acme_2027", days: 14 },
    ]);
    r = await t.mutation(chatRefs.reset, {
      ...key(r),
      requestId: rid(),
      expectedRevision: r.revision,
    });
    r = await send(t, r, "keep runway");
    expect(r.pendingField).toBe("months of runway");
    r = await send(t, r, "4.5 months");
    expect(r.proposal?.constraints?.[0]?.limit).toBe(4.5);
    r = await t.mutation(chatRefs.reset, {
      ...key(r),
      requestId: rid(),
      expectedRevision: r.revision,
    });
    r = await send(t, r, "pay a bill on time");
    expect(r.pendingField).toBe("record");
    const run = await t.query(workspaceRefs.get, { companyId: r.companyId, runId: r.runId });
    const bill = run?.baseline.seed.snapshot.bills.find((b) => !b.paid);
    if (!bill) throw new Error("fixture needs unpaid bill");
    r = await send(t, r, bill.id);
    expect(r.status).toBe("ready");
    expect(r.proposal?.constraints?.[0]?.billId).toBe(bill.id);
  });
  it("keeps known fields through invalid corrections; reset explicitly clears only the draft", async () => {
    const t = setup();
    let r = await start(t);
    r = await send(t, r, "receive $80,000 from Atlas Legal on 2026-11-17");
    expect(r.status).toBe("ready");
    r = await send(t, r, "change amount to $10.005");
    expect(r.pendingField).toBe("amount");
    r = await send(t, r, "$90,000");
    expect(r.proposal?.changes).toEqual([
      { kind: "add_cash", amount: 9_000_000, date: "2026-11-17", label: "Cash from Atlas Legal" },
    ]);
    const n = r.turns.length;
    r = await t.mutation(chatRefs.reset, {
      ...key(r),
      requestId: rid(),
      expectedRevision: r.revision,
    });
    expect(r.turns).toHaveLength(n + 1);
    expect(r.status).toBe("collecting");
    expect(r.proposal).toBeNull();
  });
  it("enforces source and company isolation, exact confirmation review and terminal saved state", async () => {
    const t = setup();
    let r = await start(t);
    expect(await t.query(chatRefs.get, { ...key(r), companyId: "wrong" })).toBeNull();
    await expect(
      t.mutation(chatRefs.begin, { companyId: "wrong", runId: r.runId, requestId: rid() }),
    ).rejects.toThrow(/SOURCE_UNAVAILABLE/);
    await expect(
      t.mutation(chatRefs.begin, {
        companyId: r.companyId,
        runId: r.runId,
        requestId: rid(),
        selectedWeek: "2026-11-03",
      }),
    ).rejects.toThrow(/INVALID_SELECTION/);
    await expect(
      t.mutation(chatRefs.confirm, {
        ...key(r),
        requestId: rid(),
        expectedRevision: r.revision,
        reviewed: true,
      }),
    ).rejects.toThrow(/CHAT_NOT_READY/);
    r = await send(t, r, "keep usable cash above $3M");
    await expect(
      t.mutation(chatRefs.confirm, {
        ...key(r),
        requestId: rid(),
        expectedRevision: r.revision,
        reviewed: false,
      }),
    ).rejects.toThrow(/INVALID_INPUT/);
    r = await t.mutation(chatRefs.confirm, {
      ...key(r),
      requestId: rid(),
      expectedRevision: r.revision,
      reviewed: true,
    });
    await expect(send(t, r, "pay")).rejects.toThrow(/CHAT_SAVED/);
  });
  it("rejects corrupt saved receipt and enforces the user-turn limit without partial writes", async () => {
    const t = setup();
    let r = await start(t);
    for (let i = 0; i < 20; i++) r = await send(t, r, "unsupported dialogue");
    await expect(send(t, r, "one more")).rejects.toThrow(/CHAT_LIMIT/);
    expect(await t.query(chatRefs.get, key(r))).toEqual(r);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("timelineChats").first();
      if (!row) throw Error("missing");
      await ctx.db.patch(row._id, {
        data: { ...row.data, receipt: { ...row.data.receipt, inputHash: "bad" } },
      });
    });
    await expect(t.query(chatRefs.get, key(r))).rejects.toThrow(/CHAT_INTEGRITY/);
  });
});
