/** Keep structured import bookkeeping out of the main explanation. */
export function assumptionSummary(note: string): string {
  const trimmed = note.trim();
  if (!trimmed) return "No separate source note was saved.";
  if (!trimmed.startsWith("{") && !trimmed.startsWith("["))
    return trimmed.length > 240 ? `${trimmed.slice(0, 237)}...` : trimmed;
  try {
    const raw: unknown = JSON.parse(trimmed);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      return "Structured source details are saved under Technical details.";
    const value = raw as Record<string, unknown>;
    const short = (key: string) =>
      typeof value[key] === "string" && (value[key] as string).length <= 120
        ? (value[key] as string)
        : null;
    const label = short("label") ?? short("sourceLabel");
    const start = short("reportedPeriodStart") ?? short("periodStart");
    const end = short("reportedPeriodEnd") ?? short("periodEnd");
    const knowledge = short("knowledgeCutoff") ?? short("reportedAt");
    return (
      [
        label,
        start && end
          ? `Reported period ${start} to ${end}`
          : end
            ? `Reported through ${end}`
            : null,
        knowledge ? `Known as of ${knowledge}` : null,
      ]
        .filter(Boolean)
        .join(". ") || "Structured source details are saved under Technical details."
    );
  } catch {
    return "Structured source details are saved under Technical details.";
  }
}
