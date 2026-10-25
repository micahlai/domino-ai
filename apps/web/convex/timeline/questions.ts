import Anthropic from "@anthropic-ai/sdk";
import { type Constraint, canonicalJson } from "@domino/contracts";
import { type GenericDatabaseReader, makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import { z } from "zod";
import { action } from "../_generated/server";
import { ASSISTANT_TIMEOUT_MS, assistantConfig } from "./assistant/claude";
import { groundingIssue } from "./assistant/grounding";
import { ASSISTANT_QUESTIONS_VERSION, answerWithAssistant } from "./assistant/questions";
import {
  type WorkspaceRun,
  namedIn,
  projectRun,
  recordsOf,
  workspaceGet,
} from "./questions/context";
import { GRAMMAR_VERSION, readWithGrammar } from "./questions/grammar";
import type { Intent } from "./questions/intent";
import { addDays } from "./questions/parse";
import {
  DEFAULT_MODEL,
  PROVIDER_TIMEOUT_MS,
  PROVIDER_VERSION,
  type ProviderFailure,
  readWithProvider,
} from "./questions/provider";
import {
  CitationSchema,
  QuestionProposalSchema,
  type QuestionReceipt,
  type RowData,
  RowDataSchema,
  exactReceipt,
} from "./questions/receipt";
import { type Outcome, resolve } from "./questions/resolve";
import {
  type QuestionsDataModel,
  questionInternalMutation,
  questionMutation,
  questionQuery,
} from "./questions/table";

// TL3 one-shot questions. Interface: kb/features/timeline/TL2-TL5-interface.md.
//
// Each ask is pinned to one saved run and answered once. Order: read the run, try the fixed
// grammar, bind the request (claim) before any provider call, then save exactly one outcome.
// - Fixed grammar (GRAMMAR_VERSION, questions/grammar.ts) reads plain requests: low point,
//   a week, an item, rules, dominoes; "what if <customer> pays N days late"; "pay $X to <Name>
//   on <date>"; "receive $X from <Name> on <date>"; "keep usable cash above $X"; "keep N months
//   of runway"; "pay <vendor> on time / within N days". No paid call.
// - With ANTHROPIC_API_KEY set, Claude reads every question first with the company's saved
//   run as context (assistant/questions.ts). It extracts original user spans; answer text,
//   status, citations and proposals come only from the fixed resolver. Without a key the fixed grammar
//   answers, and a question it cannot read is saved as failed.
// Neither method computes money or writes the answer: answers and citations come from the
// run's saved forecast, receipts, dominoes and seed records; proposals change nothing until
// the person confirms them through workspace simulate/reviseConstraints.

export const QUESTIONS_METHOD = "timeline_questions@1";
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PROMPT = 1_000;
const MAX_ITEM_ID = 128;
const MAX_PROVIDER_NAMES = 200;
/** A running ask older than this is abandoned and saved as failed. */
export const LEASE_MS = 2 * Math.max(PROVIDER_TIMEOUT_MS, ASSISTANT_TIMEOUT_MS) + 30_000;

type Method = RowData["method"];

function reject(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Domain identities and index keys include both company and request; public request stays unchanged. */
export const questionIdFor = async (companyId: string, requestId: string) =>
  `timeline:question/${await sha256Hex(canonicalJson([companyId, requestId]))}`;
const requestKeyFor = async (companyId: string, requestId: string) =>
  `question:${(await questionIdFor(companyId, requestId)).slice("timeline:question/".length)}`;

const TITLES: Record<Method, string> = {
  grammar: "Answer a question from the saved run (read with fixed patterns)",
  provider: "Answer a question from the saved run (wording read by Claude, numbers from the run)",
};

const FAILURES: Record<string, string> = {
  PROVIDER_UNAVAILABLE:
    'Domino could not read this with its fixed patterns, and the language reader is not set up. A question like "What if Acme pays 14 days late?" works. Nothing was calculated.',
  PROVIDER_TIMEOUT:
    "The language reader took too long. Nothing was calculated. Ask again to retry.",
  PROVIDER_ERROR:
    "The language reader could not be reached. Nothing was calculated. Ask again to retry.",
  PROVIDER_REFUSED: "The language reader declined this question. Nothing was calculated.",
  PROVIDER_TRUNCATED:
    "The language reader's reply was cut off. Nothing was calculated. Ask again to retry.",
  PROVIDER_MALFORMED:
    "The language reader's reply did not match what Domino accepts, so it was not used. Nothing was calculated.",
  LEASE_EXPIRED:
    "This question stopped before it finished. Nothing was calculated. Ask again to retry.",
  INTERNAL: "This question could not be finished. Nothing was calculated. Ask again to retry.",
};

// ---------- Internal claim / finalize / expire ----------

const refs = {
  claim: makeFunctionReference<
    "mutation",
    {
      companyId: string;
      runId: string;
      requestId: string;
      inputHash: string;
      prompt: string;
      selectedWeek: string | null;
      selectedItemId: string | null;
      method: Method;
      parentConstraintsJson: string;
    },
    { claimed: boolean; receipt: QuestionReceipt }
  >("timeline/questions:claim"),
  finalize: makeFunctionReference<
    "mutation",
    { companyId: string; requestId: string; outcomeJson: string },
    QuestionReceipt
  >("timeline/questions:finalize"),
  expire: makeFunctionReference<"mutation", { companyId: string; requestId: string }, null>(
    "timeline/questions:expire",
  ),
};

const OutcomeSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.enum(["answered", "clarification"]),
      answer: z.string().min(1).max(2_000),
      citations: z.array(CitationSchema).max(12),
    })
    .strict(),
  z
    .object({
      status: z.literal("proposal"),
      answer: z.string().min(1).max(2_000),
      citations: z.array(CitationSchema).max(12),
      proposal: QuestionProposalSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("failed"),
      errorCode: z.enum(Object.keys(FAILURES) as [string, ...string[]]),
    })
    .strict(),
]);
type SavedOutcome = Outcome | { status: "failed"; errorCode: string };

type Db = GenericDatabaseReader<QuestionsDataModel>;
async function rowAtKey(db: Db, companyId: string, requestKey: string) {
  return db
    .query("timelineQuestions")
    .withIndex("by_company_and_requestId", (q) =>
      q.eq("companyId", companyId).eq("requestId", requestKey),
    )
    .unique();
}
async function rowFor(db: Db, companyId: string, requestId: string) {
  // Existing local receipts remain readable after upgrading the question method.
  return (
    (await rowAtKey(db, companyId, await requestKeyFor(companyId, requestId))) ??
    rowAtKey(db, companyId, requestId)
  );
}

function readRow(row: { data: unknown }): { data: RowData; receipt: QuestionReceipt } {
  const data = RowDataSchema.safeParse(row.data);
  const receipt = data.success ? exactReceipt(data.data.receipt) : null;
  if (!data.success || !receipt) reject("INTEGRITY", "A saved question failed its integrity check");
  return { data: data.data, receipt };
}

/** Terminal receipt for an outcome; the operation records start and finish. */
function finished(receipt: QuestionReceipt, outcome: SavedOutcome, now: string): QuestionReceipt {
  const failed = outcome.status === "failed";
  const base = {
    ...receipt,
    status: outcome.status,
    savedAt: now,
    operation: {
      ...receipt.operation,
      status: failed ? ("failed" as const) : ("succeeded" as const),
      outputRefs: failed ? [] : [receipt.id],
      finishedAt: now,
      updatedAt: now,
    },
  };
  if (outcome.status === "failed")
    return {
      ...base,
      answer: FAILURES[outcome.errorCode] ?? FAILURES.INTERNAL ?? "",
      citations: [],
      proposal: null,
      errorCode: outcome.errorCode,
    };
  return {
    ...base,
    answer: outcome.answer,
    citations: outcome.citations,
    proposal: outcome.status === "proposal" ? outcome.proposal : null,
    errorCode: null,
  };
}

/** Bind a request id to its inputs before any provider call; same request returns its row. */
export const claim = questionInternalMutation({
  args: {
    companyId: v.string(),
    runId: v.string(),
    requestId: v.string(),
    inputHash: v.string(),
    prompt: v.string(),
    selectedWeek: v.union(v.string(), v.null()),
    selectedItemId: v.union(v.string(), v.null()),
    method: v.union(v.literal("grammar"), v.literal("provider")),
    parentConstraintsJson: v.string(),
  },
  handler: async (ctx, args): Promise<{ claimed: boolean; receipt: QuestionReceipt }> => {
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const prior = await rowFor(ctx.db, args.companyId, args.requestId);
    if (prior) {
      if (prior.inputHash !== args.inputHash)
        reject("REQUEST_CONFLICT", "This requestId was already used for a different question");
      const { data, receipt } = readRow(prior);
      if (receipt.status === "running" && nowMs >= data.leaseUntil) {
        const failed = finished(receipt, { status: "failed", errorCode: "LEASE_EXPIRED" }, now);
        await ctx.db.patch(prior._id, {
          status: failed.status,
          data: { ...data, receipt: failed },
          updatedAt: now,
        });
        return { claimed: false, receipt: failed };
      }
      return { claimed: false, receipt };
    }
    const parentConstraints = z.array(z.unknown()).parse(JSON.parse(args.parentConstraintsJson));
    const opHash = (await sha256Hex(canonicalJson([args.companyId, args.requestId]))).slice(0, 40);
    const id = await questionIdFor(args.companyId, args.requestId);
    const receipt = exactReceipt({
      id,
      companyId: args.companyId,
      runId: args.runId,
      requestId: args.requestId,
      prompt: args.prompt,
      selectedWeek: args.selectedWeek,
      selectedItemId: args.selectedItemId,
      status: "running",
      answer: "",
      citations: [],
      proposal: null,
      errorCode: null,
      linkedRunId: null,
      savedAt: now,
      operation: {
        schemaVersion: 1,
        id: `timeline:operation/question-${opHash}`,
        ownerDomain: "timeline",
        status: "running",
        title: TITLES[args.method],
        dependencies: [],
        evidenceRefs: /^timeline:[a-z][a-z0-9_]{0,31}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(
          args.runId,
        )
          ? [{ kind: "domain", id: args.runId }]
          : [],
        outputRefs: [],
        createdAt: now,
        startedAt: now,
        updatedAt: now,
      },
    });
    if (!receipt) reject("INTERNAL", "Could not build a valid question receipt");
    const data = RowDataSchema.parse({
      receipt,
      leaseUntil: nowMs + LEASE_MS,
      method: args.method,
      parentConstraints,
    });
    await ctx.db.insert("timelineQuestions", {
      companyId: args.companyId,
      runId: args.runId,
      requestId: await requestKeyFor(args.companyId, args.requestId),
      inputHash: args.inputHash,
      status: "running",
      data,
      startedAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(LEASE_MS, refs.expire, {
      companyId: args.companyId,
      requestId: args.requestId,
    });
    return { claimed: true, receipt };
  },
});

/** Save the one outcome of a claimed request. A request that is no longer running is kept. */
export const finalize = questionInternalMutation({
  args: { companyId: v.string(), requestId: v.string(), outcomeJson: v.string() },
  handler: async (ctx, args): Promise<QuestionReceipt> => {
    const row = await rowFor(ctx.db, args.companyId, args.requestId);
    if (!row) reject("NOT_FOUND", "No claimed question for this request");
    const { data, receipt } = readRow(row);
    if (receipt.status !== "running") return receipt;
    const raw: unknown = JSON.parse(args.outcomeJson);
    const parsed = OutcomeSchema.safeParse(raw);
    const outcome: SavedOutcome =
      parsed.success && canonicalJson(parsed.data) === canonicalJson(raw)
        ? (parsed.data as SavedOutcome)
        : { status: "failed", errorCode: "INTERNAL" };
    const now = new Date().toISOString();
    let next = exactReceipt(finished(receipt, outcome, now));
    if (!next) next = finished(receipt, { status: "failed", errorCode: "INTERNAL" }, now);
    await ctx.db.patch(row._id, {
      status: next.status,
      data: { ...data, receipt: next },
      updatedAt: now,
    });
    return next;
  },
});

/** Scheduled at claim: an ask still running after its lease is saved as failed. */
export const expire = questionInternalMutation({
  args: { companyId: v.string(), requestId: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const row = await rowFor(ctx.db, args.companyId, args.requestId);
    if (!row) return null;
    const { data, receipt } = readRow(row);
    if (receipt.status !== "running" || Date.now() < data.leaseUntil) return null;
    const now = new Date().toISOString();
    const failed = finished(receipt, { status: "failed", errorCode: "LEASE_EXPIRED" }, now);
    await ctx.db.patch(row._id, {
      status: failed.status,
      data: { ...data, receipt: failed },
      updatedAt: now,
    });
    return null;
  },
});

// ---------- Public functions ----------

function checkSelection(run: WorkspaceRun, week: string | null, item: string | null) {
  if (week !== null) {
    if (!ISO_DATE.test(week) || new Date(`${week}T00:00:00Z`).getUTCDay() !== 1)
      reject("INVALID_INPUT", "selectedWeek must be a Monday date like 2026-11-02");
    const saved =
      run.forecast.weeks.some((w) => w.weekStart === week) ||
      run.baseline.history.some((w) => w.weekStart === week);
    if (!saved) reject("INVALID_INPUT", "selectedWeek is not a week of this run");
  }
  if (item !== null) {
    if (item.length === 0 || item.length > MAX_ITEM_ID)
      reject("INVALID_INPUT", "selectedItemId is invalid");
    const known = recordsOf(run).some((r) => r.id === item || r.scheduledId === item);
    if (!known) reject("INVALID_INPUT", "selectedItemId is not an item of this run");
  }
}

async function interpret(
  run: WorkspaceRun,
  prompt: string,
  week: string | null,
  item: string | null,
): Promise<
  { ok: true; intents: Intent[] } | { ok: false; code: ProviderFailure | "PROVIDER_UNAVAILABLE" }
> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, code: "PROVIDER_UNAVAILABLE" };
  const records = recordsOf(run).filter((r) => r.paid === null);
  const names = [
    ...new Set([
      ...namedIn(prompt, recordsOf(run)),
      ...records.map((r) => r.name),
      ...records.map((r) => r.id),
    ]),
  ];
  const weeks = run.forecast.weeks;
  return readWithProvider(
    {
      prompt,
      selectedWeek: week,
      selectedItemId: item,
      forecastStart: weeks[0]?.weekStart ?? "",
      forecastEnd: addDays(weeks[weeks.length - 1]?.weekStart ?? "", 6),
      names: names.slice(0, MAX_PROVIDER_NAMES),
    },
    {
      apiKey,
      model: process.env.TIMELINE_QUESTIONS_MODEL || DEFAULT_MODEL,
      fetch: (...a) => fetch(...a),
      timeoutMs: PROVIDER_TIMEOUT_MS,
    },
  );
}

function failureCode(error: unknown): string {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return "PROVIDER_TIMEOUT";
  if (error instanceof Anthropic.APIError) return "PROVIDER_ERROR";
  if (error instanceof SyntaxError || error instanceof z.ZodError) return "PROVIDER_MALFORMED";
  if (error instanceof Error && error.message in FAILURES) return error.message;
  return "INTERNAL";
}

/** One pinned question about one saved run. Returns its saved receipt. */
export const ask = action({
  args: {
    companyId: v.string(),
    runId: v.string(),
    requestId: v.string(),
    prompt: v.string(),
    selectedWeek: v.optional(v.string()),
    selectedItemId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<QuestionReceipt> => {
    if (!REQUEST_ID.test(args.requestId))
      reject("INVALID_REQUEST", "requestId must be 8-128 letters, digits, '.', '_' or '-'");
    const prompt = args.prompt.trim();
    if (prompt.length === 0 || prompt.length > MAX_PROMPT)
      reject("INVALID_INPUT", `Question must be 1-${MAX_PROMPT} characters`);
    const week = args.selectedWeek ?? null;
    const item = args.selectedItemId ?? null;

    const run = projectRun(
      await ctx.runQuery(workspaceGet, { companyId: args.companyId, runId: args.runId }),
      args.companyId,
      args.runId,
    );
    if (run === null) reject("RUN_NOT_FOUND", "No saved run with this id in this company");
    if (run === "invalid") reject("INTEGRITY", "The saved run failed its integrity check");
    checkSelection(run, week, item);

    const grammar = readWithGrammar(prompt, recordsOf(run), {
      week: week !== null,
      item: item !== null,
    });
    const inputHash = await sha256Hex(
      canonicalJson({
        method: QUESTIONS_METHOD,
        grammar: GRAMMAR_VERSION,
        provider: PROVIDER_VERSION,
        assistant: assistantConfig() ? ASSISTANT_QUESTIONS_VERSION : null,
        companyId: args.companyId,
        runId: args.runId,
        runInputHash: run.inputHash,
        prompt,
        selectedWeek: week,
        selectedItemId: item,
      }),
    );
    const claimed = await ctx.runMutation(refs.claim, {
      companyId: args.companyId,
      runId: args.runId,
      requestId: args.requestId,
      inputHash,
      prompt,
      selectedWeek: week,
      selectedItemId: item,
      method: grammar && !assistantConfig() ? "grammar" : "provider",
      parentConstraintsJson: JSON.stringify(run.constraints),
    });
    if (!claimed.claimed) return claimed.receipt;

    let outcome: SavedOutcome;
    try {
      const asked = {
        questionId: claimed.receipt.id,
        prompt,
        selectedWeek: week,
        selectedItemId: item,
      };
      const sourceIssue = groundingIssue(prompt, []);
      if (sourceIssue) {
        const fixed = grammar ? resolve(run, grammar, asked) : null;
        outcome =
          fixed?.status === "clarification"
            ? fixed
            : { status: "clarification", answer: sourceIssue, citations: [] };
      } else if (assistantConfig()) {
        outcome = await answerWithAssistant(run, asked);
      } else {
        const read = grammar
          ? { ok: true as const, intents: grammar }
          : await interpret(run, prompt, week, item);
        outcome = read.ok
          ? resolve(run, read.intents, asked)
          : { status: "failed", errorCode: read.code };
      }
    } catch (error) {
      // Raw errors may carry provider text; only a code is saved.
      outcome = { status: "failed", errorCode: failureCode(error) };
    }
    return ctx.runMutation(refs.finalize, {
      companyId: args.companyId,
      requestId: args.requestId,
      outcomeJson: JSON.stringify(outcome),
    });
  },
});

const MAX_LIST = 100;

/** Saved questions of one run, oldest first. Reads stored receipts only. */
export const list = questionQuery({
  args: { companyId: v.string(), runId: v.string() },
  handler: async (ctx, args): Promise<QuestionReceipt[]> => {
    const rows = await ctx.db
      .query("timelineQuestions")
      .withIndex("by_company_and_runId", (q) =>
        q.eq("companyId", args.companyId).eq("runId", args.runId),
      )
      .order("asc")
      .take(MAX_LIST);
    return rows.map((row) => {
      const { receipt } = readRow(row);
      if (receipt.companyId !== args.companyId || receipt.runId !== args.runId)
        reject("INTEGRITY", "A saved question is filed under the wrong run");
      return receipt;
    });
  },
});

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

/**
 * Bind a confirmed proposal to the run the person created from it. The result must be a
 * direct child of the asked run with exactly the proposed changes and rules; once linked the
 * binding never changes.
 */
export const link = questionMutation({
  args: { companyId: v.string(), questionId: v.string(), resultRunId: v.string() },
  handler: async (ctx, args): Promise<{ linkedRunId: string }> => {
    const suffix = args.questionId.startsWith("timeline:question/")
      ? args.questionId.slice("timeline:question/".length)
      : null;
    const row =
      suffix === null
        ? null
        : /^[a-f0-9]{64}$/.test(suffix)
          ? ((await rowAtKey(ctx.db, args.companyId, `question:${suffix}`)) ??
            (await rowAtKey(ctx.db, args.companyId, suffix)))
          : await rowAtKey(ctx.db, args.companyId, suffix);
    if (!row) reject("NOT_FOUND", "No saved question with this id in this company");
    const { data, receipt } = readRow(row);
    if (receipt.id !== args.questionId) reject("NOT_FOUND", "No saved question with this id");
    if (receipt.status !== "proposal" || !receipt.proposal)
      reject("NOT_A_PROPOSAL", "Only a proposed change can be linked to a run");
    if (receipt.linkedRunId !== null) {
      if (receipt.linkedRunId === args.resultRunId) return { linkedRunId: receipt.linkedRunId };
      reject("LINK_CONFLICT", "This question is already linked to a different run");
    }
    const result = projectRun(
      await ctx.runQuery(workspaceGet, { companyId: args.companyId, runId: args.resultRunId }),
      args.companyId,
      args.resultRunId,
    );
    if (result === null) reject("RUN_NOT_FOUND", "No saved run with this id in this company");
    if (result === "invalid") reject("INTEGRITY", "The saved run failed its integrity check");
    const expectedRules: Constraint[] = receipt.proposal.constraints ?? data.parentConstraints;
    if (result.parentRunId !== receipt.runId)
      reject(
        "LINK_MISMATCH",
        "That run was not created from the run this question was asked about",
      );
    if (!same(result.ownChanges, receipt.proposal.changes))
      reject("LINK_MISMATCH", "That run's changes differ from the proposal");
    if (!same(result.constraints, expectedRules))
      reject("LINK_MISMATCH", "That run's rules differ from the proposal");
    const now = new Date().toISOString();
    const linked = exactReceipt({
      ...receipt,
      linkedRunId: args.resultRunId,
      operation: { ...receipt.operation, updatedAt: now },
    });
    if (!linked) reject("INTERNAL", "Could not build a valid linked receipt");
    await ctx.db.patch(row._id, { data: { ...data, receipt: linked }, updatedAt: now });
    return { linkedRunId: args.resultRunId };
  },
});
