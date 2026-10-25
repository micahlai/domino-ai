/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import type { Branch, Change, Constraint, FixCandidate, RiskEvent } from "@domino/contracts";
import { fixtures } from "@domino/contracts/fixtures";
import { engine, rankFixes } from "@domino/engine";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { demoProposals } from "../dev/seedComputed";
import { baseBranchId, computedPrefix, eventBranchId, matchRisk } from "../lib/computed";
import { ENGINE_ATTEMPTS, recomputeFresh, simulateFixFresh } from "../lib/engineRun";
import { recomputeCompany } from "../lib/publish";
import { computedRefs, seedComputedRef } from "../lib/refs";
import schema from "../schema";

const modules = import.meta.glob(["../**/*.ts", "../_generated/*.js", "!./**"]);
const { snapshot, model, constraints } = fixtures;
const asOf = snapshot.asOf;
const ACME_LATE = "risk_late_inv_acme_2027";

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

async function seeded() {
  const t = convexTest(schema, modules);
  const { companyId, created } = await t.mutation(seedComputedRef, {});
  return { t, companyId, created };
}

const testBackend = () => convexTest(schema, modules);
type T = ReturnType<typeof testBackend>;

/** Every row this company owns, keyed by table, to compare whole-database effects. */
async function dump(t: T, companyId: Id<"companies">) {
  return t.run(async (ctx) => {
    const own = <R extends { companyId: Id<"companies"> }>(rows: R[]) =>
      rows.filter((row) => row.companyId === companyId);
    return {
      risks: own(await ctx.db.query("risks").collect()),
      branches: own(await ctx.db.query("branches").collect()),
      fixes: own(await ctx.db.query("fixes").collect()),
      resilience: own(await ctx.db.query("resilience").collect()),
      history: own(await ctx.db.query("history").collect()),
      approvals: own(await ctx.db.query("approvals").collect()),
      log: own(await ctx.db.query("log").collect()),
    };
  });
}

function independentRisks() {
  return engine.scanRisks(snapshot, model, constraints);
}

function demoTargets(companyId: string): FixCandidate[] {
  const proposals = demoProposals(companyId, independentRisks());
  expect(proposals.map((p) => [p.id, p.targetRiskIds])).toEqual([
    [`${computedPrefix(companyId)}demo_fix_early_pay`, [ACME_LATE]],
    [`${computedPrefix(companyId)}demo_fix_delay_hire`, []],
  ]);
  expect(proposals.map((p) => p.changes)).toEqual(fixtures.fixes.map((f) => f.changes));
  return proposals;
}

const compatible = (fix: FixCandidate, riskIds: string[]) =>
  fix.targetRiskIds?.length === 0 || (fix.targetRiskIds ?? []).some((id) => riskIds.includes(id));

describe("computed demo seed", () => {
  it("creates a separate company once and leaves the fixture company untouched", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-30T12:00:00Z"));
    const t = convexTest(schema, modules);
    const fixture = await t.mutation(internal.dev.seedFixtures.seed, {});
    await t.mutation(api.approvals.decide, {
      branchId: "br_fix_early_pay",
      fixId: "fix_early_pay",
      decision: "approved",
    });
    const before = await dump(t, fixture.companyId);
    const first = await t.mutation(seedComputedRef, {});
    expect(first.created).toBe(true);
    expect(first.companyId).not.toBe(fixture.companyId);
    expect(await t.mutation(seedComputedRef, {})).toEqual({
      companyId: first.companyId,
      created: false,
    });
    expect(await dump(t, fixture.companyId)).toEqual(before);
    expect(await t.mutation(internal.dev.seedFixtures.seed, {})).toEqual({
      companyId: fixture.companyId,
      created: false,
    });
    expect(await t.query(api.companies.get, { companyId: first.companyId })).toMatchObject({
      name: "Kestrel Data (computed prototype)",
      profile: "kestrel",
      status: "ready",
      currentWeek: 0,
      today: asOf,
    });
    const sources = await t.query(api.sources.list, { companyId: first.companyId });
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((s) => s.lastPull === null && s.tieOut === "pending")).toBe(true);
    const actions = (await t.query(api.log.list, { companyId: first.companyId, limit: 10 })).map(
      (row) => row.action,
    );
    expect(actions.sort()).toEqual([
      "computed.seed",
      "demo.proposals",
      "engine.proposal-order",
      "engine.recompute",
    ]);
    expect(await t.run(async (ctx) => (await ctx.db.query("companies").collect()).length)).toBe(2);
  });

  it("publishes real engine results that differ from the illustrative fixtures", async () => {
    const { t, companyId } = await seeded();
    const risks = independentRisks();
    expect(await t.query(api.risks.list, { companyId })).toEqual(
      expect.arrayContaining(risks.map((risk) => expect.objectContaining(risk))),
    );
    expect((await t.query(api.risks.list, { companyId })).map((r) => r.id).sort()).toEqual(
      risks.map((r) => r.id).sort(),
    );
    expect(risks.map((r) => r.id)).not.toEqual(fixtures.risks.map((r) => r.id));

    const without = engine.stressTest(snapshot, model, constraints, risks, []);
    expect(await t.query(api.resilience.get, { companyId, withFixes: false })).toEqual(without);
    expect(without).not.toEqual(fixtures.resilience);

    const history = {
      weeks: engine.history(snapshot, 26),
      pastEvents: engine.pastEvents(snapshot, model),
    };
    expect(await t.query(api.history.get, { companyId })).toEqual(history);
    expect(history.weeks).not.toEqual(fixtures.history);

    const base = await t.query(api.branches.get, { branchId: baseBranchId(companyId, asOf) });
    expect(base?.forecast).toEqual(engine.forecast(snapshot, model, []));
    expect(base).toMatchObject({ kind: "base", parentId: null, riskIds: [], changes: [] });
    expect(base?.forecast).not.toEqual(fixtures.branches[0]?.forecast);
  });

  it("persists one event branch per nonempty risk set with complete changes once", async () => {
    const { t, companyId } = await seeded();
    const risks = independentRisks();
    const report = engine.stressTest(snapshot, model, constraints, risks, []);
    const sets = report.universes.map((u) => u.riskIds).filter((ids) => ids.length);
    const branches = await t.query(api.branches.list, { companyId });
    const events = branches.filter((b) => b.kind === "event");
    expect(events).toHaveLength(sets.length);
    expect(sets.some((ids) => ids.length > 1)).toBe(true);
    const base = engine.forecast(snapshot, model, []);
    for (const ids of sets) {
      const id = eventBranchId(companyId, asOf, ids);
      expect(id.startsWith(computedPrefix(companyId))).toBe(true);
      expect(id).toContain(asOf);
      const branch = events.find((b) => b.id === id);
      const changes = ids.flatMap((riskId) => risks.find((r) => r.id === riskId)?.changes ?? []);
      expect(branch).toMatchObject({
        parentId: baseBranchId(companyId, asOf),
        riskIds: ids,
        changes,
        status: "draft",
      });
      expect(branch?.forecast).toEqual(engine.forecast(snapshot, model, changes));
      expect(branch?.dominoes).toEqual(
        engine.dominoes(branch?.forecast ?? base, constraints, snapshot, {
          model,
          changes,
          baseline: base,
        }),
      );
    }
    expect(new Set(branches.map((b) => b.id)).size).toBe(branches.length);
  });

  it("scores explicitly targeted demo proposals with the engine and stores ranked fixes", async () => {
    const { t, companyId } = await seeded();
    const risks = independentRisks();
    const proposals = demoTargets(companyId);
    const report = engine.stressTest(snapshot, model, constraints, risks, []);
    const baseId = baseBranchId(companyId, asOf);
    const allBranches = await t.query(api.branches.list, { companyId });
    const useful = new Set<string>();
    for (const ids of report.universes.map((u) => u.riskIds)) {
      const branchId = ids.length ? eventBranchId(companyId, asOf, ids) : baseId;
      const parent = (await t.query(api.branches.get, { branchId })) as Branch;
      const context = parent.parentId === null ? undefined : { ancestorChanges: [] };
      const scored = proposals
        .filter((fix) => compatible(fix, ids))
        .map((fix) => ({
          fix,
          branch: engine.scoreFix(parent, fix, snapshot, model, constraints, context),
        }));
      const ranked = rankFixes(parent, scored, snapshot, model, constraints, context);
      const stored = await t.query(api.fixes.forBranch, { branchId });
      expect(stored.map((row) => [row.fix, row.gain])).toEqual(ranked.map((r) => [r.fix, r.gain]));
      for (const r of ranked) {
        useful.add(r.fix.id);
        expect(allBranches.find((b) => b.id === r.branch.id)).toEqual(r.branch);
        expect(r.branch.status).toBe("proposed");
      }
    }
    const early = await t.query(api.fixes.forBranch, {
      branchId: eventBranchId(companyId, asOf, [ACME_LATE]),
    });
    expect(early.map((row) => row.fix.targetRiskIds)).toContainEqual([ACME_LATE]);
    expect(early.every((row) => row.fix.label.startsWith("Demo proposal"))).toBe(true);
    expect(early.map((row) => row.gain)).not.toContain(23_500_000);
    // Source proposals apply in the caller's order, never re-sorted by ID.
    const selected = proposals.filter((p) => useful.has(p.id));
    const withFixes = engine.stressTest(snapshot, model, constraints, risks, selected);
    expect(await t.query(api.resilience.get, { companyId, withFixes: true })).toEqual(withFixes);
    expect(withFixes.appliedFixIds.length).toBeGreaterThan(0);
  });

  it("matches demo proposals to the scanned invoice risk by identity, not label", () => {
    const risks = independentRisks();
    const acme = risks.find((r) => r.id === ACME_LATE);
    expect(acme?.changes).toEqual([
      { kind: "delay_invoice", invoiceId: "inv_acme_2027", days: 24 },
    ]);
  });
});

describe("recompute", () => {
  it("is idempotent: no duplicates, no new log and identical identities", async () => {
    const { t, companyId } = await seeded();
    const before = await dump(t, companyId);
    await t.action(internal.engine.recompute, { companyId });
    await t.mutation(computedRefs.recompute, { companyId });
    expect(await dump(t, companyId)).toEqual(before);
  });

  it("keeps approvals and decided branches across reruns", async () => {
    const { t, companyId } = await seeded();
    const parentId = eventBranchId(companyId, asOf, [ACME_LATE]);
    const [first] = await t.query(api.fixes.forBranch, { branchId: parentId });
    if (!first) throw new Error("expected a useful fix");
    const fixBranchId = `${parentId}__${first.fix.id}`;
    await t.mutation(api.approvals.decide, {
      branchId: fixBranchId,
      fixId: first.fix.id,
      decision: "approved",
    });
    const before = await dump(t, companyId);
    await t.action(internal.engine.recompute, { companyId });
    expect(await dump(t, companyId)).toEqual(before);
    expect((await t.query(api.branches.get, { branchId: fixBranchId }))?.status).toBe("approved");
    expect(await t.query(api.approvals.list, { companyId })).toHaveLength(1);
  });

  it("rejects changed inputs that would overwrite a decided graph and writes nothing", async () => {
    const { t, companyId } = await seeded();
    const parentId = eventBranchId(companyId, asOf, [ACME_LATE]);
    const [first] = await t.query(api.fixes.forBranch, { branchId: parentId });
    if (!first) throw new Error("expected a useful fix");
    await t.mutation(api.approvals.decide, {
      branchId: `${parentId}__${first.fix.id}`,
      fixId: first.fix.id,
      decision: "rejected",
    });
    await changeCash(t, companyId, -50_000_00);
    const before = await dump(t, companyId);
    await expect(t.mutation(computedRefs.recompute, { companyId })).rejects.toThrow(
      "DECIDED_CHANGED",
    );
    expect(await dump(t, companyId)).toEqual(before);
  });

  it("updates undecided results when inputs change, without duplicates", async () => {
    const { t, companyId } = await seeded();
    const before = await dump(t, companyId);
    await changeCash(t, companyId, -50_000_00);
    await t.mutation(computedRefs.recompute, { companyId });
    const after = await dump(t, companyId);
    const changed = { ...snapshot, cashOnHand: snapshot.cashOnHand - 50_000_00 };
    expect(
      await t.query(api.branches.get, { branchId: baseBranchId(companyId, asOf) }),
    ).toMatchObject({
      forecast: engine.forecast(changed, model, []),
    });
    expect(after.branches.map((b) => b.branchId).sort()).toEqual(
      before.branches.map((b) => b.branchId).sort(),
    );
    expect(after.resilience).toHaveLength(2);
    expect(after.history).toHaveLength(1);
    expect(after.log.length).toBe(before.log.length + 1);
  });

  it("refuses the illustrative fixture company and companies without inputs", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.mutation(internal.dev.seedFixtures.seed, {});
    const before = await dump(t, fixture.companyId);
    await expect(
      t.mutation(computedRefs.recompute, { companyId: fixture.companyId }),
    ).rejects.toThrow("LEGACY_DATA");
    expect(await dump(t, fixture.companyId)).toEqual(before);
    const empty = await t.run((ctx) =>
      ctx.db.insert("companies", {
        name: "Empty",
        profile: "tally",
        currentWeek: 0,
        today: asOf,
        status: "ready",
      }),
    );
    await expect(t.mutation(computedRefs.recompute, { companyId: empty })).rejects.toThrow(
      "MISSING_INPUT",
    );
  });

  it("refuses unresolved legacy links instead of guessing", async () => {
    const { t, companyId } = await seeded();
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("snapshots")
        .withIndex("by_company_asOf", (q) => q.eq("companyId", companyId))
        .unique();
      if (!row) throw new Error("missing snapshot");
      const deals = snapshot.deals.map(({ invoiceId: _link, ...deal }) => deal);
      await ctx.db.patch(row._id, { data: { ...snapshot, deals } });
    });
    await expect(t.mutation(computedRefs.recompute, { companyId })).rejects.toThrow("LEGACY_DATA");
  });

  it("preserves engine rule-clearance ranking in fixes.forBranch", async () => {
    const t = convexTest(schema, modules);
    const deadline: Constraint = {
      id: "con_agency_deadline",
      label: "Agency payment deadline",
      kind: "pay_by_date",
      limit: 0,
      billId: "bill_agency_nov",
      evidence: { source: "document", ref: "agency.pdf#1", note: "Pay on the due date" },
    };
    const companyId = await insertCompany(t, [deadline]);
    const prefix = computedPrefix(companyId);
    const proposals: FixCandidate[] = [
      {
        id: `${prefix}delay_agency`,
        label: "Pay the agency a month late",
        changes: [{ kind: "delay_bill", billId: "bill_agency_nov", days: 30 }],
        costNote: "Breaks the agency deadline",
        risk: "low",
        evidence: [],
        targetRiskIds: [],
      },
      { ...(fixtures.fixes[1] as FixCandidate), id: `${prefix}delay_hire`, targetRiskIds: [] },
    ];
    await t.run(async (ctx) => {
      await recomputeCompany(ctx, companyId, { proposals, action: "engine.recompute" });
    });
    const parent = (await t.query(api.branches.get, {
      branchId: baseBranchId(companyId, asOf),
    })) as Branch;
    const scored = proposals.map((fix) => ({
      fix,
      branch: engine.scoreFix(parent, fix, snapshot, model, [deadline]),
    }));
    const ranked = rankFixes(parent, scored, snapshot, model, [deadline]);
    const byGain = [...ranked].sort((a, b) => b.gain - a.gain).map((r) => r.fix.id);
    expect(ranked.map((r) => r.fix.id)).not.toEqual(byGain);
    const stored = await t.query(api.fixes.forBranch, { branchId: parent.id });
    expect(stored.map((row) => row.fix.id)).toEqual(ranked.map((r) => r.fix.id));
    // A rerun from the stored proposal pool keeps the same order.
    await t.mutation(computedRefs.recompute, { companyId });
    const again = await t.query(api.fixes.forBranch, { branchId: parent.id });
    expect(again.map((row) => row.fix.id)).toEqual(ranked.map((r) => r.fix.id));
  });
});

describe("proposal order", () => {
  const ORDER = "engine.proposal-order";
  const earlyPay = (id: string, payOn: string): FixCandidate => ({
    id,
    label: id,
    changes: [{ kind: "discount_early_pay", invoiceId: "inv_acme_2027", percent: 2, payOn }],
    costNote: "order probe",
    risk: "low",
    evidence: [],
    targetRiskIds: [ACME_LATE],
  });

  async function orderCompany() {
    const t = testBackend();
    const companyId = await insertCompany(t, constraints);
    const prefix = computedPrefix(companyId);
    // Caller order is z then a: the reverse of ID order, so an ID sort would show up.
    const z = earlyPay(`${prefix}z_early`, "2026-11-20");
    const a = earlyPay(`${prefix}a_early`, "2026-11-27");
    await t.run(async (ctx) => {
      await recomputeCompany(ctx, companyId, { proposals: [z, a], action: "engine.recompute" });
    });
    return { t, companyId, z, a };
  }

  const manifests = (t: T, companyId: Id<"companies">) =>
    t.run(async (ctx) =>
      (await ctx.db.query("log").collect())
        .filter((row) => row.companyId === companyId && row.action === ORDER)
        .map((row) => row.refs),
    );

  it("applies explicit proposals in caller order and keeps it across reruns", async () => {
    const { t, companyId, z, a } = await orderCompany();
    const risks = independentRisks();
    const callerOrder = engine.stressTest(snapshot, model, constraints, risks, [z, a]);
    const idOrder = engine.stressTest(snapshot, model, constraints, risks, [a, z]);
    expect(callerOrder.appliedFixIds).toEqual([z.id, a.id]);
    expect(callerOrder).not.toEqual(idOrder);
    expect(await t.query(api.resilience.get, { companyId, withFixes: true })).toEqual(callerOrder);
    expect(await manifests(t, companyId)).toEqual([[z.id, a.id]]);

    const before = await dump(t, companyId);
    await t.mutation(computedRefs.recompute, { companyId });
    await t.run(async (ctx) => {
      await recomputeCompany(ctx, companyId, { proposals: [a, z], action: "engine.recompute" });
    });
    expect(await dump(t, companyId)).toEqual(before);
  });

  it("appends genuinely new explicit proposals in caller order", async () => {
    const { t, companyId, z, a } = await orderCompany();
    const prefix = computedPrefix(companyId);
    const hire = {
      ...(fixtures.fixes[1] as FixCandidate),
      id: `${prefix}0_hire`,
      targetRiskIds: [],
    };
    const y = earlyPay(`${prefix}y_early`, "2026-11-24");
    await t.run(async (ctx) => {
      await recomputeCompany(ctx, companyId, {
        proposals: [y, a, hire],
        action: "engine.recompute",
      });
    });
    // Saved order first, then new IDs in caller order (y before the ID-first 0_hire).
    expect((await manifests(t, companyId)).at(-1)).toEqual([z.id, a.id, y.id, hire.id]);
    expect(await t.query(api.resilience.get, { companyId, withFixes: true })).toEqual(
      engine.stressTest(snapshot, model, constraints, independentRisks(), [z, a, y, hire]),
    );
  });

  it("rejects conflicting IDs, missing payloads and unordered saved proposals", async () => {
    const { t, companyId, z } = await orderCompany();
    const before = await dump(t, companyId);
    const conflict = { ...z, label: "Same ID, different payload" };
    await expect(
      t.run((ctx) =>
        recomputeCompany(ctx, companyId, { proposals: [conflict], action: "engine.recompute" }),
      ),
    ).rejects.toThrow("INVALID_PROPOSAL");
    expect(await dump(t, companyId)).toEqual(before);

    const dropRows = (match: (row: { fix: FixCandidate }) => boolean) =>
      t.run(async (ctx) => {
        for (const row of await ctx.db.query("fixes").collect())
          if (row.companyId === companyId && match({ fix: row.data })) await ctx.db.delete(row._id);
      });
    await dropRows((row) => row.fix.id === z.id);
    const missingPayload = await dump(t, companyId);
    await expect(t.mutation(computedRefs.recompute, { companyId })).rejects.toThrow("INVALID_DATA");
    expect(await dump(t, companyId)).toEqual(missingPayload);

    const { t: t2, companyId: other } = await orderCompany();
    await t2.run(async (ctx) => {
      for (const row of await ctx.db.query("log").collect())
        if (row.companyId === other && row.action === ORDER) await ctx.db.delete(row._id);
    });
    const unordered = await dump(t2, other);
    await expect(t2.mutation(computedRefs.recompute, { companyId: other })).rejects.toThrow(
      "LEGACY_DATA",
    );
    expect(await dump(t2, other)).toEqual(unordered);
  });
});

describe("addEvent", () => {
  it("resolves the exact current risk and ensures its event branch", async () => {
    const { t, companyId } = await seeded();
    const risk = independentRisks().find((r) => r.id === ACME_LATE) as RiskEvent;
    const before = await dump(t, companyId);
    const result = await t.mutation(computedRefs.addEvent, {
      companyId,
      label: risk.label,
      changes: risk.changes,
    });
    expect(result).toEqual({
      riskId: ACME_LATE,
      branchId: eventBranchId(companyId, asOf, [ACME_LATE]),
    });
    expect(await dump(t, companyId)).toEqual(before);
    await t.action(internal.engine.addEvent, {
      companyId,
      label: risk.label,
      changes: risk.changes,
    });
    expect(await dump(t, companyId)).toEqual(before);
  });

  it("rejects input that matches no current risk without writing", async () => {
    const { t, companyId } = await seeded();
    const before = await dump(t, companyId);
    await expect(
      t.mutation(computedRefs.addEvent, {
        companyId,
        label: "Made up",
        changes: [{ kind: "delay_invoice", invoiceId: "inv_acme_2027", days: 99 }],
      }),
    ).rejects.toThrow("EVENT_NOT_FOUND");
    expect(await dump(t, companyId)).toEqual(before);
  });

  it("uses the label only to break exact-change ties and rejects ambiguity", () => {
    const changes: Change[] = [{ kind: "lose_invoice", invoiceId: "inv_x" }];
    const risk = (id: string, label: string): RiskEvent => ({
      id,
      label,
      probability: 0.2,
      impactLowPoint: 1,
      changes,
      evidence: [],
    });
    expect(matchRisk([risk("a", "A")], "anything", changes).id).toBe("a");
    expect(matchRisk([risk("a", "A"), risk("b", "B")], "B", changes).id).toBe("b");
    expect(() => matchRisk([risk("a", "A"), risk("b", "A")], "A", changes)).toThrow(
      "EVENT_AMBIGUOUS",
    );
    expect(() => matchRisk([risk("a", "A")], "A", [])).toThrow("EVENT_NOT_FOUND");
  });
});

describe("simulateFix", () => {
  async function candidate(t: T, companyId: Id<"companies">) {
    const parentId = eventBranchId(companyId, asOf, [ACME_LATE]);
    const [first] = await t.query(api.fixes.forBranch, { branchId: parentId });
    if (!first) throw new Error("expected a useful fix");
    return { parentId, fix: first.fix, fixBranchId: `${parentId}__${first.fix.id}` };
  }

  it("rebuilds a fix branch from complete ancestry and is idempotent", async () => {
    const { t, companyId } = await seeded();
    const { parentId, fix, fixBranchId } = await candidate(t, companyId);
    const stored = await t.query(api.branches.get, { branchId: fixBranchId });
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("branches")
        .withIndex("by_branchId", (q) => q.eq("branchId", fixBranchId))
        .unique();
      if (row) await ctx.db.delete(row._id);
    });
    await t.action(internal.engine.simulateFix, { branchId: parentId, fixId: fix.id });
    const parent = (await t.query(api.branches.get, { branchId: parentId })) as Branch;
    const expected = engine.scoreFix(parent, fix, snapshot, model, constraints, {
      ancestorChanges: [],
    });
    expect(await t.query(api.branches.get, { branchId: fixBranchId })).toEqual(expected);
    expect(expected).toEqual(stored);
    const before = await dump(t, companyId);
    await t.mutation(computedRefs.simulateFix, { branchId: parentId, fixId: fix.id });
    expect(await dump(t, companyId)).toEqual(before);
  });

  it("preserves a decided fix branch and rejects a changed one", async () => {
    const { t, companyId } = await seeded();
    const { parentId, fix, fixBranchId } = await candidate(t, companyId);
    await t.mutation(api.approvals.decide, {
      branchId: fixBranchId,
      fixId: fix.id,
      decision: "approved",
    });
    const before = await dump(t, companyId);
    await t.mutation(computedRefs.simulateFix, { branchId: parentId, fixId: fix.id });
    expect(await dump(t, companyId)).toEqual(before);
    expect((await t.query(api.branches.get, { branchId: fixBranchId }))?.status).toBe("approved");
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("branches")
        .withIndex("by_branchId", (q) => q.eq("branchId", fixBranchId))
        .unique();
      if (!row) throw new Error("missing fix branch");
      await ctx.db.patch(row._id, { data: { ...row.data, label: "Edited after approval" } });
    });
    await expect(
      t.mutation(computedRefs.simulateFix, { branchId: parentId, fixId: fix.id }),
    ).rejects.toThrow("DECIDED_CHANGED");
  });

  it("rejects cross-company candidates, missing or cyclic ancestry and fixture futures", async () => {
    const { t, companyId } = await seeded();
    const { parentId, fix } = await candidate(t, companyId);
    const other = await t.run((ctx) =>
      ctx.db.insert("companies", {
        name: "Other",
        profile: "tally",
        currentWeek: 0,
        today: asOf,
        status: "ready",
      }),
    );
    const patchBranch = (branchId: string, patch: (row: { data: Branch }) => object) =>
      t.run(async (ctx) => {
        const row = await ctx.db
          .query("branches")
          .withIndex("by_branchId", (q) => q.eq("branchId", branchId))
          .unique();
        if (!row) throw new Error(`missing ${branchId}`);
        await ctx.db.patch(row._id, patch(row as { data: Branch }));
        return row;
      });
    const simulate = () =>
      t.mutation(computedRefs.simulateFix, { branchId: parentId, fixId: fix.id });

    const baseId = baseBranchId(companyId, asOf);
    const base = await patchBranch(baseId, () => ({ companyId: other }));
    await expect(simulate()).rejects.toThrow("CROSS_COMPANY");
    await patchBranch(baseId, () => ({ companyId: base.companyId }));

    await patchBranch(baseId, (row) => ({ parentId, data: { ...row.data, parentId } }));
    await expect(simulate()).rejects.toThrow("INVALID_ANCESTRY");
    await patchBranch(baseId, (row) => ({ parentId: null, data: { ...row.data, parentId: null } }));

    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("branches")
        .withIndex("by_branchId", (q) => q.eq("branchId", baseId))
        .unique();
      if (row) await ctx.db.delete(row._id);
    });
    await expect(simulate()).rejects.toThrow("INVALID_ANCESTRY");

    const fixture = await t.mutation(internal.dev.seedFixtures.seed, {});
    await expect(
      t.mutation(computedRefs.simulateFix, { branchId: "br_acme_late", fixId: "fix_early_pay" }),
    ).rejects.toThrow("LEGACY_DATA");
    expect(await t.query(api.branches.list, { companyId: fixture.companyId })).toHaveLength(5);
  });

  it("rejects a parent whose rules changed without a cash change and writes nothing", async () => {
    const { t, companyId } = await seeded();
    const { parentId, fix, fixBranchId } = await candidate(t, companyId);
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("branches")
        .withIndex("by_branchId", (q) => q.eq("branchId", fixBranchId))
        .unique();
      if (row) await ctx.db.delete(row._id);
      const rules = await ctx.db
        .query("constraints")
        .withIndex("by_company", (q) => q.eq("companyId", companyId))
        .collect();
      const minCash = rules.find((rule) => rule.data.kind === "min_cash");
      if (!minCash) throw new Error("missing min_cash rule");
      await ctx.db.patch(minCash._id, {
        data: { ...minCash.data, limit: 999_000_000, label: "NEW LIMIT" },
      });
    });
    const parent = (await t.query(api.branches.get, { branchId: parentId })) as Branch;
    // The forecast alone still matches, so only the full context shows it is stale.
    expect(engine.forecast(snapshot, model, parent.changes)).toEqual(parent.forecast);
    const before = await dump(t, companyId);
    await expect(
      t.mutation(computedRefs.simulateFix, { branchId: parentId, fixId: fix.id }),
    ).rejects.toThrow("STALE_FUTURE");
    expect(await dump(t, companyId)).toEqual(before);
  });

  it("rejects stale risk definitions or probabilities in the parent's context", async () => {
    const { t, companyId } = await seeded();
    const { parentId, fix } = await candidate(t, companyId);
    const simulate = () =>
      t.mutation(computedRefs.simulateFix, { branchId: parentId, fixId: fix.id });
    const patchRisk = (probability: number) =>
      t.run(async (ctx) => {
        const rows = await ctx.db
          .query("risks")
          .withIndex("by_company", (q) => q.eq("companyId", companyId))
          .collect();
        const row = rows.find((r) => r.data?.id === ACME_LATE);
        if (!row?.data) throw new Error("missing risk");
        const old = row.data.probability;
        await ctx.db.patch(row._id, { data: { ...row.data, probability } });
        return old;
      });
    const old = await patchRisk(0.99);
    let before = await dump(t, companyId);
    await expect(simulate()).rejects.toThrow("STALE_FUTURE");
    expect(await dump(t, companyId)).toEqual(before);
    await patchRisk(old);

    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("branches")
        .withIndex("by_branchId", (q) => q.eq("branchId", parentId))
        .unique();
      if (!row) throw new Error("missing parent");
      await ctx.db.patch(row._id, { data: { ...row.data, probability: 0.99 } });
    });
    before = await dump(t, companyId);
    await expect(simulate()).rejects.toThrow("STALE_FUTURE");
    expect(await dump(t, companyId)).toEqual(before);
  });

  it("rejects a saved candidate whose gain no longer matches the engine", async () => {
    const { t, companyId } = await seeded();
    const { parentId, fix } = await candidate(t, companyId);
    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("fixes")
        .withIndex("by_branch", (q) => q.eq("branchId", parentId))
        .collect();
      const row = rows.find((r) => r.data.id === fix.id);
      if (!row) throw new Error("missing candidate");
      await ctx.db.patch(row._id, { gain: row.gain + 1 });
    });
    const before = await dump(t, companyId);
    await expect(
      t.mutation(computedRefs.simulateFix, { branchId: parentId, fixId: fix.id }),
    ).rejects.toThrow("STALE_FUTURE");
    expect(await dump(t, companyId)).toEqual(before);
  });

  it("still simulates a fix beneath a fix with the whole ancestry once", async () => {
    const { t, companyId } = await seeded();
    const { parentId, fix, fixBranchId } = await candidate(t, companyId);
    const hire = (await t.query(api.fixes.forBranch, { branchId: parentId })).find(
      (row) => row.fix.id !== fix.id,
    );
    if (!hire) throw new Error("expected a second fix");
    const event = (await t.query(api.branches.get, { branchId: parentId })) as Branch;
    const parent = (await t.query(api.branches.get, { branchId: fixBranchId })) as Branch;
    const context = { ancestorChanges: event.changes };
    const expected = engine.scoreFix(parent, hire.fix, snapshot, model, constraints, context);
    const [scored] = rankFixes(
      parent,
      [{ fix: hire.fix, branch: expected }],
      snapshot,
      model,
      constraints,
      context,
    );
    if (!scored) throw new Error("expected the second fix to help");
    // A saved nested gain must match the engine like every other level.
    await t.run((ctx) =>
      ctx.db.insert("fixes", { companyId, branchId: fixBranchId, data: hire.fix, gain: 0 }),
    );
    await expect(
      t.mutation(computedRefs.simulateFix, { branchId: fixBranchId, fixId: hire.fix.id }),
    ).rejects.toThrow("STALE_FUTURE");
    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("fixes")
        .withIndex("by_branch", (q) => q.eq("branchId", fixBranchId))
        .collect();
      for (const row of rows) await ctx.db.patch(row._id, { gain: scored.gain });
    });
    const result = await t.mutation(computedRefs.simulateFix, {
      branchId: fixBranchId,
      fixId: hire.fix.id,
    });
    expect(await t.query(api.branches.get, { branchId: result.branchId })).toEqual(expected);
  });

  /** Event -> early payment -> hiring -> extra cash, each nested row saved with its engine gain. */
  async function deepChain(t: T, companyId: Id<"companies">) {
    const extra: FixCandidate = {
      id: `${computedPrefix(companyId)}extra_unique_cash`,
      label: "Extra capital",
      changes: [
        { kind: "add_cash", date: "2026-11-15", amount: 1_000_000, label: "Extra capital" },
      ],
      costNote: "depth probe",
      risk: "low",
      evidence: [],
      targetRiskIds: [],
    };
    await t.run(async (ctx) => {
      await recomputeCompany(ctx, companyId, { proposals: [extra], action: "engine.recompute" });
    });
    const eventId = eventBranchId(companyId, asOf, [ACME_LATE]);
    const ranked = await t.query(api.fixes.forBranch, { branchId: eventId });
    const pick = (suffix: string) => {
      const row = ranked.find((r) => r.fix.id.endsWith(suffix));
      if (!row) throw new Error(`missing ${suffix}`);
      return row.fix;
    };
    const [early, hire] = [pick("demo_fix_early_pay"), pick("demo_fix_delay_hire")];
    const event = (await t.query(api.branches.get, { branchId: eventId })) as Branch;
    const firstId = `${eventId}__${early.id}`;
    const saveUnder = async (parentId: string, fix: FixCandidate, ancestorChanges: Change[]) => {
      const parent = (await t.query(api.branches.get, { branchId: parentId })) as Branch;
      const context = { ancestorChanges };
      const branch = engine.scoreFix(parent, fix, snapshot, model, constraints, context);
      const [scored] = rankFixes(parent, [{ fix, branch }], snapshot, model, constraints, context);
      if (!scored) throw new Error(`${fix.id} does not help under ${parentId}`);
      await t.run((ctx) =>
        ctx.db.insert("fixes", { companyId, branchId: parentId, data: fix, gain: scored.gain }),
      );
      return { parent, branch };
    };
    await saveUnder(firstId, hire, event.changes);
    const second = await t.mutation(computedRefs.simulateFix, {
      branchId: firstId,
      fixId: hire.id,
    });
    const { parent, branch } = await saveUnder(second.branchId, extra, [
      ...event.changes,
      ...early.changes,
    ]);
    const simulate = () =>
      t.mutation(computedRefs.simulateFix, { branchId: second.branchId, fixId: extra.id });
    return { firstId, secondId: second.branchId, hire, extra, parent, expected: branch, simulate };
  }

  it("simulates a third unique fix beneath two nested fixes", async () => {
    const { t, companyId } = await seeded();
    const { secondId, expected, simulate } = await deepChain(t, companyId);
    const third = await simulate();
    expect(third.branchId).toBe(`${secondId}__${expected.id.split("__").at(-1)}`);
    expect(await t.query(api.branches.get, { branchId: third.branchId })).toEqual(expected);
    const before = await dump(t, companyId);
    await simulate();
    expect(await dump(t, companyId)).toEqual(before);
  });

  it("rejects a stale nested ancestor, its saved gain or a changed rule and writes nothing", async () => {
    type Chain = Awaited<ReturnType<typeof deepChain>>;
    type Tamper = (t: T, companyId: Id<"companies">, chain: Chain) => Promise<void>;
    const tamperings: [string, Tamper][] = [
      [
        "nested ancestor",
        async (t, _companyId, { secondId }) => {
          await t.run(async (ctx) => {
            const row = await ctx.db
              .query("branches")
              .withIndex("by_branchId", (q) => q.eq("branchId", secondId))
              .unique();
            if (!row) throw new Error("missing nested ancestor");
            await ctx.db.patch(row._id, { data: { ...row.data, label: "Edited nested fix" } });
          });
        },
      ],
      [
        "ancestor gain",
        async (t, _companyId, { firstId, hire }) => {
          await t.run(async (ctx) => {
            const rows = await ctx.db
              .query("fixes")
              .withIndex("by_branch", (q) => q.eq("branchId", firstId))
              .collect();
            const row = rows.find((r) => r.data.id === hire.id);
            if (!row) throw new Error("missing nested candidate");
            await ctx.db.patch(row._id, { gain: row.gain + 1 });
          });
        },
      ],
      [
        "ancestor candidate",
        async (t, _companyId, { firstId, hire }) => {
          await t.run(async (ctx) => {
            const rows = await ctx.db
              .query("fixes")
              .withIndex("by_branch", (q) => q.eq("branchId", firstId))
              .collect();
            for (const row of rows.filter((r) => r.data.id === hire.id))
              await ctx.db.delete(row._id);
          });
        },
      ],
      [
        "rule",
        async (t, companyId) => {
          await t.run(async (ctx) => {
            const rules = await ctx.db
              .query("constraints")
              .withIndex("by_company", (q) => q.eq("companyId", companyId))
              .collect();
            const minCash = rules.find((rule) => rule.data.kind === "min_cash");
            if (!minCash) throw new Error("missing min_cash rule");
            await ctx.db.patch(minCash._id, { data: { ...minCash.data, label: "NEW LIMIT" } });
          });
        },
      ],
    ];
    for (const [name, tamper] of tamperings) {
      const { t, companyId } = await seeded();
      const chain = await deepChain(t, companyId);
      await tamper(t, companyId, chain);
      const before = await dump(t, companyId);
      await expect(chain.simulate(), name).rejects.toThrow("STALE_FUTURE");
      expect(await dump(t, companyId), name).toEqual(before);
    }
  });

  it("rejects a candidate owned by another company", async () => {
    const { t, companyId } = await seeded();
    const { parentId, fix } = await candidate(t, companyId);
    await t.run(async (ctx) => {
      const other = await ctx.db.insert("companies", {
        name: "Other",
        profile: "tally",
        currentWeek: 0,
        today: asOf,
        status: "ready",
      });
      const rows = await ctx.db
        .query("fixes")
        .withIndex("by_branch", (q) => q.eq("branchId", parentId))
        .collect();
      for (const row of rows) await ctx.db.patch(row._id, { companyId: other });
    });
    await expect(
      t.mutation(computedRefs.simulateFix, { branchId: parentId, fixId: fix.id }),
    ).rejects.toThrow("NOT_FOUND");
  });
});

describe("split engine run (load query, engine in the action, guarded write)", () => {
  type Runner = Parameters<typeof recomputeFresh>[0];
  /** A runner whose loads call `between` after reading, i.e. before the engine and write run. */
  function racingRunner(t: T, between: (load: number) => Promise<void>) {
    type Call = (ref: unknown, args: unknown) => Promise<unknown>;
    const query = t.query as unknown as Call;
    const mutation = t.mutation as unknown as Call;
    let loads = 0;
    const runner = {
      runQuery: async (ref: unknown, args: unknown) => {
        const result = await query(ref, args);
        loads += 1;
        await between(loads);
        return result;
      },
      runMutation: mutation,
    } as unknown as Runner;
    return { runner, loads: () => loads };
  }

  it("reruns the whole cycle when the inputs change between load and write", async () => {
    const { t, companyId } = await seeded();
    const before = await dump(t, companyId);
    const { runner, loads } = racingRunner(t, async (n) => {
      if (n === 1) await changeCash(t, companyId, -50_000_00);
    });
    const result = await recomputeFresh(runner, companyId, "engine.recompute");
    expect(loads()).toBe(2);
    expect(result.changed).toBe(true);
    const changed = { ...snapshot, cashOnHand: snapshot.cashOnHand - 50_000_00 };
    expect(
      await t.query(api.branches.get, { branchId: baseBranchId(companyId, asOf) }),
    ).toMatchObject({ forecast: engine.forecast(changed, model, []) });
    const after = await dump(t, companyId);
    expect(after.log.length).toBe(before.log.length + 1);
    // Same result as one transaction on the new inputs: nothing left to change.
    await t.mutation(computedRefs.recompute, { companyId });
    expect(await dump(t, companyId)).toEqual(after);
  });

  it("gives up after a bounded number of tries and writes nothing", async () => {
    const { t, companyId } = await seeded();
    const before = await dump(t, companyId);
    const { runner, loads } = racingRunner(t, () => changeCash(t, companyId, -1_00));
    await expect(recomputeFresh(runner, companyId, "engine.recompute")).rejects.toThrow(
      "INPUTS_CHANGED",
    );
    expect(loads()).toBe(ENGINE_ATTEMPTS);
    expect(await dump(t, companyId)).toEqual(before);
  });

  it("matches the single-transaction run on unchanged inputs", async () => {
    const one = await seeded();
    const two = await seeded();
    await changeCash(one.t, one.companyId, -50_000_00);
    await changeCash(two.t, two.companyId, -50_000_00);
    await one.t.mutation(computedRefs.recompute, { companyId: one.companyId });
    await two.t.action(internal.engine.recompute, { companyId: two.companyId });
    const strip = (d: Awaited<ReturnType<typeof dump>>) =>
      Object.fromEntries(
        Object.entries(d).map(([table, rows]) => [
          table,
          rows.map(({ _id, _creationTime, at, ...rest }: Record<string, unknown>) => rest),
        ]),
      );
    expect(strip(await dump(two.t, two.companyId))).toEqual(
      strip(await dump(one.t, one.companyId)),
    );
  });

  it("simulateFix reruns when the parent's inputs change before the write", async () => {
    const { t, companyId } = await seeded();
    const parentId = eventBranchId(companyId, asOf, [ACME_LATE]);
    const [first] = await t.query(api.fixes.forBranch, { branchId: parentId });
    if (!first) throw new Error("expected a useful fix");
    const fixBranchId = `${parentId}__${first.fix.id}`;
    const stored = await t.query(api.branches.get, { branchId: fixBranchId });
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("branches")
        .withIndex("by_branchId", (q) => q.eq("branchId", fixBranchId))
        .unique();
      if (row) await ctx.db.delete(row._id);
    });
    // The first load is overtaken by a cash change; the rerun sees a stale future and refuses.
    const raced = racingRunner(t, async (n) => {
      if (n === 1) await changeCash(t, companyId, -50_000_00);
    });
    await expect(simulateFixFresh(raced.runner, parentId, first.fix.id)).rejects.toThrow(
      "STALE_FUTURE",
    );
    expect(raced.loads()).toBe(2);
    expect(await t.query(api.branches.get, { branchId: fixBranchId })).toBeNull();
    // Undo the change: an undisturbed run rebuilds exactly the stored branch.
    await changeCash(t, companyId, 50_000_00);
    const calm = racingRunner(t, async () => {});
    expect(await simulateFixFresh(calm.runner, parentId, first.fix.id)).toEqual({
      branchId: fixBranchId,
      changed: true,
    });
    expect(calm.loads()).toBe(1);
    expect(await t.query(api.branches.get, { branchId: fixBranchId })).toEqual(stored);
  });
});

async function changeCash(t: T, companyId: Id<"companies">, delta: number) {
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("snapshots")
      .withIndex("by_company_asOf", (q) => q.eq("companyId", companyId))
      .unique();
    if (!row) throw new Error("missing snapshot");
    await ctx.db.patch(row._id, { data: { ...row.data, cashOnHand: row.data.cashOnHand + delta } });
  });
}

async function insertCompany(t: T, rules: Constraint[]) {
  return t.run(async (ctx) => {
    const companyId = await ctx.db.insert("companies", {
      name: "Rule ranking test",
      profile: "kestrel",
      currentWeek: 0,
      today: asOf,
      status: "ready",
    });
    await ctx.db.insert("snapshots", { companyId, asOf, data: snapshot });
    await ctx.db.insert("models", { companyId, version: model.version, data: model });
    for (const data of rules) await ctx.db.insert("constraints", { companyId, data });
    return companyId;
  });
}

describe("companies.capabilities", () => {
  const off = { addEvent: false, simulate: false, nextWeek: false };

  it("enables events and fixes only for the current computed base", async () => {
    const { t, companyId } = await seeded();
    expect(await t.query(api.companies.capabilities, { companyId })).toEqual({
      addEvent: true,
      simulate: true,
      nextWeek: false,
    });
    // A newer snapshot makes the saved base stale until it is recomputed.
    await t.run((ctx) =>
      ctx.db.insert("snapshots", {
        companyId,
        asOf: "2099-01-05",
        data: { ...snapshot, asOf: "2099-01-05" },
      }),
    );
    expect(await t.query(api.companies.capabilities, { companyId })).toEqual(off);
  });

  it("stays off for the fixture company and unavailable companies", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.mutation(internal.dev.seedFixtures.seed, {});
    expect(await t.query(api.companies.capabilities, { companyId: fixture.companyId })).toEqual(
      off,
    );
    const gone = await t.run(async (ctx) => {
      const id = await ctx.db.insert("companies", {
        name: "Gone",
        profile: "kestrel",
        currentWeek: 0,
        today: asOf,
        status: "ready",
      });
      await ctx.db.delete(id);
      return id;
    });
    expect(await t.query(api.companies.capabilities, { companyId: gone })).toEqual(off);
    // A company with no snapshot or base yet.
    const empty = await t.run((ctx) =>
      ctx.db.insert("companies", {
        name: "Empty",
        profile: "kestrel",
        currentWeek: 0,
        today: asOf,
        status: "connecting",
      }),
    );
    expect(await t.query(api.companies.capabilities, { companyId: empty })).toEqual(off);
  });
});
