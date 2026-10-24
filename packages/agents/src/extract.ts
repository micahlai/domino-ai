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

export type Selection = (
  | { kind: "one"; value: unknown }
  | { kind: "none" }
  | { kind: "ambiguous" }
) & { validated: number; distinct: number };

/** Exactly one distinct valid answer wins; identical repeats (fence plus artifact) count once. */
export function selectOne(
  job: AgentJob,
  input: unknown,
  candidates: Candidate[],
  options: { bareArray: boolean },
): Selection {
  const distinct = new Map<string, unknown>();
  let validated = 0;
  for (const candidate of candidates) {
    const accepted = acceptCandidate(job, input, candidate, options);
    if (!accepted) continue;
    validated++;
    distinct.set(canonicalJson(accepted.value), accepted.value);
  }
  const counts = { validated, distinct: distinct.size };
  if (distinct.size === 0) return { kind: "none", ...counts };
  if (distinct.size > 1) return { kind: "ambiguous", ...counts };
  return { kind: "one", value: [...distinct.values()][0], ...counts };
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

/** Candidates plus format counts for diagnostics. Counts only, never text. */
export interface ChatTextScan {
  candidates: Candidate[];
  delimitedBlocks: number;
  /** Delimited bodies that look like JSON but do not parse; never read as prose. */
  malformedDelimited: number;
  fences: number;
  wholeJson: boolean;
}

/**
 * Candidates from CREAO chat text: own-line delimited blocks, JSON code fences, or the
 * whole text when it is standalone JSON. Braces inside narration are never guessed at.
 * Delimited plain text is a candidate only for text jobs; acceptCandidate enforces that.
 */
export function scanChatText(chatText: string): ChatTextScan {
  const scan: ChatTextScan = {
    candidates: [],
    delimitedBlocks: 0,
    malformedDelimited: 0,
    fences: 0,
    wholeJson: false,
  };
  for (const match of chatText.matchAll(delimited)) {
    scan.delimitedBlocks++;
    const body = unfence(match[1] ?? "").trim();
    const candidate = tryJson(body);
    if (candidate) scan.candidates.push(candidate);
    // A broken JSON answer, or a fence unfence could not strip, must not slip through as a
    // plain-text brief.
    else if (/^(?:[{[]|```)/.test(body)) scan.malformedDelimited++;
    else scan.candidates.push({ text: body });
  }
  for (const match of chatText.matchAll(fenced)) {
    scan.fences++;
    const candidate = tryJson((match[1] ?? "").trim());
    if (candidate) scan.candidates.push(candidate);
  }
  const whole = chatText.trim();
  if (whole.startsWith("{") || whole.startsWith("[")) {
    const candidate = tryJson(whole);
    if (candidate) {
      scan.wholeJson = true;
      scan.candidates.push(candidate);
    }
  }
  return scan;
}
