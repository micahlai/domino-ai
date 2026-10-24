import type { AgentBackend, AgentJob } from "@domino/contracts";

/**
 * Every provider failure is reduced to one of these categories. Messages are built only
 * from the provider, job, category and HTTP status so they are safe to log: inputs,
 * credentials, URLs and response bodies never reach an error message.
 */
export const failureCategories = [
  "config",
  "input_too_large",
  "network",
  "timeout",
  "http_status",
  "redirect_rejected",
  "response_too_large",
  "malformed_response",
  "refusal",
  "truncated",
  "unexpected_stop",
  "run_failed",
  "run_cancelled",
  "unknown_status",
  "poll_limit",
  "deadline",
  "too_many_artifacts",
  "untrusted_artifact",
  "no_result",
  "ambiguous_result",
  "invalid_output",
] as const;
export type FailureCategory = (typeof failureCategories)[number];

export class ProviderError extends Error {
  constructor(
    public readonly provider: AgentBackend,
    public readonly job: AgentJob,
    public readonly category: FailureCategory,
    public readonly httpStatus?: number,
  ) {
    super(
      `${provider} ${job} failed: ${category}${httpStatus === undefined ? "" : ` (HTTP ${httpStatus})`}`,
    );
    this.name = "ProviderError";
  }
}

/** Binds provider and job so call sites only name the category. */
export function failer(provider: AgentBackend, job: AgentJob) {
  return (category: FailureCategory, httpStatus?: number): ProviderError =>
    new ProviderError(provider, job, category, httpStatus);
}
