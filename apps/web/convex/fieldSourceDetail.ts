/**
 * One data source as the brain map shows it (public, read only). No writes, no vendor calls.
 *
 * Query
 *   fieldSourceDetail.get({ companyId, tool })  null when the company does not exist:
 *     the tool's connections row, the records in the latest snapshot that this tool is the
 *     record for, and what the ingestion agent last did with it (from the log).
 *
 * Attribution follows the connectors: translators keep each vendor's own record id as the
 * canonical id, and pullAll merges lists with id-linked dedupe where the first connected tool in
 * OWNERS keeps every record (Stripe invoices over QuickBooks copies, QuickBooks bills over Ramp
 * Bill Pay copies). A list whose owner is disconnected keeps its last values, marked stale.
 */
import { type Snapshot, SnapshotSchema } from "@domino/contracts";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { toolInfo } from "./connectors/catalog";
import { LIST_NAMES, type ListName, TOOL_IDS, type ToolId } from "./connectors/types";
import { toolArg } from "./lib/connectionRows";

/** Record precedence per list, as connectors/pullAll.ts OWNERS (a test checks they agree). */
export const LIST_OWNERS: Record<ListName, ToolId[]> = {
  customers: ["stripe"],
  invoices: ["stripe", "qbo"],
  bankTxns: ["plaid"],
  bills: ["qbo", "ramp"],
  cardTxns: ["ramp"],
  payroll: ["gusto"],
  deals: ["hubspot"],
  billingPlans: ["stripe"],
  pendingPayouts: ["stripe"],
};

export const LIST_LABEL: Record<ListName, string> = {
  customers: "Customers",
  invoices: "Invoices",
  bankTxns: "Bank transactions",
  bills: "Bills",
  cardTxns: "Card charges",
  payroll: "Payroll runs",
  deals: "Deals",
  billingPlans: "Subscriptions",
  pendingPayouts: "Payouts on the way",
};

/** The tool whose records a list holds: the first connected owner, else the main one (stale). */
export function ownerOfList(list: ListName, connected: readonly ToolId[]): ToolId {
  const owners = LIST_OWNERS[list];
  return owners.find((t) => connected.includes(t)) ?? (owners[0] as ToolId);
}

export type SourceRecord = {
  id: string;
  list: ListName;
  /** Plain words: "Invoice paid", "Card charge", "Deposit". */
  type: string;
  counterparty: string;
  /** Integer cents; negative is money out. Null when the record has no amount (customers). */
  amount: number | null;
  date: string | null;
};

export type SourceList = { list: ListName; label: string; count: number; stale: boolean };

/** Every record in the snapshot that `tool` is the record for, in plain words. */
export function attributeRecords(
  snapshot: Snapshot,
  tool: ToolId,
  connected: readonly ToolId[],
): { lists: SourceList[]; records: SourceRecord[] } {
  const names = new Map(snapshot.customers.map((c) => [c.id, c.name]));
  const customer = (id: string) => names.get(id) ?? `Customer ${id}`;
  const lists: SourceList[] = [];
  const records: SourceRecord[] = [];
  for (const list of LIST_NAMES) {
    if (ownerOfList(list, connected) !== tool) continue;
    const rows = rowsOf(snapshot, list, customer);
    lists.push({
      list,
      label: LIST_LABEL[list],
      count: rows.length,
      stale: !connected.includes(tool),
    });
    records.push(...rows);
  }
  return { lists, records };
}

function rowsOf(s: Snapshot, list: ListName, customer: (id: string) => string): SourceRecord[] {
  const row = (r: Omit<SourceRecord, "list">): SourceRecord => ({ ...r, list });
  switch (list) {
    case "customers":
      return s.customers.map((c) =>
        row({ id: c.id, type: "Customer", counterparty: c.name, amount: null, date: null }),
      );
    case "invoices":
      return s.invoices.map((i) =>
        row({
          id: i.id,
          type: i.paid ? "Invoice paid" : i.writtenOff ? "Invoice written off" : "Invoice sent",
          counterparty: customer(i.customerId),
          amount: i.paidAmount ?? i.amount,
          date: i.paid ?? i.writtenOff ?? i.issued,
        }),
      );
    case "bankTxns":
      return s.bankTxns.map((t) =>
        row({
          id: t.id,
          type: t.amount >= 0 ? "Deposit" : "Payment",
          counterparty: t.counterparty ?? t.description,
          amount: t.amount,
          date: t.date,
        }),
      );
    case "bills":
      return s.bills.map((b) =>
        row({
          id: b.id,
          type: b.paid ? "Bill paid" : "Bill due",
          counterparty: b.vendor,
          amount: -b.amount,
          date: b.paid ?? b.due,
        }),
      );
    case "cardTxns":
      return s.cardTxns.map((t) =>
        row({
          id: t.id,
          type: "Card charge",
          counterparty: t.merchant,
          amount: -Math.abs(t.amount),
          date: t.date,
        }),
      );
    case "payroll":
      return s.payroll.map((p) =>
        row({
          id: p.id,
          type: "Payroll run",
          counterparty: "Team pay",
          amount: -Math.abs(p.amount),
          date: p.date,
        }),
      );
    case "deals":
      return s.deals.map((d) =>
        row({
          id: d.id,
          type: d.stage === "won" ? "Deal won" : d.stage === "lost" ? "Deal lost" : "Open deal",
          counterparty: customer(d.customerId),
          amount: d.amount,
          date: d.expectedClose,
        }),
      );
    case "billingPlans":
      return (s.billingPlans ?? []).map((p) =>
        row({
          id: p.id,
          type: "Subscription",
          counterparty: customer(p.customerId),
          amount: p.amount,
          date: p.anchorDate,
        }),
      );
    case "pendingPayouts":
      return (s.pendingPayouts ?? []).map((p) =>
        row({
          id: p.id,
          type: "Payout on the way",
          counterparty: "Your bank",
          amount: p.amount,
          date: p.expectedArrival,
        }),
      );
  }
}

/**
 * The latest records read: newest dated records up to the snapshot date (records dated later,
 * like bills due next month, only fill in when nothing earlier exists). Ties keep list order.
 */
export function latestRecords(records: SourceRecord[], asOf: string, limit = 8): SourceRecord[] {
  const dated = records.filter((r) => r.date !== null);
  const past = dated.filter((r) => (r.date ?? "") <= asOf);
  const pool = past.length > 0 ? past : dated;
  return [...pool]
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (b.r.date ?? "").localeCompare(a.r.date ?? "") || a.i - b.i)
    .slice(0, limit)
    .map(({ r }) => r);
}

/** Log fields this view reads. Rows newest first. */
export type SourceLogRow = {
  at: string;
  action: string;
  refs: string[];
  source?: string;
  tool?: string;
  summary?: string;
  runId?: string;
  event?: string;
  status?: string;
  currentTask?: string;
  step?: number;
  steps?: number;
};

export type SourceConnection = {
  status: "connected" | "disconnected" | "error";
  account: string;
  connectedAt: string | null;
  lastSyncAt: string | null;
  cursor: string | null;
  recordsIn: number;
  recordsOut: number;
  skipped: number;
  checksOk: number;
  checksTotal: number;
  lastError: string | null;
};

export type SourceTask = {
  state: "reading" | "done" | "failed" | "idle";
  /** "Reading page 3 of 26 from Stripe", or the last pull's own summary. */
  text: string;
  at: string | null;
  progress?: number;
};

export type SourceDetail = {
  tool: ToolId;
  name: string;
  kind: string;
  status: "connected" | "disconnected" | "error" | "never";
  account: string | null;
  connectedAt: string | null;
  /** Last read that finished without an error. */
  lastReadAt: string | null;
  lastError: string | null;
  cursor: string | null;
  /** Plain words for the cursor: where the next read starts. */
  position: string;
  pages: number | null;
  /** Vendor endpoints the last read called ("/v1/customers"). */
  endpoints: string[];
  recordsIn: number;
  recordsOut: number;
  skipped: number;
  checksOk: number;
  checksTotal: number;
  /** Date of the snapshot the records come from. */
  asOf: string | null;
  lists: SourceList[];
  recent: SourceRecord[];
  task: SourceTask;
};

/** "Read 2111 records from Stripe in 22 pages" (fieldJobs pullStep) -> numbers. */
export function parsePull(summary: string | undefined): { records: number; pages: number } | null {
  const m = /^Read (\d+) records? from .+ in (\d+) pages?$/.exec(summary ?? "");
  return m ? { records: Number(m[1]), pages: Number(m[2]) } : null;
}

const isMine = (row: SourceLogRow, tool: ToolId) =>
  row.source === tool || row.tool === `${tool}.read`;

/** What the ingestion agent is doing with this tool now, or did last. */
export function sourceTask(
  tool: ToolId,
  log: SourceLogRow[],
  connection: SourceConnection | null,
): SourceTask {
  const name = toolInfo(tool).name;
  const pull = log.find((r) => r.action === "ingest.pulled" && isMine(r, tool));
  const started = log.find((r) => r.action === "ingest.started");
  const runOpen =
    started?.runId !== undefined &&
    !log.some(
      (r) =>
        r.runId === started.runId &&
        (r.action === "ingest.pulled" ||
          r.action === "ingest.failed" ||
          r.action === "ingest.noChange"),
    );
  const live = connection !== null && connection.status !== "disconnected";
  if (runOpen && live && started) {
    const paged = log.find(
      (r) =>
        r.runId === started.runId &&
        isMine(r, tool) &&
        typeof r.step === "number" &&
        typeof r.steps === "number" &&
        r.steps > 0,
    );
    if (paged?.step !== undefined && paged.steps !== undefined)
      return {
        state: "reading",
        text: paged.currentTask ?? `Reading page ${paged.step} of ${paged.steps} from ${name}`,
        at: paged.at,
        progress: Math.min(1, paged.step / paged.steps),
      };
    return { state: "reading", text: `Reading ${name} now`, at: started.at };
  }
  if (connection?.status === "error")
    return {
      state: "failed",
      text: `Could not read ${name}: ${connection.lastError ?? "unknown error"}`,
      at: connection.lastSyncAt,
    };
  if (pull) return { state: "done", text: pull.summary ?? `Read ${name}`, at: pull.at };
  if (connection?.status === "disconnected")
    return { state: "idle", text: `Not connected: Domino does not read ${name}`, at: null };
  return { state: "idle", text: `${name} has not been read yet`, at: null };
}

const later = (a: string | null, b: string | null) => (a && b ? (a > b ? a : b) : (a ?? b));

export function buildSourceDetail(input: {
  tool: ToolId;
  connection: SourceConnection | null;
  connected: readonly ToolId[];
  snapshot: Snapshot | null;
  log: SourceLogRow[];
}): SourceDetail {
  const { tool, connection: c, connected, snapshot, log } = input;
  const info = toolInfo(tool);
  const pull = log.find((r) => r.action === "ingest.pulled" && isMine(r, tool));
  const counted = parsePull(pull?.summary);
  const attributed = snapshot
    ? attributeRecords(snapshot, tool, connected)
    : { lists: [], records: [] };
  const okSync = c && c.status === "connected" ? c.lastSyncAt : null;
  return {
    tool,
    name: info.name,
    kind: info.kind,
    status: c?.status ?? "never",
    account: c?.account ?? null,
    connectedAt: c?.connectedAt ?? null,
    lastReadAt: later(pull?.at ?? null, okSync),
    lastError: c?.lastError ?? null,
    cursor: c?.cursor ?? null,
    position: c?.cursor
      ? "Saved sync cursor: the next read asks only for new activity"
      : "No cursor: every read starts again from page 1",
    pages: counted?.pages ?? null,
    endpoints: pull?.refs ?? [],
    recordsIn: c?.recordsIn ?? counted?.records ?? 0,
    recordsOut: c?.recordsOut ?? 0,
    skipped: c?.skipped ?? 0,
    checksOk: c?.checksOk ?? 0,
    checksTotal: c?.checksTotal ?? 0,
    asOf: snapshot?.asOf ?? null,
    lists: attributed.lists,
    recent: snapshot ? latestRecords(attributed.records, snapshot.asOf) : [],
    task: sourceTask(tool, log, c),
  };
}

/** Recent log rows scanned for this tool's reads; a full ingest writes about a dozen. */
const LOG_SCAN = 300;

export const get = query({
  args: { companyId: v.id("companies"), tool: toolArg },
  handler: async (ctx, { companyId, tool }): Promise<SourceDetail | null> => {
    const company = await ctx.db.get("companies", companyId);
    if (!company) return null;
    const rows = await ctx.db
      .query("connections")
      .withIndex("by_companyId_and_tool", (q) => q.eq("companyId", companyId))
      .take(TOOL_IDS.length * 2);
    const row = rows.find((r) => r.tool === tool) ?? null;
    const feed = await ctx.db
      .query("feeds")
      .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
      .first();
    const saved = feed?.lastSnapshotId ? await ctx.db.get("snapshots", feed.lastSnapshotId) : null;
    const parsed = saved ? SnapshotSchema.safeParse(saved.data) : null;
    const log = await ctx.db
      .query("log")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(LOG_SCAN);
    return buildSourceDetail({
      tool,
      connection: row,
      connected: rows.filter((r) => r.status !== "disconnected").map((r) => r.tool),
      snapshot: parsed?.success ? parsed.data : null,
      log,
    });
  },
});
