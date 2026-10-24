import type { AgentJob } from "@domino/contracts";
import { AGENT_SCHEMA_VERSION } from "./schemas";

/**
 * Canonical JSON: object keys sorted, array order kept, undefined object properties
 * dropped as JSON.stringify does. Anything JSON cannot represent faithfully is rejected
 * rather than silently coerced, so two different inputs cannot share a cache key.
 */
export function canonicalJson(value: unknown): string {
  return encode(value, new Set());
}

function encode(value: unknown, ancestors: Set<object>): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("hashInput: non-finite number");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw new TypeError(`hashInput: unsupported ${typeof value}`);
  if (ancestors.has(value)) throw new TypeError("hashInput: cyclic input");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => {
        if (item === undefined) throw new TypeError("hashInput: undefined array item");
        return encode(item, ancestors);
      })}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("hashInput: only plain objects are supported");
    }
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${encode(record[key], ancestors)}`);
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

/** SHA-256 hex of canonical JSON, via Web Crypto so it runs in the Convex default runtime. */
export async function hashInput(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(value)),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Cache key for one job call; includes the schema version so prompt changes miss the cache. */
export function hashJobInput(job: AgentJob, input: unknown): Promise<string> {
  return hashInput({ job, schemaVersion: AGENT_SCHEMA_VERSION, input });
}
