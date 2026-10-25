/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import type { Snapshot } from "@domino/contracts";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { DEBOUNCE_MS } from "../fieldWebhooks";
import {
  SIGNATURE_HEADER,
  STRIPE_TOLERANCE_S,
  type Vendor,
  signWebhook,
  vendorEvents,
  verifyWebhook,
} from "../lib/vendorWebhooks";
import schema from "../schema";

const modules = import.meta.glob(["../**/*.ts", "../_generated/*.js", "!./**"]);
const newBackend = () => convexTest(schema, modules);
type T = ReturnType<typeof newBackend>;

afterEach(() => {
  vi.useRealTimers();
});

async function drain(t: T, rounds = 1) {
  for (let i = 0; i < rounds; i++) {
    vi.runOnlyPendingTimers();
    await t.finishInProgressScheduledFunctions();
  }
}

async function setup() {
  vi.useFakeTimers();
  const t = newBackend();
  const { companyId } = await t.mutation(api.field.setup, { profile: "kestrel" });
  await drain(t, 20);
  const secrets = await t.mutation(internal.fieldWebhooks.ensureSecrets, { companyId });
  return { t, companyId, secrets };
}

const logRows = (t: T, companyId: Id<"companies">) =>
  t.run((ctx) =>
    ctx.db
      .query("log")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .collect(),
  );

const events = (t: T, companyId: Id<"companies">) =>
  t.run((ctx) =>
    ctx.db
      .query("vendorWebhookEvents")
      .withIndex("by_companyId_and_eventId", (q) => q.eq("companyId", companyId))
      .collect(),
  );

const invoicePaid = (id: string) => ({
  id: `evt_test_${id}`,
  object: "event",
  type: "invoice.paid",
  created: Math.floor(Date.now() / 1000),
  livemode: false,
  data: { object: { id, object: "invoice", amount_paid: 125_000, status: "paid" } },
});

async function post(
  t: T,
  vendor: Vendor,
  companyId: string,
  payload: unknown,
  signature: string | null,
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== null) headers[SIGNATURE_HEADER[vendor]] = signature;
  return t.fetch(`/webhooks/${vendor}/${companyId}`, {
    method: "POST",
    headers,
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

const now = () => Math.floor(Date.now() / 1000);

describe("vendor webhook signatures", () => {
  const secret = "whsec_test";
  const body = JSON.stringify(invoicePaid("in_1"));

  it("accepts Stripe's t/v1 scheme and refuses forged, tampered, stale and unsigned bodies", async () => {
    const t0 = 1_800_000_000;
    const header = await signWebhook("stripe", secret, body, t0);
    expect(header).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    expect(await verifyWebhook("stripe", secret, body, header, t0 + 10)).toEqual({ ok: true });
    const forged = await signWebhook("stripe", "whsec_other", body, t0);
    expect((await verifyWebhook("stripe", secret, body, forged, t0)).ok).toBe(false);
    expect((await verifyWebhook("stripe", secret, `${body} `, header, t0)).ok).toBe(false);
    expect(
      await verifyWebhook("stripe", secret, body, header, t0 + STRIPE_TOLERANCE_S + 1),
    ).toEqual({ ok: false, reason: "timestamp outside the tolerance" });
    expect(await verifyWebhook("stripe", secret, body, null, t0)).toEqual({
      ok: false,
      reason: "missing signature",
    });
    expect((await verifyWebhook("stripe", secret, body, "v1=abc", t0)).ok).toBe(false);
  });

  it("checks the body HMAC for Gusto, Ramp and Nessie", async () => {
    for (const vendor of ["gusto", "ramp", "nessie"] as const) {
      const sig = await signWebhook(vendor, secret, body, 0);
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
      expect(await verifyWebhook(vendor, secret, body, sig, 0)).toEqual({ ok: true });
      expect((await verifyWebhook(vendor, "nope", body, sig, 0)).ok).toBe(false);
      expect((await verifyWebhook(vendor, secret, "{}", sig, 0)).ok).toBe(false);
    }
  });
});

describe("vendor webhook endpoint", () => {
  it("logs a signed Stripe event at once and starts one debounced ingest", async () => {
    const { t, companyId, secrets } = await setup();
    const before = await t.query(api.field.status, { companyId });
    const payload = JSON.stringify(invoicePaid("in_42"));
    const res = await post(
      t,
      "stripe",
      companyId,
      payload,
      await signWebhook("stripe", secrets.stripe, payload, now()),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, duplicate: false, status: "queued" });

    const log = await logRows(t, companyId);
    const received = log.filter((r) => r.action === "webhook.received");
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      source: "stripe",
      tool: "stripe.webhook",
      agent: "field.ingest",
    });
    expect(received[0]?.refs).toEqual(["evt_test_in_42", "in_42"]);
    // Debounced: nothing reads the tools until the window closes, then exactly one ingest.
    expect(log.some((r) => r.action === "ingest.started" && /^webhook/.test(r.refs[0] ?? ""))).toBe(
      false,
    );
    vi.advanceTimersByTime(DEBOUNCE_MS);
    await t.finishInProgressScheduledFunctions();
    await drain(t, 10);
    const after = await logRows(t, companyId);
    const started = after.filter(
      (r) => r.action === "ingest.started" && r.refs[0] === "webhook: stripe",
    );
    expect(started).toHaveLength(1);
    const status = await t.query(api.field.status, { companyId });
    expect(status?.lastIngestAt).not.toBe(before?.lastIngestAt);
    expect((await events(t, companyId)).map((e) => e.status)).toEqual(["ingested"]);
  }, 60_000);

  it("shares one ingest across a burst and ignores a resent event", async () => {
    const { t, companyId, secrets } = await setup();
    for (const id of ["in_a", "in_b", "in_a"]) {
      const payload = JSON.stringify(invoicePaid(id));
      const sig = await signWebhook("stripe", secrets.stripe, payload, now());
      expect((await post(t, "stripe", companyId, payload, sig)).status).toBe(200);
    }
    const gusto = JSON.stringify({
      uuid: "gusto_evt_1",
      event_type: "payroll.processed",
      resource_uuid: "pr_1",
    });
    const gustoSig = await signWebhook("gusto", secrets.gusto, gusto, 0);
    expect((await post(t, "gusto", companyId, gusto, gustoSig)).status).toBe(200);
    expect(await events(t, companyId)).toHaveLength(3);
    await drain(t, 10);
    const log = await logRows(t, companyId);
    expect(log.filter((r) => r.action === "webhook.received")).toHaveLength(3);
    const started = log.filter(
      (r) => r.action === "ingest.started" && /^webhook/.test(r.refs[0] ?? ""),
    );
    expect(started.map((r) => r.refs[0])).toEqual(["webhook: stripe, gusto"]);
  }, 60_000);

  it("refuses unsigned, forged, stale and malformed deliveries without writing anything", async () => {
    const { t, companyId, secrets } = await setup();
    const rowsBefore = (await logRows(t, companyId)).length;
    const payload = JSON.stringify(invoicePaid("in_x"));
    const forged = await signWebhook("stripe", "whsec_attacker", payload, now());
    const stale = await signWebhook("stripe", secrets.stripe, payload, now() - 3_600);
    const otherVendor = await signWebhook("stripe", secrets.gusto, payload, now());
    for (const sig of [null, forged, stale, otherVendor, "t=1,v1=00"])
      expect((await post(t, "stripe", companyId, payload, sig)).status).toBe(401);
    // A valid signature over a body that is not a supported event: 400.
    const odd = JSON.stringify({ id: "evt_odd", type: "customer.deleted", data: { object: {} } });
    const oddSig = await signWebhook("stripe", secrets.stripe, odd, now());
    expect((await post(t, "stripe", companyId, odd, oddSig)).status).toBe(400);
    // Unknown vendor or company: 404.
    expect((await post(t, "stripe", "not-a-company", payload, forged)).status).toBe(404);
    expect((await post(t, "stripe" as Vendor, `${companyId}/extra`, payload, forged)).status).toBe(
      404,
    );
    const unknownVendor = await t.fetch(`/webhooks/paypal/${companyId}`, {
      method: "POST",
      body: payload,
    });
    expect(unknownVendor.status).toBe(404);
    await drain(t, 5);
    expect(await events(t, companyId)).toHaveLength(0);
    expect((await logRows(t, companyId)).length).toBe(rowsBefore);
  }, 60_000);
});

describe("simulated clock as the sender", () => {
  it("posts the day's vendor events, which join that day's ingest", async () => {
    const { t, companyId } = await setup();
    await t.mutation(api.fieldClock.play, { companyId, speed: 20 });
    for (let i = 0; i < 40; i++) {
      const s = await t.query(api.fieldClock.status, { companyId });
      if ((s?.day ?? 0) >= 4) break;
      await drain(t);
    }
    await t.mutation(api.fieldClock.pause, { companyId });
    await drain(t, 20);
    const got = await events(t, companyId);
    expect(got.length).toBeGreaterThan(0);
    // No site URL in tests, so delivery falls back in process; the clock lease makes them join.
    expect(new Set(got.map((e) => e.transport))).toEqual(new Set(["internal"]));
    expect(new Set(got.map((e) => e.status))).toEqual(new Set(["joined"]));
    const log = await logRows(t, companyId);
    expect(log.some((r) => r.action === "ingest.started" && /^webhook/.test(r.refs[0] ?? ""))).toBe(
      false,
    );
    expect(log.filter((r) => r.action === "webhook.received").length).toBe(got.length);
  }, 60_000);

  it("derives Stripe, Gusto, Ramp and Nessie events from new records", () => {
    const base = {
      companyId: "c",
      asOf: "2026-11-02",
      cashOnHand: 0,
      restrictedCash: 0,
      customers: [],
      bills: [],
      deals: [],
    };
    const before: Snapshot = {
      ...base,
      invoices: [
        { id: "in_1", customerId: "cu", amount: 500, issued: "2026-10-01", due: "2026-11-01" },
      ],
      bankTxns: [],
      cardTxns: [],
      payroll: [],
    };
    const after: Snapshot = {
      ...before,
      invoices: before.invoices.map((i) => ({ ...i, paid: "2026-11-02" })),
      bankTxns: [
        { id: "bank_po_1", date: "2026-11-02", amount: 480, description: "payout" },
        { id: "bank_ach_1", date: "2026-11-02", amount: 900, description: "ach" },
      ],
      cardTxns: [
        { id: "card_1", date: "2026-11-02", amount: 30, merchant: "AWS", category: "cloud" },
      ],
      payroll: [{ id: "pr_1", date: "2026-11-02", amount: 10_000 }],
    };
    const out = vendorEvents(before, after, "2026-11-02");
    expect(out.map((e) => `${e.vendor}:${String(e.payload.type ?? e.payload.event_type)}`)).toEqual(
      [
        "stripe:invoice.paid",
        "stripe:payout.paid",
        "gusto:payroll.processed",
        "ramp:transaction.cleared",
        "nessie:deposit.posted",
      ],
    );
    expect(vendorEvents(after, after, "2026-11-02")).toEqual([]);
  });
});
