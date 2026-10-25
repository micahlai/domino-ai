import type { Change } from "@domino/contracts";
import type { WorkerChatContext } from "../../../lib/worker-chat-context";
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { ChatReceiptSchema } from "../chat/receipt";

/**
 * What the person and the agents said about a scenario when it was made, so prediction agents
 * read the what-if as a story, not only as dated cash amounts. Two LLM paths make scenarios:
 * an Ask Domino conversation that saved it (linkedRunId), and a Worker suggestion opened in
 * the forecast (a chat with workerContext on the fix run). Everything here is reference data
 * the person or an earlier agent wrote; it is never an instruction or an approval.
 */
export type ScenarioStory = {
  runId: string;
  label: string;
  /** "this scenario" for the one being predicted, then each scenario it builds on. */
  relation: "this scenario" | "builds on";
  ownChanges: Change[];
  askDomino: {
    conversation: { role: "user" | "assistant"; text: string }[];
    savedLabel: string | null;
  } | null;
  fieldSuggestion: {
    role: "risk" | "fix";
    scenarioTitle: string;
    basis: string;
    fix: {
      label: string;
      costNote: string;
      risk: "low" | "medium" | "high";
      survivesWithFix: boolean;
    } | null;
    personNote: string | null;
  } | null;
  /** The rule note, when it says more than the default. */
  ruleNote: string | null;
};

const MAX_DEPTH = 6;
const MAX_TURNS = 16;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
type Ctx = QueryCtx | MutationCtx;
type Run = Doc<"timelineRuns">;

const runRow = (ctx: Ctx, companyId: string, runId: string) =>
  ctx.db
    .query("timelineRuns")
    .withIndex("by_company_and_runId", (q) => q.eq("companyId", companyId).eq("runId", runId))
    .unique();

/** Chats whose source is `runId`, read defensively: an unreadable chat is skipped. */
async function chatsOn(ctx: Ctx, companyId: string, runId: string) {
  const rows = await ctx.db
    .query("timelineChats")
    .withIndex("by_company_and_runId", (q) => q.eq("companyId", companyId).eq("runId", runId))
    .take(50);
  return rows.flatMap((row) => {
    const parsed = ChatReceiptSchema.safeParse((row.data as { receipt?: unknown })?.receipt);
    return parsed.success ? [parsed.data] : [];
  });
}

function fromWorker(context: WorkerChatContext, role: "risk" | "fix") {
  const { scenario, candidate } = context;
  const fix = role === "fix" ? candidate.fix : null;
  return {
    role,
    scenarioTitle: clip(scenario.title, 200),
    basis: clip(scenario.basis, 1200),
    fix: fix && {
      label: clip(fix.label, 200),
      costNote: clip(fix.costNote, 600),
      risk: fix.risk,
      survivesWithFix: candidate.effect.survives,
    },
    personNote: context.note.trim() ? clip(context.note, 500) : null,
  };
}

async function storyOf(ctx: Ctx, run: Run, relation: ScenarioStory["relation"]) {
  const saved = run.parentRunId
    ? (await chatsOn(ctx, run.companyId, run.parentRunId)).find((c) => c.linkedRunId === run.runId)
    : undefined;
  // A Worker handoff opens its chat on the fix run; the risk run is that fix's parent.
  let field: ScenarioStory["fieldSuggestion"] = null;
  const own = (await chatsOn(ctx, run.companyId, run.runId)).find(
    (c) => c.workerContext?.fixRunId === run.runId,
  );
  if (own?.workerContext) field = fromWorker(own.workerContext, "fix");
  else {
    const children = await ctx.db
      .query("timelineRuns")
      .withIndex("by_company", (q) => q.eq("companyId", run.companyId))
      .order("desc")
      .take(500);
    for (const child of children.filter((c) => c.parentRunId === run.runId)) {
      const handoff = (await chatsOn(ctx, run.companyId, child.runId)).find(
        (c) => c.workerContext?.scenarioRunId === run.runId,
      );
      if (handoff?.workerContext) {
        field = fromWorker(handoff.workerContext, "risk");
        break;
      }
    }
  }
  const note = run.constraintNote.trim();
  return {
    runId: run.runId,
    label: run.label,
    relation,
    ownChanges: Array.isArray(run.ownChanges) ? (run.ownChanges as Change[]) : [],
    askDomino: saved
      ? {
          conversation: saved.turns
            .slice(-MAX_TURNS)
            .map((t) => ({ role: t.role, text: clip(t.text, 600) })),
          savedLabel: saved.proposal?.label ?? null,
        }
      : null,
    fieldSuggestion: field,
    ruleNote: note && !/^(Rules reviewed in Timeline chat|)$/.test(note) ? clip(note, 500) : null,
  } satisfies ScenarioStory;
}

/** The scenario being predicted, then each scenario it builds on, nearest first. */
export async function scenarioStories(
  ctx: Ctx,
  companyId: string,
  runId: string,
): Promise<ScenarioStory[]> {
  const out: ScenarioStory[] = [];
  let row = await runRow(ctx, companyId, runId);
  for (let depth = 0; row && depth < MAX_DEPTH; depth++) {
    if (row.kind === "baseline") break;
    if (row.kind === "scenario")
      out.push(await storyOf(ctx, row, out.length ? "builds on" : "this scenario"));
    row = row.parentRunId ? await runRow(ctx, companyId, row.parentRunId) : null;
  }
  return out;
}
