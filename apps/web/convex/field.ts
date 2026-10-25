/**
 * Field weekly API (public). Mock entries arrive -> the ingestion agent reads the connected
 * tools (connectors/pullAll) -> a new
 * immutable snapshot version -> audit findings (high = escalation) -> forecast recompute.
 * Every step is a `log` row with agent/tool/source identities. Synthetic mocks only; nothing
 * here calls a real money API or moves money.
 *
 * Queries
 *   field.status({ companyId? })      latest feed when omitted, else null when none exists:
 *     { companyId, name, asOf, week, auto, autoTicksLeft, snapshotVersion, lastSnapshotId,
 *       lastSnapshotAt, lastIngestAt, lastIngestStatus: "ok"|"no_change"|"failed"|null,
 *       lastError, recordCounts: { customers, invoices, ... } | null,
 *       openFindings, openEscalations, sources: [{ kind, lastPull, tieOut, step }] }
 *   field.log({ companyId, paginationOpts })   newest first; Convex pagination result of
 *     { _id, at, actor, action, refs, agent?, tool?, source?, runId?, summary? }
 *   field.findings({ companyId, status?: "open"|"approved"|"rejected", escalatedOnly? })
 *     up to 200, newest first: { findingId, kind, severity, summary, refs, detectedAt,
 *     version, escalated, status, decidedBy?, decidedAt?, note?,
 *     explanation?: { text, suggestedCheck, model, at } }  (Claude, fieldAi.explainNewFindings)
 *   field.exportSeed({ companyId })   { seedId, contentHash, json } where json is
 *     WeeklySeedV1 text for the latest snapshot, already checked by parseWeeklySeedJson.
 *   field.companies()   picker companies in picker order (newest per profile, by name):
 *     [{ companyId, profile, name, story, asOf, health: { rating, week } | null }]
 * Mutations
 *   field.setupAll()   set up every picker company that is missing; { created: profile[] }.
 *   field.setup({ seed?, profile? })  new live-feed company; first ingest queued. No profile =
 *     legacy sim Kestrel; profile "kestrel" | "kestrel-churn" | "kestrel-late" | "kestrel-crunch"
 *     = driver-based company whose mock sources report that profile id as companyId.
 *   field.advanceFeed({ companyId, advance?, anomaly? })  advance the mock world one week
 *     (default) and/or plant one anomaly: duplicate | unusual_amount | unusual_timing |
 *     conflict | missing_expected. Returns { asOf, week, planted: string[] }.
 *   field.ingestNow({ companyId })    queue one ingest run now.
 *   field.setAutoIngest({ companyId, enabled })  every 45 s, at most 120 runs per enable.
 *   field.decide({ companyId, findingId, decision: "approved"|"rejected", note? })
 *     approved = issue confirmed, rejected = dismissed. Writes `approvals` (fixId = findingId,
 *     branchId = "field:escalation") and a log row.
 */
import {
  CompanyModelSchema,
  ConstraintSchema,
  type Finding,
  SnapshotSchema,
  type WeeklySeedV1,
  contentHashPreimage,
  firstForecastWeek,
  parseWeeklySeedJson,
} from "@domino/contracts";
import { fixtures } from "@domino/contracts/fixtures";
import { scheduledItems } from "@domino/engine";
import { PROFILE_IDS, type ProfileId } from "@domino/sim";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { deriveDashboard } from "../components/field/dashboard/derive";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, type QueryCtx, mutation, query } from "./_generated/server";
import { connectAll } from "./connections";
import { TOOL_IDS } from "./connectors/types";
import {
  ANOMALIES,
  type Anomaly,
  emptyOverlay,
  newWorld,
  nextWorld,
  plant,
  profileName,
} from "./fieldFeed";
import {
  AGENT,
  AUTO_INTERVAL_MS,
  AUTO_MAX_TICKS,
  requireFeed,
  requireWorld,
  sha256,
  writeLog,
} from "./fieldJobs";
import { FIELD_COMPANIES, profileOfName } from "./lib/fieldCompanies";
import { Timestamp, parse } from "./lib/parse";

const SOURCES = [
  ["stripe", "inproc://mocks/stripe"],
  ["crm", "inproc://mocks/crm"],
  ["ramp", "inproc://mocks/cards"],
  ["books", "inproc://mocks/books"],
  ["payroll", "inproc://mocks/payroll"],
  ["nessie", "inproc://mocks/bank"],
] as const;
const ESCALATION_BRANCH = "field:escalation";
const anomaly = v.union(...ANOMALIES.map((a) => v.literal(a)));
const profileArg = v.union(...PROFILE_IDS.map((p) => v.literal(p)));
const findingStatus = v.union(v.literal("open"), v.literal("approved"), v.literal("rejected"));

async function personName(ctx: { auth: QueryCtx["auth"] }) {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.tokenIdentifier ?? "demo-user (unverified)";
}

/** One new live-feed company with six connected tools; its first ingest is queued. */
async function createFeedCompany(ctx: MutationCtx, seed: number, profile: ProfileId | undefined) {
  const world = newWorld(seed, profile);
  const name = profileName(profile);
  const companyId = await ctx.db.insert("companies", {
    name,
    profile: "kestrel",
    currentWeek: world.week,
    today: world.today,
    status: "connecting",
  });
  // A plain starting model: no learned delays or rules yet; constraints are the
  // synthetic loan and board documents.
  await ctx.db.insert("models", {
    companyId,
    version: 1,
    data: CompanyModelSchema.parse({
      version: 1,
      customerDelayDays: {},
      recurringSpend: [],
      rules: [],
    }),
  });
  for (const c of fixtures.constraints)
    await ctx.db.insert("constraints", { companyId, data: ConstraintSchema.parse(c) });
  for (const [kind, baseUrl] of SOURCES)
    await ctx.db.insert("sources", {
      companyId,
      kind,
      baseUrl,
      mappings: [],
      lastPull: null,
      tieOut: "pending",
      step: "waiting for first pull",
    });
  await connectAll(ctx, companyId, name);
  await ctx.db.insert("feedWorlds", { companyId, world, overlay: emptyOverlay() });
  await ctx.db.insert("feeds", {
    companyId,
    auto: false,
    autoGeneration: 0,
    autoTicksLeft: 0,
    week: world.week,
    snapshotVersion: 0,
    lastSnapshotId: null,
    lastSnapshotHash: null,
    lastSnapshotAt: null,
    lastIngestAt: null,
    lastIngestStatus: null,
    lastError: null,
    recordCounts: null,
  });
  await writeLog(ctx, companyId, undefined, {
    actor: "person",
    action: "feed.created",
    refs: [...TOOL_IDS],
    agent: "mock.feed",
    tool: "sim.createCompany",
    summary: `Connected six tools (read only, mock vendor APIs) for ${name} as of ${world.today}`,
  });
  await ctx.scheduler.runAfter(0, internal.fieldJobs.ingestRun, { companyId, trigger: "setup" });
  return companyId;
}

export const setup = mutation({
  args: { seed: v.optional(v.number()), profile: v.optional(profileArg) },
  handler: async (ctx, { seed, profile }) => {
    const companyId = await createFeedCompany(
      ctx,
      Number.isSafeInteger(seed) ? (seed as number) : 1,
      profile,
    );
    return { companyId };
  },
});

/** The newest live-feed company per profile, by its picker name. */
async function companiesByProfile(ctx: QueryCtx) {
  const feeds = await ctx.db.query("feeds").order("desc").take(100);
  const out = new Map<ProfileId, { feed: Doc<"feeds">; company: Doc<"companies"> }>();
  for (const feed of feeds) {
    const company = await ctx.db.get("companies", feed.companyId);
    const profile = company ? profileOfName(company.name) : null;
    if (company && profile && !out.has(profile)) out.set(profile, { feed, company });
  }
  return out;
}

/** Sets up every picker company that does not exist yet (seed 1). Idempotent. */
export const setupAll = mutation({
  args: {},
  handler: async (ctx) => {
    const have = await companiesByProfile(ctx);
    const created: ProfileId[] = [];
    for (const c of FIELD_COMPANIES)
      if (!have.has(c.id)) {
        await createFeedCompany(ctx, 1, c.id);
        created.push(c.id);
      }
    return { created };
  },
});

/**
 * The picker's companies, in picker order: profile, name, one-line story and a health summary
 * from the latest ingested snapshot (the dashboard's own derivation). Not set up yet = absent.
 */
export const companies = query({
  args: {},
  handler: async (ctx) => {
    const have = await companiesByProfile(ctx);
    const out = [];
    for (const c of FIELD_COMPANIES) {
      const hit = have.get(c.id);
      if (!hit) continue;
      const { feed, company } = hit;
      let health: { rating: "ok" | "watch" | "at_risk"; week: string | null } | null = null;
      const row = feed.lastSnapshotId ? await ctx.db.get("snapshots", feed.lastSnapshotId) : null;
      if (row) {
        const model = await ctx.db
          .query("models")
          .withIndex("by_company_version", (q) => q.eq("companyId", company._id))
          .order("desc")
          .first();
        const constraints = await ctx.db
          .query("constraints")
          .withIndex("by_company", (q) => q.eq("companyId", company._id))
          .take(50);
        const r = deriveDashboard({
          snapshot: SnapshotSchema.parse(row.data),
          model: CompanyModelSchema.parse(model?.data),
          constraints: constraints.map((x) => ConstraintSchema.parse(x.data)),
        });
        if (r.ok) health = { rating: r.view.health.rating, week: r.view.health.week };
      }
      out.push({
        companyId: company._id,
        profile: c.id,
        name: company.name,
        story: c.story,
        asOf: company.today,
        health,
      });
    }
    return out;
  },
});

async function feedFor(ctx: QueryCtx, companyId: Id<"companies"> | undefined) {
  if (companyId)
    return ctx.db
      .query("feeds")
      .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
      .unique();
  return ctx.db.query("feeds").order("desc").first();
}

export const status = query({
  args: { companyId: v.optional(v.id("companies")) },
  handler: async (ctx, args) => {
    const feed = await feedFor(ctx, args.companyId);
    if (!feed) return null;
    const { companyId } = feed;
    const company = await ctx.db.get("companies", companyId);
    const open = await ctx.db
      .query("findings")
      .withIndex("by_companyId_and_status", (q) =>
        q.eq("companyId", companyId).eq("status", "open"),
      )
      .take(500);
    const sources = await ctx.db
      .query("sources")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .take(20);
    return {
      companyId,
      name: company?.name ?? "",
      asOf: company?.today ?? null,
      week: feed.week,
      auto: feed.auto,
      autoTicksLeft: feed.autoTicksLeft,
      autoIntervalMs: AUTO_INTERVAL_MS,
      snapshotVersion: feed.snapshotVersion,
      lastSnapshotId: feed.lastSnapshotId,
      lastSnapshotAt: feed.lastSnapshotAt,
      lastIngestAt: feed.lastIngestAt,
      lastIngestStatus: feed.lastIngestStatus,
      lastError: feed.lastError,
      recordCounts: feed.recordCounts,
      openFindings: open.length,
      openEscalations: open.filter((f) => f.escalated).length,
      sources: sources.map((s) => ({
        kind: s.kind,
        lastPull: s.lastPull,
        tieOut: s.tieOut,
        step: s.step,
      })),
    };
  },
});

export const log = query({
  args: { companyId: v.id("companies"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { companyId, paginationOpts }) => {
    const page = await ctx.db
      .query("log")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .order("desc")
      .paginate(paginationOpts);
    for (const row of page.page) parse(Timestamp, row.at);
    return page;
  },
});

const publicFinding = (f: Doc<"findings">) => ({
  findingId: f.findingId,
  kind: f.kind,
  severity: f.severity,
  summary: f.summary,
  refs: f.refs,
  detectedAt: f.detectedAt,
  version: f.version,
  escalated: f.escalated,
  status: f.status,
  decidedBy: f.decidedBy,
  decidedAt: f.decidedAt,
  note: f.note,
  explanation: f.explanation,
});

export const findings = query({
  args: {
    companyId: v.id("companies"),
    status: v.optional(findingStatus),
    escalatedOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, { companyId, status, escalatedOnly }) => {
    const rows = await ctx.db
      .query("findings")
      .withIndex("by_companyId_and_status", (q) =>
        q.eq("companyId", companyId).eq("status", status ?? "open"),
      )
      .order("desc")
      .take(200);
    return rows.filter((f) => !escalatedOnly || f.escalated).map(publicFinding);
  },
});

export const decide = mutation({
  args: {
    companyId: v.id("companies"),
    findingId: v.string(),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { companyId, findingId, decision, note }) => {
    const finding = await ctx.db
      .query("findings")
      .withIndex("by_companyId_and_findingId", (q) =>
        q.eq("companyId", companyId).eq("findingId", findingId),
      )
      .first();
    if (!finding) throw new ConvexError({ code: "NOT_FOUND", message: "No such finding" });
    if (finding.status !== "open")
      throw new ConvexError({ code: "ALREADY_DECIDED", message: `Already ${finding.status}` });
    const by = await personName(ctx);
    const at = new Date().toISOString();
    const text = (note ?? "").trim().slice(0, 2000);
    await ctx.db.patch("findings", finding._id, {
      status: decision,
      decidedBy: by,
      decidedAt: at,
      ...(text && { note: text }),
    });
    const approvalId = await ctx.db.insert("approvals", {
      companyId,
      fixId: findingId,
      branchId: ESCALATION_BRANCH,
      decision,
      by,
      at,
      note: text,
    });
    await writeLog(ctx, companyId, undefined, {
      actor: "person",
      action: `escalation.${decision}`,
      refs: [findingId, approvalId],
      agent: "field.worker",
      summary: `${decision === "approved" ? "Confirmed" : "Dismissed"}: ${finding.summary}`,
    });
    return { approvalId };
  },
});

export const ingestNow = mutation({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    await requireFeed(ctx, companyId);
    await writeLog(ctx, companyId, undefined, {
      actor: "person",
      action: "ingest.requested",
      refs: [],
      agent: AGENT,
      summary: "Ingest requested now",
    });
    await ctx.scheduler.runAfter(0, internal.fieldJobs.ingestRun, { companyId, trigger: "manual" });
    return null;
  },
});

export const setAutoIngest = mutation({
  args: { companyId: v.id("companies"), enabled: v.boolean() },
  handler: async (ctx, { companyId, enabled }) => {
    const feed = await requireFeed(ctx, companyId);
    const generation = feed.autoGeneration + 1;
    await ctx.db.patch("feeds", feed._id, {
      auto: enabled,
      autoGeneration: generation,
      autoTicksLeft: enabled ? AUTO_MAX_TICKS : 0,
    });
    await writeLog(ctx, companyId, undefined, {
      actor: "person",
      action: enabled ? "ingest.autoStarted" : "ingest.autoStopped",
      refs: [],
      agent: AGENT,
      summary: enabled
        ? `Auto-ingest on: every ${AUTO_INTERVAL_MS / 1000} s, at most ${AUTO_MAX_TICKS} runs`
        : "Auto-ingest off",
    });
    if (enabled)
      await ctx.scheduler.runAfter(0, internal.fieldJobs.tick, { companyId, generation });
    return { auto: enabled };
  },
});

export const advanceFeed = mutation({
  args: {
    companyId: v.id("companies"),
    advance: v.optional(v.boolean()),
    anomaly: v.optional(anomaly),
  },
  handler: async (ctx, { companyId, advance, anomaly: kind }) => {
    const feed = await requireFeed(ctx, companyId);
    const { row, world: current, overlay: currentOverlay } = await requireWorld(ctx, companyId);
    let world = current;
    let overlay = currentOverlay;
    if (advance !== false) {
      world = nextWorld(current);
      await writeLog(ctx, companyId, undefined, {
        actor: "person",
        action: "feed.advanced",
        refs: [world.today],
        agent: "mock.feed",
        tool: "sim.advanceWeek",
        summary: `Mock sources moved to week ${world.week} (${world.today}); new entries are waiting`,
      });
    }
    let planted: string[] = [];
    if (kind) {
      const result = plant(world, overlay, kind as Anomaly);
      overlay = result.overlay;
      planted = result.refs;
      await writeLog(ctx, companyId, undefined, {
        actor: "person",
        action: "feed.planted",
        refs: [kind, ...planted],
        agent: "mock.feed",
        tool: "mock.plant",
        summary: `Planted a synthetic ${kind.replace("_", " ")}: ${result.summary}`,
      });
    }
    await ctx.db.replace("feedWorlds", row._id, { companyId, world, overlay });
    await ctx.db.patch("feeds", feed._id, { week: world.week });
    return { asOf: world.snapshot.asOf, week: world.week, planted };
  },
});

export const exportSeed = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const feed = await requireFeed(ctx, companyId);
    const company = await ctx.db.get("companies", companyId);
    const row = feed.lastSnapshotId ? await ctx.db.get("snapshots", feed.lastSnapshotId) : null;
    if (!row || !company || !feed.lastSnapshotAt)
      throw new ConvexError({ code: "MISSING_INPUT", message: "No ingested snapshot yet" });
    const snapshot = SnapshotSchema.parse(row.data);
    const items = scheduledItems(snapshot);
    const known = new Set([
      ...[
        snapshot.customers,
        snapshot.invoices,
        snapshot.bankTxns,
        snapshot.bills,
        snapshot.cardTxns,
        snapshot.payroll,
        snapshot.deals,
      ].flatMap((list) => list.map((r) => r.id)),
      ...items.map((i) => i.id),
    ]);
    const kept: Finding[] = [];
    for (const status of ["open", "approved"] as const) {
      const rows = await ctx.db
        .query("findings")
        .withIndex("by_companyId_and_status", (q) =>
          q.eq("companyId", companyId).eq("status", status),
        )
        .take(250);
      for (const f of rows)
        if (f.refs.every((r) => known.has(r)) && f.detectedAt <= feed.lastSnapshotAt)
          kept.push({
            id: f.findingId,
            kind: f.kind,
            severity: f.severity,
            summary: f.summary,
            refs: f.refs,
            detectedAt: f.detectedAt,
          });
    }
    const draft: Omit<WeeklySeedV1, "contentHash"> = {
      schemaVersion: 1,
      id: `field:weekly_seed/${companyId}-v${feed.snapshotVersion}`,
      exportedAt: feed.lastSnapshotAt,
      company: { id: snapshot.companyId, name: company.name },
      asOf: firstForecastWeek(snapshot.asOf),
      snapshot,
      scheduledItems: items,
      findings: kept.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    };
    const contentHash = await sha256(contentHashPreimage(draft));
    const json = JSON.stringify({ ...draft, contentHash });
    const parsed = parseWeeklySeedJson(json);
    if (!parsed.success)
      throw new ConvexError({
        code: "INVALID_SEED",
        message: "The weekly seed failed its contract",
        fields: parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    return { seedId: draft.id, contentHash, json };
  },
});
