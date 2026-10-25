import {
  HISTORICAL_SPECIALIST_LIMITS,
  type HistoricalSpecialistInput,
  HistoricalSpecialistInputSchema,
  HistoricalSpecialistOutputSchema,
  type HistoricalSpecialistRole,
  checkHistoricalSpecialistOutput,
} from "@domino/contracts";
import { ConvexError, type Infer, v } from "convex/values";
import { creaoDefaults } from "../../../packages/agents/src/creao";
import { ProviderError } from "../../../packages/agents/src/errors";
import { hashInput } from "../../../packages/agents/src/hash";
import {
  buildHistoricalCreaoPrompt,
  creaoHistoricalEnv,
  historicalCreaoOutputFormat,
  historicalSystemPrompt,
  runCreaoHistoricalSpecialist,
  runHistoricalSpecialist,
} from "../../../packages/agents/src/historical";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  type MutationCtx,
  type QueryCtx,
  internalAction,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import {
  CASE,
  CUTOFF,
  computeAlternativeIn,
  fail,
  loadRun,
  requireRequestId,
  revealIn,
  saveBaselineIn,
  visibleCase,
} from "./historical";

/**
 * G2b: server-owned investigation on the curated 2U case. A conversation runs a fixed, disclosed
 * workflow (Domino does not plan autonomously): load the curated archived disclosure, run the
 * engine forecast, ask the evidence analyst. The user may then explicitly reveal the next
 * disclosure and request one costed alternative, which the scenario reviewer reads. Clients send
 * only a question and IDs. Inputs freeze per operation when it starts and are never widened.
 * Money comes from the existing historical mutations; specialist prose never supplies amounts.
 */

type Op = Doc<"investigationOperations">;
type Kind = Op["kind"];
type Role = HistoricalSpecialistRole;
export type ProviderMode = "creao" | "claude-dev";

const QUESTION_CHARS = HISTORICAL_SPECIALIST_LIMITS.questionChars;
const HISTORY_CHARS = HISTORICAL_SPECIALIST_LIMITS.historyTurnChars;
// Bounds: the workflow is fixed, so a conversation holds at most 6 operations and 2 specialist
// calls (analyst + reviewer); the loop and query limits only backstop that.
const MAX_SPECIALIST_CALLS = 2;
const MAX_STEPS = 8;
const LIST_LIMIT = 50;
// One deadline per turn. Claude times out at 60 s and a CREAO run's deadline ends inside this
// lease, so this only fires if the action died.
const TURN_DEADLINE_MS = 180_000;
const REVIEWER_QUESTION = "Review the costed alternative against its saved baseline.";
// CREAO runs inside the lease: its whole-run deadline ends this long before the lease does, so
// the result can still commit. Below the minimum budget nothing is created.
const FINISH_MARGIN_MS = 10_000;
const MIN_CREAO_BUDGET_MS = 30_000;

const now = () => new Date().toISOString();
const modeOf = (): ProviderMode =>
  process.env.DOMINO_SPECIALIST_PROVIDER === "claude-dev" ? "claude-dev" : "creao";

const WORKING_STYLE: Record<Role, string> = {
  evidence_analyst:
    "Reads the frozen disclosure and the saved baseline forecast. Says what the evidence shows and what it cannot show, and cites the ids it relies on.",
  scenario_reviewer:
    "Reviews the costed alternative against its saved baseline. Names its costs, delays and unknown benefit or downside, and cites engine results.",
};

/**
 * The rules and output format Domino puts in every CREAO run's prompt. Rebuilt from the Claude
 * prompt (same rules, different data location and wrapper); dispatch checks it equals the
 * prompt actually sent, so a wording drift fails closed instead of mislabelling the profile.
 */
const creaoRules = (role: Role) =>
  [
    ...historicalSystemPrompt(role)
      .replace("inside <domino_input>", "in the data field")
      .split("\n")
      .slice(0, -1),
    historicalCreaoOutputFormat,
  ].join("\n");

const sentCreaoRules = (packet: HistoricalSpecialistInput) => {
  const sent = JSON.parse(buildHistoricalCreaoPrompt(packet)) as {
    rules: string[];
    outputFormat: string;
  };
  return [...sent.rules, sent.outputFormat].join("\n");
};

/**
 * Safe, versioned profile snapshot stored on the operation for its frozen provider mode.
 * claude-dev: instructions is the exact app-authored system prompt. creao: instructions is only
 * the per-run rules Domino sends; the remote app's own instructions and memory are unknown here.
 * The version is a hash, so a later edit gets a new version while stored operations keep theirs.
 * creao also freezes the role's remote app id (not a secret, it is in the run URL; never the key),
 * so a queued step cannot go to a different app than the one verified.
 */
async function profileOf(role: Role, mode: ProviderMode) {
  const creao = mode === "creao";
  const instructions = creao ? creaoRules(role) : historicalSystemPrompt(role);
  const appId = creao ? process.env[creaoHistoricalEnv[role].appId]?.trim() : undefined;
  return {
    role,
    workingStyle: WORKING_STYLE[role],
    instructions,
    version: `${role}@${creao ? "creao-" : ""}${(await hashInput(instructions)).slice(0, 12)}`,
    tools: [] as string[],
    knowledgeCutoff: CUTOFF,
    ...(creao
      ? {
          provider: "creao",
          ...(appId ? { appId } : {}),
          instructionsScope:
            "Rules Domino sends with each run. The CREAO app's own instructions, skills and memory also apply and are not visible to Domino.",
        }
      : {}),
  };
}

// ---------- records ----------

async function conversationOf(ctx: QueryCtx, conversationId: string) {
  const c = await ctx.db
    .query("investigationConversations")
    .withIndex("by_conversationId", (q) => q.eq("conversationId", conversationId))
    .unique();
  if (!c) fail("NOT_FOUND", "Unknown conversation");
  return c;
}

const opsOf = (ctx: QueryCtx, conversationId: string) =>
  ctx.db
    .query("investigationOperations")
    .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
    .take(LIST_LIMIT);

async function opById(ctx: QueryCtx, operationId: string) {
  return ctx.db
    .query("investigationOperations")
    .withIndex("by_operationId", (q) => q.eq("operationId", operationId))
    .unique();
}

async function addMessage(
  ctx: MutationCtx,
  conversationId: string,
  role: "user" | "assistant" | "system",
  kind: "question" | "receipt" | "assessment",
  text: string,
  operationId?: string,
) {
  const last = await ctx.db
    .query("investigationMessages")
    .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
    .order("desc")
    .first();
  await ctx.db.insert("investigationMessages", {
    conversationId,
    sequence: (last?.sequence ?? 0) + 1,
    role,
    kind,
    text,
    createdAt: now(),
    ...(operationId ? { operationId } : {}),
  });
}

async function addOp(
  ctx: MutationCtx,
  conversationId: string,
  fields: { kind: Kind; title: string; dependsOn: string[]; role?: Role },
) {
  const last = await ctx.db
    .query("investigationOperations")
    .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
    .order("desc")
    .first();
  const sequence = (last?.sequence ?? 0) + 1;
  const operationId = `${conversationId}-${sequence}`;
  // A specialist's provider mode and profile freeze here; dispatch rejects any later drift.
  const mode = modeOf();
  await ctx.db.insert("investigationOperations", {
    ...fields,
    operationId,
    conversationId,
    sequence,
    status: "queued",
    createdAt: now(),
    leaseUntil: Date.now() + TURN_DEADLINE_MS,
    ...(fields.role ? { providerMode: mode, profile: await profileOf(fields.role, mode) } : {}),
  });
  return operationId;
}

/** Bind requestId to its kind and payload; a repeat returns the first result, a mismatch conflicts. */
async function priorRequest(
  ctx: QueryCtx,
  requestId: string,
  kind: Doc<"investigationRequests">["kind"],
  payload: unknown,
) {
  requireRequestId(requestId);
  const payloadHash = await hashInput({ kind, payload });
  const prior = await ctx.db
    .query("investigationRequests")
    .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
    .unique();
  if (prior && (prior.kind !== kind || prior.payloadHash !== payloadHash))
    fail("CONFLICT", "requestId already used for a different request");
  return { payloadHash, prior };
}

/** Save the intent and schedule the work in one transaction, with one deadline for the turn. */
async function startTurn(
  ctx: MutationCtx,
  receipt: Omit<Doc<"investigationRequests">, "_id" | "_creationTime">,
) {
  await ctx.db.insert("investigationRequests", receipt);
  await ctx.scheduler.runAfter(0, internal.investigation.runTurn, {
    conversationId: receipt.conversationId,
  });
  await ctx.scheduler.runAfter(TURN_DEADLINE_MS, internal.investigation.expireTurn, {
    operationIds: receipt.operationIds,
  });
  return { conversationId: receipt.conversationId, operationIds: receipt.operationIds };
}

const active = (ops: Op[]) => ops.some((o) => o.status === "queued" || o.status === "running");
const succeeded = (ops: Op[], kind: Kind) =>
  ops.find((o) => o.kind === kind && o.status === "succeeded");

// ---------- public API ----------

/** Start one investigation of the curated 2U case. Idempotent on requestId. */
export const investigate = mutation({
  args: { requestId: v.string(), question: v.string() },
  handler: async (ctx, { requestId, question }) => {
    const text = question.trim();
    if (text.length === 0 || text.length > QUESTION_CHARS)
      fail("INVALID_REQUEST", `question must be 1-${QUESTION_CHARS} characters`);
    const { payloadHash, prior } = await priorRequest(ctx, requestId, "investigate", {
      caseId: CASE.id,
      question: text,
    });
    if (prior) return { conversationId: prior.conversationId, operationIds: prior.operationIds };
    const conversationId = `conv-${(await hashInput({ requestId })).slice(0, 16)}`;
    await ctx.db.insert("investigationConversations", {
      conversationId,
      caseId: CASE.id,
      question: text,
      createdAt: now(),
    });
    await addMessage(ctx, conversationId, "user", "question", text);
    const source = await addOp(ctx, conversationId, {
      kind: "source_load",
      title: "Load curated archived disclosure",
      dependsOn: [],
    });
    const forecast = await addOp(ctx, conversationId, {
      kind: "forecast",
      title: "Engine forecast (quarterly cash bridge)",
      dependsOn: [source],
    });
    const analyst = await addOp(ctx, conversationId, {
      kind: "specialist",
      role: "evidence_analyst",
      title: "Evidence analyst",
      dependsOn: [source, forecast],
    });
    await addMessage(
      ctx,
      conversationId,
      "system",
      "receipt",
      "Domino queued a fixed three-step investigation: load the curated archived disclosure (a bundled copy, not live retrieval), run the engine forecast, then ask the evidence analyst.",
    );
    return startTurn(ctx, {
      requestId,
      kind: "investigate",
      payloadHash,
      conversationId,
      operationIds: [source, forecast, analyst],
    });
  },
});

/** Explicit user reveal of the next archived disclosure for this conversation's baseline. */
export const revealInvestigation = mutation({
  args: { requestId: v.string(), conversationId: v.string() },
  handler: async (ctx, { requestId, conversationId }) => {
    const { payloadHash, prior } = await priorRequest(ctx, requestId, "reveal", conversationId);
    if (prior) return { conversationId, operationIds: prior.operationIds };
    await conversationOf(ctx, conversationId);
    const ops = await opsOf(ctx, conversationId);
    const forecast = gate(ops, "reveal");
    const op = await addOp(ctx, conversationId, {
      kind: "reveal",
      title: "Reveal next archived disclosure",
      dependsOn: [forecast.operationId],
    });
    await addMessage(
      ctx,
      conversationId,
      "system",
      "receipt",
      "You asked to reveal the next archived disclosure. The saved forecast is compared with it, not recomputed.",
    );
    return startTurn(ctx, {
      requestId,
      kind: "reveal",
      payloadHash,
      conversationId,
      operationIds: [op],
    });
  },
});

/** Explicit user request for the one costed alternative (A1) and its scenario review. */
export const requestAlternative = mutation({
  args: { requestId: v.string(), conversationId: v.string() },
  handler: async (ctx, { requestId, conversationId }) => {
    const { payloadHash, prior } = await priorRequest(
      ctx,
      requestId,
      "alternative",
      conversationId,
    );
    if (prior) return { conversationId, operationIds: prior.operationIds };
    await conversationOf(ctx, conversationId);
    const ops = await opsOf(ctx, conversationId);
    const forecast = gate(ops, "alternative");
    const alt = await addOp(ctx, conversationId, {
      kind: "alternative",
      title: "Engine alternative (costed response)",
      dependsOn: [forecast.operationId],
    });
    const reviewer = await addOp(ctx, conversationId, {
      kind: "specialist",
      role: "scenario_reviewer",
      title: "Scenario reviewer",
      dependsOn: [alt],
    });
    await addMessage(
      ctx,
      conversationId,
      "system",
      "receipt",
      "You asked for the costed alternative. The engine computes it from the saved baseline, then the scenario reviewer reads it.",
    );
    return startTurn(ctx, {
      requestId,
      kind: "alternative",
      payloadHash,
      conversationId,
      operationIds: [alt, reviewer],
    });
  },
});

/** One turn at a time, after a saved forecast, and each follow-up at most once. */
function gate(ops: Op[], kind: "reveal" | "alternative") {
  if (active(ops)) fail("BUSY", "Wait for the current steps to finish");
  const forecast = succeeded(ops, "forecast");
  if (!forecast) fail("NOT_READY", "The forecast has not been saved");
  if (ops.some((o) => o.kind === kind)) fail("LIMIT", `This conversation already has a ${kind}`);
  return forecast;
}

/** Durable conversation state: messages, operations and which explicit actions are open. */
export const getConversation = query({
  args: { conversationId: v.string() },
  handler: async (ctx, { conversationId }) => {
    const c = await conversationOf(ctx, conversationId);
    const messages = await ctx.db
      .query("investigationMessages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .take(LIST_LIMIT);
    const ops = await opsOf(ctx, conversationId);
    const open = (kind: Kind) =>
      !active(ops) && !!succeeded(ops, "forecast") && !ops.some((o) => o.kind === kind);
    return {
      conversationId: c.conversationId,
      caseId: c.caseId,
      createdAt: c.createdAt,
      messages: messages.map((m) => ({
        id: `${conversationId}-m${m.sequence}`,
        sequence: m.sequence,
        role: m.role,
        kind: m.kind,
        text: m.text,
        operationId: m.operationId,
        createdAt: m.createdAt,
      })),
      // The stored specialist packet and remote run identity stay server-side; input carries
      // its ids and hash, and status is the coarse lifecycle.
      operations: ops.map(
        ({
          _id,
          _creationTime,
          packet: _p,
          conversationId: _c,
          remoteRunId: _r,
          remoteStatus: _s,
          ...op
        }) => op,
      ),
      busy: active(ops),
      canReveal: open("reveal"),
      canAlternative: open("alternative"),
    };
  },
});

// ---------- execution ----------

type Profile = Awaited<ReturnType<typeof profileOf>>;
type Step = {
  operationId: string;
  packet?: HistoricalSpecialistInput;
  profile?: Profile;
  leaseUntil?: number;
  /** The claim's startedAt; only this claim may record the remote run. */
  claimedAt?: string;
} | null;

// Fails closed: an operation without a lease is treated as expired.
const expired = (op: Pick<Op, "leaseUntil">) => !(Date.now() < (op.leaseUntil ?? 0));
const DEADLINE = {
  code: "deadline",
  message: "The turn reached its deadline before this step started.",
};
const OUTCOME_UNKNOWN = {
  code: "outcome_unknown",
  message: "No result arrived before the deadline. It may have been billed and was not retried.",
};

/**
 * Run or claim the next ready operation. Tool operations run and commit here, one per
 * transaction. A specialist is claimed (queued -> running, input frozen) and returned for the
 * action to dispatch; it can be claimed once. Operations behind a failed step fail too.
 */
export const step = internalMutation({
  args: { conversationId: v.string(), providerMode: v.string() },
  handler: async (ctx, { conversationId, providerMode }): Promise<Step> => {
    const ops = await opsOf(ctx, conversationId);
    const byId = new Map(ops.map((o) => [o.operationId, o]));
    for (const op of ops) {
      if (op.status !== "queued") continue;
      // The deadline holds even if its scheduled cleanup has not run yet.
      if (expired(op)) {
        await settle(ctx, op, "failed", DEADLINE);
        op.status = "failed";
        continue;
      }
      const deps = op.dependsOn.map((id) => byId.get(id));
      if (deps.some((d) => !d || d.status === "failed" || d.status === "unknown")) {
        await settle(ctx, op, "failed", {
          code: "dependency_failed",
          message: "An earlier step did not succeed, so this step did not run.",
        });
        op.status = "failed";
        continue;
      }
      if (deps.some((d) => d?.status !== "succeeded")) continue;
      if (op.kind !== "specialist") {
        await runTool(ctx, op, byId);
        return { operationId: op.operationId };
      }
      const calls = ops.filter((o) => o.kind === "specialist" && o.startedAt).length;
      if (op.providerMode !== providerMode) {
        await settle(ctx, op, "failed", {
          code: "provider_changed",
          message: "The provider setting changed after this step was queued. No call was made.",
        });
        op.status = "failed";
        continue;
      }
      if (calls >= MAX_SPECIALIST_CALLS) {
        await settle(ctx, op, "failed", {
          code: "budget",
          message: "This conversation reached its specialist call limit.",
        });
        op.status = "failed";
        continue;
      }
      const built = HistoricalSpecialistInputSchema.safeParse(await packetFor(ctx, op, byId));
      if (!built.success) {
        await settle(ctx, op, "failed", {
          code: "invalid_input",
          message: "The frozen evidence did not form a valid specialist input. No call was made.",
        });
        op.status = "failed";
        continue;
      }
      const packet = built.data;
      const startedAt = now();
      await ctx.db.patch(op._id, {
        status: "running",
        startedAt,
        packet,
        input: {
          visibleThrough: packet.visibleThrough,
          knowledgeCutoff: packet.run.knowledgeCutoff,
          sourceIds: packet.case.sources.map((s) => s.id),
          factIds: packet.case.facts.map((f) => f.id),
          assumptionIds: packet.case.assumptions.map((a) => a.id),
          runIds: [packet.run.id, ...(packet.baseline ? [packet.baseline.id] : [])],
          comparisonIds: packet.comparisons.map((c) => c.id),
          historyTurns: packet.history.length,
          hash: await hashInput(packet),
        },
      });
      return {
        operationId: op.operationId,
        packet,
        profile: op.profile as Profile,
        leaseUntil: op.leaseUntil,
        claimedAt: startedAt,
      };
    }
    return null;
  },
});

/** Deterministic tool operations. They run inside one transaction, so a throw rolls back. */
async function runTool(ctx: MutationCtx, op: Op, byId: Map<string, Op>) {
  const dep = (kind: Kind) => [...byId.values()].find((o) => o.kind === kind)!;
  // Owned rows use a key the public requestId shape rejects; see historical requireKey.
  const key = `inv:${op.operationId}`;
  const owner = op.conversationId;
  const done = (fields: Partial<Op>) =>
    ctx.db.patch(op._id, { status: "succeeded", startedAt: now(), finishedAt: now(), ...fields });
  if (op.kind === "source_load") {
    // ponytail: curated archive only. A live source loader would be a separate verified tool.
    const known = visibleCase(CUTOFF);
    const input = {
      visibleThrough: CUTOFF,
      knowledgeCutoff: CUTOFF,
      sourceIds: known.sources.map((s) => s.id),
      factIds: known.facts.map((f) => f.id),
      assumptionIds: known.assumptions.map((a) => a.id),
    };
    await done({
      input: { ...input, hash: await hashInput(known) },
      output: {
        origin: "curated_archive",
        note: "Bundled archived copy of the public disclosure, not live retrieval.",
        sources: known.sources.map((s) => ({
          id: s.id,
          title: s.title,
          url: s.url,
          publishedAt: s.publishedAt,
          retrievedOn: s.retrievedOn,
          contentHash: s.contentHash,
        })),
      },
    });
    return;
  }
  if (op.kind === "forecast") {
    const loaded = dep("source_load").input as {
      sourceIds: string[];
      factIds: string[];
      hash: string;
    };
    // The forecast may read only what the source step loaded: the same full case version
    // (titles, content hashes, facts), checked before anything is saved, and only those ids.
    if ((await hashInput(visibleCase(CUTOFF))) !== loaded.hash)
      fail("CASE_CHANGED", "The evidence changed after it was loaded; no forecast was saved");
    const { runId, run } = await saveBaselineIn(ctx, key, CASE.id, owner);
    if (
      !run.inputs.sourceIds.every((id: string) => loaded.sourceIds.includes(id)) ||
      !run.inputs.factIds.every((id: string) => loaded.factIds.includes(id))
    )
      fail("INTEGRITY", "Forecast read evidence the source step did not load");
    await done({
      input: {
        visibleThrough: run.knowledgeCutoff,
        knowledgeCutoff: run.knowledgeCutoff,
        ...run.inputs,
        hash: run.inputHash,
      },
      outputRef: { kind: "run", id: runId },
    });
    return;
  }
  const baselineRunId = dep("forecast").outputRef!.id;
  if (op.kind === "reveal") {
    const r = await revealIn(ctx, key, baselineRunId, owner);
    await done({
      input: { runId: baselineRunId },
      output: {
        revealedThrough: r.revealedThrough,
        comparisonIds: (r.comparisons as { id: string }[]).map((c) => c.id),
      },
      outputRef: { kind: "reveal", id: baselineRunId },
    });
    await addMessage(
      ctx,
      op.conversationId,
      "system",
      "receipt",
      "The next archived disclosure is revealed. Earlier steps keep the evidence they started with.",
      op.operationId,
    );
    return;
  }
  // alternative: the existing mutation is the money authority; this stores only its run id.
  const { runId } = await computeAlternativeIn(ctx, key, baselineRunId, owner);
  await done({ input: { baselineRunId }, outputRef: { kind: "run", id: runId } });
}

/**
 * Specialist input from the saved run's frozen snapshot (getRun.inputSnapshot), never from
 * today's case. Both roles read cutoff-only inputs and no revealed evidence or reveal-time
 * messages: the reviewer's history is the question and the analyst's cutoff assessment.
 */
async function packetFor(ctx: MutationCtx, op: Op, byId: Map<string, Op>) {
  const ref = (o: Op | undefined) => o?.outputRef?.id ?? fail("INTEGRITY", "Missing output ref");
  const c = await conversationOf(ctx, op.conversationId);
  const all = [...byId.values()];
  const base = {
    excerpts: [],
    comparisons: [],
  };
  if (op.role === "evidence_analyst") {
    const { run, frozenCase } = await loadRun(ctx, ref(byId.get(op.dependsOn[1]!)));
    return {
      ...base,
      role: "evidence_analyst",
      visibleThrough: run.knowledgeCutoff,
      question: c.question,
      history: [],
      case: frozenCase,
      run,
    };
  }
  const { run, frozenCase, baseline } = await loadRun(ctx, ref(byId.get(op.dependsOn[0]!)));
  const analyst = all.find((o) => o.role === "evidence_analyst" && o.status === "succeeded");
  const assessment = (analyst?.output as { assessment?: string } | undefined)?.assessment;
  return {
    ...base,
    role: "scenario_reviewer",
    visibleThrough: run.knowledgeCutoff,
    question: REVIEWER_QUESTION,
    history: [
      { speaker: "user", text: c.question.slice(0, HISTORY_CHARS) },
      ...(assessment ? [{ speaker: "domino", text: assessment.slice(0, HISTORY_CHARS) }] : []),
    ],
    case: frozenCase,
    run,
    baseline,
  };
}

async function settle(
  ctx: MutationCtx,
  op: Op,
  status: "failed" | "unknown",
  error: { code: string; message: string },
) {
  await ctx.db.patch(op._id, { status, error, finishedAt: now() });
  if (op.kind === "specialist")
    await addMessage(
      ctx,
      op.conversationId,
      "system",
      "receipt",
      `${op.title} did not complete: ${error.message}`,
      op.operationId,
    );
}

const outcome = v.union(
  v.object({
    ok: v.literal(true),
    output: v.any(),
    provider: v.string(),
    // CREAO reports no validated model or usage; absent means unknown, never invented.
    model: v.optional(v.string()),
    usage: v.optional(v.object({ inputTokens: v.number(), outputTokens: v.number() })),
    runId: v.optional(v.string()),
  }),
  v.object({
    ok: v.literal(false),
    status: v.union(v.literal("failed"), v.literal("unknown")),
    code: v.string(),
    message: v.string(),
  }),
);

/**
 * Commit a specialist result. Only a running operation accepts it, so a late result after the
 * deadline marked it unknown cannot overwrite that. Success needs output that validates
 * against the stored frozen packet.
 */
export const finishSpecialist = internalMutation({
  args: { operationId: v.string(), result: outcome },
  handler: async (ctx, { operationId, result }) => {
    const op = await opById(ctx, operationId);
    if (!op || op.kind !== "specialist" || op.status !== "running") return false;
    // Past the deadline the result is not accepted even if cleanup has not run yet.
    if (expired(op)) {
      await settle(ctx, op, "unknown", OUTCOME_UNKNOWN);
      return false;
    }
    if (result.ok) {
      // A CREAO answer counts only for the remote run recorded before polling began.
      if (op.providerMode === "creao" && (!op.remoteRunId || result.runId !== op.remoteRunId)) {
        await settle(ctx, op, "unknown", {
          code: "run_unrecorded",
          message: "The reply did not match the recorded CREAO run. It was not used or retried.",
        });
        return false;
      }
      const packet = HistoricalSpecialistInputSchema.parse(op.packet);
      const out = HistoricalSpecialistOutputSchema.safeParse(result.output);
      if (out.success && checkHistoricalSpecialistOutput(packet, out.data).length === 0) {
        await ctx.db.patch(op._id, {
          status: "succeeded",
          finishedAt: now(),
          output: out.data,
          provider: result.provider,
          model: result.model,
          usage: result.usage,
        });
        await addMessage(
          ctx,
          op.conversationId,
          "assistant",
          "assessment",
          out.data.assessment,
          operationId,
        );
        return true;
      }
      await settle(ctx, op, "failed", {
        code: "invalid_output",
        message: "The specialist reply did not pass validation.",
      });
      return false;
    }
    await settle(ctx, op, result.status, { code: result.code, message: result.message });
    return false;
  },
});

/**
 * CREAO onRunCreated: persist the remote run before any poll. Internal only. Accepted once, for
 * the live claim of a running CREAO operation inside its lease; anything else returns false, so
 * the adapter stops with run_record_failed and never polls.
 */
export const recordRemoteRun = internalMutation({
  args: { operationId: v.string(), claimedAt: v.string(), runId: v.string(), status: v.string() },
  handler: async (ctx, { operationId, claimedAt, runId, status }) => {
    const op = await opById(ctx, operationId);
    if (
      !op ||
      op.kind !== "specialist" ||
      op.status !== "running" ||
      op.providerMode !== "creao" ||
      op.startedAt !== claimedAt ||
      op.remoteRunId !== undefined ||
      expired(op)
    )
      return false;
    await ctx.db.patch(op._id, { provider: "creao", remoteRunId: runId, remoteStatus: status });
    return true;
  },
});

/** A step threw (and rolled back): fail what has not started so the turn does not hang. */
export const abandon = internalMutation({
  args: { conversationId: v.string(), code: v.string() },
  handler: async (ctx, { conversationId, code }) => {
    let first = true;
    for (const op of await opsOf(ctx, conversationId)) {
      if (op.status !== "queued") continue;
      await settle(
        ctx,
        op,
        "failed",
        first
          ? { code, message: "This step could not run." }
          : {
              code: "dependency_failed",
              message: "An earlier step did not succeed, so this step did not run.",
            },
      );
      first = false;
    }
  },
});

/**
 * Turn deadline. Never-started operations fail; a running call becomes unknown because it may
 * have reached the provider. Nothing is retried, so a deadline never fires another paid call.
 */
export const expireTurn = internalMutation({
  args: { operationIds: v.array(v.string()) },
  handler: async (ctx, { operationIds }) => {
    for (const id of operationIds) {
      const op = await opById(ctx, id);
      if (op?.status === "queued") await settle(ctx, op, "failed", DEADLINE);
      else if (op?.status === "running") await settle(ctx, op, "unknown", OUTCOME_UNKNOWN);
    }
  },
});

class ProviderUnverified extends Error {}
class ProfileMismatch extends Error {}
class AppChanged extends Error {}
class NoBudget extends Error {}

/**
 * Server-side gate, default off: `appId/profileVersion` pairs Codex has verified against that
 * dedicated remote app's own instructions and memory (the version names the role). A pair not
 * listed sends nothing, so verifying app A never authorizes app B.
 */
const verifiedCreaoProfiles = () =>
  (process.env.DOMINO_CREAO_VERIFIED_PROFILES ?? "").split(",").map((s) => s.trim());

/**
 * The one provider dispatch point, called once per claim. The frozen profile must equal what
 * this code would send, or nothing is sent. creao (default): the app-scoped historical adapter,
 * only for a verified profile and inside the lease; it records the remote run before polling.
 * claude-dev is the accepted Claude entry, only when explicitly configured; never a fallback.
 */
async function dispatchSpecialist(
  mode: ProviderMode,
  packet: HistoricalSpecialistInput,
  profile: Profile | undefined,
  leaseUntil: number | undefined,
  onRunCreated: (run: { runId: string; status: string }) => Promise<void>,
) {
  const current = await profileOf(packet.role, mode);
  if (
    profile?.role !== current.role ||
    profile.instructions !== current.instructions ||
    profile.version !== current.version
  )
    throw new ProfileMismatch();
  if (profile.appId !== current.appId) throw new AppChanged();
  if (mode === "claude-dev") {
    const { output, provider, model, usage } = await runHistoricalSpecialist(process.env, packet);
    return { output, provider, model, usage };
  }
  if (sentCreaoRules(packet) !== profile.instructions) throw new ProfileMismatch();
  // Gate off reads as unverified even when config is also missing; gate on, a missing app is config.
  const verified = verifiedCreaoProfiles();
  if (!profile.appId && verified.some(Boolean))
    throw new ProviderError("creao", "historicalSpecialist", "config");
  if (!verified.includes(`${profile.appId}/${profile.version}`)) throw new ProviderUnverified();
  const budget = Math.min(
    creaoDefaults.runDeadlineMs,
    (leaseUntil ?? 0) - Date.now() - FINISH_MARGIN_MS,
  );
  if (budget < MIN_CREAO_BUDGET_MS) throw new NoBudget();
  // Only the role's app id and app key are read; no account key and no fallback. The app id is
  // pinned to the frozen, verified one rather than re-read.
  const env = { ...process.env, [creaoHistoricalEnv[packet.role].appId]: profile.appId };
  const { output, provider, runId } = await runCreaoHistoricalSpecialist(env, packet, {
    runDeadlineMs: budget,
    onRunCreated,
  });
  return { output, provider, runId };
}

// Transport outcomes where the request may have reached the provider.
const MAYBE_SENT = new Set(["timeout", "network"]);
// CREAO outcomes that are settled: nothing was created, or the run ended without a usable
// answer. Anything else (deadline, poll limit, unrecorded run, odd status) may still bill.
const CREAO_SETTLED = new Set([
  "config",
  "invalid_input",
  "input_too_large",
  "run_failed",
  "run_cancelled",
  "no_result",
  "invalid_output",
  "ambiguous_result",
  "too_many_artifacts",
  "untrusted_artifact",
]);

const failed = (code: string, message: string) => ({
  ok: false as const,
  status: "failed" as const,
  code,
  message,
});

function failureOf(e: unknown) {
  if (e instanceof ProfileMismatch)
    return failed(
      "profile_mismatch",
      "The saved specialist profile no longer matches the deployed instructions. No model call was made.",
    );
  if (e instanceof AppChanged)
    return failed(
      "app_changed",
      "The CREAO app for this specialist changed after this step was queued. No call was made.",
    );
  if (e instanceof ProviderUnverified)
    return failed(
      "provider_unverified",
      "The CREAO historical agents' own instructions and memory are not verified yet. No call was made.",
    );
  if (e instanceof NoBudget)
    return failed(
      "deadline",
      "Too little time was left in this turn to start a CREAO run. No call was made.",
    );
  if (e instanceof ProviderError) {
    const uncertain =
      e.provider === "creao" ? !CREAO_SETTLED.has(e.category) : MAYBE_SENT.has(e.category);
    return {
      ok: false as const,
      status: uncertain ? ("unknown" as const) : ("failed" as const),
      code: e.category,
      // ProviderError messages carry only provider, job, category and HTTP status.
      message: e.message,
    };
  }
  return {
    ok: false as const,
    status: "unknown" as const,
    code: "internal",
    message: "The specialist call ended unexpectedly. It was not retried.",
  };
}

/** Runs a conversation's ready operations in the backend; the browser can close. */
export const runTurn = internalAction({
  args: { conversationId: v.string() },
  handler: async (ctx, { conversationId }): Promise<void> => {
    const mode = modeOf();
    for (let i = 0; i < MAX_STEPS; i++) {
      let next: Step;
      try {
        next = await ctx.runMutation(internal.investigation.step, {
          conversationId,
          providerMode: mode,
        });
      } catch (e) {
        const code = e instanceof ConvexError ? String(e.data?.code ?? "internal") : "internal";
        await ctx.runMutation(internal.investigation.abandon, { conversationId, code });
        return;
      }
      if (!next) return;
      if (!next.packet) continue;
      const { operationId, claimedAt = "" } = next;
      let result: Infer<typeof outcome>;
      if (expired(next)) {
        // Claimed but the lease ran out before the call: send nothing; commit records unknown.
        result = { ok: false, status: "unknown", ...OUTCOME_UNKNOWN };
      } else {
        try {
          const sent = await dispatchSpecialist(
            mode,
            next.packet,
            next.profile,
            next.leaseUntil,
            async ({ runId, status }) => {
              const recorded = await ctx.runMutation(internal.investigation.recordRemoteRun, {
                operationId,
                claimedAt,
                runId,
                status,
              });
              // Throwing makes the adapter stop with run_record_failed: no poll, no repost.
              if (!recorded) throw new Error("remote run not recorded");
            },
          );
          result = { ok: true, ...sent };
        } catch (e) {
          result = failureOf(e);
        }
      }
      await ctx.runMutation(internal.investigation.finishSpecialist, { operationId, result });
    }
  },
});

/**
 * Entry for a future source-version or scheduled check. The curated case is bundled, so the
 * same version is a no-op and any other version is noted as unverified, with zero new work.
 * ponytail: queues nothing; add a verified loader and an eligibility check before it may.
 */
export const sourceWake = internalMutation({
  args: { sourceId: v.string(), contentHash: v.string() },
  handler: async (_ctx, { sourceId, contentHash }) => {
    const source = CASE.sources.find((s) => s.id === sourceId);
    const status = !source
      ? "unknown_source"
      : source.contentHash === contentHash
        ? "unchanged"
        : "unverified_version";
    return { status, queued: 0 };
  },
});
