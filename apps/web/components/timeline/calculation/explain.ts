import {
  type Explain,
  type ExplainResult,
  type Fact,
  type RecordLookup,
  changeIds,
  describeChange,
  engineOnlyMap,
  fullDay,
  moneyOf,
  plural,
  readableLabel,
  readableResult,
} from "../../field/trace/explain-model";
import type { SavedBaseline } from "../baseline/api";
import { formatExactCents, formatSavedAt } from "../baseline/format";
import type { WorkspaceRun } from "../workspace/api";
import { floorReceipt } from "../workspace/summary";
import { assumptionSummary } from "./assumptions";

/** Names from the saved source books; ids never reach the main story. */
export function snapshotLookup(baseline: SavedBaseline): RecordLookup {
  const s = baseline.seed.snapshot;
  const customers = new Map(s.customers.map((c) => [c.id, c.name]));
  const invoices = new Map(s.invoices.map((i) => [i.id, i]));
  const bills = new Map(s.bills.map((b) => [b.id, b]));
  return {
    customer: (id) => customers.get(id) ?? null,
    invoice: (id) => {
      const inv = invoices.get(id);
      return inv
        ? { customer: customers.get(inv.customerId) ?? null, amount: inv.amount, due: inv.due }
        : null;
    },
    bill: (id) => {
      const bill = bills.get(id);
      return bill ? { vendor: bill.vendor, amount: bill.amount, due: bill.due } : null;
    },
  };
}

function rawResult(run: WorkspaceRun): ExplainResult {
  const floor = floorReceipt(run);
  const low = run.forecast.lowPoint;
  const facts: Fact[] = [];
  if (floor?.status === "breached") {
    if (floor.weekStart)
      facts.push({ text: `First below in the week of ${fullDay(floor.weekStart)}` });
    const short = floor.shortfall !== null ? moneyOf(floor.shortfall) : null;
    if (short) facts.push({ text: "Short by", money: short });
  }
  return {
    tone: floor?.status === "breached" ? "below" : floor?.status === "clear" ? "above" : "unknown",
    badge:
      floor?.status === "breached"
        ? "Falls below"
        : floor?.status === "clear"
          ? "Stays above"
          : floor
            ? "Minimum not checked"
            : "No minimum saved",
    low: moneyOf(low.usable),
    lowWeek: fullDay(low.weekStart),
    floor: floor ? moneyOf(floor.limit) : null,
    floorLabel: floor ? floor.label : "minimum",
    facts,
  };
}

function headline(run: WorkspaceRun, r: ExplainResult): string {
  const weeks = run.forecast.weeks.length;
  if (r.tone === "below" && r.floor) {
    const floor = floorReceipt(run);
    return `Cash falls below the ${r.floor.short} minimum${floor?.weekStart ? ` in the week of ${fullDay(floor.weekStart)}` : ""}`;
  }
  if (r.tone === "above" && r.floor)
    return `Cash stays above the ${r.floor.short} minimum for all ${plural(weeks, "week")}`;
  return `Lowest cash is ${r.low?.short ?? "unknown"} in the week of ${r.lowWeek ?? "unknown"}`;
}

/** Everything comes from the saved run and its saved baseline; nothing is recalculated. */
export function calculationExplain(
  run: WorkspaceRun,
  baseline: SavedBaseline,
  opts: { fromSuggestion?: boolean } = {},
): Explain {
  const lookup = snapshotLookup(baseline);
  const s = baseline.seed.snapshot;
  const weeks = run.forecast.weeks.length;
  const own = run.ownChanges.map((c) => describeChange(c, lookup));
  const r = readableResult(rawResult(run));
  const fallbackName =
    own[0]?.text ?? (run.kind === "baseline" ? "Starting plan" : "Saved scenario");
  const name = readableLabel(run.label, changeIds(run.changes), fallbackName);
  const inherited = run.changes.length - run.ownChanges.length;
  const change: Explain["change"] = own.length
    ? {
        tone: "change",
        headline:
          own.length === 1 ? (own[0]?.text ?? "") : `${plural(own.length, "change")} tested`,
        facts:
          own.length === 1
            ? own[0]?.money
              ? [{ text: own[0].amountLabel, money: own[0].money }]
              : []
            : own.slice(0, 3),
      }
    : run.kind === "rules"
      ? {
          tone: "change",
          headline: "The saved cash rules were revised",
          facts: run.constraintNote ? [{ text: run.constraintNote }] : [],
        }
      : { tone: "none", headline: "Nothing changed: this is the starting plan", facts: [] };
  if (own.length > 3) change.facts.push({ text: `+${own.length - 3} more in Details` });
  const counts = [
    s.customers.length ? plural(s.customers.length, "customer") : null,
    s.invoices.length ? plural(s.invoices.length, "invoice") : null,
    s.bills.length ? plural(s.bills.length, "bill") : null,
  ].filter((x): x is string => !!x);
  const source = assumptionSummary(baseline.assumptionNote);
  return {
    eyebrow: `Saved calculation · ${formatSavedAt(run.savedAt)}`,
    title: headline(run, r),
    subtitle: `${baseline.companyName} · ${name}`,
    data: {
      headline: `Books as of ${fullDay(s.asOf)}`,
      facts: [
        { text: `${weeks}-week forecast` },
        ...(counts.length ? [{ text: counts.join(" · ") }] : []),
        ...(moneyOf(s.cashOnHand) ? [{ text: "Cash on hand", money: moneyOf(s.cashOnHand) }] : []),
      ],
    },
    change,
    calc: {
      headline: `${plural(weeks, "week")} forecast · ${plural(run.receipts.length, "rule")} checked`,
      facts: [
        {
          text:
            run.changes.length === 0
              ? "No changes applied"
              : `${plural(run.changes.length, "change")} applied${inherited > 0 ? `, ${inherited} from earlier steps` : ""}`,
        },
        { text: "By the forecast engine" },
      ],
    },
    result: r,
    map: engineOnlyMap({
      booksLabel: `As of ${fullDay(s.asOf)}`,
      resultLabel: r.badge,
      resultTone: r.tone,
      origin: opts.fromSuggestion ? "Field suggestion" : null,
    }),
    limits: [],
    details: [
      {
        title: "Source",
        rows: [
          // A plain note is shown whole; a structured one gets its readable summary first.
          ...(/^\s*[[{]/.test(baseline.assumptionNote)
            ? [
                { label: "Source note", value: source },
                { label: "Full saved note", value: baseline.assumptionNote },
              ]
            : [{ label: "Source note", value: baseline.assumptionNote.trim() || source }]),
        ],
      },
      {
        title: "Changes",
        rows: run.changes.length
          ? run.changes.map((c, i) => {
              const f = describeChange(c, lookup);
              return {
                label: `${i + 1}. ${f.text}`,
                value: [f.money?.exact, JSON.stringify(c)].filter(Boolean).join(" · "),
              };
            })
          : [{ label: "Changes", value: "None" }],
      },
      {
        title: "Rule checks",
        rows: run.receipts.length
          ? run.receipts.map((x) => ({
              label: x.label,
              value: [
                x.status.replaceAll("_", " "),
                x.unit === "cents" && Number.isSafeInteger(x.limit)
                  ? `limit ${formatExactCents(x.limit)}`
                  : `limit ${x.limit} ${x.unit}`,
                x.value !== null && x.unit === "cents" && Number.isSafeInteger(x.value)
                  ? `value ${formatExactCents(x.value)}`
                  : null,
                x.weekStart ? `week of ${fullDay(x.weekStart)}` : null,
              ]
                .filter(Boolean)
                .join(" · "),
            }))
          : [{ label: "Rule checks", value: "None saved" }],
      },
      {
        title: "Exact values",
        rows: [
          ...(r.low
            ? [{ label: "Lowest usable cash", value: `${r.low.exact} (week of ${r.lowWeek})` }]
            : []),
          ...(r.floor ? [{ label: r.floorLabel, value: r.floor.exact }] : []),
        ],
      },
      {
        title: "Technical",
        rows: [
          { label: "Company ID", value: run.companyId },
          { label: "Run ID", value: run.runId },
          { label: "Baseline ID", value: run.baselineRunId },
          { label: "Parent ID", value: run.parentRunId ?? "none" },
          { label: "Input hash", value: run.inputHash },
          { label: "Method", value: run.methodVersion },
          { label: "Rule version", value: run.constraintVersion },
          { label: "Operation", value: `${run.operation.id} (${run.operation.status})` },
        ],
      },
    ],
  };
}
