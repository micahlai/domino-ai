import type { Snapshot } from "@domino/contracts";
import {
  type Item,
  type VendorRoute,
  dollarNumber,
  intParam,
  isoDatetime,
  json,
  sortBy,
} from "./common";

/**
 * Ramp-shaped mock (subset of /developer/v1): card transactions, Bill Pay bills and
 * reimbursements. Pagination: `page_size` (2-100, default 20) and `start` (last id of the
 * previous page); the response carries `page.next`, the full URL of the next page or null.
 * Card amounts are decimal dollars; bill amounts are integer minor units, as in the real API.
 */
export function transactions(s: Snapshot): Item[] {
  return s.cardTxns.map((t) => ({
    id: t.id,
    amount: dollarNumber(t.amount),
    currency_code: "USD",
    merchant_name: t.merchant,
    sk_category_name: t.category,
    user_transaction_time: isoDatetime(t.date),
    state: "CLEARED",
    card_holder: { first_name: "Kestrel", last_name: "Ops", department_name: "Operations" },
  }));
}

/**
 * Bills paid through Ramp Bill Pay. Critical vendors (cloud, payroll provider) are paid
 * directly from the bank, so only non-critical bills appear here; QuickBooks has all of them.
 */
export function bills(s: Snapshot): Item[] {
  return s.bills
    .filter((b) => !b.critical)
    .map((b) => {
      const amount = { amount: b.amount, currency_code: "USD", minor_unit_conversion_rate: 100 };
      return {
        id: `rb_${b.id}`,
        // The vendor's invoice number is the bill id in the books: the cross-tool link.
        invoice_number: b.id,
        vendor: { name: b.vendor },
        amount,
        due_at: isoDatetime(b.due),
        status: b.paid !== undefined ? "PAID" : b.agreedPayOn !== undefined ? "SCHEDULED" : "OPEN",
        payment:
          b.paid !== undefined
            ? { status: "PAID", effective_date: isoDatetime(b.paid), amount, method: "ACH" }
            : b.agreedPayOn !== undefined
              ? { status: "SCHEDULED", scheduled_date: isoDatetime(b.agreedPayOn), amount }
              : null,
      };
    });
}

/** The simulated company files no reimbursements yet: the endpoint exists and is empty. */
export const reimbursements = (_s: Snapshot): Item[] => [];

const LISTS: Record<string, (s: Snapshot) => Item[]> = {
  "/developer/v1/transactions": transactions,
  "/developer/v1/bills": bills,
  "/developer/v1/reimbursements": reimbursements,
};

const error = (status: number, code: string, message: string) =>
  json(status, { error_v2: { error_code: code, message } });

export const rampRoute: VendorRoute = (rest, url, s) => {
  const list = LISTS[rest];
  if (!list) return null;
  const size = intParam(url, "page_size", 2, 100) ?? 20;
  if (Number.isNaN(size)) return error(400, "INVALID_PAGE_SIZE", "page_size must be 2 to 100.");
  const items = sortBy(list(s), "id");
  const after = url.searchParams.get("start");
  let start = 0;
  if (after !== null) {
    const at = items.findIndex((i) => i.id === after);
    if (at < 0) return error(400, "INVALID_START", "start is not an id in this list.");
    start = at + 1;
  }
  const data = items.slice(start, start + size);
  const last = data.at(-1);
  let next: string | null = null;
  if (start + size < items.length && last) {
    const u = new URL(url);
    u.searchParams.set("page_size", String(size));
    u.searchParams.set("start", String(last.id));
    next = u.toString();
  }
  return json(200, { data, page: { next } });
};
