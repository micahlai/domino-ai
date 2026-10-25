/** Selected filing-backed operating feeds. Each selection has one durable mock world. */
import { OPERATING_COMPANY_IDS, OPERATING_SCENARIO_IDS, operatingProvenance } from "@domino/sim";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { createFeedCompany } from "./field";

const companyArg = v.union(
  v.literal(OPERATING_COMPANY_IDS[0]),
  v.literal(OPERATING_COMPANY_IDS[1]),
  v.literal(OPERATING_COMPANY_IDS[2]),
  v.literal(OPERATING_COMPANY_IDS[3]),
  v.literal(OPERATING_COMPANY_IDS[4]),
);
const scenarioArg = v.union(
  v.literal(OPERATING_SCENARIO_IDS[0]),
  v.literal(OPERATING_SCENARIO_IDS[1]),
  v.literal(OPERATING_SCENARIO_IDS[2]),
  v.literal(OPERATING_SCENARIO_IDS[3]),
);

export const ensure = mutation({
  args: { company: companyArg, scenario: scenarioArg },
  handler: async (ctx, selection) => {
    const existing = await ctx.db
      .query("companies")
      .withIndex("by_operating_demo", (q) =>
        q
          .eq("operatingDemo.company", selection.company)
          .eq("operatingDemo.scenario", selection.scenario),
      )
      .unique();
    if (existing) return { companyId: existing._id, name: existing.name, created: false };
    const companyId = await createFeedCompany(ctx, 1, undefined, undefined, selection);
    const created = (await ctx.db.get("companies", companyId))!;
    return { companyId, name: created.name, created: true };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const companies = (
      await Promise.all(
        OPERATING_COMPANY_IDS.map((company) =>
          ctx.db
            .query("companies")
            .withIndex("by_operating_demo", (q) => q.eq("operatingDemo.company", company))
            .collect(),
        ),
      )
    ).flat();
    return companies
      .filter((row) => row.operatingDemo !== undefined)
      .map((row) => ({
        companyId: row._id,
        company: row.operatingDemo!.company,
        scenario: row.operatingDemo!.scenario,
        name: row.name,
      }));
  },
});

export const context = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const company = await ctx.db.get("companies", companyId);
    const selection = company?.operatingDemo;
    return selection
      ? operatingProvenance({ company: selection.company, scenario: selection.scenario }, 1)
      : null;
  },
});
