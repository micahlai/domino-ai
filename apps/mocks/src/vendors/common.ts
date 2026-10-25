import type { BankTxn, Snapshot } from "@domino/contracts";
import { dollars } from "../sources";

/**
 * Shared helpers for the vendor-shaped mock APIs. Each vendor file shapes the same observable
 * Snapshot after one popular tool (main endpoints and fields only, not a full copy), so numbers
 * agree across tools: a Stripe payout is a bank deposit, a Gusto payroll is a bank debit.
 * Synthetic data only. Nothing here calls a real provider.
 */
export type Item = Record<string, unknown>;

/** A vendor route: the path after its prefix, the request URL and the current snapshot. */
export type VendorRoute = (rest: string, url: URL, s: Snapshot) => Response | null;

export function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-domino-synthetic": "true",
      ...headers,
    },
  });
}

/** Exact decimal dollars as a JSON number, for tools whose real API uses numbers. */
export const dollarNumber = (cents: number) => Number(dollars(cents));

export function unix(date: string): number {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms)) throw new Error("invalid ISO date in snapshot");
  return ms / 1000;
}

export const isoDatetime = (date: string) => `${date}T00:00:00Z`;

/** Stable code-unit order by one key, so cursors survive reloads. */
export function sortBy<T extends Item>(items: T[], key: string): T[] {
  return [...items].sort((x, y) => {
    const a = String(x[key]);
    const b = String(y[key]);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/** Integer query parameter in [min, max]; undefined when absent, NaN when malformed. */
export function intParam(url: URL, name: string, min: number, max: number): number | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null) return undefined;
  const n = /^\d{1,6}$/.test(raw) ? Number(raw) : Number.NaN;
  return n >= min && n <= max ? n : Number.NaN;
}

export const b64url = (text: string) =>
  btoa(encodeURIComponent(text)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

export function unb64url(text: string): string | null {
  try {
    if (!/^[A-Za-z0-9_-]{1,4096}$/.test(text)) return null;
    return decodeURIComponent(atob(text.replaceAll("-", "+").replaceAll("_", "/")));
  } catch {
    return null;
  }
}

/**
 * The record a bank transaction pays, read from the ids its description names. Real banks carry
 * this as a reference number; the mock bank and the tools that pay through it share it, which is
 * how translators link the two sides without guessing.
 */
export function bankReference(s: Snapshot, txn: BankTxn): string {
  const ids = new Set([
    ...s.payroll.map((p) => p.id),
    ...s.bills.map((b) => b.id),
    ...s.cardTxns.map((c) => c.id),
  ]);
  for (const token of txn.description.split(/\s+/)) if (ids.has(token)) return token;
  // Stripe deposits and anything else: the bank's own trace id.
  return txn.id;
}

/** Stripe payouts are the positive Stripe deposits on the bank feed. */
export const isStripeDeposit = (t: BankTxn) => t.counterparty === "Stripe" && t.amount > 0;

/** Small deterministic hash (FNV-1a) for cursor fingerprints. Not a security boundary. */
export function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}
