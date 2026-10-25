/** A saved option baseline carries its exact Field explanation link through later edits. */
export function fieldOriginHref(note: string): string | null {
  const prefix = "Field trace: ";
  const line = note.split(/\r?\n/).find((part) => part.startsWith(prefix));
  if (!line) return null;
  const href = line.slice(prefix.length).trim();
  if (!href.startsWith("/field/analysis?")) return null;
  try {
    const url = new URL(href, "https://domino.local");
    if (
      url.pathname !== "/field/analysis" ||
      !url.searchParams.get("companyId") ||
      !url.searchParams.get("runId") ||
      !url.searchParams.get("scenarioId") ||
      !url.searchParams.get("fixKind")
    )
      return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}
