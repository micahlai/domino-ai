/**
 * Selected filing-backed operating feeds. Each selection has one durable mock world. A new feed
 * starts idle (no ingest, analyst or clock work) until fieldAgents.start.
 *
 * Replays: fieldOperating.replay({ companyId }) creates a fresh idle copy of the same company and
 * scenario (replayOf = the original) so agents can be watched building everything live. The
 * original and its data are never changed. ensure always returns the original; list returns
 * every row with { replayOf, started } so a browser can pick its replay.
 */
import { OPERATING_COMPANY_IDS, OPERATING_SCENARIO_IDS, operatingProvenance } from "@domino/sim";
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { type QueryCtx, mutation, query } from "./_generated/server";
import { createFeedCompany } from "./field";
import { agentsStatus } from "./fieldAgents";

/** Replays kept per company and scenario; older ones stay in the database but are not listed. */
const REPLAYS_LISTED = 3;

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

type Selection = {
  company: (typeof OPERATING_COMPANY_IDS)[number];
  scenario: (typeof OPERATING_SCENARIO_IDS)[number];
};

async function rowsOf(ctx: Pick<QueryCtx, "db">, selection: Selection) {
  return ctx.db
    .query("companies")
    .withIndex("by_operating_demo", (q) =>
      q
        .eq("operatingDemo.company", selection.company)
        .eq("operatingDemo.scenario", selection.scenario),
    )
    .collect();
}

/** The one original (non-replay) row for a selection. */
async function originalOf(ctx: Pick<QueryCtx, "db">, selection: Selection) {
  return (await rowsOf(ctx, selection)).find((row) => !row.replayOf) ?? null;
}

export const ensure = mutation({
  args: { company: companyArg, scenario: scenarioArg },
  handler: async (ctx, selection) => {
    const existing = await originalOf(ctx, selection);
    if (existing) return { companyId: existing._id, name: existing.name, created: false };
    const companyId = await createFeedCompany(ctx, 1, undefined, undefined, selection, {
      idle: true,
    });
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
    const operating = companies.filter((row) => row.operatingDemo !== undefined);
    // Only the newest few replays per selection are offered.
    const replays = new Map<string, Doc<"companies">[]>();
    for (const row of operating)
      if (row.replayOf) {
        const key = `${row.operatingDemo!.company}/${row.operatingDemo!.scenario}`;
        replays.set(key, [...(replays.get(key) ?? []), row]);
      }
    const listed = new Set(
      [...replays.values()].flatMap((rows) =>
        rows
          .sort((a, b) => b._creationTime - a._creationTime)
          .slice(0, REPLAYS_LISTED)
          .map((row) => row._id),
      ),
    );
    return Promise.all(
      operating
        .filter((row) => !row.replayOf || listed.has(row._id))
        .map(async (row) => ({
          companyId: row._id,
          company: row.operatingDemo!.company,
          scenario: row.operatingDemo!.scenario,
          name: row.name,
          replayOf: row.replayOf ?? null,
          started: (await agentsStatus(ctx, row)).started,
        })),
    );
  },
});

/** A fresh idle copy of an operating company and scenario. The original is not touched. */
export const replay = mutation({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const company = await ctx.db.get("companies", companyId);
    const selection = company?.operatingDemo;
    if (!company || !selection)
      throw new ConvexError({ code: "NOT_FOUND", message: "No such operating company" });
    const original = company.replayOf ?? company._id;
    const pick = { company: selection.company, scenario: selection.scenario };
    const created = await createFeedCompany(ctx, 1, undefined, undefined, pick, { idle: true });
    const base = (await ctx.db.get("companies", original))?.name ?? company.name;
    const name = `${base} · Replay`;
    await ctx.db.patch("companies", created, { replayOf: original, name });
    return { companyId: created, name, replayOf: original };
  },
});

/**
 * Reset demo: a NEW started copy of the company's prepared baseline (no planted scenario, no
 * decisions or learned rules, fresh clock), listed as a replay of the baseline original. Nothing
 * existing is deleted or changed; the caller switches to the returned company.
 */
export const resetDemo = mutation({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const company = await ctx.db.get("companies", companyId);
    const selection = company?.operatingDemo;
    if (!company || !selection)
      throw new ConvexError({ code: "NOT_FOUND", message: "No such operating company" });
    const pick = { company: selection.company, scenario: "baseline" as const };
    const original =
      (await originalOf(ctx, pick))?._id ??
      (await createFeedCompany(ctx, 1, undefined, undefined, pick, { idle: true }));
    const created = await createFeedCompany(ctx, 1, undefined, undefined, pick);
    const base = (await ctx.db.get("companies", original))?.name ?? company.name;
    const name = `${base} · Fresh demo`;
    await ctx.db.patch("companies", created, { replayOf: original, name });
    return { companyId: created, name, replayOf: original, scenario: pick.scenario };
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
