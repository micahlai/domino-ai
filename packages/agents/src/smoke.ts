import type { AgentBackend, AgentJob } from "@domino/contracts";
import { fixtures } from "@domino/contracts/fixtures";
import { type ClaudeOptions, createClaudeClient } from "./claude";
import { type CreaoOptions, createCreaoClient } from "./creao";
import { type FailureCategory, ProviderError } from "./errors";
import type { TransportRuntime } from "./http";
import { isStructuredJob, outputSchemas } from "./schemas";
import type { JobInputs } from "./types";

/** Required so a stray test run can never spend credits. */
export const SMOKE_CONFIRMATION = "live-provider-call";

/** Synthetic inputs only: no customer data, safe to send to either provider. */
export const smokeInputs: { [K in AgentJob]: JobInputs[K] } = {
  mapSource: {
    apiDocs:
      "GET /v1/invoices returns {data: Invoice[]}. Invoice fields: id (string), customer (customer id), amount_due (integer US dollars), created (ISO date), due_date (ISO date), paid_at (ISO date or null).",
    samples: [
      {
        id: "in_syn_1",
        customer: "cus_syn_1",
        amount_due: 1200,
        created: "2026-10-01",
        due_date: "2026-10-31",
        paid_at: null,
      },
    ],
  },
  readConstraints: [
    {
      name: "synthetic-loan.txt",
      text: "Section 7.2. Borrower shall maintain Unrestricted Cash of not less than $3,000,000 at all times. Section 9.1. A breach of Section 7.2 is an Event of Default.",
    },
  ],
  proposeFixes: { branch: fixtures.branches[1]!, snapshot: fixtures.snapshot },
  explain: fixtures.branches[1]!,
  weeklyBrief: {
    grade: {
      errorPct: 4.2,
      misses: [
        {
          source: "nessie",
          ref: "txn_syn_1",
          note: "A customer payment arrived one week later than forecast.",
        },
      ],
    },
    model: fixtures.model,
  },
};

export interface SmokeReport {
  ok: boolean;
  job?: AgentJob;
  backend?: AgentBackend;
  reason?: "usage" | "provider_error" | "unexpected_error" | "invalid_output";
  category?: FailureCategory;
  httpStatus?: number;
  durationMs?: number;
  summary?: { items: number } | { characters: number };
  /** Validated synthetic output, only with SMOKE_PRINT_OUTPUT=1. Never raw provider text. */
  output?: unknown;
}

const jobs: AgentJob[] = ["mapSource", "readConstraints", "proposeFixes", "explain", "weeklyBrief"];

export interface SmokeOptions extends Partial<TransportRuntime> {
  claude?: Omit<ClaudeOptions, keyof TransportRuntime>;
  creao?: Omit<CreaoOptions, keyof TransportRuntime>;
}

/**
 * One explicit job on one explicit backend, called directly with no router: there is no
 * fallback, so a CREAO failure is reported as a CREAO failure, never a Claude success.
 */
export async function runSmoke(
  env: Record<string, string | undefined>,
  options: SmokeOptions = {},
): Promise<SmokeReport> {
  const job = jobs.find((name) => name === env.SMOKE_JOB?.trim());
  const backendName = env.SMOKE_BACKEND?.trim();
  const backend =
    backendName === "creao" || backendName === "claude" ? (backendName as AgentBackend) : undefined;
  if (!job || !backend || env.SMOKE_CONFIRM !== SMOKE_CONFIRMATION) {
    return { ok: false, reason: "usage" };
  }

  const runtime = { fetch: options.fetch, now: options.now, sleep: options.sleep };
  const client =
    backend === "creao"
      ? createCreaoClient(env, { ...options.creao, ...runtime })
      : createClaudeClient(env, { ...options.claude, ...runtime });
  const now = options.now ?? (() => Date.now());
  const started = now();
  const base = { job, backend };
  try {
    const value = await client.run(job, smokeInputs[job]);
    const durationMs = now() - started;
    const parsed = outputSchemas[job].safeParse(value);
    if (!parsed.success) return { ...base, ok: false, reason: "invalid_output", durationMs };
    const summary = isStructuredJob(job)
      ? { items: (parsed.data as unknown[]).length }
      : { characters: (parsed.data as string).length };
    return {
      ...base,
      ok: true,
      durationMs,
      summary,
      ...(env.SMOKE_PRINT_OUTPUT === "1" ? { output: parsed.data } : {}),
    };
  } catch (error) {
    const durationMs = now() - started;
    if (error instanceof ProviderError) {
      return {
        ...base,
        ok: false,
        reason: "provider_error",
        category: error.category,
        ...(error.httpStatus === undefined ? {} : { httpStatus: error.httpStatus }),
        durationMs,
      };
    }
    // Unknown errors may carry provider text; report only that one happened.
    return { ...base, ok: false, reason: "unexpected_error", durationMs };
  }
}
