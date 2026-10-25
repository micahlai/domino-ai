import { canonicalJson } from "@domino/contracts";
import { v } from "convex/values";
import type { MutationCtx } from "../../_generated/server";
import { type AgentRow, agentLog } from "../../lib/agentLog";
import type { WorkspaceRun } from "../questions/context";
import { compactMoney, shortDate } from "../recordNames";
import { sha256Hex } from "../workspaceInput";
import { resolveFieldSource } from "./brain";
import type { ChatReceipt } from "./receipt";

/**
 * Ask Domino on the Brain map. Accepted chat turns, their tool calls, saved scenarios and
 * failures are written to the linked Field company's agent log, from the chat mutations that
 * already commit them (no extra provider call). Summaries are code-built: never the person's
 * text, the model's reply or provider errors. Each request writes at most MAX_ROWS rows, once.
 */
export const CHAT_AGENT_ID = "chat#1";
export const CHAT_TOOLS = [
  "lookup_forecast",
  "explain_saved",
  "update_draft",
  "preview_plan",
  "lookup_records",
] as const;
export type ChatTool = (typeof CHAT_TOOLS)[number];
export const chatToolsArg = v.optional(
  v.array(
    v.union(
      v.literal("lookup_forecast"),
      v.literal("explain_saved"),
      v.literal("update_draft"),
      v.literal("preview_plan"),
      v.literal("lookup_records"),
    ),
  ),
);
export const chatFailureArg = v.optional(
  v.union(v.literal("unavailable"), v.literal("rejected"), v.literal("failed")),
);
export type ChatFailure = "unavailable" | "rejected" | "failed";
export const CLAUDE_TOOL = "claude.askDomino";
export const SAVE_TOOL = "timeline.saveScenario";
const MAX_TOOL_ROWS = 12;

const TOOL_ROW: Record<ChatTool, { label: string; category: string; summary: string }> = {
  lookup_forecast: {
    label: "Read saved forecast",
    category: "read",
    summary: "Read the saved forecast",
  },
  explain_saved: {
    label: "Explain saved books",
    category: "read",
    summary: "Explained cash from the saved books",
  },
  update_draft: {
    label: "Check a what-if draft",
    category: "other",
    summary: "Checked a what-if draft",
  },
  preview_plan: {
    label: "Preview a plan",
    category: "other",
    summary: "Previewed a spending or hiring plan",
  },
  lookup_records: {
    label: "Find records",
    category: "read",
    summary: "Looked up invoices and bills",
  },
};

/** "timeline:<company>/<run>" -> the Timeline route that opens that saved run. */
export const timelineRunRef = (companyId: string, runId: string) =>
  `timeline:${encodeURIComponent(companyId)}/${encodeURIComponent(runId)}`;

export type ChatActivity =
  | { kind: "turn"; tools: readonly ChatTool[]; proposalLabel: string | null }
  | { kind: "failed"; failure: ChatFailure; attempt: number; tools: readonly ChatTool[] }
  | {
      kind: "saved";
      label: string;
      runId: string;
      lowPoint: { usable: number; weekStart: string } | null;
    };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function rowsFor(activity: ChatActivity, companyId: string): AgentRow[] {
  const base = { agentId: CHAT_AGENT_ID, agentKind: "domino" as const };
  const tools = (list: readonly ChatTool[]): AgentRow[] =>
    list.slice(0, MAX_TOOL_ROWS).map((tool) => ({
      ...base,
      action: "chat.tool",
      event: "tool",
      tool,
      toolLabel: TOOL_ROW[tool].label,
      toolCategory: TOOL_ROW[tool].category,
      summary: TOOL_ROW[tool].summary,
    }));
  const claude = (status: "done" | "failed", summary: string): AgentRow => ({
    ...base,
    action: "chat.claude",
    event: "tool",
    tool: CLAUDE_TOOL,
    toolLabel: "Claude: Ask Domino reply",
    toolCategory: "other",
    status,
    summary,
  });
  if (activity.kind === "turn")
    return [
      ...tools(activity.tools),
      claude("done", "Claude wrote the reply; code checked every number"),
      {
        ...base,
        action: "chat.turn",
        event: "status",
        status: "done",
        currentTask: "Answering in Timeline chat",
        summary: activity.proposalLabel
          ? `Drafted a proposal for review: ${clip(activity.proposalLabel, 120)}`
          : "Answered a Timeline chat message",
      },
    ];
  if (activity.kind === "failed") {
    const step = { step: activity.attempt };
    if (activity.failure === "unavailable")
      return [
        {
          ...base,
          ...step,
          action: "chat.failed",
          event: "status",
          status: "failed",
          summary:
            "Ask Domino unavailable (language model not configured). The message was not answered.",
        },
      ];
    return [
      ...tools(activity.tools),
      {
        ...claude(
          "failed",
          activity.failure === "rejected"
            ? "Claude's reply failed Domino's checks and was not shown"
            : "Claude call did not finish",
        ),
        ...step,
      },
      {
        ...base,
        ...step,
        action: "chat.failed",
        event: "status",
        status: "failed",
        summary:
          activity.failure === "rejected"
            ? "Ask Domino rejected an unchecked reply. The message was not answered; retry it."
            : "Ask Domino could not finish a reply. The message was not answered; retry it.",
      },
    ];
  }
  const ref = timelineRunRef(companyId, activity.runId);
  const low = activity.lowPoint;
  return [
    {
      ...base,
      action: "chat.saved",
      event: "tool",
      tool: SAVE_TOOL,
      toolLabel: "Save Timeline scenario",
      toolCategory: "forecast",
      status: "done",
      refs: [ref],
      summary: `Saved scenario: ${clip(activity.label, 160)}`,
    },
    {
      ...base,
      action: "chat.message",
      event: "message",
      fromAgentId: CHAT_AGENT_ID,
      toAgentId: "engine",
      refs: [ref],
      summary: low
        ? `Engine computed the scenario: lowest cash ${compactMoney(low.usable)} in the week of ${shortDate(low.weekStart)}`
        : "Engine computed the saved scenario",
    },
  ];
}

/**
 * Write one chat request's activity to the Field company these Timeline books came from. No
 * verified link: nothing is written. A request (and failed attempt) writes once.
 */
export async function logChatActivity(
  ctx: MutationCtx,
  run: WorkspaceRun,
  receipt: ChatReceipt,
  requestId: string,
  activity: ChatActivity,
) {
  const field = await resolveFieldSource(ctx, run, receipt.workerContext);
  if (field.status !== "linked") return;
  const fieldId = ctx.db.normalizeId("companies", field.fieldCompanyId);
  if (!fieldId) return;
  const hash = await sha256Hex(
    canonicalJson([receipt.companyId, receipt.conversationId, requestId]),
  );
  const runId = `chat-${hash.slice(0, 32)}`;
  const rows = rowsFor(activity, receipt.companyId);
  const key = rows.at(-1);
  const prior = await ctx.db
    .query("log")
    .withIndex("by_company_and_runId", (q) => q.eq("companyId", fieldId).eq("runId", runId))
    .take(64);
  if (prior.some((r) => r.action === key?.action && r.step === key?.step)) return;
  for (const row of rows) await agentLog(ctx, fieldId, runId, row);
}
