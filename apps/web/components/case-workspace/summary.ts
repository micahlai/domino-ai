import type { Conversation } from "../investigate/live/adapt";

// Plain-words reading of one saved conversation. It counts what was recorded and names nothing
// the records do not show: no scenario, no impact figure, no inferred outcome.

export type Summary = {
  question: string | undefined;
  /** One honest line: running, finished, or what did not finish. */
  status: string;
  /** Branches that really exist, from succeeded steps only. */
  branches: string[];
};

const BRANCH: Record<string, string> = {
  forecast: "Saved forecast",
  reveal: "Compared with what was reported",
  alternative: "One costed alternative",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function summarize(conversation: Conversation): Summary {
  const ops = conversation.operations;
  const failed = ops.filter((op) => op.status === "failed").length;
  const unknown = ops.filter((op) => op.status === "unknown").length;
  const status = conversation.busy
    ? "Domino is still working"
    : failed + unknown > 0
      ? [
          failed ? `${plural(failed, "step")} did not finish` : "",
          unknown ? `${plural(unknown, "step")} with an unknown outcome` : "",
        ]
          .filter(Boolean)
          .join(", ")
      : ops.length === 0
        ? "No steps recorded yet"
        : "All recorded steps finished";
  const done = new Set(ops.filter((op) => op.status === "succeeded").map((op) => op.kind));
  return {
    question: conversation.messages.find((m) => m.kind === "question")?.text,
    status,
    branches: Object.keys(BRANCH)
      .filter((kind) => done.has(kind as never))
      .map((kind) => BRANCH[kind] as string),
  };
}
