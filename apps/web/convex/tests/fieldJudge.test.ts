/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import type { FunctionArgs } from "convex/server";
import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { JUDGE_LIMITS } from "../lib/judge";
import schema from "../schema";

const modules = import.meta.glob(["../**/*.ts", "../_generated/*.js", "!./**"]);
const newBackend = () => convexTest(schema, modules);
type T = ReturnType<typeof newBackend>;

afterEach(() => {
  vi.useRealTimers();
});

async function drain(t: T) {
  vi.runOnlyPendingTimers();
  await t.finishInProgressScheduledFunctions();
}

/** A judge sandbox with its agents started (new sandboxes start idle). */
async function judgeStart(t: T, args: FunctionArgs<typeof api.fieldJudge.start>) {
  const created = await t.mutation(api.fieldJudge.start, args);
  await t.mutation(api.fieldAgents.start, { companyId: created.companyId });
  return created;
}

async function started() {
  vi.useFakeTimers();
  const t = newBackend();
  const { companyId, name } = await judgeStart(t, {});
  await drain(t);
  return { t, companyId, name };
}

/** The ConvexError code a call fails with. */
async function code(p: Promise<unknown>) {
  try {
    await p;
  } catch (error) {
    if (error instanceof ConvexError) return error.data as { code: string; message: string };
    throw error;
  }
  throw new Error("expected the call to fail");
}

async function view(t: T, companyId: Id<"companies">) {
  const s = await t.query(api.fieldDashboard.summary, { companyId });
  if (!s?.result?.ok) throw new Error("no dashboard yet");
  return s.result.view;
}

const collections = (v: Awaited<ReturnType<typeof view>>) =>
  v.biggestLines.find((l) => l.id === "customer_collections")?.cents ?? 0;

describe("judge companies", () => {
  it("starts an isolated company hidden from the main picker, numbered per judge", async () => {
    const { t, companyId, name } = await started();
    expect(name).toBe("Judge Co. #1");
    const status = await t.query(api.field.status, { companyId });
    expect(status).toMatchObject({ snapshotVersion: 1, lastIngestStatus: "ok" });
    expect(await t.query(api.field.companies, {})).toEqual([]);
    const second = await judgeStart(t, { profile: "kestrel-late" });
    expect(second.name).toBe("Judge Co. #2");
    const listed = await t.query(api.fieldJudge.companies, {});
    expect(listed.map((c) => [c.name, c.profile])).toEqual([
      ["Judge Co. #2", "kestrel-late"],
      ["Judge Co. #1", "kestrel"],
    ]);
  }, 60_000);

  it("caps active judge companies", async () => {
    vi.useFakeTimers();
    const t = newBackend();
    await t.run(async (ctx) => {
      for (let n = 1; n <= JUDGE_LIMITS.activeCompanies; n++)
        await ctx.db.insert("companies", {
          name: `Judge Co. #${n}`,
          profile: "kestrel",
          currentWeek: 0,
          today: "2026-10-23",
          status: "ready",
          judge: true,
          judgeNumber: n,
        });
    });
    expect((await code(judgeStart(t, {}))).code).toBe("LIMIT");
  });

  it("reset archives the company and starts a fresh one with the same profile", async () => {
    vi.useFakeTimers();
    const t = newBackend();
    const first = await judgeStart(t, { profile: "kestrel-crunch" });
    await drain(t);
    const next = await t.mutation(api.fieldJudge.reset, { companyId: first.companyId });
    expect(next.name).toBe("Judge Co. #2");
    const old = await t.query(api.fieldJudge.state, { companyId: first.companyId });
    expect(old?.archived).toBe(true);
    expect(old?.checklist[0]?.done).toBe(false);
    const listed = await t.query(api.fieldJudge.companies, {});
    expect(listed.map((c) => [c.companyId, c.profile])).toEqual([
      [next.companyId, "kestrel-crunch"],
    ]);
    const refused = await code(
      t.mutation(api.fieldJudge.submitScenario, {
        companyId: first.companyId,
        scenario: { kind: "payroll_raise", percent: 5 },
      }),
    );
    expect(refused.code).toBe("ARCHIVED");
  }, 60_000);
});

describe("judge scenarios", () => {
  it("rejects bad input with plain messages and leaves main companies alone", async () => {
    const { t, companyId } = await started();
    type Input = { kind: string; customerId?: string; days?: number } & {
      amountCents?: number;
      week?: number;
      percent?: number;
      label?: string;
    };
    const submit = (scenario: Input) =>
      code(t.mutation(api.fieldJudge.submitScenario, { companyId, scenario }));
    expect((await submit({ kind: "late_payment", customerId: "x", days: 0 })).message).toBe(
      "At least 1 day late",
    );
    expect((await submit({ kind: "unplanned_expense", amountCents: 5000, week: 14 })).message).toBe(
      "Weeks run 1 to 13",
    );
    expect((await submit({ kind: "unplanned_expense", amountCents: 10.5, week: 2 })).message).toBe(
      "Amounts are whole cents",
    );
    expect(
      (await submit({ kind: "unplanned_expense", amountCents: 2_000_000_000, week: 2 })).message,
    ).toBe("At most $10,000,000");
    expect((await submit({ kind: "payroll_raise", percent: 80 })).message).toBe("At most 50%");
    expect((await submit({ kind: "teleport" })).message).toBe("Pick a scenario");
    expect((await submit({ kind: "customer_leaves", customerId: "nobody" })).message).toBe(
      "That customer is not in this company",
    );

    const { companyId: main } = await t.mutation(api.field.setup, { profile: "kestrel" });
    await drain(t);
    const refused = await code(
      t.mutation(api.fieldJudge.submitScenario, {
        companyId: main,
        scenario: { kind: "payroll_raise", percent: 5 },
      }),
    );
    expect(refused.code).toBe("NOT_JUDGE");
  }, 60_000);

  it("a late-paying top customer lowers projected 13-week collections", async () => {
    const { t, companyId } = await started();
    const before = await view(t, companyId);
    const [top] = await t.query(api.fieldJudge.customers, { companyId });
    if (!top) throw new Error("no customers");
    const r = await t.mutation(api.fieldJudge.submitScenario, {
      companyId,
      scenario: { kind: "late_payment", customerId: top.id, days: 90 },
    });
    expect(r.summary).toContain(`${top.name} now pays 90 days late`);
    await drain(t);
    const after = await view(t, companyId);
    expect(collections(after)).toBeLessThan(collections(before));
    expect((await t.query(api.field.status, { companyId }))?.snapshotVersion).toBe(2);
  }, 60_000);

  it("an unplanned expense in week 3 lowers the low point by up to its amount", async () => {
    const { t, companyId } = await started();
    const before = await view(t, companyId);
    await t.mutation(api.fieldJudge.submitScenario, {
      companyId,
      scenario: { kind: "unplanned_expense", amountCents: 50_000_000, week: 3, label: "Lawsuit" },
    });
    await drain(t);
    const after = await view(t, companyId);
    const drop = (before.lowest?.usable ?? 0) - (after.lowest?.usable ?? 0);
    expect(drop).toBeGreaterThan(0);
    expect(drop).toBeLessThanOrEqual(50_000_000);
  }, 60_000);

  it("customer leaving and payroll raise are served and re-forecast", async () => {
    const { t, companyId } = await started();
    const before = await view(t, companyId);
    const [top] = await t.query(api.fieldJudge.customers, { companyId });
    if (!top) throw new Error("no customers");
    await t.mutation(api.fieldJudge.submitScenario, {
      companyId,
      scenario: { kind: "customer_leaves", customerId: top.id },
    });
    await t.mutation(api.fieldJudge.submitScenario, {
      companyId,
      scenario: { kind: "payroll_raise", percent: 20 },
    });
    await drain(t);
    const after = await view(t, companyId);
    expect(after.netChange13).toBeLessThan(before.netChange13);
    const left = await t.query(api.fieldJudge.customers, { companyId });
    expect(left.find((c) => c.id === top.id)?.yearlyCents ?? 0).toBe(0);
  }, 60_000);

  it("bank vs Stripe disagreement creates a conflict flag a person decides, then the record ticks", async () => {
    const { t, companyId } = await started();
    let state = await t.query(api.fieldJudge.state, { companyId });
    expect(state?.checklist.map((s) => s.done)).toEqual([true, false, false, false, false]);
    const r = await t.mutation(api.fieldJudge.submitScenario, {
      companyId,
      scenario: { kind: "bank_stripe_mismatch", amountCents: -25_000 },
    });
    state = await t.query(api.fieldJudge.state, { companyId });
    expect(state?.checklist.map((s) => s.done)).toEqual([true, true, false, false, false]);
    await drain(t);
    const flags = await t.query(api.field.findings, { companyId, escalatedOnly: true });
    const conflict = flags.find((f) => f.kind === "conflict" && f.refs.includes(r.refs[0] ?? ""));
    expect(conflict).toMatchObject({ severity: "high", status: "open" });
    state = await t.query(api.fieldJudge.state, { companyId });
    expect(state?.checklist.map((s) => s.done)).toEqual([true, true, true, false, false]);

    await t.mutation(api.field.decide, {
      companyId,
      findingId: conflict?.findingId ?? "",
      decision: "approved",
      note: "Bank is right",
    });
    state = await t.query(api.fieldJudge.state, { companyId });
    expect(state?.checklist.every((s) => s.done)).toBe(true);
    expect(state?.decisions[0]).toMatchObject({
      findingId: conflict?.findingId,
      decision: "approved",
      note: "Bank is right",
      logged: true,
    });
  }, 60_000);

  it("limits submits per company per minute", async () => {
    const { t, companyId } = await started();
    for (let i = 0; i < JUDGE_LIMITS.submitsPerMinute; i++)
      await t.mutation(api.fieldJudge.submitScenario, {
        companyId,
        scenario: { kind: "unplanned_expense", amountCents: 10_000, week: 1 + i },
      });
    const refused = await code(
      t.mutation(api.fieldJudge.submitScenario, {
        companyId,
        scenario: { kind: "unplanned_expense", amountCents: 10_000, week: 9 },
      }),
    );
    expect(refused.code).toBe("RATE_LIMITED");
  }, 60_000);
});

describe("judge CSV upload", () => {
  it("plants valid rows, reports invalid ones by line", async () => {
    const { t, companyId } = await started();
    const status = await t.query(api.field.status, { companyId });
    const asOf = status?.asOf ?? "";
    const r = await t.mutation(api.fieldJudge.importCsv, {
      companyId,
      kind: "bills",
      rows: [
        { vendor: "Legal retainer", amount: "15000.00", due: asOf, critical: "no" },
        { vendor: "", amount: "12.345", due: "2026-02-30" },
      ],
    });
    expect(r.accepted).toBe(1);
    expect(r.rejected).toEqual([
      {
        line: 3,
        errors: [
          "vendor is empty",
          'amount "12.345" is not a dollar amount like 1250.00',
          `due "2026-02-30" is not a date like ${asOf}`,
        ],
      },
    ]);
    await drain(t);
    const snapshot = await t.run(async (ctx) => {
      const feed = await ctx.db
        .query("feeds")
        .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
        .unique();
      const row = feed?.lastSnapshotId ? await ctx.db.get("snapshots", feed.lastSnapshotId) : null;
      return row?.data as { bills: { id: string; amount: number }[] };
    });
    expect(snapshot.bills.find((b) => b.id === r.refs[0])?.amount).toBe(1_500_000);

    const none = await code(
      t.mutation(api.fieldJudge.importCsv, {
        companyId,
        kind: "invoices",
        rows: [{ customer_id: "nobody", amount: "10", issued: asOf, due: asOf }],
      }),
    );
    expect(none.code).toBe("INVALID_ROWS");
  }, 60_000);
});

describe("simple judge flow", () => {
  const latestSnapshot = (t: T, companyId: Id<"companies">) =>
    t.run(async (ctx) => {
      const feed = await ctx.db
        .query("feeds")
        .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
        .unique();
      const row = feed?.lastSnapshotId ? await ctx.db.get("snapshots", feed.lastSnapshotId) : null;
      return row?.data as { payroll: unknown[]; bills: unknown[]; cardTxns: unknown[] };
    });
  const tools = (t: T, companyId: Id<"companies">) =>
    t.run(async (ctx) => {
      const rows = await ctx.db
        .query("connections")
        .withIndex("by_companyId_and_tool", (q) => q.eq("companyId", companyId))
        .take(20);
      return Object.fromEntries(rows.map((r) => [r.tool, r]));
    });

  it("applies the chosen data sources before the first ingest", async () => {
    vi.useFakeTimers();
    const t = newBackend();
    const { companyId } = await judgeStart(t, {
      profile: "kestrel-late",
      sources: ["nessie", "stripe"],
    });
    // Before the scheduled first ingest runs: only the chosen tools are connected.
    const before = await tools(t, companyId);
    expect(
      Object.entries(before)
        .filter(([, r]) => r.status !== "disconnected")
        .map(([tool]) => tool)
        .sort(),
    ).toEqual(["nessie", "stripe"]);
    await drain(t);
    const after = await tools(t, companyId);
    expect(after.gusto?.lastSyncAt).toBeNull();
    expect(after.stripe?.lastSyncAt).not.toBeNull();
    const snapshot = await latestSnapshot(t, companyId);
    expect(snapshot.payroll).toEqual([]);
    expect(snapshot.cardTxns).toEqual([]);
    const state = await t.query(api.fieldJudge.state, { companyId });
    expect(state).toMatchObject({ profile: "kestrel-late", sources: ["nessie", "stripe"] });
    expect(state?.snapshotVersion).toBe(1);

    // All six by default; reset keeps the same profile and sources.
    const next = await t.mutation(api.fieldJudge.reset, { companyId });
    expect((await t.query(api.fieldJudge.state, { companyId: next.companyId }))?.sources).toEqual([
      "nessie",
      "stripe",
    ]);
    const full = await judgeStart(t, {});
    expect((await t.query(api.fieldJudge.state, { companyId: full.companyId }))?.sources).toEqual([
      "nessie",
      "stripe",
      "ramp",
      "qbo",
      "gusto",
      "hubspot",
    ]);
  }, 60_000);

  it("refuses a selection without the bank, and nothing is created", async () => {
    vi.useFakeTimers();
    const t = newBackend();
    const refused = await code(judgeStart(t, { sources: ["stripe", "qbo"] }));
    expect(refused).toEqual({
      code: "INVALID_INPUT",
      message: "Keep the bank connected: the forecast starts from its cash balance",
    });
    expect(await t.query(api.fieldJudge.companies, {})).toEqual([]);
  });

  it("plants the three presets, refuses one whose tool is off, and leave archives", async () => {
    const { t, companyId } = await started();
    const late = await t.mutation(api.fieldJudge.surprise, {
      companyId,
      preset: "late_big_customer",
    });
    expect(late.summary).toContain("now pays 45 days late");
    const bill = await t.mutation(api.fieldJudge.surprise, {
      companyId,
      preset: "unexpected_bill",
    });
    expect(bill.summary).toContain("$750,000");
    const gap = await t.mutation(api.fieldJudge.surprise, {
      companyId,
      preset: "bank_stripe_mismatch",
    });
    expect(gap.summary).toContain("off by -$18,400");
    const bad = await code(
      t.mutation(api.fieldJudge.surprise, {
        companyId,
        preset: "teleport" as "unexpected_bill",
      }),
    ).catch((e: Error) => ({ code: "VALIDATOR", message: e.message }));
    expect(bad.code).toBe("VALIDATOR");
    await drain(t);
    const state = await t.query(api.fieldJudge.state, { companyId });
    expect(state?.history.map((h) => h.kind)).toEqual([
      "surprise:late_big_customer",
      "surprise:unexpected_bill",
      "surprise:bank_stripe_mismatch",
    ]);
    expect(state?.snapshotVersion).toBeGreaterThan(1);

    const noStripe = await judgeStart(t, { sources: ["nessie", "qbo"] });
    await drain(t);
    expect(
      await code(
        t.mutation(api.fieldJudge.surprise, {
          companyId: noStripe.companyId,
          preset: "bank_stripe_mismatch",
        }),
      ),
    ).toEqual({ code: "NEEDS_SOURCE", message: "Connect Stripe to try this surprise" });

    expect(
      await code(
        t.mutation(api.fieldJudge.surprise, {
          companyId: noStripe.companyId,
          preset: "late_big_customer",
        }),
      ),
    ).toEqual({ code: "NEEDS_SOURCE", message: "Connect Stripe to try this surprise" });
    const bankOnly = await judgeStart(t, { sources: ["nessie"] });
    await drain(t);
    expect(
      await code(
        t.mutation(api.fieldJudge.surprise, {
          companyId: bankOnly.companyId,
          preset: "unexpected_bill",
        }),
      ),
    ).toEqual({ code: "NEEDS_SOURCE", message: "Connect QuickBooks Online to try this surprise" });

    // Leaving also stops a playing simulated clock.
    await t.mutation(api.fieldClock.play, { companyId, speed: 5 });
    await t.mutation(api.fieldJudge.leave, { companyId });
    expect((await t.query(api.fieldJudge.state, { companyId }))?.archived).toBe(true);
    expect(await t.query(api.fieldClock.status, { companyId })).toMatchObject({
      status: "paused",
      pausedReason: "the sandbox company was reset",
    });
    expect((await t.query(api.fieldJudge.companies, {})).map((c) => c.companyId)).toEqual([
      bankOnly.companyId,
      noStripe.companyId,
    ]);
  }, 60_000);
});
