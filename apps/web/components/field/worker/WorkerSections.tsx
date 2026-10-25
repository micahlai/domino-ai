import type { ReactNode } from "react";
import type { FieldFinding } from "../types";
import { FlagsSection } from "./FlagsSection";
import { RisksSection } from "./RisksSection";
import {
  type DecideSuggestion,
  type SimulateSuggestion,
  SuggestionsSection,
  type SuggestionsState,
} from "./SuggestionsSection";
import type { WatchedRisk } from "./risks";
import type { EffectContext } from "./suggestions";

/** The three sections, always in this order. Pure, so the order and empty states are testable. */
export function WorkerSections({
  companyId,
  suggestions,
  context,
  onDecide,
  onSimulate,
  risks,
  risksLoading,
  timelineAction,
  findings,
  now,
}: {
  companyId?: string | null;
  suggestions: SuggestionsState;
  context: EffectContext;
  onDecide: DecideSuggestion;
  onSimulate?: SimulateSuggestion;
  risks: WatchedRisk[];
  risksLoading: boolean;
  timelineAction?: ReactNode;
  findings: FieldFinding[] | undefined;
  now: number;
}) {
  const fixScenarios = new Set(
    suggestions.kind === "ready"
      ? suggestions.list.flatMap((s) => (s.status === "open" && s.scenarioId ? [s.scenarioId] : []))
      : [],
  );
  const riskIds = new Set(risks.map((r) => r.id));
  return (
    <div className="space-y-10">
      <SuggestionsSection
        state={suggestions}
        context={context}
        onDecide={onDecide}
        onSimulate={onSimulate}
        companyId={companyId}
        riskIds={riskIds}
      />
      <RisksSection
        rows={risks}
        loading={risksLoading}
        action={timelineAction}
        fixScenarios={fixScenarios}
      />
      <FlagsSection findings={findings} now={now} />
    </div>
  );
}
