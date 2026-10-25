import type { Finding, Snapshot } from "@domino/contracts";
import { addDays, daysBetween } from "./dates";

/**
 * Field audit: deterministic checks over one ingested snapshot (and the version before it)
 * for duplicates, cross-version conflicts, unusual amounts and timing, and missing expected
 * items. Pure: the caller passes detectedAt; same input gives the same findings in the same
 * order. Finding ids are stable so a store can dedupe repeated detections across versions.
 */
export interface AuditInput {
  snapshot: Snapshot;
  /** The previous stored version, or null on the first ingest. */
  previous: Snapshot | null;
  /** ISO timestamp with offset, recorded on every finding. */
  detectedAt: string;
}

type Kind = Finding["kind"];
type Severity = Finding["severity"];
/** One check's result before ids and ordering: what the audit swarm's checkers return. */
export type AuditDraft = { kind: Kind; severity: Severity; summary: string; refs: string[] };
type Draft = AuditDraft;

/** A record reduced to what the checks compare: identity, money, date and who. */
export interface AuditRow {
  list: ListName;
  id: string;
  cents: number;
  date: string;
  who: string;
}
type Row = AuditRow;
export type ListName = "invoices" | "bills" | "bankTxns" | "cardTxns" | "payroll";

const LABEL: Record<ListName, string> = {
  invoices: "invoice",
  bills: "bill",
  bankTxns: "bank transaction",
  cardTxns: "card charge",
  payroll: "payroll run",
};

/** Ratios are compared on integers (a >= k * median) so no float money math happens. */
const UNUSUAL_RATIO = 3;
const VERY_UNUSUAL_RATIO = 10;
/** A newly arrived posted record dated this many days before the last ingest is late. */
const BACKDATE_DAYS = 14;

export function auditRows(s: Snapshot): Row[] {
  return [
    ...s.invoices.map((r) => ({
      list: "invoices" as const,
      id: r.id,
      cents: r.amount,
      date: r.issued,
      who: r.customerId,
    })),
    ...s.bills.map((r) => ({
      list: "bills" as const,
      id: r.id,
      cents: r.amount,
      date: r.due,
      who: r.vendor,
    })),
    ...s.bankTxns.map((r) => ({
      list: "bankTxns" as const,
      id: r.id,
      cents: r.amount,
      date: r.date,
      who: r.counterparty ?? r.description,
    })),
    ...s.cardTxns.map((r) => ({
      list: "cardTxns" as const,
      id: r.id,
      cents: r.amount,
      date: r.date,
      who: r.merchant,
    })),
    ...s.payroll.map((r) => ({
      list: "payroll" as const,
      id: r.id,
      cents: r.amount,
      date: r.date,
      who: "payroll",
    })),
  ];
}

const groupBy = <T>(items: T[], key: (item: T) => string) => {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    out.set(k, [...(out.get(k) ?? []), item]);
  }
  return out;
};

export const abs = (n: number) => (n < 0 ? -n : n);
/** Upper median of integers: always one of the inputs, never a fraction. */
export const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[values.length >> 1] ?? 0;
export const money = (cents: number) => {
  const a = abs(cents);
  return `${cents < 0 ? "-" : ""}$${(a - (a % 100)) / 100}.${String(a % 100).padStart(2, "0")}`;
};

export function duplicates(all: Row[]): Draft[] {
  const out: Draft[] = [];
  const groups = groupBy(all, (r) => `${r.list}|${r.who}|${r.cents}|${r.date}`);
  for (const group of groups.values()) {
    const ids = [...new Set(group.map((r) => r.id))];
    if (ids.length < 2) continue;
    const first = group[0] as Row;
    out.push({
      kind: "duplicate",
      severity: first.list === "cardTxns" ? "medium" : "high",
      summary: `${ids.length} ${LABEL[first.list]}s from ${first.who} for ${money(first.cents)} on ${first.date} look like the same entry recorded twice.`,
      refs: ids,
    });
  }
  return out;
}

/** Fields a source must never rewrite once a record exists (amount and date are original). */
export function conflicts(current: Row[], previous: Row[]): Draft[] {
  const out: Draft[] = [];
  const before = new Map(previous.map((r) => [`${r.list}|${r.id}`, r]));
  for (const r of current) {
    const old = before.get(`${r.list}|${r.id}`);
    if (!old) continue;
    const changed = [
      old.cents !== r.cents && `amount ${money(old.cents)} -> ${money(r.cents)}`,
      old.date !== r.date && `date ${old.date} -> ${r.date}`,
      old.who !== r.who && `party ${old.who} -> ${r.who}`,
    ].filter((x): x is string => typeof x === "string");
    if (changed.length === 0) continue;
    out.push({
      kind: "conflict",
      severity: "high",
      summary: `${LABEL[r.list]} ${r.id} changed since the last ingest (${changed.join(", ")}); the source disagrees with what we recorded.`,
      refs: [r.id],
    });
  }
  return out;
}

export function unusualAmounts(current: Row[], fresh: Set<string>): Draft[] {
  const out: Draft[] = [];
  const groups = groupBy(
    // Customer receipts vary by contract size, so only spending is compared.
    current.filter((r) => r.list !== "invoices" && !(r.list === "bankTxns" && r.cents > 0)),
    (r) => `${r.list}|${r.who}|${r.cents < 0 ? "-" : "+"}`,
  );
  for (const group of groups.values()) {
    for (const r of group) {
      if (!fresh.has(r.id)) continue;
      const others = group.filter((o) => o.id !== r.id).map((o) => abs(o.cents));
      if (others.length < 3) continue;
      const m = median(others);
      if (m === 0 || abs(r.cents) < UNUSUAL_RATIO * m) continue;
      out.push({
        kind: "unusual_amount",
        severity: abs(r.cents) >= VERY_UNUSUAL_RATIO * m ? "high" : "medium",
        summary: `${LABEL[r.list]} ${r.id} from ${r.who} is ${money(r.cents)}, far above its usual ${money(m)}.`,
        refs: [r.id],
      });
    }
  }
  return out;
}

export function unusualTiming(
  s: Snapshot,
  current: Row[],
  prev: Snapshot | null,
  fresh: Set<string>,
) {
  const out: Draft[] = [];
  for (const r of current) {
    if (!fresh.has(r.id) || (r.list !== "bankTxns" && r.list !== "cardTxns")) continue;
    if (r.date > s.asOf) {
      out.push({
        kind: "unusual_timing",
        severity: "high",
        summary: `${LABEL[r.list]} ${r.id} is posted on ${r.date}, after today (${s.asOf}).`,
        refs: [r.id],
      });
    } else if (prev && r.date < addDays(prev.asOf, -BACKDATE_DAYS)) {
      out.push({
        kind: "unusual_timing",
        severity: "medium",
        summary: `${LABEL[r.list]} ${r.id} arrived this week but is dated ${r.date}, ${daysBetween(r.date, prev.asOf)} days before the last ingest.`,
        refs: [r.id],
      });
    }
  }
  return out;
}

export function missingExpected(s: Snapshot): Draft[] {
  const out: Draft[] = [];
  // Payroll cadence: a gap well beyond the usual interval means a run is missing.
  const runs = [...s.payroll].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const gaps = runs.slice(1).map((r, i) => daysBetween((runs[i] as typeof r).date, r.date));
  if (gaps.length >= 2) {
    const usual = median(gaps);
    gaps.forEach((gap, i) => {
      if (usual === 0 || 2 * gap <= 3 * usual) return;
      const before = runs[i] as (typeof runs)[number];
      out.push({
        kind: "missing_expected",
        severity: "high",
        summary: `No payroll run near ${addDays(before.date, usual)}: runs are usually ${usual} days apart but the next one after ${before.date} is ${gap} days later.`,
        refs: [before.id],
      });
    });
  }
  for (const deal of s.deals) {
    if (deal.stage !== "won" || !deal.signed || deal.invoiceId !== null) continue;
    out.push({
      kind: "missing_expected",
      severity: "low",
      summary: `Deal ${deal.id} is won and signed but has no invoice, so its cash is not scheduled.`,
      refs: [deal.id],
    });
  }
  return out;
}

/** A newly ended plan this large a share of all recurring billing is escalated (basis points). */
const ENDED_BILLING_HIGH_BPS = 400;

/**
 * Expected billing that stops: a plan that gains an end date since the last version (a customer
 * gave notice) means its future invoices will be missing. A plan replaced by another plan for
 * the same customer (an upgrade) is not lost billing. Only plans worth at least 4% of all
 * recurring billing a year are reported (high): ordinary small churn is not an anomaly.
 * Compared on integers only.
 */
export function endedBilling(s: Snapshot, prev: Snapshot | null): Draft[] {
  if (!prev) return [];
  const plans = s.billingPlans ?? [];
  const before = new Map((prev.billingPlans ?? []).map((p) => [p.id, p]));
  const yearly = (p: (typeof plans)[number]) => (p.amount * 12) / p.everyMonths;
  const active = plans.filter((p) => p.endDate === undefined || p.endDate > s.asOf);
  const total = active.reduce((n, p) => n + yearly(p), 0);
  const names = new Map(s.customers.map((c) => [c.id, c.name]));
  const out: Draft[] = [];
  for (const p of plans) {
    const old = before.get(p.id);
    if (!old || p.endDate === undefined || p.endDate < prev.asOf) continue;
    if (old.endDate !== undefined && old.endDate <= p.endDate) continue;
    const replaced = plans.some(
      (q) =>
        q.id !== p.id &&
        q.customerId === p.customerId &&
        (q.endDate === undefined || q.endDate > p.endDate!),
    );
    if (replaced) continue;
    const cents = Math.round(yearly(p));
    if (total <= 0 || cents * 10_000 < ENDED_BILLING_HIGH_BPS * total) continue;
    out.push({
      kind: "missing_expected",
      severity: "high",
      summary: `Billing for ${names.get(p.customerId) ?? p.customerId} now ends on ${p.endDate}: invoices worth ${money(cents)} a year that were expected after that will not be issued.`,
      refs: [p.id, p.customerId],
    });
  }
  return out;
}

const SEVERITY: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/** Stable id from kind and refs; repeated detections of the same issue share it. */
function findingId(d: Draft, taken: Set<string>): string {
  const base = `${d.kind}:${d.refs.slice(0, 4).join(",")}`.slice(0, 120);
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}#${n}`;
  taken.add(id);
  return id;
}

/** Records new since the previous version (by list and id). */
export function freshIds(current: Row[], prior: Row[]): Set<string> {
  const seen = new Set(prior.map((r) => `${r.list}|${r.id}`));
  return new Set(current.filter((r) => !seen.has(`${r.list}|${r.id}`)).map((r) => r.id));
}

/** Clip, order by severity (stable) and give each draft its stable id. */
export function finalizeFindings(drafts: Draft[], detectedAt: string): Finding[] {
  const clipped = drafts.map((d) => ({
    ...d,
    refs: d.refs.slice(0, 64),
    summary: d.summary.slice(0, 500),
  }));
  const taken = new Set<string>();
  return clipped
    .map((d, i) => ({ d, i }))
    .sort((a, b) => SEVERITY[a.d.severity] - SEVERITY[b.d.severity] || a.i - b.i)
    .map(({ d }) => ({ id: findingId(d, taken), ...d, detectedAt }));
}

export function auditSnapshot({ snapshot, previous, detectedAt }: AuditInput): Finding[] {
  const current = auditRows(snapshot);
  const prior = previous ? auditRows(previous) : [];
  const fresh = freshIds(current, prior);
  return finalizeFindings(
    [
      ...duplicates(current),
      ...conflicts(current, prior),
      ...unusualAmounts(current, fresh),
      ...unusualTiming(snapshot, current, previous, fresh),
      ...missingExpected(snapshot),
      ...endedBilling(snapshot, previous),
    ],
    detectedAt,
  );
}
