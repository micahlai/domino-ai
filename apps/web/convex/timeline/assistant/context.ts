import { type WorkspaceRun, recordsOf } from "../questions/context";
import { addDays } from "../questions/parse";

/**
 * Everything Claude may know about the company, taken from one saved run. Money stays in
 * integer cents exactly as the engine produced it; Claude only reads and quotes these
 * numbers, it never computes new ones. Every capped list states its total, so a reader
 * knows when to look a record up instead of assuming it does not exist.
 */
export type CompanyContext = ReturnType<typeof companyContext>;

const MAX_RECORDS = 150;
const MAX_PAST_EVENTS = 40;
const MAX_FINDINGS = 100;
const MAX_MODEL_ITEMS = 100;

function capped<T>(name: string, all: T[], max: number, limits: Record<string, unknown>): T[] {
  limits[name] = { total: all.length, included: Math.min(all.length, max) };
  return all.slice(0, max);
}

export function companyContext(run: WorkspaceRun) {
  const { seed, history, pastEvents, companyName, model } = run.baseline;
  const { snapshot } = seed;
  const weeks = run.forecast.weeks;
  const records = recordsOf(run);
  const customers = new Map(snapshot.customers.map((c) => [c.id, c.name]));
  const recentPaid = records
    .filter((r) => r.paid !== null && r.kind !== "payroll")
    .sort((a, b) => (b.paid ?? "").localeCompare(a.paid ?? ""));
  const limits: Record<string, unknown> = {};
  const delays = Object.entries(model.customerDelayDays);
  return {
    company: { id: run.companyId, name: companyName },
    asOf: snapshot.asOf,
    moneyUnit: "integer cents (12345 = $123.45)",
    savedBooks: {
      seedId: seed.id,
      exportedAt: seed.exportedAt,
      cashOnHand: snapshot.cashOnHand,
      restrictedCash: snapshot.restrictedCash,
      recordCounts: Object.fromEntries(
        Object.entries(snapshot)
          .filter(([, value]) => Array.isArray(value))
          .map(([key, value]) => [key, (value as unknown[]).length]),
      ),
      assumptionNote: run.baseline.assumptionNote,
    },
    run: { runId: run.runId, kind: run.kind, label: run.label, savedAt: run.savedAt },
    forecastWindow: {
      from: weeks[0]?.weekStart ?? "",
      to: addDays(weeks[weeks.length - 1]?.weekStart ?? "", 6),
    },
    forecastWeeks: weeks.map((w) => ({
      weekStart: w.weekStart,
      opening: w.opening,
      inflow: w.inflow,
      outflow: w.outflow,
      closing: w.closing,
      usable: w.usable,
    })),
    lowPoint: run.forecast.lowPoint,
    ...(run.comparison
      ? {
          comparisonWithParent: {
            parentRunId: run.comparison.parentRunId,
            lowPointDelta: run.comparison.lowPointDelta,
          },
        }
      : {}),
    recentHistory: history,
    rules: run.constraints.map((c) => ({
      id: c.id,
      label: c.label,
      kind: c.kind,
      limit: c.limit,
      ...(c.billId ? { billId: c.billId } : {}),
    })),
    ruleChecks: run.receipts.map((r) => ({
      label: r.label,
      status: r.status,
      value: r.value,
      shortfall: r.shortfall,
      weekStart: r.weekStart,
    })),
    dominoes: run.dominoes.map((d) => ({
      order: d.order,
      weekStart: d.weekStart,
      label: d.label,
      ...(d.causedBy ? { causedBy: d.causedBy } : {}),
    })),
    scenarioChanges: run.changes,
    /** Saved audit findings exported with these books (flags such as duplicates or gaps). */
    findings: capped("findings", seed.findings, MAX_FINDINGS, limits),
    learnedModel: {
      version: model.version,
      customerDelayDays: Object.fromEntries(
        capped("customerDelayDays", delays, MAX_MODEL_ITEMS, limits),
      ),
      recurringSpend: capped("recurringSpend", model.recurringSpend, MAX_MODEL_ITEMS, limits),
      rules: capped("learnedRules", model.rules, MAX_MODEL_ITEMS, limits),
    },
    openInvoices: capped(
      "openInvoices",
      snapshot.invoices.filter((i) => !i.paid),
      MAX_RECORDS,
      limits,
    ).map((i) => ({ ...i, customer: customers.get(i.customerId) ?? i.customerId })),
    openBills: capped(
      "openBills",
      snapshot.bills.filter((b) => !b.paid),
      MAX_RECORDS,
      limits,
    ),
    recentlyPaid: capped("recentlyPaid", recentPaid, 20, limits).map(
      ({ kind, id, name, amount, paid }) => ({ kind, id, name, amount, paid }),
    ),
    pastEvents: capped("pastEvents", [...pastEvents].reverse(), MAX_PAST_EVENTS, limits).map(
      ({ date, label, kind, amount }) => ({
        date,
        label,
        kind,
        ...(amount !== undefined ? { amount } : {}),
      }),
    ),
    limits,
  };
}
