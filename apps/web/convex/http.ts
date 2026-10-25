import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { SIGNATURE_HEADER, isVendor, parseVendorEvent, verifyWebhook } from "./lib/vendorWebhooks";

/**
 * Mock vendor webhooks: POST /webhooks/<stripe|gusto|ramp|nessie>/<companyId>. The raw body is
 * checked against the vendor's signature header with the company's own secret before anything
 * is parsed or stored; unsigned, forged, stale (Stripe) or oversized deliveries are refused.
 * See fieldWebhooks.ts for what an accepted event does.
 */
const MAX_BODY_BYTES = 64 * 1024;

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const vendorWebhook = httpAction(async (ctx, req) => {
  const [vendor, rawCompanyId, ...rest] = new URL(req.url).pathname
    .replace(/^\/webhooks\//, "")
    .split("/");
  if (!vendor || !isVendor(vendor) || !rawCompanyId || rest.length > 0)
    return reply(404, { error: "unknown webhook endpoint" });
  const target = await ctx.runQuery(internal.fieldWebhooks.secretFor, {
    companyId: rawCompanyId,
    vendor,
  });
  if (!target) return reply(404, { error: "unknown webhook endpoint" });
  const body = await req.text();
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES)
    return reply(413, { error: "body too large" });
  const verified = await verifyWebhook(
    vendor,
    target.secret,
    body,
    req.headers.get(SIGNATURE_HEADER[vendor]),
    Math.floor(Date.now() / 1000),
  );
  if (!verified.ok) return reply(401, { error: `signature refused: ${verified.reason}` });
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return reply(400, { error: "body is not JSON" });
  }
  const event = parseVendorEvent(vendor, json);
  if (!event) return reply(400, { error: "unsupported or malformed event" });
  const result = await ctx.runMutation(internal.fieldWebhooks.receive, {
    companyId: target.companyId,
    vendor,
    eventId: event.eventId,
    type: event.type,
    summary: event.summary,
    refs: event.refs,
    transport: "http",
  });
  return reply(200, { received: true, ...result });
});

const http = httpRouter();
http.route({ pathPrefix: "/webhooks/", method: "POST", handler: vendorWebhook });
export default http;
