import { describe, expect, it } from "vitest";
import { fixtures } from "./fixtures";
import {
  BillSchema,
  type BillingPlan,
  BillingPlanSchema,
  type Deal,
  FieldMappingSchema,
  type Invoice,
  InvoiceSchema,
  LearningExampleSchema,
  type PendingPayout,
  PendingPayoutSchema,
  PlannedEventSchema,
  type Snapshot,
  SnapshotSchema,
  type WorldRuntime,
  type WorldState,
  WorldStateSchema,
} from "./index";

const legacy = fixtures.snapshot;
const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const plan: BillingPlan = {
  id: "plan_gen",
  customerId: "cus_gen",
  amount: 10_000_00,
  anchorDate: "2026-01-31",
  nextInvoiceDate: "2026-10-31",
  everyMonths: 1,
  paymentTermsDays: 30,
};
const planInvoice = (issued: string, extra: Partial<Invoice> = {}): Invoice => ({
  id: `inv_gen_${issued}`,
  customerId: "cus_gen",
  amount: 10_000_00,
  issued,
  due: issued,
  billingPlanId: "plan_gen",
  ...extra,
});
const payout: PendingPayout = {
  id: "po_1",
  amount: 9_700_00,
  expectedArrival: "2026-11-02",
  invoiceIds: ["inv_gen_2026-09-30"],
};

/** Every new optional field populated once, on top of the untouched legacy fixture. */
const forward: Snapshot = {
  ...legacy,
  customers: [...legacy.customers, { id: "cus_gen", name: "Generated Co", paymentTermsDays: 30 }],
  invoices: [
    ...legacy.invoices.map((invoice) =>
      invoice.id === "inv_nw_q4"
        ? { ...invoice, collection: { payOn: "2026-12-15", amount: invoice.amount } }
        : invoice,
    ),
    planInvoice("2026-02-28", { paid: "2026-03-20" }),
    planInvoice("2026-08-31", { writtenOff: "2026-10-29" }),
    planInvoice("2026-09-30", { paid: "2026-10-28", paidAmount: 10_000_00 }),
  ],
  bills: legacy.bills.map((bill) =>
    bill.id === "bill_agency_nov" ? { ...bill, agreedPayOn: "2026-11-29" } : bill,
  ),
  billingPlans: [plan],
  pendingPayouts: [payout],
};

function issuesOf(result: { success: boolean; error?: { issues: { path: unknown[] }[] } }) {
  expect(result.success).toBe(false);
  return result.error?.issues.map((issue) => issue.path) ?? [];
}
const snapshotIssues = (snapshot: unknown) => issuesOf(SnapshotSchema.safeParse(snapshot));
const withInvoices = (...invoices: Invoice[]): Snapshot => ({
  ...forward,
  invoices: [...forward.invoices, ...invoices],
});
const replaceInvoice = (id: string, patch: Partial<Invoice>): Snapshot => ({
  ...forward,
  invoices: forward.invoices.map((invoice) =>
    invoice.id === id ? { ...invoice, ...patch } : invoice,
  ),
});
const indexOfInvoice = (id: string) => forward.invoices.findIndex((invoice) => invoice.id === id);

describe("legacy compatibility", () => {
  it("parses the unchanged legacy fixture without adding fields", () => {
    const parsed = SnapshotSchema.parse(roundTrip(legacy));
    expect(parsed).toEqual(legacy);
    expect("billingPlans" in parsed).toBe(false);
    expect("pendingPayouts" in parsed).toBe(false);
    for (const invoice of parsed.invoices) expect(Object.keys(invoice)).not.toContain("paidAmount");
  });

  it("keeps a legacy invoice issued after asOf and legacy shape-only dates valid", () => {
    expect(legacy.invoices.some((invoice) => invoice.issued > legacy.asOf)).toBe(true);
    expect(InvoiceSchema.safeParse({ ...legacy.invoices[0], due: "2026-02-30" }).success).toBe(
      true,
    );
  });

  it("round trips every new optional field", () => {
    expect(SnapshotSchema.parse(roundTrip(forward))).toEqual(forward);
  });
});

describe("billing plan", () => {
  it.each([
    ["2026-01-31", 1, "2026-02-28"],
    ["2026-01-31", 1, "2026-03-31"],
    ["2026-01-31", 1, "2026-04-30"],
    ["2028-01-31", 1, "2028-02-29"],
    ["2026-01-30", 1, "2026-02-28"],
    ["2026-01-30", 1, "2026-03-30"],
    ["2026-01-31", 3, "2026-04-30"],
    ["2026-11-30", 3, "2027-02-28"],
    ["2028-02-29", 12, "2029-02-28"],
    ["2028-02-29", 12, "2032-02-29"],
    ["2026-05-15", 1, "2026-05-15"],
  ])("accepts anchor %s every %i months next %s", (anchorDate, everyMonths, nextInvoiceDate) => {
    const candidate = { ...plan, anchorDate, everyMonths, nextInvoiceDate };
    expect(BillingPlanSchema.parse(roundTrip(candidate))).toEqual(candidate);
  });

  it.each([
    ["2026-01-31", 1, "2026-02-27"],
    ["2026-01-31", 1, "2026-03-28"],
    ["2026-01-31", 1, "2026-03-30"],
    ["2026-01-31", 3, "2026-03-31"],
    ["2026-01-31", 12, "2026-07-31"],
    ["2026-05-15", 1, "2026-04-15"],
    ["2028-02-29", 12, "2029-03-01"],
  ])("rejects off-cadence anchor %s every %i months next %s", (anchorDate, everyMonths, next) => {
    const candidate = { ...plan, anchorDate, everyMonths, nextInvoiceDate: next };
    expect(issuesOf(BillingPlanSchema.safeParse(candidate))).toContainEqual(["nextInvoiceDate"]);
  });

  it.each([
    ["anchorDate", "2026-02-30"],
    ["nextInvoiceDate", "2026-11-31"],
    ["endDate", "2026-13-01"],
    ["amount", 0],
    ["amount", -1],
    ["amount", 1.5],
    ["amount", 2 ** 53],
    ["everyMonths", 2],
    ["everyMonths", 6],
    ["paymentTermsDays", -1],
    ["paymentTermsDays", 1.5],
  ])("rejects %s %s", (field, value) => {
    expect(BillingPlanSchema.safeParse({ ...plan, [field]: value }).success).toBe(false);
  });

  it("allows a cancellation end date before the cursor", () => {
    expect(BillingPlanSchema.safeParse({ ...plan, endDate: "2026-10-01" }).success).toBe(true);
  });

  it("requires unique plan IDs, known customers and a cursor after asOf", () => {
    expect(snapshotIssues({ ...forward, billingPlans: [plan, plan] })).toContainEqual([
      "billingPlans",
      1,
      "id",
    ]);
    expect(
      snapshotIssues({ ...forward, billingPlans: [{ ...plan, customerId: "cus_x" }] }),
    ).toContainEqual(["billingPlans", 0, "customerId"]);
    for (const nextInvoiceDate of ["2026-10-30", "2026-09-30"]) {
      const late = { ...forward, billingPlans: [{ ...plan, nextInvoiceDate }] };
      expect(snapshotIssues(late)).toContainEqual(["billingPlans", 0, "nextInvoiceDate"]);
    }
  });

  it("rejects a plan customer with a signed won deal of unknown or no invoice", () => {
    const deal: Deal = {
      id: "deal_gen",
      customerId: "cus_gen",
      amount: 10_000_00,
      stage: "won",
      expectedClose: "2026-11-15",
      signed: true,
    };
    for (const overlap of [deal, { ...deal, invoiceId: null }]) {
      const result = { ...forward, deals: [...forward.deals, overlap] };
      expect(snapshotIssues(result)).toContainEqual(["deals", 2, "invoiceId"]);
    }
    for (const fine of [
      { ...deal, signed: false },
      { ...deal, stage: "open" as const },
      { ...deal, invoiceId: "inv_gen_2026-02-28" },
      { ...deal, customerId: "cus_cobalt" },
    ]) {
      expect(
        SnapshotSchema.safeParse({ ...forward, deals: [...forward.deals, fine] }).success,
      ).toBe(true);
    }
  });
});

describe("plan-linked invoices", () => {
  it("accepts historical links to an expired plan", () => {
    const expired = { ...forward, billingPlans: [{ ...plan, endDate: "2026-09-30" }] };
    expect(SnapshotSchema.safeParse(expired).success).toBe(true);
  });

  it.each([
    ["unknown plan", planInvoice("2026-07-31", { billingPlanId: "plan_x" }), "billingPlanId"],
    ["other customer", planInvoice("2026-07-31", { customerId: "cus_acme" }), "billingPlanId"],
    ["off cadence", planInvoice("2026-07-30"), "issued"],
    ["before anchor", planInvoice("2025-12-31"), "issued"],
    ["at the cursor", planInvoice("2026-10-31"), "issued"],
    ["changed amount", planInvoice("2026-07-31", { amount: 9_999_99 }), "amount"],
    ["repeated occurrence", planInvoice("2026-09-30", { id: "inv_dupe" }), "issued"],
  ])("rejects %s", (_label, invoice, field) => {
    expect(snapshotIssues(withInvoices(invoice))).toContainEqual([
      "invoices",
      forward.invoices.length,
      field,
    ]);
  });

  it("rejects a link issued after asOf even when the cursor is later", () => {
    const later = {
      ...withInvoices(planInvoice("2026-10-31")),
      billingPlans: [{ ...plan, nextInvoiceDate: "2026-11-30" }],
    };
    expect(snapshotIssues(later)).toContainEqual(["invoices", forward.invoices.length, "issued"]);
  });

  it("rejects a link to a duplicated plan ID", () => {
    const twice = { ...forward, billingPlans: [plan, { ...plan }] };
    expect(snapshotIssues(twice)).toContainEqual([
      "invoices",
      indexOfInvoice("inv_gen_2026-02-28"),
      "billingPlanId",
    ]);
  });
});

describe("invoice settlement fields", () => {
  const base = legacy.invoices[0]!;

  it.each([
    ["paidAmount without paid", { paidAmount: 1 }, "paidAmount"],
    ["paid and written off", { paid: "2026-10-29", writtenOff: "2026-10-29" }, "writtenOff"],
    ["paidAmount above amount", { paid: "2026-10-29", paidAmount: base.amount + 1 }, "paidAmount"],
    ["negative paidAmount", { paid: "2026-10-29", paidAmount: -1 }, "paidAmount"],
    ["fractional paidAmount", { paid: "2026-10-29", paidAmount: 1.5 }, "paidAmount"],
    [
      "collection above amount",
      { collection: { payOn: "2026-12-01", amount: base.amount + 1 } },
      "collection",
    ],
    ["negative collection", { collection: { payOn: "2026-12-01", amount: -1 } }, "collection"],
    ["unreal collection date", { collection: { payOn: "2026-11-31", amount: 1 } }, "collection"],
    ["unreal writeoff", { writtenOff: "2026-02-29" }, "writtenOff"],
  ])("rejects %s", (_label, patch, field) => {
    const paths = issuesOf(InvoiceSchema.safeParse({ ...base, ...patch }));
    expect(paths.some((path) => path[0] === field)).toBe(true);
  });

  it("accepts zero and full bounds and preserves amount and due", () => {
    for (const patch of [
      { paid: "2026-10-29", paidAmount: 0 },
      { paid: "2026-10-29", paidAmount: base.amount },
      { collection: { payOn: "2026-12-01", amount: 0 } },
      { writtenOff: "2026-10-29" },
    ]) {
      const parsed = InvoiceSchema.parse({ ...base, ...patch });
      expect([parsed.amount, parsed.due]).toEqual([base.amount, base.due]);
    }
  });

  it("rejects a writeoff observed after asOf and accepts one on asOf", () => {
    const id = "inv_gen_2026-08-31";
    expect(snapshotIssues(replaceInvoice(id, { writtenOff: "2026-10-31" }))).toContainEqual([
      "invoices",
      indexOfInvoice(id),
      "writtenOff",
    ]);
    expect(SnapshotSchema.safeParse(replaceInvoice(id, { writtenOff: legacy.asOf })).success).toBe(
      true,
    );
  });
});

describe("bill agreement", () => {
  const bill = legacy.bills[0]!;
  it("keeps the original due date beside an agreed date", () => {
    const parsed = BillSchema.parse({ ...bill, agreedPayOn: "2027-01-15" });
    expect([parsed.due, parsed.agreedPayOn]).toEqual([bill.due, "2027-01-15"]);
    expect(BillSchema.safeParse({ ...bill, agreedPayOn: "2027-02-29" }).success).toBe(false);
  });
});

describe("pending payouts", () => {
  const payoutIssues = (pendingPayouts: PendingPayout[], snapshot: Snapshot = forward) =>
    snapshotIssues({ ...snapshot, pendingPayouts });

  it.each([
    ["negative amount", { amount: -1 }],
    ["unsafe amount", { amount: 2 ** 53 }],
    ["unreal arrival", { expectedArrival: "2026-11-31" }],
    ["no invoices", { invoiceIds: [] }],
    ["repeated invoice", { invoiceIds: ["a", "a"] }],
  ])("rejects %s", (_label, patch) => {
    expect(PendingPayoutSchema.safeParse({ ...payout, ...patch }).success).toBe(false);
  });

  it("accepts an overdue estimate, a zero payout and the exact gross bound", () => {
    for (const patch of [{ expectedArrival: "2026-10-01" }, { amount: 0 }, { amount: 10_000_00 }]) {
      expect(
        SnapshotSchema.safeParse({ ...forward, pendingPayouts: [{ ...payout, ...patch }] }).success,
      ).toBe(true);
    }
  });

  it("rejects repeated payout IDs and an invoice in two payouts", () => {
    expect(payoutIssues([payout, payout])).toContainEqual(["pendingPayouts", 1, "id"]);
    expect(payoutIssues([payout, { ...payout, id: "po_2" }])).toContainEqual([
      "pendingPayouts",
      1,
      "invoiceIds",
      0,
    ]);
  });

  it.each([
    ["missing", ["inv_missing"]],
    ["unpaid", ["inv_acme_2027"]],
    ["written off", ["inv_gen_2026-08-31"]],
  ])("rejects a %s invoice", (_label, invoiceIds) => {
    expect(payoutIssues([{ ...payout, amount: 0, invoiceIds }])).toContainEqual([
      "pendingPayouts",
      0,
      "invoiceIds",
      0,
    ]);
  });

  it("rejects an invoice paid after asOf or present twice", () => {
    const id = "inv_gen_2026-09-30";
    expect(payoutIssues([payout], replaceInvoice(id, { paid: "2026-10-31" }))).toContainEqual([
      "pendingPayouts",
      0,
      "invoiceIds",
      0,
    ]);
    const twice = withInvoices(forward.invoices[indexOfInvoice(id)]!);
    expect(payoutIssues([payout], twice)).toContainEqual(["pendingPayouts", 0, "invoiceIds", 0]);
  });

  it("bounds net by gross paidAmount, falling back to amount for legacy paid invoices", () => {
    expect(payoutIssues([{ ...payout, amount: 10_000_01 }])).toContainEqual([
      "pendingPayouts",
      0,
      "amount",
    ]);
    const partial = replaceInvoice("inv_gen_2026-09-30", { paidAmount: 5_000_00 });
    expect(payoutIssues([{ ...payout, amount: 5_000_01 }], partial)).toContainEqual([
      "pendingPayouts",
      0,
      "amount",
    ]);
    const legacyPaid = replaceInvoice("inv_gen_2026-09-30", { paidAmount: undefined });
    const both = {
      ...payout,
      amount: 20_000_00,
      invoiceIds: ["inv_gen_2026-02-28", "inv_gen_2026-09-30"],
    };
    expect(SnapshotSchema.safeParse({ ...legacyPaid, pendingPayouts: [both] }).success).toBe(true);
    expect(payoutIssues([{ ...both, amount: 20_000_01 }], legacyPaid)).toContainEqual([
      "pendingPayouts",
      0,
      "amount",
    ]);
  });

  it("compares aggregate gross exactly beyond the safe range", () => {
    const max = Number.MAX_SAFE_INTEGER;
    const big = (id: string, amount: number): Invoice => ({
      id,
      customerId: "cus_acme",
      amount,
      issued: "2026-10-01",
      due: "2026-10-01",
      paid: "2026-10-02",
    });
    // Float addition rounds max + 2 down to 2^53, so a float sum would be 1, not 2.
    const snapshot = withInvoices(big("big", max), big("two", 2), big("neg", -max));
    const invoiceIds = ["big", "two", "neg"];
    const exact = { ...payout, amount: 2, invoiceIds };
    expect(SnapshotSchema.safeParse({ ...snapshot, pendingPayouts: [exact] }).success).toBe(true);
    expect(payoutIssues([{ ...exact, amount: 3 }], snapshot)).toContainEqual([
      "pendingPayouts",
      0,
      "amount",
    ]);
  });

  it("rejects a referenced legacy gross outside the safe integer range", () => {
    const unsafe = withInvoices({
      id: "huge",
      customerId: "cus_acme",
      amount: 2 ** 60,
      issued: "2026-10-01",
      due: "2026-10-01",
      paid: "2026-10-02",
    });
    expect(payoutIssues([{ ...payout, amount: 1, invoiceIds: ["huge"] }], unsafe)).toContainEqual([
      "pendingPayouts",
      0,
      "invoiceIds",
      0,
    ]);
  });
});

describe("field mappings", () => {
  const mapping = {
    source: "stripe",
    entity: "invoices",
    fields: {},
    transforms: [],
    endpoint: "/x",
  };
  it("accepts the new entities and still rejects unknown ones", () => {
    for (const entity of ["billingPlans", "pendingPayouts", "deals"]) {
      expect(FieldMappingSchema.safeParse({ ...mapping, entity }).success).toBe(true);
    }
    expect(FieldMappingSchema.safeParse({ ...mapping, entity: "subscriptions" }).success).toBe(
      false,
    );
  });
});

describe("replay origins", () => {
  const example = {
    snapshot: forward,
    actualBank: [],
    asOf: "2026-11-08",
    bankWindowComplete: true,
  };

  it("accepts plans, agreements and pending payout estimates after the origin", () => {
    expect(LearningExampleSchema.parse(roundTrip(example))).toEqual(example);
  });

  it("rejects a future writeoff observation at that record", () => {
    // Plain Invoice parse is fine; only the replay origin cutoff can see it is future.
    const id = "inv_nw_q4";
    const snapshot = replaceInvoice(id, { writtenOff: "2026-10-31" });
    const paths = issuesOf(LearningExampleSchema.safeParse({ ...example, snapshot }));
    expect(paths).toContainEqual(["snapshot", "invoices", indexOfInvoice(id), "writtenOff"]);
  });

  it("rejects a pending payout whose collection was observed after the origin", () => {
    const snapshot = replaceInvoice("inv_gen_2026-09-30", { paid: "2026-10-31" });
    expect(LearningExampleSchema.safeParse({ ...example, snapshot }).success).toBe(false);
  });
});

describe("simulator runtime", () => {
  const legacyWorld: WorldState = {
    companyId: "kestrel",
    profile: "kestrel",
    seed: 7,
    week: 3,
    today: legacy.asOf,
    snapshot: legacy,
    pendingEvents: [{ week: 5, label: "late", change: { kind: "lose_invoice", invoiceId: "x" } }],
  };
  const runtime: WorldRuntime = {
    version: 1,
    collections: [
      {
        invoiceId: "inv_acme_2027",
        payOn: "2026-11-20",
        payoutOn: "2026-11-22",
        grossAmount: legacy.invoices[0]!.amount,
        netAmount: legacy.invoices[0]!.amount - 100,
      },
    ],
    billPayments: [{ billId: "bill_rent_nov", payOn: "2026-11-05" }],
    cashEvents: [{ id: "cash_1", date: "2026-11-03", amount: -5_00, description: "Fee" }],
    appliedEvents: [
      { id: "ev_0", week: 3, change: { kind: "delay_bill", billId: "bill_rent_nov", days: 3 } },
    ],
  };
  const world: WorldState = {
    ...legacyWorld,
    snapshot: forward,
    pendingEvents: [{ ...legacyWorld.pendingEvents[0]!, id: "ev_1" }],
    runtime,
  };
  const worldIssues = (patch: Partial<WorldState>) =>
    issuesOf(WorldStateSchema.safeParse({ ...world, ...patch }));
  const runtimeIssues = (patch: Partial<WorldRuntime>) =>
    worldIssues({ runtime: { ...runtime, ...patch } });

  it("keeps legacy worlds and events without IDs valid and round trips runtime", () => {
    expect(WorldStateSchema.parse(roundTrip(legacyWorld))).toEqual(legacyWorld);
    expect(PlannedEventSchema.parse(legacyWorld.pendingEvents[0])).not.toHaveProperty("id");
    expect(WorldStateSchema.parse(roundTrip(world))).toEqual(world);
  });

  it("requires version 1 and real equal today and asOf", () => {
    expect(worldIssues({ runtime: { ...runtime, version: 2 as 1 } })).toContainEqual([
      "runtime",
      "version",
    ]);
    expect(worldIssues({ today: "2026-10-31" })).toContainEqual(["today"]);
    const unreal = { ...legacy, asOf: "2026-02-30" };
    expect(worldIssues({ today: "2026-02-30", snapshot: unreal })).toContainEqual(["today"]);
  });

  it.each([
    [
      "repeated collection",
      { collections: [runtime.collections[0]!, runtime.collections[0]!] },
      ["runtime", "collections", 1, "invoiceId"],
    ],
    [
      "missing collection invoice",
      { collections: [{ ...runtime.collections[0]!, invoiceId: "x" }] },
      ["runtime", "collections", 0, "invoiceId"],
    ],
    [
      "gross above invoice",
      {
        collections: [{ ...runtime.collections[0]!, grossAmount: legacy.invoices[0]!.amount + 1 }],
      },
      ["runtime", "collections", 0, "grossAmount"],
    ],
    [
      "net above gross",
      { collections: [{ ...runtime.collections[0]!, netAmount: legacy.invoices[0]!.amount + 1 }] },
      ["runtime", "collections", 0, "netAmount"],
    ],
    [
      "payout before pay",
      { collections: [{ ...runtime.collections[0]!, payoutOn: "2026-11-19" }] },
      ["runtime", "collections", 0, "payoutOn"],
    ],
    [
      "unreal pay date",
      { collections: [{ ...runtime.collections[0]!, payOn: "2026-11-31" }] },
      ["runtime", "collections", 0, "payOn"],
    ],
    [
      "repeated bill",
      { billPayments: [runtime.billPayments[0]!, runtime.billPayments[0]!] },
      ["runtime", "billPayments", 1, "billId"],
    ],
    [
      "missing bill",
      { billPayments: [{ billId: "x", payOn: "2026-11-05" }] },
      ["runtime", "billPayments", 0, "billId"],
    ],
    [
      "repeated cash event",
      { cashEvents: [runtime.cashEvents[0]!, runtime.cashEvents[0]!] },
      ["runtime", "cashEvents", 1, "id"],
    ],
    [
      "unreal cash date",
      { cashEvents: [{ ...runtime.cashEvents[0]!, date: "2026-02-29" }] },
      ["runtime", "cashEvents", 0, "date"],
    ],
    [
      "unsafe cash amount",
      { cashEvents: [{ ...runtime.cashEvents[0]!, amount: -(2 ** 53) }] },
      ["runtime", "cashEvents", 0, "amount"],
    ],
    [
      "repeated applied event",
      { appliedEvents: [runtime.appliedEvents[0]!, runtime.appliedEvents[0]!] },
      ["runtime", "appliedEvents", 1, "id"],
    ],
    [
      "applied in the future",
      { appliedEvents: [{ ...runtime.appliedEvents[0]!, week: 4 }] },
      ["runtime", "appliedEvents", 0, "week"],
    ],
  ] as const)("rejects %s", (_label, patch, path) => {
    expect(runtimeIssues(patch as unknown as Partial<WorldRuntime>)).toContainEqual(path);
  });

  it("rejects a collection or bill payment against a duplicated record", () => {
    const twice = {
      ...forward,
      invoices: [...forward.invoices, forward.invoices[0]!],
      bills: [...forward.bills, forward.bills[2]!],
    };
    const paths = worldIssues({ snapshot: twice });
    expect(paths).toContainEqual(["runtime", "collections", 0, "invoiceId"]);
    expect(paths).toContainEqual(["runtime", "billPayments", 0, "billId"]);
  });

  it("requires unique pending event IDs that were not already applied", () => {
    const event = world.pendingEvents[0]!;
    const { id: _, ...anonymous } = event;
    expect(worldIssues({ pendingEvents: [anonymous] })).toContainEqual(["pendingEvents", 0, "id"]);
    expect(worldIssues({ pendingEvents: [event, event] })).toContainEqual([
      "pendingEvents",
      1,
      "id",
    ]);
    expect(worldIssues({ pendingEvents: [{ ...event, id: "ev_0" }] })).toContainEqual([
      "pendingEvents",
      0,
      "id",
    ]);
  });
});
