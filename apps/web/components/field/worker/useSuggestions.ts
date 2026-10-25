"use client";

import { type RequestForQueries, useMutation, useQueries } from "convex/react";
import { useCallback, useMemo, useState } from "react";
import type { DashboardView } from "../dashboard/derive";
import type { DecideSuggestion, SuggestionsState } from "./SuggestionsSection";
import {
  SUGGESTIONS_API,
  SUGGESTIONS_ENABLED,
  type Suggestion,
  applyDecision,
  decideArgs,
  demoSuggestions,
  isNotDeployed,
  toSuggestion,
} from "./suggestions";

/** Live suggestions (needs the Convex provider). useQueries returns a missing function as an
 * Error instead of throwing, so an undeployed backend shows the empty state, not a crash. */
export function useLiveSuggestions(companyId: string | null | undefined): {
  state: SuggestionsState;
  decide: DecideSuggestion;
} {
  const queries = useMemo(() => {
    const request: RequestForQueries = {};
    if (SUGGESTIONS_ENABLED && companyId)
      request.list = { query: SUGGESTIONS_API.list, args: { companyId } };
    return request;
  }, [companyId]);
  const result = useQueries(queries).list as unknown;
  const mutate = useMutation(SUGGESTIONS_API.decide);
  // Not optimistic: Convex applies the query update before the mutation resolves, so the card
  // moves to Decided as soon as the save lands, and a refused save keeps the card and its error.
  const decide = useCallback<DecideSuggestion>(
    async (suggestion, decision, note) => {
      if (!companyId) throw new Error("Select a company before recording a decision.");
      await mutate(decideArgs(companyId, suggestion, decision, note));
    },
    [mutate, companyId],
  );
  let state: SuggestionsState;
  if (!SUGGESTIONS_ENABLED) state = { kind: "off" };
  else if (result instanceof Error)
    state = isNotDeployed(result) ? { kind: "off" } : { kind: "error", message: result.message };
  else if (result === undefined) state = { kind: "loading" };
  else {
    const list = (Array.isArray(result) ? result : []).flatMap((raw) => {
      const s = toSuggestion(raw);
      return s ? [s] : [];
    });
    state = { kind: "ready", list };
  }
  return { state, decide };
}

/** Demo suggestions from the demo books; decisions stay in this tab only. */
export function useDemoSuggestions(
  view: DashboardView | null | undefined,
  /** The demo company; switching company starts from its own fresh suggestions. */
  scope: string,
): { state: SuggestionsState; decide: DecideSuggestion } {
  const key = `${scope}|${view?.asOf ?? ""}`;
  const [store, setStore] = useState<{ key: string; list: Suggestion[] } | null>(null);
  // Rebuilt only when the books change, so a decision is applied to the same list it was made on.
  const initial = useMemo(() => (view ? demoSuggestions(view) : []), [view]);
  const list = store?.key === key ? store.list : initial;
  const decide = useCallback<DecideSuggestion>(
    async (suggestion, decision, note) => {
      // Functional update: several quick decisions each build on the one before.
      setStore((prev) => ({
        key,
        list: applyDecision(prev?.key === key ? prev.list : initial, suggestion.id, decision, note),
      }));
    },
    [key, initial],
  );
  return { state: view === undefined ? { kind: "loading" } : { kind: "ready", list }, decide };
}
