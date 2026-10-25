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
import { ConvexError, type Infer, v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type MutationCtx,
  type QueryCtx,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { createFeedCompany } from "./field";
import { agentsStatus } from "./fieldAgents";
import { CLOCK_AGENT, ensureClock } from "./fieldClock";
import { requireFeed, requireWorld, runIngest, writeLog } from "./fieldJobs";
import { stepDays } from "./lib/clock";

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
    // The newest copy of each demo state is always offered as well, so it can be reused.
    const listed = new Set(
      [...replays.values()].flatMap((rows) => {
        const newest = rows.sort((a, b) => b._creationTime - a._creationTime);
        return [
          ...newest.slice(0, REPLAYS_LISTED),
          ...DEMO_KINDS.flatMap((kind) => newest.find((r) => r.demoState?.kind === kind) ?? []),
        ].map((row) => row._id);
      }),
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
          demoState: row.demoState ?? null,
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
    await ctx.db.patch("companies", created, { replayOf: original, name, demoState: freshState() });
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

/*
 * Demo states (header toggle). Both are NEW copies; existing companies are never changed.
 *   "fresh"     an idle copy with nothing read (same path as replay): press Start agents and
 *               watch the Brain map build everything live.
 *   "upToDate"  a prepared baseline copy whose agents are started at once and then played
 *               forward UP_TO_DATE_WEEKS simulated weeks for real (ingest, audit, analyst,
 *               auto forecast runs and domino effects; model calls under the usual budgets),
 *               with a short decision history: flags dismissed with reasons (learned rules)
 *               and one fix accepted. Built once, then reused until someone rebuilds it.
 *
 * Mutations
 *   fieldOperating.openDemoState({ companyId, kind, rebuild? })
 *     -> { companyId, name, scenario, created }
 */
const DEMO_KINDS = ["fresh", "upToDate"] as const;
const demoKindArg = v.union(v.literal("fresh"), v.literal("upToDate"));
type DemoKind = Infer<typeof demoKindArg>;
type DemoState = NonNullable<Doc<"companies">["demoState"]>;

const UP_TO_DATE_WEEKS = 8;
/** Longest wait for one week's analyst run before the build moves on. */
const ANALYST_WAIT_MS = 45_000;
/** Longest wait for the advisor's fixes on the week a fix is accepted. */
const SUGGESTION_WAIT_MS = 20_000;
const POLL_MS = 2_000;
/** A build whose progress has not moved for this long is treated as dead and not reused. */
const BUILD_STALE_MS = 5 * 60_000;
/** A flag is dismissed once each of these weeks is reached; the fix is accepted at the last. */
const DISMISS_AT_WEEKS = [3, 5];
const ACCEPT_AT_WEEK = 7;
const BUILD_AGENT = "demo.builder";

const DISMISS_NOTE: Record<Doc<"findings">["kind"], string> = {
  duplicate:
    "Not a duplicate: this vendor invoices the contract in two installments on the same day.",
  conflict: "Reconciled with the books: the difference is a timing entry that clears next week.",
  unusual_amount: "Expected: the annual renewal is billed this month and was in the budget.",
  unusual_timing: "Expected: this customer pays at quarter end under its contract terms.",
  missing_expected: "Known: billing for this line was paused for the period, agreed in advance.",
};
const ACCEPT_NOTE: Record<Doc<"suggestions">["fix"]["kind"], string> = {
  credit_line_draw: "Approved: the draw stays within the lender's limit; finance will schedule it.",
  delay_bill: "Approved: the vendor agreed to the later payment date.",
  accelerate_collections: "Approved: finance will follow up on the open invoices this week.",
  defer_hires: "Approved: the hiring plan moves one quarter, agreed with the team leads.",
};

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const nowIso = () => new Date().toISOString();
const freshState = (): DemoState => ({
  kind: "fresh",
  status: "ready",
  week: 0,
  weeks: 0,
  updatedAt: nowIso(),
});
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The newest copy of this state that can be shown again: fresh = never started; up to date =
 * ready, or still building and making progress. */
async function reusableCopy(ctx: Pick<QueryCtx, "db">, selection: Selection, kind: DemoKind) {
  const rows = (await rowsOf(ctx, selection))
    .filter((row) => row.demoState?.kind === kind && !row.judgeArchivedAt)
    .sort((a, b) => b._creationTime - a._creationTime)
    .slice(0, REPLAYS_LISTED);
  for (const row of rows) {
    const state = row.demoState as DemoState;
    if (kind === "fresh") {
      if (!(await agentsStatus(ctx, row)).started) return row;
      continue;
    }
    if (state.status === "ready") return row;
    if (state.status === "building" && Date.now() - Date.parse(state.updatedAt) < BUILD_STALE_MS)
      return row;
  }
  return null;
}

export const openDemoState = mutation({
  args: { companyId: v.id("companies"), kind: demoKindArg, rebuild: v.optional(v.boolean()) },
  handler: async (ctx, { companyId, kind, rebuild }) => {
    const company = await ctx.db.get("companies", companyId);
    const selection = company?.operatingDemo;
    if (!company || !selection)
      throw new ConvexError({ code: "NOT_FOUND", message: "No such operating company" });
    const pick: Selection = {
      company: selection.company,
      scenario: kind === "fresh" ? selection.scenario : "baseline",
    };
    if (!rebuild) {
      const reuse = await reusableCopy(ctx, pick, kind);
      if (reuse)
        return { companyId: reuse._id, name: reuse.name, scenario: pick.scenario, created: false };
    }
    const original =
      (await originalOf(ctx, pick))?._id ??
      (await createFeedCompany(ctx, 1, undefined, undefined, pick, { idle: true }));
    // Created idle either way: the up-to-date build runs its own first read, in order.
    const created = await createFeedCompany(ctx, 1, undefined, undefined, pick, { idle: true });
    const base = (await ctx.db.get("companies", original))?.name ?? company.name;
    const name = `${base} · ${kind === "fresh" ? "Fresh start" : "Up to date"}`;
    if (kind === "fresh") {
      await ctx.db.patch("companies", created, {
        replayOf: original,
        name,
        demoState: freshState(),
      });
      return { companyId: created, name, scenario: pick.scenario, created: true };
    }
    const at = nowIso();
    await ctx.db.patch("companies", created, {
      replayOf: original,
      name,
      agentsStartedAt: at,
      demoState: { kind, status: "building", week: 0, weeks: UP_TO_DATE_WEEKS, updatedAt: at },
    });
    await writeLog(ctx, created, undefined, {
      actor: "person",
      action: "demo.buildStarted",
      refs: ["agents.start"],
      agent: BUILD_AGENT,
      summary: `Preparing an up-to-date view: agents started, then ${UP_TO_DATE_WEEKS} simulated weeks played forward`,
    });
    await ctx.scheduler.runAfter(0, internal.fieldOperating.buildWeek, {
      companyId: created,
      week: 0,
      dismissed: 0,
      accepted: 0,
    });
    return { companyId: created, name, scenario: pick.scenario, created: true };
  },
});

async function setBuild(
  ctx: MutationCtx,
  companyId: Id<"companies">,
  patch: Pick<DemoState, "status" | "week"> & { error?: string },
) {
  const company = await ctx.db.get("companies", companyId);
  if (company?.demoState?.kind !== "upToDate") return;
  await ctx.db.patch("companies", companyId, {
    demoState: { ...company.demoState, ...patch, updatedAt: nowIso() },
  });
}

export const recordBuild = internalMutation({
  args: {
    companyId: v.id("companies"),
    week: v.number(),
    status: v.union(v.literal("building"), v.literal("ready"), v.literal("failed")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { companyId, week, status, error }) => {
    await setBuild(ctx, companyId, { week, status, ...(error && { error }) });
    if (status !== "building")
      await writeLog(ctx, companyId, undefined, {
        actor: "engine",
        action: status === "ready" ? "demo.buildDone" : "demo.buildFailed",
        refs: [],
        agent: BUILD_AGENT,
        summary:
          status === "ready"
            ? `Up-to-date view ready: ${week} simulated weeks played forward`
            : `Up-to-date view stopped at week ${week}: ${error ?? "unknown error"}`,
      });
    return null;
  },
});

/** Moves the world seven simulated days, as the clock would over a week. */
export const advanceWeek = internalMutation({
  args: { companyId: v.id("companies"), week: v.number() },
  handler: async (ctx, { companyId, week }) => {
    const clock = await ensureClock(ctx, companyId);
    if (clock.status === "playing")
      throw new ConvexError({ code: "BUSY", message: "Simulated time is playing" });
    const { row, world, overlay } = await requireWorld(ctx, companyId);
    const step = stepDays(world, overlay, clock.originDate, 7);
    await ctx.db.replace("feedWorlds", row._id, {
      companyId,
      world: plain(step.world),
      overlay: plain(step.overlay),
    });
    const feed = await requireFeed(ctx, companyId);
    if (feed.week !== step.world.week)
      await ctx.db.patch("feeds", feed._id, { week: step.world.week });
    const summary = `Moved 7 simulated days to ${step.world.today} (up-to-date view, week ${week} of ${UP_TO_DATE_WEEKS})`;
    await ctx.db.patch("simClocks", clock._id, {
      day: step.day,
      date: step.world.today,
      lastSummary: summary,
      lastTickAt: nowIso(),
    });
    await writeLog(ctx, companyId, undefined, {
      actor: "engine",
      action: "clock.jumped",
      refs: step.entries.refs,
      agent: CLOCK_AGENT,
      summary,
    });
    return null;
  },
});

/** True once the newest analyst run covers `version` and has finished. */
export const analystSettled = internalQuery({
  args: { companyId: v.id("companies"), version: v.number() },
  handler: async (ctx, { companyId, version }) => {
    const last = await ctx.db
      .query("analystRuns")
      .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
      .order("desc")
      .first();
    return last !== null && last.snapshotVersion >= version && last.status !== "running";
  },
});

/** Open flags to dismiss, lowest severity first, preferring kinds not dismissed yet. */
export const flagsToDismiss = internalQuery({
  args: { companyId: v.id("companies"), count: v.number() },
  handler: async (ctx, { companyId, count }) => {
    const byStatus = (status: "open" | "rejected") =>
      ctx.db
        .query("findings")
        .withIndex("by_companyId_and_status", (q) =>
          q.eq("companyId", companyId).eq("status", status),
        )
        .take(100);
    const done = new Set((await byStatus("rejected")).map((f) => f.kind));
    const rank = { low: 0, medium: 1, high: 2 } as const;
    return (await byStatus("open"))
      .sort(
        (a, b) =>
          Number(done.has(a.kind)) - Number(done.has(b.kind)) ||
          rank[a.severity] - rank[b.severity],
      )
      .slice(0, count)
      .map((f) => ({ findingId: f.findingId, kind: f.kind }));
  },
});

/** The fix to accept: an open suggestion on the current snapshot, recommended first. */
export const fixToAccept = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const feed = await requireFeed(ctx, companyId);
    const open = await ctx.db
      .query("suggestions")
      .withIndex("by_companyId_and_status_and_updatedAt", (q) =>
        q.eq("companyId", companyId).eq("status", "open"),
      )
      .order("desc")
      .take(50);
    const best = open
      .filter((s) => s.snapshotVersion === feed.snapshotVersion)
      .sort((a, b) => Number(b.recommended) - Number(a.recommended) || a.rank - b.rank)[0];
    return best
      ? {
          id: best.suggestionId,
          runId: best.runId,
          snapshotVersion: best.snapshotVersion,
          kind: best.fix.kind,
        }
      : null;
  },
});

const errorText = (error: unknown) => {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: unknown } | undefined;
    if (typeof data?.message === "string") return data.message;
  }
  return error instanceof Error ? error.message : "unknown error";
};

/**
 * One simulated week of the up-to-date build (week 0 = the first read). Each week is its own
 * action so the whole build stays far from the action time limit.
 */
export const buildWeek = internalAction({
  args: {
    companyId: v.id("companies"),
    week: v.number(),
    dismissed: v.number(),
    accepted: v.number(),
  },
  handler: async (ctx, { companyId, week, dismissed, accepted }) => {
    try {
      if (week > 0) await ctx.runMutation(internal.fieldOperating.advanceWeek, { companyId, week });
      const ingest = await runIngest(ctx, companyId, week === 0 ? "start" : "clock");
      if (week === 0 && !ingest.changed)
        throw new Error(`first read failed: ${("error" in ingest && ingest.error) || "no data"}`);
      if (ingest.changed) {
        const started = Date.now();
        while (
          Date.now() - started < ANALYST_WAIT_MS &&
          !(await ctx.runQuery(internal.fieldOperating.analystSettled, {
            companyId,
            version: ingest.version,
          }))
        )
          await sleep(POLL_MS);
      }
      // Decision history: a person's calls, made through the same mutations the UI uses.
      const toDismiss = DISMISS_AT_WEEKS.filter((w) => week >= w).length - dismissed;
      if (toDismiss > 0) {
        const flags = await ctx.runQuery(internal.fieldOperating.flagsToDismiss, {
          companyId,
          count: toDismiss,
        });
        for (const flag of flags) {
          // A flag decided meanwhile is skipped; the next week tries another.
          const done = await ctx
            .runMutation(api.field.decide, {
              companyId,
              findingId: flag.findingId,
              decision: "rejected",
              note: DISMISS_NOTE[flag.kind],
            })
            .then(
              () => true,
              () => false,
            );
          if (done) dismissed += 1;
        }
      }
      if (week >= ACCEPT_AT_WEEK && accepted === 0) {
        const started = Date.now();
        let fix = await ctx.runQuery(internal.fieldOperating.fixToAccept, { companyId });
        while (!fix && Date.now() - started < SUGGESTION_WAIT_MS) {
          await sleep(POLL_MS);
          fix = await ctx.runQuery(internal.fieldOperating.fixToAccept, { companyId });
        }
        if (fix)
          accepted = await ctx
            .runMutation(api.fieldSuggestions.decide, {
              companyId,
              id: fix.id,
              expectedRunId: fix.runId,
              expectedSnapshotVersion: fix.snapshotVersion,
              decision: "accepted",
              note: ACCEPT_NOTE[fix.kind],
            })
            .then(
              () => 1,
              () => 0,
            );
      }
      const last = week >= UP_TO_DATE_WEEKS;
      await ctx.runMutation(internal.fieldOperating.recordBuild, {
        companyId,
        week,
        status: last ? "ready" : "building",
      });
      if (!last)
        await ctx.scheduler.runAfter(0, internal.fieldOperating.buildWeek, {
          companyId,
          week: week + 1,
          dismissed,
          accepted,
        });
    } catch (error) {
      await ctx.runMutation(internal.fieldOperating.recordBuild, {
        companyId,
        week,
        status: "failed",
        error: errorText(error),
      });
    }
    return null;
  },
});
