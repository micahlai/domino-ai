import { makeFunctionReference } from "convex/server";
import { z } from "zod";
import { FieldTraceSchema } from "../../../lib/field-trace-contract";
import type { WorkerChatContext } from "../../../lib/worker-chat-context";
import type { ActionCtx, MutationCtx, QueryCtx } from "../../_generated/server";
import type { WorkspaceRun } from "../questions/context";

/**
 * Bridge from a Timeline chat to the Field Brain map that produced its books. The company is
 * resolved only from verified identities: the seed id written by field:exportSeed plus the
 * stored link with the same seed hash and baseline run, or an already validated Worker
 * handoff. Names, profiles and Timeline company ids are shared by replicas and never used.
 */
export const FieldSourceSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("linked"),
      fieldCompanyId: z.string(),
      via: z.enum(["timeline_link", "worker_suggestion"]),
      frozen: z
        .object({
          seedId: z.string(),
          snapshotVersion: z.number().nullable(),
          asOf: z.string(),
          linkedAt: z.string().nullable(),
          analystRunId: z.string().nullable(),
        })
        .strict(),
      currentFieldSnapshotVersion: z.number().nullable(),
    })
    .strict(),
  z.object({ status: z.literal("missing"), reason: z.string() }).strict(),
]);
export type FieldSource = z.infer<typeof FieldSourceSchema>;
const SEED_ID = /^field:weekly_seed\/(.+)-v\d+$/;

export async function resolveFieldSource(
  ctx: QueryCtx | MutationCtx,
  run: WorkspaceRun,
  worker: WorkerChatContext | undefined,
): Promise<FieldSource> {
  const seed = run.baseline.seed;
  const feedVersion = async (id: string) => {
    const companyId = ctx.db.normalizeId("companies", id);
    if (!companyId || !(await ctx.db.get("companies", companyId))) return undefined;
    const feed = await ctx.db
      .query("feeds")
      .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
      .unique();
    return { companyId, version: feed?.snapshotVersion ?? null };
  };
  if (worker) {
    // beginWorker checked this handoff against the saved Field suggestion and this forecast.
    const company = await feedVersion(worker.fieldCompanyId);
    if (!company)
      return {
        status: "missing",
        reason: "The Worker suggestion's Field company no longer exists.",
      };
    return {
      status: "linked",
      fieldCompanyId: company.companyId,
      via: "worker_suggestion",
      frozen: {
        seedId: seed.id,
        snapshotVersion: worker.snapshotVersion,
        asOf: worker.inputs.snapshot.asOf,
        linkedAt: null,
        analystRunId: worker.runId,
      },
      currentFieldSnapshotVersion: company.version,
    };
  }
  const match = SEED_ID.exec(seed.id);
  const company = match ? await feedVersion(match[1] ?? "") : undefined;
  if (!match || !company)
    return {
      status: "missing",
      reason:
        "These Timeline books were not exported by a Field company, so no Brain map output is linked.",
    };
  const links = await ctx.db
    .query("timelineLinks")
    .withIndex("by_companyId", (q) => q.eq("companyId", company.companyId))
    .order("desc")
    .take(100);
  const link = links.find(
    (l) =>
      l.seedId === seed.id &&
      l.seedHash === seed.contentHash &&
      l.baselineRunId === run.baselineRunId &&
      l.timelineCompanyId === run.companyId,
  );
  if (!link)
    return {
      status: "missing",
      reason:
        "No verified Field link matches these exact Timeline books, so Brain map output is not attached.",
    };
  return {
    status: "linked",
    fieldCompanyId: company.companyId,
    via: "timeline_link",
    frozen: {
      seedId: seed.id,
      snapshotVersion: link.snapshotVersion,
      asOf: link.asOf,
      linkedAt: link.savedAt,
      analystRunId: null,
    },
    currentFieldSnapshotVersion: company.version,
  };
}

const read = <A extends Record<string, unknown>>(name: string) =>
  makeFunctionReference<"query", A, unknown>(name);
const refs = {
  status: read<{ companyId: string }>("field:status"),
  findings: read<{ companyId: string }>("field:findings"),
  latest: read<{ companyId: string }>("fieldAnalyst:latest"),
  trace: read<{ companyId: string; runId: string }>("fieldTrace:get"),
  learning: read<{ companyId: string }>("fieldLearning:list"),
  log: read<{ companyId: string; paginationOpts: { numItems: number; cursor: null } }>("field:log"),
};
const StatusSchema = z.object({
  name: z.string(),
  snapshotVersion: z.number(),
  lastSnapshotAt: z.string().nullable(),
  lastIngestAt: z.string().nullable(),
  lastIngestStatus: z.string().nullable(),
  recordCounts: z.record(z.number()).nullable(),
  openFindings: z.number(),
  openEscalations: z.number(),
  sources: z.array(
    z.object({
      kind: z.string(),
      lastPull: z.string().nullable(),
      tieOut: z.string(),
      step: z.string(),
    }),
  ),
});
const FindingSchema = z.object({
  findingId: z.string(),
  kind: z.string(),
  severity: z.string(),
  summary: z.string(),
  refs: z.array(z.string()),
  detectedAt: z.string(),
  version: z.number(),
  escalated: z.boolean(),
  status: z.string(),
  explanation: z.unknown().optional(),
});
const LatestSchema = z.object({
  runId: z.string(),
  status: z.string(),
  snapshotVersion: z.number(),
  aiSummary: FieldTraceSchema.shape.aiSummary
    .unwrap()
    .extend({ runId: z.string().optional() })
    .nullable()
    .optional(),
  coordinator: FieldTraceSchema.shape.coordinator
    .unwrap()
    .extend({ runId: z.string().optional() })
    .nullable()
    .optional(),
  research: z
    .array(
      z.object({
        name: z.string(),
        input: z.string(),
        items: z.array(z.string()).optional(),
        provider: z.string().optional(),
        fetchedAt: z.string().optional(),
        signals: z
          .array(
            z.object({
              title: z.string(),
              url: z.string(),
              source: z.string(),
              date: z.string().optional(),
              snippet: z.string(),
              kinds: z.array(z.string()),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});
const LearningSchema = z.object({
  rules: z.array(
    z.object({
      rule: z.string(),
      reason: z.string(),
      active: z.boolean(),
      source: z.string(),
      learnedAt: z.string(),
      applied: z.number(),
    }),
  ),
  paymentDelays: z.array(z.unknown()),
  asOf: z.string().nullable(),
});
const LogSchema = z.object({
  page: z.array(
    z.object({
      at: z.string(),
      actor: z.string(),
      action: z.string(),
      agent: z.string().optional(),
      summary: z.string().optional(),
    }),
  ),
});
const MAX_BRAIN_CHARS = 60_000;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

async function section<T>(load: () => Promise<T>): Promise<T | { unavailable: string }> {
  try {
    return await load();
  } catch {
    return { unavailable: "This saved Field output could not be read or failed validation." };
  }
}

/**
 * Saved Brain map output for the resolved Field company: books status, open flags, the latest
 * analyst run's scenarios, suggestions, summaries and limitations, learned rules and recent
 * activity. Raw provider receipts and tool logs are counted, never included.
 */
export async function brainContext(ctx: ActionCtx, source: FieldSource) {
  if (source.status === "missing") return { status: "missing" as const, reason: source.reason };
  const companyId = source.fieldCompanyId;
  const status = await section(async () => {
    const s = StatusSchema.parse(await ctx.runQuery(refs.status, { companyId }));
    return {
      company: s.name,
      snapshotVersion: s.snapshotVersion,
      lastSnapshotAt: s.lastSnapshotAt,
      lastIngestAt: s.lastIngestAt,
      lastIngestStatus: s.lastIngestStatus,
      recordCounts: s.recordCounts,
      openFlags: s.openFindings,
      openEscalations: s.openEscalations,
      sources: s.sources,
    };
  });
  const flags = await section(async () => {
    const all = z.array(FindingSchema).parse(await ctx.runQuery(refs.findings, { companyId }));
    return {
      total: all.length,
      included: Math.min(all.length, 40),
      items: all.slice(0, 40).map((f) => ({ ...f, summary: clip(f.summary, 300) })),
    };
  });
  const analyst = await section(async () => {
    const latest = LatestSchema.nullable().parse(await ctx.runQuery(refs.latest, { companyId }));
    if (!latest) return { none: "No Brain map analyst run is saved for this company." };
    const trace = FieldTraceSchema.nullable().parse(
      await ctx.runQuery(refs.trace, { companyId, runId: latest.runId }),
    );
    if (!trace) return { none: "The latest analyst run has no readable trace." };
    const inputs = trace.inputs;
    const candidates = [...trace.candidates].sort((a, b) => a.rank - b.rank);
    const summary = latest.aiSummary ?? trace.aiSummary;
    const coordinator = latest.coordinator ?? trace.coordinator;
    return {
      run: trace.run,
      research: {
        total: latest.research?.length ?? 0,
        items: (latest.research ?? []).slice(0, 20).map((r) => ({
          ...r,
          items: r.items?.slice(0, 10).map((s) => clip(s, 500)),
          signals: r.signals?.slice(0, 10).map((s) => ({ ...s, snippet: clip(s.snippet, 500) })),
        })),
      },
      evidence: trace.evidence,
      frozenAt: trace.frozenAt,
      inputs: inputs && {
        company: inputs.company,
        snapshot: inputs.snapshot,
        model: { id: inputs.model.id, version: inputs.model.version },
        constraints: inputs.constraints,
        coordinatorFindings: inputs.coordinatorFindings ?? null,
        sources: inputs.sources,
        connections: inputs.connections.map(
          ({ tool, status, lastSyncAt, recordsIn, recordsOut, checksOk, checksTotal }) => ({
            tool,
            status,
            lastSyncAt,
            recordsIn,
            recordsOut,
            checksOk,
            checksTotal,
          }),
        ),
        provenance: inputs.provenance && {
          ...inputs.provenance,
          reported: inputs.provenance.reported.slice(0, 30),
          assumptions: inputs.provenance.assumptions.slice(0, 20),
        },
      },
      scenarios: trace.scenarios.map((s) => ({
        id: s.id,
        title: s.title,
        basis: clip(s.basis, 400),
        status: s.status,
        changes: s.changes,
        result: s.work && {
          baseLow: s.work.baseLow,
          low: s.work.low,
          cashImpact: s.work.cashImpact,
          lowWeek: s.work.lowWeek,
          baseSurvives: s.work.baseSurvives,
          survives: s.work.survives,
          breaksAt: s.work.breaksAt ?? null,
          brokenConstraintId: s.work.brokenConstraintId ?? null,
        },
        fixes: s.fixes,
        error: s.error,
      })),
      suggestions: {
        total: candidates.length,
        included: Math.min(candidates.length, 20),
        items: candidates.slice(0, 20).map((c) => ({
          suggestionId: c.suggestionId,
          scenarioTitle: c.scenarioTitle,
          fix: c.fix,
          effect: c.effect,
          rank: c.rank,
          recommended: c.recommended,
          recommendation: c.recommendation ? clip(c.recommendation.text, 600) : null,
        })),
      },
      aiSummary: summary && {
        status: summary.status,
        reason: summary.reason,
        recommendation: summary.recommendation,
        rationale: summary.rationale,
        citedScenarios: summary.citedScenarios,
        at: summary.at,
        originRunId: latest.aiSummary?.runId ?? trace.run.runId,
      },
      coordinator: coordinator && {
        status: coordinator.status,
        summary: coordinator.summary,
        escalate: coordinator.escalate,
        focus: coordinator.focus,
        research: coordinator.research,
        at: coordinator.at,
        originRunId: latest.coordinator?.runId ?? trace.run.runId,
      },
      limitations: trace.limitations,
      truncation: trace.truncation,
      omitted: {
        activityOperations: trace.operations.length,
        providerReceipts: trace.providers.length,
        note: "Raw tool operations and provider receipts are not included.",
      },
    };
  });
  const learned = await section(async () => {
    const l = LearningSchema.parse(await ctx.runQuery(refs.learning, { companyId }));
    return {
      asOf: l.asOf,
      rulesTotal: l.rules.length,
      rules: l.rules.slice(0, 30),
      paymentDelaysTotal: l.paymentDelays.length,
      paymentDelays: l.paymentDelays.slice(0, 30),
    };
  });
  const activity = await section(async () => {
    const page = LogSchema.parse(
      await ctx.runQuery(refs.log, { companyId, paginationOpts: { numItems: 15, cursor: null } }),
    ).page;
    return page.map((r) => ({
      at: r.at,
      actor: r.actor,
      agent: r.agent ?? null,
      action: r.action,
      summary: r.summary ? clip(r.summary, 200) : null,
    }));
  });
  const latestVersion =
    "run" in analyst && analyst.run
      ? analyst.run.snapshotVersion
      : source.currentFieldSnapshotVersion;
  const frozen = source.frozen.snapshotVersion;
  const context = {
    status: "linked" as const,
    fieldCompanyId: companyId,
    resolvedBy: source.via,
    timelineBooks: source.frozen,
    freshness:
      frozen === null || latestVersion === null
        ? "unknown"
        : latestVersion === frozen
          ? "Brain map output is from the same Field snapshot version as this Timeline."
          : latestVersion > frozen
            ? `Brain map output is from Field snapshot version ${latestVersion}, newer than this Timeline's version ${frozen}. Timeline figures stay frozen; do not mix them.`
            : `Brain map output is from Field snapshot version ${latestVersion}, older than this Timeline's version ${frozen}.`,
    books: status,
    flags,
    analyst,
    learned,
    recentActivity: activity,
    truncated: [] as string[],
  };
  // Bound the prompt: drop the least essential detail first and say so.
  const trims: [string, () => void][] = [
    [
      "recentActivity",
      () => {
        context.recentActivity = [];
      },
    ],
    [
      "flags",
      () => {
        if ("items" in context.flags) {
          context.flags.items = context.flags.items.slice(0, 10);
          context.flags.included = context.flags.items.length;
        }
      },
    ],
    [
      "learned",
      () => {
        if ("rules" in context.learned)
          context.learned = {
            ...context.learned,
            rules: context.learned.rules.slice(0, 10),
            paymentDelays: [],
          };
      },
    ],
    [
      "suggestions",
      () => {
        if ("suggestions" in context.analyst && context.analyst.suggestions) {
          context.analyst.suggestions.items = context.analyst.suggestions.items.slice(0, 5);
          context.analyst.suggestions.included = context.analyst.suggestions.items.length;
        }
      },
    ],
    [
      "scenarioChanges",
      () => {
        if ("scenarios" in context.analyst && context.analyst.scenarios)
          context.analyst.scenarios = context.analyst.scenarios.map((s) => ({ ...s, changes: [] }));
      },
    ],
  ];
  for (const [name, trim] of trims) {
    if (JSON.stringify(context).length <= MAX_BRAIN_CHARS) break;
    trim();
    context.truncated.push(name);
  }
  if (JSON.stringify(context).length > MAX_BRAIN_CHARS)
    return {
      status: "linked" as const,
      fieldCompanyId: companyId,
      timelineBooks: source.frozen,
      freshness: context.freshness,
      truncated: ["Brain output exceeds the context budget"],
      unavailable:
        "The saved Brain output is too large to include safely. Do not claim it was fully read.",
    };
  return context;
}
export type BrainContext = Awaited<ReturnType<typeof brainContext>>;
