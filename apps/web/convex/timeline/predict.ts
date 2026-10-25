import { canonicalJson } from "@domino/contracts";
import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import { z } from "zod";
import type { Doc } from "../_generated/dataModel";
import {
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
  internalAction,
  internalMutation,
  mutation,
  query,
} from "../_generated/server";
import { AssistantUnavailable, assistantConfig, runStructured } from "./assistant/claude";
import { companyContext } from "./assistant/context";
import { brainContext, resolveFieldSource } from "./chat/brain";
import { source } from "./chat/source";
import {
  CASH_YIELD_BPS,
  EFFECT_KINDS,
  MAX_EFFECTS,
  type ProposedEffect,
  ProposedEffectSchema,
  predict,
  screenEffects,
} from "./predict/effects";
import {
  LEASE_MS,
  MAX_ACTIVITY,
  PREDICT_METHOD,
  type PredictionOutcome,
  PredictionOutcomeSchema,
  type PredictionReceipt,
  PredictionReceiptSchema,
} from "./predict/receipt";
import { type WorkspaceRun, projectRun, recordsOf, workspaceGet } from "./questions/context";
import { branchFloor } from "./workspace";
import { MAX_LABEL, checkRequestId, reject, sha256Hex } from "./workspaceInput";
import { workspaceRefs } from "./workspaceRefs";

/**
 * Predicted scenario: instead of drawing a what-if as its parent line shifted down, agents read
 * the Brain map (flags, counterparty research, learned payment habits) and the saved books, then
 * propose knock-on effects as record-level engine changes. Code screens each one with the same
 * checks a saved run passes, adds interest on the cash gap, and saves the result as a normal
 * child run. Agents never produce an amount; the engine computes every cent.
 */

type Key = { companyId: string; predictionId: string };
const keyArgs = { companyId: v.string(), predictionId: v.string() };
const refs = {
  execute: makeFunctionReference<"action", Key, null>("timeline/predict:execute"),
  claim: makeFunctionReference<"mutation", Key, PredictionReceipt | null>("timeline/predict:claim"),
  note: makeFunctionReference<
    "mutation",
    Key & { text: string; progress?: number; stage?: string },
    null
  >("timeline/predict:note"),
  finish: makeFunctionReference<"mutation", Key & { outcomeJson: string }, null>(
    "timeline/predict:finish",
  ),
  expire: makeFunctionReference<"mutation", Key, null>("timeline/predict:expire"),
};

const terminal = (s: PredictionReceipt["status"]) => s === "done" || s === "failed";

function read(row: Doc<"timelinePredictions">): PredictionReceipt {
  const parsed = PredictionReceiptSchema.safeParse(row.data);
  if (
    !parsed.success ||
    parsed.data.companyId !== row.companyId ||
    parsed.data.predictionId !== row.predictionId ||
    parsed.data.runId !== row.runId
  )
    return reject("INTEGRITY", "The saved prediction failed its integrity check");
  return parsed.data;
}

const rowById = (ctx: QueryCtx | MutationCtx, key: Key) =>
  ctx.db
    .query("timelinePredictions")
    .withIndex("by_company_and_predictionId", (q) =>
      q.eq("companyId", key.companyId).eq("predictionId", key.predictionId),
    )
    .unique();

const newestForRun = (ctx: QueryCtx | MutationCtx, companyId: string, runId: string) =>
  ctx.db
    .query("timelinePredictions")
    .withIndex("by_company_and_runId", (q) => q.eq("companyId", companyId).eq("runId", runId))
    .order("desc")
    .first();

/** Starts (or returns the running) prediction for one saved scenario. */
export const start = mutation({
  args: { companyId: v.string(), runId: v.string(), requestId: v.string() },
  handler: async (ctx, args): Promise<{ predictionId: string; created: boolean }> => {
    checkRequestId(args.requestId);
    const same = await ctx.db
      .query("timelinePredictions")
      .withIndex("by_company_and_requestId", (q) =>
        q.eq("companyId", args.companyId).eq("requestId", args.requestId),
      )
      .unique();
    if (same) return { predictionId: same.predictionId, created: false };
    const newest = await newestForRun(ctx, args.companyId, args.runId);
    if (newest && !terminal(read(newest).status))
      return { predictionId: newest.predictionId, created: false };
    const run = await source(ctx, args.companyId, args.runId);
    if (run.kind !== "scenario" || run.parentRunId === null)
      reject("NOT_A_SCENARIO", "Only a saved scenario can be predicted");
    const predictionId = `timeline:prediction/${(
      await sha256Hex(canonicalJson([args.companyId, args.requestId]))
    ).slice(0, 40)}`;
    const now = new Date().toISOString();
    const receipt: PredictionReceipt = {
      schemaVersion: 1,
      methodVersion: PREDICT_METHOD,
      predictionId,
      companyId: args.companyId,
      runId: run.runId,
      parentRunId: run.parentRunId,
      inputHash: run.inputHash,
      floor: await branchFloor(ctx, args.companyId, run.runId, run.baseline.seed.snapshot),
      field: await resolveFieldSource(ctx, run, undefined),
      status: "queued",
      progress: 2,
      stage: "Waiting to start",
      activity: [],
      summary: null,
      effects: [],
      rejected: [],
      interest: null,
      resultRunId: null,
      warnings: [],
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    await ctx.db.insert("timelinePredictions", {
      companyId: args.companyId,
      predictionId,
      runId: run.runId,
      requestId: args.requestId,
      leaseUntil: Date.now() + LEASE_MS,
      data: PredictionReceiptSchema.parse(receipt),
    });
    const key = { companyId: args.companyId, predictionId };
    await ctx.scheduler.runAfter(0, refs.execute, key);
    await ctx.scheduler.runAfter(LEASE_MS, refs.expire, key);
    return { predictionId, created: true };
  },
});

/** The newest prediction for a scenario run, or null. */
export const latest = query({
  args: { companyId: v.string(), runId: v.string() },
  handler: async (ctx, args): Promise<PredictionReceipt | null> => {
    const row = await newestForRun(ctx, args.companyId, args.runId);
    return row ? read(row) : null;
  },
});

export const claim = internalMutation({
  args: keyArgs,
  handler: async (ctx, key): Promise<PredictionReceipt | null> => {
    const row = await rowById(ctx, key);
    if (!row) return null;
    const receipt = read(row);
    if (receipt.status !== "queued") return null;
    const next = {
      ...receipt,
      status: "running" as const,
      progress: 5,
      stage: "Reading the scenario",
      updatedAt: new Date().toISOString(),
    };
    await ctx.db.patch("timelinePredictions", row._id, { data: next });
    return next;
  },
});

export const note = internalMutation({
  args: {
    ...keyArgs,
    text: v.string(),
    progress: v.optional(v.number()),
    stage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await rowById(ctx, args);
    if (!row) return null;
    const receipt = read(row);
    if (receipt.status !== "running") return null;
    const at = new Date().toISOString();
    const next: PredictionReceipt = {
      ...receipt,
      // Never moves backwards, never claims done before finish.
      progress: Math.min(97, Math.max(receipt.progress, Math.round(args.progress ?? 0))),
      stage: (args.stage ?? receipt.stage).slice(0, 200),
      activity: [...receipt.activity, { at, text: args.text.slice(0, 300) }].slice(-MAX_ACTIVITY),
      updatedAt: at,
    };
    await ctx.db.patch("timelinePredictions", row._id, { data: next });
    return null;
  },
});

export const finish = internalMutation({
  args: { ...keyArgs, outcomeJson: v.string() },
  handler: async (ctx, args) => {
    const row = await rowById(ctx, args);
    if (!row) return null;
    const receipt = read(row);
    if (terminal(receipt.status)) return null;
    const outcome = PredictionOutcomeSchema.parse(JSON.parse(args.outcomeJson));
    const next: PredictionReceipt = {
      ...receipt,
      ...outcome,
      status: outcome.error ? "failed" : "done",
      progress: 100,
      stage: outcome.error ? "Could not finish" : "Done",
      updatedAt: new Date().toISOString(),
    };
    await ctx.db.patch("timelinePredictions", row._id, {
      data: PredictionReceiptSchema.parse(next),
    });
    return null;
  },
});

export const expire = internalMutation({
  args: keyArgs,
  handler: async (ctx, args) => {
    const row = await rowById(ctx, args);
    if (!row || Date.now() < row.leaseUntil) return null;
    const receipt = read(row);
    if (terminal(receipt.status)) return null;
    await ctx.db.patch("timelinePredictions", row._id, {
      data: {
        ...receipt,
        status: "failed",
        progress: 100,
        stage: "Timed out",
        error: "The prediction took too long and was stopped. Nothing was saved.",
        updatedAt: new Date().toISOString(),
      },
    });
    return null;
  },
});

async function load(ctx: ActionCtx, companyId: string, runId: string): Promise<WorkspaceRun> {
  const run = projectRun(await ctx.runQuery(workspaceGet, { companyId, runId }), companyId, runId);
  if (!run || run === "invalid") throw new Error(`Saved run ${runId} is missing or invalid`);
  return run;
}

const errorText = (e: unknown) =>
  e instanceof ConvexError
    ? String((e.data as { message?: unknown })?.message ?? "Rejected")
    : e instanceof Error
      ? e.message
      : "Unknown error";

export const execute = internalAction({
  args: keyArgs,
  handler: async (ctx, key): Promise<null> => {
    const receipt = await ctx.runMutation(refs.claim, key);
    if (!receipt) return null;
    const note = (text: string, progress?: number, stage?: string) =>
      ctx.runMutation(refs.note, { ...key, text, progress, stage });
    const outcome: PredictionOutcome = {
      summary: null,
      effects: [],
      rejected: [],
      interest: null,
      resultRunId: null,
      warnings: [],
      error: null,
    };
    try {
      const run = await load(ctx, receipt.companyId, receipt.runId);
      const parent = await load(ctx, receipt.companyId, receipt.parentRunId);
      if (run.inputHash !== receipt.inputHash)
        throw new Error("The scenario changed after the prediction started");
      await note(`Read "${run.label}" and the line it builds on`, 8, "Reading the brain map");
      const brain =
        receipt.field.status === "linked"
          ? await brainContext(ctx, receipt.field)
          : { status: "missing" as const, reason: receipt.field.reason };
      await note(
        brain.status === "linked"
          ? "Loaded the brain map: flags, research, learned payment habits"
          : "No brain map is linked to these books; using the saved books only",
        15,
        "Asking the agents for knock-on effects",
      );
      let proposed: ProposedEffect[] = [];
      if (!assistantConfig()) {
        outcome.warnings.push(
          "Domino's language model is not configured, so no knock-on effects were predicted. Only interest on cash is included.",
        );
      } else {
        try {
          const answer = await askAgents(run, receipt.floor, brain, note);
          proposed = answer.effects;
          outcome.summary = answer.summary;
        } catch (e) {
          console.error("timeline prediction agents failed", e);
          outcome.warnings.push(
            e instanceof AssistantUnavailable
              ? "Domino's language model is unavailable, so no knock-on effects were predicted. Only interest on cash is included."
              : "The agents could not finish, so no knock-on effects were predicted. Only interest on cash is included.",
          );
        }
      }
      await note(
        `Checking ${proposed.length} proposed ${proposed.length === 1 ? "effect" : "effects"} with the engine`,
        82,
        "Checking effects with the engine",
      );
      const screened = screenEffects(run, receipt.floor, proposed);
      outcome.effects = screened.accepted;
      outcome.rejected = screened.rejected;
      await note(
        `Adding ${CASH_YIELD_BPS / 100}% a year interest on the cash gap`,
        88,
        "Adding interest on cash",
      );
      const prediction = predict(run, parent.forecast, receipt.floor, screened.accepted);
      outcome.interest = prediction.interest;
      outcome.warnings.push(...prediction.warnings);
      if (prediction.changes.length === 0) {
        outcome.warnings.push(
          "Nothing changed cash beyond the scenario, so no predicted line was saved.",
        );
      } else {
        await note("Saving the predicted line", 94, "Saving the predicted line");
        const saved = await ctx.runMutation(workspaceRefs.simulate, {
          companyId: receipt.companyId,
          parentRunId: run.runId,
          // Keyed by content: predicting again with the same outcome reuses the saved line.
          requestId: `tl.predict.${(
            await sha256Hex(canonicalJson([run.runId, prediction.changes]))
          ).slice(0, 40)}`,
          label: `Predicted: ${run.label}`.slice(0, MAX_LABEL),
          changesJson: JSON.stringify(prediction.changes),
          reviewed: true,
        });
        outcome.resultRunId = saved.runId;
      }
    } catch (e) {
      console.error("timeline prediction failed", e);
      outcome.error = `The prediction could not be saved: ${errorText(e)}`.slice(0, 500);
    }
    await ctx.runMutation(refs.finish, { ...key, outcomeJson: JSON.stringify(outcome) });
    return null;
  },
});

const SYSTEM = `You are Domino's scenario analyst for a finance team. A person saved a what-if scenario on a 13-week cash forecast. Today the forecast only applies the scenario's own change, so its line runs parallel to the line it builds on. Your job: predict the knock-on effects that event would cause in the following weeks, so the line reflects how the business would really respond.

Ground every effect in evidence: the Brain map (flags, research about customers and vendors, learned payment habits, analyst scenarios) and the saved books (customers, open invoices, payment history). Use the tools to read them. Name the evidence in each effect.

Each effect is one engine change on one saved record:
- churn: a customer stops paying from fromDate (recordId = customer id).
- delay_invoice: an open invoice is paid days later (recordId = invoice id, days 1-120).
- lose_invoice: an open invoice is never paid (recordId = invoice id).
You never give amounts: the engine computes all money from the records. Effects may not start before the scenario's event (earliestStart). After you answer, code adds the interest the cash gap to the parent line gains or loses each week, so a lower line falls further behind over time; never describe the line as parallel. Do not model interest yourself.

Be conservative. Propose an effect only when the evidence links it to this event; mark it "likely" or "possible". Zero effects is a valid answer when nothing plausibly follows. At most ${MAX_EFFECTS} effects. Before answering, call preview_effects with your list and drop or fix anything it rejects.

Reply with JSON {"summary": "...", "effects": [...]}. The summary is two to four plain sentences for a finance lead: what you expect to happen and why. Use plain words ("lender's limit", not "covenant"). Do not state dollar amounts in the summary.`;

const EFFECT_JSON = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "recordId", "days", "fromDate", "title", "reason", "likelihood", "evidence"],
  properties: {
    kind: { type: "string", enum: [...EFFECT_KINDS] },
    recordId: { type: "string" },
    days: { type: ["integer", "null"] },
    fromDate: { type: ["string", "null"] },
    title: { type: "string" },
    reason: { type: "string" },
    likelihood: { type: "string", enum: ["likely", "possible"] },
    evidence: { type: "array", items: { type: "string" } },
  },
};
const ANSWER_JSON = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "effects"],
  properties: { summary: { type: "string" }, effects: { type: "array", items: EFFECT_JSON } },
};
const AnswerSchema = z
  .object({ summary: z.string().trim().min(1).max(1200), effects: z.array(ProposedEffectSchema) })
  .strict();

const BRAIN_SECTIONS = [
  "books",
  "flags",
  "research",
  "analyst_scenarios",
  "suggestions",
  "summary",
  "learned",
  "activity",
] as const;

type Brain = Awaited<ReturnType<typeof brainContext>> | { status: "missing"; reason: string };

function brainSection(brain: Brain, section: (typeof BRAIN_SECTIONS)[number]): unknown {
  if (brain.status !== "linked") return { missing: brain.reason };
  if ("unavailable" in brain) return { unavailable: brain.unavailable };
  const analyst = brain.analyst as Record<string, unknown>;
  switch (section) {
    case "books":
      return { books: brain.books, freshness: brain.freshness };
    case "flags":
      return brain.flags;
    case "research":
      return analyst.research ?? analyst.none ?? analyst.unavailable ?? null;
    case "analyst_scenarios":
      return analyst.scenarios ?? analyst.none ?? null;
    case "suggestions":
      return analyst.suggestions ?? analyst.none ?? null;
    case "summary":
      return {
        aiSummary: analyst.aiSummary ?? null,
        coordinator: analyst.coordinator ?? null,
        limitations: analyst.limitations ?? null,
      };
    case "learned":
      return brain.learned;
    case "activity":
      return brain.recentActivity;
  }
}

async function askAgents(
  run: WorkspaceRun,
  floor: string | null,
  brain: Brain,
  note: (text: string, progress?: number, stage?: string) => Promise<null>,
): Promise<{ summary: string; effects: ProposedEffect[] }> {
  let step = 0;
  const progressAt = () => Math.min(78, 18 + step * 7);
  const raw = await runStructured({
    system: SYSTEM,
    schema: ANSWER_JSON,
    maxSteps: 8,
    totalTimeoutMs: 4 * 60_000,
    onStep: async () => {
      step += 1;
    },
    check: (value) => {
      const parsed = AnswerSchema.safeParse(value);
      if (!parsed.success)
        return `the reply must match {"summary": string, "effects": [...]} with each effect using only ${EFFECT_KINDS.join(", ")}.`;
      return null;
    },
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          scenario: {
            label: run.label,
            ownChanges: run.ownChanges,
            earliestStart: floor,
            comparedToParent: run.comparison,
            lowPoint: run.forecast.lowPoint,
          },
          brainMapStatus:
            brain.status === "linked"
              ? { status: "linked", freshness: brain.freshness, sections: BRAIN_SECTIONS }
              : brain,
          savedBooks: companyContext(run),
        }),
      },
    ],
    tools: [
      {
        name: "read_brain_map",
        description:
          "Read one section of the company's Brain map: books (sources and freshness), flags (open findings), research (web research about customers and vendors), analyst_scenarios, suggestions, summary (analyst and coordinator notes), learned (learned rules and payment delays), activity (recent agent work).",
        input_schema: {
          type: "object",
          additionalProperties: false,
          required: ["section"],
          properties: { section: { type: "string", enum: [...BRAIN_SECTIONS] } },
        },
        run: async (input) => {
          const { section } = z
            .object({ section: z.enum(BRAIN_SECTIONS) })
            .strict()
            .parse(input);
          await note(`Read the brain map: ${section.replace("_", " ")}`, progressAt());
          return brainSection(brain, section);
        },
      },
      {
        name: "lookup_records",
        description:
          "Find saved invoices, bills or payroll by exact id or counterparty name, including paid history.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          required: ["query"],
          properties: { query: { type: "string" } },
        },
        run: async (input) => {
          const { query: term } = z
            .object({ query: z.string().max(200) })
            .strict()
            .parse(input);
          const t = term.trim().toLowerCase();
          if (!t) return { records: [] };
          await note(`Looked up records for "${term.slice(0, 60)}"`, progressAt());
          const found = recordsOf(run).filter(
            (r) => r.id.toLowerCase() === t || r.name.toLowerCase().includes(t),
          );
          return { total: found.length, records: found.slice(0, 30) };
        },
      },
      {
        name: "preview_effects",
        description:
          "Check a list of effects with the engine on top of the scenario. Returns which are accepted, why others are rejected, and the predicted low point. Nothing is saved.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          required: ["effects"],
          properties: { effects: { type: "array", items: EFFECT_JSON } },
        },
        run: async (input) => {
          const { effects } = z
            .object({ effects: z.array(ProposedEffectSchema) })
            .strict()
            .parse(input);
          const screened = screenEffects(run, floor, effects);
          const result = predict(run, run.forecast, floor, screened.accepted);
          await note(
            `Previewed ${effects.length} ${effects.length === 1 ? "effect" : "effects"} with the engine: ${screened.accepted.length} accepted`,
            progressAt(),
          );
          return {
            accepted: screened.accepted.map((a) => a.title),
            rejected: screened.rejected,
            scenarioLowPoint: run.forecast.lowPoint,
            predictedLowPoint: result.forecast.lowPoint,
            moneyUnit: "integer cents",
          };
        },
      },
    ],
  });
  return AnswerSchema.parse(raw);
}
