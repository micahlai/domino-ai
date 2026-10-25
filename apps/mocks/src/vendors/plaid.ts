import type { BankTxn, Snapshot } from "@domino/contracts";
import {
  type Item,
  type VendorRoute,
  b64url,
  bankReference,
  dollarNumber,
  fnv,
  intParam,
  isStripeDeposit,
  json,
  unb64url,
} from "./common";

/**
 * Plaid-shaped mock bank: GET /accounts/get and GET /transactions/sync?cursor=&count=
 * (count 1-500, default 100). The real API is POST with a JSON body; this mock reads the same
 * fields from the query string because the mock server is GET-only.
 *
 * Plaid's sign convention: positive amount = money out. Sync returns added/modified/removed
 * plus next_cursor and has_more. The cursor is a position in the bank's posting order with a
 * fingerprint of everything before it; if earlier history changed, the cursor is refused with
 * TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION and the client restarts from an empty cursor.
 */
const CHECKING = "acc_operating_checking";
const COLLATERAL = "acc_lease_collateral";

function category(t: BankTxn): { primary: string; detailed: string } {
  const d = t.description.toUpperCase();
  if (isStripeDeposit(t))
    return { primary: "TRANSFER_IN", detailed: "TRANSFER_IN_ACCOUNT_TRANSFER" };
  if (d.includes("PAYROLL"))
    return { primary: "GENERAL_SERVICES", detailed: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES" };
  if (d.includes("CARD SETTLEMENT"))
    return { primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" };
  if (t.amount > 0) return { primary: "INCOME", detailed: "INCOME_OTHER_INCOME" };
  return { primary: "GENERAL_SERVICES", detailed: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES" };
}

export function transaction(s: Snapshot, t: BankTxn): Item {
  const name = t.counterparty ?? null;
  return {
    transaction_id: t.id,
    account_id: CHECKING,
    amount: dollarNumber(-t.amount),
    iso_currency_code: "USD",
    date: t.date,
    authorized_date: t.date,
    name: t.description,
    merchant_name: name,
    counterparties: name
      ? [{ name, type: t.amount > 0 ? "financial_institution" : "merchant" }]
      : [],
    payment_channel: "other",
    pending: false,
    personal_finance_category: { ...category(t), confidence_level: "VERY_HIGH" },
    payment_meta: { reference_number: bankReference(s, t), payee: null, payer: null, ppd_id: null },
  };
}

export function accounts(s: Snapshot): Item[] {
  // The bank shows balances as of the close of the as-of day.
  const updated = `${s.asOf}T23:59:59Z`;
  return [
    {
      account_id: CHECKING,
      name: "Operating checking",
      official_name: "Business Checking",
      mask: "0042",
      type: "depository",
      subtype: "checking",
      balances: {
        current: dollarNumber(s.cashOnHand),
        available: dollarNumber(s.cashOnHand),
        iso_currency_code: "USD",
        last_updated_datetime: updated,
      },
    },
    {
      account_id: COLLATERAL,
      name: "Lease collateral",
      official_name: "Certificate of deposit (pledged)",
      mask: "0077",
      type: "depository",
      // A pledged CD: the company owns the money but cannot spend it.
      subtype: "cd",
      balances: {
        current: dollarNumber(s.restrictedCash),
        available: 0,
        iso_currency_code: "USD",
        last_updated_datetime: updated,
      },
    },
  ];
}

const fingerprint = (txns: BankTxn[], upTo: number) =>
  fnv(
    txns
      .slice(0, upTo)
      .map((t) => `${t.id}|${t.date}|${t.amount}|${t.description}`)
      .join("\n"),
  );

const plaidError = (status: number, type: string, code: string, message: string) =>
  json(status, {
    error_type: type,
    error_code: code,
    error_message: message,
    display_message: null,
    request_id: "mock",
  });

export const plaidRoute: VendorRoute = (rest, url, s) => {
  const item = { item_id: `item_${s.companyId}`, institution_id: "ins_mock_bank" };
  if (rest === "/accounts/get")
    return json(200, { accounts: accounts(s), item, request_id: "mock" });
  if (rest !== "/transactions/sync") return null;
  const count = intParam(url, "count", 1, 500) ?? 100;
  if (Number.isNaN(count))
    return plaidError(400, "INVALID_REQUEST", "INVALID_FIELD", "count must be 1 to 500.");
  // Posting order is the order the bank received the transactions.
  const txns = s.bankTxns;
  const raw = url.searchParams.get("cursor") ?? "";
  let start = 0;
  if (raw !== "") {
    const parsed = (() => {
      try {
        const v: unknown = JSON.parse(unb64url(raw) ?? "");
        return v && typeof v === "object" && "i" in v && "h" in v
          ? (v as { i: unknown; h: unknown })
          : null;
      } catch {
        return null;
      }
    })();
    if (!parsed || typeof parsed.i !== "number" || !Number.isInteger(parsed.i) || parsed.i < 0)
      return plaidError(400, "INVALID_INPUT", "INVALID_CURSOR", "cursor is not valid.");
    if (parsed.i > txns.length || parsed.h !== fingerprint(txns, parsed.i))
      return plaidError(
        400,
        "TRANSACTIONS_ERROR",
        "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
        "Earlier transactions changed. Restart sync from an empty cursor.",
      );
    start = parsed.i;
  }
  const end = Math.min(txns.length, start + count);
  return json(200, {
    added: txns.slice(start, end).map((t) => transaction(s, t)),
    modified: [],
    removed: [],
    next_cursor: b64url(JSON.stringify({ i: end, h: fingerprint(txns, end) })),
    has_more: end < txns.length,
    transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
    accounts: accounts(s),
    request_id: "mock",
  });
};
