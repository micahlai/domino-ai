import { readFileSync } from "node:fs";
import type { NessieHttp } from "../../connectors/nessie";

/**
 * In-memory Capital One Nessie sandbox for tests (no network). Every object it returns has
 * exactly the fields of the recorded real responses in fixtures/nessie.json; create calls
 * answer like the live probe (201 with objectCreated). It starts with a foreign customer,
 * account and transactions (another project on the same key) so tests can prove Domino never
 * reads or writes them.
 */
export interface NessieRecording {
  customerAccounts: Record<string, unknown>[];
  checking: Record<string, unknown>;
  savings: Record<string, unknown>;
  deposits: Record<string, unknown>[];
  withdrawals: Record<string, unknown>[];
}

export const recordedNessie = (): NessieRecording =>
  JSON.parse(readFileSync(new URL("./fixtures/nessie.json", import.meta.url), "utf8"));

export const FOREIGN_CUSTOMER = "f0000000-0000-4000-8000-000000000001";
export const FOREIGN_ACCOUNT = "f0000000-0000-4000-8000-000000000002";

type Obj = Record<string, unknown>;
interface Call {
  method: string;
  path: string;
}

export function fakeNessie() {
  const rec = recordedNessie();
  const keys = {
    account: Object.keys(rec.checking),
    deposit: Object.keys(rec.deposits[0] ?? {}),
    withdrawal: Object.keys(rec.withdrawals[0] ?? {}),
  };
  let next = 1;
  const uuid = () => `00000000-0000-4000-8000-${String(next++).padStart(12, "0")}`;
  const customers = new Map<string, Obj>([[FOREIGN_CUSTOMER, { _id: FOREIGN_CUSTOMER }]]);
  const accounts = new Map<string, Obj>([
    [
      FOREIGN_ACCOUNT,
      {
        _id: FOREIGN_ACCOUNT,
        type: "Checking",
        nickname: "someone else's account",
        rewards: 0,
        balance: 500,
        account_number: "1111111111111111",
        customer_id: FOREIGN_CUSTOMER,
      },
    ],
  ]);
  const txns = new Map<string, Obj & { account: string; kind: "deposit" | "withdrawal" }>();
  txns.set("foreign-dep", {
    _id: "foreign-dep",
    account: FOREIGN_ACCOUNT,
    kind: "deposit",
    medium: "balance",
    transaction_date: "2026-01-01",
    status: "completed",
    amount: 100,
    description: "[domino id=bank_x] not ours",
  });
  const calls: Call[] = [];
  const state = {
    /** Fail the Nth POST from now with a network error (0 = next); null = never. */
    failPostIn: null as number | null,
    /** When failing, still create the object first (the answer is lost, the write is not). */
    loseResponse: false,
  };
  const pick = (o: Obj, ks: string[]) => Object.fromEntries(ks.map((k) => [k, o[k]]));
  const ok = (body: unknown, status = 200) => ({ status, body });
  const created = (what: string, o: Obj) =>
    ok({ code: 201, message: `Created ${what}!`, objectCreated: o }, 201);

  const http: NessieHttp = async (method, path, body) => {
    calls.push({ method, path });
    const b = (body ?? {}) as Obj;
    if (method === "POST") {
      if (state.failPostIn !== null && state.failPostIn-- === 0) {
        state.failPostIn = null;
        if (state.loseResponse) {
          state.loseResponse = false;
          await handle(method, path, b);
        }
        throw new Error("network down");
      }
    }
    return handle(method, path, b);
  };

  async function handle(method: string, path: string, b: Obj) {
    let m: RegExpExecArray | null;
    if (method === "POST" && path === "/customers") {
      const id = uuid();
      const c = { _id: id, first_name: b.first_name, last_name: b.last_name, address: b.address };
      customers.set(id, c);
      return created("customer", c);
    }
    m = /^\/customers\/([^/]+)\/accounts$/.exec(path);
    if (m) {
      const cid = m[1] as string;
      if (!customers.has(cid)) return ok({ code: 404, message: "Invalid customer id" }, 404);
      if (method === "GET")
        return ok(
          [...accounts.values()]
            .filter((a) => a.customer_id === cid)
            .map((a) => pick(a, keys.account)),
        );
      const a = {
        _id: uuid(),
        type: b.type,
        nickname: b.nickname,
        rewards: b.rewards,
        balance: b.balance,
        account_number: "0000000000000000",
        customer_id: cid,
      };
      accounts.set(a._id, a);
      return created("account", a);
    }
    m = /^\/accounts\/([^/]+)$/.exec(path);
    if (m && method === "GET") {
      const a = accounts.get(m[1] as string);
      return a ? ok(pick(a, keys.account)) : ok({ code: 404, message: "Invalid id" }, 404);
    }
    m = /^\/accounts\/([^/]+)\/(deposits|withdrawals)$/.exec(path);
    if (m) {
      const account = m[1] as string;
      const kind = m[2] === "deposits" ? ("deposit" as const) : ("withdrawal" as const);
      if (!accounts.has(account)) return ok({ code: 404, message: "Invalid id" }, 404);
      if (method === "GET")
        return ok(
          [...txns.values()]
            .filter((t) => t.account === account && t.kind === kind)
            .map((t) => pick(t, keys[kind])),
        );
      // Like the live sandbox: the account balance does not move.
      const t = {
        _id: uuid(),
        account,
        kind,
        type: kind,
        payer_id: account,
        medium: b.medium,
        transaction_date: b.transaction_date,
        status: b.status,
        amount: b.amount,
        description: b.description,
      };
      txns.set(t._id, t);
      return created(kind, pick(t, keys[kind]));
    }
    return ok({ code: 404, message: "no route" }, 404);
  }

  /** A fetch over the fake, for code that goes through httpTransport (Convex actions). */
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    if (!url.searchParams.get("key")) return new Response('"unauthorized"', { status: 401 });
    const r = await http(
      (init?.method ?? "GET") as "GET" | "POST",
      url.pathname,
      init?.body ? JSON.parse(String(init.body)) : undefined,
    );
    return new Response(JSON.stringify(r.body), { status: r.status });
  };

  return { http, fetch: fetchImpl, calls, state, accounts, txns, customers };
}
