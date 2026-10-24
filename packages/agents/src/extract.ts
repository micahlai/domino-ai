import type { AgentJob } from "@domino/contracts";
import { canonicalJson } from "./hash";
import { RESULT_END, RESULT_START } from "./prompts";
import { isStructuredJob, outputSchemas, structuredEnvelope, textEnvelope } from "./schemas";
import { satisfiesJobRules } from "./semantics";

/** A possible answer found in provider output, before contract validation. */
export type Candidate = { json: unknown } | { text: string };

/**
 * Validates one candidate against the job contract and input-dependent rules.
 * Structured jobs accept {"result": [...]} or, from CREAO only, a bare array.
 */
export function acceptCandidate(
  job: AgentJob,
  input: unknown,
  candidate: Candidate,
  options: { bareArray: boolean },
): { value: unknown } | undefined {
  let data: unknown;
  if (isStructuredJob(job)) {
    if (!("json" in candidate)) return undefined;
    const envelope = structuredEnvelope.safeParse(candidate.json);
    if (envelope.success) data = envelope.data.result;
    else if (options.bareArray && Array.isArray(candidate.json)) data = candidate.json;
    else return undefined;
  } else if ("text" in candidate) {
    data = candidate.text;
  } else {
    const envelope = textEnvelope.safeParse(candidate.json);
    if (!envelope.success) return undefined;
    data = envelope.data.text;
  }
  const parsed = outputSchemas[job].safeParse(data);
  if (!parsed.success || !satisfiesJobRules(job, input, parsed.data)) return undefined;
  return { value: parsed.data };
}

export type Selection = { kind: "one"; value: unknown } | { kind: "none" } | { kind: "ambiguous" };

/** Exactly one distinct valid answer wins; identical repeats (fence plus artifact) count once. */
export function selectOne(
  job: AgentJob,
  input: unknown,
  candidates: Candidate[],
  options: { bareArray: boolean },
): Selection {
  const distinct = new Map<string, unknown>();
  for (const candidate of candidates) {
    const accepted = acceptCandidate(job, input, candidate, options);
    if (accepted) distinct.set(canonicalJson(accepted.value), accepted.value);
  }
  if (distinct.size === 0) return { kind: "none" };
  if (distinct.size > 1) return { kind: "ambiguous" };
  return { kind: "one", value: [...distinct.values()][0] };
}

function tryJson(text: string): Candidate | undefined {
  try {
    return { json: JSON.parse(text) };
  } catch {
    return undefined;
  }
}

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const delimited = new RegExp(
  `^[ \\t]*${literal(RESULT_START)}[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n[ \\t]*${literal(RESULT_END)}[ \\t]*$`,
  "gm",
);
const fenced = /^[ \t]*```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```[ \t]*$/gim;

function unfence(body: string): string {
  const match = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(body.trim());
  return match?.[1] ?? body;
}

/**
 * Candidates from CREAO chat text: own-line delimited blocks, JSON code fences, or the
 * whole text when it is standalone JSON. Braces inside narration are never guessed at.
 * Delimited plain text is a candidate only for text jobs; acceptCandidate enforces that.
 */
export function chatTextCandidates(chatText: string): Candidate[] {
  const candidates: Candidate[] = [];
  for (const match of chatText.matchAll(delimited)) {
    const body = unfence(match[1] ?? "").trim();
    candidates.push(tryJson(body) ?? { text: body });
  }
  for (const match of chatText.matchAll(fenced)) {
    const candidate = tryJson((match[1] ?? "").trim());
    if (candidate) candidates.push(candidate);
  }
  const whole = chatText.trim();
  if (whole.startsWith("{") || whole.startsWith("[")) {
    const candidate = tryJson(whole);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}
