import { z } from "zod";

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

export const CustomerSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  paymentTermsDays: z.number().int().nonnegative(),
});
export type Customer = z.infer<typeof CustomerSchema>;

export const InvoiceSchema = z.object({
  id: IdSchema,
  customerId: IdSchema,
  amount: CentsSchema,
  issued: ISODateSchema,
  due: ISODateSchema,
  paid: ISODateSchema.optional(),
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
