import { useSyncExternalStore } from "react";

/** Registry of selectable looks. Order is the selector order; the first is the default. */
export const STYLES = [
  { id: "original", label: "Original" },
  { id: "ramp", label: "Ramp" },
  { id: "hyphenate", label: "Hyphenate" },
  { id: "shadcn", label: "shadcn" },
] as const;

export type StyleId = (typeof STYLES)[number]["id"];
export const DEFAULT_STYLE: StyleId = "original";
export const STYLE_STORAGE_KEY = "domino-style";
const ids: readonly string[] = STYLES.map((style) => style.id);

/** Anything that is not an exact registry id (null, "RAMP", "ramp ", markup) becomes Original. */
export function parseStyle(value: unknown): StyleId {
  return typeof value === "string" && ids.includes(value) ? (value as StyleId) : DEFAULT_STYLE;
}

/** A valid ?style= link wins over the stored choice, so review links are reproducible. It is
 * not written to storage; only an explicit selection is. */
export function resolveStyle(urlValue: string | null, stored: string | null): StyleId {
  return urlValue !== null && ids.includes(urlValue) ? (urlValue as StyleId) : parseStyle(stored);
}

/** Runs before first paint so there is no wrong-theme flash. Built from the registry, so the
 * allow-list lives in one place. Only a registry id is ever written to the page. */
export const styleInitScript = `(function(){try{var ids=${JSON.stringify(ids)};var u=new URLSearchParams(location.search).get("style");var s=localStorage.getItem(${JSON.stringify(STYLE_STORAGE_KEY)});var v=ids.indexOf(u)>-1?u:ids.indexOf(s)>-1?s:${JSON.stringify(DEFAULT_STYLE)};document.documentElement.dataset.style=v}catch(e){document.documentElement.dataset.style=${JSON.stringify(DEFAULT_STYLE)}}})()`;

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
// The <html data-style> attribute is the single source of truth, so the selector, portals and
// canvas all read the same value and no React state needs to be lifted or remounted.
const read = () => parseStyle(document.documentElement.dataset.style);

export function setStyle(id: StyleId) {
  document.documentElement.dataset.style = id;
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
  for (const listener of listeners) listener();
}

export function useStyle(): StyleId {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_STYLE);
}
