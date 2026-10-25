import {
  type BankTxn,
  type Bill,
  type Invoice,
  type Snapshot,
  firstForecastWeek,
} from "@domino/contracts";
import { z } from "zod";
import type { Overlay } from "../fieldFeed";
import { judgeAddDays as addDays, scaleCents } from "./judgeOverlay";

/**
 * Judge sandbox rules (pure, shared by convex/fieldJudge.ts and the /judge page). A judge picks
 * a scenario or uploads rows; these functions validate the input (Zod, integer cents, weeks
 * 1-13) and turn it into planted source entries on the mock feed overlay. Nothing here reads
 * the simulator's hidden schedule: only the snapshot the mock vendor APIs serve.
 */

export const JUDGE_LIMITS = {
  /** Active (not archived) judge companies at once, across every judge. */
  activeCompanies: 20,
  /** Scenario and CSV submits per company per minute. */
  submitsPerMinute: 5,
  /** Rows per CSV upload. */
  csvRows: 50,
  /** Largest single amount a judge can enter: $10M. */
  maxCents: 1_000_000_000,
} as const;

const customerId = z.string().trim().min(1, "Pick a customer").max(80);
const wholeCents = () =>
  z.number({ invalid_type_error: "Enter an amount" }).int("Amounts are whole cents");

export const ScenarioSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("late_payment"),
      customerId,
      days: z
        .number({ invalid_type_error: "Enter a number of days" })
        .int("Days must be a whole number")
        .min(1, "At least 1 day late")
        .max(120, "At most 120 days late"),
    })
    .strict(),
  z.object({ kind: z.literal("customer_leaves"), customerId }).strict(),
  z
    .object({
      kind: z.literal("unplanned_expense"),
      amountCents: wholeCents()
        .min(100, "At least $1")
        .max(JUDGE_LIMITS.maxCents, "At most $10,000,000"),
      week: z
        .number({ invalid_type_error: "Pick a week" })
        .int("Week must be a whole number")
        .min(1, "Weeks run 1 to 13")
        .max(13, "Weeks run 1 to 13"),
      label: z.string().trim().min(1).max(60, "Keep the label under 60 characters").optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("payroll_raise"),
      percent: z
        .number({ invalid_type_error: "Enter a percent" })
        .int("Use a whole percent")
        .min(1, "At least 1%")
        .max(50, "At most 50%"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("bank_stripe_mismatch"),
      amountCents: wholeCents().refine(
        (c) => Math.abs(c) >= 100 && Math.abs(c) <= 100_000_000,
        "The difference must be between $1 and $1,000,000 (either sign)",
      ),
    })
    .strict(),
]);
export type Scenario = z.infer<typeof ScenarioSchema>;
export type ScenarioKind = Scenario["kind"];

export const SCENARIO_LABEL: Record<ScenarioKind, string> = {
  late_payment: "Customer pays late",
  customer_leaves: "Top customer leaves",
  unplanned_expense: "Unplanned expense",
  payroll_raise: "Payroll goes up",
  bank_stripe_mismatch: "Bank and Stripe disagree",
};

/** A judge input the sandbox refuses, in plain words. */
export class JudgeInputError extends Error {}
const refuse = (message: string): never => {
  throw new JudgeInputError(message);
};

/** First plain error message for a failed Zod parse, with the field it belongs to. */
export function zodMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid input";
  if (issue.code === "invalid_union_discriminator") return "Pick a scenario";
  if (issue.code === "unrecognized_keys") return `Unexpected field: ${issue.keys.join(", ")}`;
  return issue.message;
}

export function money(cents: number): string {
  const a = Math.abs(cents);
  const dollars = Math.floor(a / 100).toLocaleString("en-US");
  const rest = a % 100;
  return `${cents < 0 ? "-" : ""}$${dollars}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
}

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const isOpen = (i: Invoice) => i.paid === undefined && i.writtenOff === undefined;
const annual = (p: NonNullable<Snapshot["billingPlans"]>[number]) =>
  Math.round((p.amount * 12) / p.everyMonths);

/** Customers ranked by yearly billing plus what they owe now: the judge's pick list. */
export function rankCustomers(s: Snapshot, limit = 15) {
  return s.customers
    .map((c) => {
      const plans = (s.billingPlans ?? []).filter(
        (p) => p.customerId === c.id && (p.endDate === undefined || p.endDate > s.asOf),
      );
      const open = s.invoices.filter((i) => i.customerId === c.id && isOpen(i));
      return {
        id: c.id,
        name: c.name,
        yearlyCents: plans.reduce((n, p) => n + annual(p), 0),
        openCents: open.reduce((n, i) => n + i.amount, 0),
        openInvoices: open.length,
      };
    })
    .filter((c) => c.yearlyCents > 0 || c.openCents > 0)
    .sort((a, b) => b.yearlyCents + b.openCents - (a.yearlyCents + a.openCents))
    .slice(0, limit);
}

export type Planted = { overlay: Overlay; refs: string[]; summary: string };

/**
 * One scenario -> planted source entries. `served` is what the mock sources report now (with
 * earlier plants applied); `tag` makes new record ids unique. Throws JudgeInputError.
 */
export function plantScenario(
  served: Snapshot,
  current: Overlay,
  scenario: Scenario,
  tag: string,
): Planted {
  const o = plain(current);
  const s = served;
  const customer = (id: string) =>
    s.customers.find((c) => c.id === id) ?? refuse("That customer is not in this company");
  switch (scenario.kind) {
    case "late_payment": {
      const c = customer(scenario.customerId);
      const open = s.invoices.filter((i) => i.customerId === c.id && isOpen(i));
      const plans = (s.billingPlans ?? []).filter((p) => p.customerId === c.id);
      if (open.length === 0 && plans.length === 0)
        refuse(`${c.name} has no open invoices or billing to pay late`);
      const due = new Map((o.invoiceDue ?? []).map((p) => [p.id, p.due]));
      for (const i of open) due.set(i.id, addDays(i.due, scenario.days));
      o.invoiceDue = [...due].map(([id, d]) => ({ id, due: d }));
      const terms = new Map((o.planTerms ?? []).map((p) => [p.id, p.paymentTermsDays]));
      for (const p of plans) terms.set(p.id, p.paymentTermsDays + scenario.days);
      o.planTerms = [...terms].map(([id, t]) => ({ id, paymentTermsDays: t }));
      const owed = open.reduce((n, i) => n + i.amount, 0);
      return {
        overlay: o,
        refs: [...open.map((i) => i.id), ...plans.map((p) => p.id)],
        summary: `${c.name} now pays ${scenario.days} days late: ${open.length} open invoice${open.length === 1 ? "" : "s"} (${money(owed)}) due later, and future billing terms ${scenario.days} days longer`,
      };
    }
    case "customer_leaves": {
      const c = customer(scenario.customerId);
      if ((o.churn ?? []).some((x) => x.customerId === c.id)) refuse(`${c.name} already left`);
      o.churn = [...(o.churn ?? []), { customerId: c.id, from: s.asOf }];
      const plans = (s.billingPlans ?? []).filter(
        (p) => p.customerId === c.id && (p.endDate === undefined || p.endDate > s.asOf),
      );
      const deals = s.deals.filter((d) => d.customerId === c.id && d.stage === "open");
      const yearly = plans.reduce((n, p) => n + annual(p), 0);
      return {
        overlay: o,
        refs: [c.id, ...plans.map((p) => p.id), ...deals.map((d) => d.id)],
        summary: `${c.name} leaves as of ${s.asOf}: billing worth ${money(yearly)} a year stops, ${deals.length} open deal${deals.length === 1 ? "" : "s"} lost; open invoices are still owed`,
      };
    }
    case "unplanned_expense": {
      const id = `judge_bill_${tag}`;
      const due = addDays(firstForecastWeek(s.asOf), 7 * (scenario.week - 1) + 2);
      const vendor = scenario.label ?? "Unplanned expense";
      const bill: Bill = { id, vendor, amount: scenario.amountCents, due, critical: false };
      o.bills = [...o.bills, bill];
      return {
        overlay: o,
        refs: [id],
        summary: `New bill ${id}: ${vendor}, ${money(scenario.amountCents)} due ${due} (week ${scenario.week} of 13)`,
      };
    }
    case "payroll_raise": {
      const future = s.payroll.filter((r) => r.date > s.asOf);
      if (future.length === 0) refuse("No upcoming payroll runs to raise");
      const bps = scenario.percent * 100;
      o.payrollRaise = [...(o.payrollRaise ?? []), { from: s.asOf, bps }];
      const extra = future.reduce((n, r) => n + scaleCents(r.amount, bps) - r.amount, 0);
      return {
        overlay: o,
        refs: future.map((r) => r.id),
        summary: `Payroll up ${scenario.percent}% after ${s.asOf}: ${future.length} upcoming run${future.length === 1 ? "" : "s"} now cost ${money(extra)} more in total`,
      };
    }
    case "bank_stripe_mismatch": {
      const rewritten = new Set((o.bankAmounts ?? []).map((p) => p.id));
      const deposits = s.bankTxns
        .filter((t) => t.amount > 0 && t.date <= s.asOf && !rewritten.has(t.id))
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      // The newest Stripe deposit the difference fits in (a deposit cannot go to zero or below).
      const fits = deposits.filter((d) => d.amount + scenario.amountCents > 0);
      const t =
        fits.find((d) => d.counterparty === "Stripe") ??
        fits[0] ??
        refuse(
          deposits.length === 0
            ? "No bank deposit to compare against Stripe"
            : `That difference is larger than any deposit (largest ${money(Math.max(...deposits.map((d) => d.amount)))})`,
        );
      const amount = t.amount + scenario.amountCents;
      o.bankAmounts = [...(o.bankAmounts ?? []), { id: t.id, amount }];
      return {
        overlay: o,
        refs: [t.id],
        summary: `Bank now reports deposit ${t.id} (${t.date}) as ${money(amount)}; ${t.counterparty === "Stripe" ? "Stripe" : "the books"} recorded ${money(t.amount)}, off by ${money(scenario.amountCents)}`,
      };
    }
  }
}

// ---------- Guided checklist ----------

export type ChecklistInput = {
  /** An active judge company is selected. */
  started: boolean;
  /** The snapshot version current when each scenario or upload was submitted. */
  scenarioVersions: number[];
  /** The latest snapshot version the agents wrote and audited. */
  snapshotVersion: number;
  /** Flags a person decided. */
  decisions: number;
  /** A decision row (`escalation.approved` / `escalation.rejected`) is in the action log. */
  decisionLogged: boolean;
};

export const CHECKLIST_STEPS = [
  { id: "start", label: "Start company" },
  { id: "scenario", label: "Add a scenario" },
  { id: "watch", label: "Watch the agents" },
  { id: "decide", label: "Decide a flag" },
  { id: "record", label: "See the record" },
] as const;
export type ChecklistStep = (typeof CHECKLIST_STEPS)[number] & { done: boolean };

/** Each step ticks itself from stored state; nothing is ticked by a click alone. */
export function judgeChecklist(i: ChecklistInput): ChecklistStep[] {
  const first = i.scenarioVersions.length > 0 ? Math.min(...i.scenarioVersions) : undefined;
  const done: Record<(typeof CHECKLIST_STEPS)[number]["id"], boolean> = {
    start: i.started,
    scenario: i.started && first !== undefined,
    // A newer version than the one the scenario landed on was ingested and audited.
    watch: i.started && first !== undefined && i.snapshotVersion > first,
    decide: i.started && i.decisions > 0,
    record: i.started && i.decisions > 0 && i.decisionLogged,
  };
  return CHECKLIST_STEPS.map((s) => ({ ...s, done: done[s.id] }));
}

// ---------- CSV upload ----------

export const CSV_KINDS = ["bankTxns", "bills", "invoices"] as const;
export type CsvKind = (typeof CSV_KINDS)[number];

export const CSV_COLUMNS: Record<CsvKind, { required: string[]; optional: string[] }> = {
  bankTxns: { required: ["date", "amount", "description"], optional: ["counterparty"] },
  bills: { required: ["vendor", "amount", "due"], optional: ["critical"] },
  invoices: { required: ["customer_id", "amount", "issued", "due"], optional: [] },
};

export const CSV_LABEL: Record<CsvKind, string> = {
  bankTxns: "Bank transactions",
  bills: "Bills",
  invoices: "Invoices",
};

/** Header plus two example rows. `customerIdExample` fills the invoices template. */
export function csvTemplate(kind: CsvKind, asOf: string, customerIdExample = "cus_example") {
  const d = (n: number) => addDays(asOf, n);
  const rows: Record<CsvKind, string[]> = {
    bankTxns: [
      "date,amount,description,counterparty",
      `${d(-2)},-1250.00,Office move deposit,Bayside Movers`,
      `${d(-1)},4800.50,Customer payment,Stripe`,
    ],
    bills: [
      "vendor,amount,due,critical",
      `Legal retainer,15000.00,${d(14)},no`,
      `Cloud hosting,8200.00,${d(21)},yes`,
    ],
    invoices: [
      "customer_id,amount,issued,due",
      `${customerIdExample},12000.00,${d(-3)},${d(27)}`,
      `${customerIdExample},3500.00,${d(-1)},${d(29)}`,
    ],
  };
  return `${rows[kind].join("\n")}\n`;
}

/** RFC 4180-style CSV: quoted fields, doubled quotes, CRLF or LF. Blank lines are skipped. */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) out.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) out.push(row);
  return out;
}

/** "1,250.50", "-$80", "12" -> integer cents, or null. String math only, no float money. */
export function parseDollars(text: string): number | null {
  const m = /^(-)?\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  const whole = Number((m[2] as string).replaceAll(",", ""));
  const frac = Number((m[3] ?? "").padEnd(2, "0") || "0");
  const cents = whole * 100 + frac;
  if (!Number.isSafeInteger(cents)) return null;
  return m[1] ? -cents : cents;
}

const isCalendarDate = (d: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

export type CsvRecord = Record<string, string>;
export type CsvEntry =
  | { kind: "bankTxns"; row: Omit<BankTxn, "id"> }
  | { kind: "bills"; row: Omit<Bill, "id"> }
  | { kind: "invoices"; row: Omit<Invoice, "id"> };
export type CsvRowResult = { line: number; errors: string[]; entry?: CsvEntry };

/** Header row + records, or one plain error about the header. Lines count from 1 (header). */
export function csvRecords(
  kind: CsvKind,
  text: string,
): { records: CsvRecord[] } | { error: string } {
  const rows = parseCsv(text);
  const header = rows[0]?.map((h) => h.trim().toLowerCase());
  if (!header) return { error: "The file is empty" };
  const { required, optional } = CSV_COLUMNS[kind];
  const missing = required.filter((c) => !header.includes(c));
  if (missing.length > 0)
    return { error: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}` };
  const unknown = header.filter((h) => h && !required.includes(h) && !optional.includes(h));
  if (unknown.length > 0) return { error: `Unknown column: ${unknown.join(", ")}` };
  const body = rows.slice(1);
  if (body.length === 0) return { error: "No rows under the header" };
  if (body.length > JUDGE_LIMITS.csvRows)
    return { error: `At most ${JUDGE_LIMITS.csvRows} rows per upload (got ${body.length})` };
  return {
    records: body.map((cells) =>
      Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? "").trim()])),
    ),
  };
}

/**
 * Strict per-row checks. Dates must be real calendar days within 120 days before and 180 days
 * after the company's today; amounts are dollars with at most two decimals, never over $10M.
 */
export function validateCsvRows(
  kind: CsvKind,
  records: CsvRecord[],
  ctx: { asOf: string; customerIds: Set<string> },
): CsvRowResult[] {
  const earliest = addDays(ctx.asOf, -120);
  const latest = addDays(ctx.asOf, 180);
  return records.map((r, index) => {
    const errors: string[] = [];
    const line = index + 2;
    const text = (col: string, max = 80) => {
      const v = (r[col] ?? "").trim();
      if (!v) errors.push(`${col} is empty`);
      else if (v.length > max) errors.push(`${col} is longer than ${max} characters`);
      return v;
    };
    const date = (col: string) => {
      const v = (r[col] ?? "").trim();
      if (!isCalendarDate(v)) errors.push(`${col} "${v}" is not a date like ${ctx.asOf}`);
      else if (v < earliest || v > latest)
        errors.push(`${col} ${v} is outside ${earliest} to ${latest}`);
      return v;
    };
    const amount = (sign: "any" | "positive") => {
      const raw = (r.amount ?? "").trim();
      const cents = parseDollars(raw);
      if (cents === null) errors.push(`amount "${raw}" is not a dollar amount like 1250.00`);
      else if (cents === 0) errors.push("amount is zero");
      else if (sign === "positive" && cents < 0) errors.push("amount must be positive");
      else if (Math.abs(cents) > JUDGE_LIMITS.maxCents) errors.push("amount is over $10,000,000");
      return cents ?? 0;
    };
    let entry: CsvEntry | undefined;
    if (kind === "bankTxns") {
      const d = date("date");
      const a = amount("any");
      const description = text("description");
      const counterparty = (r.counterparty ?? "").trim().slice(0, 80);
      entry = {
        kind,
        row: { date: d, amount: a, description, ...(counterparty && { counterparty }) },
      };
    } else if (kind === "bills") {
      const vendor = text("vendor");
      const a = amount("positive");
      const due = date("due");
      const flag = (r.critical ?? "").trim().toLowerCase();
      if (flag && !["yes", "no", "true", "false"].includes(flag))
        errors.push(`critical "${flag}" must be yes or no`);
      entry = {
        kind,
        row: { vendor, amount: a, due, critical: flag === "yes" || flag === "true" },
      };
    } else {
      const customerId = text("customer_id");
      if (customerId && !ctx.customerIds.has(customerId))
        errors.push(`customer_id ${customerId} is not a customer of this company`);
      const a = amount("positive");
      const issued = date("issued");
      const due = date("due");
      if (issued > ctx.asOf) errors.push(`issued ${issued} is after today (${ctx.asOf})`);
      if (due < issued) errors.push("due is before issued");
      entry = { kind, row: { customerId, amount: a, issued, due } };
    }
    return errors.length > 0 ? { line, errors } : { line, errors, entry };
  });
}

/** Accepted CSV rows -> planted entries on the overlay, with ids unique to `tag`. */
export function plantCsv(current: Overlay, entries: CsvEntry[], tag: string): Planted {
  const o = plain(current);
  const refs: string[] = [];
  entries.forEach((e, i) => {
    const id = `judge_csv_${tag}_${i + 1}`;
    refs.push(id);
    if (e.kind === "bankTxns") o.bankTxns = [...o.bankTxns, { id, ...e.row }];
    else if (e.kind === "bills") o.bills = [...o.bills, { id, ...e.row }];
    else o.invoices = [...(o.invoices ?? []), { id, ...e.row }];
  });
  const kind = entries[0]?.kind ?? "bankTxns";
  return {
    overlay: o,
    refs,
    summary: `Uploaded ${entries.length} ${CSV_LABEL[kind].toLowerCase()} from a CSV file`,
  };
}
