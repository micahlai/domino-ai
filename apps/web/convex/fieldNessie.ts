import type { Snapshot } from "@domino/contracts";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  type QueryCtx,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import {
  NESSIE_PREFIX,
  type NessieHttp,
  type NessieLedger,
  type NessiePlan,
  httpTransport,
  newLedger,
  syncNessie,
} from "./connectors/nessie";
import { profileOfName } from "./lib/fieldCompanies";

/**
 * Capital One Nessie sandbox per company (internal). Before a bank read, prepareNessie makes
 * Domino's own Nessie customer and accounts hold the served bank history (setup once, then
 * each new week's lines), with every Nessie id stored in nessieLinks. Reads and writes go
 * only to those stored ids. The key and base URL come from the deployment environment
 * (NESSIE_API_KEY, NESSIE_BASE_URL) and never appear in logs or errors.
 */

const DEFAULT_BASE = "https://prod-api.nessieisreal.com";
/** A sync holds the row for at most this long; Convex actions stop at 10 minutes. */
const LEASE_MS = 9 * 60_000;
const MAX_POSTS_PER_RUN = 600;

const posting = v.object({
  bankId: v.string(),
  nessieId: v.string(),
  kind: v.union(v.literal("deposit"), v.literal("withdrawal")),
});
const ledgerArg = {
  label: v.string(),
  customerId: v.union(v.string(), v.null()),
  checkingId: v.union(v.string(), v.null()),
  savingsId: v.union(v.string(), v.null()),
  openingBalance: v.union(v.number(), v.null()),
  posted: v.array(posting),
  postedThrough: v.union(v.string(), v.null()),
  created: v.number(),
};

const ledgerOf = (row: Doc<"nessieLinks">): NessieLedger => ({
  label: row.label,
  customerId: row.customerId,
  checkingId: row.checkingId,
  savingsId: row.savingsId,
  openingBalance: row.openingBalance,
  posted: row.posted,
  postedThrough: row.postedThrough,
  created: row.created,
});

const rowOf = (ctx: Pick<QueryCtx, "db">, companyId: Id<"companies">) =>
  ctx.db
    .query("nessieLinks")
    .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
    .unique();

/** Nessie names for one company: "domino-<profile>-<company id tail>". */
export function nessieLabel(name: string, companyId: string): string {
  return `${NESSIE_PREFIX}${profileOfName(name) ?? "legacy"}-${companyId.slice(-6)}`;
}

export const link = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const row = await rowOf(ctx, companyId);
    return row ? ledgerOf(row) : null;
  },
});

/** Takes the company's sync lease; null when another run holds it. Creates the row once. */
export const claim = internalMutation({
  args: { companyId: v.id("companies"), now: v.number() },
  handler: async (ctx, { companyId, now }) => {
    const row = await rowOf(ctx, companyId);
    if (row && row.lockUntil > now) return null;
    if (row) {
      await ctx.db.patch("nessieLinks", row._id, { lockUntil: now + LEASE_MS });
      return ledgerOf(row);
    }
    const company = await ctx.db.get("companies", companyId);
    if (!company) throw new Error("No such company");
    const ledger = newLedger(nessieLabel(company.name, companyId));
    await ctx.db.insert("nessieLinks", {
      companyId,
      ...ledger,
      lockUntil: now + LEASE_MS,
      lastError: null,
    });
    return ledger;
  },
});

export const save = internalMutation({
  args: { companyId: v.id("companies"), ledger: v.object(ledgerArg) },
  handler: async (ctx, { companyId, ledger }) => {
    const row = await rowOf(ctx, companyId);
    if (!row) throw new Error("No Nessie link for this company");
    // Ids, once stored, never change: a save can only add to what Domino owns.
    for (const key of ["customerId", "checkingId", "savingsId"] as const)
      if (row[key] !== null && row[key] !== ledger[key])
        throw new Error(`Nessie ${key} is already stored and cannot change`);
    await ctx.db.patch("nessieLinks", row._id, ledger);
    return null;
  },
});

export const release = internalMutation({
  args: { companyId: v.id("companies"), error: v.union(v.string(), v.null()) },
  handler: async (ctx, { companyId, error }) => {
    const row = await rowOf(ctx, companyId);
    if (row) await ctx.db.patch("nessieLinks", row._id, { lockUntil: 0, lastError: error });
    return null;
  },
});

export type Prepared =
  | {
      ok: true;
      plan: NessiePlan;
      http: NessieHttp;
      posted: number;
      adopted: number;
      created: number;
      createdTotal: number;
    }
  | { ok: false; reason: string };

function transport(): NessieHttp | string {
  const key = process.env.NESSIE_API_KEY;
  if (!key) return "NESSIE_API_KEY is not set on this deployment";
  try {
    return httpTransport(process.env.NESSIE_BASE_URL || DEFAULT_BASE, key);
  } catch (error) {
    return error instanceof Error ? error.message : "bad NESSIE_BASE_URL";
  }
}

const planOf = (l: NessieLedger, asOf: string): NessiePlan | null =>
  l.customerId && l.checkingId
    ? {
        customerId: l.customerId,
        checkingId: l.checkingId,
        savingsId: l.savingsId,
        asOf,
        order: l.posted.map((p) => p.bankId),
      }
    : null;

/**
 * Makes Nessie hold the served bank history, then returns the read plan. Never throws: any
 * reason Nessie cannot be used this run comes back as { ok: false, reason } so the caller
 * reads the simulated bank instead and says so.
 */
export async function prepareNessie(
  ctx: ActionCtx,
  companyId: Id<"companies">,
  served: Snapshot,
  options: { post: boolean } = { post: true },
): Promise<Prepared> {
  const http = transport();
  if (typeof http === "string") return { ok: false, reason: http };
  const readOnly = async (why: string): Promise<Prepared> => {
    const l: NessieLedger | null = await ctx.runQuery(internal.fieldNessie.link, { companyId });
    const plan = l && l.postedThrough === served.asOf ? planOf(l, served.asOf) : null;
    return plan && l
      ? { ok: true, plan, http, posted: 0, adopted: 0, created: 0, createdTotal: l.created }
      : { ok: false, reason: why };
  };
  if (!options.post) return readOnly("Nessie does not hold this week's bank lines yet");
  const start: NessieLedger | null = await ctx.runMutation(internal.fieldNessie.claim, {
    companyId,
    now: Date.now(),
  });
  if (!start) return readOnly("another run is posting to Nessie");
  try {
    const r = await syncNessie(http, start, served, {
      maxPosts: MAX_POSTS_PER_RUN,
      save: async (ledger) => {
        await ctx.runMutation(internal.fieldNessie.save, { companyId, ledger });
      },
    });
    await ctx.runMutation(internal.fieldNessie.release, { companyId, error: null });
    const plan = planOf(r.ledger, served.asOf);
    if (!r.complete || !plan)
      return {
        ok: false,
        reason: `still posting the bank history to Nessie (${r.remaining} lines left)`,
      };
    return {
      ok: true,
      plan,
      http,
      posted: r.posted,
      adopted: r.adopted,
      created: r.created,
      createdTotal: r.ledger.created,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    await ctx.runMutation(internal.fieldNessie.release, { companyId, error: reason.slice(0, 300) });
    return { ok: false, reason };
  }
}
