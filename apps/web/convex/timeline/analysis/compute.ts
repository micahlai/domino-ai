import {
  type Branch,
  type Change,
  type FixCandidate,
  ResilienceReportSchema,
  type RiskEvent,
  RiskEventSchema,
  canonicalJson,
} from "@domino/contracts";
import { engine, rankFixes } from "@domino/engine";
import { cashSchedule } from "@domino/engine/src/forecast";
import type { WorkspaceRun } from "../questions/context";
import {
  addDays,
  checkChanges,
  checkEffects,
  checkMoneyBound,
  checkRowSize,
  reject,
} from "../workspaceInput";
import { ruleReceipts } from "../workspaceRules";
import { type AnalysisResponse, type AnalysisRisk, MAX_RISKS } from "./receipt";

export function checkSource(run: WorkspaceRun) {
  if (run.changes.length || run.kind === "scenario")
    reject(
      "ANCESTORS_UNSUPPORTED",
      "Automatic analysis currently starts from a baseline or a rule-only plan. Event ancestors are not supported yet.",
    );
  const s = run.baseline.seed.snapshot;
  const rows =
    s.customers.length +
    s.invoices.length +
    s.bills.length +
    s.payroll.length +
    s.deals.length +
    s.cardTxns.length +
    s.bankTxns.length;
  if (
    rows > 2000 ||
    s.invoices.filter((i) => !i.paid).length > 24 ||
    s.deals.length > 24 ||
    run.baseline.model.recurringSpend.length > 32 ||
    run.constraints.length > 32
  )
    reject(
      "BUDGET_EXCEEDED",
      "This analysis supports at most 2,000 records, 24 open invoices, 24 deals, 32 recurring costs and 32 rules.",
    );
  checkRowSize({ run });
  checkMoneyBound(s, run.baseline.model, run.constraints, []);
}
export function horizon(run: WorkspaceRun) {
  const weeks = run.forecast.weeks;
  return {
    asOf: run.baseline.seed.snapshot.asOf,
    firstWeek: weeks[0]?.weekStart ?? "",
    end: addDays(weeks[12]?.weekStart ?? "", 6),
  };
}
function check(run: WorkspaceRun, changes: Change[]) {
  if (changes.length === 0 || changes.length > 8)
    throw new Error("Scenario change budget exceeded");
  const s = run.baseline.seed.snapshot;
  const m = run.baseline.model;
  const h = horizon(run);
  checkChanges(changes, s, h);
  checkEffects(changes, s, m, h);
  checkMoneyBound(s, m, run.constraints, changes);
}
function safeForecast(run: WorkspaceRun, changes: Change[]) {
  check(run, changes);
  const f = engine.forecast(run.baseline.seed.snapshot, run.baseline.model, changes);
  for (const week of f.weeks)
    for (const n of [week.opening, week.inflow, week.outflow, week.closing, week.usable])
      if (!Number.isSafeInteger(n)) throw new Error("Unsafe forecast");
  return f;
}
export function candidates(run: WorkspaceRun): { risks: RiskEvent[]; warnings: string[] } {
  checkSource(run);
  const s = run.baseline.seed.snapshot;
  const m = run.baseline.model;
  const warnings: string[] = [];
  const raw = engine.scanRisks(s, m, run.constraints);
  if (!raw.length) {
    const h = horizon(run);
    const schedule = cashSchedule(s, m, []);
    const invoice = s.invoices
      .filter((i) => !i.paid)
      .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id))
      .find((i) =>
        schedule.items.some(
          (x) => x.kind === "invoice" && x.id === i.id && x.date > s.asOf && x.date <= h.end,
        ),
      );
    if (invoice) {
      const changes: Change[] = [{ kind: "delay_invoice", invoiceId: invoice.id, days: 14 }];
      const f = safeForecast(run, changes);
      raw.push({
        id: `assumed_late_${invoice.id}`,
        label: `Invoice ${invoice.id} is paid 14 additional days late`,
        probability: 0.1,
        impactLowPoint: run.forecast.lowPoint.usable - f.lowPoint.usable,
        changes,
        evidence: [
          {
            source: "stripe",
            ref: invoice.id,
            note: `Open invoice due ${invoice.due}; selected from the frozen source records`,
          },
          {
            source: "document",
            ref: "timeline:analysis-assumption",
            note: "Assumption: 14 additional days late with a 0.1 scenario weight. This is a stress assumption, not a learned payment delay or estimated chance.",
          },
        ],
      });
      warnings.push(
        "The neutral model supplied no risk candidates. A stated 14-day late-payment stress assumption was used without changing the saved model.",
      );
    }
  }
  const accepted: RiskEvent[] = [];
  for (const rawRisk of raw) {
    try {
      const risk = RiskEventSchema.parse({ ...rawRisk, evidence: rawRisk.evidence.slice(0, 100) });
      check(run, risk.changes);
      if (risk.label.length > 200 || risk.evidence.some((e) => e.note.length > 2000))
        throw new Error("Risk text budget");
      accepted.push(risk);
    } catch {
      warnings.push(
        `Risk ${rawRisk.id.slice(0, 120)} was skipped because its record, date, amount or effect is outside the supported analysis scope.`,
      );
    }
    if (accepted.length === MAX_RISKS) break;
  }
  if (!accepted.length)
    warnings.push(
      "No supported risk could be generated from these records. This is not evidence that the company has no risks.",
    );
  return { risks: accepted, warnings };
}
const receipts = (
  run: WorkspaceRun,
  forecast: AnalysisRisk["forecast"],
  changes: Change[],
  parent: { forecast: AnalysisRisk["forecast"]; changes: Change[] },
  ownChanges: Change[],
) =>
  ruleReceipts({
    snapshot: run.baseline.seed.snapshot,
    model: run.baseline.model,
    rules: run.constraints,
    versionOf: (c) =>
      run.receipts.find((r) => r.constraintId === c.id)?.constraintVersion ?? run.constraintVersion,
    plan: { forecast, changes },
    parent,
    ownChanges,
    horizonEnd: horizon(run).end,
  });
export function projectRisk(run: WorkspaceRun, risk: RiskEvent): AnalysisRisk {
  const forecast = safeForecast(run, risk.changes);
  const proof = receipts(
    run,
    forecast,
    risk.changes,
    { forecast: run.forecast, changes: [] },
    risk.changes,
  );
  const breach = proof
    .filter((r) => r.status === "breached")
    .sort((a, b) => (a.date ?? a.weekStart ?? "").localeCompare(b.date ?? b.weekStart ?? ""))[0];
  const negative = forecast.weeks.find((w) => w.usable < 0);
  const failureReason = breach
    ? `Rule "${breach.label}" is breached${breach.date ? ` on ${breach.date}` : ""}. See its saved rule receipt for the limit and computed result.`
    : negative
      ? `Usable cash is negative at the weekly close for ${negative.weekStart}. This cash warning is separate from the user's rules.`
      : null;
  return {
    id: risk.id,
    label: risk.label,
    probability: risk.probability,
    probabilityBasis:
      risk.evidence
        .filter((e) => /chance|assumption|paid invoices/i.test(e.note))
        .map((e) => e.note)
        .join(" ")
        .slice(0, 2000) ||
      "Engine evidence is provided; this is a scenario weight, not a calibrated probability.",
    evidence: risk.evidence,
    changes: risk.changes,
    runId: null,
    forecast,
    receipts: proof,
    failureReason,
  };
}
export function responsesFor(run: WorkspaceRun, risk: AnalysisRisk): AnalysisResponse[] {
  const s = run.baseline.seed.snapshot;
  const m = run.baseline.model;
  const schedule = cashSchedule(s, m, risk.changes);
  const h = horizon(run);
  const templates: FixCandidate[] = [];
  const invoice = s.invoices
    .filter((i) => !i.paid)
    .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id))
    .find((i) =>
      schedule.items.some(
        (x) => x.kind === "invoice" && x.id === i.id && x.amount > 0 && x.date > addDays(s.asOf, 1),
      ),
    );
  if (invoice)
    templates.push({
      id: `early_${risk.id}`,
      label: `Offer 2% for early payment of ${invoice.id}`,
      costNote: `Assumes the customer accepts a 2% discount on invoice ${invoice.id} for payment on ${addDays(s.asOf, 1)}. The engine reduces that invoice's proceeds by 2%, rounded to cents. This is a proposed negotiation.`,
      risk: "medium",
      evidence: [
        {
          source: "stripe",
          ref: invoice.id,
          note: `Unpaid invoice due ${invoice.due}; early payment and 2% discount are analysis assumptions, not agreed terms.`,
        },
      ],
      changes: [
        {
          kind: "discount_early_pay",
          invoiceId: invoice.id,
          percent: 2,
          payOn: addDays(s.asOf, 1),
        },
      ],
      targetRiskIds: [risk.id],
    });
  const bill = s.bills
    .filter((b) => !b.paid && !b.critical && b.due > s.asOf && b.due <= h.end)
    .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id))[0];
  if (bill)
    templates.push({
      id: `defer_${risk.id}`,
      label: `Request 14 more days to pay ${bill.id}`,
      costNote: `Assumes the vendor accepts a 14-day deferral of noncritical bill ${bill.id}. The full amount remains owed. No fee was supplied in the source records, so fees and vendor consent are unmodeled.`,
      risk: "medium",
      evidence: [
        {
          source: "books",
          ref: bill.id,
          note: `${bill.vendor}: unpaid noncritical bill due ${bill.due}; deferral is a negotiation assumption, not approval.`,
        },
      ],
      changes: [{ kind: "delay_bill", billId: bill.id, days: 14 }],
      targetRiskIds: [risk.id],
    });
  const parent: Branch = {
    id: risk.id,
    parentId: run.runId,
    kind: "event",
    label: risk.label,
    changes: risk.changes,
    forecast: risk.forecast,
    dominoes: [],
    status: "proposed",
    riskIds: [risk.id],
  };
  const scored = templates.flatMap((fix) => {
    try {
      check(run, [...risk.changes, ...fix.changes]);
      return [
        {
          fix,
          branch: engine.scoreFix(parent, fix, s, m, run.constraints, { ancestorChanges: [] }),
        },
      ];
    } catch {
      return [];
    }
  });
  return rankFixes(parent, scored, s, m, run.constraints, { ancestorChanges: [] })
    .slice(0, 2)
    .map(({ fix, branch, gain }) => {
      const proof = receipts(
        run,
        branch.forecast,
        [...risk.changes, ...fix.changes],
        { forecast: risk.forecast, changes: risk.changes },
        fix.changes,
      );
      if (!Number.isSafeInteger(gain)) throw new Error("Unsafe response gain");
      return {
        id: fix.id,
        riskId: risk.id,
        label: fix.label,
        costNote: fix.costNote,
        risk: fix.risk,
        evidence: fix.evidence,
        changes: fix.changes,
        runId: null,
        forecast: branch.forecast,
        receipts: proof,
        gainCents: gain,
        clearsAllRules: proof.every((r) => r.status === "clear"),
      };
    });
}
export function resilience(run: WorkspaceRun, risks: RiskEvent[]) {
  // Bound the aggregate as well as individual paths before invoking the engine's pair/all cases.
  checkMoneyBound(
    run.baseline.seed.snapshot,
    run.baseline.model,
    run.constraints,
    risks.flatMap((r) => r.changes),
  );
  const report = ResilienceReportSchema.parse(
    engine.stressTest(run.baseline.seed.snapshot, run.baseline.model, run.constraints, risks, []),
  );
  if (report.universes.length > 8) throw new Error("Universe budget exceeded");
  return {
    weightedScenarioIndex: report.survivalRate,
    survivedCount: report.survivedCount,
    scenarioCount: report.universes.length,
    scope:
      "Weighted index over overlapping hypothetical scenarios, not a probability of survival. Uses only the frozen min-cash and payment-deadline rules in 13 weeks; runway and unknown or outside-horizon results do not decide survival. With no applicable rules, every scenario can count as surviving even when cash is negative. No responses are applied to this index.",
  };
}
export function sameForecast(a: unknown, b: unknown) {
  return canonicalJson(a) === canonicalJson(b);
}
