import {
  BOUNDARY_INTEGER_MAX,
  type Change,
  ChangeSchema,
  type CompanyModel,
  type Constraint,
  ConstraintSchema,
  type Snapshot,
  canonicalJson,
} from "@domino/contracts";
import { type CashSchedule, cashSchedule } from "@domino/engine/src/forecast";
import { ConvexError } from "convex/values";
import { z } from "zod";

// TL1C/TL2 input checks for timeline/workspace. Interface: kb/features/timeline/TL2-TL5-interface.md.
// Mirrors the TL1 baseline checks (baselines.ts keeps its own private copy) and adds the
// scenario rules: observed history is immutable, and nothing is silently ignored because it
// falls outside the 13-week forecast.

export const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
const MAX_JSON_TEXT = 64 * 1024;
export const MAX_NOTE = 2_000;
export const MAX_LABEL = 200;
export const MAX_CONSTRAINTS = 32;
export const MAX_DEPTH = 20;
export const MAX_TOTAL_CHANGES = 64;
const MAX_DAYS = 3_660;
const MAX_DELAY_DAYS = 366;
const MAX_RUNWAY_MONTHS = 120;

export function reject(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const firstIssue = (e: z.ZodError) => {
  const i = e.issues[0];
  return i ? `${i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}` : "invalid";
};

/** Bounded JSON text -> schema parse that must equal its input (no stripped unknown fields). */
export function parseExactJson<T extends z.ZodTypeAny>(
  label: string,
  schema: T,
  text: string,
): z.output<T> {
  if (text.length > MAX_JSON_TEXT) reject("INVALID_INPUT", `${label} JSON is too large`);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    reject("INVALID_INPUT", `${label} is not valid JSON`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) reject("INVALID_INPUT", `${label}: ${firstIssue(parsed.error)}`);
  if (canonicalJson(raw) !== canonicalJson(parsed.data))
    reject("INVALID_INPUT", `${label} has fields that are not part of the contract`);
  return parsed.data;
}

export function checkRequestId(requestId: string) {
  if (!REQUEST_ID.test(requestId))
    reject("INVALID_REQUEST", "requestId must be 8-128 letters, digits, '.', '_' or '-'");
}

/** Trimmed text of 1..max characters, or a rejection naming the field. */
export function requiredText(label: string, text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > max)
    reject("INVALID_INPUT", `${label} must be 1-${max} characters`);
  return trimmed;
}

const isCents = (n: number) => Number.isSafeInteger(n) && Math.abs(n) <= BOUNDARY_INTEGER_MAX;
const between = (n: number, lo: number, hi: number) => Number.isFinite(n) && n >= lo && n <= hi;
const blankOrLong = (s: string, max = MAX_LABEL) => s.trim().length === 0 || s.length > max;

const DAY_MS = 86_400_000;
const dateMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
/** Real calendar date in YYYY-MM-DD form (the contract's ISODate is shape-only). */
export const isCalendarDate = (date: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(dateMs(date)) &&
  new Date(dateMs(date)).toISOString().slice(0, 10) === date;
export const addDays = (date: string, days: number) =>
  new Date(dateMs(date) + days * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) =>
  Math.round((dateMs(to) - dateMs(from)) / DAY_MS);

export const ConstraintsSchema = z.array(ConstraintSchema);
export const ChangesSchema = z.array(ChangeSchema);

/** Timeline-local rules: the three supported kinds, real targets and finite units. */
export function checkConstraints(constraints: Constraint[], snapshot: Snapshot) {
  const bad = (message: string): never => reject("INVALID_INPUT", `Rules: ${message}`);
  if (constraints.length > MAX_CONSTRAINTS) bad(`at most ${MAX_CONSTRAINTS} rules`);
  const ids = new Set<string>();
  for (const c of constraints) {
    if (ids.has(c.id)) bad(`rule id ${c.id} is repeated`);
    ids.add(c.id);
    if (blankOrLong(c.label)) bad(`rule ${c.id} needs a short label`);
    if (c.kind === "min_cash" && !isCents(c.limit)) bad(`rule ${c.id} limit must be integer cents`);
    if (c.kind === "min_runway_months" && !between(c.limit, 0, MAX_RUNWAY_MONTHS))
      bad(`rule ${c.id} runway months must be 0 to ${MAX_RUNWAY_MONTHS}`);
    if (c.kind === "pay_by_date") {
      if (c.billId === undefined) bad(`rule ${c.id} must name a bill`);
      const matches = snapshot.bills.filter((b) => b.id === c.billId).length;
      if (matches !== 1) bad(`rule ${c.id} bill ${c.billId} must exist exactly once in the seed`);
      if (c.limit > MAX_DAYS) bad(`rule ${c.id} allows too many late days`);
    }
  }
}

/** First and last forecast days: the day after asOf, and the Sunday closing week 13. */
export type Horizon = { asOf: string; firstWeek: string; end: string };

/**
 * Proposed future changes. Observed history is immutable, so a change dated on or before asOf
 * or aimed at an already-settled record is rejected with the reason. A change that would only
 * act after the last forecast day is rejected too: the engine would drop it without a trace.
 */
export function checkChanges(changes: Change[], snapshot: Snapshot, horizon: Horizon) {
  const history = (message: string): never =>
    reject(
      "HISTORICAL_CHANGE",
      `${message}. Observed history up to ${horizon.asOf} is fixed; simulate only future events`,
    );
  const outside = (message: string): never =>
    reject(
      "OUTSIDE_HORIZON",
      `${message}, after the forecast ends on ${horizon.end}; it would have no effect`,
    );
  const bad = (message: string): never => reject("INVALID_INPUT", `Changes: ${message}`);
  const futureDate = (what: string, date: string) => {
    if (!isCalendarDate(date)) bad(`${what} date ${date} is not a real calendar date`);
    if (date <= horizon.asOf) history(`${what} is dated ${date}`);
    if (date > horizon.end) outside(`${what} is dated ${date}`);
  };
  const openInvoice = (id: string) => {
    const matches = snapshot.invoices.filter((i) => i.id === id);
    const invoice = matches[0];
    if (matches.length !== 1 || !invoice)
      return bad(`invoice ${id} must exist exactly once in the seed`);
    if (invoice.paid !== undefined) history(`Invoice ${id} was already paid on ${invoice.paid}`);
    if (invoice.writtenOff !== undefined)
      history(`Invoice ${id} was written off on ${invoice.writtenOff}`);
    return invoice;
  };
  const labels = new Set<string>();
  const label = (what: string, text: string) => {
    if (blankOrLong(text)) bad(`${what} needs a short label`);
    // The engine keys added cash by label, so a repeat would merge two events.
    if (labels.has(text)) bad(`label "${text}" is used by more than one change`);
    labels.add(text);
  };
  for (const change of changes) {
    switch (change.kind) {
      case "add_cash":
      case "remove_cash": {
        label(change.kind, change.label);
        if (!isCents(change.amount) || change.amount <= 0)
          bad(`"${change.label}" amount must be positive integer cents`);
        futureDate(`"${change.label}"`, change.date);
        break;
      }
      case "delay_invoice": {
        openInvoice(change.invoiceId);
        if (change.days === 0 || Math.abs(change.days) > MAX_DELAY_DAYS)
          bad(`delay for invoice ${change.invoiceId} must be 1-${MAX_DELAY_DAYS} days either way`);
        break;
      }
      case "lose_invoice":
        openInvoice(change.invoiceId);
        break;
      case "discount_early_pay": {
        openInvoice(change.invoiceId);
        if (!between(change.percent, 0, 100) || change.percent === 0)
          bad(`discount for invoice ${change.invoiceId} must be above 0 and at most 100 percent`);
        futureDate(`Early payment of invoice ${change.invoiceId}`, change.payOn);
        break;
      }
      case "delay_bill": {
        const matches = snapshot.bills.filter((b) => b.id === change.billId);
        const bill = matches[0];
        if (matches.length !== 1 || !bill)
          return bad(`bill ${change.billId} must exist exactly once in the seed`);
        if (bill.paid !== undefined) history(`Bill ${bill.id} was already paid on ${bill.paid}`);
        if (bill.critical) bad(`bill ${bill.id} is marked critical and cannot be delayed`);
        if (change.days === 0 || Math.abs(change.days) > MAX_DELAY_DAYS)
          bad(`delay for bill ${bill.id} must be 1-${MAX_DELAY_DAYS} days either way`);
        break;
      }
      case "churn": {
        if (!snapshot.customers.some((c) => c.id === change.customerId))
          bad(`customer ${change.customerId} is not in the seed`);
        futureDate(`Loss of customer ${change.customerId}`, change.fromDate);
        break;
      }
      case "shift_hire": {
        label("shift_hire", change.label);
        if (!isCents(change.monthlyCost) || change.monthlyCost <= 0)
          bad(`"${change.label}" monthly cost must be positive integer cents`);
        futureDate(`"${change.label}" start`, change.fromDate);
        if (!isCalendarDate(change.toDate) || change.toDate <= change.fromDate)
          bad(`"${change.label}" must end after it starts`);
        // toDate is exclusive. The engine walks every day up to it, so bound it here.
        if (change.toDate > addDays(horizon.end, 1))
          reject(
            "OUTSIDE_HORIZON",
            `"${change.label}" ends ${change.toDate}; end it on or before ${addDays(horizon.end, 1)}, the day after the forecast ends on ${horizon.end}`,
          );
        break;
      }
    }
  }
}

type Item = CashSchedule["items"][number];
const itemOf = (s: CashSchedule, kind: Item["kind"], id: string) =>
  s.items.find((i) => i.kind === kind && i.id === id);

/**
 * Effective-date checks on the engine's own cash schedule (read-only), replaying the complete
 * ordered changes with the frozen model, so relative changes are judged where the cash really
 * lands: never on or before asOf, never with no remaining cash, never entirely after the forecast.
 * Moving in-forecast cash past the end is allowed: removing it from the 13 weeks is the effect.
 * Run after checkChanges, which bounds every loop the schedule performs.
 */
export function checkEffects(
  changes: Change[],
  snapshot: Snapshot,
  model: CompanyModel,
  horizon: Horizon,
) {
  const schedule = (n: number) => {
    try {
      return cashSchedule(snapshot, model, changes.slice(0, n));
    } catch (e) {
      const detail = e instanceof Error ? `: ${e.message}` : "";
      return reject(
        "UNSUPPORTED_INPUT",
        `The engine could not apply the changes${detail}`.slice(0, 500),
      );
    }
  };
  const noCash = (what: string): never =>
    reject(
      "NO_EFFECT",
      `${what} has no remaining expected cash in this plan (already settled, lost or removed by an earlier change)`,
    );
  const unchanged = (what: string): never =>
    reject("NO_EFFECT", `${what} does not change any expected cash date or amount in this plan`);
  const afterEnd = (message: string): never =>
    reject(
      "OUTSIDE_HORIZON",
      `${message}, after the forecast ends on ${horizon.end}; it would have no effect`,
    );
  const history = (message: string): never =>
    reject(
      "HISTORICAL_CHANGE",
      `${message}, on or before ${horizon.asOf}. Observed history is fixed; simulate only future events`,
    );
  let before = schedule(0);
  changes.forEach((change, i) => {
    const after = schedule(i + 1);
    const moved = (kind: Item["kind"], id: string, what: string) => {
      const b = itemOf(before, kind, id);
      if (!b || b.amount === 0) return noCash(what);
      const a = itemOf(after, kind, id);
      if (!a) return noCash(what);
      if (a.date <= horizon.asOf) history(`${what} would then be paid on ${a.date}`);
      if (a.date === b.date && a.amount === b.amount) unchanged(what);
      if (b.date > horizon.end && a.date > horizon.end)
        afterEnd(`${what} moves from ${b.date} to ${a.date}, both`);
    };
    switch (change.kind) {
      case "delay_invoice":
        moved("invoice", change.invoiceId, `Invoice ${change.invoiceId}`);
        break;
      case "delay_bill":
        moved("bill", change.billId, `Bill ${change.billId}`);
        break;
      case "discount_early_pay":
        moved("invoice", change.invoiceId, `Invoice ${change.invoiceId}`);
        break;
      case "lose_invoice": {
        const b = itemOf(before, "invoice", change.invoiceId);
        if (!b || b.amount === 0) noCash(`Invoice ${change.invoiceId}`);
        else if (b.date > horizon.end)
          afterEnd(`Invoice ${change.invoiceId} is expected on ${b.date}`);
        break;
      }
      case "churn": {
        const remaining = new Set(after.items.map((a) => `${a.kind}:${a.id}`));
        const removed = before.items.filter(
          (b) => b.amount !== 0 && !remaining.has(`${b.kind}:${b.id}`),
        );
        if (removed.length === 0) noCash(`Customer ${change.customerId} from ${change.fromDate}`);
        if (removed.every((b) => b.date > horizon.end))
          afterEnd(
            `All of customer ${change.customerId}'s expected cash from ${change.fromDate} is`,
          );
        break;
      }
      case "shift_hire":
        if (after.items.length === before.items.length) unchanged(`Hire ${change.label}`);
        break;
      default:
        break;
    }
    before = after;
  });
}

/** Upper bound on any 13-week forecast: 98 days span at most 5 calendar months of hire cost. */
const HORIZON_DAYS = 98;
const HIRE_MONTHS = 5n;

/**
 * Conservative exact bound, in BigInt, on every cash sum the engine and the comparison can
 * form (see baselines.ts checkMoneyBound). Changes add their own magnitudes; differences of two
 * forecasts are bounded by twice the total.
 */
export function checkMoneyBound(
  snapshot: Snapshot,
  model: CompanyModel,
  constraints: Constraint[],
  changes: Change[],
) {
  const abs = (n: number) => (n < 0 ? -BigInt(n) : BigInt(n));
  let total = abs(snapshot.cashOnHand) + abs(snapshot.restrictedCash);
  const add = (items: { amount: number }[]) => {
    for (const item of items) total += abs(item.amount);
  };
  add(snapshot.invoices);
  add(snapshot.bills);
  add(snapshot.payroll);
  add(snapshot.deals);
  add(snapshot.bankTxns);
  add(snapshot.cardTxns);
  add(snapshot.pendingPayouts ?? []);
  // A plan issues at most monthly: at most 4 occurrences in the 98-day horizon; 5 is safe.
  for (const p of snapshot.billingPlans ?? []) total += abs(p.amount) * 5n;
  for (const s of model.recurringSpend)
    total += abs(s.amount) * BigInt(Math.floor(HORIZON_DAYS / s.everyDays) + 1);
  for (const c of constraints) if (c.kind === "min_cash") total += abs(c.limit);
  for (const c of changes) {
    if (c.kind === "add_cash" || c.kind === "remove_cash") total += abs(c.amount);
    if (c.kind === "shift_hire") total += abs(c.monthlyCost) * HIRE_MONTHS;
  }
  if (2n * total > BigInt(Number.MAX_SAFE_INTEGER))
    reject(
      "UNSAFE_MONEY",
      "Seed, model, rule and change amounts together are too large to calculate exactly in cents",
    );
}

/**
 * Convex rejects documents over 1 MiB; measure the whole row in canonical JSON bytes.
 */
const MAX_ROW_BYTES = 900_000;
export function checkRowSize(row: Record<string, unknown>) {
  if (new TextEncoder().encode(canonicalJson(row)).length > MAX_ROW_BYTES)
    reject("TOO_LARGE", "This saved run is too large; use fewer changes or rules");
}
