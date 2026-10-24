import type { AgentJob } from "@domino/contracts";
import { z } from "zod";
import { type FailureCategory, ProviderError, type ProviderJob, failer } from "./errors";
import { type Candidate, type Selection, scanChatText, selectOne } from "./extract";
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
/** Artifact kinds that are downloaded and searched for an answer. */
export const artifactKinds = ["json", "markdown", "text"] as const;
export type ArtifactKind = (typeof artifactKinds)[number];

export interface CreaoDiagnostics {
  job: ProviderJob;
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
  /** Downloadable artifacts by kind; all kinds share the maxArtifacts budget. */
  recognizedArtifacts: Record<ArtifactKind, number>;
  downloadedArtifacts: Record<ArtifactKind, number>;
  /** JSON that parsed, or text that held at least one delimited, fenced or JSON candidate. */
  parsedArtifacts: Record<ArtifactKind, number>;
  artifactCandidates: number;
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

function emptyDiagnostics(job: ProviderJob): CreaoDiagnostics {
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
    recognizedArtifacts: { json: 0, markdown: 0, text: 0 },
    downloadedArtifacts: { json: 0, markdown: 0, text: 0 },
    parsedArtifacts: { json: 0, markdown: 0, text: 0 },
    artifactCandidates: 0,
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

/** Runs one CREAO attempt and reports its diagnostics once, whatever the outcome. */
export async function withCreaoDiagnostics<T>(
  job: ProviderJob,
  callback: CreaoOptions["diagnostics"],
  attempt: (diag: CreaoDiagnostics) => Promise<T>,
): Promise<T> {
  const diagnostics = emptyDiagnostics(job);
  try {
    const value = await attempt(diagnostics);
    diagnostics.stage = "done";
    return value;
  } catch (error) {
    diagnostics.failure = error instanceof ProviderError ? error.category : "unexpected";
    throw error;
  } finally {
    report(callback, diagnostics);
  }
}

export function creaoBounds(options: CreaoOptions): typeof creaoDefaults {
  return { ...creaoDefaults, ...definedOnly(options) };
}

function isEnvelope(json: unknown): boolean {
  return (
    typeof json === "object" &&
    json !== null &&
    !Array.isArray(json) &&
    (Object.hasOwn(json, "result") || Object.hasOwn(json, "text"))
  );
}

/** By declared MIME type, else by file extension in the title. Anything else is ignored. */
function artifactKind(artifact: Artifact): ArtifactKind | undefined {
  const type = artifact.type ?? "";
  const title = artifact.title ?? "";
  if (/json/i.test(type) || /\.json$/i.test(title)) return "json";
  if (/markdown/i.test(type) || /\.(?:md|markdown)$/i.test(title)) return "markdown";
  if (/^\s*text\/plain\b/i.test(type) || /\.txt$/i.test(title)) return "text";
  return undefined;
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
 * contract-valid answer from chat text or JSON, Markdown and plain-text artifacts. No hidden create retries: the
 * router owns retry and fallback.
 */
export function createCreaoClient(
  env: Record<string, string | undefined>,
  options: CreaoOptions = {},
): ProviderClient {
  const runtime = runtimeFrom(options);
  const bounds = creaoBounds(options);

  return {
    run: (job, input) =>
      withCreaoDiagnostics(job, options.diagnostics, async (diag) => {
        const fail = failer("creao", job);
        const apiKey = env.CREAO_API_KEY?.trim();
        const base = (env.CREAO_API_BASE_URL?.trim() || CREAO_API_BASE_URL).replace(/\/+$/, "");
        const agentId = agentIdFor(job, env);
        if (!apiKey || base !== CREAO_API_BASE_URL || !agentId) throw fail("config");
        const run = await runCreaoApp(runtime, bounds, diag, {
          fail,
          apiKey,
          appId: agentId,
          prompt: buildCreaoPrompt(job, input),
          select: (candidates) => selectOne(job, input, candidates, { bareArray: true }),
        });
        return run.value;
      }),
  };
}

/** What differs between one app run of the five jobs and of a historical specialist. */
export interface CreaoAppRun {
  fail: ReturnType<typeof failer>;
  apiKey: string;
  appId: string;
  prompt: string;
  select: (candidates: Candidate[]) => Selection;
  /**
   * Historical runs: every poll must repeat the created run id, and an answer that is
   * present but fails validation reports invalid_output instead of no_result.
   */
  strict?: boolean;
  /**
   * Awaited once the created run is accepted and before the first poll, so the caller can
   * persist the run id. If it throws, the run stops with run_record_failed; nothing is reposted.
   */
  onRunCreated?: (run: { runId: string; status: string }) => Promise<void> | void;
}

/**
 * One app run: exactly one create, bounded polls to a terminal status, then exactly one
 * validated answer from chat text or trusted artifacts. Never retries or reposts.
 */
export async function runCreaoApp(
  runtime: TransportRuntime,
  bounds: typeof creaoDefaults,
  diag: CreaoDiagnostics,
  spec: CreaoAppRun,
): Promise<{ value: unknown; runId: string }> {
  const { fail, apiKey } = spec;
  const base = CREAO_API_BASE_URL;
  const body = JSON.stringify({ inputs: { prompt: spec.prompt } });
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
  const runsUrl = `${base}/apps/${encodeURIComponent(spec.appId)}/runs`;
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
  if (spec.onRunCreated) {
    try {
      await spec.onRunCreated({ runId, status: createdRun.data.status.trim().toLowerCase() });
    } catch {
      throw fail("run_record_failed");
    }
  }

  diag.stage = "poll";
  const runUrl = `${runsUrl}/${encodeURIComponent(runId)}`;
  let result: z.infer<typeof runResultSchema> | null | undefined;
  for (let polls = 0; ; polls++) {
    if (polls >= bounds.maxPolls) throw fail("poll_limit");
    if (remaining() < bounds.pollIntervalMs) throw fail("deadline");
    await runtime.sleep(bounds.pollIntervalMs);
    const polled = await request(runUrl, { method: "GET", headers: auth }, bounds.maxResponseBytes);
    expectOk(polled, [200]);
    const run = polledRunSchema.safeParse(parseJson(polled.text));
    // A changed id means another run's state; strict runs also refuse an absent id.
    const id = run.success ? run.data.id : undefined;
    if (!run.success || (id === undefined ? spec.strict : id !== runId)) {
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
  for (const artifact of result.artifacts ?? []) diag.artifacts[artifactCategory(artifact.type)]++;
  const recognized = (result.artifacts ?? []).flatMap((artifact) => {
    const kind = artifactKind(artifact);
    return kind ? [{ artifact, kind }] : [];
  });
  for (const { kind } of recognized) diag.recognizedArtifacts[kind]++;
  if (recognized.length > bounds.maxArtifacts) throw fail("too_many_artifacts");
  for (const { artifact, kind } of recognized) {
    const text = await downloadArtifact(artifact, runId);
    diag.downloadedArtifacts[kind]++;
    let found: Candidate[];
    if (kind === "json") {
      const json = parseJson(text);
      found = json === undefined ? [] : [{ json }];
    } else {
      // The same strict scan as chat text: prose alone is never an answer.
      found = scanChatText(text).candidates;
    }
    if (found.length > 0) diag.parsedArtifacts[kind]++;
    diag.artifactCandidates += found.length;
    candidates.push(...found);
  }

  diag.stage = "select";
  diag.candidates = candidates.length;
  diag.envelopes = candidates.filter((c) => "json" in c && isEnvelope(c.json)).length;
  const selection = spec.select(candidates);
  diag.validated = selection.validated;
  diag.distinct = selection.distinct;
  if (selection.kind === "none") {
    throw fail(spec.strict && candidates.length > 0 ? "invalid_output" : "no_result");
  }
  if (selection.kind === "ambiguous") throw fail("ambiguous_result");
  return { value: selection.value, runId };

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
