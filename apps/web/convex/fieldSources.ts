import { type Snapshot, SnapshotSchema } from "@domino/contracts";
import { CHECK_TOOLS, type ToolSummary, toolSummaries } from "./connectors/catalog";
import type { NessiePlan } from "./connectors/nessie";
import { type PullAllResult, pullAll } from "./connectors/pullAll";
import { type Fetcher, LIST_NAMES, type ListName, TOOL_IDS, type ToolId } from "./connectors/types";

/**
 * Field ingestion through the connectors (pure, no Convex functions): read every connected
 * tool with connectors/pullAll (vendor-shaped mocks, cursor paging, id-linked dedupe, cross-tool
 * tie-outs), then build one validated Snapshot. A disconnected tool is not read: the lists it
 * is the record for keep their last ingested values (stale) until it is connected again.
 * No money is estimated; every amount is the vendor's own value converted exactly.
 */
export type { Fetcher };

/** The `sources` row kind each tool updates (the original mock server names). */
export type SourceKind = "stripe" | "crm" | "ramp" | "books" | "payroll" | "nessie";
export const SOURCE_OF_TOOL: Record<ToolId, SourceKind> = {
  stripe: "stripe",
  hubspot: "crm",
  ramp: "ramp",
  qbo: "books",
  gusto: "payroll",
  plaid: "nessie",
  nessie: "nessie",
};

/** Connect page and log wording when the Nessie sandbox cannot be used for a run. */
export const BANK_FALLBACK = "Nessie unreachable, using simulated bank";

export interface Pull {
  /** The connector that was read; also the log row's source. */
  tool: ToolId;
  endpoints: string[];
  records: number;
  pages: number;
  /** All cross-tool checks this tool takes part in agree. */
  tiedOut: boolean;
}

export interface TieOut {
  checked: number;
  mismatches: string[];
}

export interface Ingested {
  snapshot: Snapshot;
  pulls: Pull[];
  /** Disconnected tools, not read this run. */
  skipped: ToolId[];
  /** Lists kept from the previous version because their tool is disconnected. */
  stale: ListName[];
  tieOut: TieOut;
  /** Per-tool receipts for the connections rows (Connect page). */
  results: ToolSummary[];
  /** Why the Nessie bank was not used this run (the simulated bank was read instead), or null. */
  bankFallback: string | null;
}

/** The tools that can be the record for each list (connectors/pullAll.ts OWNERS). */
const PRIMARY: Record<ListName, ToolId[]> = {
  customers: ["stripe"],
  invoices: ["stripe"],
  bankTxns: ["nessie", "plaid"],
  bills: ["qbo"],
  cardTxns: ["ramp"],
  payroll: ["gusto"],
  deals: ["hubspot"],
  billingPlans: ["stripe"],
  pendingPayouts: ["stripe"],
};

const BANKS: ToolId[] = ["nessie", "plaid"];

export async function ingestConnected(args: {
  fetcher: Fetcher;
  companyId: string;
  connected: ToolId[];
  previous: Snapshot | null;
  /** Domino's own Nessie accounts, when they hold the whole served history. */
  nessie?: NessiePlan | null;
  /** Why Nessie cannot be used this run (not set up, unreachable, still posting). */
  nessieDown?: string | null;
}): Promise<Ingested> {
  const { fetcher, companyId, previous } = args;
  const on = new Set(args.connected);
  if (on.size === 0) throw new Error("No tools are connected: connect at least the bank or books");
  const read = (tools: Set<ToolId>) =>
    pullAll({
      fetcher,
      companyId,
      nessie: args.nessie ?? null,
      connections: TOOL_IDS.map((tool) => ({
        tool,
        status: tools.has(tool) ? ("connected" as const) : ("disconnected" as const),
      })),
    });
  // The simulated bank (the Plaid mock) stands in for Nessie when the sandbox cannot be used.
  const fallbackTo = (reason: string) => {
    on.delete("nessie");
    on.add("plaid");
    return reason;
  };
  let bankFallback: string | null = null;
  if (on.has("nessie") && (args.nessieDown || !args.nessie))
    bankFallback = fallbackTo(args.nessieDown ?? "Nessie is not set up for this company yet");
  let r: PullAllResult = await read(on);
  const nessieError = r.log.find((l) => l.tool === "nessie")?.error;
  if (nessieError) {
    bankFallback = fallbackTo(nessieError);
    r = await read(on);
  }
  const failed = r.log.find((l) => l.error);
  if (failed) throw new Error(`${failed.tool} could not be read: ${failed.error}`);

  const stale = LIST_NAMES.filter((list) => !PRIMARY[list].some((t) => on.has(t)));
  const records = { ...r.records };
  for (const list of stale)
    (records[list] as unknown[]) = previous ? [...((previous[list] as unknown[]) ?? [])] : [];
  const balances =
    r.balances ??
    (previous
      ? {
          asOf: previous.asOf,
          cashOnHand: previous.cashOnHand,
          restrictedCash: previous.restrictedCash,
        }
      : null);
  if (!balances) throw new Error(r.snapshotError ?? "No cash balance: connect the bank or books");

  const { billingPlans, pendingPayouts, ...lists } = records;
  // Optional lists are left out when empty, so the snapshot stays plain JSON for Convex.
  const parsed = SnapshotSchema.safeParse({
    companyId,
    ...balances,
    ...lists,
    ...(billingPlans.length > 0 && { billingPlans }),
    ...(pendingPayouts.length > 0 && { pendingPayouts }),
  });
  if (!parsed.success)
    throw new Error(
      `records fail the Snapshot contract at ${parsed.error.issues
        .slice(0, 3)
        .map((i) => i.path.join("."))
        .join(", ")}`,
    );

  const pulls: Pull[] = r.log.map((l) => {
    const mine = r.checks.filter((c) => CHECK_TOOLS[c.name]?.includes(l.tool));
    return {
      tool: l.tool,
      endpoints: l.calls.map((c) => c.endpoint),
      records: l.recordsIn,
      pages: l.calls.reduce((n, c) => n + c.pages, 0),
      tiedOut: mine.every((c) => c.ok),
    };
  });
  const bankRead = BANKS.some((t) => on.has(t));
  const results = toolSummaries(r);
  if (bankFallback)
    results.push({
      tool: "nessie",
      error: `${BANK_FALLBACK}: ${bankFallback}`.slice(0, 300),
      cursor: null,
      counts: {},
      recordsIn: 0,
      recordsOut: 0,
      skipped: 0,
      checksOk: 0,
      checksTotal: 0,
    });
  return {
    snapshot: parsed.data,
    pulls,
    // The other bank is an alternative, not a skipped source, once one bank was read.
    skipped: TOOL_IDS.filter(
      (t) => !on.has(t) && !(bankRead && BANKS.includes(t)) && !(bankFallback && t === "nessie"),
    ),
    stale,
    tieOut: {
      checked: r.checks.length,
      mismatches: r.checks.filter((c) => !c.ok).map((c) => c.ref),
    },
    results,
    bankFallback,
  };
}
