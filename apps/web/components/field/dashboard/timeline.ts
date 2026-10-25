import type { ProfileId } from "@domino/sim";

/**
 * Where the dashboard's timeline buttons go for each simulated company. The Timeline lane (/c/...)
 * only knows its own sample company today, which is not any of the Field picker companies, so
 * every entry is null and the dashboard shows a disabled button instead of a wrong link. Fill an
 * entry when the Timeline merge can open that company.
 */
const TIMELINE_ROUTES: Record<ProfileId, string | null> = {
  kestrel: null,
  "kestrel-churn": null,
  "kestrel-late": null,
  "kestrel-crunch": null,
};

export const TIMELINE_PENDING_TEXT = "Timeline opens after the Timeline merge";

/** The timeline link for the selected company, or null when the timeline cannot open it yet. */
export function timelineHref(profile: ProfileId): string | null {
  return TIMELINE_ROUTES[profile] ?? null;
}
