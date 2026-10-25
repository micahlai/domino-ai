/**
 * Mock vendor webhooks (internal). The vendors push "something changed" events to the Convex
 * site URL (http.ts: POST /webhooks/<stripe|gusto|ramp|nessie>/<companyId>), signed with a
 * per-company, per-vendor secret kept only in vendorWebhookSecrets. An accepted event is logged
 * at once ("webhook.received", with its vendor as the source, so the brain map pulses that tool)
 * and starts one debounced ingest per company: a burst of events within DEBOUNCE_MS shares one
 * read of every tool. Polling stays as the fallback (auto-ingest, the simulated clock).
 *
 * The simulated clock is the sender: each simulated day it posts the events its new records
 * imply (lib/vendorWebhooks.vendorEvents), then runs that day's ingest itself, so an event that
 * lands while the day's ingest is starting joins it instead of queueing a second read. When the
 * site URL cannot be reached, delivery falls back to the same receive step in process.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  type MutationCtx,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { AGENT, requireFeed, runIngest, writeLog } from "./fieldJobs";
import {
  type OutgoingEvent,
  SIGNATURE_HEADER,
  VENDORS,
  VENDOR_NAME,
  type Vendor,
  parseVendorEvent,
  signWebhook,
} from "./lib/vendorWebhooks";

/** Events this close together share one ingest. */
export const DEBOUNCE_MS = 1_500;
/** A pending drain this far past due was lost (a failed action); the next event reschedules. */
const DRAIN_LOST_MS = 60_000;
/** Matches fieldClock's tick lease: a day's ingest holding it is about to read every tool. */
const CLOCK_LEASE_MS = 120_000;
const DELIVERY_TIMEOUT_MS = 5_000;

const vendorArg = v.union(...VENDORS.map((x) => v.literal(x)));

function newSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `whsec_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

async function secretsOf(ctx: Pick<MutationCtx, "db">, companyId: Id<"companies">) {
  const rows = await ctx.db
    .query("vendorWebhookSecrets")
    .withIndex("by_companyId_and_vendor", (q) => q.eq("companyId", companyId))
    .take(VENDORS.length);
  return new Map(rows.map((r) => [r.vendor, r.secret]));
}

/**
 * The company's signing secrets, created on first use. Internal only: the clock's sender and
 * `npx convex run` (for a manual signed delivery) read them; no client query exposes them.
 */
export const ensureSecrets = internalMutation({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    await requireFeed(ctx, companyId);
    const have = await secretsOf(ctx, companyId);
    const out: Record<string, string> = {};
    for (const vendor of VENDORS) {
      let secret = have.get(vendor);
      if (!secret) {
        secret = newSecret();
        await ctx.db.insert("vendorWebhookSecrets", {
          companyId,
          vendor,
          secret,
          createdAt: new Date().toISOString(),
        });
      }
      out[vendor] = secret;
    }
    return out as Record<Vendor, string>;
  },
});

/** The secret for one delivery's path, or null when the company or its secret is unknown. */
export const secretFor = internalQuery({
  args: { companyId: v.string(), vendor: vendorArg },
  handler: async (ctx, args) => {
    const companyId = ctx.db.normalizeId("companies", args.companyId);
    if (!companyId) return null;
    const row = await ctx.db
      .query("vendorWebhookSecrets")
      .withIndex("by_companyId_and_vendor", (q) =>
        q.eq("companyId", companyId).eq("vendor", args.vendor),
      )
      .unique();
    return row ? { companyId, secret: row.secret } : null;
  },
});

/**
 * Records one verified event (once per event id), logs it and starts or joins an ingest.
 * Returns what happened so the HTTP response can say it.
 */
export const receive = internalMutation({
  args: {
    companyId: v.id("companies"),
    vendor: vendorArg,
    eventId: v.string(),
    type: v.string(),
    summary: v.string(),
    refs: v.array(v.string()),
    transport: v.union(v.literal("http"), v.literal("internal")),
  },
  handler: async (ctx, args) => {
    const { companyId, vendor, eventId, transport } = args;
    await requireFeed(ctx, companyId);
    const seen = await ctx.db
      .query("vendorWebhookEvents")
      .withIndex("by_companyId_and_eventId", (q) =>
        q.eq("companyId", companyId).eq("eventId", eventId),
      )
      .first();
    if (seen) return { duplicate: true, status: seen.status };
    const now = Date.now();
    const clock = await ctx.db
      .query("simClocks")
      .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
      .unique();
    const joined = clock?.tickStartedAt != null && now - clock.tickStartedAt < CLOCK_LEASE_MS;
    const status = joined ? ("joined" as const) : ("queued" as const);
    await ctx.db.insert("vendorWebhookEvents", {
      companyId,
      vendor,
      eventId,
      type: args.type.slice(0, 64),
      summary: args.summary.slice(0, 300),
      refs: args.refs.slice(0, 16),
      transport,
      receivedAt: new Date(now).toISOString(),
      status,
    });
    if (!joined) await scheduleDrain(ctx, companyId, now);
    await writeLog(ctx, companyId, undefined, {
      actor: "connector",
      action: "webhook.received",
      refs: [eventId, ...args.refs].slice(0, 16),
      agent: AGENT,
      tool: `${vendor}.webhook`,
      source: vendor,
      summary: `${VENDOR_NAME[vendor]} webhook ${args.type}: ${args.summary}${
        transport === "internal" ? " (delivered in process)" : ""
      }; ${joined ? "the day's ingest reads it now" : "ingest starts now"}`,
    });
    return { duplicate: false, status };
  },
});

/** One pending drain per company: the first event of a burst schedules it, the rest ride on it. */
async function scheduleDrain(ctx: MutationCtx, companyId: Id<"companies">, now: number) {
  const inbox = await ctx.db
    .query("webhookInbox")
    .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
    .unique();
  if (inbox?.drainAt != null && inbox.drainAt > now - DRAIN_LOST_MS) return;
  const drainAt = now + DEBOUNCE_MS;
  if (inbox) await ctx.db.patch("webhookInbox", inbox._id, { drainAt });
  else await ctx.db.insert("webhookInbox", { companyId, drainAt });
  await ctx.scheduler.runAfter(DEBOUNCE_MS, internal.fieldWebhooks.drain, { companyId });
}

/** Takes every queued event for one ingest; an event arriving after this schedules the next. */
export const claimDrain = internalMutation({
  args: { companyId: v.id("companies"), runId: v.string() },
  handler: async (ctx, { companyId, runId }) => {
    const inbox = await ctx.db
      .query("webhookInbox")
      .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
      .unique();
    if (inbox) await ctx.db.patch("webhookInbox", inbox._id, { drainAt: null });
    const queued = await ctx.db
      .query("vendorWebhookEvents")
      .withIndex("by_companyId_and_status", (q) =>
        q.eq("companyId", companyId).eq("status", "queued"),
      )
      .take(200);
    for (const e of queued)
      await ctx.db.patch("vendorWebhookEvents", e._id, { status: "ingesting", runId });
    return [...new Set(queued.map((e) => e.vendor))];
  },
});

export const finishDrain = internalMutation({
  args: { companyId: v.id("companies"), runId: v.string(), ok: v.boolean() },
  handler: async (ctx, { companyId, runId, ok }) => {
    const rows = await ctx.db
      .query("vendorWebhookEvents")
      .withIndex("by_companyId_and_status", (q) =>
        q.eq("companyId", companyId).eq("status", "ingesting"),
      )
      .take(200);
    for (const e of rows)
      if (e.runId === runId)
        await ctx.db.patch("vendorWebhookEvents", e._id, { status: ok ? "ingested" : "failed" });
    return null;
  },
});

/** The debounced ingest a burst of webhooks started. */
export const drain = internalAction({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const runId = `webhook-${Date.now().toString(36)}`;
    const vendors: Vendor[] = await ctx.runMutation(internal.fieldWebhooks.claimDrain, {
      companyId,
      runId,
    });
    if (vendors.length === 0) return null;
    const result = await runIngest(ctx, companyId, `webhook: ${vendors.join(", ")}`);
    await ctx.runMutation(internal.fieldWebhooks.finishDrain, {
      companyId,
      runId,
      ok: !("error" in result && result.error),
    });
    return null;
  },
});

/** Where vendors deliver: the deployment's own site URL, when Convex provides one. */
export function webhookUrl(vendor: Vendor, companyId: string): string | null {
  const site = process.env.CONVEX_SITE_URL?.trim().replace(/\/+$/, "");
  return site ? `${site}/webhooks/${vendor}/${companyId}` : null;
}

export interface Delivery {
  http: number;
  internal: number;
  refused: number;
}

/**
 * Sends each event the way the vendor would: signed, to the site URL. A delivery that cannot
 * reach the URL is handed to the same receive step in process, so the event still counts.
 * A refusal (4xx) is not retried: that is a bug in the sender, not a network problem.
 */
export async function deliverEvents(
  ctx: ActionCtx,
  companyId: Id<"companies">,
  events: OutgoingEvent[],
): Promise<Delivery> {
  const out: Delivery = { http: 0, internal: 0, refused: 0 };
  if (events.length === 0) return out;
  const secrets: Record<Vendor, string> = await ctx.runMutation(
    internal.fieldWebhooks.ensureSecrets,
    { companyId },
  );
  for (const event of events) {
    const body = JSON.stringify(event.payload);
    const url = webhookUrl(event.vendor, companyId);
    if (url) {
      try {
        const signature = await signWebhook(
          event.vendor,
          secrets[event.vendor],
          body,
          Math.floor(Date.now() / 1000),
        );
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [SIGNATURE_HEADER[event.vendor]]: signature,
          },
          body,
          signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        });
        if (res.ok) {
          out.http++;
          continue;
        }
        if (res.status < 500) {
          out.refused++;
          continue;
        }
      } catch {
        // Unreachable site URL: fall through to the in-process delivery.
      }
    }
    const parsed = parseVendorEvent(event.vendor, event.payload);
    if (!parsed) {
      out.refused++;
      continue;
    }
    await ctx.runMutation(internal.fieldWebhooks.receive, {
      companyId,
      vendor: parsed.vendor,
      eventId: parsed.eventId,
      type: parsed.type,
      summary: parsed.summary,
      refs: parsed.refs,
      transport: "internal",
    });
    out.internal++;
  }
  return out;
}
