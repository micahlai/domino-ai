import { type BankTxn, BankTxnSchema } from "@domino/contracts";
import { z } from "zod";
import type { Balances, Fetcher, Skip, Translated } from "./types";
import { MAX_PAGES, VendorError, cents, dateOf, getJson, keepValid, parseEach } from "./vendorHttp";

/**
 * Plaid connector: the bank. /accounts/get gives balances; /transactions/sync gives
 * added/modified/removed since a cursor. With a saved cursor only new activity is read and
 * merged into the previous bank transactions; if the bank says earlier history changed
 * (TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION) the connector restarts from an empty cursor.
 *
 * Plaid's amount sign is money out = positive; Domino's is money in = positive.
 */
export interface PlaidRaw {
  accounts: unknown[];
  added: unknown[];
  modified: unknown[];
  removed: unknown[];
  cursor: string;
  /** True when this read started from an empty cursor (a full history). */
  full: boolean;
  restarted: boolean;
  pages: number;
}

const Sync = z.object({
  added: z.array(z.unknown()),
  modified: z.array(z.unknown()),
  removed: z.array(z.unknown()),
  next_cursor: z.string(),
  has_more: z.boolean(),
});
const Accounts = z.object({ accounts: z.array(z.unknown()) });

export async function fetchPlaid(fetcher: Fetcher, since: string | null): Promise<PlaidRaw> {
  const accounts = Accounts.parse(
    (await getJson(fetcher, "/vendor/plaid/accounts/get")).body,
  ).accounts;
  const read = async (start: string) => {
    const out = { added: [] as unknown[], modified: [] as unknown[], removed: [] as unknown[] };
    let cursor = start;
    let pages = 0;
    for (;;) {
      if (++pages > MAX_PAGES) throw new Error("plaid sync did not finish paging");
      const page = Sync.parse(
        (
          await getJson(
            fetcher,
            `/vendor/plaid/transactions/sync?count=500&cursor=${encodeURIComponent(cursor)}`,
          )
        ).body,
      );
      out.added.push(...page.added);
      out.modified.push(...page.modified);
      out.removed.push(...page.removed);
      cursor = page.next_cursor;
      if (!page.has_more) return { ...out, cursor, pages };
    }
  };
  if (since) {
    try {
      return { accounts, ...(await read(since)), full: false, restarted: false };
    } catch (error) {
      const code =
        (error instanceof VendorError && (error.body as { error_code?: unknown })?.error_code) ||
        null;
      if (code !== "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" && code !== "INVALID_CURSOR")
        throw error;
    }
    return { accounts, ...(await read("")), full: true, restarted: true };
  }
  return { accounts, ...(await read("")), full: true, restarted: false };
}

const s = z.string();
const Account = z.object({
  account_id: s,
  type: s,
  subtype: s.nullable(),
  balances: z.object({ current: z.number().nullable(), last_updated_datetime: s.nullable() }),
});
const Txn = z.object({
  transaction_id: s,
  amount: z.number(),
  iso_currency_code: s.nullable(),
  date: s,
  name: s,
  merchant_name: s.nullable(),
  pending: z.boolean(),
  payment_meta: z.object({ reference_number: s.nullable() }).partial().optional(),
});
const Removed = z.object({ transaction_id: s });

export interface PlaidLinks {
  /** Bank reference number per transaction id: the id of the record the money paid. */
  references: Map<string, string>;
}

/**
 * Depository accounts the company cannot spend from. A pledged CD (lease collateral) is the
 * only such subtype in the mock; anything else counts as usable cash.
 */
const RESTRICTED_SUBTYPES = new Set(["cd"]);

function toBankTxn(t: z.infer<typeof Txn>): BankTxn {
  const ref = t.payment_meta?.reference_number ?? null;
  // The bank's reference number names the record (payroll run, bill). Keep it in the text so
  // the cash flow statement can classify the line by id even if the bank shortens the name.
  const description =
    ref && !t.name.includes(ref) && ref !== t.transaction_id ? `${t.name} ${ref}` : t.name;
  return {
    id: t.transaction_id,
    date: t.date,
    amount: -cents(t.amount),
    description,
    ...(t.merchant_name !== null && { counterparty: t.merchant_name }),
  };
}

export function translatePlaid(raw: PlaidRaw, previous: BankTxn[] = []): Translated<PlaidLinks> {
  const skipped: Skip[] = [];
  const notes: string[] = [];
  if (raw.restarted) notes.push("bank history changed since the last sync: read it again in full");
  const accounts = parseEach(Account, raw.accounts, "Plaid account", skipped).filter((a) => {
    const ok = a.type === "depository" && a.balances.current !== null;
    if (!ok) skipped.push({ id: a.account_id, reason: "not a depository account with a balance" });
    return ok;
  });
  const usable = accounts.filter((a) => !RESTRICTED_SUBTYPES.has(a.subtype ?? ""));
  const restricted = accounts.filter((a) => RESTRICTED_SUBTYPES.has(a.subtype ?? ""));
  const total = (xs: typeof accounts) => xs.reduce((t, a) => t + cents(a.balances.current ?? 0), 0);
  const updated = accounts.map((a) => a.balances.last_updated_datetime).find((d) => d !== null);
  const balances: Balances | undefined =
    usable.length > 0 && updated
      ? { asOf: dateOf(updated), cashOnHand: total(usable), restrictedCash: total(restricted) }
      : undefined;

  const references = new Map<string, string>();
  const parse = (items: unknown[]) =>
    parseEach(Txn, items, "Plaid transaction", skipped).filter((t) => {
      if (t.pending)
        skipped.push({ id: t.transaction_id, reason: "pending: counted once it posts" });
      else if (t.iso_currency_code !== "USD")
        skipped.push({ id: t.transaction_id, reason: "not in US dollars" });
      else {
        const ref = t.payment_meta?.reference_number;
        if (ref) references.set(t.transaction_id, ref);
        return true;
      }
      return false;
    });
  const byId = new Map<string, BankTxn>(raw.full ? [] : previous.map((t) => [t.id, t]));
  for (const t of keepValid(
    BankTxnSchema,
    [...parse(raw.added), ...parse(raw.modified)].map(toBankTxn),
    "bank transaction",
    skipped,
  ))
    byId.set(t.id, t);
  for (const r of parseEach(Removed, raw.removed, "Plaid removed transaction", skipped))
    byId.delete(r.transaction_id);
  if (!raw.full)
    notes.push(
      `incremental sync: ${raw.added.length} new, ${raw.modified.length} changed, ${raw.removed.length} removed`,
    );

  return {
    lists: { bankTxns: [...byId.values()] },
    ...(balances && { balances }),
    links: { references },
    skipped,
    recordsIn: raw.accounts.length + raw.added.length + raw.modified.length + raw.removed.length,
    notes,
  };
}
