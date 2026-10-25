import type { PullAllResult } from "./pullAll";
import type { ListName, ToolId } from "./types";

/**
 * The tools a company can connect, in plain words, shared by the connect page and the
 * connections API. Domino only reads: every consent says so, and no mock route can move money.
 * The Nessie sandbox is written only to Domino's own accounts, with the simulated history.
 */
export interface ToolInfo {
  id: ToolId;
  name: string;
  initials: string;
  kind: string;
  /** What Domino reads, in plain words, for the consent step. */
  reads: string[];
  /** Short line for the card. */
  provides: string;
  lists: ListName[];
}

export const TOOLS: ToolInfo[] = [
  {
    id: "nessie",
    name: "Capital One (Nessie sandbox)",
    initials: "C1",
    kind: "Bank",
    reads: ["Account balances", "Deposits", "Withdrawals"],
    provides: "Cash balance and every deposit and payment, from the Capital One Nessie sandbox",
    lists: ["bankTxns"],
  },
  {
    id: "plaid",
    name: "Simulated bank (via Plaid)",
    initials: "Pl",
    kind: "Bank",
    reads: ["Account balances", "Bank transactions"],
    provides: "Cash balance and every deposit and payment",
    lists: ["bankTxns"],
  },
  {
    id: "stripe",
    name: "Stripe",
    initials: "St",
    kind: "Billing",
    reads: ["Customers", "Invoices", "Card payments", "Payouts to your bank", "Subscriptions"],
    provides: "Customers, invoices, subscriptions and payouts",
    lists: ["customers", "invoices", "billingPlans", "pendingPayouts"],
  },
  {
    id: "qbo",
    name: "QuickBooks Online",
    initials: "QB",
    kind: "Books",
    reads: ["Bank accounts", "Bills", "Bill payments", "Invoices", "Customer payments"],
    provides: "Bills to pay and the books' cash balance",
    lists: ["bills", "invoices"],
  },
  {
    id: "gusto",
    name: "Gusto",
    initials: "Gu",
    kind: "Payroll",
    reads: ["Payroll runs with totals (gross pay, employer taxes, net pay)"],
    provides: "Past and upcoming payroll runs",
    lists: ["payroll"],
  },
  {
    id: "ramp",
    name: "Ramp",
    initials: "Ra",
    kind: "Cards and bill pay",
    reads: ["Card transactions", "Bills paid through Ramp", "Reimbursements"],
    provides: "Card spending and bills paid through Ramp",
    lists: ["cardTxns", "bills"],
  },
  {
    id: "hubspot",
    name: "HubSpot",
    initials: "Hs",
    kind: "Sales",
    reads: ["Deals with amount, stage and close date"],
    provides: "Deals that may turn into invoices",
    lists: ["deals"],
  },
];

export const toolInfo = (id: ToolId): ToolInfo => {
  const t = TOOLS.find((x) => x.id === id);
  if (!t) throw new Error(`unknown tool ${id}`);
  return t;
};

/** Which tools each tie-out compares, so a tool card can show its own checks. */
export const CHECK_TOOLS: Record<string, ToolId[]> = {
  "Stripe payout = bank deposit": ["stripe", "plaid", "nessie"],
  "Stripe charge = invoice paid amount": ["stripe"],
  "Gusto payroll = bank debit": ["gusto", "plaid", "nessie"],
  "QuickBooks bill payment = bank debit": ["qbo", "plaid", "nessie"],
  "Ramp bill payment = QuickBooks bill payment": ["ramp", "qbo"],
  "Books cash = bank cash": ["qbo", "plaid", "nessie"],
};

export interface ToolSummary {
  tool: ToolId;
  error: string | null;
  cursor: string | null;
  counts: Record<string, number>;
  recordsIn: number;
  recordsOut: number;
  skipped: number;
  checksOk: number;
  checksTotal: number;
}

/** One row per tool read, with the tie-outs that tool takes part in. */
export function toolSummaries(r: PullAllResult): ToolSummary[] {
  return r.log.map((l) => {
    const mine = r.checks.filter((c) => CHECK_TOOLS[c.name]?.includes(l.tool));
    return {
      tool: l.tool,
      error: l.error,
      cursor: r.cursor[l.tool] ?? null,
      counts: Object.fromEntries(
        Object.entries(l.counts).filter((e): e is [string, number] => e[1] !== undefined),
      ),
      recordsIn: l.recordsIn,
      recordsOut: l.recordsOut,
      skipped: l.skipped.length,
      checksOk: mine.filter((c) => c.ok).length,
      checksTotal: mine.length,
    };
  });
}
