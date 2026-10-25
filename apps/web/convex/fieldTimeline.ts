/**
 * Field -> Timeline joint seam (TL7 integration, kb/features/INTEGRATION-TL7.md).
 *
 * Field exports the latest weekly books as WeeklySeedV1 JSON text (field.exportSeed). Timeline
 * verifies that text and its hash on the server, saves a frozen baseline and a workspace run,
 * and answers with a WeeklyResultRefV1 pointer. Field keeps only that pointer (timelineLinks);
 * every financial value shown from it is read back from Timeline's own saved outputs.
 * All Timeline calls go through Timeline's public functions, never its tables.
 *
 * Actions
 *   fieldTimeline.openInTimeline({ companyId, reviewed: true })
 *     -> { timelineCompanyId, runId, baselineRunId, analysisId, route, created }
 *     1. field.exportSeed, checked again with parseWeeklySeedJson.
 *     2. timeline/baselines:save with Field's lender rules (constraints table) and latest model
 *        as the person's reviewed assumptions. Same books + same assumptions = same baseline.
 *     3. timeline/workspace:open (one root run per baseline).
 *     4. timeline/analysis:start: Timeline's automatic risk analysis (TL7), started by this
 *        explicit click, never on page open. A failure to start is recorded, not hidden.
 *     5. timeline/workspace:resultRef, parsed with parseWeeklyResultRefJson, saved as the link.
 * Queries
 *   fieldTimeline.latest({ companyId }) -> newest link or null:
 *     { timelineCompanyId, runId, baselineRunId, analysisId, analysisError, route, seedId,
 *       seedHash, asOf, snapshotVersion, savedAt, current }  current = made from the latest books.
 */
import {
  CompanyModelSchema,
  ConstraintSchema,
  canonicalJson,
  parseWeeklyResultRefJson,
  parseWeeklySeedJson,
} from "@domino/contracts";
import { type OperatingProvenance, operatingProvenance } from "@domino/sim";
import { ConvexError, v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { sha256 } from "./fieldJobs";
import { UNSUPPORTED_SEED_FIELDS } from "./timeline/baselines";

const EMPTY_MODEL = { version: 1, customerDelayDays: {}, recurringSpend: [], rules: [] };

/** Field's own inputs for the Timeline import: latest model and the company's stated rules. */
export const importInputs = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const feed = await ctx.db
      .query("feeds")
      .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
      .unique();
    const modelRow = await ctx.db
      .query("models")
      .withIndex("by_company_version", (q) => q.eq("companyId", companyId))
      .order("desc")
      .first();
    const rows = await ctx.db
      .query("constraints")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .take(32);
    const constraints = rows
      .map((r) => ConstraintSchema.parse(r.data))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const company = await ctx.db.get("companies", companyId);
    const selection = company?.operatingDemo;
    const operating = selection
      ? operatingProvenance({ company: selection.company, scenario: selection.scenario }, 1)
      : null;
    return {
      snapshotVersion: feed?.snapshotVersion ?? 0,
      model: CompanyModelSchema.parse(modelRow?.data ?? EMPTY_MODEL),
      constraints,
      operating: operating
        ? {
            label: operating.label,
            periodStart: operating.periodStart,
            periodEnd: operating.periodEnd,
            reportedAt: operating.reportedAt,
          }
        : null,
    };
  },
});

export const saveLink = internalMutation({
  args: {
    companyId: v.id("companies"),
    timelineCompanyId: v.string(),
    seedId: v.string(),
    seedHash: v.string(),
    asOf: v.string(),
    snapshotVersion: v.number(),
    baselineRunId: v.string(),
    runId: v.string(),
    resultRef: v.string(),
    analysisId: v.union(v.string(), v.null()),
    analysisError: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("timelineLinks", { ...args, savedAt: new Date().toISOString() });
  },
});

const fail = (code: string, message: string): never => {
  throw new ConvexError({ code, message });
};

const money = (cents: number) =>
  `$${Math.round(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** Plain words for the assumptions Timeline freezes with the run (at most 2,000 characters). */
function assumptionNote(args: {
  asOf: string;
  snapshotVersion: number;
  modelVersion: number;
  rules: { label: string; kind: string; limit: number }[];
  operating: Pick<OperatingProvenance, "label" | "periodStart" | "periodEnd" | "reportedAt"> | null;
}) {
  const rules = args.rules.length
    ? args.rules
        .map((r) =>
          r.kind === "min_cash"
            ? `${r.label}: usable cash at least ${money(r.limit)}`
            : r.kind === "min_runway_months"
              ? `${r.label}: at least ${r.limit} months of runway`
              : `${r.label}: pay by the allowed date`,
        )
        .join("; ")
    : "none on file";
  return [
    `Imported from Field: books as of ${args.asOf} (snapshot version ${args.snapshotVersion}), Field model version ${args.modelVersion}, and ${args.operating ? "illustrative simulation rules" : "the company's rules"} from Field (${rules}). Reviewed by the person who chose Open in Timeline. Nothing is paid or moved.`,
    args.operating &&
      `${args.operating.label} Historical ledger period ${args.operating.periodStart} through ${args.operating.periodEnd}; public report date ${args.operating.reportedAt}. Operating records are reconstructed; forward events and forecasts are illustrative. The imported rules are illustrative simulation assumptions, not reported company covenants.`,
    "Engine conventions: written-off invoices are never collected; a paid invoice's collected amount is final; pending processor payouts arrive on their estimated date, net of fees; billing plans project expected collections.",
    `Not calculated yet, so books using them are rejected rather than misstated: ${UNSUPPORTED_SEED_FIELDS.join("; ")}.`,
  ]
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .slice(0, 2000);
}

type OpenResult = {
  timelineCompanyId: string;
  runId: string;
  baselineRunId: string;
  analysisId: string | null;
  route: string;
  created: boolean;
};

export const openInTimeline = action({
  args: { companyId: v.id("companies"), reviewed: v.boolean() },
  handler: async (ctx, { companyId, reviewed }): Promise<OpenResult> => {
    if (!reviewed) fail("NOT_REVIEWED", "Review what will be imported before opening the timeline");
    const exported: { seedId: string; contentHash: string; json: string } = await ctx.runQuery(
      api.field.exportSeed,
      { companyId },
    );
    const parsed = parseWeeklySeedJson(exported.json);
    if (!parsed.success)
      return fail("INVALID_SEED", "The exported weekly seed failed its contract");
    const seed = parsed.data;
    const inputs: {
      snapshotVersion: number;
      model: ReturnType<typeof CompanyModelSchema.parse>;
      constraints: ReturnType<typeof ConstraintSchema.parse>[];
      operating: Pick<
        OperatingProvenance,
        "label" | "periodStart" | "periodEnd" | "reportedAt"
      > | null;
    } = await ctx.runQuery(internal.fieldTimeline.importInputs, { companyId });
    const note = assumptionNote({
      asOf: seed.snapshot.asOf,
      snapshotVersion: inputs.snapshotVersion,
      modelVersion: inputs.model.version,
      rules: inputs.constraints,
      operating: inputs.operating,
    });
    const modelJson = JSON.stringify(inputs.model);
    const constraintsJson = JSON.stringify(inputs.constraints);
    // Deterministic request ids: the same books and assumptions reopen the same saved runs.
    const key = (
      await sha256(canonicalJson({ seedHash: seed.contentHash, modelJson, constraintsJson, note }))
    ).slice(0, 48);
    const saved: { runId: string; companyId: string; created: boolean } = await ctx.runMutation(
      api.timeline.baselines.save,
      {
        requestId: `field.import.${key}`,
        seedJson: exported.json,
        modelJson,
        constraintsJson,
        assumptionNote: note,
        reviewed: true,
      },
    );
    const timelineCompanyId = saved.companyId;
    if (timelineCompanyId !== seed.company.id)
      fail("INTEGRITY", "Timeline saved the seed under another company");
    const opened: { runId: string; companyId: string } = await ctx.runMutation(
      api.timeline.workspace.open,
      { companyId: timelineCompanyId, baselineRunId: saved.runId, requestId: `field.open.${key}` },
    );
    let analysisId: string | null = null;
    let analysisError: string | null = null;
    try {
      const started: { analysisId: string } = await ctx.runMutation(api.timeline.analysis.start, {
        companyId: timelineCompanyId,
        runId: opened.runId,
        requestId: `field.analysis.${key}`,
        reviewed: true,
      });
      analysisId = started.analysisId;
    } catch (e) {
      analysisError =
        e instanceof ConvexError && typeof e.data?.message === "string"
          ? e.data.message
          : "Timeline's risk analysis could not start";
    }
    const refText: string | null = await ctx.runQuery(api.timeline.workspace.resultRef, {
      companyId: timelineCompanyId,
      runId: opened.runId,
    });
    const ref = parseWeeklyResultRefJson(refText);
    if (!refText || !ref.success)
      return fail("INTEGRITY", "Timeline returned no valid result link");
    if (ref.data.seedHash !== seed.contentHash || ref.data.seedId !== seed.id)
      fail("INTEGRITY", "Timeline's result link is for different books");
    await ctx.runMutation(internal.fieldTimeline.saveLink, {
      companyId,
      timelineCompanyId,
      seedId: seed.id,
      seedHash: seed.contentHash,
      asOf: seed.snapshot.asOf,
      snapshotVersion: inputs.snapshotVersion,
      baselineRunId: saved.runId,
      runId: opened.runId,
      resultRef: refText,
      analysisId,
      analysisError,
    });
    return {
      timelineCompanyId,
      runId: opened.runId,
      baselineRunId: saved.runId,
      analysisId,
      route: ref.data.route,
      created: saved.created,
    };
  },
});

export const latest = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }: { companyId: Id<"companies"> }) => {
    const link = await ctx.db
      .query("timelineLinks")
      .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
      .order("desc")
      .first();
    if (!link) return null;
    const ref = parseWeeklyResultRefJson(link.resultRef);
    if (!ref.success) return null;
    const feed = await ctx.db
      .query("feeds")
      .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
      .unique();
    return {
      timelineCompanyId: link.timelineCompanyId,
      runId: link.runId,
      baselineRunId: link.baselineRunId,
      analysisId: link.analysisId,
      analysisError: link.analysisError,
      route: ref.data.route,
      seedId: link.seedId,
      seedHash: link.seedHash,
      asOf: link.asOf,
      snapshotVersion: link.snapshotVersion,
      savedAt: link.savedAt,
      current: !feed || feed.snapshotVersion === link.snapshotVersion,
    };
  },
});
