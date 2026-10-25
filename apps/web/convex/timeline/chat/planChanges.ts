import type { Change } from "@domino/contracts";
import { cashSchedule } from "@domino/engine/src/forecast";
import type { CashItem } from "@domino/engine/src/schedule";
import type { WorkspaceRun } from "../questions/context";
import { addDays, mondayOf } from "../questions/parse";
import type { QuestionProposal } from "../questions/receipt";
import { compactMoney, shortDate } from "../recordNames";

/**
 * Plan-level what-ifs the one-event grammar cannot express: a percentage cut or increase in
 * spend with a vendor or category, new hires on payroll, and a price change on recurring
 * billing. Each is turned into existing change kinds (add_cash/remove_cash), dated on the
 * scheduled payments it touches, at most one per week; the engine computes the forecast.
 * Amounts are integer cents, rounded per payment. Returns null when the text is not one of these.
 */
export type PlanReply = { answer: string; proposal: QuestionProposal | null };

const MAX_WEEKS = 16;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  a: 1,
  an: 1,
};
const MARKETING =
  /market|advertis|\bads?\b|adwords|google ads|linkedin|facebook|\bmeta\b|campaign|sponsor|media buy|promot|seo|brand/i;

/** Basis points so percentages stay integer math: "2.5" -> 250. */
function basisPoints(text: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return null;
  const bp = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return bp > 0 && bp <= 10_000 ? bp : null;
}
const share = (cents: number, bp: number) => Math.round((Math.abs(cents) * bp) / 10_000);
const pctText = (bp: number) => `${bp / 100}%`;

function horizon(run: WorkspaceRun, floor: string | null) {
  const weeks = run.forecast.weeks;
  const asOf = run.baseline.seed.snapshot.asOf;
  const from = floor && floor > asOf ? floor : addDays(asOf, 1);
  return { from, end: addDays(weeks.at(-1)?.weekStart ?? asOf, 6) };
}

function futureItems(run: WorkspaceRun, floor: string | null): CashItem[] {
  const { from, end } = horizon(run, floor);
  return cashSchedule(run.baseline.seed.snapshot, run.baseline.model, run.changes).items.filter(
    (i) => i.date >= from && i.date <= end,
  );
}

/** One change per week, dated on that week's first touched payment. */
function weekly(
  touched: { date: string; cents: number }[],
  kind: "add_cash" | "remove_cash",
  label: string,
): Change[] {
  const byWeek = new Map<string, { date: string; cents: number }>();
  for (const t of [...touched].sort((a, b) => a.date.localeCompare(b.date))) {
    const week = mondayOf(t.date);
    const prev = byWeek.get(week);
    byWeek.set(week, { date: prev?.date ?? t.date, cents: (prev?.cents ?? 0) + t.cents });
  }
  return [...byWeek.values()]
    .filter((w) => w.cents > 0)
    .slice(0, MAX_WEEKS)
    .map((w) => ({
      kind,
      date: w.date,
      amount: w.cents,
      label: `${label}, week of ${shortDate(mondayOf(w.date))}`,
    }));
}

function itemVendor(run: WorkspaceRun, item: CashItem): string {
  if (item.kind === "bill")
    return run.baseline.seed.snapshot.bills.find((b) => b.id === item.id)?.vendor ?? item.id;
  return item.id;
}

function spendChange(run: WorkspaceRun, text: string, floor: string | null): PlanReply | null {
  const m =
    /\b(cut|reduce|lower|trim|decrease|increase|raise|grow|boost)\s+(?:our\s+|the\s+)?([a-z][\w &.'-]{1,40}?)\s+(?:spend(?:ing)?\s+|costs?\s+|budget\s+)?(?:by\s+)?(\d{1,3}(?:\.\d{1,2})?)\s*(?:%|percent)/i.exec(
      text,
    );
  if (!m) return null;
  const target = (m[2] ?? "").replace(/\s+(spend(?:ing)?|costs?|budget)$/i, "").trim();
  if (/^prices?$/i.test(target)) return null;
  const bp = basisPoints(m[3] ?? "");
  if (bp === null)
    return {
      answer: "Give the change as a percentage between 1% and 100%, like 20%.",
      proposal: null,
    };
  const cut = /cut|reduce|lower|trim|decrease/i.test(m[1] ?? "");
  const snapshot = run.baseline.seed.snapshot;
  const outflows = futureItems(run, floor).filter(
    (i) => i.amount < 0 && (i.kind === "bill" || i.kind === "recurring"),
  );
  const word = new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  // Card categories name what a merchant is for ("Advertising"), so they widen the match.
  const categoryMerchants = new Set(
    snapshot.cardTxns
      .filter(
        (t) => word.test(t.category) || (/marketing/i.test(target) && MARKETING.test(t.category)),
      )
      .map((t) => t.merchant.toLowerCase()),
  );
  const matches = outflows.filter((i) => {
    const vendor = itemVendor(run, i);
    return (
      word.test(vendor) ||
      categoryMerchants.has(vendor.toLowerCase()) ||
      (/marketing/i.test(target) && MARKETING.test(vendor))
    );
  });
  if (!matches.length) {
    const totals = new Map<string, number>();
    for (const i of outflows)
      totals.set(itemVendor(run, i), (totals.get(itemVendor(run, i)) ?? 0) - i.amount);
    const options = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([v, c]) => `${v} (${compactMoney(c)})`);
    return {
      answer: options.length
        ? `I could not find ${target} spending in the bills or card data for these 13 weeks. Which vendor should I ${cut ? "cut" : "raise"}: ${options.join(", ")}?`
        : `I could not find ${target} spending, or any scheduled bills or recurring costs, in these 13 weeks.`,
      proposal: null,
    };
  }
  const name = target.charAt(0).toUpperCase() + target.slice(1);
  const label = `${name} spend ${cut ? "cut" : "up"} ${pctText(bp)}`;
  const changes = weekly(
    matches.map((i) => ({ date: i.date, cents: share(i.amount, bp) })),
    cut ? "add_cash" : "remove_cash",
    label,
  );
  const total = changes.reduce((s, c) => s + ("amount" in c ? c.amount : 0), 0);
  const vendors = [...new Set(matches.map((i) => itemVendor(run, i)))].slice(0, 3).join(", ");
  if (!changes.length)
    return {
      answer: `A ${pctText(bp)} change to ${target} rounds to nothing in these weeks.`,
      proposal: null,
    };
  return {
    answer: `Ready to model a ${pctText(bp)} ${cut ? "cut" : "increase"} to ${target} spend (${vendors}): ${cut ? "saves" : "adds"} ${compactMoney(total)} across ${matches.length} scheduled ${matches.length === 1 ? "payment" : "payments"} in these 13 weeks. Check the details below, then confirm.`,
    proposal: {
      label: `${label} (${vendors})`.slice(0, 200),
      changes,
      constraints: null,
      constraintNote: null,
    },
  };
}

/** "Dec 1", "December 1", "2026-12-01": the next such date on or after the books' date. */
function looseDate(text: string, asOf: string): string | null {
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) return iso[0];
  const m =
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i.exec(
      text,
    );
  if (!m) return null;
  const month = MONTHS.indexOf((m[1] ?? "").slice(0, 3).toLowerCase()) + 1;
  const day = Number(m[2]);
  let year = m[3] ? Number(m[3]) : Number(asOf.slice(0, 4));
  const iso2 = (y: number) =>
    `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!m[3] && iso2(year) < asOf) year += 1;
  const out = iso2(year);
  const check = new Date(`${out}T00:00:00Z`);
  return Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== out ? null : out;
}

function hires(run: WorkspaceRun, text: string, floor: string | null): PlanReply | null {
  const m =
    /\bhire\s+(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|an?)\s+([a-z][\w -]{0,40}?)\s+at\s+\$?\s*([\d,]+(?:\.\d+)?)\s*(k|m)?\b/i.exec(
      text,
    );
  if (!m) return null;
  const count = /^\d+$/.test(m[1] ?? "")
    ? Number(m[1])
    : (NUMBER_WORDS[(m[1] ?? "").toLowerCase()] ?? 0);
  const scale =
    (m[4] ?? "").toLowerCase() === "k" ? 1_000 : (m[4] ?? "").toLowerCase() === "m" ? 1_000_000 : 1;
  const salary = Math.round(Number((m[3] ?? "").replaceAll(",", "")) * scale * 100);
  const role = (m[2] ?? "people").trim();
  const snapshot = run.baseline.seed.snapshot;
  const start = looseDate(text, snapshot.asOf);
  if (!count || !Number.isSafeInteger(salary) || salary <= 0)
    return {
      answer: `Give the number of hires and the yearly salary, like "Hire 3 engineers at $150K from Dec 1".`,
      proposal: null,
    };
  if (!start)
    return {
      answer: `When do the ${role} start? For example, "Hire ${count} ${role} at $${m[3]}${m[4] ?? ""} from Dec 1".`,
      proposal: null,
    };
  const from = floor && floor > start ? floor : start;
  const runs = futureItems(run, floor).filter((i) => i.kind === "payroll" && i.date >= from);
  const history = [...snapshot.payroll].map((p) => p.date).sort();
  const gaps = history
    .slice(1)
    .map((d, i) => (Date.parse(d) - Date.parse(history[i] ?? d)) / 86_400_000);
  const gap = gaps.length ? (gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 14) : 14;
  const perRun = Math.round((count * salary * gap) / 365);
  const { end } = horizon(run, floor);
  const dates = runs.length
    ? runs.map((r) => r.date)
    : Array.from({ length: 20 }, (_, k) => addDays(from, k * gap)).filter((d) => d <= end);
  if (!dates.length)
    return {
      answer: `${shortDate(start)} is after these 13 weeks, so the hires would not change this forecast.`,
      proposal: null,
    };
  const label = `${count} new ${role} at ${compactMoney(salary)} a year`;
  const changes = weekly(
    dates.map((d) => ({ date: d, cents: perRun })),
    "remove_cash",
    label,
  );
  const total = changes.reduce((s, c) => s + ("amount" in c ? c.amount : 0), 0);
  return {
    answer: `Ready to model ${count} ${role} at ${compactMoney(salary)} a year from ${shortDate(start)}: about ${compactMoney(perRun)} more per payroll run (every ${gap} days), ${compactMoney(total)} over these 13 weeks. Payroll taxes and benefits are not included. Check the details below, then confirm.`,
    proposal: { label: label.slice(0, 200), changes, constraints: null, constraintNote: null },
  };
}

function prices(run: WorkspaceRun, text: string, floor: string | null): PlanReply | null {
  const m =
    /\b(raise|increase|lift|cut|lower|reduce)\s+(?:our\s+|the\s+)?prices?\s+(?:by\s+)?(\d{1,3}(?:\.\d{1,2})?)\s*(?:%|percent)/i.exec(
      text,
    );
  if (!m) return null;
  const bp = basisPoints(m[2] ?? "");
  if (bp === null)
    return { answer: "Give the price change as a percentage, like 5%.", proposal: null };
  const up = /raise|increase|lift/i.test(m[1] ?? "");
  // Recurring revenue only: projected plan bills from the next one on. Issued invoices keep
  // the price they were billed at.
  const bills = futureItems(run, floor).filter((i) => i.kind === "plan" && i.amount > 0);
  if (!bills.length)
    return {
      answer:
        "No recurring bills are scheduled in these 13 weeks, so a price change would not move cash yet.",
      proposal: null,
    };
  const label = `Prices ${up ? "up" : "down"} ${pctText(bp)} on recurring bills`;
  const changes = weekly(
    bills.map((i) => ({ date: i.date, cents: share(i.amount, bp) })),
    up ? "add_cash" : "remove_cash",
    label,
  );
  const total = changes.reduce((s, c) => s + ("amount" in c ? c.amount : 0), 0);
  return {
    answer: `Ready to model prices ${up ? "up" : "down"} ${pctText(bp)} from each customer's next recurring bill: ${up ? "+" : "-"}${compactMoney(total)} across ${bills.length} ${bills.length === 1 ? "bill" : "bills"} in these 13 weeks, assuming no customer leaves over it. Check the details below, then confirm.`,
    proposal: { label, changes, constraints: null, constraintNote: null },
  };
}

export function planRequest(
  run: WorkspaceRun,
  text: string,
  floor: string | null,
): PlanReply | null {
  return prices(run, text, floor) ?? hires(run, text, floor) ?? spendChange(run, text, floor);
}
