import type { Snapshot } from "@domino/contracts";
import { PROFILE_IDS } from "@domino/sim";
import { describe, expect, it } from "vitest";
import { inProcessFetcher } from "../../connectors/inProcess";
import { type ConnectionInput, pullAll } from "../../connectors/pullAll";
import { type Fetcher, MOCK_TOOL_IDS as TOOL_IDS, type ToolId } from "../../connectors/types";
import { emptyOverlay, newWorld, nextWorld, servedSnapshot } from "../../fieldFeed";

const connected = (tools: readonly ToolId[] = TOOL_IDS): ConnectionInput[] =>
  tools.map((tool) => ({ tool, status: "connected" }));

/** Lists sorted by id: the vendor APIs page in id order, the snapshot keeps insertion order. */
function sorted(s: Snapshot | null) {
  if (!s) return s;
  const out: Record<string, unknown> = { ...s };
  for (const [k, v] of Object.entries(s))
    if (Array.isArray(v))
      out[k] = [...v].sort((a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : 1));
  return out;
}

function world(weeks: number) {
  let w = newWorld(1);
  for (let i = 0; i < weeks; i++) w = nextWorld(w);
  return w;
}

/** Wraps a fetcher to count requests per path prefix. */
function counting(inner: Fetcher) {
  const paths: string[] = [];
  const fetcher: Fetcher = (p) => {
    paths.push(p);
    return inner(p);
  };
  return { paths, fetcher };
}

describe("pullAll over the vendor mocks (sim Kestrel)", () => {
  const served = servedSnapshot(world(3), emptyOverlay());

  it("all six tools rebuild the served snapshot exactly and every tie-out holds", async () => {
    const { fetcher, paths } = counting(inProcessFetcher(served));
    const r = await pullAll({ fetcher, companyId: served.companyId, connections: connected() });
    expect(r.snapshotError).toBeNull();
    expect(sorted(r.snapshot)).toEqual(sorted(served));
    expect(r.log.map((l) => [l.tool, l.error])).toEqual(TOOL_IDS.map((t) => [t, null]));
    expect(r.checks.length).toBeGreaterThan(500);
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    // Cursor pagination was followed, not one oversized page.
    expect(paths.filter((p) => p.startsWith("/vendor/stripe/v1/invoices")).length).toBe(
      Math.ceil(served.invoices.length / 100),
    );
    expect(paths.filter((p) => p.includes("starting_after=")).length).toBeGreaterThan(0);
    expect(paths.filter((p) => p.startsWith("/vendor/plaid/transactions/sync")).length).toBe(
      Math.ceil(served.bankTxns.length / 500),
    );
    expect(r.cursor.plaid).toEqual(expect.any(String));
  });

  it("cross-tool: each Stripe payout is one bank deposit; each Gusto run one bank debit", async () => {
    const r = await pullAll({
      fetcher: inProcessFetcher(served),
      companyId: served.companyId,
      connections: connected(),
    });
    const names = new Set(r.checks.map((c) => c.name));
    expect(names).toEqual(
      new Set([
        "Stripe payout = bank deposit",
        "Stripe charge = invoice paid amount",
        "Gusto payroll = bank debit",
        "QuickBooks bill payment = bank debit",
        "Ramp bill payment = QuickBooks bill payment",
        "Books cash = bank cash",
      ]),
    );
    const payouts = r.checks.filter((c) => c.name === "Stripe payout = bank deposit");
    expect(payouts.length).toBe(served.bankTxns.filter((t) => t.counterparty === "Stripe").length);
    const stripe = r.log.find((l) => l.tool === "stripe");
    expect(
      stripe?.skipped.filter((s) => s.reason.startsWith("counted once, as bank deposit")),
    ).toHaveLength(payouts.length);
    const ran = served.payroll.filter((p) => p.date <= served.asOf).length;
    expect(r.checks.filter((c) => c.name === "Gusto payroll = bank debit")).toHaveLength(ran);
  });

  it("dedupes by id link: QuickBooks invoices and Ramp bills are kept once", async () => {
    const all = await pullAll({
      fetcher: inProcessFetcher(served),
      companyId: served.companyId,
      connections: connected(),
    });
    const qbo = all.log.find((l) => l.tool === "qbo");
    const ramp = all.log.find((l) => l.tool === "ramp");
    expect(qbo?.counts.invoices).toBe(0);
    expect(qbo?.skipped.filter((s) => s.reason.startsWith("same record as Stripe"))).toHaveLength(
      served.invoices.length,
    );
    expect(ramp?.counts.bills).toBe(0);
    expect(all.records.invoices).toHaveLength(served.invoices.length);
    expect(all.records.bills).toHaveLength(served.bills.length);

    // Without Stripe, the books' copy of each invoice is the record.
    const noStripe = await pullAll({
      fetcher: inProcessFetcher(served),
      companyId: served.companyId,
      connections: connected(TOOL_IDS.filter((t) => t !== "stripe")),
    });
    expect(noStripe.records.invoices.map((i) => i.id).sort()).toEqual(
      served.invoices.map((i) => i.id).sort(),
    );
    expect(noStripe.records.customers).toEqual([]);
    expect(noStripe.log.some((l) => l.tool === "stripe")).toBe(false);
  });

  it("needs a bank or books for cash; books alone still give a valid snapshot", async () => {
    const none = await pullAll({
      fetcher: inProcessFetcher(served),
      companyId: served.companyId,
      connections: connected(["stripe", "hubspot"]),
    });
    expect(none.snapshot).toBeNull();
    expect(none.snapshotError).toMatch(/cash balance/);
    expect(none.records.deals).toHaveLength(served.deals.length);

    const books = await pullAll({
      fetcher: inProcessFetcher(served),
      companyId: served.companyId,
      connections: connected(["qbo"]),
    });
    expect(books.snapshot?.cashOnHand).toBe(served.cashOnHand);
    expect(books.snapshot?.bankTxns).toEqual([]);
  });

  it("disconnected tools are not read", async () => {
    const { fetcher, paths } = counting(inProcessFetcher(served));
    await pullAll({
      fetcher,
      companyId: served.companyId,
      connections: [
        { tool: "gusto", status: "connected" },
        { tool: "plaid", status: "disconnected" },
      ],
    });
    expect(paths.every((p) => p.startsWith("/vendor/gusto/"))).toBe(true);
  });

  it("a bank amount that disagrees with Stripe fails its tie-out", async () => {
    const deposit = served.bankTxns.find((t) => t.counterparty === "Stripe" && t.amount > 0);
    if (!deposit) throw new Error("fixture has no Stripe deposit");
    const inner = inProcessFetcher(served);
    // The bank reports one cent less for one deposit than Stripe paid out.
    const fetcher: Fetcher = async (p) => {
      const res = await inner(p);
      if (!p.startsWith("/vendor/plaid/transactions/sync")) return res;
      const body = (await res.json()) as { added: { transaction_id: string; amount: number }[] };
      for (const t of body.added)
        if (t.transaction_id === deposit.id) t.amount = Number((t.amount + 0.01).toFixed(2));
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const r = await pullAll({ fetcher, companyId: served.companyId, connections: connected() });
    expect(r.checks.filter((c) => !c.ok).map((c) => c.ref)).toEqual([`po_${deposit.id}`]);
  });
});

describe("pullAll over every picker profile", () => {
  it.each(PROFILE_IDS)(
    "%s: six tools rebuild the served snapshot and every tie-out holds",
    async (profile) => {
      let w = newWorld(1, profile);
      w = nextWorld(w);
      const served = servedSnapshot(w, emptyOverlay());
      const r = await pullAll({
        fetcher: inProcessFetcher(served),
        companyId: served.companyId,
        connections: connected(),
      });
      expect(r.snapshotError).toBeNull();
      expect(sorted(r.snapshot)).toEqual(sorted(served));
      // Payroll leaves the bank as net pay and taxes: the run ties out to their sum.
      expect(
        r.checks.filter((c) => c.name === "Gusto payroll = bank debit").length,
      ).toBeGreaterThan(0);
      expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    },
  );
});

describe("Plaid transactions/sync cursor", () => {
  it("a saved cursor reads only new activity and merges to the same bank list", async () => {
    const w1 = world(2);
    const s1 = servedSnapshot(w1, emptyOverlay());
    const first = await pullAll({
      fetcher: inProcessFetcher(s1),
      companyId: s1.companyId,
      connections: connected(["plaid"]),
    });
    const s2 = servedSnapshot(nextWorld(w1), emptyOverlay());
    const added = s2.bankTxns.length - s1.bankTxns.length;
    expect(added).toBeGreaterThan(0);
    const next = await pullAll({
      fetcher: inProcessFetcher(s2),
      companyId: s2.companyId,
      connections: connected(["plaid"]),
      since: { cursor: first.cursor, bankTxns: first.records.bankTxns },
    });
    const plaid = next.log.find((l) => l.tool === "plaid");
    expect(plaid?.notes).toContain(`incremental sync: ${added} new, 0 changed, 0 removed`);
    expect(next.records.bankTxns).toEqual(s2.bankTxns);
    expect(next.snapshot?.cashOnHand).toBe(s2.cashOnHand);
  });

  it("changed history refuses the cursor and the connector restarts from scratch", async () => {
    const s1 = servedSnapshot(world(1), emptyOverlay());
    const first = await pullAll({
      fetcher: inProcessFetcher(s1),
      companyId: s1.companyId,
      connections: connected(["plaid"]),
    });
    const [head, ...rest] = s1.bankTxns;
    if (!head) throw new Error("no bank history");
    // The bank rewrote its first transaction after the cursor was saved.
    const s2: Snapshot = { ...s1, bankTxns: [{ ...head, amount: head.amount + 1 }, ...rest] };
    const next = await pullAll({
      fetcher: inProcessFetcher(s2),
      companyId: s2.companyId,
      connections: connected(["plaid"]),
      since: { cursor: first.cursor, bankTxns: first.records.bankTxns },
    });
    expect(next.log[0]?.notes[0]).toMatch(/read it again in full/);
    expect(next.records.bankTxns).toEqual(s2.bankTxns);
  });
});
