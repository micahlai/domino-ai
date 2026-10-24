import type { AgentJob } from "@domino/contracts";
import { z } from "zod";
import { type FailureCategory, ProviderError, failer } from "./errors";
import { scanChatText, selectOne } from "./extract";
import {
  type BoundedResponse,
  type TransportRuntime,
  boundedFetch,
  byteLength,
  isSafeRedirectTarget,
  runtimeFrom,
} from "./http";
import { RESULT_END, RESULT_START, buildCreaoPrompt } from "./prompts";
import type { ProviderClient } from "./types";

/** The chat API family only. Developer-console /v2 keys and agents are a different product. */
export const CREAO_API_BASE_URL = "https://agent.creao.ai/api/v1";

/** First name is the README convention; the alias is the spec's name. Both set must agree. */
export const creaoAgentEnv: Partial<Record<AgentJob, readonly string[]>> = {
  mapSource: ["CREAO_AGENT_ID_MAPSOURCE", "CREAO_AGENT_ID_MAP"],
  readConstraints: ["CREAO_AGENT_ID_CONSTRAINTS"],
  weeklyBrief: ["CREAO_AGENT_ID_BRIEF"],
};

export interface CreaoOptions extends Partial<TransportRuntime> {
  /** Per HTTP request, capped by what remains of the run deadline. */
  requestTimeoutMs?: number;
  /** Whole run: create, polls and artifact downloads. */
  runDeadlineMs?: number;
  pollIntervalMs?: number;
  maxPolls?: number;
  maxPromptBytes?: number;
  maxResponseBytes?: number;
  maxArtifactBytes?: number;
  maxArtifacts?: number;
  maxRedirects?: number;
  /**
   * Opt-in format diagnostics, called once per run. Receives only fixed enums, booleans
   * and counts, never provider text, URLs, ids or errors. A throwing callback is ignored.
   */
  diagnostics?: (diagnostics: CreaoDiagnostics) => void;
}

export const creaoDiagnosticStages = [
  "config",
  "create",
  "poll",
  "extract",
  "select",
  "done",
] as const;
export type CreaoDiagnosticStage = (typeof creaoDiagnosticStages)[number];
export const artifactCategories = ["json", "markdown", "text", "other", "missing"] as const;
export type ArtifactCategory = (typeof artifactCategories)[number];

export interface CreaoDiagnostics {
  job: AgentJob;
  /** Last stage reached; "done" only when a validated result was returned. */
  stage: CreaoDiagnosticStage;
  failure?: FailureCategory | "unexpected";
  resultPresent: boolean;
  chatTextPresent: boolean;
  chatTextLength: number;
  resultStartMarker: boolean;
  resultEndMarker: boolean;
  delimitedBlocks: number;
  malformedDelimited: number;
  fences: number;
  wholeJson: boolean;
  /** JSON candidates that are objects with a result or text key. */
  envelopes: number;
  /** Artifacts by declared MIME type category. */
  artifacts: Record<ArtifactCategory, number>;
  jsonArtifacts: number;
  jsonArtifactsParsed: number;
  candidates: number;
  validated: number;
  distinct: number;
}

export const creaoDefaults = {
  requestTimeoutMs: 20_000,
  runDeadlineMs: 150_000,
  pollIntervalMs: 3_000,
  maxPolls: 45,
  maxPromptBytes: 256 * 1024,
  maxResponseBytes: 1024 * 1024,
  maxArtifactBytes: 1024 * 1024,
  maxArtifacts: 4,
  maxRedirects: 3,
};

const pendingStatuses = new Set([
  "pending",
  "queued",
  "running",
  "in_progress",
  "processing",
  "started",
  "starting",
]);

const createdRunSchema = z
  .object({ id: z.string().min(1).max(256), status: z.string() })
  .passthrough();
const artifactSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().nullish(),
    type: z.string().nullish(),
    url: z.string().min(1),
  })
  .passthrough();
const runResultSchema = z
  .object({
    // result.text is CREAO's memory summary, not job output. It is deliberately unused.
    chatText: z.string().nullish(),
    artifacts: z.array(artifactSchema).nullish(),
  })
  .passthrough();
const polledRunSchema = z
  .object({ id: z.string().optional(), status: z.string(), result: runResultSchema.nullish() })
  .passthrough();
type Artifact = z.infer<typeof artifactSchema>;

function artifactCategory(type: string | null | undefined): ArtifactCategory {
  if (!type?.trim()) return "missing";
  if (/json/i.test(type)) return "json";
  if (/markdown/i.test(type)) return "markdown";
  if (/^\s*text\//i.test(type)) return "text";
  return "other";
}

function emptyDiagnostics(job: AgentJob): CreaoDiagnostics {
  return {
    job,
    stage: "config",
    resultPresent: false,
    chatTextPresent: false,
    chatTextLength: 0,
    resultStartMarker: false,
    resultEndMarker: false,
    delimitedBlocks: 0,
    malformedDelimited: 0,
    fences: 0,
    wholeJson: false,
    envelopes: 0,
    artifacts: { json: 0, markdown: 0, text: 0, other: 0, missing: 0 },
    jsonArtifacts: 0,
    jsonArtifactsParsed: 0,
    candidates: 0,
    validated: 0,
    distinct: 0,
  };
}

/** Diagnostics must never change a provider result, so every callback failure is dropped. */
function report(callback: CreaoOptions["diagnostics"], diagnostics: CreaoDiagnostics) {
  if (!callback) return;
  try {
    const returned: unknown = callback(diagnostics);
    if (returned instanceof Promise) returned.catch(() => undefined);
  } catch {
    // Ignored by design.
  }
}

function isEnvelope(json: unknown): boolean {
  return (
    typeof json === "object" &&
    json !== null &&
    !Array.isArray(json) &&
    (Object.hasOwn(json, "result") || Object.hasOwn(json, "text"))
  );
}

function isJsonArtifact(artifact: Artifact): boolean {
  return /json/i.test(artifact.type ?? "") || /\.json$/i.test(artifact.title ?? "");
}

function agentIdFor(job: AgentJob, env: Record<string, string | undefined>): string | undefined {
  const values = new Set(
    (creaoAgentEnv[job] ?? []).map((key) => env[key]?.trim()).filter((value) => !!value),
  );
  return values.size === 1 ? [...values][0] : undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * CREAO chat API transport: create a run, poll it to a terminal status, then extract one
 * contract-valid answer from chat text or JSON artifacts. No hidden create retries: the
 * router owns retry and fallback.
 */
export function createCreaoClient(
  env: Record<string, string | undefined>,
  options: CreaoOptions = {},
): ProviderClient {
  const runtime = runtimeFrom(options);
  const bounds = { ...creaoDefaults, ...definedOnly(options) };

  return {
    async run(job, input) {
      const diagnostics = emptyDiagnostics(job);
      try {
        const value = await attempt(job, input, diagnostics);
        diagnostics.stage = "done";
        return value;
      } catch (error) {
        diagnostics.failure = error instanceof ProviderError ? error.category : "unexpected";
        throw error;
      } finally {
        report(options.diagnostics, diagnostics);
      }
    },
  };

  async function attempt(job: AgentJob, input: unknown, diag: CreaoDiagnostics) {
    const fail = failer("creao", job);
    const apiKey = env.CREAO_API_KEY?.trim();
    const base = (env.CREAO_API_BASE_URL?.trim() || CREAO_API_BASE_URL).replace(/\/+$/, "");
    const agentId = agentIdFor(job, env);
    if (!apiKey || base !== CREAO_API_BASE_URL || !agentId) throw fail("config");

    const body = JSON.stringify({ inputs: { prompt: buildCreaoPrompt(job, input) } });
    if (byteLength(body) > bounds.maxPromptBytes) throw fail("input_too_large");

    const start = runtime.now();
    const remaining = () => bounds.runDeadlineMs - (runtime.now() - start);
    const request = (url: string, init: RequestInit, maxBytes: number) => {
      const left = remaining();
      if (left <= 0) throw fail("deadline");
      return boundedFetch(
        runtime,
        url,
        init,
        { timeoutMs: Math.min(bounds.requestTimeoutMs, left), maxBytes },
        fail,
      );
    };
    const expectOk = (response: BoundedResponse, ok: number[]) => {
      if (response.status >= 300 && response.status < 400) throw fail("redirect_rejected");
      if (!ok.includes(response.status)) throw fail("http_status", response.status);
    };
    const auth = { authorization: `Bearer ${apiKey}`, accept: "application/json" };

    diag.stage = "create";
    const runsUrl = `${base}/apps/${encodeURIComponent(agentId)}/runs`;
    const created = await request(
      runsUrl,
      { method: "POST", headers: { ...auth, "content-type": "application/json" }, body },
      bounds.maxResponseBytes,
    );
    expectOk(created, [200, 201, 202]);
    const createdRun = createdRunSchema.safeParse(parseJson(created.text));
    if (!createdRun.success) throw fail("malformed_response");
    const runId = createdRun.data.id;
    checkStatus(createdRun.data.status, fail);

    diag.stage = "poll";
    const runUrl = `${runsUrl}/${encodeURIComponent(runId)}`;
    let result: z.infer<typeof runResultSchema> | null | undefined;
    for (let polls = 0; ; polls++) {
      if (polls >= bounds.maxPolls) throw fail("poll_limit");
      if (remaining() < bounds.pollIntervalMs) throw fail("deadline");
      await runtime.sleep(bounds.pollIntervalMs);
      const polled = await request(
        runUrl,
        { method: "GET", headers: auth },
        bounds.maxResponseBytes,
      );
      expectOk(polled, [200]);
      const run = polledRunSchema.safeParse(parseJson(polled.text));
      if (!run.success || (run.data.id !== undefined && run.data.id !== runId)) {
        throw fail("malformed_response");
      }
      if (checkStatus(run.data.status, fail) === "completed") {
        result = run.data.result;
        break;
      }
    }
    diag.stage = "extract";
    if (!result) throw fail("no_result");
    diag.resultPresent = true;

    const chatText = result.chatText ?? "";
    const scan = scanChatText(chatText);
    const candidates = scan.candidates;
    Object.assign(diag, {
      chatTextPresent: chatText.length > 0,
      chatTextLength: chatText.length,
      resultStartMarker: chatText.includes(RESULT_START),
      resultEndMarker: chatText.includes(RESULT_END),
      delimitedBlocks: scan.delimitedBlocks,
      malformedDelimited: scan.malformedDelimited,
      fences: scan.fences,
      wholeJson: scan.wholeJson,
    });
    for (const artifact of result.artifacts ?? [])
      diag.artifacts[artifactCategory(artifact.type)]++;
    const jsonArtifacts = (result.artifacts ?? []).filter(isJsonArtifact);
    diag.jsonArtifacts = jsonArtifacts.length;
    if (jsonArtifacts.length > bounds.maxArtifacts) throw fail("too_many_artifacts");
    for (const artifact of jsonArtifacts) {
      const text = await downloadArtifact(artifact, runId);
      const json = parseJson(text);
      if (json === undefined) continue;
      diag.jsonArtifactsParsed++;
      candidates.push({ json });
    }

    diag.stage = "select";
    diag.candidates = candidates.length;
    diag.envelopes = candidates.filter((c) => "json" in c && isEnvelope(c.json)).length;
    const selection = selectOne(job, input, candidates, { bareArray: true });
    diag.validated = selection.validated;
    diag.distinct = selection.distinct;
    if (selection.kind === "none") throw fail("no_result");
    if (selection.kind === "ambiguous") throw fail("ambiguous_result");
    return selection.value;

    /**
     * Only the authenticated download endpoint for this run on the trusted origin is
     * fetched with credentials. Redirects are followed by hand: HTTPS public hosts only,
     * and Authorization is dropped for good once the chain leaves the trusted origin.
     */
    async function downloadArtifact(artifact: Artifact, id: string): Promise<string> {
      const trusted = new URL(`${base}/`);
      let url: URL;
      try {
        url = new URL(artifact.url, trusted);
      } catch {
        throw fail("untrusted_artifact");
      }
      const expectedSuffix = `/runs/${encodeURIComponent(id)}/artifacts/download`;
      if (
        url.origin !== trusted.origin ||
        url.username ||
        url.password ||
        !url.pathname.startsWith(trusted.pathname) ||
        !url.pathname.endsWith(expectedSuffix) ||
        url.searchParams.get("artifactId") !== artifact.id
      ) {
        throw fail("untrusted_artifact");
      }
      let authorized = true;
      for (let hop = 0; hop <= bounds.maxRedirects; hop++) {
        const response = await request(
          url.href,
          { method: "GET", headers: authorized ? auth : { accept: "application/json" } },
          bounds.maxArtifactBytes,
        );
        if (response.status < 300 || response.status >= 400) {
          if (response.status !== 200) throw fail("http_status", response.status);
          return response.text;
        }
        let next: URL;
        try {
          next = new URL(response.location ?? "", url);
        } catch {
          throw fail("redirect_rejected");
        }
        if (!response.location || !isSafeRedirectTarget(next)) throw fail("redirect_rejected");
        if (next.origin !== trusted.origin) authorized = false;
        url = next;
      }
      throw fail("redirect_rejected");
    }
  }
}

function checkStatus(
  status: string,
  fail: (category: "run_failed" | "run_cancelled" | "unknown_status") => ProviderError,
) {
  const normalized = status.trim().toLowerCase();
  if (normalized === "completed") return "completed";
  if (normalized === "failed") throw fail("run_failed");
  if (normalized === "cancelled" || normalized === "canceled") throw fail("run_cancelled");
  // An unrecognised state is never treated as success, nor waited on indefinitely.
  if (!pendingStatuses.has(normalized)) throw fail("unknown_status");
  return "pending";
}

function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && typeof entry === "number"),
  ) as Partial<T>;
}
