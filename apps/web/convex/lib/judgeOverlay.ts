import type { Invoice, Snapshot } from "@domino/contracts";

/**
 * Judge sandbox overlay (pure, no Convex functions). Extra source-side entries a judge planted
 * through fieldJudge.ts, kept beside the mock feed's own overlay in feedWorlds.overlay. Every
 * field is optional, so overlays written before the sandbox existed read exactly as before.
 * fieldFeed.servedSnapshot applies these after its own overlay; the result still has to pass
 * SnapshotSchema, so a planted entry can never produce records the contracts reject.
 * Synthetic data only: this changes what the mock vendor APIs report, nothing else.
 */
export interface JudgeOverlay {
  /** Customer pays late: these open invoices are reported with a later due date. */
  invoiceDue?: { id: string; due: string }[];
  /** Customer pays late: these billing plans are reported with longer payment terms. */
  planTerms?: { id: string; paymentTermsDays: number }[];
  /** Customer leaves: billing stops after `from`, later invoices and open deals go away. */
  churn?: { customerId: string; from: string }[];
  /** Payroll grows by `bps` (basis points) on every run dated after `from`. */
  payrollRaise?: { from: string; bps: number }[];
  /** Bank vs Stripe: the bank now reports this existing deposit at a different amount. */
  bankAmounts?: { id: string; amount: number }[];
  /** CSV upload: invoices a judge added. Bills and bank rows use the feed's own overlay lists. */
  invoices?: Invoice[];
  /** What the judge submitted, oldest first. Read by the sandbox only, never served. */
  history?: JudgeHistoryEntry[];
}

export type JudgeHistoryEntry = {
  at: string;
  /** Snapshot version current when it was submitted; the next version includes it. */
  version: number;
  kind: string;
  label: string;
  summary: string;
  refs: string[];
};

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Integer cents scaled by basis points, rounded half away from zero. No float money. */
export function scaleCents(cents: number, bps: number): number {
  const scaled = cents * (10_000 + bps);
  const sign = scaled < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(scaled) + 5_000) / 10_000);
}

/** The snapshot as the mock sources report it after the judge's planted entries. */
export function applyJudgeOverlay<S extends Snapshot>(s: S, o: JudgeOverlay): S {
  const due = new Map((o.invoiceDue ?? []).map((p) => [p.id, p.due]));
  const terms = new Map((o.planTerms ?? []).map((p) => [p.id, p.paymentTermsDays]));
  const bank = new Map((o.bankAmounts ?? []).map((p) => [p.id, p.amount]));
  const churn = new Map<string, string>();
  for (const c of o.churn ?? []) {
    const prev = churn.get(c.customerId);
    if (!prev || c.from < prev) churn.set(c.customerId, c.from);
  }
  const extra = (o.invoices ?? []).filter((i) => !s.invoices.some((x) => x.id === i.id));

  // A churned customer: invoices issued after it left are no longer reported.
  const dropped = new Set(
    s.invoices
      .filter((i) => {
        const from = churn.get(i.customerId);
        return from !== undefined && i.issued > from;
      })
      .map((i) => i.id),
  );
  const invoices = [...s.invoices, ...extra]
    .filter((i) => !dropped.has(i.id))
    .map((i) => {
      const d = due.get(i.id);
      return d && !i.paid && !i.writtenOff ? { ...i, due: d } : i;
    });
  const billingPlans = s.billingPlans?.map((p) => {
    const from = churn.get(p.customerId);
    const t = terms.get(p.id);
    const next = t === undefined ? p : { ...p, paymentTermsDays: t };
    if (from === undefined) return next;
    return { ...next, endDate: next.endDate && next.endDate < from ? next.endDate : from };
  });
  const pendingPayouts = s.pendingPayouts
    ?.map((p) => ({ ...p, invoiceIds: p.invoiceIds.filter((id) => !dropped.has(id)) }))
    .filter((p) => p.invoiceIds.length > 0);
  const deals = s.deals
    .filter((d) => !(d.invoiceId && dropped.has(d.invoiceId)))
    .map((d) =>
      churn.has(d.customerId) && d.stage === "open" ? { ...d, stage: "lost" as const } : d,
    );
  const raises = o.payrollRaise ?? [];
  const payroll = s.payroll.map((run) => {
    let amount = run.amount;
    for (const r of raises) if (run.date > r.from) amount = scaleCents(amount, r.bps);
    return amount === run.amount ? run : { ...run, amount };
  });
  const bankTxns = s.bankTxns.map((t) =>
    bank.has(t.id) ? { ...t, amount: bank.get(t.id) as number } : t,
  );
  return {
    ...s,
    invoices,
    deals,
    payroll,
    bankTxns,
    ...(billingPlans && { billingPlans }),
    ...(pendingPayouts && { pendingPayouts }),
  };
}

export const judgeAddDays = addDays;
