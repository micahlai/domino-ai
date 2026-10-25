import type { BankTxn, Snapshot } from "@domino/contracts";
import { describe, expect, it } from "vitest";
import { inProcessFetcher } from "../../connectors/inProcess";
import {
  type NessieLedger,
  type NessiePlan,
  decodeDescription,
  encodeDescription,
  fetchNessie,
  httpTransport,
  nessieFetcher,
  newLedger,
  syncNessie,
  translateNessie,
  withNessie,
} from "../../connectors/nessie";
import { pullAll } from "../../connectors/pullAll";
import { MOCK_TOOL_IDS } from "../../connectors/types";
import { emptyOverlay, newWorld, nextWorld, servedSnapshot } from "../../fieldFeed";
import {
  FOREIGN_ACCOUNT,
  FOREIGN_CUSTOMER,
  fakeNessie,
  recordedNessie,
} from "./nessie.test-support";

const noSleep = async () => {};
const byId = (xs: BankTxn[] | undefined) =>
  [...(xs ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

function served(weeks = 0, profile: "kestrel" | undefined = "kestrel"): Snapshot {
  let w = newWorld(1, profile);
  for (let i = 0; i < weeks; i++) w = nextWorld(w);
  return servedSnapshot(w, emptyOverlay());
}

async function sync(
  nessie: ReturnType<typeof fakeNessie>,
  start: NessieLedger,
  s: Snapshot,
  opts: { maxPosts?: number } = {},
) {
  let saved = start;
  try {
    const r = await syncNessie(nessie.http, start, s, {
      ...opts,
      sleep: noSleep,
      save: async (l) => {
        saved = l;
      },
    });
    return { ...r, saved, error: null };
  } catch (error) {
    const none = { complete: false, posted: 0, adopted: 0, created: 0, remaining: 0 };
    return { ...none, ledger: saved, saved, error: error as Error };
  }
}

const planOf = (l: NessieLedger, asOf: string): NessiePlan => ({
  customerId: l.customerId as string,
  checkingId: l.checkingId as string,
  savingsId: l.savingsId,
  asOf,
  order: l.posted.map((p) => p.bankId),
});

async function readBack(nessie: ReturnType<typeof fakeNessie>, l: NessieLedger, asOf: string) {
  const plan = planOf(l, asOf);
  const ids = [plan.checkingId, ...(plan.savingsId ? [plan.savingsId] : [])];
  return translateNessie(await fetchNessie(nessieFetcher(nessie.http, ids), plan), plan);
}

describe("Nessie description marker", () => {
  it("round-trips ids, references and counterparties with spaces and brackets", () => {
    const t: BankTxn = {
      id: 'bank_po_inv_["plan_cus_086","2026-10-05"]',
      date: "2026-10-05",
      amount: -1234,
      description: "ACH DEBIT bill_x Acme [EU] supplier payment",
      counterparty: "Acme [EU] Ltd = 100%",
    };
    const text = encodeDescription(t, "bill_x");
    expect(text.startsWith("[domino ")).toBe(true);
    expect(decodeDescription(text)).toEqual({
      id: t.id,
      ref: "bill_x",
      counterparty: t.counterparty,
      description: t.description,
    });
    const plain = { ...t, counterparty: undefined };
    expect(decodeDescription(encodeDescription(plain, t.id))).toEqual({
      id: t.id,
      ref: t.id,
      description: t.description,
    });
    expect(decodeDescription("Coffee shop")).toBeNull();
  });
});

describe("Nessie translator on recorded sandbox responses", () => {
  it("reads balance and Domino-marked lines back exactly", () => {
    const rec = recordedNessie();
    const plan: NessiePlan = {
      customerId: rec.checking.customer_id as string,
      checkingId: rec.checking._id as string,
      savingsId: rec.savings._id as string,
      asOf: "2026-10-30",
      order: [],
    };
    const t = translateNessie(
      {
        checking: rec.checking,
        savings: rec.savings,
        deposits: rec.deposits,
        withdrawals: rec.withdrawals,
        pages: {},
      },
      plan,
    );
    expect(t.skipped).toEqual([]);
    const lines = t.lists.bankTxns ?? [];
    expect(lines).toHaveLength(6);
    const sum = lines.reduce((a, l) => a + l.amount, 0);
    expect(t.balances).toEqual({
      asOf: "2026-10-30",
      cashOnHand: (rec.checking.balance as number) + sum,
      restrictedCash: rec.savings.balance,
    });
    const payout = lines.find((l) => l.id === "bank_po_2026-06-16");
    expect(payout).toMatchObject({ amount: 1_405_918, counterparty: "Stripe", date: "2026-06-16" });
    expect(payout?.description.startsWith("STRIPE PAYOUT po_2026-06-16")).toBe(true);
    const bill = lines.find((l) => l.id === "bank_bill_enrichment_2026-05");
    expect(bill).toMatchObject({
      amount: -1_800_000,
      counterparty: "Signalbase data enrichment software",
    });
    expect(t.links.references.get("bank_bill_enrichment_2026-05")).toBe("bill_enrichment_2026-05");
  });

  it("refuses an account that is not Domino's", () => {
    const rec = recordedNessie();
    const plan: NessiePlan = {
      customerId: FOREIGN_CUSTOMER,
      checkingId: rec.checking._id as string,
      savingsId: null,
      asOf: "2026-10-30",
      order: [],
    };
    expect(() =>
      translateNessie(
        { checking: rec.checking, savings: null, deposits: [], withdrawals: [], pages: {} },
        plan,
      ),
    ).toThrow("not one Domino created");
  });
});

describe("Nessie setup and posting (fake sandbox, no network)", () => {
  it("sets up once, posts the history, and reads it back tied to the simulated bank", async () => {
    const nessie = fakeNessie();
    const s = served();
    const first = await sync(nessie, newLedger("domino-kestrel-test"), s);
    expect(first.error).toBeNull();
    const posted = s.bankTxns.filter((t) => t.date <= s.asOf).length;
    expect(first).toMatchObject({ complete: true, posted, adopted: 0, created: posted + 3 });
    expect(first.saved.postedThrough).toBe(s.asOf);
    const t = await readBack(nessie, first.saved, s.asOf);
    expect(t.lists.bankTxns).toEqual(s.bankTxns);
    expect(t.balances).toEqual({
      asOf: s.asOf,
      cashOnHand: s.cashOnHand,
      restrictedCash: s.restrictedCash,
    });

    // Idempotent: a second sync of the same week writes nothing.
    nessie.calls.length = 0;
    const again = await sync(nessie, first.saved, s);
    expect(again).toMatchObject({ complete: true, posted: 0, created: 0 });
    expect(nessie.calls.filter((c) => c.method === "POST")).toEqual([]);

    // A new week posts only that week's lines.
    const s2 = served(1);
    const week = await sync(nessie, first.saved, s2);
    expect(week.posted).toBe(s2.bankTxns.length - s.bankTxns.length);
    const t2 = await readBack(nessie, week.saved, s2.asOf);
    expect(t2.lists.bankTxns).toEqual(s2.bankTxns);
    expect(t2.balances?.cashOnHand).toBe(s2.cashOnHand);
  });

  it("never reads or writes a foreign customer, account or transaction", async () => {
    const nessie = fakeNessie();
    const s = served();
    const r = await sync(nessie, newLedger("domino-kestrel-test"), s);
    await readBack(nessie, r.saved, s.asOf);
    const own = [r.saved.customerId, r.saved.checkingId, r.saved.savingsId] as string[];
    for (const c of nessie.calls) {
      expect(c.path.includes(FOREIGN_ACCOUNT) || c.path.includes(FOREIGN_CUSTOMER)).toBe(false);
      if (c.path !== "/customers") expect(own.some((id) => c.path.includes(id))).toBe(true);
    }
    expect(nessie.calls.some((c) => c.method === "GET" && c.path === "/customers")).toBe(false);
    expect(nessie.accounts.get(FOREIGN_ACCOUNT)?.balance).toBe(500);
    expect([...nessie.txns.values()].filter((t) => t.account === FOREIGN_ACCOUNT)).toHaveLength(1);
    // The read path refuses any id Domino did not store.
    const refuse = nessieFetcher(nessie.http, own);
    expect((await refuse(`/vendor/nessie/accounts/${FOREIGN_ACCOUNT}/deposits`)).status).toBe(403);
    expect((await refuse("/vendor/nessie/customers")).status).toBe(403);
  });

  it("resumes after a lost create without posting a line twice", async () => {
    const nessie = fakeNessie();
    const s = served();
    // Batch 1 posts fine; then a write lands but its answer is lost.
    nessie.state.failPostIn = 3 + 30;
    nessie.state.loseResponse = true;
    const broken = await sync(nessie, newLedger("domino-kestrel-test"), s);
    expect(broken.error?.message).toBe("network down");
    const savedPosts = broken.saved.posted.length;
    expect(savedPosts).toBeGreaterThan(0);
    const resumed = await sync(nessie, broken.saved, s);
    expect(resumed.error).toBeNull();
    expect(resumed.adopted).toBeGreaterThanOrEqual(1);
    const ours = [...nessie.txns.values()].filter((t) => t.account === resumed.saved.checkingId);
    const marked = ours.map((t) => decodeDescription(String(t.description))?.id);
    expect(new Set(marked).size).toBe(marked.length);
    expect(marked.length).toBe(s.bankTxns.length);
    const t = await readBack(nessie, resumed.saved, s.asOf);
    expect(t.balances?.cashOnHand).toBe(s.cashOnHand);
  });

  it("posts in bounded runs: an unfinished history is reported, the next run finishes it", async () => {
    const nessie = fakeNessie();
    const s = served();
    const part = await sync(nessie, newLedger("domino-kestrel-test"), s, { maxPosts: 100 });
    expect(part).toMatchObject({ complete: false, posted: 100 });
    expect(part.saved.postedThrough).toBeNull();
    const rest = await sync(nessie, part.saved, s, { maxPosts: 1000 });
    expect(rest).toMatchObject({ complete: true, posted: s.bankTxns.length - 100 });
  });

  it("pullAll with Nessie as the bank rebuilds the snapshot and every tie-out holds", async () => {
    const nessie = fakeNessie();
    const s = served(2);
    const r0 = await sync(nessie, newLedger("domino-kestrel-test"), s);
    const plan = planOf(r0.saved, s.asOf);
    const fetcher = withNessie(
      inProcessFetcher(s),
      nessieFetcher(nessie.http, [plan.checkingId, plan.savingsId as string]),
    );
    const tools = [...MOCK_TOOL_IDS.filter((t) => t !== "plaid"), "nessie" as const];
    const r = await pullAll({
      fetcher,
      companyId: s.companyId,
      nessie: plan,
      connections: tools.map((tool) => ({ tool, status: "connected" })),
    });
    expect(r.log.map((l) => l.error)).toEqual(tools.map(() => null));
    expect(byId(r.snapshot?.bankTxns)).toEqual(byId(s.bankTxns));
    expect(r.snapshot?.cashOnHand).toBe(s.cashOnHand);
    expect(r.checks.length).toBeGreaterThan(500);
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(r.checks.some((c) => c.name === "Books cash = bank cash" && c.ok)).toBe(true);
  });
});

describe("Nessie HTTP transport", () => {
  it("sends the key as the query param and never puts it in an error", async () => {
    const urls: string[] = [];
    const http = httpTransport("https://nessie.test", "SECRET-KEY", async (input) => {
      urls.push(String(input));
      throw new TypeError("fetch failed");
    });
    const err = await http("GET", "/accounts/abc").catch((e: Error) => e);
    expect(urls[0]).toBe("https://nessie.test/accounts/abc?key=SECRET-KEY");
    expect(String((err as Error).message)).toBe("Nessie GET /accounts/abc failed: unreachable");
    expect(String((err as Error).message)).not.toContain("SECRET");
    expect(() => httpTransport("http://nessie.test", "k")).toThrow("https");
    await expect(httpTransport("https://nessie.test", "k")("GET", "//evil.test/x")).rejects.toThrow(
      "leaves the configured host",
    );
  });
});
