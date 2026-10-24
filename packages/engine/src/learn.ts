import {
  type CardTxn,
  type CompanyModel,
  CompanyModelSchema,
  type CustomerDelay,
  type Forecast,
  type Invoice,
  type LearnContext,
  LearnContextSchema,
  type LearnedRule,
  type LearningExample,
  type RecurringSpend,
  type Snapshot,
  SnapshotSchema,
} from "@domino/contracts";
import { daysBetween, toMs } from "./dates";
import { money } from "./dominoes";
import { forecast } from "./forecast";
import { assertBank, compare, mean, scoreWeeks, toPct } from "./grade";
import type { Ratio } from "./money";
import { isOrganicPayment } from "./schedule";

const MIN_SAMPLES = 3;

type LearnedDelay = { customerId: string; delay: CustomerDelay; invoices: Invoice[] };
type LearnedSpend = { spend: RecurringSpend; cards: CardTxn[] };
export type Candidate = { model: CompanyModel; delays: LearnedDelay[]; spends: LearnedSpend[] };

/**
 * Engine.learn. history (stored Forecast[]) is ignored: it lacks the origin snapshots and
 * bank windows needed to replay the current model, so it cannot be a fair baseline. Only
 * context.examples are replay evidence; without context the model comes back unchanged.
 * Acceptance means better retrospective fit on those origins, not proven future accuracy.
 */
export function learn(
  snapshot: Snapshot,
  model: CompanyModel,
  _history: Forecast[],
  context?: LearnContext,
): CompanyModel {
  if (!context) return model;
  const current = SnapshotSchema.parse(snapshot);
  const parsed = CompanyModelSchema.parse(model);
  const { examples } = LearnContextSchema.parse(context);
  // The cutoff gates every observation, so it must be a real calendar date.
  toMs(current.asOf);
  for (const example of examples) assertExample(example, current);
  const next = candidate(current, parsed);
  if (!next) return model;
  const before = replayErrors(examples, parsed);
  const after = replayErrors(examples, next.model);
  if (before.length === 0) return model;
  const errorBefore = mean(before);
  const errorAfter = mean(after);
  // Same weeks on both sides, so comparing means is comparing totals. Ties are rejected.
  if (compare(errorAfter, errorBefore) >= 0) return model;
  return accept(current, parsed, next, toPct(errorBefore), toPct(errorAfter), before.length);
}

function assertExample(example: LearningExample, current: Snapshot): void {
  const origin = example.snapshot;
  if (origin.companyId !== current.companyId) {
    throw new Error(
      `replay origin ${origin.asOf} is for company ${origin.companyId}, not ${current.companyId}`,
    );
  }
  // The bank window end must be known by now too, or replay would use future bank data.
  for (const date of [origin.asOf, example.asOf]) {
    toMs(date);
    if (date > current.asOf) {
      throw new Error(`replay example dated ${date} is after the current snapshot ${current.asOf}`);
    }
  }
  // Checked here, not only in replay, so bad evidence fails even when no candidate exists.
  assertBank(example.actualBank);
}

/** Completed example-weeks, each weighted equally. Origins with no closed week add nothing. */
function replayErrors(examples: LearningExample[], model: CompanyModel): Ratio[] {
  return examples.flatMap((example) =>
    scoreWeeks(forecast(example.snapshot, model, []), example.actualBank, {
      forecastAsOf: example.snapshot.asOf,
      asOf: example.asOf,
      bankWindowComplete: true,
    }).map((week) => week.error),
  );
}

/** One deterministic candidate from records observed by snapshot.asOf. null = nothing changes. */
export function candidate(snapshot: Snapshot, model: CompanyModel): Candidate | null {
  const delays = learnDelays(snapshot).filter(({ customerId, delay }) => {
    const old = model.customerDelayDays[customerId];
    return (
      !old || old.mean !== delay.mean || old.p90 !== delay.p90 || old.samples !== delay.samples
    );
  });
  const merged = mergeSpend(model.recurringSpend, learnSpends(snapshot));
  if (delays.length === 0 && merged.changed.length === 0) return null;
  const customerDelayDays = { ...model.customerDelayDays };
  for (const { customerId, delay } of delays) customerDelayDays[customerId] = delay;
  return {
    model: { ...model, customerDelayDays, recurringSpend: merged.list },
    delays,
    spends: merged.changed,
  };
}

/**
 * Signed days from due to paid (early stays negative) per customer, from paid invoices
 * observed by the cutoff. Fewer than MIN_SAMPLES leaves the customer alone. This is billing
 * payment timing, not a matched bank settlement.
 */
function learnDelays(snapshot: Snapshot): LearnedDelay[] {
  assertUniqueIds(snapshot.invoices, "invoice");
  const byCustomer = new Map<string, Invoice[]>();
  for (const inv of snapshot.invoices) {
    if (!isOrganicPayment(inv)) continue;
    [inv.issued, inv.due, inv.paid].forEach(toMs);
    if (inv.paid > snapshot.asOf || inv.issued > inv.paid) continue;
    byCustomer.set(inv.customerId, [...(byCustomer.get(inv.customerId) ?? []), inv]);
  }
  const learned: LearnedDelay[] = [];
  for (const [customerId, invoices] of [...byCustomer].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (invoices.length < MIN_SAMPLES) continue;
    const days = invoices.map((i) => daysBetween(i.due, i.paid ?? i.due)).sort((a, b) => a - b);
    const n = days.length;
    const delay = {
      mean: days.reduce((a, b) => a + b, 0) / n,
      // Nearest rank: the ceil(0.9 n)-th smallest.
      p90: days[Math.ceil(0.9 * n) - 1] ?? 0,
      samples: n,
    };
    learned.push({ customerId, delay, invoices });
  }
  return learned;
}

const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Conservative v1: at least MIN_SAMPLES card charges from one exact merchant, same positive
 * amount, strictly increasing dates and identical gaps. A merchant that is also a bill vendor
 * is skipped: we cannot prove the card charge and the bill are separate obligations.
 */
function learnSpends(snapshot: Snapshot): LearnedSpend[] {
  assertUniqueIds(snapshot.cardTxns, "card transaction");
  const vendors = new Set(snapshot.bills.map((b) => normalize(b.vendor)));
  const byMerchant = new Map<string, CardTxn[]>();
  for (const t of snapshot.cardTxns) {
    toMs(t.date);
    if (t.date > snapshot.asOf || t.merchant.trim() === "") continue;
    byMerchant.set(t.merchant, [...(byMerchant.get(t.merchant) ?? []), t]);
  }
  const learned: LearnedSpend[] = [];
  for (const [label, txns] of [...byMerchant].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (txns.length < MIN_SAMPLES || vendors.has(normalize(label))) continue;
    const cards = [...txns].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const amount = cards[0]?.amount ?? 0;
    const gaps = cards.slice(1).map((t, i) => daysBetween(cards[i]?.date ?? t.date, t.date));
    const everyDays = gaps[0] ?? 0;
    if (!Number.isSafeInteger(amount) || amount <= 0 || everyDays <= 0) continue;
    if (cards.some((t) => t.amount !== amount) || gaps.some((g) => g !== everyDays)) continue;
    learned.push({ spend: { label, amount, everyDays }, cards });
  }
  return learned;
}

/** Replace a unique exact label, skip ambiguous ones, append new merchants (already sorted). */
function mergeSpend(existing: RecurringSpend[], learned: LearnedSpend[]) {
  const list = [...existing];
  const changed: LearnedSpend[] = [];
  for (const item of learned) {
    const matches = list.flatMap((s, i) => (s.label === item.spend.label ? [i] : []));
    if (matches.length > 1) continue;
    const at = matches[0];
    if (at === undefined) list.push(item.spend);
    else {
      const old = list[at];
      if (old?.amount === item.spend.amount && old.everyDays === item.spend.everyDays) continue;
      list[at] = item.spend;
    }
    changed.push(item);
  }
  return { list, changed };
}

function assertUniqueIds(records: { id: string }[], kind: string): void {
  const seen = new Set<string>();
  for (const r of records) {
    if (seen.has(r.id))
      throw new Error(`duplicate ${kind} id ${r.id}: refusing to learn from it twice`);
    seen.add(r.id);
  }
}

/** Version goes up once; one factual rule per changed parameter, existing rules kept. */
function accept(
  snapshot: Snapshot,
  model: CompanyModel,
  next: Candidate,
  errorBefore: number,
  errorAfter: number,
  weeks: number,
): CompanyModel {
  const version = model.version + 1;
  const taken = new Set(model.rules.map((r) => r.id));
  const fit = `Retrospective fit on ${weeks} past weeks: forecast error went from ${errorBefore.toFixed(1)}% to ${errorAfter.toFixed(1)}% with all learned changes together. This is not a test on unseen weeks.`;
  const rule = (base: string, text: string, evidence: LearnedRule["evidence"]): LearnedRule => {
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    taken.add(id);
    return { id, text: `${text} ${fit}`, evidence, errorBefore, errorAfter };
  };
  const rules = [
    ...next.delays.map(({ customerId, delay, invoices }) => {
      const name = snapshot.customers.find((c) => c.id === customerId)?.name ?? customerId;
      const days = Math.abs(delay.mean).toFixed(1);
      return rule(
        `learned-v${version}-delay-${customerId}`,
        `${name} pays ${days} days ${delay.mean < 0 ? "before" : "after"} the due date on average (slowest 10%: ${delay.p90} days), from ${delay.samples} paid invoices.`,
        invoices.map((i) => ({
          source: "stripe" as const,
          ref: i.id,
          note: `Due ${i.due}, paid ${i.paid}`,
        })),
      );
    }),
    ...next.spends.map(({ spend, cards }) =>
      rule(
        `learned-v${version}-spend-${spend.label}`,
        `${spend.label} charges ${money(spend.amount)} every ${spend.everyDays} days (${cards.length} card charges). The forecast places the next charge ${spend.everyDays} days after the snapshot date, not after the last charge seen.`,
        cards.map((t) => ({
          source: "ramp" as const,
          ref: t.id,
          note: `${t.merchant} ${money(t.amount)} on ${t.date}`,
        })),
      ),
    ),
  ];
  return { ...next.model, version, rules: [...model.rules, ...rules] };
}
