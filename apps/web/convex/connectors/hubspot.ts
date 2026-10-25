import { DealSchema } from "@domino/contracts";
import { z } from "zod";
import type { Fetcher, Skip, Translated } from "./types";
import { MAX_PAGES, cents, dateOf, getJson, keepValid, parseEach } from "./vendorHttp";

/**
 * HubSpot connector: deals from the HubSpot-shaped mock (/vendor/hubspot/crm/v3/objects/deals)
 * with amount, dealstage and closedate, following paging.next.after. The customer is the
 * deal_to_company association. Unknown stages are skipped, never guessed.
 */
export type HubspotRaw = { deals: unknown[]; pages: number };

const Page = z.object({
  results: z.array(z.unknown()),
  paging: z.object({ next: z.object({ after: z.string() }) }).optional(),
});

export async function fetchHubspot(fetcher: Fetcher): Promise<HubspotRaw> {
  const deals: unknown[] = [];
  let after: string | null = null;
  let pages = 0;
  do {
    if (++pages > MAX_PAGES) throw new Error("hubspot deals did not finish paging");
    const q = `limit=100&associations=companies${after ? `&after=${encodeURIComponent(after)}` : ""}`;
    const page = Page.parse(
      (await getJson(fetcher, `/vendor/hubspot/crm/v3/objects/deals?${q}`)).body,
    );
    deals.push(...page.results);
    after = page.paging?.next.after ?? null;
  } while (after);
  return { deals, pages };
}

const s = z.string();
const Deal = z.object({
  id: s,
  archived: z.boolean(),
  properties: z.object({
    amount: s.nullable(),
    dealstage: s,
    closedate: s.nullable(),
    contract_signed: s.nullable(),
    domino_deal_kind: s.nullable(),
    invoice_link_status: s.nullable(),
    stripe_invoice_id: s.nullable(),
  }),
  associations: z.object({
    companies: z.object({ results: z.array(z.object({ id: s, type: s })) }),
  }),
});

const STAGE: Record<string, "open" | "won" | "lost"> = {
  appointmentscheduled: "open",
  qualifiedtobuy: "open",
  presentationscheduled: "open",
  decisionmakerboughtin: "open",
  contractsent: "open",
  closedwon: "won",
  closedlost: "lost",
};
const KINDS = new Set(["new_business", "renewal", "expansion"]);

export function translateHubspot(raw: HubspotRaw): Translated<null> {
  const skipped: Skip[] = [];
  const records = parseEach(Deal, raw.deals, "HubSpot deal", skipped).flatMap((d) => {
    const p = d.properties;
    const stage = STAGE[p.dealstage];
    const company = d.associations.companies.results.find((r) => r.type === "deal_to_company");
    const why = d.archived
      ? "archived deal"
      : !stage
        ? `unknown deal stage ${p.dealstage}`
        : !company
          ? "deal has no company"
          : p.amount === null || p.closedate === null
            ? "deal has no amount or close date"
            : null;
    if (why || !stage || !company || p.amount === null || p.closedate === null) {
      skipped.push({ id: d.id, reason: why ?? "incomplete deal" });
      return [];
    }
    const link = p.invoice_link_status;
    return [
      {
        id: d.id,
        customerId: company.id,
        amount: cents(p.amount),
        stage,
        expectedClose: dateOf(p.closedate),
        signed: p.contract_signed === "true",
        // unknown -> omitted; not_invoiced -> null; invoiced -> the Stripe invoice id.
        ...(link === "not_invoiced" && { invoiceId: null }),
        ...(link === "invoiced" &&
          p.stripe_invoice_id !== null && { invoiceId: p.stripe_invoice_id }),
        ...(p.domino_deal_kind !== null &&
          KINDS.has(p.domino_deal_kind) && {
            kind: p.domino_deal_kind as "new_business" | "renewal" | "expansion",
          }),
      },
    ];
  });
  return {
    lists: { deals: keepValid(DealSchema, records, "deal", skipped) },
    links: null,
    skipped,
    recordsIn: raw.deals.length,
    notes: [],
  };
}
