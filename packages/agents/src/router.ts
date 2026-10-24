import type { AgentBackend, AgentJob, Agents } from "@domino/contracts";
import { type FailureCategory, ProviderError } from "./errors";
import { isStructuredJob, outputSchemas } from "./schemas";
import type { JobInputs, JobOutputs, ProviderClients } from "./types";

const defaults: Record<AgentJob, AgentBackend> = {
  mapSource: "creao",
  readConstraints: "creao",
  proposeFixes: "claude",
  explain: "claude",
  weeklyBrief: "creao",
};

/** Empty env values use the spec default; a typo cannot silently change providers. */
export function backendFor(job: AgentJob, env: Record<string, string | undefined>): AgentBackend {
  const key = `AGENT_BACKEND_${job.toUpperCase()}`;
  const value = env[key]?.trim();
  if (!value) return defaults[job];
  if (value === "creao" || value === "claude") return value;
  throw new Error(`${key} must be creao or claude`);
}

/** One router attempt. Only enums and status codes: safe to log or store. */
export interface AttemptDiagnostic {
  job: AgentJob;
  backend: AgentBackend;
  /** 1-based across the whole job, including fallback attempts. */
  attempt: number;
  outcome: "ok" | "provider_error" | "invalid_output";
  category?: FailureCategory;
  httpStatus?: number;
}

export interface RouterOptions {
  onAttempt?: (diagnostic: AttemptDiagnostic) => void;
}

export class AgentJobError extends Error {
  constructor(
    public readonly job: AgentJob,
    public readonly attemptedBackends: readonly AgentBackend[],
    public readonly failures: readonly AttemptDiagnostic[] = [],
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
  options: RouterOptions = {},
) {
  function report(diagnostic: AttemptDiagnostic) {
    try {
      options.onAttempt?.(diagnostic);
    } catch {
      // A broken logger must not change routing.
    }
  }

  async function runJob<K extends AgentJob>(
    job: K,
    input: JobInputs[K],
  ): Promise<{ value: JobOutputs[K]; backend: AgentBackend }> {
    const primary = backendFor(job, env);
    const backends: AgentBackend[] = primary === "creao" ? ["creao", "claude"] : ["claude"];
    const attempted: AgentBackend[] = [];
    const failures: AttemptDiagnostic[] = [];

    for (const backend of backends) {
      for (let attempt = 0; attempt < 2; attempt++) {
        attempted.push(backend);
        const base = { job, backend, attempt: attempted.length };
        let raw: unknown;
        try {
          raw = await clients[backend].run(job, input);
        } catch (cause) {
          // Both malformed responses and transport failures count against the same bound.
          const failure: AttemptDiagnostic = { ...base, outcome: "provider_error" };
          if (cause instanceof ProviderError) {
            failure.category = cause.category;
            if (cause.httpStatus !== undefined) failure.httpStatus = cause.httpStatus;
          }
          failures.push(failure);
          report(failure);
          continue;
        }
        try {
          // Structured jobs may arrive as JSON text; text jobs stay plain text.
          const data = isStructuredJob(job) && typeof raw === "string" ? JSON.parse(raw) : raw;
          const value = outputSchemas[job].parse(data) as JobOutputs[K];
          report({ ...base, outcome: "ok" });
          return { value, backend };
        } catch {
          const failure: AttemptDiagnostic = { ...base, outcome: "invalid_output" };
          failures.push(failure);
          report(failure);
        }
      }
    }
    // Never include provider errors or inputs here: either may contain private data.
    throw new AgentJobError(job, attempted, failures);
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
