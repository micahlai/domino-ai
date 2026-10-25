import {
  type Change,
  ChangeSchema,
  type Constraint,
  ConstraintSchema,
  type Snapshot,
  type WeeklySeedV1,
} from "@domino/contracts";
import {
  billName,
  customerName,
  invoiceName,
  shortDate,
} from "../../../convex/timeline/recordNames";

// Form text to wire objects. Parsing only: amounts are read digit by digit into integer cents,
// never through floating point, and no money is added, scaled or compared here.

const DOLLARS = /^\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

/** "$3,000,000.5" -> 300000050 cents. Positive amounts only; anything unclear is rejected. */
export function parseDollars(text: string): number | undefined {
  const m = DOLLARS.exec(text.trim());
  if (!m?.[1]) return undefined;
  const whole = m[1].replaceAll(",", "");
  const cents = BigInt(whole) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
  if (cents <= 0n || cents > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return Number(cents);
}

/** Cents back to editable dollar text ("3000000.50"), exact via BigInt. */
export function dollarsText(cents: number): string {
  if (!Number.isSafeInteger(cents)) return "";
  const v = BigInt(cents);
  const abs = v < 0n ? -v : v;
  const frac = abs % 100n;
  return `${v < 0n ? "-" : ""}${abs / 100n}${frac ? `.${String(frac).padStart(2, "0")}` : ""}`;
}

function wholeNumber(text: string, max: number): number | undefined {
  if (!/^\d{1,6}$/.test(text.trim())) return undefined;
  const n = Number(text.trim());
  return n <= max ? n : undefined;
}

/** Months may have one decimal place ("4.5"); not money. */
function months(text: string): number | undefined {
  if (!/^\d{1,3}(\.\d)?$/.test(text.trim())) return undefined;
  const n = Number(text.trim());
  return n > 0 ? n : undefined;
}

// ---------- Rules ----------

export type RuleKind = Constraint["kind"];
export type RuleDraft = {
  /** Existing constraint id, kept so the rule's history stays traceable. */
  id: string | null;
  kind: RuleKind;
  label: string;
  /** Dollars for minimum cash, months for runway, allowed late days for a bill. */
  limit: string;
  billId: string;
  /** Original evidence and consequence are preserved through an edit. */
  base: Constraint | null;
};

export const RULE_KINDS: { kind: RuleKind; title: string; unit: string }[] = [
  { kind: "min_cash", title: "Keep a minimum of usable cash", unit: "dollars" },
  { kind: "min_runway_months", title: "Keep enough months of cash", unit: "months" },
  { kind: "pay_by_date", title: "Pay a bill on time", unit: "days late allowed" },
];

export function ruleDraftFrom(c: Constraint): RuleDraft {
  return {
    id: c.id,
    kind: c.kind,
    label: c.label,
    limit: c.kind === "min_cash" ? dollarsText(c.limit) : String(c.limit),
    billId: c.billId ?? "",
    base: c,
  };
}

export function emptyRule(kind: RuleKind): RuleDraft {
  const title = RULE_KINDS.find((k) => k.kind === kind)?.title ?? "Cash rule";
  return { id: null, kind, label: title, limit: "", billId: "", base: null };
}

/** A fresh id that does not collide with any rule in the list. */
function freshId(kind: RuleKind, taken: Set<string>): string {
  for (let i = 1; ; i++) {
    const id = `rule_${kind}_${i}`;
    if (!taken.has(id)) return id;
  }
}

export type Built<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export function buildConstraints(drafts: RuleDraft[]): Built<Constraint[]> {
  const errors: string[] = [];
  const taken = new Set(drafts.flatMap((d) => (d.id ? [d.id] : [])));
  const out: Constraint[] = [];
  drafts.forEach((d, i) => {
    const n = i + 1;
    const label = d.label.trim();
    if (!label) errors.push(`Rule ${n}: give it a name.`);
    let limit: number | undefined;
    if (d.kind === "min_cash") limit = parseDollars(d.limit);
    else if (d.kind === "min_runway_months") limit = months(d.limit);
    else limit = wholeNumber(d.limit, 3650);
    if (limit === undefined)
      errors.push(
        d.kind === "min_cash"
          ? `Rule ${n}: enter a dollar amount, like 3,000,000.`
          : d.kind === "min_runway_months"
            ? `Rule ${n}: enter months, like 6 or 4.5.`
            : `Rule ${n}: enter whole days late allowed, 0 for on the due date.`,
      );
    if (d.kind === "pay_by_date" && !d.billId) errors.push(`Rule ${n}: choose the bill.`);
    if (!label || limit === undefined || (d.kind === "pay_by_date" && !d.billId)) return;
    const id = d.id ?? freshId(d.kind, taken);
    taken.add(id);
    const candidate = {
      id,
      label,
      kind: d.kind,
      limit,
      evidence: d.base?.evidence ?? {
        source: "document" as const,
        ref: "timeline:workspace/person-entered-rule",
        note: "Entered and confirmed by a person in the Timeline workspace.",
      },
      ...(d.kind === "pay_by_date" ? { billId: d.billId } : {}),
      ...(d.base?.consequence ? { consequence: d.base.consequence } : {}),
    };
    const parsed = ConstraintSchema.safeParse(candidate);
    if (parsed.success) out.push(parsed.data);
    else errors.push(`Rule ${n} is not a supported rule.`);
  });
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

// ---------- Events ----------

export type EventKind =
  | "delay_invoice"
  | "lose_invoice"
  | "add_cash"
  | "remove_cash"
  | "delay_bill";
export type EventDraft = {
  kind: EventKind;
  invoiceId: string;
  billId: string;
  days: string;
  date: string;
  amount: string;
  label: string;
};

export const EVENT_KINDS: { kind: EventKind; title: string }[] = [
  { kind: "delay_invoice", title: "A customer pays late" },
  { kind: "lose_invoice", title: "A customer never pays an invoice" },
  { kind: "add_cash", title: "One-off money in" },
  { kind: "remove_cash", title: "One-off money out" },
  { kind: "delay_bill", title: "We pay a bill later" },
];

export function emptyEvent(kind: EventKind = "delay_invoice"): EventDraft {
  return { kind, invoiceId: "", billId: "", days: "", date: "", amount: "", label: "" };
}

/**
 * Explicit future event. Dates before the first forecast week are history, which is never
 * edited; the service still decides the end of the horizon and explains any rejection.
 */
export function buildChange(d: EventDraft, firstWeek: string): Built<Change> {
  const errors: string[] = [];
  let candidate: unknown;
  if (d.kind === "delay_invoice" || d.kind === "lose_invoice") {
    if (!d.invoiceId) errors.push("Choose the invoice.");
    const days = d.kind === "delay_invoice" ? wholeNumber(d.days, 365) : 0;
    if (d.kind === "delay_invoice" && (days === undefined || days === 0))
      errors.push("Enter how many days late, from 1 to 365.");
    candidate =
      d.kind === "delay_invoice"
        ? { kind: d.kind, invoiceId: d.invoiceId, days }
        : { kind: d.kind, invoiceId: d.invoiceId };
  } else if (d.kind === "delay_bill") {
    if (!d.billId) errors.push("Choose the bill.");
    const days = wholeNumber(d.days, 365);
    if (days === undefined || days === 0) errors.push("Enter how many days later, from 1 to 365.");
    candidate = { kind: d.kind, billId: d.billId, days };
  } else {
    const amount = parseDollars(d.amount);
    if (amount === undefined) errors.push("Enter a dollar amount, like 250,000.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) errors.push("Choose the date.");
    else if (d.date < firstWeek)
      errors.push(
        "That date is in recorded history, which cannot be changed. Choose a date in the forecast.",
      );
    if (!d.label.trim()) errors.push("Say what the money is for.");
    candidate = { kind: d.kind, date: d.date, amount, label: d.label.trim() };
  }
  if (errors.length) return { ok: false, errors };
  const parsed = ChangeSchema.safeParse(candidate);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, errors: ["Not valid."] };
}

export type Option = { id: string; label: string };

/** Open invoices and unpaid bills from the saved seed, the only things an event can name. */
export function eventOptions(seed: WeeklySeedV1): { invoices: Option[]; bills: Option[] } {
  const names = new Map(seed.snapshot.customers.map((c) => [c.id, c.name]));
  return {
    invoices: seed.snapshot.invoices
      .filter((i) => i.paid === undefined && i.writtenOff === undefined)
      .map((i) => ({
        id: i.id,
        label: `${names.get(i.customerId) ?? i.customerId}, due ${i.due} (${i.id})`,
      })),
    bills: seed.snapshot.bills
      .filter((b) => b.paid === undefined)
      .map((b) => ({ id: b.id, label: `${b.vendor}, due ${b.due} (${b.id})` })),
  };
}

/** The event a selected scheduled item suggests, so the form starts from the person's choice. */
export function eventFromItem(
  item: WeeklySeedV1["scheduledItems"][number],
  opts: ReturnType<typeof eventOptions>,
): EventDraft | undefined {
  if (item.kind === "receivable" && opts.invoices.some((o) => o.id === item.sourceRef))
    return { ...emptyEvent("delay_invoice"), invoiceId: item.sourceRef };
  if (item.kind === "payable" && opts.bills.some((o) => o.id === item.sourceRef))
    return { ...emptyEvent("delay_bill"), billId: item.sourceRef };
  return undefined;
}

/** Plain sentence for a saved change. Amounts formatted by the caller's exact formatter. */
export function changeText(
  c: Change,
  money: (cents: number) => string,
  snapshot?: Snapshot | null,
): string {
  const inv = (id: string) => (snapshot ? `The ${invoiceName(snapshot, id)}` : `Invoice ${id}`);
  const bill = (id: string) => (snapshot ? `The ${billName(snapshot, id)}` : `Bill ${id}`);
  const day = (iso: string) => (snapshot ? shortDate(iso) : iso);
  switch (c.kind) {
    case "delay_invoice":
      return `${inv(c.invoiceId)} is paid ${c.days} days late`;
    case "lose_invoice":
      return `${inv(c.invoiceId)} is never paid`;
    case "churn":
      return `${snapshot ? customerName(snapshot, c.customerId) : `Customer ${c.customerId}`} leaves from ${day(c.fromDate)}`;
    case "add_cash":
      return `${money(c.amount)} comes in on ${day(c.date)}: ${c.label}`;
    case "remove_cash":
      return `${money(c.amount)} goes out on ${day(c.date)}: ${c.label}`;
    case "delay_bill":
      return `${bill(c.billId)} is paid ${c.days} days later`;
    case "discount_early_pay":
      return `${inv(c.invoiceId)} is paid on ${day(c.payOn)} for a ${c.percent}% discount`;
    case "shift_hire":
      return `${c.label}: hire moves from ${day(c.fromDate)} to ${day(c.toDate)}`;
    case "delay_customer":
      return `Later payments from ${snapshot ? customerName(snapshot, c.customerId) : `Customer ${c.customerId}`} slip ${c.days} days from ${day(c.fromDate)} (${c.basis})`;
    case "recurring_cash":
      return `${money(c.amount)} ${c.direction === "in" ? "comes in" : "goes out"} every ${c.everyDays} days from ${day(c.fromDate)}: ${c.label}`;
    case "scale_recurring":
      return `${c.label}: recurring ${c.flows === "billing" ? "billing" : "bills"} ${c.percent < 0 ? "down" : "up"} ${Math.abs(c.percent)}% from ${day(c.fromDate)}`;
  }
}
