import type { AgentBackend, AgentJob, Agents } from "@domino/contracts";

/** Placeholder. Built by prompt E7 (prompts/engine/E7-agents.md). */
const notBuilt = (name: string) => async () => {
  throw new Error(`agents.${name} is not built yet. Run prompt E7.`);
};

export const agents: Agents = {
  mapSource: notBuilt("mapSource"),
  readConstraints: notBuilt("readConstraints"),
  proposeFixes: notBuilt("proposeFixes"),
  explain: notBuilt("explain"),
  weeklyBrief: notBuilt("weeklyBrief"),
};

/** Reads AGENT_BACKEND_<JOB> to choose CREAO or Claude for each job. */
export function backendFor(job: AgentJob, env: Record<string, string | undefined>): AgentBackend {
  const value = env[`AGENT_BACKEND_${job.toUpperCase()}`];
  return value === "creao" ? "creao" : "claude";
}
