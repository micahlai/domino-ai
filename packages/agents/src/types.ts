import type { AgentBackend, AgentJob, Agents } from "@domino/contracts";

/** Provider adapters own transport and response extraction. The router trusts neither. */
export interface ProviderClient {
  run(job: AgentJob, input: unknown): Promise<unknown>;
}

export type ProviderClients = Record<AgentBackend, ProviderClient>;
export type JobInputs = {
  mapSource: { apiDocs: string; samples: unknown[] };
  readConstraints: Parameters<Agents["readConstraints"]>[0];
  proposeFixes: {
    branch: Parameters<Agents["proposeFixes"]>[0];
    snapshot: Parameters<Agents["proposeFixes"]>[1];
  };
  explain: Parameters<Agents["explain"]>[0];
  weeklyBrief: Parameters<Agents["weeklyBrief"]>[0];
};
export type JobOutputs = {
  [K in AgentJob]: Awaited<ReturnType<Agents[K]>>;
};
