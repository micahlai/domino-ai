import { z } from "zod";
import { CalendarDateSchema, SafeCentsSchema, flagRepeats, groupBy, isOnCadence } from "./checks";

/**
 * Core shared types. Every module talks to every other module through these.
 * Change only by pull request (see .claude/skills/contract-change).
 */

/** Money is ALWAYS an integer number of cents. */
export const CentsSchema = z.number().int();
export type Cents = z.infer<typeof CentsSchema>;

/** ISO calendar date, for example "2026-11-02". */
export const ISODateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
export type ISODate = z.infer<typeof ISODateSchema>;

export const IdSchema = z.string().min(1);
export type Id = z.infer<typeof IdSchema>;

export const SourceKindSchema = z.enum([
  "stripe",
  "nessie",
  "crm",
  "ramp",
  "books",
  "payroll",
  "document",
  "learned",
]);
export type SourceKind = z.infer<typeof SourceKindSchema>;

/** Proof behind any number, rule or suggestion. Shown in the "Show proof" drawer. */
export const EvidenceSchema = z.object({
  source: SourceKindSchema,
  /** Record id, or a document location such as "loan.pdf#7.2" */
  ref: z.string().min(1),
  /** Exact words from a document, when the proof is a document */
  quote: z.string().optional(),
  /** One plain sentence */
  note: z.string().min(1),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

// ---------- Canonical records: every connector outputs these ----------
// Fields typed CalendarDateSchema or SafeCentsSchema are newer and stricter than the
// legacy shape-only ISODateSchema and CentsSchema fields beside them.

export const CustomerSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  paymentTermsDays: z.number().int().nonnegative(),
});
export type Customer = z.infer<typeof CustomerSchema>;

/** Never more than the original invoice amount. */
const InvoiceShareSchema = SafeCentsSchema.nonnegative();

export const InvoiceSchema = z
  .object({
    id: IdSchema,
    customerId: IdSchema,
    /** Original amount; never changes. */
    amount: CentsSchema,
    issued: ISODateSchema,
    /** Original due date; never changes. */
    due: ISODateSchema,
    paid: ISODateSchema.optional(),
    /** The billing plan occurrence this invoice was issued for. */
    billingPlanId: IdSchema.optional(),
    /** Observable agreed full settlement, known before it happens. Not a partial payment. */
    collection: z.object({ payOn: CalendarDateSchema, amount: InvoiceShareSchema }).optional(),
    /** Terminal gross collected before processor fees. Requires paid. */
    paidAmount: InvoiceShareSchema.optional(),
    /** Date the invoice was observed written off. Excludes paid. */
    writtenOff: CalendarDateSchema.optional(),
  })
  .superRefine((invoice, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    if (invoice.paidAmount !== undefined && invoice.paid === undefined)
      issue(["paidAmount"], "paidAmount requires paid");
    if (invoice.paid !== undefined && invoice.writtenOff !== undefined)
      issue(["writtenOff"], "an invoice cannot be both paid and written off");
    if (invoice.paidAmount !== undefined && invoice.paidAmount > invoice.amount)
      issue(["paidAmount"], "paidAmount cannot exceed the original amount");
    if (invoice.collection && invoice.collection.amount > invoice.amount)
      issue(["collection", "amount"], "collection amount cannot exceed the original amount");
  });
export type Invoice = z.infer<typeof InvoiceSchema>;

export const BankTxnSchema = z.object({
  id: IdSchema,
  date: ISODateSchema,
  /** Positive = money in, negative = money out */
  amount: CentsSchema,
  description: z.string(),
  counterparty: z.string().optional(),
});
export type BankTxn = z.infer<typeof BankTxnSchema>;

export const BillSchema = z.object({
  id: IdSchema,
  vendor: z.string().min(1),
  amount: CentsSchema,
  due: ISODateSchema,
  paid: ISODateSchema.optional(),
  /** Known agreed payment date; due stays the original. Not evidence of payment. */
  agreedPayOn: CalendarDateSchema.optional(),
  /** Critical bills (payroll provider, cloud, key vendors) are never delayed by fixes */
  critical: z.boolean(),
});
export type Bill = z.infer<typeof BillSchema>;

export const CardTxnSchema = z.object({
  id: IdSchema,
  date: ISODateSchema,
  amount: CentsSchema,
  merchant: z.string(),
  category: z.string(),
});
export type CardTxn = z.infer<typeof CardTxnSchema>;

export const PayrollRunSchema = z.object({
  id: IdSchema,
  date: ISODateSchema,
  amount: CentsSchema,
});
export type PayrollRun = z.infer<typeof PayrollRunSchema>;

export const DealSchema = z.object({
  id: IdSchema,
  customerId: IdSchema,
  amount: CentsSchema,
  stage: z.enum(["open", "won", "lost"]),
  expectedClose: ISODateSchema,
  /** A "won" deal with signed=false is a planted-error pattern: do not count it as cash */
  signed: z.boolean(),
  /** Missing = unknown legacy mapping; null = not invoiced; string = the full invoice. */
  invoiceId: IdSchema.nullable().optional(),
  /** Missing means unknown, not new business. */
  kind: z.enum(["new_business", "renewal", "expansion"]).optional(),
});
export type Deal = z.infer<typeof DealSchema>;

/**
 * Known recurring billing. nextInvoiceDate is the first unissued occurrence: on the
 * anchor's cadence, with the anchor day clamped to short months.
 */
export const BillingPlanSchema = z
  .object({
    id: IdSchema,
    customerId: IdSchema,
    amount: SafeCentsSchema.positive(),
    anchorDate: CalendarDateSchema,
    nextInvoiceDate: CalendarDateSchema,
    everyMonths: z.union([z.literal(1), z.literal(3), z.literal(12)]),
    paymentTermsDays: z.number().int().nonnegative(),
    /** Last permitted issuance date. May precede nextInvoiceDate after cancellation. */
    endDate: CalendarDateSchema.optional(),
  })
  .superRefine((plan, ctx) => {
    if (!isOnCadence(plan.anchorDate, plan.nextInvoiceDate, plan.everyMonths)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nextInvoiceDate"],
        message: "nextInvoiceDate must be an occurrence of the anchored cadence",
      });
    }
  });
export type BillingPlan = z.infer<typeof BillingPlanSchema>;

/** Processor-reported collected cash not yet deposited. expectedArrival is an estimate. */
export const PendingPayoutSchema = z
  .object({
    id: IdSchema,
    /** Net of processor fees */
    amount: SafeCentsSchema.nonnegative(),
    expectedArrival: CalendarDateSchema,
    invoiceIds: z.array(IdSchema).min(1),
  })
  .superRefine((payout, ctx) =>
    flagRepeats(
      ctx,
      payout.invoiceIds,
      (id) => id,
      (index) => ["invoiceIds", index],
      "repeated invoice",
    ),
  );
export type PendingPayout = z.infer<typeof PendingPayoutSchema>;

/** All canonical records for one company at one date. */
export const SnapshotSchema = z
  .object({
    companyId: IdSchema,
    asOf: ISODateSchema,
    cashOnHand: CentsSchema,
    /** Cash the company holds but cannot use (for example, lease collateral) */
    restrictedCash: CentsSchema,
    customers: z.array(CustomerSchema),
    invoices: z.array(InvoiceSchema),
    bankTxns: z.array(BankTxnSchema),
    bills: z.array(BillSchema),
    cardTxns: z.array(CardTxnSchema),
    payroll: z.array(PayrollRunSchema),
    deals: z.array(DealSchema),
    billingPlans: z.array(BillingPlanSchema).optional(),
    pendingPayouts: z.array(PendingPayoutSchema).optional(),
  })
  .superRefine((snapshot, ctx) => {
    const invoices = new Map<string, Invoice[]>();
    for (const invoice of snapshot.invoices) {
      const matches = invoices.get(invoice.id) ?? [];
      matches.push(invoice);
      invoices.set(invoice.id, matches);
    }
    const claimed = new Set<string>();
    for (const [index, deal] of snapshot.deals.entries()) {
      if (deal.invoiceId == null) continue;
      const matches = invoices.get(deal.invoiceId) ?? [];
      const invoice = matches[0];
      let message: string | undefined;
      if (matches.length !== 1) message = "linked invoice must exist exactly once";
      else if (invoice?.customerId !== deal.customerId)
        message = "linked invoice customer must match";
      else if (invoice.amount !== deal.amount)
        message = "linked invoice must cover the full deal amount";
      if (message) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["deals", index, "invoiceId"], message });
      }
      if (claimed.has(deal.invoiceId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["deals", index, "invoiceId"],
          message: "an invoice may only be linked to one deal",
        });
      }
      claimed.add(deal.invoiceId);
    }
    checkForwardData(snapshot, invoices, ctx);
  });
export type Snapshot = z.infer<typeof SnapshotSchema>;

export const ConstraintConsequenceSchema = z.object({
  label: z.string().min(1),
  evidence: EvidenceSchema,
});
export type ConstraintConsequence = z.infer<typeof ConstraintConsequenceSchema>;

export const ConstraintSchema = z
  .object({
    id: IdSchema,
    /** Plain words, for example "Lender's minimum" */
    label: z.string().min(1),
    kind: z.enum(["min_cash", "pay_by_date", "min_runway_months"]),
    /** Cents for min_cash; allowed late days after the original bill due date for pay_by_date; months for min_runway_months */
    limit: z.number(),
    evidence: EvidenceSchema,
    /** Only pay_by_date uses a bill target. Missing legacy targets cannot be evaluated. */
    billId: IdSchema.optional(),
    consequence: ConstraintConsequenceSchema.optional(),
  })
  .superRefine((constraint, ctx) => {
    if (constraint.kind === "pay_by_date") {
      if (!Number.isInteger(constraint.limit) || constraint.limit < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["limit"],
          message: "pay_by_date limit must be a nonnegative integer number of late days",
        });
      }
    } else if (constraint.billId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["billId"],
        message: "billId is only meaningful for pay_by_date",
      });
    }
  });
export type Constraint = z.infer<typeof ConstraintSchema>;

// ---------- What Domino learned (self-learning output) ----------

export const CustomerDelaySchema = z.object({
  mean: z.number(),
  p90: z.number(),
  samples: z.number().int().nonnegative(),
});
export type CustomerDelay = z.infer<typeof CustomerDelaySchema>;

export const LearnedRuleSchema = z.object({
  id: IdSchema,
  text: z.string().min(1),
  evidence: z.array(EvidenceSchema),
  approvedBy: z.string().optional(),
  /** Forecast error (percent) on past weeks before and after the rule */
  errorBefore: z.number(),
  errorAfter: z.number(),
});
export type LearnedRule = z.infer<typeof LearnedRuleSchema>;

export const RecurringSpendSchema = z.object({
  label: z.string(),
  amount: CentsSchema,
  everyDays: z.number().int().positive(),
});
export type RecurringSpend = z.infer<typeof RecurringSpendSchema>;

export const CompanyModelSchema = z.object({
  version: z.number().int().nonnegative(),
  customerDelayDays: z.record(IdSchema, CustomerDelaySchema),
  recurringSpend: z.array(RecurringSpendSchema),
  rules: z.array(LearnedRuleSchema),
});
export type CompanyModel = z.infer<typeof CompanyModelSchema>;

interface SnapshotRecords {
  asOf: ISODate;
  customers: Customer[];
  invoices: Invoice[];
  deals: Deal[];
  billingPlans?: BillingPlan[];
  pendingPayouts?: PendingPayout[];
}

/** Cross-record rules for billing plans, settlement fields and pending payouts. */
function checkForwardData(
  snapshot: SnapshotRecords,
  invoicesById: Map<string, Invoice[]>,
  ctx: z.RefinementCtx,
): void {
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
  const { asOf } = snapshot;
  const plans = snapshot.billingPlans ?? [];
  const plansById = groupBy(plans, (plan) => plan.id);
  const customers = new Set(snapshot.customers.map((customer) => customer.id));

  flagRepeats(
    ctx,
    plans,
    (plan) => plan.id,
    (i) => ["billingPlans", i, "id"],
    "repeated plan id",
  );
  for (const [index, plan] of plans.entries()) {
    if (!customers.has(plan.customerId))
      issue(["billingPlans", index, "customerId"], "plan customer must exist");
    // Same-shape ISO dates order correctly as strings.
    if (plan.nextInvoiceDate <= asOf)
      issue(["billingPlans", index, "nextInvoiceDate"], "nextInvoiceDate must be after asOf");
  }

  const occurrences = new Set<string>();
  for (const [index, invoice] of snapshot.invoices.entries()) {
    const at = (field: string) => ["invoices", index, field];
    if (invoice.writtenOff !== undefined && invoice.writtenOff > asOf)
      issue(at("writtenOff"), "writtenOff cannot be after asOf");
    if (invoice.billingPlanId === undefined) continue;
    const matches = plansById.get(invoice.billingPlanId) ?? [];
    const plan = matches[0];
    if (matches.length !== 1 || !plan) {
      issue(at("billingPlanId"), "linked plan must exist exactly once");
      continue;
    }
    if (plan.customerId !== invoice.customerId)
      issue(at("billingPlanId"), "linked plan customer must match");
    if (!isOnCadence(plan.anchorDate, invoice.issued, plan.everyMonths))
      issue(at("issued"), "issued must be an occurrence of the plan's cadence");
    else if (invoice.issued > asOf)
      issue(at("issued"), "a plan invoice cannot be issued after asOf");
    else if (invoice.issued >= plan.nextInvoiceDate)
      issue(at("issued"), "a plan invoice must precede the plan's nextInvoiceDate");
    else if (plan.endDate !== undefined && invoice.issued > plan.endDate)
      issue(at("issued"), "a plan invoice cannot be issued after the plan's endDate");
    if (invoice.amount !== plan.amount)
      issue(at("amount"), "a plan invoice must bill the plan amount");
    const occurrence = JSON.stringify([plan.id, invoice.issued]);
    if (occurrences.has(occurrence))
      issue(at("issued"), "this plan occurrence is already invoiced");
    occurrences.add(occurrence);
  }

  // No deal-to-plan valuation yet: an uninvoiced signed win for a plan customer is ambiguous cash.
  const planCustomers = new Set(plans.map((plan) => plan.customerId));
  for (const [index, deal] of snapshot.deals.entries()) {
    if (
      planCustomers.has(deal.customerId) &&
      deal.stage === "won" &&
      deal.signed &&
      deal.invoiceId == null
    )
      issue(
        ["deals", index, "invoiceId"],
        "a billing plan customer's signed won deal needs its invoice",
      );
  }

  const payouts = snapshot.pendingPayouts ?? [];
  flagRepeats(
    ctx,
    payouts,
    (payout) => payout.id,
    (i) => ["pendingPayouts", i, "id"],
    "repeated payout id",
  );
  const claimed = new Set<string>();
  for (const [index, payout] of payouts.entries()) {
    let gross = 0n;
    let complete = true;
    for (const [position, id] of payout.invoiceIds.entries()) {
      const fail = (message: string) => {
        issue(["pendingPayouts", index, "invoiceIds", position], message);
        complete = false;
      };
      const matches = invoicesById.get(id) ?? [];
      const invoice = matches[0];
      if (claimed.has(id)) fail("an invoice may only be in one pending payout");
      else if (matches.length !== 1 || !invoice) fail("payout invoice must exist exactly once");
      else if (invoice.paid === undefined || invoice.paid > asOf)
        fail("payout invoice must be paid on or before asOf");
      else if (invoice.writtenOff !== undefined) fail("payout invoice cannot be written off");
      else {
        const collected = invoice.paidAmount ?? invoice.amount;
        if (Number.isSafeInteger(collected)) gross += BigInt(collected);
        else fail("payout invoice gross must be safe integer cents");
      }
    }
    // BigInt keeps the aggregate exact past Number.MAX_SAFE_INTEGER.
    if (complete && Number.isSafeInteger(payout.amount) && BigInt(payout.amount) > gross)
      issue(["pendingPayouts", index, "amount"], "net payout cannot exceed gross collected");
    for (const id of payout.invoiceIds) claimed.add(id);
  }
}
