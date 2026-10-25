import type { Snapshot } from "@domino/contracts";
import { money } from "./judge";

/**
 * Mock vendor webhooks (pure). The event bodies follow the real vendors' envelopes closely
 * enough to exercise the same handling: Stripe `invoice.paid` / `payout.paid` with Stripe's
 * documented `Stripe-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.body">` scheme and a 5 minute
 * tolerance; Gusto `payroll.processed` signed as hex HMAC-SHA256 of the raw body in
 * `X-Gusto-Signature`; Ramp `transaction.cleared` and a Capital One Nessie deposit notice use
 * the same body HMAC in `X-Ramp-Signature` / `X-Nessie-Signature`. Ramp's and Nessie's real
 * schemes are not claimed (Nessie has no webhooks at all; the notice is Domino's own mock).
 * Synthetic data only: these events only say "something changed, go read the tool".
 */

export const VENDORS = ["stripe", "gusto", "ramp", "nessie"] as const;
export type Vendor = (typeof VENDORS)[number];
export const isVendor = (v: string): v is Vendor => (VENDORS as readonly string[]).includes(v);

export const VENDOR_NAME: Record<Vendor, string> = {
  stripe: "Stripe",
  gusto: "Gusto",
  ramp: "Ramp",
  nessie: "Capital One Nessie",
};

/** Event types each vendor may send; anything else is refused with 400. */
export const EVENT_TYPES: Record<Vendor, readonly string[]> = {
  stripe: ["invoice.paid", "payout.paid"],
  gusto: ["payroll.processed"],
  ramp: ["transaction.cleared"],
  nessie: ["deposit.posted"],
};

export const SIGNATURE_HEADER: Record<Vendor, string> = {
  stripe: "stripe-signature",
  gusto: "x-gusto-signature",
  ramp: "x-ramp-signature",
  nessie: "x-nessie-signature",
};

/** Stripe's default tolerance between the signed timestamp and now. */
export const STRIPE_TOLERANCE_S = 300;

const encoder = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares two strings without stopping at the first difference. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The signature header value a vendor would send for this raw body. */
export async function signWebhook(
  vendor: Vendor,
  secret: string,
  body: string,
  nowS: number,
): Promise<string> {
  if (vendor === "stripe") return `t=${nowS},v1=${await hmacHex(secret, `${nowS}.${body}`)}`;
  return hmacHex(secret, body);
}

export type Verified = { ok: true } | { ok: false; reason: string };

/** Checks the vendor's signature header against the raw body and this company's secret. */
export async function verifyWebhook(
  vendor: Vendor,
  secret: string,
  body: string,
  header: string | null,
  nowS: number,
): Promise<Verified> {
  if (!header) return { ok: false, reason: "missing signature" };
  if (vendor !== "stripe")
    return sameText(header.trim().toLowerCase(), await hmacHex(secret, body))
      ? { ok: true }
      : { ok: false, reason: "signature does not match" };
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const v1 = parts.filter(([k, v]) => k === "v1" && v).map(([, v]) => v as string);
  if (!Number.isSafeInteger(t) || v1.length === 0)
    return { ok: false, reason: "malformed Stripe-Signature" };
  if (Math.abs(nowS - t) > STRIPE_TOLERANCE_S)
    return { ok: false, reason: "timestamp outside the tolerance" };
  const expected = await hmacHex(secret, `${t}.${body}`);
  return v1.some((s) => sameText(s.toLowerCase(), expected))
    ? { ok: true }
    : { ok: false, reason: "signature does not match" };
}

/** What Domino keeps from one accepted event. */
export interface ParsedEvent {
  vendor: Vendor;
  eventId: string;
  type: string;
  summary: string;
  refs: string[];
}

const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null);
const cents = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);

/** Narrows an untrusted JSON body to the fields Domino uses; null = refuse with 400. */
export function parseVendorEvent(vendor: Vendor, json: unknown): ParsedEvent | null {
  const body = rec(json);
  if (!body) return null;
  if (vendor === "stripe") {
    const eventId = text(body.id);
    const type = text(body.type);
    const object = rec(rec(body.data)?.object);
    const id = text(object?.id);
    if (!eventId || !type || !EVENT_TYPES.stripe.includes(type) || !object || !id) return null;
    const amount = cents(type === "invoice.paid" ? object.amount_paid : object.amount);
    const what = type === "invoice.paid" ? `invoice ${id} was paid` : `payout ${id} was paid out`;
    return {
      vendor,
      eventId,
      type,
      summary: `Stripe says ${what}${amount === null ? "" : ` (${money(amount)})`}`,
      refs: [id],
    };
  }
  if (vendor === "gusto") {
    const eventId = text(body.uuid);
    const type = text(body.event_type);
    const id = text(body.resource_uuid);
    if (!eventId || type !== "payroll.processed" || !id) return null;
    return { vendor, eventId, type, summary: `Gusto says payroll ${id} was processed`, refs: [id] };
  }
  if (vendor === "ramp") {
    const eventId = text(body.id);
    const type = text(body.type);
    const object = rec(body.object);
    const id = text(object?.id);
    if (!eventId || type !== "transaction.cleared" || !id) return null;
    const merchant = text(object?.merchant_name);
    const amount = cents(object?.amount);
    return {
      vendor,
      eventId,
      type,
      summary: `Ramp says a card charge cleared${merchant ? ` at ${merchant}` : ""}${
        amount === null ? "" : ` (${money(amount)})`
      }`,
      refs: [id],
    };
  }
  const eventId = text(body.id);
  const type = text(body.type);
  const deposit = rec(body.deposit);
  const id = text(deposit?.id);
  if (!eventId || type !== "deposit.posted" || !id) return null;
  const amount = cents(deposit?.amount);
  return {
    vendor,
    eventId,
    type,
    summary: `Capital One Nessie says a deposit posted${amount === null ? "" : ` (${money(amount)})`}`,
    refs: [id],
  };
}

/** One outgoing mock event: who sends it and its JSON body. */
export interface OutgoingEvent {
  vendor: Vendor;
  payload: Record<string, unknown>;
}

/** At most this many events per vendor for one simulated day; the rest ride on the same read. */
export const EVENTS_PER_VENDOR = 3;

const unix = (date: string) => Math.floor(Date.parse(`${date}T12:00:00Z`) / 1000);

/**
 * The webhooks the mock vendors would send for what changed between two served snapshots:
 * newly paid invoices and payouts (Stripe), new payroll runs (Gusto), new card charges (Ramp)
 * and new customer deposits at the bank (Nessie). Event ids derive from record ids, so a
 * resend is the same event and is deduplicated on receipt.
 */
export function vendorEvents(before: Snapshot, after: Snapshot, date: string): OutgoingEvent[] {
  const created = unix(date);
  const old = <T extends { id: string }>(list: T[]) => new Map(list.map((r) => [r.id, r]));
  const fresh = <T extends { id: string }>(prev: T[], next: T[]) => {
    const seen = old(prev);
    return next.filter((r) => !seen.has(r.id));
  };
  const paidBefore = old(before.invoices);
  const paid = after.invoices
    .filter((i) => i.paid && !paidBefore.get(i.id)?.paid)
    .slice(0, EVENTS_PER_VENDOR);
  const bank = fresh(before.bankTxns, after.bankTxns);
  const payouts = bank.filter((t) => t.id.startsWith("bank_po_")).slice(0, EVENTS_PER_VENDOR);
  const deposits = bank
    .filter((t) => t.amount > 0 && !t.id.startsWith("bank_po_"))
    .slice(0, EVENTS_PER_VENDOR);
  const runs = fresh(before.payroll, after.payroll).slice(0, EVENTS_PER_VENDOR);
  const cards = fresh(before.cardTxns, after.cardTxns).slice(0, EVENTS_PER_VENDOR);
  const stripe = (type: string, object: Record<string, unknown>, id: string) => ({
    vendor: "stripe" as const,
    payload: {
      id: `evt_${type.replace(".", "_")}_${id}`,
      object: "event",
      api_version: "2024-06-20",
      created,
      livemode: false,
      type,
      data: { object },
    },
  });
  return [
    ...paid.map((i) =>
      stripe(
        "invoice.paid",
        {
          id: i.id,
          object: "invoice",
          customer: i.customerId,
          amount_paid: i.paidAmount ?? i.amount,
          currency: "usd",
          status: "paid",
        },
        i.id,
      ),
    ),
    ...payouts.map((t) =>
      stripe(
        "payout.paid",
        { id: t.id, object: "payout", amount: t.amount, currency: "usd", status: "paid" },
        t.id,
      ),
    ),
    ...runs.map((r) => ({
      vendor: "gusto" as const,
      payload: {
        uuid: `gusto_evt_${r.id}`,
        event_type: "payroll.processed",
        resource_type: "Payroll",
        resource_uuid: r.id,
        entity_type: "Company",
        timestamp: created,
      },
    })),
    ...cards.map((c) => ({
      vendor: "ramp" as const,
      payload: {
        id: `ramp_evt_${c.id}`,
        type: "transaction.cleared",
        created_at: `${date}T12:00:00Z`,
        object: { id: c.id, amount: c.amount, merchant_name: c.merchant },
      },
    })),
    ...deposits.map((t) => ({
      vendor: "nessie" as const,
      payload: {
        id: `nessie_evt_${t.id}`,
        type: "deposit.posted",
        deposit: { id: t.id, amount: t.amount, transaction_date: t.date },
      },
    })),
  ];
}
