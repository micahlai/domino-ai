import { SnapshotSchema } from "@domino/contracts";
import type { Infer } from "convex/values";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, internalMutation, internalQuery } from "./_generated/server";
import {
  type CrsCheckResult,
  CrsLoginError,
  type CrsPersona,
  personaFor,
  runCrsCheck,
} from "./connectors/crs";
import { AUDIT_AGENT } from "./fieldAi";
import type { Overlay } from "./fieldFeed";
import { writeLog } from "./fieldJobs";
import type { AgentRow } from "./lib/agentLog";
import { member } from "./lib/swarm";
import { crsResult } from "./schemas/field.schema";

/**
 * Identity & fraud check agent ("audit.identityFraud", part of the audit swarm). After the
 * engine checkers merge, it looks for two payment risks on the new snapshot version:
 *   - a vendor's remit-to bank account changed on an incoming bill (overlay payeeChanges, the
 *     "Vendor changes bank details" judge surprise), and
 *   - a large first-time payee: an unpaid bill of at least NEW_PAYEE_MIN_CENTS from a vendor the
 *     previous version never billed from.
 * Each one becomes a flag with a real CRS sandbox check (TransUnion TruValidate identity plus
 * CRS Fraud Finder) on the account owner. Simulated vendors have no real owners, so a CRS
 * sandbox test persona stands in, picked deterministically (connectors/crs.ts personaFor).
 *
 * Limits: results are cached per persona (sandbox answers are canned), at most
 * HOURLY_CALL_CAP CRS HTTP calls per company per hour, and after one failed login no further
 * logins (the sandbox locks accounts after repeated failures). Credentials: CRS_USERNAME and
 * CRS_PASSWORD from the deployment environment only. Missing or unreachable CRS is said plainly
 * on the flag; the audit never fails because of CRS.
 */

export const IDENTITY_AGENT = "audit.identityFraud";
export const NEW_PAYEE_MIN_CENTS = 25_000_000;
export const HOURLY_CALL_CAP = 6;
const CALLS_PER_CHECK = 3;
const LOGIN_BLOCK_MS = 6 * 60 * 60_000;
const MAX_CHECKS_PER_AUDIT = 3;
const HOUR_MS = 60 * 60_000;

type Stored = Infer<typeof crsResult>;
type Subject = {
  findingId: string;
  billId: string;
  vendor: string;
  amount: number;
  reason: "payee_change" | "new_payee";
  /** Plain words for what changed. */
  what: string;
  personaKey: string;
};

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

/** What on this snapshot needs an identity check and has no flag yet. */
export const subjects = internalQuery({
  args: {
    companyId: v.id("companies"),
    snapshotId: v.id("snapshots"),
    previousId: v.optional(v.id("snapshots")),
  },
  handler: async (ctx, { companyId, snapshotId, previousId }): Promise<Subject[]> => {
    const row = await ctx.db.get("snapshots", snapshotId);
    if (!row) return [];
    const snapshot = SnapshotSchema.parse(row.data);
    const prev = previousId ? await ctx.db.get("snapshots", previousId) : null;
    const previous = prev ? SnapshotSchema.parse(prev.data) : null;
    const world = await ctx.db
      .query("feedWorlds")
      .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
      .unique();
    const overlay = (world?.overlay ?? null) as Overlay | null;
    const bills = new Map(snapshot.bills.map((b) => [b.id, b]));
    const out: Subject[] = [];
    for (const c of overlay?.payeeChanges ?? []) {
      const bill = bills.get(c.billId);
      if (!bill) continue;
      out.push({
        findingId: `crs_payee_${c.billId}`,
        billId: c.billId,
        vendor: c.vendor,
        amount: bill.amount,
        reason: "payee_change",
        what: `${c.vendor} changed its bank account on bill ${c.billId} (${money(bill.amount)}): ending ${c.fromAccount} -> ${c.toAccount}`,
        personaKey: `${c.vendor}|${c.toAccount}`,
      });
    }
    if (previous && previous.bills.length > 0) {
      const known = new Set(previous.bills.map((b) => b.vendor.trim().toLowerCase()));
      const changed = new Set((overlay?.payeeChanges ?? []).map((c) => c.billId));
      for (const b of snapshot.bills) {
        if (b.paid !== undefined || b.critical || b.amount < NEW_PAYEE_MIN_CENTS) continue;
        if (changed.has(b.id) || known.has(b.vendor.trim().toLowerCase())) continue;
        out.push({
          findingId: `crs_newpayee_${b.id}`,
          billId: b.id,
          vendor: b.vendor,
          amount: b.amount,
          reason: "new_payee",
          what: `First bill from new payee ${b.vendor}: ${b.id} for ${money(b.amount)} due ${b.due}`,
          personaKey: `${b.vendor}|new`,
        });
      }
    }
    const fresh: Subject[] = [];
    for (const s of out) {
      const existing = await ctx.db
        .query("findings")
        .withIndex("by_companyId_and_findingId", (q) =>
          q.eq("companyId", companyId).eq("findingId", s.findingId),
        )
        .first();
      if (!existing && !fresh.some((f) => f.findingId === s.findingId)) fresh.push(s);
    }
    return fresh.slice(0, MAX_CHECKS_PER_AUDIT);
  },
});

/** Cache hit, login block and hourly use for one company and persona. */
export const gate = internalQuery({
  args: { companyId: v.id("companies"), personaId: v.string(), now: v.number() },
  handler: async (ctx, { companyId, personaId, now }) => {
    const cachedRow = await ctx.db
      .query("crsChecks")
      .withIndex("by_kind_and_personaId", (q) => q.eq("kind", "check").eq("personaId", personaId))
      .order("desc")
      .first();
    const failed = await ctx.db
      .query("crsChecks")
      .withIndex("by_kind_and_at", (q) =>
        q.eq("kind", "login_failed").gt("at", new Date(now - LOGIN_BLOCK_MS).toISOString()),
      )
      .first();
    const recent = await ctx.db
      .query("crsChecks")
      .withIndex("by_companyId_and_at", (q) =>
        q.eq("companyId", companyId).gt("at", new Date(now - HOUR_MS).toISOString()),
      )
      .take(50);
    return {
      cached: cachedRow?.result ?? null,
      loginBlocked: failed !== null,
      callsThisHour: recent.reduce((n, r) => n + r.calls, 0),
    };
  },
});

export const record = internalMutation({
  args: {
    kind: v.union(v.literal("check"), v.literal("login_failed")),
    companyId: v.id("companies"),
    personaId: v.string(),
    calls: v.number(),
    result: v.optional(crsResult),
  },
  handler: async (ctx, a) => {
    await ctx.db.insert("crsChecks", { ...a, at: new Date().toISOString() });
    return null;
  },
});

export const storeFinding = internalMutation({
  args: {
    companyId: v.id("companies"),
    ingestRunId: v.string(),
    snapshotId: v.id("snapshots"),
    version: v.number(),
    findingId: v.string(),
    severity: v.union(v.literal("medium"), v.literal("high")),
    summary: v.string(),
    refs: v.array(v.string()),
    crs: crsResult,
  },
  handler: async (ctx, a) => {
    const existing = await ctx.db
      .query("findings")
      .withIndex("by_companyId_and_findingId", (q) =>
        q.eq("companyId", a.companyId).eq("findingId", a.findingId),
      )
      .first();
    if (existing) return false;
    const escalated = a.severity === "high";
    await ctx.db.insert("findings", {
      companyId: a.companyId,
      findingId: a.findingId,
      snapshotId: a.snapshotId,
      version: a.version,
      kind: "conflict",
      severity: a.severity,
      summary: a.summary,
      refs: a.refs,
      detectedAt: a.crs.checkedAt,
      escalated,
      status: "open",
      crs: a.crs,
    });
    if (escalated)
      await writeLog(ctx, a.companyId, a.ingestRunId, {
        actor: "engine",
        action: "audit.escalated",
        refs: [a.findingId, ...a.refs],
        agent: AUDIT_AGENT,
        tool: "crs.identityFraud",
        summary: a.summary,
      });
    return true;
  },
});

const offline = (
  p: CrsPersona,
  verdict: "unavailable" | "not_configured" | "capped",
  headline: string,
  detail: string | null,
): CrsCheckResult => ({
  verdict,
  personaId: p.id,
  personaName: p.name,
  personaProfile: p.profile,
  identity: null,
  fraud: null,
  headline,
  signals: [],
  calls: 0,
  detail,
});

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One persona check: cache, then caps, then the real CRS sandbox. Never throws. */
async function checkPersona(
  ctx: ActionCtx,
  companyId: Id<"companies">,
  p: CrsPersona,
): Promise<Stored> {
  const checkedAt = new Date().toISOString();
  const g = await ctx.runQuery(internal.fieldCrs.gate, {
    companyId,
    personaId: p.id,
    now: Date.now(),
  });
  if (g.cached) return { ...g.cached, cached: true, calls: 0, checkedAt };
  const username = process.env.CRS_USERNAME?.trim();
  const password = process.env.CRS_PASSWORD;
  let result: CrsCheckResult;
  if (!username || !password)
    result = offline(p, "not_configured", "CRS not configured: identity not checked", null);
  else if (g.loginBlocked)
    result = offline(
      p,
      "unavailable",
      "CRS unavailable: identity not checked",
      "An earlier CRS login failed; Domino is not retrying for 6 hours (the sandbox locks accounts after repeated failed logins)",
    );
  else if (g.callsThisHour + CALLS_PER_CHECK > HOURLY_CALL_CAP)
    result = offline(
      p,
      "capped",
      "CRS hourly limit reached: identity not checked",
      `At most ${HOURLY_CALL_CAP} CRS calls per company per hour`,
    );
  else {
    try {
      result = await runCrsCheck(p, { username, password });
    } catch (error) {
      if (error instanceof CrsLoginError) {
        await ctx.runMutation(internal.fieldCrs.record, {
          kind: "login_failed",
          companyId,
          personaId: p.id,
          calls: 1,
        });
        result = offline(p, "unavailable", "CRS login failed: identity not checked", error.message);
        return { ...result, cached: false, checkedAt, calls: 1 };
      }
      result = offline(
        p,
        "unavailable",
        "CRS unreachable: identity not checked",
        errorText(error).slice(0, 200),
      );
    }
  }
  const stored: Stored = { ...result, cached: false, checkedAt };
  if (result.calls > 0)
    await ctx.runMutation(internal.fieldCrs.record, {
      kind: "check",
      companyId,
      personaId: p.id,
      calls: result.calls,
      // Only complete answers are reused as cache.
      ...(result.verdict === "verified" || result.verdict === "signals" ? { result: stored } : {}),
    });
  return stored;
}

/**
 * Runs after the audit lead stored the merged checker findings. Only spawns (and logs) when the
 * snapshot has a payee change or a large first-time payee. Never throws.
 */
export async function runIdentityAgent(
  ctx: ActionCtx,
  a: {
    companyId: Id<"companies">;
    ingestRunId: string;
    swarmRunId: string;
    snapshotId: Id<"snapshots">;
    previousId?: Id<"snapshots">;
    version: number;
  },
): Promise<string[]> {
  const log = (rows: AgentRow[]) =>
    ctx.runMutation(internal.fieldAi.logRows, {
      companyId: a.companyId,
      runId: a.swarmRunId,
      rows,
    });
  const m = member(IDENTITY_AGENT, AUDIT_AGENT);
  const added: string[] = [];
  try {
    const list: Subject[] = await ctx.runQuery(internal.fieldCrs.subjects, {
      companyId: a.companyId,
      snapshotId: a.snapshotId,
      ...(a.previousId && { previousId: a.previousId }),
    });
    if (list.length === 0) return [];
    const task = `Identity & fraud check on ${list.length} payee${list.length === 1 ? "" : "s"} (CRS)`;
    await log([
      m.spawned({ currentTask: task, summary: `Audit lead spawned ${IDENTITY_AGENT}: ${task}` }),
      m.assigned(
        `Verify the account owner behind ${list.map((s) => s.vendor).join(", ")}`,
        list.map((s) => s.billId),
      ),
      m.working({ currentTask: task, summary: `${IDENTITY_AGENT} started: ${task}` }),
    ]);
    for (const s of list) {
      const p = personaFor(s.personaKey);
      const crs = await checkPersona(ctx, a.companyId, p);
      const via = crs.cached ? " (cached sandbox result, no new call)" : "";
      const rows: AgentRow[] = [];
      if (crs.identity || crs.verdict !== "verified")
        rows.push(
          m.tool({
            tool: "crs.truvalidate",
            toolCategory: "crs",
            toolLabel: "TransUnion TruValidate identity (CRS sandbox)",
            currentTask: `Verify ${p.name} for ${s.vendor}`,
            refs: [s.billId, p.id, ...(crs.identity?.requestId ? [crs.identity.requestId] : [])],
            summary: crs.identity
              ? `CRS TruValidate for ${p.id} ${p.name}: ${crs.identity.result}${crs.identity.messages.length ? ` (${crs.identity.messages.map((x) => x.code).join(", ")})` : ""}${via}`
              : `CRS TruValidate not run: ${crs.headline}`,
          }),
        );
      if (crs.fraud)
        rows.push(
          m.tool({
            tool: "crs.fraudfinder",
            toolCategory: "crs",
            toolLabel: "CRS Fraud Finder (AtData)",
            currentTask: `Fraud signals for ${p.name}`,
            refs: [s.billId, p.id, ...(crs.fraud.requestId ? [crs.fraud.requestId] : [])],
            summary: `CRS Fraud Finder for ${p.id} ${p.name}: risk ${crs.fraud.score ?? "n/a"}/100, email ${crs.fraud.emailStatus ?? "n/a"}${via}`,
          }),
        );
      const severity = crs.verdict === "verified" ? "medium" : "high";
      const summary = `${s.what}. ${crs.headline}. Sandbox persona ${p.id} ${p.name} stands in for the account owner.`;
      const ok = await ctx.runMutation(internal.fieldCrs.storeFinding, {
        companyId: a.companyId,
        ingestRunId: a.ingestRunId,
        snapshotId: a.snapshotId,
        version: a.version,
        findingId: s.findingId,
        severity,
        summary: summary.slice(0, 480),
        refs: [s.billId, s.vendor],
        crs,
      });
      if (ok) added.push(s.findingId);
      rows.push(m.reported(`${s.vendor}: ${crs.headline}`, [s.findingId]));
      await log(rows);
    }
    await log([
      m.done({
        currentTask: "Identity & fraud check: reported",
        summary: `${IDENTITY_AGENT} done: ${added.length} flag${added.length === 1 ? "" : "s"}`,
      }),
    ]);
    return added;
  } catch (error) {
    await log([
      m.failed({ summary: `${IDENTITY_AGENT} failed: ${errorText(error).slice(0, 200)}` }),
    ]).catch(() => undefined);
    return added;
  }
}
