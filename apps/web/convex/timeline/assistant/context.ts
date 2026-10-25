import { type WorkspaceRun, recordsOf } from "../questions/context";
import { addDays } from "../questions/parse";

/**
 * Everything Claude may know about the company, taken from one saved run. Money stays in
 * integer cents exactly as the engine produced it; Claude only reads and quotes these
 * numbers, it never computes new ones.
 */
export type CompanyContext = ReturnType<typeof companyContext>;

const MAX_RECORDS = 120;
const MAX_PAST_EVENTS = 20;

export function companyContext(run: WorkspaceRun) {
  const { seed, history, pastEvents, companyName } = run.baseline;
  const weeks = run.forecast.weeks;
  const records = recordsOf(run);
  const open = records.filter((r) => r.paid === null && r.kind !== "payroll");
  const recentPaid = records
    .filter((r) => r.paid !== null && r.kind !== "payroll")
    .sort((a, b) => (b.paid ?? "").localeCompare(a.paid ?? ""))
    .slice(0, 20);
  return {
    company: { id: run.companyId, name: companyName },
    asOf: seed.snapshot.asOf,
    moneyUnit: "integer cents (12345 = $123.45)",
    run: { runId: run.runId, kind: run.kind, label: run.label },
    forecastWindow: {
      from: weeks[0]?.weekStart ?? "",
      to: addDays(weeks[weeks.length - 1]?.weekStart ?? "", 6),
    },
    forecastWeeks: weeks.map((w) => ({
      weekStart: w.weekStart,
      inflow: w.inflow,
      outflow: w.outflow,
      closing: w.closing,
      usable: w.usable,
    })),
    lowPoint: run.forecast.lowPoint,
    recentHistory: history.slice(-8),
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
    openInvoices: open
      .filter((r) => r.kind === "invoice")
      .slice(0, MAX_RECORDS)
      .map(({ id, name, amount, due }) => ({ id, customer: name, amount, due })),
    openBills: open
      .filter((r) => r.kind === "bill")
      .slice(0, MAX_RECORDS)
      .map(({ id, name, amount, due }) => ({ id, vendor: name, amount, due })),
    recentlyPaid: recentPaid.map(({ kind, id, name, amount, paid }) => ({
      kind,
      id,
      name,
      amount,
      paid,
    })),
    pastEvents: pastEvents.slice(-MAX_PAST_EVENTS).map(({ date, label, kind, amount }) => ({
      date,
      label,
      kind,
      ...(amount !== undefined ? { amount } : {}),
    })),
  };
}
