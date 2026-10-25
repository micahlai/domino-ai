import type { Snapshot } from "@domino/contracts";
import { dollars } from "../sources";
import {
  type Item,
  type VendorRoute,
  b64url,
  intParam,
  isoDatetime,
  json,
  sortBy,
  unb64url,
} from "./common";

/**
 * HubSpot-shaped mock: GET /crm/v3/objects/deals?limit=&after= (limit 1-100, default 10).
 * Properties are strings or null, like the real API; the customer is a deal_to_company
 * association. Paging: `paging.next.after` (opaque) while more results exist.
 */
const STAGE = { open: "qualifiedtobuy", won: "closedwon", lost: "closedlost" } as const;

export function deals(s: Snapshot): Item[] {
  return s.deals.map((d) => ({
    id: d.id,
    properties: {
      dealname: d.id,
      amount: dollars(d.amount),
      dealstage: STAGE[d.stage],
      pipeline: "default",
      closedate: `${d.expectedClose}T00:00:00.000Z`,
      dealtype:
        d.kind === undefined
          ? null
          : d.kind === "new_business"
            ? "newbusiness"
            : "existingbusiness",
      // Custom properties the finance team added to the deal record.
      contract_signed: d.signed ? "true" : "false",
      domino_deal_kind: d.kind ?? null,
      invoice_link_status:
        d.invoiceId === undefined ? "unknown" : d.invoiceId === null ? "not_invoiced" : "invoiced",
      stripe_invoice_id: d.invoiceId ?? null,
      hs_object_id: d.id,
    },
    createdAt: isoDatetime(d.expectedClose),
    updatedAt: isoDatetime(s.asOf),
    archived: false,
    associations: { companies: { results: [{ id: d.customerId, type: "deal_to_company" }] } },
  }));
}

const error = (status: number, message: string) =>
  json(status, { status: "error", message, category: "VALIDATION_ERROR", correlationId: "mock" });

export const hubspotRoute: VendorRoute = (rest, url, s) => {
  if (rest !== "/crm/v3/objects/deals") return null;
  const limit = intParam(url, "limit", 1, 100) ?? 10;
  if (Number.isNaN(limit)) return error(400, "limit must be 1 to 100.");
  const items = sortBy(deals(s), "id");
  const after = url.searchParams.get("after");
  let start = 0;
  if (after !== null) {
    const id = unb64url(after);
    const at = id === null ? -1 : items.findIndex((i) => i.id === id);
    if (at < 0) return error(400, "after is not a valid paging cursor.");
    start = at + 1;
  }
  const results = items.slice(start, start + limit);
  const last = results.at(-1);
  if (start + limit >= items.length || !last) return json(200, { results });
  const next = b64url(String(last.id));
  const link = new URL(url);
  link.searchParams.set("after", next);
  return json(200, { results, paging: { next: { after: next, link: link.toString() } } });
};
