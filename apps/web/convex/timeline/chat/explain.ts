import type { Change } from "@domino/contracts";
import { engine } from "@domino/engine";
import { cashSchedule } from "@domino/engine/src/forecast";
import { isOpenInvoice } from "@domino/engine/src/schedule";
import type { WorkspaceRun } from "../questions/context";
import {
  billName,
  compactMoney,
  customerName,
  friendlyLabel,
  invoiceName,
  shortDate,
} from "../recordNames";
import { scenarioStart } from "../scenarioStart";

/**
 * Plain, deterministic answers to free-form questions about a saved run. Every number is read
 * from the saved forecast or computed by the engine from the saved inputs; nothing is saved.
 */

const TYPOS: [RegExp, string][] = [
  [/\bwht\b|\bwaht\b|\bwhat's\b/gi, "what is"],
  [/\bteh\b/gi, "the"],
  [/\bwen\b|\bwehn\b/gi, "when"],
  [/\bhw\b|\bhwo\b/gi, "how"],
  [/\bwhy's\b|\bwhys\b|\bwy\b/gi, "why"],
  [/\bcahs\b|\bcsh\b/gi, "cash"],
  [/\blowst\b|\blowset\b|\bloweset\b/gi, "lowest"],
  [/\brunaway\b|\brunwya\b/gi, "runway"],
  [/\bcustmer\b|\bcustomr\b/gi, "customer"],
];

/** Fix common typos so "wht is teh lowest cash" reads as a question. Used only for routing. */
export function normalizeQuestion(text: string): string {
  let out = text;
  for (const [re, word] of TYPOS) out = out.replace(re, word);
  return out;
}

const money = compactMoney;
const day = (iso: string) => shortDate(iso);

function lowestAnswer(run: WorkspaceRun): string {
  const snapshot = run.baseline.seed.snapshot;
  const weeks = run.forecast.weeks;
  const low = run.forecast.lowPoint;
  const i = weeks.findIndex((w) => w.weekStart === low.weekStart);
  const week = weeks[i];
  if (!week) return `Cash is lowest in the week of ${day(low.weekStart)} at ${money(low.usable)}.`;
  const end = new Date(`${week.weekStart}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  const last = end.toISOString().slice(0, 10);
  let biggest = "";
  try {
    const items = cashSchedule(snapshot, run.baseline.model, run.changes)
      .items.filter((x) => x.amount < 0 && x.date >= week.weekStart && x.date <= last)
      .sort((a, b) => a.amount - b.amount)
      .slice(0, 2);
    const nameOf = (x: (typeof items)[number]) =>
      x.kind === "bill"
        ? billName(snapshot, x.id)
        : x.kind === "payroll"
          ? "payroll"
          : friendlyLabel(x.id, snapshot);
    if (items.length)
      biggest = ` The largest payments that week are ${items.map((x) => `${nameOf(x)} at ${money(-x.amount)}`).join(" and ")}.`;
  } catch {
    biggest = "";
  }
  const before = weeks[i - 1];
  const drop = before ? ` It falls from ${money(before.usable)} the week before:` : ":";
  return `Cash is lowest in the week of ${day(week.weekStart)} at ${money(low.usable)}.${drop} ${money(week.outflow)} goes out and ${money(week.inflow)} comes in that week.${biggest}`;
}

function runwayAnswer(run: WorkspaceRun): string {
  const weeks = run.forecast.weeks;
  const first = weeks[0];
  const last = weeks.at(-1);
  if (!first || !last) return "This forecast has no weeks to measure runway from.";
  const burn = (first.opening - last.closing) / weeks.length;
  if (burn <= 0)
    return `Cash grows over the next ${weeks.length} weeks, from ${money(first.opening)} to ${money(last.closing)}, so this forecast shows no runway limit.`;
  const months = last.closing / burn / 4.345;
  return `At the forecast's average burn of ${money(burn)} a week, cash of ${money(last.closing)} at the end of the 13 weeks lasts about ${months.toFixed(1)} more months. This is a straight-line estimate from the saved forecast.`;
}

function cashNowAnswer(run: WorkspaceRun): string {
  const snapshot = run.baseline.seed.snapshot;
  const first = run.forecast.weeks[0];
  return `Cash on hand is ${money(snapshot.cashOnHand)} as of ${day(snapshot.asOf)}.${first ? ` Usable cash closes the first forecast week at ${money(first.usable)}.` : ""}`;
}

/** Computed, not saved: what losing the largest customer's open invoices does to cash. */
function loseBiggestAnswer(run: WorkspaceRun): string {
  const snapshot = run.baseline.seed.snapshot;
  const totals = new Map<string, number>();
  for (const i of snapshot.invoices.filter((x) => isOpenInvoice(x)))
    totals.set(i.customerId, (totals.get(i.customerId) ?? 0) + i.amount);
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (!top)
    return "No customer has an open invoice in these books, so losing one does not change the 13-week forecast.";
  const [customerId, open] = top;
  const changes: Change[] = [
    ...run.changes,
    ...snapshot.invoices
      .filter((i) => isOpenInvoice(i) && i.customerId === customerId)
      .map((i) => ({ kind: "lose_invoice" as const, invoiceId: i.id })),
  ];
  const name = customerName(snapshot, customerId);
  try {
    const f = engine.forecast(snapshot, run.baseline.model, changes);
    const now = run.forecast.lowPoint;
    const endNow = run.forecast.weeks.at(-1)?.usable ?? 0;
    const endLost = f.weeks.at(-1)?.usable ?? 0;
    const low =
      f.lowPoint.usable < now.usable
        ? `lowest cash would fall to ${money(f.lowPoint.usable)} in the week of ${day(f.lowPoint.weekStart)}, from ${money(now.usable)}`
        : `the lowest point stays ${money(now.usable)} in the week of ${day(now.weekStart)}, because it comes before those invoices are due`;
    return `${name} is the largest customer by open invoices (${money(open)}). If it never paid them, ${low}, and cash at the end of the 13 weeks would be ${money(endNow - endLost)} lower for good (${money(endLost)} instead of ${money(endNow)}). To save a version of it, run the risk analysis or say "What if ${name} pays its invoice 30 days late".`;
  } catch {
    return `${name} is the largest customer by open invoices (${money(open)}). I could not compute its loss from these records.`;
  }
}

function describeRun(run: WorkspaceRun): string {
  const snapshot = run.baseline.seed.snapshot;
  const low = run.forecast.lowPoint;
  const lowText = `lowest cash is ${money(low.usable)} in the week of ${day(low.weekStart)}`;
  if (run.parentRunId === null || !run.ownChanges.length)
    return `This is the base forecast with no what-ifs: ${lowText}. Add a what-if, like "What if Northwind pays 30 days late", to compare.`;
  const what = run.ownChanges.map((c) => changeSummary(c, run)).join("; ");
  const start = scenarioStart(run.ownChanges, snapshot);
  const delta = run.comparison?.lowPointDelta;
  return `${friendlyLabel(run.label, snapshot)}: ${what}.${start ? ` It starts ${day(start)}.` : ""} With it, ${lowText}${delta ? `, ${delta > 0 ? "up" : "down"} ${money(Math.abs(delta))} from the scenario it was added to` : ""}.`;
}

function changeSummary(c: Change, run: WorkspaceRun): string {
  const s = run.baseline.seed.snapshot;
  switch (c.kind) {
    case "delay_invoice":
      return `the ${invoiceName(s, c.invoiceId)} is paid ${c.days} days late`;
    case "lose_invoice":
      return `the ${invoiceName(s, c.invoiceId)} is never paid`;
    case "discount_early_pay":
      return `the ${invoiceName(s, c.invoiceId)} is paid ${day(c.payOn)} at ${c.percent}% off`;
    case "delay_bill":
      return `the ${billName(s, c.billId)} is paid ${c.days} days later`;
    case "add_cash":
      return `${money(c.amount)} comes in ${day(c.date)} (${c.label})`;
    case "remove_cash":
      return `${money(c.amount)} goes out ${day(c.date)} (${c.label})`;
    case "churn":
      return `${customerName(s, c.customerId)} leaves from ${day(c.fromDate)}`;
    case "shift_hire":
      return `${c.label} moves from ${day(c.fromDate)} to ${day(c.toDate)}`;
    case "delay_customer":
      return `later payments from ${customerName(s, c.customerId)} slip ${c.days} days from ${day(c.fromDate)} (${c.basis})`;
    case "recurring_cash":
      return `${money(c.amount)} ${c.direction === "in" ? "comes in" : "goes out"} every ${c.everyDays} days from ${day(c.fromDate)} (${c.label})`;
    case "scale_recurring":
      return `${c.label} from ${day(c.fromDate)}`;
  }
}

export function explainQuestion(run: WorkspaceRun, raw: string): string {
  const text = normalizeQuestion(raw);
  const snapshot = run.baseline.seed.snapshot;
  if (/\b(lose|lost|losing|churn)\b.*\bcustomer|\bbiggest customer|\blargest customer/i.test(text))
    return loseBiggestAnswer(run);
  if (/\brunway\b|\bhow long\b.*\b(cash|money)\b|\brun out\b/i.test(text)) return runwayAnswer(run);
  if (
    /\b(lowest|low point|bottom|minimum|drop|drops|dropped|fall|falls|fell|dip|dips|decline)\b/i.test(
      text,
    )
  )
    return lowestAnswer(run);
  if (/\bhow much cash\b|\bcash (now|today|on hand)\b|\bbalance\b/i.test(text))
    return cashNowAnswer(run);
  if (/\b(converge|catch|snap|rejoin|merge|back to|same as|join)/i.test(text))
    return "A late payment only moves timing: once the invoice is paid, cash catches up and the line rejoins the one it left. Lost customers, hires, cost cuts and price changes act on every later bill or payroll run, so those lines keep bending away instead of rejoining.";
  if (/\b(start|starts|starting|begin|before|earlier|fork|diverge)\b/i.test(text)) {
    const start = scenarioStart(run.ownChanges, snapshot);
    return `Each scenario's line starts the week its own change first moves cash, and a scenario added on top of another never starts before the one under it.${start ? ` ${friendlyLabel(run.label, snapshot)} starts ${day(start)}.` : ""}`;
  }
  return describeRun(run);
}
