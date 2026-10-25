// Real vs simulated, per log row (pure). The judge sandbox labels every row with who did the
// work and whether a model was involved, read only from fields the backend wrote.

export type Provenance = {
  /** Who did it, in plain words: "Claude (AI model)", "Rules engine (no AI)". */
  who: string;
  /** True when the row describes simulated data, not real work. */
  simulated: boolean;
  /** True when a language model produced or was asked for this step. */
  ai: boolean;
};

type Row = { actor: string; agent?: string; agentKind?: string; action: string };

export function provenanceOf(row: Row): Provenance {
  const kind = row.agentKind;
  if (kind === "claude" || row.actor === "agent:claude")
    return { who: "Claude (AI model)", simulated: false, ai: true };
  if (kind === "creao" || row.actor === "agent:creao")
    return { who: "CREAO (AI agent)", simulated: false, ai: true };
  if (row.agent === "mock.feed" || row.action.startsWith("feed."))
    return { who: "Simulator", simulated: true, ai: false };
  if (row.actor === "person") return { who: "Person", simulated: false, ai: false };
  if (kind === "domino") return { who: "Domino code (no AI)", simulated: false, ai: false };
  if (kind === "system") return { who: "Scheduler (no AI)", simulated: false, ai: false };
  if (row.actor === "connector")
    return { who: "Connector code (no AI)", simulated: false, ai: false };
  return { who: "Rules engine (no AI)", simulated: false, ai: false };
}

/** "forecaster#8" -> "Forecaster 8"; other names pass through. */
export function agentLabel(name: string): string {
  const m = /^([a-z][a-z-]*)#(\d+)$/i.exec(name);
  if (!m) return name;
  const role = (m[1] as string).replaceAll("-", " ");
  return `${role.charAt(0).toUpperCase()}${role.slice(1)} ${m[2]}`;
}
