import type { ReactNode } from "react";
import type { FieldFinding } from "../types";
import { FlagsSection } from "./FlagsSection";
import { RisksSection } from "./RisksSection";
import {
  type DecideSuggestion,
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
  risks: WatchedRisk[];
  risksLoading: boolean;
  timelineAction?: ReactNode;
  findings: FieldFinding[] | undefined;
  now: number;
}) {
  return (
    <div className="space-y-10">
      <SuggestionsSection
        state={suggestions}
        context={context}
        onDecide={onDecide}
        companyId={companyId}
      />
      <RisksSection rows={risks} loading={risksLoading} action={timelineAction} />
      <FlagsSection findings={findings} now={now} />
    </div>
  );
}
