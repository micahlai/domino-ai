import type { Change } from "@domino/contracts";
import {
  EXTERNAL_EVENT_PARAMS,
  type ExternalParamName,
  externalEventChanges,
} from "@domino/engine/src/external-events";
import { cashSchedule, forecast } from "@domino/engine/src/forecast";
import type { CashItem } from "@domino/engine/src/schedule";
import type { WorkspaceRun } from "../questions/context";
import { addDays } from "../questions/parse";
import type { QuestionProposal } from "../questions/receipt";
import { compactMoney, shortDate } from "../recordNames";
import { type MacroEstimate, detectExternalEvent, paramPhrase, typedParams } from "./externalEvent";

/**
 * Plan-level what-ifs the one-event grammar cannot express: a percentage cut or increase in
 * spend with a vendor or category, new hires on payroll, and a price change on recurring
 * billing, and losing a customer. Each becomes one persistent change (scale_recurring,
 * recurring_cash, churn) that keeps acting on every later matching payment, so the line bends
 * instead of shifting once; the engine computes the forecast. Returns null otherwise.
 */
export type PlanReply = { answer: string; proposal: QuestionProposal | null };

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

export function horizon(run: WorkspaceRun, floor: string | null) {
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
  const vendorNames = [...new Set(matches.map((i) => itemVendor(run, i)))];
  const { from } = horizon(run, floor);
  // One persistent change: every matching bill or recurring cost from `from` on is scaled.
  const changes: Change[] = [
    {
      kind: "scale_recurring",
      label,
      flows: "spend",
      names: vendorNames,
      percent: ((cut ? -1 : 1) * bp) / 100,
      fromDate: from,
    },
  ];
  const total = matches.reduce((s, i) => s + share(i.amount, bp), 0);
  const vendors = vendorNames.slice(0, 3).join(", ");
  if (total === 0)
    return {
      answer: `A ${pctText(bp)} change to ${target} rounds to nothing in these weeks.`,
      proposal: null,
    };
  return {
    answer: `Ready to model a ${pctText(bp)} ${cut ? "cut" : "increase"} to ${target} spend (${vendors}) from ${shortDate(from)} on: it applies to every later bill, about ${cut ? "saves" : "adds"} ${compactMoney(total)} across ${matches.length} scheduled ${matches.length === 1 ? "payment" : "payments"} in these 13 weeks. Check the details below, then confirm.`,
    proposal: {
      label: `${label} (${vendors})`.slice(0, 200),
      changes,
      constraints: null,
      constraintNote: null,
    },
  };
}

/** "Dec 1", "December 1", "2026-12-01": the next such date on or after the books' date. */
export function looseDate(text: string, asOf: string): string | null {
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
  const first = runs[0]?.date ?? from;
  const dates = Array.from({ length: 60 }, (_, k) => addDays(first, k * gap)).filter(
    (d) => d <= end,
  );
  if (!dates.length)
    return {
      answer: `${shortDate(start)} is after these 13 weeks, so the hires would not change this forecast.`,
      proposal: null,
    };
  const label = `${count} new ${role} at ${compactMoney(salary)} a year`;
  // Payroll every pay period from the first run on or after the start, to the horizon end.
  const changes: Change[] = [
    {
      kind: "recurring_cash",
      label,
      direction: "out",
      amount: perRun,
      fromDate: dates[0] ?? from,
      everyDays: gap,
    },
  ];
  const total = perRun * dates.length;
  return {
    answer: `Ready to model ${count} ${role} at ${compactMoney(salary)} a year from ${shortDate(start)}: about ${compactMoney(perRun)} more on every payroll run (every ${gap} days) from then on, ${compactMoney(total)} over these 13 weeks. Payroll taxes and benefits are not included. Check the details below, then confirm.`,
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
  const { from } = horizon(run, floor);
  const changes: Change[] = [
    {
      kind: "scale_recurring",
      label,
      flows: "billing",
      names: [],
      percent: ((up ? 1 : -1) * bp) / 100,
      fromDate: from,
    },
  ];
  const total = bills.reduce((s, i) => s + share(i.amount, bp), 0);
  return {
    answer: `Ready to model prices ${up ? "up" : "down"} ${pctText(bp)} from each customer's next recurring bill: about ${up ? "+" : "-"}${compactMoney(total)} across ${bills.length} ${bills.length === 1 ? "bill" : "bills"} in these 13 weeks, and every later bill, assuming no customer leaves over it. Check the details below, then confirm.`,
    proposal: { label, changes, constraints: null, constraintNote: null },
  };
}

/**
 * "Lay off half the team from Jan 1", "cut payroll 30%": payroll shrinks by that share from the
 * start date (the next day by default). One shift_hire change saves the share of the average
 * monthly payroll, spread evenly over the days from the start, so the line bends from then on.
 */
function layoffs(run: WorkspaceRun, text: string, floor: string | null): PlanReply | null {
  const laid = /\b(lay(?:ing)?\s*offs?|laid\s+off|let\s+go\s+of|downsiz\w*|fire|firing)\b/i.test(
    text,
  );
  const cut =
    /\b(cut|cuts|cutting|reduce|reducing|lower|trim|shrink)\s+(?:our\s+|the\s+)?(payroll|headcount|staff|team|workforce|salar(?:y|ies))\b/i.test(
      text,
    );
  if (!laid && !cut) return null;
  const pct = /(\d{1,3}(?:\.\d{1,2})?)\s*(?:%|percent)/i.exec(text);
  const bp = pct
    ? basisPoints(pct[1] ?? "")
    : /\bhalf\b/i.test(text)
      ? 5_000
      : /\b(?:a|one)\s+third\b/i.test(text)
        ? 3_333
        : /\b(?:a|one)\s+quarter\b/i.test(text)
          ? 2_500
          : /\b(everyone|everybody|all\s+(?:of\s+)?(?:our\s+|the\s+)?(?:staff|team|employees|people|workforce))\b/i.test(
                text,
              )
            ? 10_000
            : null;
  if (bp === null)
    return {
      answer:
        'What share of payroll goes? For example, "lay off 30% of the team from Dec 1" or "cut payroll in half".',
      proposal: null,
    };
  const snapshot = run.baseline.seed.snapshot;
  const { from: earliest, end } = horizon(run, floor);
  const start = looseDate(text, snapshot.asOf);
  const from = start && start > earliest ? start : earliest;
  if (from > end)
    return {
      answer: `${shortDate(from)} is after these 13 weeks, so the payroll cut would not change this forecast.`,
      proposal: null,
    };
  const payroll = futureItems(run, floor).filter((i) => i.kind === "payroll");
  const total = -payroll.reduce((s, i) => s + i.amount, 0);
  if (total <= 0)
    return {
      answer:
        "No payroll runs are scheduled in these 13 weeks, so a payroll cut would not move cash.",
      proposal: null,
    };
  const days = (Date.parse(end) - Date.parse(earliest)) / 86_400_000 + 1;
  const monthly = Math.round((total * 30.4) / Math.max(1, days));
  const monthlyCost = share(monthly, bp);
  if (monthlyCost <= 0)
    return { answer: `A ${pctText(bp)} payroll cut rounds to nothing.`, proposal: null };
  const label = `Payroll cut ${pctText(bp)} (layoffs) from ${shortDate(from)}`;
  const change: Change = {
    kind: "shift_hire",
    label,
    monthlyCost,
    fromDate: from,
    toDate: addDays(end, 1),
  };
  // The engine's own schedule gives the savings inside the forecast.
  const saved = cashSchedule(snapshot, run.baseline.model, [...run.changes, change])
    .items.filter((i) => i.kind === "change" && i.id === label)
    .reduce((s, i) => s + i.amount, 0);
  return {
    answer: `Ready to model a ${pctText(bp)} payroll cut from ${shortDate(from)}: about ${compactMoney(monthlyCost)} a month less payroll, ${compactMoney(saved)} saved over these 13 weeks. Severance and notice pay are not included; the saving is spread evenly from the start date. Check the details below, then confirm.`,
    proposal: { label, changes: [change], constraints: null, constraintNote: null },
  };
}

/** "We lose Northwind", "Northwind churns/leaves/cancels": all its later billing stops. */
function lostCustomer(run: WorkspaceRun, text: string, floor: string | null): PlanReply | null {
  if (
    !/\b(lose|losing|lost|churns?|churned|leaves?|leaving|cancels?|cancell?ing|drops? us)\b/i.test(
      text,
    )
  )
    return null;
  const snapshot = run.baseline.seed.snapshot;
  const lower = text.toLowerCase();
  const named = snapshot.customers.filter((c) => {
    const n = c.name.toLowerCase();
    return lower.includes(n) || lower.includes(n.split(/\s+/)[0] ?? n);
  });
  const items = futureItems(run, floor).filter((i) => i.amount > 0 && i.customerId);
  const byCustomer = new Map<string, number>();
  for (const i of items)
    byCustomer.set(i.customerId ?? "", (byCustomer.get(i.customerId ?? "") ?? 0) + i.amount);
  const biggest = /\b(biggest|largest|top|main)\s+customer\b/i.test(text)
    ? [...byCustomer.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0]
    : undefined;
  const { from } = horizon(run, floor);
  const start = looseDate(text, snapshot.asOf);
  const fromDate = start && start > from ? start : from;
  const group = lostGroup(text, byCustomer);
  if (group) return lostMany(run, items, group, fromDate);
  const customer = named.length === 1 ? named[0] : snapshot.customers.find((c) => c.id === biggest);
  if (!customer) return null;
  const lost = items.filter((i) => i.customerId === customer.id && i.date >= fromDate);
  const total = lost.reduce((s, i) => s + i.amount, 0);
  if (!lost.length)
    return {
      answer: `${customer.name} has no expected receipts in these 13 weeks after ${shortDate(fromDate)}, so losing them would not change this forecast.`,
      proposal: null,
    };
  return {
    answer: `Ready to model losing ${customer.name} from ${shortDate(fromDate)}: every later invoice and recurring bill from them stops, ${compactMoney(total)} across ${lost.length} expected ${lost.length === 1 ? "receipt" : "receipts"} in these 13 weeks. Check the details below, then confirm.`,
    proposal: {
      label: `${customer.name} leaves`.slice(0, 200),
      changes: [{ kind: "churn", customerId: customer.id, fromDate }],
      constraints: null,
      constraintNote: null,
    },
  };
}

type LostGroup = { ids: string[]; what: string };

/**
 * "We lose all/every customer", "our top 3 customers leave", "we lose 20% / half of our
 * customers": the largest payers by expected receipts go first, since a percentage of revenue
 * is what moves cash. Null when the message is about a single customer.
 */
function lostGroup(text: string, byCustomer: Map<string, number>): LostGroup | null {
  const ranked = [...byCustomer.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([id]) => id);
  if (!ranked.length) return null;
  if (/\b(all|every|each)\b[^.]*\bcustomers?\b|\bcustomers?\b[^.]*\b(all|every)\b/i.test(text))
    return { ids: ranked, what: "every customer" };
  const top = /\b(?:top|biggest|largest)\s+(\d+|two|three|four|five|ten)\s+customers\b/i.exec(text);
  if (top) {
    const n = Number(top[1]) || NUMBER_WORDS[top[1]?.toLowerCase() ?? ""] || 0;
    if (n > 1)
      return { ids: ranked.slice(0, n), what: `the top ${Math.min(n, ranked.length)} customers` };
  }
  const pct = /\b(\d{1,3})\s*%\s*(?:of\s+)?(?:our\s+)?customers\b/i.exec(text);
  const half = /\bhalf\s+(?:of\s+)?(?:our\s+)?customers\b/i.test(text);
  const share = half ? 50 : pct ? Math.min(100, Number(pct[1])) : 0;
  if (share > 0) {
    const n = Math.max(1, Math.round((ranked.length * share) / 100));
    return { ids: ranked.slice(0, n), what: `${share}% of customers (${n} largest payers)` };
  }
  return null;
}

function lostMany(
  run: WorkspaceRun,
  items: ReturnType<typeof futureItems>,
  group: LostGroup,
  fromDate: string,
): PlanReply {
  const ids = new Set(group.ids);
  const lost = items.filter((i) => ids.has(i.customerId ?? "") && i.date >= fromDate);
  const total = lost.reduce((s, i) => s + i.amount, 0);
  const label = `Lose ${group.what} from ${shortDate(fromDate)}`;
  return {
    answer: `Ready to model losing ${group.what} from ${shortDate(fromDate)}: all their later invoices and recurring bills stop, ${compactMoney(total)} across ${lost.length} expected receipts in these 13 weeks. Payroll, vendors and debt keep running, so the engine shows how fast cash runs out. Check the details below, then confirm.`,
    proposal: {
      label: label.slice(0, 200),
      changes: group.ids.map((customerId) => ({ kind: "churn" as const, customerId, fromDate })),
      constraints: null,
      constraintNote: null,
    },
  };
}

/**
 * Outside events (rate hike, bad press, downturn, good press, fine, vendor outage). Numbers the
 * person typed win; then a bounded AI estimate for the same event; then the engine's stated
 * defaults. The engine picks the records and builds every change; the low point it reports is
 * a full engine forecast of the whole scenario. Every source is named in the answer.
 */
function externalEvent(
  run: WorkspaceRun,
  text: string,
  floor: string | null,
  estimate: MacroEstimate | null,
): PlanReply | null {
  const kind = detectExternalEvent(text);
  if (!kind) return null;
  const snapshot = run.baseline.seed.snapshot;
  const typed = typedParams(kind, text);
  const ai = estimate?.kind === kind ? estimate : null;
  const sources: Partial<Record<ExternalParamName, string>> = {};
  const params = { ...typed };
  for (const name of Object.keys(EXTERNAL_EVENT_PARAMS[kind]) as ExternalParamName[]) {
    if (typed[name] !== undefined) sources[name] = "Your number";
    else if (ai?.values[name] !== undefined) {
      params[name] = ai.values[name];
      sources[name] = "AI estimate";
    } else sources[name] = "Assumption";
  }
  if (kind === "regulatory_fine" && params.amount === undefined)
    return {
      answer: 'How much is the fine? For example, "a $250,000 regulatory fine".',
      proposal: null,
    };
  const { from, end } = horizon(run, floor);
  const date = looseDate(text, snapshot.asOf);
  const start = date && date > from ? date : from;
  if (start > end)
    return {
      answer: `${shortDate(start)} is after these 13 weeks, so this would not change the forecast.`,
      proposal: null,
    };
  const result = externalEventChanges(snapshot, run.baseline.model, kind, params, start, {
    priorChanges: run.changes,
    sources,
  });
  if (!result.changes.length)
    return {
      answer:
        `A ${result.title.toLowerCase()} would not move any expected cash in these 13 weeks with these records. ${result.notes.join(" ")}`.trim(),
      proposal: null,
    };
  const used = Object.entries(result.params) as [ExternalParamName, number][];
  const bySource = (source: string) =>
    used.filter(([n]) => sources[n] === source).map(([n, v]) => paramPhrase(n, v));
  const yours = bySource("Your number");
  const estimated = bySource("AI estimate");
  const assumed = bySource("Assumption");
  const lines = [
    yours.length ? `Your numbers: ${yours.join(", ")}.` : "",
    estimated.length
      ? `AI estimate: ${estimated.join(", ")}, because ${ai?.reason.replace(/[.\s]+$/, "")}.`
      : "",
    assumed.length
      ? `Assumption: ${assumed.join(", ")} (stated defaults; give your own numbers to change them).`
      : "",
  ].filter(Boolean);
  const after = forecast(snapshot, run.baseline.model, [...run.changes, ...result.changes]);
  const before = run.forecast.lowPoint.usable;
  const delta = after.lowPoint.usable - before;
  const impact =
    delta === 0
      ? "The lowest usable cash stays the same; the timing of cash changes."
      : `The engine puts the lowest usable cash at ${compactMoney(after.lowPoint.usable)} (week of ${shortDate(after.lowPoint.weekStart)}), ${compactMoney(Math.abs(delta))} ${delta < 0 ? "lower" : "higher"} than now.`;
  const answer = [
    `Ready to model a ${result.title.toLowerCase()} from ${shortDate(start)}.`,
    ...lines,
    result.effects.length ? `Effects: ${result.effects.join("; ")}.` : "",
    impact,
    ...result.notes,
    "Domino effects run automatically once you confirm. Check the details below, then confirm.",
  ]
    .filter(Boolean)
    .join(" ");
  const headline = used.length ? `: ${used.map(([n, v]) => paramPhrase(n, v)).join(", ")}` : "";
  return {
    answer: answer.slice(0, 1_900),
    proposal: {
      label: `${result.title}${headline}`.slice(0, 200),
      changes: result.changes,
      constraints: null,
      constraintNote: null,
    },
  };
}

export function planRequest(
  run: WorkspaceRun,
  text: string,
  floor: string | null,
  estimate: MacroEstimate | null = null,
): PlanReply | null {
  return (
    prices(run, text, floor) ??
    hires(run, text, floor) ??
    layoffs(run, text, floor) ??
    spendChange(run, text, floor) ??
    externalEvent(run, text, floor, estimate) ??
    lostCustomer(run, text, floor)
  );
}

/**
 * Contagion: a customer who pays one invoice late tends to pay the next ones late too. For each
 * late invoice whose customer has later receipts in the horizon, add one delay_customer change
 * (placed first, starting the day after that invoice was expected, so it never moves the late
 * invoice itself). The slip is learned when the customer has enough history (their slowest 1 in
 * 10 payments versus their usual), otherwise assumed at half the late invoice's slip. Labelled.
 */
export function withContagion(run: WorkspaceRun, proposal: QuestionProposal): QuestionProposal {
  const snapshot = run.baseline.seed.snapshot;
  const { end } = horizon(run, null);
  const items = cashSchedule(snapshot, run.baseline.model, run.changes).items;
  const extra: Change[] = [];
  for (const c of proposal.changes) {
    if (c.kind !== "delay_invoice" || c.days < 7) continue;
    const target = items.find((i) => i.kind === "invoice" && i.id === c.invoiceId);
    const customerId = target?.customerId;
    if (
      !target ||
      !customerId ||
      extra.some((e) => "customerId" in e && e.customerId === customerId)
    )
      continue;
    const fromDate = addDays(target.date, 1);
    const later = items.some(
      (i) =>
        i.customerId === customerId &&
        i.amount > 0 &&
        (i.kind === "invoice" || i.kind === "deal" || i.kind === "plan") &&
        i.date >= fromDate &&
        i.date <= end,
    );
    if (!later || fromDate <= snapshot.asOf || fromDate > end) continue;
    const name = snapshot.customers.find((x) => x.id === customerId)?.name ?? customerId;
    const learned = run.baseline.model.customerDelayDays[customerId];
    const spread = learned && learned.samples >= 3 ? Math.round(learned.p90 - learned.mean) : 0;
    const days = spread >= 1 ? Math.min(spread, c.days) : Math.max(1, Math.round(c.days / 2));
    extra.push({
      kind: "delay_customer",
      customerId,
      days,
      fromDate,
      basis:
        spread >= 1
          ? `Learned: ${name}'s slowest 1 in 10 payments run ${spread} days later than usual`
          : `Assumption: ${name}'s later payments slip half as long (${days} days)`,
    });
  }
  return extra.length ? { ...proposal, changes: [...extra, ...proposal.changes] } : proposal;
}
