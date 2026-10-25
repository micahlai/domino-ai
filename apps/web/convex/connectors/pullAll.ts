import { type BankTxn, type Snapshot, SnapshotSchema } from "@domino/contracts";
import { fetchGusto, translateGusto } from "./gusto";
import { fetchHubspot, translateHubspot } from "./hubspot";
import { fetchPlaid, translatePlaid } from "./plaid";
import { fetchQbo, translateQbo } from "./qbo";
import { fetchRamp, translateRamp } from "./ramp";
import { fetchStripe, translateStripe } from "./stripe";
import {
  type Balances,
  type Check,
  type Fetcher,
  LIST_NAMES,
  type ListName,
  type Lists,
  type Receipt,
  type Skip,
  TOOL_IDS,
  type ToolId,
  type Translated,
  emptyLists,
} from "./types";
import { VendorError } from "./vendorHttp";

/**
 * pullAll: the one entry point ingestion calls. Reads every connected tool from the
 * vendor-shaped mocks, translates each into canonical records with a mapping receipt, merges
 * them with id-linked dedupe, ties out the money two tools both describe, and validates the
 * result with SnapshotSchema. Pure apart from the fetcher; synthetic mocks only.
 *
 * Which tool is the record for what (the other copy is skipped with a reason):
 *   cash and restricted cash, bank transactions  Plaid (QuickBooks balances when no bank)
 *   customers, invoices, billing plans, payouts in transit  Stripe (QuickBooks invoices when no Stripe)
 *   bills  QuickBooks (Ramp Bill Pay bills when not in the books)
 *   card transactions  Ramp; payroll runs  Gusto; deals  HubSpot
 * Paid Stripe payouts are the bank deposits that carry their trace id, so cash counts once.
 */
export interface ConnectionInput {
  tool: ToolId;
  status: "connected" | "disconnected" | "error";
}

/** Per-tool sync position. Only Plaid reads incrementally; the other tools re-read in pages. */
export type PullCursor = Partial<Record<ToolId, string | null>>;

export interface PullSince {
  cursor: PullCursor;
  /** The bank transactions the cursor was saved with, to merge new activity into. */
  bankTxns: BankTxn[];
}

export interface PullAllResult {
  records: Lists;
  balances: Balances | null;
  /** The validated Snapshot, or null with snapshotError when it cannot be built yet. */
  snapshot: Snapshot | null;
  snapshotError: string | null;
  cursor: PullCursor;
  log: Receipt[];
  checks: Check[];
}

type AnyTranslated = Translated<unknown>;

const receiptFor = (tool: ToolId): Receipt => ({
  tool,
  calls: [],
  recordsIn: 0,
  recordsOut: 0,
  counts: {},
  skipped: [],
  notes: [],
  error: null,
});

const calls = (pages: Record<string, number>) =>
  Object.entries(pages).map(([endpoint, n]) => ({ endpoint, pages: n }));

export async function pullAll(args: {
  fetcher: Fetcher;
  companyId: string;
  connections: ConnectionInput[];
  since?: PullSince;
}): Promise<PullAllResult> {
  const { fetcher, companyId, since } = args;
  const on = new Set(args.connections.filter((c) => c.status === "connected").map((c) => c.tool));
  const log = new Map<ToolId, Receipt>();
  const out = new Map<ToolId, AnyTranslated>();
  const cursor: PullCursor = {};

  async function run(tool: ToolId, go: (r: Receipt) => Promise<AnyTranslated>) {
    if (!on.has(tool)) return;
    const receipt = receiptFor(tool);
    log.set(tool, receipt);
    try {
      const t = await go(receipt);
      out.set(tool, t);
      receipt.recordsIn = t.recordsIn;
      receipt.skipped.push(...t.skipped);
      receipt.notes.push(...t.notes);
    } catch (error) {
      receipt.error =
        error instanceof VendorError
          ? `${error.endpoint} answered ${error.status}`
          : error instanceof Error
            ? error.message
            : "unknown error";
    }
  }

  await run("stripe", async (r) => {
    const raw = await fetchStripe(fetcher);
    r.calls = calls(raw.pages);
    return translateStripe(raw);
  });
  await run("ramp", async (r) => {
    const raw = await fetchRamp(fetcher);
    r.calls = calls(raw.pages);
    return translateRamp(raw);
  });
  await run("qbo", async (r) => {
    const raw = await fetchQbo(fetcher, companyId);
    r.calls = calls(raw.pages);
    return translateQbo(raw);
  });
  await run("gusto", async (r) => {
    const raw = await fetchGusto(fetcher, companyId);
    r.calls = [{ endpoint: "/v1/companies/:company_uuid/payrolls", pages: raw.pages }];
    return translateGusto(raw);
  });
  await run("hubspot", async (r) => {
    const raw = await fetchHubspot(fetcher);
    r.calls = [{ endpoint: "/crm/v3/objects/deals", pages: raw.pages }];
    return translateHubspot(raw);
  });
  await run("plaid", async (r) => {
    const raw = await fetchPlaid(fetcher, since?.cursor.plaid ?? null);
    r.calls = [
      { endpoint: "/accounts/get", pages: 1 },
      { endpoint: "/transactions/sync", pages: raw.pages },
    ];
    cursor.plaid = raw.cursor;
    return translatePlaid(raw, since?.bankTxns ?? []);
  });
  for (const tool of TOOL_IDS) if (!on.has(tool)) cursor[tool] = null;

  const merged = merge(out, log);
  const checks = tieOut(out, merged.records);
  for (const [tool, receipt] of log) {
    const t = out.get(tool);
    if (!t) continue;
    receipt.recordsOut = Object.values(receipt.counts).reduce((a, b) => a + (b ?? 0), 0);
  }

  let snapshot: Snapshot | null = null;
  let snapshotError: string | null = null;
  if (!merged.balances)
    snapshotError = "Connect a bank (Plaid) or books (QuickBooks) for the cash balance";
  else {
    const { billingPlans, pendingPayouts, ...lists } = merged.records;
    // Optional lists are left out when empty, so the snapshot stays plain JSON for Convex.
    const parsed = SnapshotSchema.safeParse({
      companyId,
      ...merged.balances,
      ...lists,
      ...(billingPlans.length > 0 && { billingPlans }),
      ...(pendingPayouts.length > 0 && { pendingPayouts }),
    });
    if (parsed.success) snapshot = parsed.data;
    else
      snapshotError = `records fail the Snapshot contract at ${parsed.error.issues
        .slice(0, 3)
        .map((i) => i.path.join("."))
        .join(", ")}`;
  }
  return {
    records: merged.records,
    balances: merged.balances,
    snapshot,
    snapshotError,
    cursor,
    log: TOOL_IDS.flatMap((t) => log.get(t) ?? []),
    checks,
  };
}

/** Record precedence per list: the first tool that has an id keeps it; later copies are skipped. */
const OWNERS: Record<ListName, ToolId[]> = {
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
const TOOL_NAME: Record<ToolId, string> = {
  stripe: "Stripe",
  ramp: "Ramp",
  qbo: "QuickBooks",
  gusto: "Gusto",
  hubspot: "HubSpot",
  plaid: "the bank (Plaid)",
};

function merge(out: Map<ToolId, AnyTranslated>, log: Map<ToolId, Receipt>) {
  const records = emptyLists();
  for (const list of LIST_NAMES) {
    const kept = new Map<string, ToolId>();
    const rows: { id: string }[] = [];
    for (const tool of OWNERS[list]) {
      const items = (out.get(tool)?.lists[list] ?? []) as { id: string }[];
      const receipt = log.get(tool);
      let count = 0;
      for (const item of items) {
        const first = kept.get(item.id);
        if (first) {
          receipt?.skipped.push({
            id: item.id,
            reason: `same record as ${TOOL_NAME[first]} ${item.id}`,
          });
          continue;
        }
        kept.set(item.id, tool);
        rows.push(item);
        count++;
      }
      if (receipt && items.length > 0) receipt.counts[list] = count;
    }
    (records[list] as { id: string }[]) = rows;
  }
  // Paid payouts are counted once, as the bank deposit carrying their trace id.
  const stripe = out.get("stripe");
  const bankIds = new Set(records.bankTxns.map((t) => t.id));
  const payoutSkips: Skip[] = (
    (stripe?.links as { payouts?: { id: string; trace: string | null }[] } | undefined)?.payouts ??
    []
  ).map((p) => ({
    id: p.id,
    reason:
      p.trace && bankIds.has(p.trace)
        ? `counted once, as bank deposit ${p.trace}`
        : "paid out to the bank: counted from the bank feed",
  }));
  log.get("stripe")?.skipped.push(...payoutSkips);

  const balances = out.get("plaid")?.balances ?? out.get("qbo")?.balances ?? null;
  if (out.get("plaid")?.balances && out.get("qbo")?.balances)
    log
      .get("qbo")
      ?.notes.push("cash balance comes from the bank; the books balance is checked against it");
  return { records, balances };
}

function tieOut(out: Map<ToolId, AnyTranslated>, records: Lists): Check[] {
  const checks: Check[] = [];
  const plaid = out.get("plaid") as ReturnType<typeof translatePlaid> | undefined;
  if (!plaid) return checks;
  const full = !plaid.notes.some((n) => n.startsWith("incremental"));
  const bank = new Map(records.bankTxns.map((t) => [t.id, t]));
  // A run or payment can leave the bank as several debits (net pay and taxes, for example)
  // that carry the same reference; the tie-out compares their sum.
  const byRef = new Map<string, Pick<BankTxn, "amount">>();
  for (const [id, ref] of plaid.links.references) {
    const t = bank.get(id);
    if (t) byRef.set(ref, { amount: (byRef.get(ref)?.amount ?? 0) + t.amount });
  }
  const add = (name: string, ref: string, ok: boolean, detail: string) =>
    checks.push({ name, ref, ok, detail });
  const missing = (name: string, ref: string, what: string) => {
    // An incremental sync only sees new bank activity; older matches were checked before.
    if (full) add(name, ref, false, `no bank ${what} with reference ${ref}`);
  };

  const stripe = out.get("stripe") as ReturnType<typeof translateStripe> | undefined;
  for (const p of stripe?.links.payouts ?? []) {
    const t = p.trace ? bank.get(p.trace) : undefined;
    if (!t) missing("Stripe payout = bank deposit", p.id, "deposit");
    else
      add(
        "Stripe payout = bank deposit",
        p.id,
        t.amount === p.amount,
        `${p.amount} vs ${t.amount} cents`,
      );
  }
  const paidAmount = new Map(records.invoices.map((i) => [i.id, i.paidAmount]));
  for (const c of stripe?.links.charges ?? []) {
    const expected = paidAmount.get(c.invoice);
    if (expected !== undefined)
      add(
        "Stripe charge = invoice paid amount",
        c.id,
        expected === c.amount,
        `${c.amount} vs ${expected} cents`,
      );
  }
  const gusto = out.get("gusto") as ReturnType<typeof translateGusto> | undefined;
  for (const run of gusto?.links.processed ?? []) {
    const t = byRef.get(run.id);
    if (!t) missing("Gusto payroll = bank debit", run.id, "debit");
    else
      add(
        "Gusto payroll = bank debit",
        run.id,
        t.amount === -run.amount,
        `${run.amount} vs ${-t.amount} cents`,
      );
  }
  const qbo = out.get("qbo") as ReturnType<typeof translateQbo> | undefined;
  for (const bp of qbo?.links.billPayments ?? []) {
    const t = byRef.get(bp.billId);
    if (!t) missing("QuickBooks bill payment = bank debit", bp.billId, "debit");
    else
      add(
        "QuickBooks bill payment = bank debit",
        bp.billId,
        t.amount === -bp.amount,
        `${bp.amount} vs ${-t.amount} cents`,
      );
  }
  const ramp = out.get("ramp") as ReturnType<typeof translateRamp> | undefined;
  const qboPaid = new Map((qbo?.links.billPayments ?? []).map((bp) => [bp.billId, bp]));
  for (const rb of ramp?.links.bills ?? []) {
    if (!rb.paid || !qbo) continue;
    const bp = qboPaid.get(rb.billId);
    add(
      "Ramp bill payment = QuickBooks bill payment",
      rb.rampId,
      !!bp && bp.amount === rb.amount && bp.date === rb.paid && bp.rampId === rb.rampId,
      bp ? `${rb.amount} on ${rb.paid} vs ${bp.amount} on ${bp.date}` : "not in the books",
    );
  }
  if (plaid.balances && qbo?.balances)
    add(
      "Books cash = bank cash",
      "cashOnHand",
      plaid.balances.cashOnHand === qbo.balances.cashOnHand,
      `${qbo.balances.cashOnHand} vs ${plaid.balances.cashOnHand} cents`,
    );
  return checks;
}

/** Counts per Snapshot list, for status rows and the connect page. */
export function listCounts(records: Lists): Record<ListName, number> {
  return Object.fromEntries(LIST_NAMES.map((l) => [l, records[l].length])) as Record<
    ListName,
    number
  >;
}
