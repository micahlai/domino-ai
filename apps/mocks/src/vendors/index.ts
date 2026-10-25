import type { Snapshot } from "@domino/contracts";
import type { VendorRoute } from "./common";
import { gustoRoute } from "./gusto";
import { hubspotRoute } from "./hubspot";
import { plaidRoute } from "./plaid";
import { qboRoute } from "./qbo";
import { rampRoute } from "./ramp";
import { stripeRoute } from "./stripe";

/**
 * Vendor-shaped mock APIs under /vendor/<tool>/..., beside the older generic source routes
 * (/stripe/v1, /crm, /cards, /books, /payroll, /bank), which stay unchanged for the current
 * ingestion. Shaped after the real tools' main endpoints and fields; not compatible copies.
 */
export const VENDOR_TOOLS = ["stripe", "ramp", "qbo", "gusto", "hubspot", "plaid"] as const;
export type VendorTool = (typeof VENDOR_TOOLS)[number];

const ROUTES: Record<VendorTool, VendorRoute> = {
  stripe: stripeRoute,
  ramp: rampRoute,
  qbo: qboRoute,
  gusto: gustoRoute,
  hubspot: hubspotRoute,
  plaid: plaidRoute,
};

/** True when the path belongs to a vendor mock, so the caller loads the snapshot first. */
export const isVendorPath = (path: string) => path.startsWith("/vendor/");

/** A vendor response, or null when no vendor route matches the path. */
export function routeVendor(path: string, url: URL, s: Snapshot): Response | null {
  const m = path.match(/^\/vendor\/([a-z]+)(\/.*)$/);
  const tool = m?.[1] as VendorTool | undefined;
  if (!m || !tool || !(VENDOR_TOOLS as readonly string[]).includes(tool)) return null;
  return ROUTES[tool](m[2] ?? "", url, s);
}

export { payrollTotals } from "./gusto";
