import {
  BALANCE_METRICS,
  CurrencySchema,
  HistoricalAssumptionSchema,
  HistoricalFactSchema,
  HistoricalRunSchema,
  HistoricalSourceSchema,
  IdSchema,
  TimestampSchema,
} from "@domino/contracts";
import { z } from "zod";

const runFields = HistoricalRunSchema.innerType().shape;
const SnapshotSchema = z.object({
  caseId: IdSchema,
  currency: CurrencySchema,
  method: runFields.method,
  roles: z.object({
    knowledgeCutoff: TimestampSchema,
    originBalanceDate: runFields.originBalanceDate,
    usableCashFactId: IdSchema,
    totalCashFactId: IdSchema,
    operatingYtdFactId: IdSchema,
    investingYtdFactId: IdSchema,
    financingAssumptionId: IdSchema,
    fxAssumptionId: IdSchema,
  }),
  sources: z.array(HistoricalSourceSchema),
  facts: z.array(HistoricalFactSchema),
  assumptions: z.array(HistoricalAssumptionSchema),
});

const InputSchema = z.object({
  runId: IdSchema,
  run: HistoricalRunSchema,
  inputSnapshot: SnapshotSchema,
});

function invalid(message: string): never {
  throw new Error(`Invalid company knowledge input: ${message}`);
}

function exactIds(items: { id: string }[], ids: string[], kind: string): void {
  if (
    items.length !== ids.length ||
    new Set(ids).size !== ids.length ||
    items.some((item, index) => item.id !== ids[index])
  )
    invalid(`${kind} IDs must exactly match the saved run inputs in order, without duplicates`);
}

type DeepReadonly<T> = T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> } : T;

function freeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

/**
 * Projects historical.getRun's saved inputSnapshot only. Parsing detaches the packet;
 * freezing protects it from later caller edits. No current case or reveal data is read.
 *
 * loadRun verifies the stored row hash and recomputes the snapshot hash on the server.
 * This pure projection checks structure and consistency, not hash/content authenticity:
 * a caller-supplied inputHash alone cannot prove that a packet is the saved content.
 */
export function projectRunKnowledge(input: {
  runId: unknown;
  run: unknown;
  inputSnapshot: unknown;
}) {
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success)
    invalid(
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  const { runId, run, inputSnapshot: snapshot } = parsed.data;
  if (run.branch.kind !== "baseline") invalid("alternative runs are not supported");
  if (runId !== run.id) invalid("runId differs from run.id");
  if (snapshot.caseId !== run.caseId) invalid("snapshot belongs to another case");
  if (snapshot.roles.knowledgeCutoff !== run.knowledgeCutoff)
    invalid("snapshot cutoff differs from the saved run");
  if (snapshot.roles.originBalanceDate !== run.originBalanceDate)
    invalid("snapshot origin balance date differs from the saved run");
  if (snapshot.method.id !== run.method.id || snapshot.method.version !== run.method.version)
    invalid("snapshot method differs from the saved run");
  exactIds(snapshot.sources, run.inputs.sourceIds, "source");
  exactIds(snapshot.facts, run.inputs.factIds, "fact");
  exactIds(snapshot.assumptions, run.inputs.assumptionIds, "assumption");

  // HistoricalRunContextSchema requires companyName and case provenance, which getRun
  // does not return. Check its relevant relationships here without inventing metadata.
  const cutoff = Date.parse(run.knowledgeCutoff);
  const sources = new Map(snapshot.sources.map((source) => [source.id, source]));
  for (const source of snapshot.sources) {
    if (Date.parse(source.publishedAt) > cutoff) invalid("source published after the cutoff");
    if (source.amends !== undefined) {
      const original = sources.get(source.amends);
      if (!original) invalid("amended source not found");
      if (Date.parse(source.publishedAt) <= Date.parse(original.publishedAt))
        invalid("amendment must be published after the original");
    }
  }

  const earlierFacts = new Map<string, z.infer<typeof HistoricalFactSchema>>();
  for (const fact of snapshot.facts) {
    if (fact.currency !== snapshot.currency) invalid("fact currency differs from the snapshot");
    if (Date.parse(fact.availableAt) > cutoff) invalid("fact available after the cutoff");
    if (fact.kind === "reported") {
      const source = sources.get(fact.sourceId);
      if (!source) invalid("fact source is not a run input");
      if (fact.availableAt !== source.publishedAt)
        invalid("reported fact availability differs from source publication");
    } else {
      const inputs = fact.derivedFrom.map((id) => earlierFacts.get(id));
      if (inputs.some((item) => item === undefined))
        invalid("derived inputs must be run input facts listed earlier");
      const latest = Math.max(...inputs.map((item) => Date.parse(item!.availableAt)));
      if (Date.parse(fact.availableAt) !== latest)
        invalid("derived fact must inherit the latest input availability");
    }
    earlierFacts.set(fact.id, fact);
  }
  if (
    !snapshot.facts.some(
      (fact) =>
        fact.period.kind === "instant" &&
        fact.period.date === run.originBalanceDate &&
        (BALANCE_METRICS as readonly string[]).includes(fact.metric),
    )
  )
    invalid("no input balance fact at the origin balance date");

  const earlierAssumptions = new Set<string>();
  for (const assumption of snapshot.assumptions) {
    if (assumption.label === "hindsight" || assumption.selectedAfterReveal)
      invalid("a baseline cannot use hindsight or post-reveal assumptions");
    if (assumption.basisFactIds.some((id) => !earlierFacts.has(id)))
      invalid("assumption basis must be run input facts");
    if (assumption.dependsOn.some((id) => !earlierAssumptions.has(id)))
      invalid("assumption dependencies must be run inputs listed earlier");
    earlierAssumptions.add(assumption.id);
  }
  const roles = snapshot.roles;
  if (
    [
      roles.usableCashFactId,
      roles.totalCashFactId,
      roles.operatingYtdFactId,
      roles.investingYtdFactId,
    ].some((id) => !earlierFacts.has(id)) ||
    [roles.financingAssumptionId, roles.fxAssumptionId].some((id) => !earlierAssumptions.has(id))
  )
    invalid("snapshot roles must reference saved run inputs");
  if (run.predictions.some((prediction) => prediction.currency !== snapshot.currency))
    invalid("prediction currency differs from the snapshot");
  for (const rule of run.riskRules) {
    if (rule.sourceIds.some((id) => !sources.has(id))) invalid("rule source is not a run input");
    if (rule.basis === "disclosed_term" && rule.sourceIds.length === 0)
      invalid("a disclosed term needs a source");
  }

  return freeze({
    caseId: snapshot.caseId,
    runId,
    knowledgeCutoff: run.knowledgeCutoff,
    inputHash: run.inputHash,
    currency: snapshot.currency,
    method: snapshot.method,
    sources: snapshot.sources,
    facts: snapshot.facts,
    assumptions: snapshot.assumptions,
  });
}

export type RunKnowledge = ReturnType<typeof projectRunKnowledge>;
