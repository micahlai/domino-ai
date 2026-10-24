import type { ProviderError } from "./errors";

/** Injected so tests never touch the network, the wall clock or real waits. */
export interface TransportRuntime {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

/** Resolve defaults at call time so importing this package never reads globals. */
export function runtimeFrom(options: Partial<TransportRuntime> = {}): TransportRuntime {
  return {
    fetch: options.fetch ?? ((url, init) => globalThis.fetch(url, init)),
    now: options.now ?? (() => Date.now()),
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  };
}

export interface BoundedResponse {
  status: number;
  location: string | null;
  text: string;
}

export interface RequestBounds {
  timeoutMs: number;
  maxBytes: number;
}

type Fail = (
  category: "network" | "timeout" | "response_too_large" | "malformed_response",
) => ProviderError;

/**
 * One fetch with manual redirects, an abort deadline covering headers and body, and a byte
 * cap enforced while streaming. Redirects are returned to the caller, never followed here.
 */
export async function boundedFetch(
  runtime: TransportRuntime,
  url: string,
  init: RequestInit,
  bounds: RequestBounds,
  fail: Fail,
): Promise<BoundedResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, bounds.timeoutMs));
  try {
    const response = await runtime.fetch(url, {
      ...init,
      redirect: "manual",
      signal: controller.signal,
    });
    const isRedirect = response.status >= 300 && response.status < 400;
    const text = isRedirect ? "" : await readLimited(response, bounds.maxBytes, fail);
    if (isRedirect) discard(response.body);
    return { status: response.status, location: response.headers.get("location"), text };
  } catch (cause) {
    if (isProviderError(cause)) throw cause;
    throw fail(controller.signal.aborted ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }
}

function isProviderError(value: unknown): value is ProviderError {
  return value instanceof Error && value.name === "ProviderError";
}

async function readLimited(response: Response, maxBytes: number, fail: Fail): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    discard(response.body);
    throw fail("response_too_large");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      discard(reader);
      throw fail("response_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw fail("malformed_response");
  }
}

/** Cancel without waiting: a teed body only settles cancel once every branch cancels. */
function discard(stream: { cancel(): Promise<void> } | null) {
  stream?.cancel().catch(() => undefined);
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/**
 * Redirect targets must be public HTTPS hosts. This is a syntactic check on the URL; it
 * cannot see DNS answers, so it blocks literal local/private addresses and local names.
 */
export function isSafeRedirectTarget(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host.includes(":")) return !isPrivateIPv6(host);
  const v4 = parseIPv4(host);
  if (v4) return !isPrivateIPv4(v4);
  // Single-label names resolve through local search domains.
  if (!host.includes(".") || host === "localhost") return false;
  return !/\.(localhost|local|internal|home\.arpa)$/.test(host);
}

function parseIPv4(host: string): number[] | undefined {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return undefined;
  const octets = parts.map(Number);
  return octets.every((octet) => octet <= 255) ? octets : undefined;
}

function isPrivateIPv4([a = 0, b = 0]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIPv6(host: string): boolean {
  if (host === "::" || host === "::1") return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host)?.[1];
  if (mapped) return isPrivateIPv4(parseIPv4(mapped) ?? [0]);
  // WHATWG URL rewrites mapped IPv4 to hex groups, for example ::ffff:7f00:1.
  if (/^::ffff:/.test(host)) return true;
  return /^(fc|fd|fe[89ab]|ff)/.test(host);
}
