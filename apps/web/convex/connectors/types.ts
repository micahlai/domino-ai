import type {
  BankTxn,
  Bill,
  BillingPlan,
  CardTxn,
  Customer,
  Deal,
  Invoice,
  PayrollRun,
  PendingPayout,
} from "@domino/contracts";
import type { z } from "zod";

/**
 * Shared types for the per-tool connectors (pure, no Convex functions). A connector pages
 * through one vendor-shaped mock API and translates its JSON into canonical Snapshot records.
 * Synthetic mocks, except the bank: Capital One Nessie is the real sandbox API (connectors/nessie.ts).
 */
export type Fetcher = (path: string) => Promise<Response>;

export const TOOL_IDS = ["stripe", "ramp", "qbo", "gusto", "hubspot", "plaid", "nessie"] as const;
export type ToolId = (typeof TOOL_IDS)[number];
/** The tools served by the in-process vendor mocks (every tool but the Nessie sandbox bank). */
export type MockToolId = Exclude<ToolId, "nessie">;
export const MOCK_TOOL_IDS = TOOL_IDS.filter((t): t is MockToolId => t !== "nessie");

/** Canonical lists a connector can fill, named as in SnapshotSchema. */
export interface Lists {
  customers: Customer[];
  invoices: Invoice[];
  bankTxns: BankTxn[];
  bills: Bill[];
  cardTxns: CardTxn[];
  payroll: PayrollRun[];
  deals: Deal[];
  billingPlans: BillingPlan[];
  pendingPayouts: PendingPayout[];
}
export type ListName = keyof Lists;
export const LIST_NAMES: ListName[] = [
  "customers",
  "invoices",
  "bankTxns",
  "bills",
  "cardTxns",
  "payroll",
  "deals",
  "billingPlans",
  "pendingPayouts",
];
export const emptyLists = (): Lists => ({
  customers: [],
  invoices: [],
  bankTxns: [],
  bills: [],
  cardTxns: [],
  payroll: [],
  deals: [],
  billingPlans: [],
  pendingPayouts: [],
});

export interface Balances {
  asOf: string;
  cashOnHand: number;
  restrictedCash: number;
}

export interface Skip {
  /** Vendor record id */
  id: string;
  reason: string;
}

/** What one tool's pull did: calls made, records in, records out, skipped with reason. */
export interface Receipt {
  tool: ToolId;
  calls: { endpoint: string; pages: number }[];
  recordsIn: number;
  recordsOut: number;
  /** Canonical records produced per Snapshot list, after cross-tool dedupe. */
  counts: Partial<Record<ListName, number>>;
  skipped: Skip[];
  notes: string[];
  error: string | null;
}

/** One cross-tool tie-out: two tools describing the same money, linked by id. */
export interface Check {
  name: string;
  ref: string;
  ok: boolean;
  detail: string;
}

/** A translator's output for one tool, before cross-tool merge. */
export interface Translated<Links = unknown> {
  lists: Partial<Lists>;
  balances?: Balances;
  /** Vendor facts that are not records themselves (payout traces, bill payments, ...). */
  links: Links;
  skipped: Skip[];
  recordsIn: number;
  notes: string[];
}

export type ZodShape<T> = z.ZodType<T, z.ZodTypeDef, unknown>;
