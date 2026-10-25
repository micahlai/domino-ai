import { BillSchema, CardTxnSchema } from "@domino/contracts";
import { z } from "zod";
import type { Fetcher, Skip, Translated } from "./types";
import { MAX_PAGES, cents, dateOf, getJson, keepValid, localPath, parseEach } from "./vendorHttp";

/**
 * Ramp connector: card transactions, Bill Pay bills and reimbursements from the Ramp-shaped
 * mock (/vendor/ramp/developer/v1), following page.next. Bills carry the books' bill id as
 * invoice_number, so the merge drops a Ramp bill QuickBooks already has (by id, not by guess).
 */
export const RAMP_LISTS = ["transactions", "bills", "reimbursements"] as const;
export type RampRaw = Record<(typeof RAMP_LISTS)[number], unknown[]> & {
  pages: Record<string, number>;
};

const Page = z.object({
  data: z.array(z.unknown()),
  page: z.object({ next: z.string().nullable() }),
});
const PREFIX = "/vendor/ramp/developer/v1/";

export async function fetchRamp(fetcher: Fetcher): Promise<RampRaw> {
  const raw = { pages: {} } as RampRaw;
  for (const list of RAMP_LISTS) {
    const items: unknown[] = [];
    let path: string | null = `${PREFIX}${list}?page_size=100`;
    let pages = 0;
    while (path) {
      if (++pages > MAX_PAGES) throw new Error(`ramp ${list} did not finish paging`);
      const page = Page.parse((await getJson(fetcher, path)).body);
      items.push(...page.data);
      path = page.page.next ? localPath(page.page.next, `${PREFIX}${list}`) : null;
    }
    raw[list] = items;
    raw.pages[`/developer/v1/${list}`] = pages;
  }
  return raw;
}

const s = z.string();
const Txn = z.object({
  id: s,
  amount: z.number(),
  merchant_name: s,
  sk_category_name: s,
  user_transaction_time: s,
  state: s,
});
const Money = z.object({ amount: z.number().int(), minor_unit_conversion_rate: z.literal(100) });
const Bill = z.object({
  id: s,
  invoice_number: s,
  vendor: z.object({ name: s }),
  amount: Money,
  due_at: s,
  status: z.enum(["OPEN", "SCHEDULED", "PAID"]),
  payment: z
    .object({ status: s, effective_date: s.optional(), scheduled_date: s.optional() })
    .nullable(),
});

export interface RampLinks {
  /** Ramp bill id -> books bill id, for the QuickBooks dedupe and the bank tie-out. */
  bills: { rampId: string; billId: string; amount: number; paid: string | null }[];
}

export function translateRamp(raw: RampRaw): Translated<RampLinks> {
  const skipped: Skip[] = [];
  const notes: string[] = [];
  const txns = parseEach(Txn, raw.transactions, "Ramp transaction", skipped).filter((t) => {
    if (t.state === "DECLINED") skipped.push({ id: t.id, reason: "declined card charge" });
    return t.state !== "DECLINED";
  });
  const cardTxns = keepValid(
    CardTxnSchema,
    txns.map((t) => ({
      id: t.id,
      date: dateOf(t.user_transaction_time),
      amount: cents(t.amount),
      merchant: t.merchant_name,
      category: t.sk_category_name,
    })),
    "card transaction",
    skipped,
  );
  const rows = parseEach(Bill, raw.bills, "Ramp bill", skipped);
  const bills = keepValid(
    BillSchema,
    rows.map((b) => ({
      id: b.invoice_number,
      vendor: b.vendor.name,
      amount: b.amount.amount,
      due: dateOf(b.due_at),
      ...(b.status === "PAID" &&
        b.payment?.effective_date && { paid: dateOf(b.payment.effective_date) }),
      ...(b.status === "SCHEDULED" &&
        b.payment?.scheduled_date && { agreedPayOn: dateOf(b.payment.scheduled_date) }),
      // Ramp has no critical-vendor flag; bills paid through Bill Pay are the ones that can wait.
      critical: false,
    })),
    "bill",
    skipped,
  );
  if (rows.length > 0)
    notes.push("Ramp does not mark critical vendors; its bills count as non-critical");
  for (const r of raw.reimbursements)
    skipped.push({
      id: (r as { id?: string }).id ?? "unknown",
      reason: "reimbursements are paid through payroll and are not a separate record yet",
    });
  return {
    lists: { cardTxns, bills },
    links: {
      bills: rows.map((b) => ({
        rampId: b.id,
        billId: b.invoice_number,
        amount: b.amount.amount,
        paid:
          b.status === "PAID" && b.payment?.effective_date
            ? dateOf(b.payment.effective_date)
            : null,
      })),
    },
    skipped,
    recordsIn: RAMP_LISTS.reduce((sum, l) => sum + raw[l].length, 0),
    notes,
  };
}
