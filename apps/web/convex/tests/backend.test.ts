/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { fixtures } from "@domino/contracts/fixtures";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob(["../**/*.ts", "../_generated/*.js", "!./**"]);
const seed = internal.dev.seedFixtures.seed;

async function setup() {
  const t = convexTest(schema, modules);
  const { companyId } = await t.mutation(seed, {});
  return { t, companyId };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("Kestrel fixture data", () => {
  it("loads the complete contract-backed data and ranks risks and fixes", async () => {
    const { t, companyId } = await setup();
    expect(await t.query(api.companies.get, { companyId })).toMatchObject({
      name: "Kestrel Data",
      profile: "kestrel",
      status: "ready",
    });
    expect(await t.query(api.branches.list, { companyId })).toEqual(fixtures.branches);
    expect(await t.query(api.branches.get, { branchId: "br_acme_late" })).toEqual(
      fixtures.branches[1],
    );
    expect(await t.query(api.history.get, { companyId })).toEqual({
      weeks: fixtures.history,
      pastEvents: fixtures.pastEvents,
    });
    expect(await t.query(api.models.latest, { companyId })).toEqual(fixtures.model);
    expect(await t.query(api.constraints.list, { companyId })).toEqual(fixtures.constraints);
    expect(await t.query(api.resilience.get, { companyId, withFixes: false })).toEqual(
      fixtures.resilience,
    );
    expect(await t.query(api.resilience.get, { companyId, withFixes: true })).toEqual(
      fixtures.resilienceWithFixes,
    );
    const risks = await t.query(api.risks.list, { companyId });
    expect(risks).toHaveLength(5);
    expect(risks[0]?.id).toBe("risk_acme_late");
    const fixes = await t.query(api.fixes.forBranch, { branchId: "br_acme_late" });
    expect(fixes.map((row) => [row.fix.id, row.gain])).toEqual([
      ["fix_early_pay", 23_500_000],
      ["fix_delay_hire", 4_400_000],
    ]);
    expect(await t.query(api.sources.list, { companyId })).toHaveLength(7);
    expect(await t.query(api.grades.list, { companyId })).toEqual([]);
    expect(await t.query(api.approvals.list, { companyId })).toEqual([]);
    expect(await t.query(api.explanations.forBranch, { branchId: "br_acme_late" })).toBeNull();
    expect((await t.query(api.log.list, { companyId, limit: 10 }))[0]?.action).toBe(
      "fixtures.seed",
    );
  });

  it("does not confuse an unseeded company with the fixture company", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const other = await t.mutation(api.companies.create, {
      name: "Kestrel Data",
      profile: "kestrel",
    });
    const { companyId } = await t.mutation(seed, {});
    expect(companyId).not.toBe(other);
    expect(await t.query(api.branches.list, { companyId: other })).toEqual([]);
    expect(await t.query(api.branches.list, { companyId })).toHaveLength(5);
  });

  it("ignores historical risk and resilience rows inserted after the current snapshot", async () => {
    const { t, companyId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("risks", {
        companyId,
        asOf: "2026-10-23",
        data: { ...fixtures.risks[0], id: "old-risk" },
      });
      await ctx.db.insert("resilience", {
        companyId,
        asOf: "2026-10-23",
        withFixes: false,
        data: { ...fixtures.resilience, survivalRate: 0 },
      });
    });
    expect(await t.query(api.risks.list, { companyId })).toHaveLength(5);
    expect(await t.query(api.resilience.get, { companyId, withFixes: false })).toEqual(
      fixtures.resilience,
    );
    expect(
      (await t.query(api.sources.list, { companyId })).every(
        (source) => source.tieOut === "pending" && source.lastPull === null,
      ),
    ).toBe(true);
  });

  it("is idempotent and preserves human decisions", async () => {
    const { t, companyId } = await setup();
    await t.mutation(api.approvals.decide, {
      branchId: "br_fix_early_pay",
      fixId: "fix_early_pay",
      decision: "approved",
      note: "Reviewed the invoice",
    });
    expect(await t.mutation(seed, {})).toEqual({ companyId, created: false });
    expect(await t.query(api.branches.list, { companyId })).toHaveLength(5);
    expect(await t.query(api.approvals.list, { companyId })).toHaveLength(1);
    expect((await t.query(api.branches.get, { branchId: "br_fix_early_pay" }))?.status).toBe(
      "approved",
    );
    expect(await t.run(async (ctx) => (await ctx.db.query("companies").collect()).length)).toBe(1);
  });

  it("fails closed when a stored money payload is corrupt", async () => {
    const { t } = await setup();
    await t.run(async (ctx) => {
      const branch = await ctx.db
        .query("branches")
        .withIndex("by_branchId", (q) => q.eq("branchId", "br_base"))
        .unique();
      if (!branch) throw new Error("missing test fixture");
      await ctx.db.patch(branch._id, {
        data: {
          ...fixtures.branches[0],
          forecast: {
            ...fixtures.branches[0]!.forecast,
            lowPoint: { weekStart: "2026-11-02", usable: 1.5 },
          },
        },
      });
    });
    await expect(t.query(api.branches.get, { branchId: "br_base" })).rejects.toThrow(
      "INVALID_DATA",
    );
  });

  it("returns null and empty arrays for absent singleton and collection data", async () => {
    const { t, companyId } = await setup();
    expect(await t.query(api.branches.get, { branchId: "missing" })).toBeNull();
    expect(await t.query(api.fixes.forBranch, { branchId: "missing" })).toEqual([]);
    await t.run(async (ctx) => {
      await ctx.db.delete(companyId);
    });
    expect(await t.query(api.companies.get, { companyId })).toBeNull();
  });

  it("orders model versions, grades, approvals and log entries correctly", async () => {
    const { t, companyId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("models", {
        companyId,
        version: 10,
        data: { ...fixtures.model, version: 10 },
      });
      for (const week of ["2026-11-09", "2026-11-02"])
        await ctx.db.insert("grades", { companyId, week, errorPct: 3.4, misses: [] });
    });
    expect((await t.query(api.models.latest, { companyId }))?.version).toBe(10);
    expect((await t.query(api.grades.list, { companyId })).map((grade) => grade.week)).toEqual([
      "2026-11-02",
      "2026-11-09",
    ]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
    await t.mutation(api.approvals.decide, {
      branchId: "br_fix_early_pay",
      fixId: "fix_early_pay",
      decision: "rejected",
    });
    vi.setSystemTime(new Date("2026-11-02T12:01:00Z"));
    await t.mutation(api.approvals.decide, {
      branchId: "br_fix_early_pay",
      fixId: "fix_early_pay",
      decision: "approved",
    });
    expect(
      (await t.query(api.approvals.list, { companyId })).map((decision) => decision.decision),
    ).toEqual(["approved", "rejected"]);
    expect((await t.query(api.log.list, { companyId, limit: 1 }))[0]?.action).toBe("fix.approved");
  });
});

describe("approval integrity", () => {
  it("records a verified identity and changes only the selected fix branch", async () => {
    const { t, companyId } = await setup();
    const person = t.withIdentity({
      subject: "micah",
      issuer: "https://example.test",
      tokenIdentifier: "https://example.test|micah",
    });
    const before = await t.query(api.branches.get, { branchId: "br_acme_late" });
    await person.mutation(api.approvals.decide, {
      fixId: "fix_early_pay",
      branchId: "br_fix_early_pay",
      decision: "approved",
      note: "Looks good",
    });
    const rows = await t.query(api.approvals.list, { companyId });
    expect(rows[0]).toMatchObject({
      by: "https://example.test|micah",
      decision: "approved",
      note: "Looks good",
    });
    expect(await t.query(api.branches.get, { branchId: "br_acme_late" })).toEqual(before);
    expect((await t.query(api.branches.get, { branchId: "br_fix_early_pay" }))?.status).toBe(
      "approved",
    );
    expect(
      await t.run(
        async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).length,
      ),
    ).toBe(0);
  });

  it("rejects a candidate owned by another company without writing an approval", async () => {
    const { t, companyId } = await setup();
    await t.run(async (ctx) => {
      const other = await ctx.db.insert("companies", {
        name: "Other",
        profile: "tally",
        currentWeek: 0,
        today: "2026-10-30",
        status: "ready",
      });
      const candidate = await ctx.db
        .query("fixes")
        .withIndex("by_branch", (q) => q.eq("branchId", "br_acme_late"))
        .first();
      if (!candidate) throw new Error("missing test candidate");
      await ctx.db.patch(candidate._id, { companyId: other });
    });
    await expect(
      t.mutation(api.approvals.decide, {
        fixId: "fix_early_pay",
        branchId: "br_fix_early_pay",
        decision: "approved",
      }),
    ).rejects.toThrow("NOT_FOUND");
    expect(await t.query(api.approvals.list, { companyId })).toEqual([]);
  });

  it("labels anonymous demo decisions explicitly", async () => {
    const { t, companyId } = await setup();
    await t.mutation(api.approvals.decide, {
      fixId: "fix_early_pay",
      branchId: "br_fix_early_pay",
      decision: "rejected",
    });
    expect((await t.query(api.approvals.list, { companyId }))[0]?.by).toBe(
      "demo-user (unverified)",
    );
  });

  it.each([
    { branchId: "br_base", fixId: "fix_early_pay", decision: "approved" },
    { branchId: "br_fix_early_pay", fixId: "fix_delay_hire", decision: "approved" },
    { branchId: "br_fix_early_pay", fixId: "fix_early_pay", decision: "execute" },
  ])("rejects mismatched or invalid approval input: %s", async (args) => {
    const { t, companyId } = await setup();
    await expect(t.mutation(api.approvals.decide, args)).rejects.toThrow();
    expect(await t.query(api.approvals.list, { companyId })).toEqual([]);
    expect((await t.query(api.branches.get, { branchId: "br_fix_early_pay" }))?.status).toBe(
      "proposed",
    );
  });
});

describe("scheduled work", () => {
  it("creates a company and schedules the exact action entry points", async () => {
    vi.useFakeTimers();
    const { t, companyId } = await setup();
    const created = await t.mutation(api.companies.create, { name: "  Tally  ", profile: "tally" });
    expect(await t.query(api.companies.get, { companyId: created })).toMatchObject({
      name: "Tally",
      status: "connecting",
      currentWeek: 0,
    });
    await t.mutation(api.events.add, {
      companyId,
      label: "Late payment",
      changes: [{ kind: "delay_invoice", invoiceId: "inv_acme_2027", days: 45 }],
    });
    await t.mutation(api.fixes.simulate, { branchId: "br_acme_late", fixId: "fix_early_pay" });
    await t.mutation(api.week.next, { companyId });
    const calls = await t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(calls.map((call) => call.name)).toEqual([
      "connect:run",
      "engine:addEvent",
      "engine:simulateFix",
      "week:advance",
    ]);
    expect(calls[1]?.args).toEqual([
      {
        companyId,
        label: "Late payment",
        changes: [{ kind: "delay_invoice", invoiceId: "inv_acme_2027", days: 45 }],
      },
    ]);
  });

  it.each([
    { kind: "remove_cash", amount: 1.5, date: "2026-11-02", label: "Invalid cents" },
    { kind: "move_money", amount: 100, date: "2026-11-02" },
    { kind: "delay_invoice", invoiceId: "inv_acme_2027", days: 2.5 },
  ])("rejects invalid changes before scheduling: %s", async (change) => {
    vi.useFakeTimers();
    const { t, companyId } = await setup();
    await expect(
      t.mutation(api.events.add, { companyId, label: "Invalid change", changes: [change] }),
    ).rejects.toThrow("INVALID_DATA");
    expect(
      await t.run(
        async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).length,
      ),
    ).toBe(0);
  });

  it("rejects unknown fixes, invalid profiles and empty event lists", async () => {
    vi.useFakeTimers();
    const { t, companyId } = await setup();
    await expect(
      t.mutation(api.fixes.simulate, { branchId: "br_acme_late", fixId: "missing" }),
    ).rejects.toThrow("NOT_FOUND");
    await expect(
      t.mutation(api.companies.create, { name: "Invalid", profile: "unsupported" }),
    ).rejects.toThrow("INVALID_DATA");
    await expect(
      t.mutation(api.events.add, { companyId, label: "No events", changes: [] }),
    ).rejects.toThrow("INVALID_DATA");
    await expect(t.query(api.log.list, { companyId, limit: -1 })).rejects.toThrow("INVALID_DATA");
  });

  it("keeps unbuilt internal actions visibly unbuilt", async () => {
    const { t, companyId } = await setup();
    await expect(t.action(internal.connect.run, { companyId })).rejects.toThrow("not built");
    await expect(t.action(internal.week.advance, { companyId })).rejects.toThrow("not built");
  });

  it("refuses to compute over the illustrative fixture company", async () => {
    const { t, companyId } = await setup();
    await expect(t.action(internal.engine.recompute, { companyId })).rejects.toThrow("LEGACY_DATA");
    expect(await t.query(api.branches.list, { companyId })).toEqual(fixtures.branches);
  });
});
