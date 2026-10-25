/**
 * Judge sandbox (public). A judge starts an isolated simulated company ("Judge Co. #N", a
 * normal live feed flagged judge:true and hidden from the main picker), plants scenarios or CSV
 * rows into its mock sources, and watches the real ingestion, audit, forecast and analyst work
 * react. Planted entries go on the feed overlay (fieldFeed.servedSnapshot applies them), then an
 * ingest is queued exactly as field.ingestNow does. Decisions use field.decide unchanged.
 * Data is simulated; agents, audit, forecast and decisions are the real backend code paths.
 *
 * Queries
 *   fieldJudge.companies()            active judge companies, newest first:
 *     [{ companyId, name, number, profile }]
 *   fieldJudge.state({ companyId })   null when not a judge company:
 *     { companyId, name, number, profile, sources, archived, asOf, snapshotVersion, lastSnapshotAt,
 *       lastIngestStatus, history: [{ at, kind, label, summary, refs }], checklist: steps,
 *       decisions: [{ approvalId, findingId, decision, by, at, note, summary, logged }],
 *       limits: { perMinute, usedThisMinute, activeCompanies, maxCompanies } }
 *   fieldJudge.customers({ companyId })  pick list from what the mock sources serve now:
 *     [{ id, name, yearlyCents, openCents, openInvoices }]
 * Mutations
 *   fieldJudge.start({ profile?, sources? })  new judge company (default profile "kestrel");
 *     sources = the JUDGE_SOURCES tools to read (default all six, the bank required), applied
 *     before the first ingest. Starts idle: fieldAgents.start queues that first ingest.
 *     At most JUDGE_LIMITS.activeCompanies active. { companyId, name }
 *   fieldJudge.reset({ companyId })   archive it and start a fresh one with the same profile
 *     and sources.
 *   fieldJudge.leave({ companyId })   archive it, no replacement.
 *   fieldJudge.surprise({ companyId, preset })  one of SURPRISE_PRESETS, planted like a
 *     scenario (same rate limit). { refs, summary }
 *   fieldJudge.submitScenario({ companyId, scenario })  Zod-validated ScenarioSchema;
 *     { refs, summary }. At most JUDGE_LIMITS.submitsPerMinute per company per minute.
 *   fieldJudge.importCsv({ companyId, kind, rows })  rows are header-keyed strings; every row is
 *     checked, valid rows are planted. { accepted, rejected: [{ line, errors }] }.
 */
import { PROFILE_IDS, type ProfileId, isProfileId } from "@domino/sim";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, type QueryCtx, mutation, query } from "./_generated/server";
import { toolInfo } from "./connectors/catalog";
import type { ToolId } from "./connectors/types";
import { createFeedCompany } from "./field";
import { agentsStarted, agentsStatus, requireAgentsStarted } from "./fieldAgents";
import { type Overlay, servedSnapshot } from "./fieldFeed";
import { AGENT, requireFeed, requireWorld, writeLog } from "./fieldJobs";
import { fieldCompany } from "./lib/fieldCompanies";
import {
  CSV_KINDS,
  CSV_LABEL,
  type CsvEntry,
  JUDGE_LIMITS,
  JUDGE_SOURCES,
  JudgeInputError,
  type JudgeSource,
  type Planted,
  SCENARIO_LABEL,
  SURPRISE_LABEL,
  SURPRISE_NEEDS,
  SURPRISE_PRESETS,
  ScenarioSchema,
  judgeChecklist,
  judgeSourcePlan,
  plantCsv,
  plantScenario,
  plantVendorBankChange,
  rankCustomers,
  surpriseScenario,
  validateCsvRows,
  zodMessage,
} from "./lib/judge";
import type { JudgeHistoryEntry } from "./lib/judgeOverlay";

const profileArg = v.union(...PROFILE_IDS.map((p) => v.literal(p)));
const csvKind = v.union(...CSV_KINDS.map((k) => v.literal(k)));
const presetArg = v.union(...SURPRISE_PRESETS.map((p) => v.literal(p)));
/** Loose shape on the wire; ScenarioSchema (Zod) is the real check, with plain messages. */
const scenarioArg = v.object({
  kind: v.string(),
  customerId: v.optional(v.string()),
  days: v.optional(v.number()),
  amountCents: v.optional(v.number()),
  week: v.optional(v.number()),
  percent: v.optional(v.number()),
  label: v.optional(v.string()),
});
const MINUTE_MS = 60_000;
const ESCALATION_BRANCH = "field:escalation";

const bad = (message: string, code = "INVALID_INPUT") => new ConvexError({ code, message });

/** Judge companies, newest first (the companies table is small; no index needed). */
async function judgeCompanies(ctx: Pick<QueryCtx, "db">) {
  const rows = await ctx.db.query("companies").order("desc").take(1000);
  return rows.filter((c) => c.judge === true);
}

async function profileOf(ctx: Pick<QueryCtx, "db">, companyId: Id<"companies">) {
  const row = await ctx.db
    .query("feedWorlds")
    .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
    .unique();
  const id = (row?.world as { companyId?: unknown } | undefined)?.companyId;
  return typeof id === "string" && isProfileId(id) ? id : null;
}

async function requireJudge(ctx: Pick<QueryCtx, "db">, companyId: Id<"companies">) {
  const company = await ctx.db.get("companies", companyId);
  if (!company?.judge) throw bad("Not a judge sandbox company", "NOT_JUDGE");
  if (company.judgeArchivedAt)
    throw bad("This sandbox company was reset; start a fresh one", "ARCHIVED");
  return company;
}

const historyOf = (overlay: Overlay): JudgeHistoryEntry[] => overlay.history ?? [];

const connectionRows = (ctx: Pick<QueryCtx, "db">, companyId: Id<"companies">) =>
  ctx.db
    .query("connections")
    .withIndex("by_companyId_and_tool", (q) => q.eq("companyId", companyId))
    .take(20);

/** The judge-selectable tools a company reads now (the bank always among them). */
async function sourcesOf(ctx: Pick<QueryCtx, "db">, companyId: Id<"companies">) {
  const on = new Set(
    (await connectionRows(ctx, companyId))
      .filter((r) => r.status !== "disconnected")
      .map((r) => r.tool),
  );
  return JUDGE_SOURCES.filter((t) => on.has(t));
}

/**
 * Turns off the tools the judge left out. Runs in the same transaction that created the
 * company, so the first ingest (queued by fieldAgents.start, or at once when a started sandbox
 * is reset) reads only the chosen tools.
 */
async function applySources(ctx: MutationCtx, companyId: Id<"companies">, off: ToolId[]) {
  for (const row of await connectionRows(ctx, companyId))
    if (off.includes(row.tool) && row.status !== "disconnected")
      await ctx.db.patch("connections", row._id, {
        status: "disconnected",
        connectedAt: null,
        connectedBy: null,
      });
}

async function startJudge(
  ctx: MutationCtx,
  profile: ProfileId,
  sources?: readonly string[],
  startNow = false,
) {
  let plan: ReturnType<typeof judgeSourcePlan>;
  try {
    plan = judgeSourcePlan(sources);
  } catch (error) {
    if (error instanceof JudgeInputError) throw bad(error.message);
    throw error;
  }
  const all = await judgeCompanies(ctx);
  const active = all.filter((c) => !c.judgeArchivedAt);
  if (active.length >= JUDGE_LIMITS.activeCompanies)
    throw bad(
      `The sandbox is full (${JUDGE_LIMITS.activeCompanies} companies running). Reset one, or try again later.`,
      "LIMIT",
    );
  const number = Math.max(0, ...all.map((c) => c.judgeNumber ?? 0)) + 1;
  // Idle until Start agents (or started at once when a running sandbox is reset).
  const companyId = await createFeedCompany(ctx, 1, profile, { number }, undefined, {
    idle: !startNow,
  });
  await applySources(ctx, companyId, plan.off);
  const names = plan.on.map((t) => toolInfo(t).name).join(", ");
  await writeLog(ctx, companyId, undefined, {
    actor: "person",
    action: "feed.judgeStarted",
    refs: [profile, ...plan.on],
    agent: "mock.feed",
    tool: "judge.start",
    summary: `Judge sandbox company #${number} started from the "${fieldCompany(profile).name}" simulation (synthetic data), reading ${plan.on.length} of ${JUDGE_SOURCES.length} tools: ${names}`,
  });
  return { companyId, name: `Judge Co. #${number}` };
}

async function archive(ctx: MutationCtx, company: Doc<"companies">) {
  const at = new Date().toISOString();
  await ctx.db.patch("companies", company._id, { judgeArchivedAt: at });
  // Stop any auto loop: a superseded generation ends the ingest and analyst ticks.
  const feed = await requireFeed(ctx, company._id);
  await ctx.db.patch("feeds", feed._id, {
    auto: false,
    autoGeneration: feed.autoGeneration + 1,
    autoTicksLeft: 0,
  });
  // And the simulated clock: a superseded generation ends its pending tick.
  const clock = await ctx.db
    .query("simClocks")
    .withIndex("by_companyId", (q) => q.eq("companyId", company._id))
    .unique();
  if (clock?.status === "playing")
    await ctx.db.patch("simClocks", clock._id, {
      status: "paused",
      generation: clock.generation + 1,
      pausedReason: "the sandbox company was reset",
      playStartedAt: null,
    });
  await writeLog(ctx, company._id, undefined, {
    actor: "person",
    action: "feed.judgeArchived",
    refs: [],
    agent: "mock.feed",
    tool: "judge.reset",
    summary: `${company.name} was reset and archived`,
  });
}

/** Plant, validate against the snapshot contract, save, log, then queue an ingest. */
async function inject(
  ctx: MutationCtx,
  companyId: Id<"companies">,
  kind: string,
  label: string,
  build: (served: ReturnType<typeof servedSnapshot>, overlay: Overlay, tag: string) => Planted,
) {
  const company = await requireJudge(ctx, companyId);
  const feed = await requireFeed(ctx, companyId);
  await requireAgentsStarted(ctx, companyId);
  if (feed.snapshotVersion < 1)
    throw bad(
      "The agents are still reading this company for the first time; try again in a few seconds",
      "NOT_READY",
    );
  const { row, world, overlay } = await requireWorld(ctx, companyId);
  const history = historyOf(overlay);
  const now = Date.now();
  const recent = history.filter((h) => now - Date.parse(h.at) < MINUTE_MS);
  if (recent.length >= JUDGE_LIMITS.submitsPerMinute) {
    const wait = Math.ceil((MINUTE_MS - (now - Date.parse(recent[0]?.at ?? ""))) / 1000);
    throw bad(
      `At most ${JUDGE_LIMITS.submitsPerMinute} changes a minute. Try again in ${Math.max(1, wait)} s.`,
      "RATE_LIMITED",
    );
  }
  const tag = `${company.judgeNumber ?? 0}_${history.length + 1}`;
  let planted: Planted;
  try {
    planted = build(servedSnapshot(world, overlay), overlay, tag);
    // The mock sources must still serve a contract-valid snapshot.
    servedSnapshot(world, planted.overlay);
  } catch (error) {
    if (error instanceof ConvexError) throw error;
    if (error instanceof JudgeInputError) throw bad(error.message);
    throw bad(
      `That change would break the data contract: ${(error as Error).message.slice(0, 300)}`,
    );
  }
  const at = new Date(now).toISOString();
  const entry: JudgeHistoryEntry = {
    at,
    version: feed.snapshotVersion,
    kind,
    label,
    summary: planted.summary,
    refs: planted.refs.slice(0, 64),
  };
  await ctx.db.patch("feedWorlds", row._id, {
    overlay: { ...planted.overlay, history: [...history, entry].slice(-200) },
  });
  await writeLog(ctx, companyId, undefined, {
    actor: "person",
    action: "feed.judgeScenario",
    refs: [kind, ...planted.refs],
    agent: "mock.feed",
    tool: "judge.inject",
    summary: `${label}: ${planted.summary} (simulated data)`,
  });
  await writeLog(ctx, companyId, undefined, {
    actor: "person",
    action: "ingest.requested",
    refs: [],
    agent: AGENT,
    summary: "Ingest requested after a judge scenario",
  });
  await ctx.scheduler.runAfter(0, internal.fieldJobs.ingestRun, { companyId, trigger: "judge" });
  return { refs: planted.refs, summary: planted.summary };
}

export const companies = query({
  args: {},
  handler: async (ctx) => {
    const out = [];
    for (const c of await judgeCompanies(ctx)) {
      if (c.judgeArchivedAt) continue;
      out.push({
        companyId: c._id,
        name: c.name,
        number: c.judgeNumber ?? 0,
        profile: await profileOf(ctx, c._id),
      });
    }
    return out;
  },
});

export const state = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const company = await ctx.db.get("companies", companyId);
    if (!company?.judge) return null;
    const feed = await requireFeed(ctx, companyId);
    const worldRow = await ctx.db
      .query("feedWorlds")
      .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
      .unique();
    const history = historyOf((worldRow?.overlay ?? {}) as Overlay);
    const approvals = await ctx.db
      .query("approvals")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(50);
    const decisionRows = approvals.filter((a) => a.branchId === ESCALATION_BRANCH);
    // Recent log rows only: a decision is logged in the same transaction as its approval.
    const recentLog = await ctx.db
      .query("log")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(400);
    const loggedApprovals = new Set(
      recentLog.filter((r) => r.action.startsWith("escalation.")).flatMap((r) => r.refs),
    );
    const decisions = [];
    for (const a of decisionRows) {
      const finding = await ctx.db
        .query("findings")
        .withIndex("by_companyId_and_findingId", (q) =>
          q.eq("companyId", companyId).eq("findingId", a.fixId),
        )
        .first();
      decisions.push({
        approvalId: a._id,
        findingId: a.fixId,
        decision: a.decision,
        by: a.by,
        at: a.at,
        note: a.note,
        summary: finding?.summary ?? "",
        kind: finding?.kind ?? null,
        refs: finding?.refs ?? [],
        logged: loggedApprovals.has(a._id),
      });
    }
    const active = (await judgeCompanies(ctx)).filter((c) => !c.judgeArchivedAt).length;
    const now = Date.now();
    const archived = company.judgeArchivedAt !== undefined;
    return {
      companyId,
      name: company.name,
      number: company.judgeNumber ?? 0,
      profile: await profileOf(ctx, companyId),
      sources: await sourcesOf(ctx, companyId),
      archived,
      agentsStarted: (await agentsStatus(ctx, company)).started,
      asOf: company.today,
      snapshotVersion: feed.snapshotVersion,
      lastSnapshotAt: feed.lastSnapshotAt,
      lastIngestStatus: feed.lastIngestStatus,
      history,
      checklist: judgeChecklist({
        started: !archived,
        scenarioVersions: history.map((h) => h.version ?? 0),
        snapshotVersion: feed.snapshotVersion,
        decisions: decisions.length,
        decisionLogged: decisions.some((d) => d.logged),
      }),
      decisions,
      limits: {
        perMinute: JUDGE_LIMITS.submitsPerMinute,
        usedThisMinute: history.filter((h) => now - Date.parse(h.at) < MINUTE_MS).length,
        activeCompanies: active,
        maxCompanies: JUDGE_LIMITS.activeCompanies,
      },
    };
  },
});

export const customers = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const company = await ctx.db.get("companies", companyId);
    if (!company?.judge) return [];
    const { world, overlay } = await requireWorld(ctx, companyId);
    return rankCustomers(servedSnapshot(world, overlay), 200);
  },
});

export const start = mutation({
  args: { profile: v.optional(profileArg), sources: v.optional(v.array(v.string())) },
  handler: async (ctx, { profile, sources }) => startJudge(ctx, profile ?? "kestrel", sources),
});

/** Archive and start a fresh one with the same profile and the same data sources. */
export const reset = mutation({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const company = await requireJudge(ctx, companyId);
    const profile = (await profileOf(ctx, companyId)) ?? "kestrel";
    const sources: JudgeSource[] = await sourcesOf(ctx, companyId);
    const wasStarted = await agentsStarted(ctx, companyId);
    await archive(ctx, company);
    return startJudge(ctx, profile, sources, wasStarted);
  },
});

/** Archive without a replacement (the judge goes back to pick another company). */
export const leave = mutation({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    await archive(ctx, await requireJudge(ctx, companyId));
    return null;
  },
});

/** One of the three preset surprises, planted like a scenario (same checks and rate limit). */
export const surprise = mutation({
  args: { companyId: v.id("companies"), preset: presetArg },
  handler: async (ctx, { companyId, preset }) => {
    await requireJudge(ctx, companyId);
    const on = await sourcesOf(ctx, companyId);
    const missing = SURPRISE_NEEDS[preset].filter((t) => !on.includes(t));
    if (missing.length > 0)
      throw bad(
        `Connect ${missing.map((t) => toolInfo(t).name).join(" and ")} to try this surprise`,
        "NEEDS_SOURCE",
      );
    const label = SURPRISE_LABEL[preset].title;
    return inject(ctx, companyId, `surprise:${preset}`, label, (served, overlay, tag) =>
      preset === "vendor_bank_change"
        ? plantVendorBankChange(served, overlay, tag)
        : plantScenario(served, overlay, surpriseScenario(preset, served), tag),
    );
  },
});

export const submitScenario = mutation({
  args: { companyId: v.id("companies"), scenario: scenarioArg },
  handler: async (ctx, { companyId, scenario }) => {
    const parsed = ScenarioSchema.safeParse(scenario);
    if (!parsed.success) throw bad(zodMessage(parsed.error));
    const s = parsed.data;
    return inject(ctx, companyId, s.kind, SCENARIO_LABEL[s.kind], (served, overlay, tag) =>
      plantScenario(served, overlay, s, tag),
    );
  },
});

export const importCsv = mutation({
  args: {
    companyId: v.id("companies"),
    kind: csvKind,
    rows: v.array(v.record(v.string(), v.string())),
  },
  handler: async (ctx, { companyId, kind, rows }) => {
    if (rows.length === 0) throw bad("No rows to import");
    if (rows.length > JUDGE_LIMITS.csvRows)
      throw bad(`At most ${JUDGE_LIMITS.csvRows} rows per upload`);
    const rejected: { line: number; errors: string[] }[] = [];
    let accepted = 0;
    const result = await inject(
      ctx,
      companyId,
      `csv:${kind}`,
      `CSV ${CSV_LABEL[kind]}`,
      (served, overlay, tag) => {
        const checked = validateCsvRows(kind, rows, {
          asOf: served.asOf,
          customerIds: new Set(served.customers.map((c) => c.id)),
        });
        const entries: CsvEntry[] = [];
        for (const r of checked) {
          if (r.entry) entries.push(r.entry);
          else rejected.push({ line: r.line, errors: r.errors });
        }
        if (entries.length === 0)
          throw new ConvexError({
            code: "INVALID_ROWS",
            message: "No valid rows to import",
            rejected,
          });
        accepted = entries.length;
        return plantCsv(overlay, entries, tag);
      },
    );
    return { accepted, rejected, refs: result.refs };
  },
});
