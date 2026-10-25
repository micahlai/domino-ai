import type { Change } from "@domino/contracts";
import { type EventDraft, type EventKind, buildChange, emptyEvent } from "./drafts";

export type ComposerState = {
  draft: EventDraft;
  changes: Change[];
  label: string;
  confirmedFor: string | null;
  tried: boolean;
};

export function freshEvent(kind: EventKind, defaultDate: string): EventDraft {
  return {
    ...emptyEvent(kind),
    date: kind === "add_cash" || kind === "remove_cash" ? defaultDate : "",
  };
}

export function newComposer(): ComposerState {
  return { draft: emptyEvent(), changes: [], label: "", confirmedFor: null, tried: false };
}

export function composerPayload(state: ComposerState): string | null {
  return state.changes.length && state.label.trim()
    ? JSON.stringify([state.label.trim(), state.changes])
    : null;
}

export type ComposerAction =
  | { type: "edit"; patch: Partial<EventDraft> }
  | { type: "kind"; kind: EventKind; defaultDate: string }
  | { type: "suggestion"; draft: EventDraft }
  | { type: "add"; firstWeek: string; defaultDate: string }
  | { type: "remove"; index: number }
  | { type: "label"; label: string }
  | { type: "review"; checked: boolean }
  | { type: "discard" };

/** Chart context is deliberately absent: navigating weeks never edits a person's draft. */
export function composerReducer(state: ComposerState, action: ComposerAction): ComposerState {
  switch (action.type) {
    case "edit":
      return { ...state, draft: { ...state.draft, ...action.patch } };
    case "kind":
      return { ...state, draft: freshEvent(action.kind, action.defaultDate), tried: false };
    case "suggestion":
      return { ...state, draft: action.draft, tried: false };
    case "add": {
      const built = buildChange(state.draft, action.firstWeek);
      return built.ok
        ? {
            ...state,
            changes: [...state.changes, built.value],
            draft: freshEvent(state.draft.kind, action.defaultDate),
            tried: false,
          }
        : { ...state, tried: true };
    }
    case "remove":
      return { ...state, changes: state.changes.filter((_, i) => i !== action.index) };
    case "label":
      return { ...state, label: action.label };
    case "review":
      return { ...state, confirmedFor: action.checked ? composerPayload(state) : null };
    case "discard":
      return newComposer();
  }
}
