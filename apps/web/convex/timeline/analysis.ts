import { canonicalJson } from "@domino/contracts";
import {
  type GenericDatabaseReader,
  type GenericMutationCtx,
  internalActionGeneric,
  makeFunctionReference,
} from "convex/server";
import { v } from "convex/values";
import { z } from "zod";
import {
  candidates,
  checkSource,
  projectRisk,
  resilience,
  responsesFor,
  sameForecast,
} from "./analysis/compute";
import {
  ANALYSIS_METHOD,
  type AnalysisReceipt,
  AnalysisReceiptSchema,
  AnalysisResponseSchema,
  AnalysisRiskSchema,
  LEASE_MS,
  exactReceipt,
} from "./analysis/receipt";
import { type Key, type StartResult, analysisRefs as refs } from "./analysis/refs";
import {
  type AnalysisDataModel,
  analysisInternalMutation,
  analysisMutation,
  analysisQuery,
} from "./analysis/table";
import { type WorkspaceRun, projectRun, workspaceGet } from "./questions/context";
import {
  checkRequestId,
  checkRowSize,
  parseExactJson,
  reject,
  requiredText,
  sha256Hex,
} from "./workspaceInput";
import { workspaceRefs } from "./workspaceRefs";

const keyArgs = { companyId: v.string(), analysisId: v.string() };
type Db = GenericDatabaseReader<AnalysisDataModel>;
const atId = (db: Db, key: Key) =>
  db
    .query("timelineAnalyses")
    .withIndex("by_company_and_analysisId", (q) =>
      q.eq("companyId", key.companyId).eq("analysisId", key.analysisId),
    )
    .unique();
function read(row: {
  companyId: string;
  analysisId: string;
  runId: string;
  data: unknown;
}): AnalysisReceipt {
  try {
    const receipt = exactReceipt(row.data);
    if (
      receipt.companyId !== row.companyId ||
      receipt.analysisId !== row.analysisId ||
      receipt.runId !== row.runId
    )
      throw new Error("Identity mismatch");
    return receipt;
  } catch {
    return reject("INTEGRITY", "The saved analysis failed its integrity check");
  }
}
function source(raw: unknown, companyId: string, runId: string): WorkspaceRun {
  const run = projectRun(raw, companyId, runId);
  if (!run) reject("RUN_NOT_FOUND", "No saved run with this id in this company");
  if (run === "invalid") reject("INTEGRITY", "The selected run failed its integrity check");
  return run;
}
const terminal = (status: AnalysisReceipt["status"]) => !["queued", "running"].includes(status);
function finish(
  r: AnalysisReceipt,
  errorCode: string | null,
  warnings: string[],
  summary: AnalysisReceipt["resilience"],
): AnalysisReceipt {
  const now = new Date().toISOString();
  const status = errorCode ? (r.risks.length ? "partial" : "failed") : "succeeded";
  return exactReceipt({
    ...r,
    status,
    finishedAt: now,
    resilience: summary,
    warnings: [...r.warnings, ...warnings].slice(0, 30),
    errorCode,
    operation: {
      ...r.operation,
      status,
      startedAt: r.operation.startedAt ?? now,
      finishedAt: now,
      updatedAt: now,
      outputRefs:
        status === "failed"
          ? []
          : [
              r.analysisId,
              ...r.risks.flatMap((x) => (x.runId ? [x.runId] : [])),
              ...r.responses.flatMap((x) => (x.runId ? [x.runId] : [])),
            ],
    },
  });
}

/** Request keys are scoped to this company and bind the first exact launch/retry payload. */
async function launch(
  ctx: GenericMutationCtx<AnalysisDataModel>,
  args: { companyId: string; runId: string; requestId: string; reviewed: boolean },
  from: string | null,
): Promise<StartResult> {
  checkRequestId(args.requestId);
  const companyId = requiredText("companyId", args.companyId, 200);
  const runId = requiredText("runId", args.runId, 200);
  if (!args.reviewed) reject("REVIEW_REQUIRED", "Review the analysis scope before starting");
  const requestHash = await sha256Hex(
    canonicalJson({ method: ANALYSIS_METHOD, companyId, runId, from, reviewed: true }),
  );
  const prior = await ctx.db
    .query("timelineAnalyses")
    .withIndex("by_company_and_requestId", (q) =>
      q.eq("companyId", companyId).eq("requestId", args.requestId),
    )
    .unique();
  if (prior) {
    if (prior.requestHash !== requestHash)
      reject("REQUEST_CONFLICT", "This requestId was used for a different analysis launch");
    read(prior);
    return { companyId, analysisId: prior.analysisId, created: false };
  }
  const run = source(await ctx.runQuery(workspaceGet, { companyId, runId }), companyId, runId);
  checkSource(run);
  const digest = await sha256Hex(canonicalJson([companyId, args.requestId]));
  const analysisId = `timeline:analysis/${digest}`;
  const now = new Date().toISOString();
  const receipt = exactReceipt({
    schemaVersion: 1,
    companyId,
    analysisId,
    runId,
    inputHash: run.inputHash,
    constraintVersion: run.constraintVersion,
    status: "queued",
    methodVersion: ANALYSIS_METHOD,
    savedAt: now,
    finishedAt: null,
    operation: {
      schemaVersion: 1,
      id: `timeline:operation/analysis-${digest}`,
      ownerDomain: "timeline",
      status: "queued",
      title: "Test up to three possible risks and costed responses",
      dependencies: [],
      evidenceRefs: [{ kind: "domain", id: runId }],
      outputRefs: [],
      createdAt: now,
      updatedAt: now,
    },
    risks: [],
    responses: [],
    resilience: null,
    warnings: [
      "All risks and responses are hypothetical simulations. Starting analysis does not approve or execute a response.",
    ],
    errorCode: null,
  });
  await ctx.db.insert("timelineAnalyses", {
    companyId,
    analysisId,
    runId,
    requestId: args.requestId,
    requestHash,
    sourceAnalysisId: from,
    leaseUntil: Date.now() + LEASE_MS,
    claimed: false,
    data: receipt,
  });
  await ctx.scheduler.runAfter(0, refs.execute, { companyId, analysisId });
  await ctx.scheduler.runAfter(LEASE_MS, refs.expire, { companyId, analysisId });
  return { companyId, analysisId, created: true };
}
export const start = analysisMutation({
  args: { companyId: v.string(), runId: v.string(), requestId: v.string(), reviewed: v.boolean() },
  handler: (ctx, args) => launch(ctx, args, null),
});
export const retry = analysisMutation({
  args: { ...keyArgs, requestId: v.string(), reviewed: v.boolean() },
  handler: async (ctx, args): Promise<StartResult> => {
    const row = await atId(ctx.db, args);
    if (!row) reject("NOT_FOUND", "No analysis with this id in this company");
    const receipt = read(row);
    if (receipt.status !== "failed" && receipt.status !== "partial")
      reject("RETRY_UNAVAILABLE", "Only failed or partial analyses can be retried");
    return launch(
      ctx,
      {
        companyId: args.companyId,
        runId: receipt.runId,
        requestId: args.requestId,
        reviewed: args.reviewed,
      },
      args.analysisId,
    );
  },
});
export const get = analysisQuery({
  args: keyArgs,
  handler: async (ctx, args): Promise<AnalysisReceipt | null> => {
    const row = await atId(ctx.db, args);
    return row ? read(row) : null;
  },
});
export const list = analysisQuery({
  args: { companyId: v.string(), runId: v.string() },
  handler: async (ctx, args): Promise<AnalysisReceipt[]> => {
    const rows = await ctx.db
      .query("timelineAnalyses")
      .withIndex("by_company_and_runId", (q) =>
        q.eq("companyId", args.companyId).eq("runId", args.runId),
      )
      .order("desc")
      .take(20);
    return rows.map(read);
  },
});
export const expire = analysisInternalMutation({
  args: keyArgs,
  handler: async (ctx, args) => {
    const row = await atId(ctx.db, args);
    if (!row) return null;
    const receipt = read(row);
    if (terminal(receipt.status) || Date.now() < row.leaseUntil) return null;
    const next = finish(
      receipt,
      "LEASE_EXPIRED",
      [
        "The bounded job stopped before finishing. Saved progress remains available; a reviewed retry starts a separate attempt.",
      ],
      receipt.resilience,
    );
    await ctx.db.patch(row._id, { data: next });
    return null;
  },
});
export const claim = analysisInternalMutation({
  args: keyArgs,
  handler: async (ctx, args): Promise<AnalysisReceipt | null> => {
    const row = await atId(ctx.db, args);
    if (!row) return null;
    const r = read(row);
    if (terminal(r.status) || row.claimed) return null;
    if (Date.now() >= row.leaseUntil) {
      await ctx.db.patch(row._id, {
        data: finish(r, "LEASE_EXPIRED", ["The queued job expired before starting."], null),
      });
      return null;
    }
    const now = new Date().toISOString();
    const next = exactReceipt({
      ...r,
      status: "running",
      operation: { ...r.operation, status: "running", startedAt: now, updatedAt: now },
    });
    await ctx.db.patch(row._id, { claimed: true, data: next });
    return next;
  },
});
const StageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("risk"), risk: AnalysisRiskSchema }).strict(),
  z.object({ kind: z.literal("response"), response: AnalysisResponseSchema }).strict(),
]);
const saveStageRef = makeFunctionReference<"mutation", Key & { stageJson: string }, boolean>(
  "timeline/analysis:saveStage",
);
/** Workspace save and receipt append share one transaction; late delivery cannot save branches. */
export const saveStage = analysisInternalMutation({
  args: { ...keyArgs, stageJson: v.string() },
  handler: async (ctx, args) => {
    const row = await atId(ctx.db, args);
    if (!row) return false;
    const r = read(row);
    if (r.status !== "running" || Date.now() >= row.leaseUntil) return false;
    const stage = parseExactJson("Analysis stage", StageSchema, args.stageJson);
    const run = source(
      await ctx.runQuery(workspaceGet, { companyId: r.companyId, runId: r.runId }),
      r.companyId,
      r.runId,
    );
    if (run.inputHash !== r.inputHash || run.constraintVersion !== r.constraintVersion)
      reject("INTEGRITY", "Analysis inputs changed");
    const item = stage.kind === "risk" ? stage.risk : stage.response;
    const prior =
      stage.kind === "risk"
        ? r.risks.find((x) => x.id === item.id)
        : r.responses.find((x) => x.id === item.id);
    if (prior) {
      if (canonicalJson({ ...prior, runId: null }) !== canonicalJson(item))
        reject("STAGE_CONFLICT", "The stage was delivered with different inputs");
      return true;
    }
    if (item.runId !== null) reject("INTEGRITY", "A new stage cannot supply a saved run id");
    const parent =
      stage.kind === "risk" ? r.runId : r.risks.find((x) => x.id === stage.response.riskId)?.runId;
    if (!parent) reject("INTEGRITY", "A response needs its saved risk parent");
    const planned = exactReceipt({
      ...r,
      risks: stage.kind === "risk" ? [...r.risks, stage.risk] : r.risks,
      responses: stage.kind === "response" ? [...r.responses, stage.response] : r.responses,
    });
    checkRowSize({ data: planned });
    const requestId = `analysis-${await sha256Hex(canonicalJson([r.analysisId, stage.kind, item.id]))}`;
    const saved = await ctx.runMutation(workspaceRefs.simulate, {
      companyId: r.companyId,
      parentRunId: parent,
      requestId,
      label: item.label,
      changesJson: JSON.stringify(item.changes),
      reviewed: true,
    });
    const result = source(
      await ctx.runQuery(workspaceGet, { companyId: r.companyId, runId: saved.runId }),
      r.companyId,
      saved.runId,
    );
    if (
      !sameForecast(item.forecast, result.forecast) ||
      canonicalJson(result.constraints) !== canonicalJson(run.constraints) ||
      canonicalJson(item.receipts) !== canonicalJson(result.receipts)
    )
      reject("INTEGRITY", "Saved scenario differs from its tested result");
    if (stage.kind === "risk")
      planned.risks[planned.risks.length - 1] = { ...stage.risk, runId: saved.runId };
    else
      planned.responses[planned.responses.length - 1] = { ...stage.response, runId: saved.runId };
    planned.operation.updatedAt = new Date().toISOString();
    await ctx.db.patch(row._id, { data: exactReceipt(planned) });
    return true;
  },
});
const FinishSchema = z
  .object({
    resilience: AnalysisReceiptSchema.shape.resilience,
    warnings: AnalysisReceiptSchema.shape.warnings,
    errorCode: z.string().max(200).nullable(),
  })
  .strict();
const finishRef = makeFunctionReference<"mutation", Key & { outcomeJson: string }, null>(
  "timeline/analysis:complete",
);
export const complete = analysisInternalMutation({
  args: { ...keyArgs, outcomeJson: v.string() },
  handler: async (ctx, args) => {
    const row = await atId(ctx.db, args);
    if (!row) return null;
    const r = read(row);
    if (r.status !== "running") return null;
    if (Date.now() >= row.leaseUntil) {
      await ctx.db.patch(row._id, {
        data: finish(
          r,
          "LEASE_EXPIRED",
          ["The bounded job expired; completed stages remain saved."],
          r.resilience,
        ),
      });
      return null;
    }
    const outcome = parseExactJson("Analysis outcome", FinishSchema, args.outcomeJson);
    await ctx.db.patch(row._id, {
      data: finish(r, outcome.errorCode, outcome.warnings, outcome.resilience),
    });
    return null;
  },
});
/** One claimed delivery, no automatic re-execution; reviewed retry is a new immutable attempt. */
export const execute = internalActionGeneric({
  args: keyArgs,
  handler: async (ctx, args): Promise<null> => {
    const receipt = await ctx.runMutation(refs.claim, args);
    if (!receipt) return null;
    const warnings: string[] = [];
    let errorCode: string | null = null;
    let summary: AnalysisReceipt["resilience"] = null;
    try {
      const run = source(
        await ctx.runQuery(workspaceGet, { companyId: receipt.companyId, runId: receipt.runId }),
        receipt.companyId,
        receipt.runId,
      );
      if (
        run.inputHash !== receipt.inputHash ||
        run.constraintVersion !== receipt.constraintVersion
      )
        throw new Error("Input mismatch");
      const generated = candidates(run);
      warnings.push(...generated.warnings);
      for (const candidate of generated.risks) {
        try {
          const risk = projectRisk(run, candidate);
          if (
            !(await ctx.runMutation(saveStageRef, {
              ...args,
              stageJson: JSON.stringify({ kind: "risk", risk }),
            }))
          )
            return null;
          const responses = responsesFor(run, risk);
          if (!responses.length)
            warnings.push(
              `No supported costed response improved the low point for ${risk.id}. Negotiation, fees and later effects may need separate review.`,
            );
          for (const response of responses)
            if (
              !(await ctx.runMutation(saveStageRef, {
                ...args,
                stageJson: JSON.stringify({ kind: "response", response }),
              }))
            )
              return null;
        } catch {
          errorCode = "STAGE_FAILED";
          warnings.push(
            `Risk ${candidate.id.slice(0, 120)} or its responses could not be saved or tested. That stage is incomplete; no success is claimed.`,
          );
        }
      }
      try {
        summary = errorCode === null ? resilience(run, generated.risks) : null;
        if (errorCode !== null)
          warnings.push(
            "The index is withheld because at least one scenario or response stage is incomplete.",
          );
      } catch {
        errorCode = "INDEX_UNAVAILABLE";
        warnings.push(
          "The weighted scenario index could not be computed within the supported rules and budget.",
        );
      }
    } catch {
      errorCode = "ANALYSIS_FAILED";
      warnings.push(
        "Analysis could not finish. No provider explanation or unvalidated financial result was used.",
      );
    }
    await ctx.runMutation(finishRef, {
      ...args,
      outcomeJson: JSON.stringify({ resilience: summary, warnings, errorCode }),
    });
    return null;
  },
});
