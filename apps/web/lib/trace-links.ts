export function fieldTraceHref(key: {
  companyId: string;
  runId: string;
  scenarioId?: string | null;
  fixKind?: string | null;
}): string {
  const params = new URLSearchParams({ companyId: key.companyId, runId: key.runId });
  if (key.scenarioId) params.set("scenarioId", key.scenarioId);
  if (key.fixKind) params.set("fixKind", key.fixKind);
  return `/field/analysis?${params}`;
}

export function timelineCalculationHref(companyId: string, runId: string): string {
  return `/c/${encodeURIComponent(companyId)}/timeline/calculation?${new URLSearchParams({ runId })}`;
}
