/**
 * Simulated clock (public). Plays a company's mock world day by day so entries arrive on their
 * own and the agents react as they land. Each tick: move the world one day with the pure
 * day-by-day simulator and fire that day's storyline beats (lib/clock.ts, lib/storylines.ts),
 * then, if the sources now serve anything new, run the ingestion agent at once (mapping, Nessie
 * bank posting, audit, forecast recompute). A tick with a scripted event, a new flag or a
 * dashboard verdict change asks the analyst for a run (model steps per the usual budgets); a
 * routine day's snapshot version is marked quiet so no model is called for it, and a day with
 * no new entries ingests nothing at all. Synthetic data only; nothing moves money.
 *
 * Bounds: one tick at a time per company (tickStartedAt lease); a play session pauses itself
 * after 13 simulated weeks or 60 minutes of wall time. Speeds: 1x = one simulated day per 6 s,
 * 5x, 20x (a slow ingest stretches the interval rather than overlapping ticks).
 *
 * Queries
 *   fieldClock.status({ companyId }) -> { status: "playing"|"paused", speed, day, date,
 *     originDate, pausedReason, lastSummary, ticking, sessionDaysLeft, supported,
 *     nextEvent: { day, inDays, title } | null, fired: [{ day, date, title, summary }] }
 * Mutations
 *   fieldClock.play({ companyId, speed? })   fieldClock.pause({ companyId })
 *   (play and jump fail with AGENTS_IDLE until fieldAgents.start)
 *   fieldClock.setSpeed({ companyId, speed: 1|5|20 })
 *   fieldClock.jump({ companyId })   move to the day before the next scripted event, then ingest
 */
import {
  CompanyModelSchema,
  ConstraintSchema,
  SnapshotSchema,
  type WorldState,
} from "@domino/contracts";
import { ConvexError, v } from "convex/values";
import { deriveDashboard } from "../components/field/dashboard/derive";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type MutationCtx,
  type QueryCtx,
  internalAction,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { requireAgentsStarted } from "./fieldAgents";
import type { Overlay } from "./fieldFeed";
import { type IngestResult, requireFeed, requireWorld, runIngest, writeLog } from "./fieldJobs";
import { deliverEvents } from "./fieldWebhooks";
import {
  SESSION_MAX_DAYS,
  type Speed,
  entriesText,
  intervalMs,
  isSpeed,
  pauseReason,
  profileOfWorld,
  stepDays,
  supportsDayClock,
} from "./lib/clock";
import { daysBetween, nextBeat } from "./lib/storylines";
import { type OutgoingEvent, vendorEvents } from "./lib/vendorWebhooks";

export const CLOCK_AGENT = "sim.clock";
/** A tick holding the lease longer than this is treated as dead. */
const TICK_LEASE_MS = 120_000;
/** An analyst run that started this recently and is still running blocks a new one. */
const ANALYST_STALE_MS = 5 * 60_000;
/** A requested analyst run that has not started within this is assumed lost. */
const ANALYST_START_MS = 10_000;
const FLUSH_MS = 3_000;
const FLUSH_MAX_TRIES = 120;
/** Every 7th simulated day gets a routine (model-free) analyst review. */
const REVIEW_EVERY_DAYS = 7;
const QUIET_KEEP = 200;
const speedArg = v.union(v.literal(1), v.literal(5), v.literal(20));

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

async function clockOf(ctx: Pick<QueryCtx, "db">, companyId: Id<"companies">) {
  return ctx.db
    .query("simClocks")
    .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
    .unique();
}

/** The clock row, created paused on first use with day 0 = the world's current date. */
async function ensureClock(ctx: MutationCtx, companyId: Id<"companies">) {
  const existing = await clockOf(ctx, companyId);
  if (existing) return existing;
  await requireFeed(ctx, companyId);
  const { world } = await requireWorld(ctx, companyId);
  const id = await ctx.db.insert("simClocks", {
    companyId,
    status: "paused",
    speed: 1,
    generation: 0,
    originDate: world.today,
    day: 0,
    date: world.today,
    sessionStartDay: 0,
    playStartedAt: null,
    tickStartedAt: null,
    ticks: 0,
    lastTickAt: null,
    pausedReason: null,
    lastSummary: null,
    lastRating: null,
    quietScopes: [],
    analystPending: false,
    analystRequestedAt: null,
  });
  return (await ctx.db.get("simClocks", id)) as Doc<"simClocks">;
}

const clockLog = (
  ctx: MutationCtx,
  companyId: Id<"companies">,
  action: string,
  summary: string,
  refs: string[] = [],
  actor: "person" | "engine" = "engine",
) => writeLog(ctx, companyId, undefined, { actor, action, refs, agent: CLOCK_AGENT, summary });

async function pauseClock(ctx: MutationCtx, clock: Doc<"simClocks">, reason: string) {
  await ctx.db.patch("simClocks", clock._id, {
    status: "paused",
    generation: clock.generation + 1,
    pausedReason: reason,
    playStartedAt: null,
  });
  await clockLog(ctx, clock.companyId, "clock.paused", `Simulated time paused: ${reason}`);
}

export const status = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const clock = await clockOf(ctx, companyId);
    const row = await ctx.db
      .query("feedWorlds")
      .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
      .unique();
    if (!row) return null;
    const world = row.world as WorldState;
    const overlay = row.overlay as Overlay;
    const profile = profileOfWorld(world);
    const origin = clock?.originDate ?? world.today;
    const day = daysBetween(origin, world.today);
    const next = nextBeat(profile, overlay.story);
    return {
      supported: supportsDayClock(world),
      status: clock?.status ?? ("paused" as const),
      speed: (clock?.speed ?? 1) as Speed,
      day,
      date: world.today,
      originDate: origin,
      pausedReason: clock?.pausedReason ?? null,
      lastSummary: clock?.lastSummary ?? null,
      ticking: clock?.tickStartedAt != null,
      sessionDaysLeft: clock
        ? Math.max(0, SESSION_MAX_DAYS - (day - clock.sessionStartDay))
        : SESSION_MAX_DAYS,
      nextEvent: next ? { day: next.day, inDays: next.day - day, title: next.title } : null,
      fired: (overlay.story?.fired ?? []).map((f) => ({
        day: f.day,
        date: f.date,
        title: f.title,
        summary: f.summary,
      })),
    };
  },
});

export const play = mutation({
  args: { companyId: v.id("companies"), speed: v.optional(speedArg) },
  handler: async (ctx, { companyId, speed }) => {
    await requireAgentsStarted(ctx, companyId);
    const clock = await ensureClock(ctx, companyId);
    const { world } = await requireWorld(ctx, companyId);
    if (!supportsDayClock(world))
      throw new ConvexError({ code: "UNSUPPORTED", message: "This company only moves by weeks" });
    if (clock.status === "playing") return { status: "playing" as const };
    const day = daysBetween(clock.originDate, world.today);
    const generation = clock.generation + 1;
    const next = {
      status: "playing" as const,
      speed: speed ?? clock.speed,
      generation,
      day,
      date: world.today,
      sessionStartDay: day,
      playStartedAt: Date.now(),
      pausedReason: null,
    };
    const reason = pauseReason({ ...next, now: Date.now() });
    if (reason) throw new ConvexError({ code: "LIMIT", message: `Cannot play: ${reason}` });
    await ctx.db.patch("simClocks", clock._id, next);
    await clockLog(
      ctx,
      companyId,
      "clock.played",
      `Simulated time playing at ${next.speed}x from ${world.today} (day ${day}); pauses itself after 13 simulated weeks or 60 minutes`,
      [],
      "person",
    );
    await ctx.scheduler.runAfter(0, internal.fieldClock.tick, { companyId, generation });
    return { status: "playing" as const };
  },
});

export const pause = mutation({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const clock = await clockOf(ctx, companyId);
    if (!clock || clock.status === "paused") return { status: "paused" as const };
    await pauseClock(ctx, clock, "by a person");
    return { status: "paused" as const };
  },
});

export const setSpeed = mutation({
  args: { companyId: v.id("companies"), speed: speedArg },
  handler: async (ctx, { companyId, speed }) => {
    const clock = await ensureClock(ctx, companyId);
    if (clock.speed === speed) return null;
    // A new generation so the pending tick at the old interval stops; the new one starts now
    // unless a tick is in flight (its settle schedules the next one at the new speed).
    const generation = clock.generation + 1;
    await ctx.db.patch("simClocks", clock._id, { speed, generation });
    if (clock.status === "playing")
      await ctx.scheduler.runAfter(0, internal.fieldClock.tick, { companyId, generation });
    return null;
  },
});

/** Move straight to the day before the next scripted event, then ingest what arrived. */
export const jump = mutation({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    await requireAgentsStarted(ctx, companyId);
    const clock = await ensureClock(ctx, companyId);
    const { row, world, overlay } = await requireWorld(ctx, companyId);
    const profile = profileOfWorld(world);
    if (!profile)
      throw new ConvexError({ code: "UNSUPPORTED", message: "This company only moves by weeks" });
    if (clock.tickStartedAt !== null && Date.now() - clock.tickStartedAt < TICK_LEASE_MS)
      throw new ConvexError({ code: "BUSY", message: "A simulated day is being processed" });
    const day = daysBetween(clock.originDate, world.today);
    const next = nextBeat(profile, overlay.story);
    if (!next) throw new ConvexError({ code: "NO_EVENT", message: "No scripted events left" });
    const days = next.day - 1 - day;
    if (days < 1) return { day, jumped: 0 };
    const step = stepDays(world, overlay, clock.originDate, days);
    await ctx.db.replace("feedWorlds", row._id, {
      companyId,
      world: plain(step.world),
      overlay: plain(step.overlay),
    });
    const feed = await requireFeed(ctx, companyId);
    await ctx.db.patch("feeds", feed._id, { week: step.world.week });
    const summary = `Jumped ${days} simulated days to ${step.world.today}, the day before "${next.title}"`;
    await ctx.db.patch("simClocks", clock._id, {
      day: step.day,
      date: step.world.today,
      lastSummary: summary,
      lastTickAt: new Date().toISOString(),
    });
    await clockLog(ctx, companyId, "clock.jumped", summary, step.entries.refs, "person");
    await ctx.scheduler.runAfter(0, internal.fieldJobs.ingestRun, { companyId, trigger: "clock" });
    return { day: step.day, jumped: days };
  },
});

/** Claims the tick lease and moves the world one day. null = this tick should stop. */
export const claimTick = internalMutation({
  args: { companyId: v.id("companies"), generation: v.number() },
  handler: async (ctx, { companyId, generation }) => {
    const clock = await clockOf(ctx, companyId);
    if (!clock || clock.status !== "playing" || clock.generation !== generation) return null;
    const now = Date.now();
    if (clock.tickStartedAt !== null && now - clock.tickStartedAt < TICK_LEASE_MS) return null;
    const { row, world, overlay } = await requireWorld(ctx, companyId);
    const day = daysBetween(clock.originDate, world.today);
    const reason = supportsDayClock(world)
      ? pauseReason({ ...clock, day, now })
      : "this company only moves by weeks";
    if (reason) {
      await pauseClock(ctx, clock, reason);
      return null;
    }
    const step = stepDays(world, overlay, clock.originDate);
    await ctx.db.replace("feedWorlds", row._id, {
      companyId,
      world: plain(step.world),
      overlay: plain(step.overlay),
    });
    const feed = await requireFeed(ctx, companyId);
    if (feed.week !== step.world.week)
      await ctx.db.patch("feeds", feed._id, { week: step.world.week });
    const summary = `Day ${step.day}, ${entriesText(step.world.today, step.entries)}`;
    await writeLog(ctx, companyId, undefined, {
      actor: "connector",
      action: "clock.day",
      refs: step.entries.refs,
      agent: CLOCK_AGENT,
      tool: "sim.advanceDay",
      source: "mock",
      summary,
    });
    for (const f of step.fired)
      await clockLog(ctx, companyId, "clock.event", `${f.title}: ${f.summary}`, [f.beatId]);
    await ctx.db.patch("simClocks", clock._id, {
      day: step.day,
      date: step.world.today,
      tickStartedAt: now,
      ticks: clock.ticks + 1,
      lastTickAt: new Date(now).toISOString(),
      lastSummary: summary,
    });
    return {
      startedAt: now,
      day: step.day,
      entries: step.entries.total,
      fired: step.fired.map((f) => f.title),
      events: vendorEvents(step.served.before, step.served.after, step.world.today),
    };
  },
});

/** Dashboard rating of the latest snapshot ("ok" | "watch" | "at_risk"), or null. */
async function currentRating(ctx: Pick<QueryCtx, "db">, companyId: Id<"companies">) {
  const feed = await requireFeed(ctx, companyId);
  const row = feed.lastSnapshotId ? await ctx.db.get("snapshots", feed.lastSnapshotId) : null;
  const model = await ctx.db
    .query("models")
    .withIndex("by_company_version", (q) => q.eq("companyId", companyId))
    .order("desc")
    .first();
  if (!row || !model) return null;
  const constraints = await ctx.db
    .query("constraints")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .take(50);
  const r = deriveDashboard({
    snapshot: SnapshotSchema.parse(row.data),
    model: CompanyModelSchema.parse(model.data),
    constraints: constraints.map((c) => ConstraintSchema.parse(c.data)),
  });
  return r.ok ? r.view.health.rating : null;
}

/** True while an analyst run is going, or was requested and has not started yet. */
async function analystBusy(ctx: Pick<QueryCtx, "db">, clock: Doc<"simClocks">, now: number) {
  const last = await ctx.db
    .query("analystRuns")
    .withIndex("by_companyId", (q) => q.eq("companyId", clock.companyId))
    .order("desc")
    .first();
  const started = last ? Date.parse(last.startedAt) : 0;
  if (last?.status === "running" && now - started < ANALYST_STALE_MS) return true;
  const requested = clock.analystRequestedAt;
  return requested !== null && started < requested && now - requested < ANALYST_START_MS;
}

/**
 * Ask for one analyst run now, or queue it behind the one that is still going. Only meaningful
 * requests queue (so a pending run always stands for an event); a routine review is skipped.
 */
async function requestAnalyst(
  ctx: MutationCtx,
  clock: Doc<"simClocks">,
  reason: string,
  queue = true,
) {
  const now = Date.now();
  if (await analystBusy(ctx, clock, now)) {
    if (queue && !clock.analystPending) {
      await ctx.db.patch("simClocks", clock._id, { analystPending: true });
      await clockLog(
        ctx,
        clock.companyId,
        "clock.analystQueued",
        `The analyst is still working; queued a run for: ${reason}`,
      );
      await ctx.scheduler.runAfter(FLUSH_MS, internal.fieldClock.flushAnalyst, {
        companyId: clock.companyId,
        tries: 0,
      });
    }
    return;
  }
  await ctx.db.patch("simClocks", clock._id, { analystPending: false, analystRequestedAt: now });
  await clockLog(
    ctx,
    clock.companyId,
    "clock.analystRequested",
    `Asked the analyst to run: ${reason}`,
  );
  await ctx.scheduler.runAfter(0, internal.fieldAnalyst.afterIngest, {
    companyId: clock.companyId,
    changed: true,
  });
}

/**
 * fieldAnalyst.finish's catch-up run defers to the clock: none while a clock run is queued
 * (flushAnalyst starts it) or when every version since the finished run was a routine day.
 * Otherwise (a manual or fallback ingest landed while the analyst was busy) the newest version
 * stops being quiet, so the catch-up run gets its model steps. Without a clock: always.
 */
export async function wantsCatchUp(
  ctx: MutationCtx,
  companyId: Id<"companies">,
  ranVersion: number,
  newestVersion: number,
) {
  const clock = await clockOf(ctx, companyId);
  if (!clock) return true;
  if (clock.analystPending) return false;
  const quiet = new Set(clock.quietScopes);
  let meaningful = false;
  for (let n = ranVersion + 1; n <= newestVersion && !meaningful; n++)
    meaningful = !quiet.has(`v${n}`);
  if (!meaningful) return false;
  const scope = `v${newestVersion}`;
  if (quiet.has(scope))
    await ctx.db.patch("simClocks", clock._id, {
      quietScopes: clock.quietScopes.filter((s) => s !== scope),
    });
  return true;
}

export const flushAnalyst = internalMutation({
  args: { companyId: v.id("companies"), tries: v.number() },
  handler: async (ctx, { companyId, tries }) => {
    const clock = await clockOf(ctx, companyId);
    if (!clock?.analystPending) return null;
    if (await analystBusy(ctx, clock, Date.now())) {
      if (tries < FLUSH_MAX_TRIES)
        await ctx.scheduler.runAfter(FLUSH_MS, internal.fieldClock.flushAnalyst, {
          companyId,
          tries: tries + 1,
        });
      else await ctx.db.patch("simClocks", clock._id, { analystPending: false });
      return null;
    }
    // The queued run stands for an event that landed on an earlier version: the version it will
    // run on may have been a routine day, so it is no longer quiet.
    const feed = await requireFeed(ctx, companyId);
    const scope = `v${feed.snapshotVersion}`;
    if (clock.quietScopes.includes(scope))
      await ctx.db.patch("simClocks", clock._id, {
        quietScopes: clock.quietScopes.filter((s) => s !== scope),
      });
    await requestAnalyst(ctx, clock, "a queued simulated event");
    return null;
  },
});

/** Releases the lease, decides what the day was worth, schedules the next tick. */
export const settleTick = internalMutation({
  args: {
    companyId: v.id("companies"),
    generation: v.number(),
    startedAt: v.number(),
    day: v.number(),
    fired: v.array(v.string()),
    ingest: v.union(
      v.null(),
      v.object({
        changed: v.boolean(),
        version: v.optional(v.number()),
        newFindings: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { companyId, generation, startedAt, day, fired, ingest } = args;
    const clock = await clockOf(ctx, companyId);
    if (!clock) return null;
    await ctx.db.patch("simClocks", clock._id, { tickStartedAt: null });
    if (ingest?.changed && ingest.version !== undefined) {
      const rating = await currentRating(ctx, companyId);
      const verdict = rating !== null && clock.lastRating !== null && rating !== clock.lastRating;
      const reasons = [
        fired.length > 0 && `scripted event (${fired.join("; ")})`,
        (ingest.newFindings ?? 0) > 0 && `${ingest.newFindings} new flag(s)`,
        verdict && `verdict changed from ${clock.lastRating} to ${rating}`,
      ].filter((r): r is string => typeof r === "string");
      const scope = `v${ingest.version}`;
      await ctx.db.patch("simClocks", clock._id, {
        lastRating: rating,
        ...(reasons.length === 0 && {
          quietScopes: [...clock.quietScopes, scope].slice(-QUIET_KEEP),
        }),
      });
      const fresh = (await clockOf(ctx, companyId)) as Doc<"simClocks">;
      if (reasons.length > 0) await requestAnalyst(ctx, fresh, reasons.join(", "));
      else if (day % REVIEW_EVERY_DAYS === 0)
        await requestAnalyst(
          ctx,
          fresh,
          `weekly review on day ${day} (routine, no model call)`,
          false,
        );
    }
    const now = await clockOf(ctx, companyId);
    if (now?.status === "playing" && now.generation === generation) {
      const wait = Math.max(
        0,
        intervalMs(isSpeed(now.speed) ? now.speed : 1) - (Date.now() - startedAt),
      );
      await ctx.scheduler.runAfter(wait, internal.fieldClock.tick, { companyId, generation });
    }
    return null;
  },
});

export const tick = internalAction({
  args: { companyId: v.id("companies"), generation: v.number() },
  handler: async (ctx, { companyId, generation }) => {
    const claim: {
      startedAt: number;
      day: number;
      entries: number;
      fired: string[];
      events: OutgoingEvent[];
    } | null = await ctx.runMutation(internal.fieldClock.claimTick, { companyId, generation });
    if (!claim) return null;
    let ingest: IngestResult | null = null;
    try {
      // Event driven: the vendors post their webhooks for the day's new records (signed, to the
      // site URL; fieldWebhooks.ts), then the agent reads the sources at once. Events landing
      // while this lease is held join this read instead of queueing another. A day with nothing
      // new (often a weekend) ingests nothing and so triggers no agent at all.
      if (claim.entries > 0 || claim.fired.length > 0) {
        await deliverEvents(ctx, companyId, claim.events).catch(() => null);
        ingest = await runIngest(ctx, companyId, "clock", { analyst: false });
      }
    } finally {
      await ctx.runMutation(internal.fieldClock.settleTick, {
        companyId,
        generation,
        startedAt: claim.startedAt,
        day: claim.day,
        fired: claim.fired,
        ingest: ingest
          ? ingest.changed
            ? { changed: true, version: ingest.version, newFindings: ingest.newFindings }
            : { changed: false }
          : null,
      });
    }
    return null;
  },
});
