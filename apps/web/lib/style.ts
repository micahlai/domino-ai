import { useSyncExternalStore } from "react";
import {
  DEFAULT_STYLE,
  STYLE_STORAGE_KEY,
  type StyleId,
  parseStyle,
  resolveStyle,
} from "./style-registry";

// Client-only store. Server code (layout.tsx) imports style-registry.ts instead.
// The <html data-style> attribute is the single source of truth, so the selector, portals and
// canvas all read the same value and no React state needs to be lifted or remounted.
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const read = () => parseStyle(document.documentElement.dataset.style);

// Remembers an explicit choice for this page when storage is blocked, so a later client
// navigation does not resolve back to Original.
let chosen: StyleId | null = null;

function readStored(): string | null {
  try {
    return localStorage.getItem(STYLE_STORAGE_KEY) ?? chosen;
  } catch {
    return chosen;
  }
}

function apply(id: StyleId) {
  if (read() === id) return;
  document.documentElement.dataset.style = id;
  for (const listener of listeners) listener();
}

/** Re-derives the style from the current URL after a client navigation or back/forward. A removed
 * ?style= falls back to the stored choice. Touches only the attribute: nothing remounts. */
export function syncStyleFromSearch(search: string) {
  apply(resolveStyle(new URLSearchParams(search).get("style"), readStored()));
}

export function setStyle(id: StyleId) {
  chosen = id;
  apply(id);
  try {
    localStorage.setItem(STYLE_STORAGE_KEY, id);
  } catch {
    // Storage can be blocked; the choice still applies for this page.
  }
  const url = new URL(location.href);
  // Keep an existing review override in step so a reload does not undo the choice.
  if (url.searchParams.has("style")) {
    url.searchParams.set("style", id);
    history.replaceState(history.state, "", url);
  }
}

export function useStyle(): StyleId {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_STYLE);
}
