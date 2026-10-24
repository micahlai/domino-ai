import {
  HISTORICAL_SPECIALIST_LIMITS,
  type HistoricalSpecialistInput,
  HistoricalSpecialistInputSchema,
  HistoricalSpecialistOutputSchema,
  type HistoricalSpecialistRole,
  checkHistoricalSpecialistOutput,
} from "@domino/contracts";
import { ConvexError, type Infer, v } from "convex/values";
import { ProviderError } from "../../../packages/agents/src/errors";
import { hashInput } from "../../../packages/agents/src/hash";
import {
  historicalSystemPrompt,
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
// One deadline per turn. The provider times out at 60 s, so this only fires if the action died.
const TURN_DEADLINE_MS = 180_000;
const REVIEWER_QUESTION = "Review the costed alternative against its saved baseline.";

const now = () => new Date().toISOString();

const WORKING_STYLE: Record<Role, string> = {
  evidence_analyst:
    "Reads the frozen disclosure and the saved baseline forecast. Says what the evidence shows and what it cannot show, and cites the ids it relies on.",
  scenario_reviewer:
    "Reviews the costed alternative against its saved baseline. Names its costs, delays and unknown benefit or downside, and cites engine results.",
};

/**
 * Safe, versioned profile snapshot stored on the operation. instructions is the exact
 * app-authored system prompt the specialist entry sends; the version is its hash, so a later
 * prompt edit gets a new version while stored operations keep theirs.
 */
async function profileOf(role: Role) {
  const instructions = historicalSystemPrompt(role);
  return {
    role,
    workingStyle: WORKING_STYLE[role],
    instructions,
    version: `${role}@${(await hashInput(instructions)).slice(0, 12)}`,
    tools: [] as string[],
    knowledgeCutoff: CUTOFF,
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
  await ctx.db.insert("investigationOperations", {
    ...fields,
    operationId,
    conversationId,
    sequence,
    status: "queued",
    createdAt: now(),
    leaseUntil: Date.now() + TURN_DEADLINE_MS,
    ...(fields.role ? { profile: await profileOf(fields.role) } : {}),
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
      // The stored specialist packet stays server-side; input carries its ids and hash.
      operations: ops.map(({ _id, _creationTime, packet: _p, conversationId: _c, ...op }) => op),
      busy: active(ops),
      canReveal: open("reveal"),
      canAlternative: open("alternative"),
    };
  },
});

// ---------- execution ----------

type Step = { operationId: string; packet?: HistoricalSpecialistInput } | null;

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
      await ctx.db.patch(op._id, {
        status: "running",
        startedAt: now(),
        providerMode,
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
      return { operationId: op.operationId, packet };
    }
    return null;
  },
});

/** Deterministic tool operations. They run inside one transaction, so a throw rolls back. */
async function runTool(ctx: MutationCtx, op: Op, byId: Map<string, Op>) {
  const dep = (kind: Kind) => [...byId.values()].find((o) => o.kind === kind)!;
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
    const loaded = dep("source_load").input as { sourceIds: string[]; factIds: string[] };
    const { runId, run } = await saveBaselineIn(ctx, `inv-${op.operationId}`, CASE.id);
    // The forecast may read only what the source step loaded.
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
    const r = await revealIn(ctx, `inv-${op.operationId}`, baselineRunId);
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
  const { runId } = await computeAlternativeIn(ctx, `inv-${op.operationId}`, baselineRunId);
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
    model: v.string(),
    usage: v.object({ inputTokens: v.number(), outputTokens: v.number() }),
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
    if (result.ok) {
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
      if (op?.status === "queued")
        await settle(ctx, op, "failed", {
          code: "deadline",
          message: "The turn reached its deadline before this step started.",
        });
      else if (op?.status === "running")
        await settle(ctx, op, "unknown", {
          code: "outcome_unknown",
          message:
            "No result arrived before the deadline. It may have been billed and was not retried.",
        });
    }
  },
});

class ProviderUnavailable extends Error {}

/**
 * The one provider dispatch point. CREAO is the target coordinator and has no verified adapter
 * yet (G2c), so the default fails honestly with no call. claude-dev is the accepted Claude
 * specialist entry, used only when explicitly configured; it is never a fallback.
 */
async function dispatchSpecialist(mode: ProviderMode, packet: HistoricalSpecialistInput) {
  if (mode === "claude-dev") return runHistoricalSpecialist(process.env, packet);
  throw new ProviderUnavailable();
}

// Transport outcomes where the request may have reached the provider.
const MAYBE_SENT = new Set(["timeout", "network"]);

function failureOf(e: unknown) {
  if (e instanceof ProviderUnavailable)
    return {
      ok: false as const,
      status: "failed" as const,
      code: "provider_unavailable",
      message: "The CREAO coordinator is not connected yet. No model call was made.",
    };
  if (e instanceof ProviderError)
    return {
      ok: false as const,
      status: MAYBE_SENT.has(e.category) ? ("unknown" as const) : ("failed" as const),
      code: e.category,
      // ProviderError messages carry only provider, job, category and HTTP status.
      message: e.message,
    };
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
    const mode: ProviderMode =
      process.env.DOMINO_SPECIALIST_PROVIDER === "claude-dev" ? "claude-dev" : "creao";
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
      let result: Infer<typeof outcome>;
      try {
        const { output, provider, model, usage } = await dispatchSpecialist(mode, next.packet);
        result = { ok: true, output, provider, model, usage };
      } catch (e) {
        result = failureOf(e);
      }
      await ctx.runMutation(internal.investigation.finishSpecialist, {
        operationId: next.operationId,
        result,
      });
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
