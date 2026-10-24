import { ConstraintSchema, FieldMappingSchema, FixCandidateSchema } from "@domino/contracts";
import type { AgentBackend, AgentJob, Agents } from "@domino/contracts";
import { z } from "zod";

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

const defaults: Record<AgentJob, AgentBackend> = {
  mapSource: "creao",
  readConstraints: "creao",
  proposeFixes: "claude",
  explain: "claude",
  weeklyBrief: "creao",
};

const nonemptyText = z.string().trim().min(1);
const sentenceSegmenter = new Intl.Segmenter("en", { granularity: "sentence" });
const explanation = nonemptyText.refine(
  (value) =>
    [...sentenceSegmenter.segment(value)].filter((part) => part.segment.trim()).length <= 3,
  "explain must contain at most three sentences",
);

const outputSchemas = {
  mapSource: z.array(FieldMappingSchema),
  readConstraints: z.array(ConstraintSchema),
  proposeFixes: z.array(FixCandidateSchema),
  explain: explanation,
  weeklyBrief: nonemptyText,
};

/** Empty env values use the spec default; a typo cannot silently change providers. */
export function backendFor(job: AgentJob, env: Record<string, string | undefined>): AgentBackend {
  const key = `AGENT_BACKEND_${job.toUpperCase()}`;
  const value = env[key]?.trim();
  if (!value) return defaults[job];
  if (value === "creao" || value === "claude") return value;
  throw new Error(`${key} must be creao or claude`);
}

export class AgentJobError extends Error {
  constructor(
    public readonly job: AgentJob,
    public readonly attemptedBackends: readonly AgentBackend[],
  ) {
    super(
      `Agent job ${job} failed after ${attemptedBackends.length} attempts (${attemptedBackends.join(", ")})`,
    );
    this.name = "AgentJobError";
  }
}

/** Build the public Agents facade and a diagnostic call that identifies the backend. */
export function createAgentRouter(
  clients: ProviderClients,
  env: Record<string, string | undefined> = {},
) {
  async function runJob<K extends AgentJob>(
    job: K,
    input: JobInputs[K],
  ): Promise<{ value: JobOutputs[K]; backend: AgentBackend }> {
    const primary = backendFor(job, env);
    const backends: AgentBackend[] = primary === "creao" ? ["creao", "claude"] : ["claude"];
    const attempted: AgentBackend[] = [];

    for (const backend of backends) {
      for (let attempt = 0; attempt < 2; attempt++) {
        attempted.push(backend);
        try {
          const raw = await clients[backend].run(job, input);
          // Structured jobs may arrive as JSON text; text jobs stay plain text.
          const data =
            job !== "explain" && job !== "weeklyBrief" && typeof raw === "string"
              ? JSON.parse(raw)
              : raw;
          const value = outputSchemas[job].parse(data) as JobOutputs[K];
          return { value, backend };
        } catch {
          // Both malformed responses and transport failures count against the same bound.
        }
      }
    }
    // Never include provider errors or inputs here: either may contain private data.
    throw new AgentJobError(job, attempted);
  }

  const agents: Agents = {
    mapSource: async (apiDocs, samples) => (await runJob("mapSource", { apiDocs, samples })).value,
    readConstraints: async (documents) => (await runJob("readConstraints", documents)).value,
    proposeFixes: async (branch, snapshot) =>
      (await runJob("proposeFixes", { branch, snapshot })).value,
    explain: async (branch) => (await runJob("explain", branch)).value,
    weeklyBrief: async (input) => (await runJob("weeklyBrief", input)).value,
  };

  return { agents, runJob };
}
