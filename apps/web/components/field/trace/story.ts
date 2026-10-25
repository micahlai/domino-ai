import type { FieldTrace } from "@/lib/field-trace-contract";
import { day, money } from "../worker/format";

export type TraceStory = {
  title: string;
  data: string;
  changed: string;
  checked: string;
  outcome: string;
};

/** All claims come from the exact receipt. Missing old evidence stays missing. */
export function traceStory(trace: FieldTrace): TraceStory {
  const scenario = trace.selection.scenarioId
    ? trace.scenarios.find((s) => s.id === trace.selection.scenarioId)
    : null;
  const candidate = trace.selection.fixKind
    ? trace.candidates.find(
        (c) =>
          c.scenarioId === trace.selection.scenarioId && c.fix.kind === trace.selection.fixKind,
      )
    : null;
  const source = trace.inputs;
  const data = source
    ? `${source.company.name}'s recorded books as of ${day(source.snapshot.asOf) ?? source.snapshot.asOf}. Cash on hand was ${money(source.snapshot.cashOnHand)} and restricted cash was ${money(source.snapshot.restrictedCash)}. ${source.sources.length} recorded source ${source.sources.length === 1 ? "check" : "checks"}.`
    : `A run was recorded as of ${day(trace.run.asOf) ?? trace.run.asOf}, but its pinned input books were not saved in this receipt.`;
  const changed = scenario
    ? `${scenario.title}. ${scenario.changes.length} recorded ${scenario.changes.length === 1 ? "change" : "changes"}. ${scenario.basis}`
    : `Started by ${trace.run.trigger}. No scenario was selected for this view.`;
  const checked = scenario?.work
    ? `The saved engine work checked ${scenario.work.weeks.length} forecast weeks and the cash rules. Lowest usable cash was ${money(scenario.work.low)}.`
    : trace.scenarios.some((s) => s.work)
      ? `The run recorded engine checks for ${trace.scenarios.filter((s) => s.work).length} scenarios. Choose a scenario to inspect its saved result.`
      : "No completed scenario calculation is saved for this selection.";
  const outcome = candidate
    ? `${candidate.fix.label} ${candidate.effect.survives ? "passed" : "did not pass"} the saved cash and payment checks. Lowest cash with the fix was ${money(candidate.effect.lowPoint)} in the week of ${day(candidate.effect.lowWeekStart) ?? candidate.effect.lowWeekStart}.${candidate.recommendation ? ` Saved advisor rationale: ${candidate.recommendation.text}` : " No advisor rationale was saved."}`
    : scenario?.work
      ? `${scenario.work.survives ? "The scenario passed" : "The scenario broke"} the saved checks.${scenario.work.breaksAt ? ` First break: ${day(scenario.work.breaksAt) ?? scenario.work.breaksAt}.` : ""}`
      : (trace.run.summary ?? "The run has no saved result for this selection.");
  return {
    title: candidate
      ? `Why ${candidate.fix.label}?`
      : scenario
        ? scenario.title
        : "How we got here",
    data,
    changed,
    checked,
    outcome,
  };
}
