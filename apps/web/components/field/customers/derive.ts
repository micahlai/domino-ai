// Customers page model. Pure: every number comes from the saved snapshot, the learned model, the
// cash rules and the engine. Missing data stays null so the page can say "unknown"; nothing is
// estimated here that the engine does not estimate itself.
import type {
  BillingPlan,
  Change,
  CompanyModel,
  Constraint,
  Domino,
  Invoice,
  RiskEvent,
  Snapshot,
} from "@domino/contracts";
import { engine, isOpenInvoice, recurringAssumptions } from "@domino/engine";

/** Tools a customer record can come from, in display order. */
export type CustomerTool = "stripe" | "qbo" | "hubspot";

export type DelayBasis = "learned" | "observed" | "terms" | "none";

export type PaymentBehavior = {
  /** Whole days late the forecast uses (the engine's billing-plan delay order). */
  delayDays: number;
  basis: DelayBasis;
  /** "Learned from 8 payments", "Estimated from customers on Net 30", ... */
  basisLabel: string;
  /** Paid invoices for this customer observable by asOf. */
  paidCount: number;
  /** Mean days late over those paid invoices; null when none. */
  observedMeanDays: number | null;
  /** Later half of payments vs earlier half; null when fewer than four payments. */
  trend: "slower" | "faster" | "steady" | null;
};

export type RiskLevel = "high" | "medium" | "low";
export type RiskReason = { level: RiskLevel; text: string };

export type DominoChain = {
  /** Plain words for the stress: "Northwind pays 30 days late". */
  scenario: string;
  /** True when the stress is a fixed assumption rather than an engine-found risk. */
  assumption: boolean;
  probability: number | null;
  lowPoint: { weekStart: string; usable: number };
  baseLowPoint: { weekStart: string; usable: number };
  dominoes: Domino[];
  /** Orders of rule breaches the base forecast already has (same rule, same week). */
  alreadyInBase: number[];
};

export type CustomerRow = {
  id: string;
  name: string;
  termsDays: number;
  plans: {
    id: string;
    amount: number;
    everyMonths: number;
    nextInvoiceDate: string;
    endDate: string | null;
    active: boolean;
  }[];
  /** Recurring revenue per month in cents from active plans; null when the customer has no plan. */
  monthlyRecurring: number | null;
  annualRecurring: number | null;
  nextBillDate: string | null;
  openInvoices: number;
  openAmount: number;
  overdueInvoices: number;
  overdueAmount: number;
  /** Share of active recurring revenue, 0 to 1; null when the company has none. */
  recurringShare: number | null;
  sources: CustomerTool[];
  payment: PaymentBehavior;
  risk: { level: RiskLevel; reasons: RiskReason[] };
  chain: DominoChain | null;
  /** Why there is no chain, when there is none for a risky customer. */
  chainNote: string | null;
};

export type CustomerFinding = { summary: string; severity: RiskLevel; refs: string[] };
export type CustomerSignal = { title: string; source: string; date?: string; kinds: string[] };

export type CustomersInput = {
  snapshot: Snapshot;
  model: CompanyModel;
  constraints: Constraint[];
  /** Connected tool ids for the company; picks Stripe vs QuickBooks as the invoice record. */
  connected: readonly string[];
  /** Open audit findings (refs name record ids). */
  findings: CustomerFinding[];
  /** Saved public-web results keyed by customer id. */
  signals: Record<string, CustomerSignal[]>;
};

export type CustomersView = {
  asOf: string;
  totalMonthlyRecurring: number;
  baseLowPoint: { weekStart: string; usable: number };
  customers: CustomerRow[];
};

export const STRESS_DAYS = 30;
const MAX_CHAINS = 6;
const MAX_CHANGES = 8;
const CHURN_LOOKBACK_DAYS = 182;
const NEGATIVE_NEWS = new Set(["layoffs", "bankruptcy", "lawsuit"]);

const ms = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
const daysBetween = (from: string, to: string) => Math.round((ms(to) - ms(from)) / 86_400_000);
const addDays = (d: string, n: number) =>
  new Date(ms(d) + n * 86_400_000).toISOString().slice(0, 10);
const mean = (xs: number[]) =>
  xs.length === 0 ? null : Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
const termsLabel = (days: number) => (days === 0 ? "due on receipt" : `Net ${days}`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const weight: Record<RiskLevel, number> = { high: 3, medium: 2, low: 1 };

/** Recurring revenue per month in whole cents. */
const monthlyCents = (plan: BillingPlan) => Math.round(plan.amount / plan.everyMonths);
const isActive = (plan: BillingPlan, asOf: string) =>
  plan.endDate === undefined || (plan.endDate >= asOf && plan.nextInvoiceDate <= plan.endDate);

function money(cents: number): string {
  const abs = Math.abs(cents) / 100;
  const sign = cents < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

/**
 * Payment delay, same order as packages/engine/src/recurring-revenue.ts: learned model mean,
 * else the customer's observed mean, else the mean over customers on the same terms, else zero.
 * Plan customers take the engine's own number; the basis says which rule produced it.
 */
function paymentBehavior(
  snapshot: Snapshot,
  model: CompanyModel,
  customerId: string,
  terms: number,
  engineDelay: number | undefined,
): PaymentBehavior {
  const termsOf = new Map(snapshot.customers.map((c) => [c.id, c.paymentTermsDays]));
  const paid = snapshot.invoices
    .filter((i) => i.paid !== undefined && i.paid <= snapshot.asOf)
    .map((i) => ({ i, late: daysBetween(i.due, i.paid as string) }));
  const own = paid
    .filter((p) => p.i.customerId === customerId)
    .sort((a, b) => ((a.i.paid as string) < (b.i.paid as string) ? -1 : 1));
  const sameTerms = paid.filter((p) => termsOf.get(p.i.customerId) === terms).map((p) => p.late);
  const learnedModel = model.customerDelayDays[customerId];
  const learned = learnedModel?.mean;
  const observed = mean(own.map((p) => p.late));
  const peers = mean(sameTerms);
  let basis: DelayBasis;
  let delay: number;
  let basisLabel: string;
  if (learned !== undefined) {
    basis = "learned";
    delay = Math.round(learned);
    const samples = learnedModel?.samples ?? own.length;
    basisLabel =
      samples > 0 ? `Learned from ${plural(samples, "payment")}` : "Learned by the payment model";
  } else if (observed !== null) {
    basis = "observed";
    delay = observed;
    basisLabel = `Observed over ${plural(own.length, "payment")}`;
  } else if (peers !== null) {
    basis = "terms";
    delay = peers;
    basisLabel = `Estimated from customers on ${termsLabel(terms)}`;
  } else {
    basis = "none";
    delay = 0;
    basisLabel = "No payment history; assumed on time";
  }
  if (engineDelay !== undefined) delay = engineDelay;
  let trend: PaymentBehavior["trend"] = null;
  if (own.length >= 4) {
    const half = Math.floor(own.length / 2);
    const early = mean(own.slice(0, half).map((p) => p.late)) ?? 0;
    const late = mean(own.slice(own.length - half).map((p) => p.late)) ?? 0;
    trend = late - early >= 3 ? "slower" : early - late >= 3 ? "faster" : "steady";
  }
  return {
    delayDays: delay,
    basis,
    basisLabel,
    paidCount: own.length,
    observedMeanDays: observed,
    trend,
  };
}

const touches = (risk: RiskEvent, invoiceIds: Set<string>, customerId: string) =>
  risk.changes.some(
    (c) =>
      ((c.kind === "delay_invoice" || c.kind === "lose_invoice") && invoiceIds.has(c.invoiceId)) ||
      (c.kind === "churn" && c.customerId === customerId),
  );

function chainFor(
  input: CustomersInput,
  name: string,
  open: Invoice[],
  risk: RiskEvent | undefined,
  base: ReturnType<typeof engine.forecast>,
  baseBreaches: Set<string>,
): { chain: DominoChain | null; note: string | null } {
  const { snapshot, model, constraints } = input;
  let changes: Change[];
  let scenario: string;
  let assumption = true;
  let probability: number | null = null;
  if (open.length > 0) {
    changes = open
      .slice(0, MAX_CHANGES)
      .map((i) => ({ kind: "delay_invoice", invoiceId: i.id, days: STRESS_DAYS }));
    scenario = `${name} pays ${STRESS_DAYS} days late`;
  } else if (risk) {
    changes = risk.changes;
    scenario = risk.label;
    assumption = false;
    probability = risk.probability;
  } else {
    return { chain: null, note: "No open invoices to stress in the forecast window." };
  }
  try {
    const forecast = engine.forecast(snapshot, model, changes);
    const dominoes = engine.dominoes(forecast, constraints, snapshot, {
      model,
      changes,
      baseline: base,
    });
    return {
      chain: {
        scenario,
        assumption,
        probability,
        lowPoint: forecast.lowPoint,
        baseLowPoint: base.lowPoint,
        dominoes,
        alreadyInBase: dominoes
          .filter((d) => d.constraintId && baseBreaches.has(`${d.constraintId}@${d.weekStart}`))
          .map((d) => d.order),
      },
      note: null,
    };
  } catch (error) {
    return {
      chain: null,
      note: `The engine could not run this stress: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function deriveCustomers(input: CustomersInput): CustomersView {
  const { snapshot, model, constraints } = input;
  const asOf = snapshot.asOf;
  const plans = snapshot.billingPlans ?? [];
  const { delayDays } = recurringAssumptions(snapshot, model);
  const base = engine.forecast(snapshot, model, []);
  const baseBreaches = new Set<string>();
  try {
    for (const d of engine.dominoes(base, constraints, snapshot))
      if (d.constraintId) baseBreaches.add(`${d.constraintId}@${d.weekStart}`);
  } catch {
    // Without base dominoes every breach in a chain is shown as new.
  }
  let risks: RiskEvent[] = [];
  try {
    risks = engine.scanRisks(snapshot, model, constraints);
  } catch {
    risks = [];
  }
  const invoiceTool: CustomerTool =
    input.connected.includes("stripe") || !input.connected.includes("qbo") ? "stripe" : "qbo";
  const totalMonthly = plans
    .filter((p) => isActive(p, asOf))
    .reduce((sum, p) => sum + monthlyCents(p), 0);
  const churnSince = addDays(asOf, -(CHURN_LOOKBACK_DAYS - 1));

  const rows = snapshot.customers.map((customer) => {
    const own = plans.filter((p) => p.customerId === customer.id);
    const active = own.filter((p) => isActive(p, asOf));
    const invoices = snapshot.invoices.filter((i) => i.customerId === customer.id);
    const invoiceIds = new Set(invoices.map((i) => i.id));
    const open = invoices.filter((i) => isOpenInvoice(i));
    const overdue = open.filter((i) => i.due < asOf);
    const monthly = own.length ? active.reduce((s, p) => s + monthlyCents(p), 0) : null;
    const share = totalMonthly > 0 && monthly !== null ? monthly / totalMonthly : null;
    const terms = own[0]?.paymentTermsDays ?? customer.paymentTermsDays;
    const payment = paymentBehavior(snapshot, model, customer.id, terms, delayDays[customer.id]);
    const deals = snapshot.deals.filter((d) => d.customerId === customer.id);
    const sources: CustomerTool[] = ["stripe"];
    if (invoices.length && invoiceTool === "qbo") sources.push("qbo");
    if (deals.length) sources.push("hubspot");

    const reasons: RiskReason[] = [];
    const customerRisks = risks.filter((r) => touches(r, invoiceIds, customer.id));
    for (const r of customerRisks)
      reasons.push({
        level: r.probability >= 0.3 ? "high" : "medium",
        text: `${r.label}: ${Math.round(r.probability * 100)}% chance, lowers the cash low point by ${money(r.impactLowPoint)}`,
      });
    if (payment.delayDays >= 15)
      reasons.push({
        level: "high",
        text: `Pays ${payment.delayDays} days late on average (${payment.basisLabel.toLowerCase()})`,
      });
    else if (payment.delayDays >= 7)
      reasons.push({
        level: "medium",
        text: `Pays ${payment.delayDays} days late on average (${payment.basisLabel.toLowerCase()})`,
      });
    if (payment.trend === "slower")
      reasons.push({ level: "medium", text: "Recent payments are slower than earlier ones" });
    if (overdue.length) {
      const oldest = Math.max(...overdue.map((i) => daysBetween(i.due, asOf)));
      reasons.push({
        level: oldest > 30 ? "high" : "medium",
        text: `${money(overdue.reduce((s, i) => s + i.amount, 0))} overdue across ${plural(overdue.length, "invoice")}, oldest ${oldest} days past due`,
      });
    }
    if (share !== null && share >= 0.1)
      reasons.push({
        level: share >= 0.2 ? "high" : "medium",
        text: `${Math.round(share * 100)}% of recurring revenue`,
      });
    if (own.length && !active.length) {
      const ended =
        own
          .map((p) => p.endDate ?? "")
          .sort()
          .at(-1) ?? "";
      if (ended >= churnSince)
        reasons.push({ level: "medium", text: `Plan ended ${ended}; no active plan` });
    }
    for (const p of active)
      if (p.endDate !== undefined)
        reasons.push({ level: "medium", text: `Plan ${p.id} ends ${p.endDate}` });
    for (const d of deals)
      if (d.kind === "renewal" && d.stage === "won" && !d.signed)
        reasons.push({ level: "medium", text: `Renewal ${d.id} marked won but not signed` });
    const recordIds = new Set([customer.id, ...invoiceIds, ...deals.map((d) => d.id)]);
    for (const f of input.findings)
      if (f.refs.some((r) => recordIds.has(r) || r.endsWith(`:${customer.id}`)))
        reasons.push({
          level: f.severity === "high" ? "high" : "medium",
          text: `Open audit flag: ${f.summary}`,
        });
    for (const s of input.signals[customer.id] ?? []) {
      const bad = s.kinds.filter((k) => NEGATIVE_NEWS.has(k));
      if (bad.length)
        reasons.push({
          level: "medium",
          text: `Public news (${bad.join(", ")}): ${s.title} (${s.source}${s.date ? `, ${s.date}` : ""})`,
        });
    }
    const level: RiskLevel = reasons.some((r) => r.level === "high")
      ? "high"
      : reasons.length
        ? "medium"
        : "low";
    const nextBill =
      active
        .map((p) => p.nextInvoiceDate)
        .sort()
        .at(0) ?? null;
    return {
      row: {
        id: customer.id,
        name: customer.name,
        termsDays: customer.paymentTermsDays,
        plans: own.map((p) => ({
          id: p.id,
          amount: p.amount,
          everyMonths: p.everyMonths,
          nextInvoiceDate: p.nextInvoiceDate,
          endDate: p.endDate ?? null,
          active: isActive(p, asOf),
        })),
        monthlyRecurring: monthly,
        annualRecurring: monthly === null ? null : monthly * 12,
        nextBillDate: nextBill,
        openInvoices: open.length,
        openAmount: open.reduce((s, i) => s + i.amount, 0),
        overdueInvoices: overdue.length,
        overdueAmount: overdue.reduce((s, i) => s + i.amount, 0),
        recurringShare: share,
        sources,
        payment,
        risk: { level, reasons: reasons.sort((a, b) => weight[b.level] - weight[a.level]) },
        chain: null,
        chainNote: null,
      } as CustomerRow,
      open,
      risk: customerRisks[0],
      score:
        reasons.reduce((s, r) => s + weight[r.level], 0) * 1e12 +
        (monthly ?? 0) +
        open.reduce((s, i) => s + i.amount, 0),
    };
  });

  rows.sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name));
  let chains = 0;
  for (const r of rows) {
    if (r.row.risk.level === "low" || chains >= MAX_CHAINS) continue;
    const { chain, note } = chainFor(input, r.row.name, r.open, r.risk, base, baseBreaches);
    r.row.chain = chain;
    r.row.chainNote = note;
    chains++;
  }
  return {
    asOf,
    totalMonthlyRecurring: totalMonthly,
    baseLowPoint: base.lowPoint,
    customers: rows.map((r) => r.row),
  };
}
