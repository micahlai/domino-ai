/** Explicit entry intent names only the saved scenario opened by this link. */
export function openedTimelineHref(companyId: string, runId: string): string {
  return `/c/${encodeURIComponent(companyId)}/timeline?${new URLSearchParams({ runId, reveal: runId })}`;
}
export function workerTimelineHref(
  companyId: string,
  runId: string,
  conversationId: string,
): string {
  return `${openedTimelineHref(companyId, runId)}&${new URLSearchParams({ conversationId })}#timeline-chat`;
}
export function hasEntryReveal(search: string, runId: string): boolean {
  const params = new URLSearchParams(search);
  return (
    params.getAll("reveal").length === 1 &&
    params.get("reveal") === runId &&
    params.getAll("runId").length === 1 &&
    params.get("runId") === runId
  );
}
/** Preserve the current pathname, other pinned context and fragment when consuming the intent. */
export function withoutEntryReveal(href: string, runId: string): string {
  const url = new URL(href, "http://timeline.local");
  if (!hasEntryReveal(url.search, runId)) return `${url.pathname}${url.search}${url.hash}`;
  url.searchParams.delete("reveal");
  return `${url.pathname}${url.search}${url.hash}`;
}
