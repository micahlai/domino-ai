import { type BankTxn, BankTxnSchema, type Snapshot } from "@domino/contracts";
import { z } from "zod";
import type { Balances, Fetcher, Skip, Translated } from "./types";
import { getJson, keepValid, parseEach } from "./vendorHttp";

/**
 * Capital One Nessie connector: the bank, read from the real Nessie sandbox API.
 *
 * Nessie is a sandbox with no link to the simulated company, so Domino writes the company's
 * simulated bank history into its own Nessie customer and accounts first (syncNessie), then
 * reads balance and transactions back like any bank feed (fetchNessie, translateNessie).
 *
 * No-touch rule: the key's sandbox also holds another project's customers. Domino creates its
 * own customer and accounts (nickname prefix "domino-"), stores their ids, and only ever
 * calls paths under those stored ids. It never updates or deletes anything.
 *
 * Facts from the live probe (kb/research/nessie-api.md): create calls answer 201 with
 * objectCreated._id; transaction_date is stored as sent (back-dating works); the account
 * balance does not move with deposits or withdrawals, so the balance Nessie reports is the
 * opening balance and the cash on hand is that plus the posted transactions. Amounts are
 * integers; Domino sends integer cents.
 */

export const NESSIE_PREFIX = "domino-";
const MARKER = /^\[domino ([^\]]*)\] ?([\s\S]*)$/;

/** The record a bank line pays or collects: a payroll run, bill or card id named in its text. */
export function bankReference(s: Pick<Snapshot, "payroll" | "bills" | "cardTxns">, t: BankTxn) {
  const ids = new Set([
    ...s.payroll.map((p) => p.id),
    ...s.bills.map((b) => b.id),
    ...s.cardTxns.map((c) => c.id),
  ]);
  for (const token of t.description.split(/\s+/)) if (ids.has(token)) return token;
  return t.id;
}

/**
 * Nessie description for one bank line: Domino's id, the record it references and the
 * counterparty in a leading marker, then the bank's own text unchanged. The marker leads so a
 * shortened description still keeps the ids the tie-out and the cash flow statement need.
 */
export function encodeDescription(t: BankTxn, ref: string): string {
  const parts = [`id=${encodeURIComponent(t.id)}`];
  if (ref !== t.id) parts.push(`ref=${encodeURIComponent(ref)}`);
  if (t.counterparty !== undefined) parts.push(`cp=${encodeURIComponent(t.counterparty)}`);
  return `[domino ${parts.join(" ")}] ${t.description}`;
}

export interface Marked {
  id: string;
  ref: string;
  counterparty?: string;
  description: string;
}

export function decodeDescription(text: string): Marked | null {
  const m = MARKER.exec(text);
  if (!m) return null;
  const fields = new Map<string, string>();
  for (const part of (m[1] ?? "").split(" ")) {
    const eq = part.indexOf("=");
    if (eq <= 0) return null;
    try {
      fields.set(part.slice(0, eq), decodeURIComponent(part.slice(eq + 1)));
    } catch {
      return null;
    }
  }
  const id = fields.get("id");
  if (!id) return null;
  const cp = fields.get("cp");
  return {
    id,
    ref: fields.get("ref") ?? id,
    ...(cp !== undefined && { counterparty: cp }),
    description: m[2] ?? "",
  };
}

// ---------- Transport ----------

export interface NessieResponse {
  status: number;
  body: unknown;
}
/** One Nessie call. The real one adds the key; tests replay recorded responses. */
export type NessieHttp = (
  method: "GET" | "POST",
  path: string,
  body?: unknown,
) => Promise<NessieResponse>;

/** A Nessie failure. The message names method, path and status only, never the key or URL. */
export class NessieError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number | null,
    detail: string,
  ) {
    super(`Nessie ${method} ${path} ${status === null ? "failed" : `answered ${status}`}${detail}`);
  }
}

const ID = /^[A-Za-z0-9-]{1,64}$/;

/** Real transport: HTTPS to the configured base, key as the documented `key` query param. */
export function httpTransport(
  base: string,
  key: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 20_000,
): NessieHttp {
  const root = new URL(base);
  if (root.protocol !== "https:") throw new Error("NESSIE_BASE_URL must be https");
  return async (method, path, body) => {
    if (!path.startsWith("/")) throw new Error("Nessie path must be absolute");
    const url = new URL(path, root);
    if (url.origin !== root.origin) throw new Error("Nessie path leaves the configured host");
    url.searchParams.set("key", key);
    let res: Response;
    try {
      res = await fetchImpl(url.toString(), {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          accept: "application/json",
          ...(body !== undefined && { "content-type": "application/json" }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "error";
      throw new NessieError(
        method,
        path,
        null,
        `: ${name === "TimeoutError" ? "timed out" : "unreachable"}`,
      );
    }
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // Some Nessie errors are plain strings ("unauthorized").
    }
    return { status: res.status, body: parsed };
  };
}

/** Reads through the stored account ids only: any other Nessie path is refused. */
export function nessieFetcher(http: NessieHttp, accountIds: string[]): Fetcher {
  const allowed = new Set(accountIds);
  return async (path) => {
    const m = /^\/vendor\/nessie\/accounts\/([^/?]+)(\/deposits|\/withdrawals)?$/.exec(path);
    if (!m || !allowed.has(m[1] ?? ""))
      return new Response(JSON.stringify({ message: "not a Domino account" }), { status: 403 });
    const r = await http("GET", path.slice("/vendor/nessie".length));
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  };
}

/** Routes Nessie paths to the Nessie reader and every other path to the mock fetcher. */
export const withNessie =
  (mocks: Fetcher, nessie: Fetcher): Fetcher =>
  (path) =>
    path.startsWith("/vendor/nessie/") ? nessie(path) : mocks(path);

// ---------- Setup and posting ----------

export interface Posting {
  bankId: string;
  nessieId: string;
  kind: "deposit" | "withdrawal";
}

/** What Domino stores per company (the nessieLinks row): its own Nessie ids and postings. */
export interface NessieLedger {
  label: string;
  customerId: string | null;
  checkingId: string | null;
  savingsId: string | null;
  openingBalance: number | null;
  posted: Posting[];
  /** Served as-of day through which every bank line is posted. */
  postedThrough: string | null;
  /** Nessie objects Domino created for this company (customer, accounts, transactions). */
  created: number;
}

export const newLedger = (label: string): NessieLedger => ({
  label,
  customerId: null,
  checkingId: null,
  savingsId: null,
  openingBalance: null,
  posted: [],
  postedThrough: null,
  created: 0,
});

export interface SyncOptions {
  /** Called after every step that changed the ledger, so a crash resumes from there. */
  save: (ledger: NessieLedger) => Promise<void>;
  /** Most postings in one run; the rest wait for the next run. */
  maxPosts?: number;
  batchSize?: number;
  concurrency?: number;
  pauseMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface SyncResult {
  ledger: NessieLedger;
  complete: boolean;
  posted: number;
  adopted: number;
  created: number;
  remaining: number;
}

const Created = z.object({ objectCreated: z.object({ _id: z.string().regex(ID) }) });
const AccountRow = z.object({
  _id: z.string().regex(ID),
  type: z.string(),
  nickname: z.string(),
  balance: z.number().int(),
  customer_id: z.string(),
});
const TxnRow = z.object({
  _id: z.string().regex(ID),
  transaction_date: z.string(),
  amount: z.number().int(),
  description: z.string(),
  status: z.string().optional(),
});

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function call(
  http: NessieHttp,
  method: "GET" | "POST",
  path: string,
  body: unknown,
  sleep: (ms: number) => Promise<void>,
): Promise<unknown> {
  // A busy sandbox (429 or 5xx) is retried a few times with a growing pause.
  for (let attempt = 0; ; attempt++) {
    const r = await http(method, path, body);
    if (r.status >= 200 && r.status < 300) return r.body;
    const retry = (r.status === 429 || r.status >= 500) && attempt < 3;
    if (!retry) {
      const msg =
        r.body && typeof r.body === "object" && "message" in r.body
          ? `: ${String((r.body as { message: unknown }).message).slice(0, 120)}`
          : "";
      throw new NessieError(method, path, r.status, msg);
    }
    await sleep(1000 * 2 ** attempt);
  }
}

async function create(
  http: NessieHttp,
  path: string,
  body: unknown,
  sleep: (ms: number) => Promise<void>,
): Promise<string> {
  const parsed = Created.safeParse(await call(http, "POST", path, body, sleep));
  if (!parsed.success) throw new NessieError("POST", path, 201, ": no objectCreated._id");
  return parsed.data.objectCreated._id;
}

/** Opening balance so that opening plus every posted line equals the served cash on hand. */
export function openingBalance(served: Snapshot): number {
  const posted = served.bankTxns.filter((t) => t.date <= served.asOf);
  return served.cashOnHand - posted.reduce((sum, t) => sum + t.amount, 0);
}

async function ensureAccount(
  http: NessieHttp,
  ledger: NessieLedger,
  type: "Checking" | "Savings",
  nickname: string,
  balance: number,
  sleep: (ms: number) => Promise<void>,
): Promise<{ id: string; created: boolean }> {
  const customer = ledger.customerId as string;
  // A create whose answer was lost is found again under Domino's own customer by nickname.
  const rows = parseEach(
    AccountRow,
    z
      .array(z.unknown())
      .parse(await call(http, "GET", `/customers/${customer}/accounts`, undefined, sleep)),
    "Nessie account",
    [],
  ).filter((a) => a.nickname === nickname && a.type === type && a.customer_id === customer);
  if (rows.length > 1) throw new Error(`two Nessie accounts are named ${nickname}`);
  if (rows[0]) return { id: rows[0]._id, created: false };
  const id = await create(
    http,
    `/customers/${customer}/accounts`,
    { type, nickname, rewards: 0, balance },
    sleep,
  );
  return { id, created: true };
}

/**
 * Makes Nessie hold the served bank history: creates Domino's customer and accounts once,
 * then posts every bank line dated on or before the served as-of day that is not posted yet.
 * Idempotent and resumable: before posting, the account's own deposits and withdrawals are
 * listed and any line already there (by its Domino marker) is adopted, never posted twice.
 */
export async function syncNessie(
  http: NessieHttp,
  start: NessieLedger,
  served: Snapshot,
  opts: SyncOptions,
): Promise<SyncResult> {
  const sleep = opts.sleep ?? defaultSleep;
  const maxPosts = opts.maxPosts ?? 800;
  const batchSize = opts.batchSize ?? 25;
  const concurrency = opts.concurrency ?? 4;
  // Politeness comes from bounded concurrency and a save between batches; an extra pause is
  // opt-in (Convex test runs use fake timers, where a timer would never fire).
  const pauseMs = opts.pauseMs ?? 0;
  let ledger: NessieLedger = { ...start, posted: [...start.posted] };
  const startCreated = ledger.created;
  const save = async (next: NessieLedger) => {
    ledger = next;
    await opts.save(ledger);
  };

  if (!ledger.customerId) {
    const id = await create(
      http,
      "/customers",
      {
        first_name: ledger.label,
        last_name: "Domino sandbox",
        address: {
          street_number: "1",
          street_name: "Synthetic Way",
          city: "Berkeley",
          state: "CA",
          zip: "94720",
        },
      },
      sleep,
    );
    await save({ ...ledger, customerId: id, created: ledger.created + 1 });
  }
  if (!ledger.checkingId) {
    const opening = openingBalance(served);
    if (!Number.isSafeInteger(opening) || opening < 0)
      throw new Error("the simulated history implies a negative opening balance");
    const r = await ensureAccount(
      http,
      ledger,
      "Checking",
      `${ledger.label} checking`,
      opening,
      sleep,
    );
    await save({
      ...ledger,
      checkingId: r.id,
      openingBalance: opening,
      created: ledger.created + (r.created ? 1 : 0),
    });
  }
  if (!ledger.savingsId && served.restrictedCash > 0) {
    const r = await ensureAccount(
      http,
      ledger,
      "Savings",
      `${ledger.label} collateral`,
      served.restrictedCash,
      sleep,
    );
    await save({ ...ledger, savingsId: r.id, created: ledger.created + (r.created ? 1 : 0) });
  }

  const checking = ledger.checkingId as string;
  const have = new Set(ledger.posted.map((p) => p.bankId));
  let due = served.bankTxns.filter(
    (t) => t.date <= served.asOf && !have.has(t.id) && t.amount !== 0,
  );
  let adopted = 0;
  if (due.length > 0) {
    const found: Posting[] = [];
    for (const kind of ["deposit", "withdrawal"] as const) {
      const rows = parseEach(
        TxnRow,
        z
          .array(z.unknown())
          .parse(await call(http, "GET", `/accounts/${checking}/${kind}s`, undefined, sleep)),
        "Nessie transaction",
        [],
      );
      for (const row of rows) {
        const m = decodeDescription(row.description);
        if (m && !have.has(m.id)) {
          found.push({ bankId: m.id, nessieId: row._id, kind });
          have.add(m.id);
        }
      }
    }
    if (found.length > 0) {
      adopted = found.length;
      await save({ ...ledger, posted: [...ledger.posted, ...found] });
      due = due.filter((t) => !have.has(t.id));
    }
  }

  let posted = 0;
  const todo = due.slice(0, maxPosts);
  for (let i = 0; i < todo.length; i += batchSize) {
    const batch = todo.slice(i, i + batchSize);
    const done: Posting[] = [];
    let failure: unknown = null;
    for (let j = 0; j < batch.length && failure === null; j += concurrency) {
      const results = await Promise.allSettled(
        batch.slice(j, j + concurrency).map(async (t) => {
          const kind = t.amount > 0 ? ("deposit" as const) : ("withdrawal" as const);
          const nessieId = await create(
            http,
            `/accounts/${checking}/${kind}s`,
            {
              medium: "balance",
              transaction_date: t.date,
              status: "completed",
              amount: Math.abs(t.amount),
              description: encodeDescription(t, bankReference(served, t)),
            },
            sleep,
          );
          return { bankId: t.id, nessieId, kind };
        }),
      );
      for (const r of results)
        if (r.status === "fulfilled") done.push(r.value);
        else failure ??= r.reason;
    }
    posted += done.length;
    if (done.length > 0)
      await save({
        ...ledger,
        posted: [...ledger.posted, ...done],
        created: ledger.created + done.length,
      });
    if (failure !== null) throw failure;
    if (pauseMs > 0 && i + batchSize < todo.length) await sleep(pauseMs);
  }
  const remaining = due.length - posted;
  const complete = remaining === 0;
  if (complete && ledger.postedThrough !== served.asOf)
    await save({ ...ledger, postedThrough: served.asOf });
  return { ledger, complete, posted, adopted, created: ledger.created - startCreated, remaining };
}

// ---------- Read and translate ----------

export interface NessiePlan {
  customerId: string;
  checkingId: string;
  savingsId: string | null;
  /** The served as-of day the postings cover; the balance is as of this day. */
  asOf: string;
  /** Domino bank ids in posting order, so the snapshot keeps the bank's order. */
  order: string[];
}

export interface NessieRaw {
  checking: unknown;
  savings: unknown | null;
  deposits: unknown[];
  withdrawals: unknown[];
  pages: Record<string, number>;
}

export async function fetchNessie(fetcher: Fetcher, plan: NessiePlan): Promise<NessieRaw> {
  const base = `/vendor/nessie/accounts/${plan.checkingId}`;
  const list = async (path: string) =>
    z.array(z.unknown()).parse((await getJson(fetcher, path)).body);
  return {
    checking: (await getJson(fetcher, base)).body,
    savings: plan.savingsId
      ? (await getJson(fetcher, `/vendor/nessie/accounts/${plan.savingsId}`)).body
      : null,
    deposits: await list(`${base}/deposits`),
    withdrawals: await list(`${base}/withdrawals`),
    pages: {
      "/accounts/{id}": plan.savingsId ? 2 : 1,
      "/accounts/{id}/deposits": 1,
      "/accounts/{id}/withdrawals": 1,
    },
  };
}

export interface NessieLinks {
  /** Bank reference per Domino bank id: the id of the record the money paid. */
  references: Map<string, string>;
}

function ownAccount(raw: unknown, plan: NessiePlan, id: string, type: string) {
  const a = AccountRow.parse(raw);
  // Belt and braces on top of the id allow-list: the account must still be Domino's.
  if (a._id !== id || a.customer_id !== plan.customerId || !a.nickname.startsWith(NESSIE_PREFIX))
    throw new Error("Nessie account is not one Domino created");
  if (a.type !== type) throw new Error(`Nessie account ${id} is not a ${type} account`);
  return a;
}

export function translateNessie(raw: NessieRaw, plan: NessiePlan): Translated<NessieLinks> {
  const skipped: Skip[] = [];
  const checking = ownAccount(raw.checking, plan, plan.checkingId, "Checking");
  const savings =
    plan.savingsId && raw.savings ? ownAccount(raw.savings, plan, plan.savingsId, "Savings") : null;
  const references = new Map<string, string>();
  const byId = new Map<string, BankTxn>();
  const read = (items: unknown[], sign: 1 | -1) => {
    for (const row of parseEach(TxnRow, items, "Nessie transaction", skipped, (r) =>
      r && typeof r === "object" && "_id" in r ? String(r._id) : "unknown",
    )) {
      const m = decodeDescription(row.description);
      if (!m) skipped.push({ id: row._id, reason: "not posted by Domino: no Domino marker" });
      else if (row.status !== undefined && row.status !== "completed")
        skipped.push({ id: row._id, reason: `${row.status}: counted once it completes` });
      else if (row.transaction_date > plan.asOf)
        skipped.push({ id: row._id, reason: "dated after the as-of day" });
      else if (byId.has(m.id)) skipped.push({ id: row._id, reason: `posted twice as ${m.id}` });
      else {
        byId.set(m.id, {
          id: m.id,
          date: row.transaction_date,
          amount: sign * row.amount,
          description: m.description,
          ...(m.counterparty !== undefined && { counterparty: m.counterparty }),
        });
        references.set(m.id, m.ref);
      }
    }
  };
  read(raw.deposits, 1);
  read(raw.withdrawals, -1);
  const rank = new Map(plan.order.map((id, i) => [id, i]));
  const kept = keepValid(BankTxnSchema, [...byId.values()], "bank transaction", skipped).sort(
    (a, b) =>
      (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
      (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  // Nessie's balance stays at the opening balance; posted lines move the cash.
  const balances: Balances = {
    asOf: plan.asOf,
    cashOnHand: checking.balance + kept.reduce((sum, t) => sum + t.amount, 0),
    restrictedCash: savings?.balance ?? 0,
  };
  return {
    lists: { bankTxns: kept },
    balances,
    links: { references },
    skipped,
    recordsIn: 1 + (savings ? 1 : 0) + raw.deposits.length + raw.withdrawals.length,
    notes: [
      `Capital One Nessie sandbox: ${raw.deposits.length} deposits, ${raw.withdrawals.length} withdrawals; opening balance ${checking.balance} cents`,
    ],
  };
}
