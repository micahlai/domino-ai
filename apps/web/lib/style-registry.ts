// Pure and React-free on purpose: the server layout imports this for the pre-paint script, so
// it must never pull in a client-only API. The client store lives in style.ts.

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

/** A ?style= param that is present decides alone: a valid id wins, an invalid one means Original
 * even if a choice is stored, so a bad review link is never silently themed. Only an absent
 * param falls back to the stored choice. The URL value is never written to storage. */
export function resolveStyle(urlValue: string | null, stored: string | null): StyleId {
  return parseStyle(urlValue !== null ? urlValue : stored);
}

/** Runs before first paint so there is no wrong-theme flash. Same rules as resolveStyle, built
 * from the registry so the allow-list lives in one place. The URL is read before storage, and
 * storage is only touched when the param is absent, so blocked storage cannot break a valid link. */
export const styleInitScript = `(function(){var ids=${JSON.stringify(ids)},v=${JSON.stringify(DEFAULT_STYLE)};try{var u=new URLSearchParams(location.search).get("style");if(u===null){try{u=localStorage.getItem(${JSON.stringify(STYLE_STORAGE_KEY)})}catch(e){}}if(ids.indexOf(u)>-1)v=u}catch(e){}document.documentElement.dataset.style=v})()`;
