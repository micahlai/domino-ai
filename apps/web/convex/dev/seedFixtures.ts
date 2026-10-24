import {
  BranchSchema,
  CompanyModelSchema,
  ConstraintSchema,
  FixCandidateSchema,
  HistoryWeekSchema,
  PastEventSchema,
  ResilienceReportSchema,
  RiskEventSchema,
  SnapshotSchema,
} from "@domino/contracts";
import { fixtures } from "@domino/contracts/fixtures";
import { internalMutation } from "../_generated/server";
import { Cents, CompanyFields, parse } from "../lib/parse";
import { sameChanges } from "../lib/records";

/** Create once; rerunning never resets a person's approval history. */
export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    const marker = await ctx.db
      .query("log")
      .filter((q) => q.eq(q.field("action"), "fixtures.seed"))
      .first();
    if (marker) {
      const existing = await ctx.db.get(marker.companyId);
      if (!existing)
        throw new Error("Fixture company is missing; repair the local fixture database");
      return { companyId: existing._id, created: false };
    }
    const companyId = await ctx.db.insert(
      "companies",
      parse(CompanyFields, {
        name: "Kestrel Data",
        profile: "kestrel",
        currentWeek: 0,
        today: fixtures.snapshot.asOf,
        status: "ready",
      }),
    );
    const asOf = fixtures.snapshot.asOf;
    await ctx.db.insert("snapshots", {
      companyId,
      asOf,
      data: parse(SnapshotSchema, fixtures.snapshot),
    });
    await ctx.db.insert("models", {
      companyId,
      version: fixtures.model.version,
      data: parse(CompanyModelSchema, fixtures.model),
    });
    for (const constraint of fixtures.constraints)
      await ctx.db.insert("constraints", { companyId, data: parse(ConstraintSchema, constraint) });
    for (const risk of [...fixtures.risks, ...fixtures.moreRisks])
      await ctx.db.insert("risks", { companyId, asOf, data: parse(RiskEventSchema, risk) });
    for (const fixture of fixtures.branches) {
      const branch = parse(BranchSchema, fixture);
      await ctx.db.insert("branches", {
        companyId,
        branchId: branch.id,
        parentId: branch.parentId,
        kind: branch.kind,
        data: branch,
      });
    }
    for (const fixture of fixtures.fixes) {
      const fix = parse(FixCandidateSchema, fixture);
      const scored = fixtures.branches.find(
        (branch) =>
          branch.kind === "fix" && sameChanges(parse(BranchSchema, branch).changes, fix.changes),
      );
      const parent = fixtures.branches.find((branch) => branch.id === scored?.parentId);
      if (!scored || !parent) throw new Error("Fixture fix needs a scored branch and its parent");
      const gain = parse(Cents, scored.forecast.lowPoint.usable - parent.forecast.lowPoint.usable);
      await ctx.db.insert("fixes", { companyId, branchId: parent.id, data: fix, gain });
    }
    await ctx.db.insert("history", {
      companyId,
      weeks: parse(HistoryWeekSchema.array(), fixtures.history),
      pastEvents: parse(PastEventSchema.array(), fixtures.pastEvents),
    });
    for (const [withFixes, report] of [
      [false, fixtures.resilience],
      [true, fixtures.resilienceWithFixes],
    ] as const) {
      await ctx.db.insert("resilience", {
        companyId,
        asOf,
        withFixes,
        data: parse(ResilienceReportSchema, report),
      });
    }
    const sourceKinds = [
      "stripe",
      "nessie",
      "crm",
      "ramp",
      "books",
      "payroll",
      "document",
    ] as const;
    for (const kind of sourceKinds) {
      await ctx.db.insert("sources", {
        companyId,
        kind,
        baseUrl:
          kind === "nessie" ? "http://api.nessieisreal.com" : `http://localhost:4010/${kind}`,
        mappings: [],
        lastPull: null,
        tieOut: "pending",
        step: "Sample records loaded; live checks have not run",
      });
    }
    await ctx.db.insert("log", {
      companyId,
      actor: "engine",
      action: "fixtures.seed",
      refs: ["kestrel"],
      at: `${asOf}T00:00:00.000Z`,
    });
    return { companyId, created: true };
  },
});
