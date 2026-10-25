/** Exact-run evidence only. No engine calls, provider calls, or latest-company fallbacks. */
import { CompanyModelSchema, ConstraintSchema, SnapshotSchema } from "@domino/contracts";
import { operatingProvenance } from "@domino/sim";
import { ConvexError, v } from "convex/values";
import { z } from "zod";
import { MAX_COORDINATOR_FLAGS } from "../../../packages/agents/src/fieldCreao";
import {
  type FieldTrace,
  type FieldTraceCandidate,
  FieldTraceCandidateSchema,
  FieldTraceInputsSchema,
  type FieldTraceProvider,
  FieldTraceSchema,
} from "../lib/field-trace-contract";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, type QueryCtx, query } from "./_generated/server";

type Reader = Pick<QueryCtx, "db">;
const MAX_OPERATIONS = 400;
const MAX_SCENARIOS = 20;
const MAX_CANDIDATES = 80;
const MAX_RECEIPT_BYTES = 600_000;
const MAX_OPEN_FINDINGS = 200;
const SEVERITY = { high: 0, medium: 1, low: 2 } as const;
const MISSING_COORDINATOR_FINDINGS =
  "Legacy run: coordinator findings were not pinned. Current flags and counts are not substituted.";
const bytes = (s: string) => new TextEncoder().encode(s).length;
const candidateList = z.array(FieldTraceCandidateSchema);

/** Captures only observable source metadata and the immutable snapshot reference. */
export async function pinInputs(
  ctx: Reader,
  companyId: Id<"companies">,
  snapshotId: Id<"snapshots">,
  version: number,
) {
  const company = await ctx.db.get("companies", companyId);
  const snapshotRow = await ctx.db.get("snapshots", snapshotId);
  const model = await ctx.db
    .query("models")
    .withIndex("by_company_version", (q) => q.eq("companyId", companyId))
    .order("desc")
    .first();
  if (!company || !snapshotRow || snapshotRow.companyId !== companyId || !model)
    throw new Error("The analyst needs a company, its snapshot and a model");
  const snapshot = SnapshotSchema.parse(snapshotRow.data);
  const constraints = await ctx.db
    .query("constraints")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .take(101);
  if (constraints.length > 100) throw new Error("Too many constraints to pin safely (maximum 100)");
  const sources = await ctx.db
    .query("sources")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .take(65);
  const connections = await ctx.db
    .query("connections")
    .withIndex("by_companyId_and_tool", (q) => q.eq("companyId", companyId))
    .take(65);
  if (sources.length > 64 || connections.length > 64)
    throw new Error("Too many source receipts to pin safely");
  const open = await ctx.db
    .query("findings")
    .withIndex("by_companyId_and_status", (q) => q.eq("companyId", companyId).eq("status", "open"))
    .order("desc")
    .take(MAX_OPEN_FINDINGS + 1);
  // Counts must describe the complete captured set, not silently undercount a truncated read.
  if (open.length > MAX_OPEN_FINDINGS)
    throw new Error("Too many open findings to pin safely (maximum 200)");
  const coordinatorFindings = {
    openFlags: open.length,
    openEscalations: open.filter((finding) => finding.escalated).length,
    flags: [...open]
      .sort(
        (a, b) =>
          SEVERITY[a.severity] - SEVERITY[b.severity] ||
          (a.findingId < b.findingId ? -1 : a.findingId > b.findingId ? 1 : 0),
      )
      .slice(0, MAX_COORDINATOR_FLAGS)
      .map(({ findingId, kind, severity, summary, escalated }) => ({
        findingId,
        kind,
        severity,
        summary,
        escalated,
      })),
  };
  const selection = company.operatingDemo;
  const provenance = selection ? operatingProvenance(selection, 1) : null;
  const recordCounts = Object.fromEntries(
    Object.entries(snapshot)
      .filter(([, value]) => Array.isArray(value))
      .map(([key, value]) => [key, (value as unknown[]).length]),
  );
  const pinned = FieldTraceInputsSchema.parse({
    company: {
      id: companyId,
      name: company.name,
      profile: company.profile,
      datasetId: selection?.company ?? snapshot.companyId,
      datasetScenario: selection?.scenario ?? null,
      datasetVersion: selection?.version ?? null,
    },
    snapshot: {
      id: snapshotId,
      version,
      asOf: snapshot.asOf,
      companyId: snapshot.companyId,
      cashOnHand: snapshot.cashOnHand,
      restrictedCash: snapshot.restrictedCash,
      recordCounts,
    },
    model: { id: model._id, version: model.version, data: CompanyModelSchema.parse(model.data) },
    constraints: constraints.map((row) => ConstraintSchema.parse(row.data)),
    coordinatorFindings,
    sources: sources.map(({ kind, lastPull, tieOut, step }) => ({ kind, lastPull, tieOut, step })),
    connections: connections.map(
      ({ tool, status, lastSyncAt, counts, recordsIn, recordsOut, checksOk, checksTotal }) => ({
        tool,
        status,
        lastSyncAt,
        counts,
        recordsIn,
        recordsOut,
        checksOk,
        checksTotal,
      }),
    ),
    provenance,
  });
  const json = JSON.stringify(pinned);
  if (bytes(json) > 100_000)
    throw new Error("Pinned model and source metadata exceed the 100 KB evidence limit");
  return { pinned, json };
}

export function pinnedInputs(run: Doc<"analystRuns">) {
  if (!run.traceInputs) return null;
  const pinned = FieldTraceInputsSchema.parse(JSON.parse(run.traceInputs));
  if (
    pinned.company.id !== run.companyId ||
    pinned.snapshot.id !== run.snapshotId ||
    pinned.snapshot.version !== run.snapshotVersion ||
    pinned.snapshot.asOf !== run.asOf
  )
    throw new Error("Pinned inputs do not belong to this analyst run");
  return pinned;
}

/** All numerical stages use the same model and rules. Legacy runs cannot borrow new inputs. */
export async function numericalInputs(ctx: Reader, run: Doc<"analystRuns">) {
  const pinned = pinnedInputs(run);
  if (!pinned)
    throw new Error("Legacy run has no pinned model or rules; calculations cannot be resumed");
  const snapshot = await ctx.db.get("snapshots", run.snapshotId);
  if (!snapshot || snapshot.companyId !== run.companyId)
    throw new Error("Run snapshot is missing or belongs to another company");
  const observed = SnapshotSchema.parse(snapshot.data);
  if (observed.asOf !== pinned.snapshot.asOf || observed.companyId !== pinned.snapshot.companyId)
    throw new Error("Run snapshot identity does not match its pinned inputs");
  return {
    snapshot: observed,
    model: pinned.model.data,
    constraints: pinned.constraints,
  };
}

export function runCandidates(run: Doc<"analystRuns">): FieldTraceCandidate[] {
  return run.traceCandidates ? candidateList.parse(JSON.parse(run.traceCandidates)) : [];
}

async function providerReceipts(ctx: Reader, run: Doc<"analystRuns">) {
  const receipts: FieldTraceProvider[] = [];
  let truncated = false;
  // Scope is explicitly a snapshot version, never a claim that a later run paid for a call.
  for (const kind of ["audit", "analyst", "research", "coordinator", "advisor"] as const) {
    for (const scope of [`v${run.snapshotVersion}`, `v${run.snapshotVersion}:repair`]) {
      const rows = await ctx.db
        .query("aiCalls")
        .withIndex("by_companyId_and_kind_and_scope", (q) =>
          q.eq("companyId", run.companyId).eq("kind", kind).eq("scope", scope),
        )
        .take(9);
      if (rows.length > 8) truncated = true;
      for (const row of rows.slice(0, 8)) {
        if (run.finishedAt && row.at > run.finishedAt) continue;
        receipts.push({
          id: row._id,
          provider: row.provider,
          kind,
          scope,
          status: row.status,
          at: row.at,
          attribution:
            row.analystRunId === run.runId
              ? "this_run"
              : row.analystRunId
                ? "same_snapshot"
                : "unknown",
          originRunId: row.analystRunId ?? null,
          model: row.model ?? null,
          remoteRunId: row.remoteRunId ?? null,
          detail: row.detail ?? null,
          inputTokens: row.inputTokens ?? null,
          outputTokens: row.outputTokens ?? null,
        });
      }
    }
  }
  const searches = await ctx.db
    .query("apifyRuns")
    .withIndex("by_analystRunId", (q) => q.eq("analystRunId", run.runId))
    .take(21);
  if (searches.length > 20) truncated = true;
  for (const row of searches.slice(0, 20)) {
    if (row.companyId !== run.companyId) continue;
    receipts.push({
      id: row._id,
      provider: "apify",
      kind: "research",
      scope: null,
      status: row.status,
      at: row.at,
      attribution: "this_run",
      originRunId: run.runId,
      model: null,
      remoteRunId: row.remoteRunId ?? null,
      detail: row.detail ?? null,
      inputTokens: null,
      outputTokens: null,
    });
  }
  // CRS identity and fraud checks the audit ran on payment changes in the books this run read.
  for (const status of ["open", "approved", "rejected"] as const) {
    const flags = await ctx.db
      .query("findings")
      .withIndex("by_companyId_and_status", (q) =>
        q.eq("companyId", run.companyId).eq("status", status),
      )
      .order("desc")
      .take(100);
    for (const f of flags) {
      if (!f.crs || f.version > run.snapshotVersion) continue;
      if (receipts.filter((r) => r.provider === "crs").length >= 8) {
        truncated = true;
        break;
      }
      receipts.push({
        id: f._id,
        provider: "crs",
        kind: "identity",
        scope: `v${f.version}`,
        status: f.crs.verdict === "verified" || f.crs.verdict === "signals" ? "ok" : "failed",
        at: f.crs.checkedAt,
        attribution: f.crs.cached
          ? "cached"
          : f.version === run.snapshotVersion
            ? "same_snapshot"
            : "unknown",
        originRunId: null,
        model: null,
        remoteRunId: f.crs.identity?.requestId ?? f.crs.fraud?.requestId ?? null,
        detail: `${f.crs.headline}. Sandbox persona ${f.crs.personaId} ${f.crs.personaName} stands in for the vendor's account owner`,
        inputTokens: null,
        outputTokens: null,
      });
    }
  }
  // Search reports already record cache use. Old reports lack the original caller, so say unknown.
  const research = z
    .array(
      z
        .object({
          provider: z.string().optional(),
          remoteRunId: z.string().optional(),
          cached: z.boolean().optional(),
          fetchedAt: z.string().optional(),
          originRunId: z.string().optional(),
        })
        .passthrough(),
    )
    .safeParse(run.research ?? []);
  if (research.success && research.data.length > 40) truncated = true;
  for (const entry of research.success ? research.data.slice(0, 40) : []) {
    if (entry.provider !== "apify" || !entry.remoteRunId || !entry.cached) continue;
    if (receipts.some((receipt) => receipt.remoteRunId === entry.remoteRunId)) continue;
    receipts.push({
      id: `cached:${entry.remoteRunId}`,
      provider: "apify",
      kind: "research",
      scope: null,
      status: "ok",
      at: entry.fetchedAt ?? run.startedAt,
      attribution: "cached",
      originRunId: entry.originRunId ?? null,
      model: null,
      remoteRunId: entry.remoteRunId,
      detail: entry.originRunId
        ? "Reused cached public search; no new provider call"
        : "Reused cached public search; original analyst run unknown",
      inputTokens: null,
      outputTokens: null,
    });
  }
  return { receipts, truncated };
}

/** Projection while running, or explicitly incomplete evidence for historical runs. */
async function collectTrace(ctx: Reader, run: Doc<"analystRuns">): Promise<FieldTrace> {
  const inputs = pinnedInputs(run);
  const scenarioRows = await ctx.db
    .query("analystScenarios")
    .withIndex("by_runId_and_index", (q) => q.eq("runId", run.runId))
    .take(MAX_SCENARIOS + 1);
  const logs = await ctx.db
    .query("log")
    .withIndex("by_company_and_runId", (q) =>
      q.eq("companyId", run.companyId).eq("runId", run.runId),
    )
    .order("desc")
    .take(MAX_OPERATIONS + 1);
  const providers = await providerReceipts(ctx, run);
  let candidates = runCandidates(run);
  const limitations: string[] = [];
  if (!inputs)
    limitations.push(
      "Legacy run: model, rules, company label and source provenance were not pinned. Current company data is not substituted.",
    );
  if (!inputs?.coordinatorFindings) limitations.push(MISSING_COORDINATOR_FINDINGS);
  if (!run.traceReceipt && run.status !== "running")
    limitations.push(
      "Legacy run: no immutable terminal receipt was recorded. Available exact-run rows may be incomplete.",
    );
  if (!run.traceCandidates) {
    const rows = await ctx.db
      .query("suggestions")
      .withIndex("by_companyId_and_runId", (q) =>
        q.eq("companyId", run.companyId).eq("runId", run.runId),
      )
      .take(MAX_CANDIDATES + 1);
    candidates = rows.map((row) =>
      FieldTraceCandidateSchema.parse({ ...row, recommendation: row.recommendation ?? null }),
    );
    if (!inputs)
      limitations.push(
        "Earlier open suggestions may have been replaced by later runs. Only candidates still attributed to this run are shown.",
      );
  }
  if (providers.receipts.some((p) => p.attribution === "same_snapshot"))
    limitations.push(
      "Same-snapshot provider receipts belong to their original runs. Their presence does not claim a new call or reuse of their output by this run.",
    );
  if (providers.receipts.some((p) => p.attribution === "unknown"))
    limitations.push(
      "Older provider receipts do not identify their originating analyst run; attribution is unknown.",
    );
  return FieldTraceSchema.parse({
    schemaVersion: 1,
    readOnly: true,
    run: {
      companyId: run.companyId,
      runId: run.runId,
      snapshotId: run.snapshotId,
      snapshotVersion: run.snapshotVersion,
      asOf: run.asOf,
      trigger: run.trigger,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt ?? null,
      summary: run.summary ?? null,
    },
    selection: { scenarioId: null, fixKind: null },
    evidence: inputs && run.status === "running" ? "live" : "legacy",
    frozenAt: null,
    inputs,
    scenarios: scenarioRows
      .filter((row) => row.companyId === run.companyId)
      .slice(0, MAX_SCENARIOS)
      .map((row) => ({
        id: row.scenarioId,
        index: row.index,
        agentId: row.agentId,
        title: row.title,
        basis: row.basis,
        changes: row.changes,
        status: row.status,
        work: row.work ?? null,
        fixes: row.fixes ?? [],
        error: row.error ?? null,
      })),
    candidates: candidates.slice(0, MAX_CANDIDATES),
    operations: logs
      .slice(0, MAX_OPERATIONS)
      .reverse()
      .map((row) => ({
        id: row._id,
        at: row.at,
        action: row.action,
        summary: row.summary ?? "",
        refs: row.refs,
        agentId: row.agentId ?? row.agent ?? null,
        agentKind: row.agentKind ?? null,
        parentAgentId: row.parentAgentId ?? null,
        event: row.event ?? null,
        status: row.status ?? null,
        task: row.currentTask ?? null,
        tool: row.tool ?? null,
        toolCategory: row.toolCategory ?? null,
        toolLabel: row.toolLabel ?? null,
        fromAgentId: row.fromAgentId ?? null,
        toAgentId: row.toAgentId ?? null,
      })),
    providers: providers.receipts,
    aiSummary: run.aiSummary ?? null,
    coordinator: run.coordinator ?? null,
    limitations,
    truncation: {
      operations: logs.length > MAX_OPERATIONS,
      providers: providers.truncated,
      scenarios: scenarioRows.length > MAX_SCENARIOS,
      candidates: candidates.length > MAX_CANDIDATES,
    },
  });
}

function bounded(trace: FieldTrace): string {
  const notice =
    "Evidence exceeds the saved receipt limit; omitted sections are marked in truncation. No current data was substituted.";
  for (const key of ["operations", "providers", "candidates", "scenarios"] as const) {
    while (bytes(JSON.stringify(trace)) > MAX_RECEIPT_BYTES && trace[key].length > 0) {
      trace[key].shift();
      trace.truncation[key] = true;
      if (!trace.limitations.includes(notice)) trace.limitations.push(notice);
    }
  }
  if (Object.values(trace.truncation).some(Boolean) && !trace.limitations.includes(notice))
    trace.limitations.push(notice);
  const json = JSON.stringify(FieldTraceSchema.parse(trace));
  if (bytes(json) > MAX_RECEIPT_BYTES)
    throw new Error("Trace metadata alone exceeds the saved evidence limit");
  return json;
}

/** Must run in the same transaction as the terminal transition, before another run starts. */
export async function freezeTrace(ctx: MutationCtx, runId: Id<"analystRuns">) {
  const run = await ctx.db.get("analystRuns", runId);
  if (!run || run.status === "running" || run.traceReceipt) return;
  const trace = await collectTrace(ctx, run);
  trace.evidence = run.traceInputs ? "frozen" : "legacy";
  trace.frozenAt = run.finishedAt ?? new Date().toISOString();
  trace.limitations = trace.limitations.filter(
    (line) => !line.startsWith("Legacy run: no immutable terminal"),
  );
  // Candidates are now in the receipt. Avoid retaining a second large copy on this row.
  await ctx.db.patch("analystRuns", run._id, {
    traceReceipt: bounded(trace),
    traceCandidates: undefined,
  });
}

export const get = query({
  args: {
    companyId: v.id("companies"),
    runId: v.string(),
    scenarioId: v.optional(v.string()),
    fixKind: v.optional(
      v.union(
        v.literal("credit_line_draw"),
        v.literal("delay_bill"),
        v.literal("accelerate_collections"),
        v.literal("defer_hires"),
      ),
    ),
  },
  handler: async (ctx, args): Promise<FieldTrace | null> => {
    const run = await ctx.db
      .query("analystRuns")
      .withIndex("by_company_and_runId", (q) =>
        q.eq("companyId", args.companyId).eq("runId", args.runId),
      )
      .unique();
    if (!run || run.companyId !== args.companyId) return null;
    const snapshot = await ctx.db.get("snapshots", run.snapshotId);
    if (snapshot && snapshot.companyId !== args.companyId)
      throw new ConvexError({
        code: "INVALID_TRACE",
        message: "Snapshot belongs to another company",
      });
    const trace = run.traceReceipt
      ? FieldTraceSchema.parse(JSON.parse(run.traceReceipt))
      : FieldTraceSchema.parse(JSON.parse(bounded(await collectTrace(ctx, run))));
    if (
      !trace.inputs?.coordinatorFindings &&
      !trace.limitations.includes(MISSING_COORDINATOR_FINDINGS)
    )
      trace.limitations.push(MISSING_COORDINATOR_FINDINGS);
    if (
      trace.run.companyId !== args.companyId ||
      trace.run.runId !== args.runId ||
      trace.run.snapshotId !== run.snapshotId ||
      trace.run.snapshotVersion !== run.snapshotVersion
    )
      throw new ConvexError({
        code: "INVALID_TRACE",
        message: "Saved receipt does not belong to this run",
      });
    if (
      (args.scenarioId && !trace.scenarios.some((s) => s.id === args.scenarioId)) ||
      (args.fixKind &&
        (!args.scenarioId ||
          !trace.candidates.some(
            (c) => c.scenarioId === args.scenarioId && c.fix.kind === args.fixKind,
          )))
    )
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "This scenario or suggestion is not recorded in this run",
      });
    return {
      ...trace,
      selection: { scenarioId: args.scenarioId ?? null, fixKind: args.fixKind ?? null },
    };
  },
});
