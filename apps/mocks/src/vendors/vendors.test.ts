import { fixtures } from "@domino/contracts/fixtures";
import { describe, expect, it } from "vitest";
import { createMockHandler } from "../handler";

const KEY = "test-key-not-secret";
const s = fixtures.snapshot;
const handler = createMockHandler({ apiKey: KEY, snapshot: () => s });
const get = (path: string, key = KEY) =>
  handler(new Request(`http://mocks.local${path}`, { headers: { "x-api-key": key } }));
const body = async (path: string) => (await get(path)).json();

describe("vendor-shaped mocks", () => {
  it("answer one main endpoint per tool", async () => {
    const q = encodeURIComponent("select * from Bill");
    const cases: [string, (b: never) => unknown][] = [
      [
        "/vendor/stripe/v1/invoices?limit=2",
        (b: { data: unknown[]; has_more: boolean }) => [b.data.length, b.has_more],
      ],
      ["/vendor/ramp/developer/v1/transactions", (b: { data: unknown[] }) => b.data.length],
      [
        `/vendor/qbo/v3/company/${s.companyId}/query?query=${q}`,
        (b: { QueryResponse: { Bill: unknown[] } }) => b.QueryResponse.Bill.length,
      ],
      [`/vendor/gusto/v1/companies/${s.companyId}/payrolls`, (b: unknown[]) => b.length],
      ["/vendor/hubspot/crm/v3/objects/deals", (b: { results: unknown[] }) => b.results.length],
      [
        "/vendor/plaid/transactions/sync",
        (b: { added: unknown[]; has_more: boolean }) => [b.added.length, b.has_more],
      ],
    ];
    const got = await Promise.all(cases.map(async ([p, f]) => f((await body(p)) as never)));
    expect(got).toEqual([
      [2, true],
      s.cardTxns.length,
      s.bills.length,
      s.payroll.length,
      s.deals.length,
      [s.bankTxns.length, false],
    ]);
  });

  it("keep each tool's paging and error style", async () => {
    const first = await body("/vendor/stripe/v1/invoices?limit=2");
    const next = await body(
      `/vendor/stripe/v1/invoices?limit=2&starting_after=${first.data[1].id}`,
    );
    expect(next.data[0].id > first.data[1].id).toBe(true);
    expect((await get("/vendor/stripe/v1/invoices?starting_after=nope")).status).toBe(400);
    expect((await get("/vendor/qbo/v3/company/other/query?query=x")).status).toBe(403);
    const gusto = await get(`/vendor/gusto/v1/companies/${s.companyId}/payrolls?per=1`);
    expect(gusto.headers.get("link")).toMatch(/page=2.*rel="next"/);
    const plaid = await body("/vendor/plaid/transactions/sync?cursor=bad!");
    expect(plaid.error_code).toBe("INVALID_CURSOR");
    expect((await get("/vendor/hubspot/crm/v3/objects/deals", "wrong")).status).toBe(401);
    expect((await get("/vendor/unknown/x")).status).toBe(404);
  });

  it("agree across tools: Plaid amounts are Stripe cents with Plaid's sign", async () => {
    const payouts = (await body("/vendor/stripe/v1/payouts?limit=100")).data as {
      amount: number;
      trace_id: { value: string };
    }[];
    const added = (await body("/vendor/plaid/transactions/sync")).added as {
      transaction_id: string;
      amount: number;
    }[];
    for (const p of payouts) {
      const t = added.find((a) => a.transaction_id === p.trace_id.value);
      expect(Math.round(-(t?.amount ?? 0) * 100)).toBe(p.amount);
    }
    expect(payouts.length).toBeGreaterThan(0);
  });
});
