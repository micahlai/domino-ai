import type { AgentBackend, AgentJob } from "@domino/contracts";

/**
 * Every provider failure is reduced to one of these categories. Messages are built only
 * from the provider, job, category and HTTP status so they are safe to log: inputs,
 * credentials, URLs and response bodies never reach an error message.
 */
export const failureCategories = [
  "config",
  "invalid_input",
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
  "run_record_failed",
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

/** The five operational jobs plus the separate historical specialist entry point. */
export type ProviderJob = AgentJob | "historicalSpecialist";

export class ProviderError extends Error {
  constructor(
    public readonly provider: AgentBackend,
    public readonly job: ProviderJob,
    public readonly category: FailureCategory,
    public readonly httpStatus?: number,
    /** Short, sanitized provider error message (sanitizeErrorDetail); never in `message`. */
    public readonly detail?: string,
  ) {
    super(
      `${provider} ${job} failed: ${category}${httpStatus === undefined ? "" : ` (HTTP ${httpStatus})`}`,
    );
    this.name = "ProviderError";
  }
}

/** Binds provider and job so call sites only name the category. */
export function failer(provider: AgentBackend, job: ProviderJob) {
  return (category: FailureCategory, httpStatus?: number, detail?: string): ProviderError =>
    new ProviderError(provider, job, category, httpStatus, detail);
}

/**
 * A short, loggable reason from an error response body: the JSON error/message/detail field
 * (or the text), with URLs, bearer tokens and long key-like strings removed, at most 120 chars.
 */
export function sanitizeErrorDetail(body: string): string | undefined {
  let text = body;
  try {
    const json: unknown = JSON.parse(body);
    if (json && typeof json === "object") {
      const o = json as Record<string, unknown>;
      const pick = [o.error, o.message, o.detail, o.code].find(
        (v) => typeof v === "string" || (v && typeof v === "object"),
      );
      const inner =
        pick && typeof pick === "object"
          ? ((pick as Record<string, unknown>).message ?? (pick as Record<string, unknown>).code)
          : pick;
      if (typeof inner === "string") text = inner;
    }
  } catch {
    // Not JSON: use the text itself.
  }
  const clean = text
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/bearer\s+\S+/gi, "[token]")
    .replace(/[A-Za-z0-9_\-]{24,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return clean || undefined;
}
