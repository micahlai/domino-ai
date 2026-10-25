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
type Draft = { kind: Kind; severity: Severity; summary: string; refs: string[] };

/** A record reduced to what the checks compare: identity, money, date and who. */
interface Row {
  list: ListName;
  id: string;
  cents: number;
  date: string;
  who: string;
}
type ListName = "invoices" | "bills" | "bankTxns" | "cardTxns" | "payroll";

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

function rows(s: Snapshot): Row[] {
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

const abs = (n: number) => (n < 0 ? -n : n);
/** Upper median of integers: always one of the inputs, never a fraction. */
const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1] ?? 0;
const money = (cents: number) => {
  const a = abs(cents);
  return `${cents < 0 ? "-" : ""}$${(a - (a % 100)) / 100}.${String(a % 100).padStart(2, "0")}`;
};

function duplicates(all: Row[]): Draft[] {
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
function conflicts(current: Row[], previous: Row[]): Draft[] {
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

function unusualAmounts(current: Row[], fresh: Set<string>): Draft[] {
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

function unusualTiming(s: Snapshot, current: Row[], prev: Snapshot | null, fresh: Set<string>) {
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

function missingExpected(s: Snapshot): Draft[] {
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

const SEVERITY: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/** Stable id from kind and refs; repeated detections of the same issue share it. */
function findingId(d: Draft, taken: Set<string>): string {
  const base = `${d.kind}:${d.refs.slice(0, 4).join(",")}`.slice(0, 120);
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}#${n}`;
  taken.add(id);
  return id;
}

export function auditSnapshot({ snapshot, previous, detectedAt }: AuditInput): Finding[] {
  const current = rows(snapshot);
  const prior = previous ? rows(previous) : [];
  const seen = new Set(prior.map((r) => `${r.list}|${r.id}`));
  const fresh = new Set(current.filter((r) => !seen.has(`${r.list}|${r.id}`)).map((r) => r.id));
  const drafts = [
    ...duplicates(current),
    ...conflicts(current, prior),
    ...unusualAmounts(current, fresh),
    ...unusualTiming(snapshot, current, previous, fresh),
    ...missingExpected(snapshot),
  ].map((d) => ({ ...d, refs: d.refs.slice(0, 64), summary: d.summary.slice(0, 500) }));
  const taken = new Set<string>();
  return drafts
    .map((d, i) => ({ d, i }))
    .sort((a, b) => SEVERITY[a.d.severity] - SEVERITY[b.d.severity] || a.i - b.i)
    .map(({ d }) => ({ id: findingId(d, taken), ...d, detectedAt }));
}
