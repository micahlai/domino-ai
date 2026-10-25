import type { Finding, Snapshot } from "@domino/contracts";
import {
  type AuditDraft,
  type AuditInput,
  auditRows,
  conflicts,
  duplicates,
  endedBilling,
  finalizeFindings,
  freshIds,
  missingExpected,
  money,
  unusualAmounts,
  unusualTiming,
} from "./audit";
import { daysBetween } from "./dates";

/**
 * The audit swarm's checks. Each checker is one independent, pure check over the same ingested
 * snapshot (and the version before it), so the caller can run them in parallel and merge.
 * mergeAuditFindings orders results by checker (never by completion order), drops a draft that
 * an earlier checker already reported (same kind and refs), then applies the same severity order
 * and stable ids as auditSnapshot. With no tie-out failures and no overdue customers the merged
 * findings equal auditSnapshot's exactly.
 */

/** Canonical checker order. Merging always follows it. */
export const AUDIT_CHECKERS = [
  "duplicates",
  "crossToolTieOut",
  "amounts",
  "timing",
  "overdueCustomers",
  "missingExpected",
  "billingEnds",
] as const;
export type AuditCheckerId = (typeof AUDIT_CHECKERS)[number];

export const AUDIT_CHECKER_INFO: Record<AuditCheckerId, { label: string; task: string }> = {
  duplicates: { label: "Duplicates check", task: "the same entry recorded twice" },
  crossToolTieOut: {
    label: "Tie-out check",
    task: "tools that disagree with the bank, and records a source rewrote",
  },
  amounts: { label: "Amounts check", task: "spending far above its usual amount" },
  timing: { label: "Timing check", task: "postings dated in the future or arriving very late" },
  overdueCustomers: {
    label: "Overdue customers check",
    task: "customers whose invoices are well past due",
  },
  missingExpected: {
    label: "Missing items check",
    task: "payroll runs and invoices that should exist but do not",
  },
  billingEnds: { label: "Billing ends check", task: "large recurring billing that stops" },
};

/** One failed cross-tool check from ingestion (connectors/pullAll tieOut). */
export type TieOutFailure = { name: string; ref: string; detail: string };

export interface SwarmAuditInput extends AuditInput {
  /** Failed cross-tool checks of this ingest; [] or missing when every check agreed. */
  tieOut?: TieOutFailure[];
}

/** An invoice this many days past due, unpaid and with no agreed payment date, is overdue. */
export const OVERDUE_DAYS = 30;
/** A customer whose oldest overdue invoice is this late is escalated. */
const OVERDUE_HIGH_DAYS = 60;

/** "12300 vs 12000 cents" -> "$123.00 vs $120.00"; other detail text as is. */
function tieOutDetail(detail: string): string {
  const m = /^(-?\d+) vs (-?\d+) cents$/.exec(detail.trim());
  return m ? `${money(Number(m[1]))} vs ${money(Number(m[2]))}` : detail;
}

export function crossToolTieOut(failures: TieOutFailure[]): AuditDraft[] {
  const seen = new Set<string>();
  const out: AuditDraft[] = [];
  for (const f of failures) {
    const key = `${f.name}|${f.ref}`;
    if (seen.has(key) || !f.ref) continue;
    seen.add(key);
    const missing = !/\bvs\b/.test(f.detail);
    out.push({
      kind: "conflict",
      severity: missing ? "medium" : "high",
      summary: `${f.name} does not tie out for ${f.ref}: ${tieOutDetail(f.detail)}.`,
      refs: [f.ref],
    });
  }
  return out;
}

/**
 * Customers with invoices more than OVERDUE_DAYS past due, one draft per customer. Refs start
 * with the customer and then its overdue invoices oldest first, so the finding id stays the same
 * while more of its invoices fall overdue.
 */
export function overdueCustomers(s: Snapshot): AuditDraft[] {
  const late = s.invoices.filter(
    (i) =>
      i.paid === undefined &&
      i.writtenOff === undefined &&
      !(i.collection && i.collection.payOn >= s.asOf) &&
      i.due < s.asOf &&
      daysBetween(i.due, s.asOf) > OVERDUE_DAYS,
  );
  const byCustomer = new Map<string, typeof late>();
  for (const i of late) byCustomer.set(i.customerId, [...(byCustomer.get(i.customerId) ?? []), i]);
  const names = new Map(s.customers.map((c) => [c.id, c.name]));
  const out: AuditDraft[] = [];
  for (const id of [...byCustomer.keys()].sort()) {
    const invoices = [...(byCustomer.get(id) ?? [])].sort((a, b) =>
      a.due === b.due ? (a.id < b.id ? -1 : 1) : a.due < b.due ? -1 : 1,
    );
    const oldest = invoices[0];
    if (!oldest) continue;
    const days = daysBetween(oldest.due, s.asOf);
    const total = invoices.reduce((n, i) => n + i.amount, 0);
    const n = invoices.length;
    out.push({
      kind: "unusual_timing",
      severity: days >= OVERDUE_HIGH_DAYS ? "high" : "medium",
      summary: `${names.get(id) ?? id} has ${n} invoice${n === 1 ? "" : "s"} more than ${OVERDUE_DAYS} days past due (${money(total)}); the oldest, ${oldest.id}, was due ${oldest.due}, ${days} days ago.`,
      refs: [id, ...invoices.map((i) => i.id)],
    });
  }
  return out;
}

/** One checker's drafts. Pure: same input, same drafts in the same order. */
export function runAuditCheck(checker: AuditCheckerId, input: SwarmAuditInput): AuditDraft[] {
  const { snapshot, previous } = input;
  const current = auditRows(snapshot);
  const prior = previous ? auditRows(previous) : [];
  switch (checker) {
    case "duplicates":
      return duplicates(current);
    case "crossToolTieOut":
      return [...conflicts(current, prior), ...crossToolTieOut(input.tieOut ?? [])];
    case "amounts":
      return unusualAmounts(current, freshIds(current, prior));
    case "timing":
      return unusualTiming(snapshot, current, previous, freshIds(current, prior));
    case "overdueCustomers":
      return overdueCustomers(snapshot);
    case "missingExpected":
      return missingExpected(snapshot);
    case "billingEnds":
      return endedBilling(snapshot, previous);
  }
}

export type CheckerResult = { checker: AuditCheckerId; drafts: AuditDraft[] };

const draftKey = (d: AuditDraft) => `${d.kind}|${[...d.refs].sort().join(",")}`;

/**
 * Merge checker results into findings. Results may arrive in any order and a checker may be
 * missing (it failed): order follows AUDIT_CHECKERS. A draft another checker already reported
 * (same kind and refs) is dropped; repeats inside one checker stay, as in auditSnapshot.
 */
export function mergeAuditFindings(
  results: CheckerResult[],
  detectedAt: string,
): { findings: Finding[]; dropped: number } {
  const ordered = [...results].sort(
    (a, b) => AUDIT_CHECKERS.indexOf(a.checker) - AUDIT_CHECKERS.indexOf(b.checker),
  );
  const owner = new Map<string, AuditCheckerId>();
  const drafts: AuditDraft[] = [];
  let dropped = 0;
  for (const r of ordered) {
    for (const d of r.drafts) {
      const key = draftKey(d);
      const first = owner.get(key);
      if (first !== undefined && first !== r.checker) {
        dropped++;
        continue;
      }
      owner.set(key, r.checker);
      drafts.push(d);
    }
  }
  return { findings: finalizeFindings(drafts, detectedAt), dropped };
}
