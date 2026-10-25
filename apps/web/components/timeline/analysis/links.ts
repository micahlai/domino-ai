export function analysisHref(companyId: string, runId: string, analysisId?: string): string {
  const p = new URLSearchParams({ runId });
  if (analysisId) p.set("analysisId", analysisId);
  return `/c/${encodeURIComponent(companyId)}/timeline/analysis?${p.toString()}`;
}
