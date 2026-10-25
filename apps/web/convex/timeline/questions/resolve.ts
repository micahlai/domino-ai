import {
  type Change,
  ChangeSchema,
  type Constraint,
  ConstraintSchema,
  canonicalJson,
} from "@domino/contracts";
import { type CashSchedule, cashSchedule, forecastFromSchedule } from "@domino/engine/src/forecast";
import { bucketOf } from "@domino/engine/src/schedule";
import type { CashItem } from "@domino/engine/src/schedule";
import { z } from "zod";
import { type RecordRef, type WorkspaceRun, matchRecords, recordsOf } from "./context";
import type { Intent } from "./intent";
import { meaningIssue } from "./meaning";
import {
  addDays,
  formatCents,
  formatDate,
  mondayOf,
  parseDateText,
  parseDaysText,
  parseMoneyText,
  parseMonthsText,
} from "./parse";

// Answers are built only from the selected run's saved outputs and its seed's records.
// Every amount shown is a saved integer copied through formatCents; nothing is summed.

export type Citation = { ref: string; label: string };
export type QuestionProposal = {
  label: string;
  changes: Change[];
  constraints: Constraint[] | null;
  constraintNote: string | null;
};
export type Outcome =
  | { status: "answered"; answer: string; citations: Citation[] }
  | { status: "proposal"; answer: string; citations: Citation[]; proposal: QuestionProposal }
  | { status: "clarification"; answer: string; citations: Citation[] };

const MAX_DELAY_DAYS = 180;
const MAX_RUNWAY_MONTHS = 120;
const MAX_CONSTRAINTS = 32;
const MAX_CITATIONS = 12;

export type Ask = {
  questionId: string;
  prompt: string;
  selectedWeek: string | null;
  selectedItemId: string | null;
};

const clarify = (answer: string): Outcome => ({ status: "clarification", answer, citations: [] });
const weekRef = (w: string): Citation => ({
  ref: `forecast:week/${w}`,
  label: `Week of ${formatDate(w)}`,
});
const recordRef = (r: RecordRef): Citation => ({
  ref: `record:${r.kind}/${r.id}`,
  label: `${r.name} ${r.kind} ${r.id}`.slice(0, 200),
});

function horizon(run: WorkspaceRun) {
  const weeks = run.forecast.weeks;
  const first = weeks[0]?.weekStart ?? run.baseline.seed.asOf;
  const last = weeks[weeks.length - 1]?.weekStart ?? first;
  return { first, end: addDays(last, 6) };
}

function pickRecord(
  run: WorkspaceRun,
  phrase: string | null,
  selectedItemId: string | null,
  kinds: RecordRef["kind"][],
): RecordRef | string {
  const records = recordsOf(run).filter((r) => kinds.includes(r.kind));
  const text = phrase ?? selectedItemId;
  if (!text) return "Which record do you mean? Name the customer, vendor or invoice id.";
  const hits = matchRecords(text, records);
  if (hits.length === 0) return `I could not find "${text}" among this run's open records.`;
  if (hits.length > 1)
    return `"${text}" matches ${hits.length} records (${hits
      .slice(0, 4)
      .map((h) => h.id)
      .join(", ")}). Which one do you mean?`;
  return hits[0] as RecordRef;
}

// ---------- Evidence answers ----------

function answerLowPoint(run: WorkspaceRun): Outcome {
  const low = run.forecast.lowPoint;
  let answer = `Lowest usable cash in this run is ${formatCents(low.usable)}, in the week of ${formatDate(low.weekStart)}.`;
  if (run.comparison)
    answer += ` Compared with the parent run, the low point moves by ${formatCents(run.comparison.lowPointDelta)}.`;
  return { status: "answered", answer, citations: [weekRef(low.weekStart)] };
}

function verifiedSchedule(run: WorkspaceRun): CashSchedule | null {
  try {
    const schedule = cashSchedule(run.baseline.seed.snapshot, run.baseline.model, run.changes);
    return canonicalJson(forecastFromSchedule(run.baseline.seed.snapshot, schedule)) ===
      canonicalJson(run.forecast)
      ? schedule
      : null;
  } catch {
    return null;
  }
}

/** Evidence is reconstructed by the same pure schedule used for the saved forecast. */
function movementName(run: WorkspaceRun, item: CashItem): string {
  const record = recordsOf(run).find((r) => r.kind === item.kind && r.id === item.id);
  if (record) return `${record.name} ${record.kind} ${record.id}`.slice(0, 140);
  if (item.kind === "deal") {
    const deal = run.baseline.seed.snapshot.deals.find((d) => d.id === item.id);
    const customer = run.baseline.seed.snapshot.customers.find((c) => c.id === deal?.customerId);
    return `${customer?.name ?? "Signed deal"} ${item.id}`.slice(0, 140);
  }
  return `${item.kind === "recurring" ? "Recurring spend" : "Scenario event"} ${item.id}`.slice(
    0,
    140,
  );
}
function movementCitation(run: WorkspaceRun, item: CashItem): Citation {
  return {
    ref:
      item.kind === "change"
        ? `run:${run.runId}`
        : item.kind === "recurring"
          ? `model:${run.baseline.runId}`
          : `record:${item.kind}/${item.id}`,
    label: `${movementName(run, item).slice(0, 155)} (${item.date})`,
  };
}

function answerWeek(run: WorkspaceRun, intent: { weekText: string | null }, ask: Ask): Outcome {
  const { first } = horizon(run);
  const date = intent.weekText ? parseDateText(intent.weekText, first) : ask.selectedWeek;
  if (!date) return clarify("Which week do you mean? Give a date such as Nov 16, 2026.");
  const week = mondayOf(date);
  const f = run.forecast.weeks.find((w) => w.weekStart === week);
  if (f) {
    const schedule = verifiedSchedule(run);
    if (!schedule)
      return clarify(
        "I could not verify the effective cash movements against this saved forecast. The saved totals remain available in the timeline.",
      );
    const items = schedule.items.filter((item) => {
      const index = bucketOf(item.date, schedule.weeks);
      return index !== null && schedule.weeks[index] === week;
    });
    const parts = [
      `Week of ${formatDate(week)}: opens at ${formatCents(f.opening)}, ${formatCents(f.inflow)} in, ${formatCents(f.outflow)} out, closes at ${formatCents(f.closing)} (${formatCents(f.usable)} usable).`,
    ];
    if (items.length) {
      parts.push(
        `Effective cash movements in this run: ${items
          .slice(0, 6)
          .map(
            (item) =>
              `${movementName(run, item)}: ${formatCents(Math.abs(item.amount))} ${item.amount < 0 ? "out" : "in"} on ${formatDate(item.date)}`,
          )
          .join("; ")}.`,
      );
      if (items.length > 6)
        parts.push(`Showing 6 of ${items.length} movements; saved totals include all movements.`);
    } else parts.push("No cash movements are projected in this week.");
    const dominoes = run.dominoes.filter((d) => d.weekStart === week);
    if (dominoes.length)
      parts.push(
        `Problems this week: ${dominoes
          .slice(0, 2)
          .map((d) => d.label.slice(0, 100))
          .join("; ")}.`,
      );
    return {
      status: "answered",
      answer: parts.join(" "),
      citations: [
        weekRef(week),
        ...items.slice(0, 6).map((item) => movementCitation(run, item)),
      ].slice(0, MAX_CITATIONS),
    };
  }
  const h = run.baseline.history.find((w) => w.weekStart === week);
  if (h)
    return {
      status: "answered",
      answer: `Week of ${formatDate(week)} is observed history: it closed at ${formatCents(h.closing)} (${formatCents(h.usable)} usable).`,
      citations: [{ ref: `history:week/${week}`, label: `Observed week of ${formatDate(week)}` }],
    };
  return clarify(
    `The week of ${formatDate(week)} is outside this run's saved history and 13-week forecast.`,
  );
}

function answerItem(run: WorkspaceRun, intent: { itemText: string | null }, ask: Ask): Outcome {
  const records = recordsOf(run);
  const text = intent.itemText ?? ask.selectedItemId;
  if (!text) return clarify("Which item do you mean? Select one or name the customer or vendor.");
  // A selected scheduled item or record id is exact; names may match open records only.
  const hits = matchRecords(text, records);
  if (hits.length !== 1)
    return clarify(
      hits.length
        ? `"${text}" matches ${hits.length} records. Which one do you mean?`
        : `I could not find "${text}" in this run's records.`,
    );
  const r = hits[0] as RecordRef;
  const what = r.kind === "payroll" ? "Payroll run" : `${r.name.slice(0, 150)} ${r.kind}`;
  const when = r.kind === "payroll" ? "runs on" : "is due";
  let answer = `${what} ${r.id} for ${formatCents(r.amount)} ${when} ${formatDate(r.due)}`;
  answer += r.paid ? `, paid ${formatDate(r.paid)}.` : ", not paid yet.";
  const schedule = verifiedSchedule(run);
  if (!schedule)
    return clarify(
      "I could not verify this record’s effective cash movement against the saved forecast.",
    );
  const effective = schedule.items.filter((item) => item.kind === r.kind && item.id === r.id);
  if (!r.paid) {
    if (effective.length)
      answer += ` Effective projection in this run: ${effective
        .slice(0, 4)
        .map(
          (item) =>
            `${formatCents(Math.abs(item.amount))} ${item.amount < 0 ? "out" : "in"} on ${formatDate(item.date)}`,
        )
        .join("; ")}.`;
    else answer += " This run projects no remaining cash movement for this record.";
  }
  for (const c of run.changes.slice(0, 4)) {
    if (c.kind === "delay_invoice" && c.invoiceId === r.id)
      answer += ` This run moves it ${c.days} days later.`;
    if (c.kind === "lose_invoice" && c.invoiceId === r.id)
      answer += " This run assumes it is never paid.";
    if (c.kind === "delay_bill" && c.billId === r.id)
      answer += ` This run pays it ${c.days} days later.`;
  }
  const citations = [recordRef(r)];
  return { status: "answered", answer, citations };
}

function answerRules(run: WorkspaceRun): Outcome {
  if (run.receipts.length === 0)
    return {
      status: "answered",
      answer: "This run has no rules to check. Add one, for example a lender's minimum cash.",
      citations: [],
    };
  const lines = run.receipts.slice(0, 6).map((r) => {
    if (r.status === "breached") {
      const short =
        r.unit === "cents" && r.shortfall !== null ? `, short by ${formatCents(r.shortfall)}` : "";
      const at = r.date ? ` on ${formatDate(r.date)}` : "";
      return `${r.label.slice(0, 150)}: broken${at}${short}`;
    }
    if (r.status === "clear") return `${r.label.slice(0, 150)}: met`;
    if (r.status === "beyond_horizon")
      return `${r.label.slice(0, 150)}: falls after the 13-week forecast`;
    return `${r.label.slice(0, 150)}: cannot be checked with this data`;
  });
  return {
    status: "answered",
    answer: `${lines.join(". ")}.${run.receipts.length > 6 ? ` Showing 6 of ${run.receipts.length} rules; see the rules panel for all checks.` : ""}`,
    citations: run.receipts
      .slice(0, MAX_CITATIONS)
      .map((r) => ({ ref: `rule:${r.constraintId}`, label: r.label.slice(0, 200) })),
  };
}

function answerDominoes(run: WorkspaceRun): Outcome {
  if (run.dominoes.length === 0)
    return { status: "answered", answer: "This run shows no chain of problems.", citations: [] };
  const shown = [...run.dominoes].sort((a, b) => a.order - b.order).slice(0, 6);
  return {
    status: "answered",
    answer: shown
      .map((d) => `${d.order}. ${formatDate(d.weekStart)}: ${d.label.slice(0, 220)}`)
      .join(" "),
    citations: shown.map((d) => ({ ref: `domino:${d.order}`, label: d.label.slice(0, 200) })),
  };
}

// ---------- Proposals ----------

type Piece = {
  changes: Change[];
  constraints: Constraint[];
  labels: string[];
  citations: Citation[];
};

const ruleEvidence = (questionId: string) => ({
  source: "document" as const,
  ref: questionId,
  note: "Stated by the person in a question. Confirm before it is saved.",
});

function lateInvoice(
  run: WorkspaceRun,
  i: Extract<Intent, { kind: "late_invoice" }>,
  ask: Ask,
  missing: string[],
): Piece | string {
  const days = i.daysText ? parseDaysText(i.daysText) : null;
  if (days === null) missing.push("how many days late");
  else if (days < 1 || days > MAX_DELAY_DAYS)
    return `Pick a delay from 1 to ${MAX_DELAY_DAYS} days.`;
  const rec = pickRecord(run, i.itemText, ask.selectedItemId, ["invoice"]);
  if (typeof rec === "string") {
    if (!i.itemText && !ask.selectedItemId) missing.push("which invoice");
    else return rec;
    return { changes: [], constraints: [], labels: [], citations: [] };
  }
  if (rec.paid)
    return `Invoice ${rec.id} was already paid on ${formatDate(rec.paid)}; observed history cannot change.`;
  if (days === null) return { changes: [], constraints: [], labels: [], citations: [] };
  return {
    changes: [{ kind: "delay_invoice", invoiceId: rec.id, days }],
    constraints: [],
    labels: [`${rec.name} pays ${rec.id} ${days} days late`],
    citations: [recordRef(rec)],
  };
}

function cashChange(
  run: WorkspaceRun,
  i: Extract<Intent, { kind: "cash_change" }>,
  missing: string[],
): Piece | string {
  const { first, end } = horizon(run);
  const amount = i.amountText ? parseMoneyText(i.amountText) : null;
  const date = i.dateText ? parseDateText(i.dateText, first) : null;
  const who = i.counterpartyText?.trim() || null;
  if (i.amountText && amount === null)
    return `I could not read "${i.amountText}" as an exact amount in cents.`;
  if (i.dateText && date === null) return `I could not read "${i.dateText}" as a date.`;
  if (amount === null) missing.push("the amount");
  if (date === null) missing.push("the date");
  if (who === null) missing.push(i.direction === "out" ? "who is paid" : "who the cash comes from");
  if (amount === null || date === null || who === null)
    return { changes: [], constraints: [], labels: [], citations: [] };
  if (amount <= 0) return "The amount must be more than zero.";
  if (date < first)
    return `${formatDate(date)} is in observed history, which cannot change. Pick a date on or after ${formatDate(first)}.`;
  if (date > end)
    return `${formatDate(date)} is after this run's 13-week forecast, which ends ${formatDate(end)}.`;
  const label = i.direction === "out" ? `Payment to ${who}` : `Cash from ${who}`;
  const change: Change =
    i.direction === "out"
      ? { kind: "remove_cash", date, amount, label }
      : { kind: "add_cash", date, amount, label };
  return {
    changes: [change],
    constraints: [],
    labels: [`${label} of ${formatCents(amount)} on ${formatDate(date)}`],
    citations: [weekRef(mondayOf(date))],
  };
}

function rule(
  run: WorkspaceRun,
  i: Intent,
  ask: Ask,
  n: number,
  missing: string[],
): Piece | string {
  const id = `q_${ask.questionId
    .split("/")[1]
    ?.replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 80)}_${n}`;
  const evidence = ruleEvidence(ask.questionId);
  const none: Piece = { changes: [], constraints: [], labels: [], citations: [] };
  if (i.kind === "min_cash_rule") {
    const amount = i.amountText ? parseMoneyText(i.amountText) : null;
    if (i.amountText && amount === null)
      return `I could not read "${i.amountText}" as an exact amount.`;
    if (amount === null) {
      missing.push("the minimum usable cash amount");
      return none;
    }
    const label = `Keep usable cash above ${formatCents(amount)}`;
    return {
      changes: [],
      constraints: [{ id, label, kind: "min_cash", limit: amount, evidence }],
      labels: [label],
      citations: [],
    };
  }
  if (i.kind === "runway_rule") {
    const months = i.monthsText ? parseMonthsText(i.monthsText) : null;
    if (months === null) {
      missing.push("how many months of runway");
      return none;
    }
    if (months < 1 || months > MAX_RUNWAY_MONTHS)
      return `Pick a runway from 1 to ${MAX_RUNWAY_MONTHS} months.`;
    const label = `Keep at least ${months} months of runway`;
    return {
      changes: [],
      constraints: [{ id, label, kind: "min_runway_months", limit: months, evidence }],
      labels: [label],
      citations: [],
    };
  }
  if (i.kind === "pay_by_date_rule") {
    const days = i.daysText ? parseDaysText(i.daysText) : 0;
    if (days === null || days < 0 || days > MAX_DELAY_DAYS)
      return `Pick 0 to ${MAX_DELAY_DAYS} late days.`;
    const rec = pickRecord(run, i.itemText, ask.selectedItemId, ["bill"]);
    if (typeof rec === "string") {
      if (!i.itemText && !ask.selectedItemId) {
        missing.push("which bill");
        return none;
      }
      return rec;
    }
    if (rec.paid) return `Bill ${rec.id} was already paid on ${formatDate(rec.paid)}.`;
    const label =
      days === 0 ? `Pay ${rec.name} on time` : `Pay ${rec.name} within ${days} days of due`;
    return {
      changes: [],
      constraints: [{ id, label, kind: "pay_by_date", limit: days, billId: rec.id, evidence }],
      labels: [label],
      citations: [recordRef(rec)],
    };
  }
  return none;
}

const UNSUPPORTED: Record<string, string> = {
  daily_cash_floor:
    'Rules are checked on each week\'s closing usable cash, not day by day. Ask for a weekly minimum instead, for example "keep usable cash above $3M".',
  headcount_budget:
    "Headcount and hiring budgets are not a supported rule. Supported rules: minimum usable cash, months of runway, or paying a bill on time.",
  other:
    "That change is not supported here. You can ask about a late invoice, a one-time payment or receipt, or a rule.",
};

function propose(run: WorkspaceRun, intents: Intent[], ask: Ask): Outcome {
  const missing: string[] = [];
  const changes: Change[] = [];
  const added: Constraint[] = [];
  const labels: string[] = [];
  const citations: Citation[] = [];
  for (const [n, i] of intents.entries()) {
    let piece: Piece | string;
    if (i.kind === "late_invoice") piece = lateInvoice(run, i, ask, missing);
    else if (i.kind === "cash_change") piece = cashChange(run, i, missing);
    else piece = rule(run, i, ask, n + 1, missing);
    if (typeof piece === "string") return clarify(piece);
    changes.push(...piece.changes);
    added.push(...piece.constraints);
    labels.push(...piece.labels);
    citations.push(...piece.citations);
  }
  if (missing.length) return clarify(`Tell me ${joinWords(missing)}.`);
  const fresh = added.filter(
    (c) =>
      !run.constraints.some(
        (e) => e.kind === c.kind && e.limit === c.limit && e.billId === c.billId,
      ),
  );
  if (changes.length === 0 && fresh.length === 0)
    return clarify("That rule is already part of this run. Nothing would change.");
  const constraints = fresh.length ? [...run.constraints, ...fresh] : null;
  if (constraints && constraints.length > MAX_CONSTRAINTS)
    return clarify(`This run already has the most rules allowed (${MAX_CONSTRAINTS}).`);
  // Fail closed if anything built here is not a valid shared contract value.
  z.array(ChangeSchema).parse(changes);
  if (constraints) z.array(ConstraintSchema).parse(constraints);
  const label = labels.join("; ").slice(0, 200);
  const proposal: QuestionProposal = {
    label,
    changes,
    constraints,
    constraintNote: constraints
      ? `Rule added from the question: ${ask.prompt}`.slice(0, 500)
      : null,
  };
  return {
    status: "proposal",
    answer: `Proposed: ${label}. Nothing is calculated until you confirm and run it.`,
    citations: dedupe(citations).slice(0, MAX_CITATIONS),
    proposal,
  };
}

const joinWords = (w: string[]) =>
  w.length < 2 ? (w[0] ?? "") : `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}`;
const dedupe = (c: Citation[]) => {
  const seen = new Set<string>();
  return c.filter((x) => {
    const key = canonicalJson(x);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** One outcome for the intents, using only this run. */
export function resolve(run: WorkspaceRun, intents: Intent[], ask: Ask): Outcome {
  const issue = meaningIssue(ask.prompt, intents);
  if (issue) return clarify(issue);
  const unsupported = intents.find((i) => i.kind === "unsupported");
  if (unsupported?.kind === "unsupported") return clarify(UNSUPPORTED[unsupported.reason] ?? "");
  if (intents.some((i) => i.kind === "unclear"))
    return clarify(
      "I did not understand that. Ask about a week, an item, the low point or the rules, or describe one change.",
    );
  const questions = intents.filter((i) => i.kind === "question");
  if (questions.length && questions.length !== intents.length)
    return clarify("Ask a question or describe a change, one at a time.");
  if (questions.length > 1) return clarify("Ask one question at a time.");
  const q = questions[0];
  if (q?.kind === "question") {
    if (q.topic === "low_point") return answerLowPoint(run);
    if (q.topic === "week") return answerWeek(run, q, ask);
    if (q.topic === "item") return answerItem(run, q, ask);
    if (q.topic === "rules") return answerRules(run);
    return answerDominoes(run);
  }
  return propose(run, intents, ask);
}
