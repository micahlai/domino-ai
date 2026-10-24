import { HistoricalSpecialistOutputSchema } from "@domino/contracts";
import { z } from "zod";
import type {
  CanvasEdge,
  CanvasEvidence,
  CanvasMessage,
  CanvasNode,
  CanvasProfile,
} from "../types";

// Pure adapter: saved getConversation records (kb/coordination/historical/investigation-api.md)
// onto the canvas presentation shapes. It reads what was recorded and never infers, times or
// invents steps. Money is not touched here: output nodes only point at saved runs.

const Status = z.enum(["queued", "running", "succeeded", "failed", "unknown"]);
const Kind = z.enum(["source_load", "forecast", "specialist", "reveal", "alternative"]);

const Operation = z.object({
  operationId: z.string().min(1),
  sequence: z.number(),
  kind: Kind,
  role: z.enum(["evidence_analyst", "scenario_reviewer"]).optional(),
  title: z.string(),
  status: Status,
  dependsOn: z.array(z.string()),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  profile: z.unknown().optional(),
  providerMode: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  outputRef: z.object({ kind: z.string(), id: z.string() }).optional(),
  output: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});

const Message = z.object({
  id: z.string(),
  sequence: z.number(),
  role: z.enum(["user", "assistant", "system"]),
  kind: z.enum(["question", "receipt", "assessment"]),
  text: z.string(),
});

export const ConversationSchema = z.object({
  conversationId: z.string().min(1),
  messages: z.array(Message),
  operations: z.array(Operation),
  busy: z.boolean(),
  canReveal: z.boolean(),
  canAlternative: z.boolean(),
});
export type Conversation = z.infer<typeof ConversationSchema>;
type Operation = z.infer<typeof Operation>;

const Profile = z.object({
  role: z.string(),
  workingStyle: z.string(),
  instructions: z.string(),
  version: z.string(),
  tools: z.array(z.string()),
  knowledgeCutoff: z.string().optional(),
});

const SourceOutput = z.object({
  origin: z.string(),
  note: z.string().optional(),
  sources: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      url: z.string().optional(),
      publishedAt: z.string().optional(),
    }),
  ),
});

/** Which saved financial view an output node shows. Only ever created from a succeeded step. */
export type OutputStage = "forecast" | "reveal" | "alternative";
export type OutputTarget = {
  stage: OutputStage;
  baselineRunId: string;
  altRunId?: string;
  /** A reveal step succeeded. The alternative is drawn with its comparison, never before it. */
  revealed: boolean;
};

export type Adapted = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  messages: CanvasMessage[];
  outputs: Map<string, OutputTarget>;
};

export const DOMINO_ID = "domino";

const OUTPUT_TITLE: Record<OutputStage, string> = {
  forecast: "Saved cash forecast",
  reveal: "Forecast against what was reported",
  alternative: "Costed alternative",
};
const STEP_FOR_OUTPUT: Partial<Record<Operation["kind"], OutputStage>> = {
  forecast: "forecast",
  reveal: "reveal",
  alternative: "alternative",
};

const UNREADABLE = "The saved result was not in the expected shape, so it is not shown.";

function profileOf(op: Operation): CanvasProfile | undefined {
  const parsed = Profile.safeParse(op.profile);
  if (!parsed.success) return undefined;
  // Provider and model are whatever was saved. Absent stays absent: it is never guessed.
  return {
    ...parsed.data,
    ...(op.provider ? { provider: op.provider } : {}),
    ...(op.model ? { model: op.model } : {}),
  };
}

function specialistText(op: Operation): { text?: string; unreadable: boolean } {
  if (op.status !== "succeeded") return { unreadable: false };
  const parsed = HistoricalSpecialistOutputSchema.safeParse(op.output);
  if (!parsed.success) return { unreadable: true };
  const { assessment, uncertainties } = parsed.data;
  return {
    text: `${assessment}\n\nWhat is uncertain:\n- ${uncertainties.join("\n- ")}`,
    unreadable: false,
  };
}

function sourceEvidence(op: Operation): {
  evidence?: CanvasEvidence[];
  summary?: string;
  unreadable: boolean;
} {
  if (op.status !== "succeeded") return { unreadable: false };
  const parsed = SourceOutput.safeParse(op.output);
  if (!parsed.success) return { unreadable: true };
  const { origin, sources } = parsed.data;
  return {
    evidence: sources.map(({ id, title, url, publishedAt }) => ({
      id,
      title,
      ...(url ? { url } : {}),
      ...(publishedAt ? { publishedAt } : {}),
    })),
    // Only the one origin the backend names is described; anything else is not claimed.
    summary:
      origin === "curated_archive"
        ? "Archived copy bundled with Domino. Not live retrieval."
        : "Where this copy came from was not reported.",
    unreadable: false,
  };
}

function operationNode(op: Operation): CanvasNode {
  const specialist = op.kind === "specialist";
  const { text, unreadable: badSpecialist } = specialist
    ? specialistText(op)
    : { text: undefined, unreadable: false };
  const {
    evidence,
    summary,
    unreadable: badSource,
  } = op.kind === "source_load" ? sourceEvidence(op) : { unreadable: false };
  const unreadable = badSpecialist || badSource;

  // `unknown` is not success: the call may have happened and was not retried. The canvas has no
  // such status, so it shows as failed with that said in words.
  const status = op.status === "unknown" || unreadable ? "failed" : op.status;
  const error = unreadable
    ? UNREADABLE
    : op.status === "unknown"
      ? `The outcome is unknown. ${op.error?.message ?? "No result was recorded."}`
      : op.status === "failed"
        ? (op.error?.message ?? "This step failed and no reason was recorded.")
        : undefined;
  const profile = specialist ? profileOf(op) : undefined;

  return {
    id: op.operationId,
    kind: op.kind === "source_load" ? "source" : specialist ? "agent" : "tool",
    title: op.title,
    status,
    ...(summary ? { summary } : {}),
    ...(text ? { outputText: text } : {}),
    ...(error ? { error } : {}),
    ...(evidence?.length ? { evidence } : {}),
    ...(profile ? { profile } : {}),
    metadata: [
      { label: "Operation", value: op.operationId },
      { label: "Step type", value: op.role ? `${op.kind} (${op.role})` : op.kind },
      { label: "Recorded status", value: op.status },
      ...(specialist
        ? [
            { label: "Provider mode", value: op.providerMode ?? "unknown" },
            { label: "Model", value: op.model ?? "unknown" },
          ]
        : []),
      ...(op.outputRef
        ? [{ label: "Output", value: `${op.outputRef.kind} ${op.outputRef.id}` }]
        : []),
      ...(op.error ? [{ label: "Error code", value: op.error.code }] : []),
      ...(op.startedAt ? [{ label: "Started", value: op.startedAt }] : []),
      ...(op.finishedAt ? [{ label: "Finished", value: op.finishedAt }] : []),
    ],
  };
}

function dominoNode(ops: Operation[]): CanvasNode {
  const active = ops.some((op) => op.status === "queued" || op.status === "running");
  const allDone = ops.every((op) => op.status === "succeeded");
  const status = active ? "running" : allDone ? "succeeded" : "failed";
  return {
    id: DOMINO_ID,
    kind: "domino",
    title: "Domino",
    status,
    summary:
      "Follows a fixed set of steps, in order, for this one question. It does not plan its own.",
    ...(status === "failed"
      ? { error: "Some steps did not finish. Results from steps that did finish are kept." }
      : {}),
  };
}

/** Saved records to canvas props. An output node exists only for a step that really succeeded. */
export function adaptConversation(conversation: Conversation): Adapted {
  const ops = [...conversation.operations].sort((a, b) => a.sequence - b.sequence);
  const ids = new Set(ops.map((op) => op.operationId));
  const nodes: CanvasNode[] = [dominoNode(ops), ...ops.map(operationNode)];
  const edges: CanvasEdge[] = [];
  const link = (source: string, target: string) =>
    edges.push({ id: `${source}->${target}`, source, target });
  const outputs = new Map<string, OutputTarget>();

  const forecast = ops.find((op) => op.kind === "forecast" && op.status === "succeeded");
  const baselineRunId = forecast?.outputRef?.kind === "run" ? forecast.outputRef.id : undefined;
  const revealed = ops.some((op) => op.kind === "reveal" && op.status === "succeeded");

  for (const op of ops) {
    const known = op.dependsOn.filter((id) => ids.has(id));
    for (const id of known) link(id, op.operationId);
    if (known.length === 0) link(DOMINO_ID, op.operationId);

    const stage = STEP_FOR_OUTPUT[op.kind];
    if (!stage || op.status !== "succeeded" || !op.outputRef || !baselineRunId) continue;
    const refOk =
      stage === "reveal"
        ? op.outputRef.kind === "reveal" && op.outputRef.id === baselineRunId
        : op.outputRef.kind === "run";
    const id = `${op.operationId}:output`;
    const bad = !refOk;
    nodes.push({
      id,
      kind: "output",
      title: OUTPUT_TITLE[stage],
      status: bad ? "failed" : "succeeded",
      ...(bad ? { error: UNREADABLE } : {}),
    });
    link(op.operationId, id);
    if (!bad)
      outputs.set(id, {
        stage,
        baselineRunId,
        revealed,
        ...(stage === "alternative" ? { altRunId: op.outputRef.id } : {}),
      });
  }

  const messages = [...conversation.messages]
    .sort((a, b) => a.sequence - b.sequence)
    .map(({ id, role, text }) => ({ id, role, text }));
  return { nodes, edges, messages, outputs };
}
