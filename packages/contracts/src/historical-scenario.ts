import { z } from "zod";
import { CalendarDateSchema, SafeCentsSchema, flagRepeats } from "./checks";
import { IdSchema } from "./core";
import {
  CurrencySchema,
  HistoricalAssumptionSchema,
  HistoricalFactSchema,
  HistoricalPredictionSchema,
  HistoricalSourceSchema,
  Sha256Schema,
  TimestampSchema,
} from "./historical";

/**
 * One hypothetical aggregate cash outflow after the cutoff, plus at most one costed
 * response. Additive: it reuses the historical prediction/assumption shapes and never
 * widens HistoricalRun.branch. The schemas check shape and internal consistency only.
 * Whether baselineRunId, facts, assumptions, rules and currency exist, whether the
 * nowcast equals the baseline run's, and whether any edge reflects real causality is
 * the engine's job (S3) and persistence's job (S4); a valid result proves none of it.
 */

type Prediction = z.infer<typeof HistoricalPredictionSchema>;
type Path = (string | number)[];
type Group = [Path, Prediction[], Prediction["kind"]];
type Effect = { low: number; point: number; high: number };
type Link = [Path, Prediction[], Prediction[], Effect];

const NonBlank = z.string().refine((s) => s.trim().length > 0, "must not be blank");
const DAY_MS = 86_400_000;
const dayMs = (date: string): number => Date.parse(`${date}T00:00:00Z`);
/** Local calendar date as written in the timestamp, before the offset. */
const localDate = (t: string): string => t.slice(0, 10);
const periodEnd = (p: Prediction): string =>
  p.period.kind === "instant" ? p.period.date : p.period.end;
const addDays = (date: string, days: number): string | undefined => {
  const d = new Date(dayMs(date) + days * DAY_MS);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
};
/**
 * Exact integer sum check. refinements also run on values that already failed the safe
 * integer checks (fractional, Infinity), and BigInt throws on those, so reject them first.
 */
const sums = (a: number, b: number, total: number): boolean =>
  [a, b, total].every((n) => Number.isSafeInteger(n)) && BigInt(a) + BigInt(b) === BigInt(total);

/** Nonnegative low/high cents, the same shape an assumption's one-time cost uses. */
const CostRange = HistoricalAssumptionSchema.shape.oneTimeCost.unwrap();

/**
 * The only event input. No fact IDs, observed values or thresholds exist here, and
 * strict objects reject any attempt to smuggle them in instead of silently dropping them.
 */
export const HistoricalScenarioEventSchema = z
  .object({
    id: IdSchema,
    description: NonBlank,
    /** TOTAL extra operating outflow over the whole interval, not per quarter or per day. */
    additionalOutflowCents: CostRange,
    /** Inclusive local dates. A single day is effectiveFrom === effectiveThrough. */
    effectiveFrom: CalendarDateSchema,
    effectiveThrough: CalendarDateSchema,
    /** Plain words on what is unknown about the amount or timing. */
    uncertainty: NonBlank,
  })
  .strict();
export type HistoricalScenarioEvent = z.infer<typeof HistoricalScenarioEventSchema>;

export const HistoricalScenarioInputSchema = z
  .object({
    baselineRunId: IdSchema,
    knowledgeCutoff: TimestampSchema,
    /** Quarter end the bands are read at. That it is a quarter end is engine validation. */
    targetDate: CalendarDateSchema,
    currency: CurrencySchema,
    event: HistoricalScenarioEventSchema,
    /** An existing case assumption, for example the A1 cost action. */
    responseAssumptionId: IdSchema.optional(),
    /** True when the event (and any response) was chosen after seeing a reveal; forces post-hoc. */
    selectedAfterReveal: z.boolean().optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    const issue = (path: Path, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    const cutoff = localDate(input.knowledgeCutoff);
    const { effectiveFrom: from, effectiveThrough: through } = input.event;
    if (!(cutoff < from))
      issue(["event", "effectiveFrom"], "event must start after the cutoff local date");
    if (from > through) issue(["event", "effectiveThrough"], "event ends before it starts");
    if (through > input.targetDate)
      issue(["event", "effectiveThrough"], "event must end by the target date");
  });
export type HistoricalScenarioInput = z.infer<typeof HistoricalScenarioInputSchema>;

/** Signed cents. low is the downside. */
export const HistoricalScenarioEffectSchema = z
  .object({ low: SafeCentsSchema, point: SafeCentsSchema, high: SafeCentsSchema })
  .strict()
  .refine((e) => e.low <= e.point && e.point <= e.high, {
    message: "effect must satisfy low <= point <= high",
    path: ["point"],
  });
export type HistoricalScenarioEffect = z.infer<typeof HistoricalScenarioEffectSchema>;

/**
 * The outcome of the response against the event branch (not the baseline). With no
 * modeled benefit inside the quarter, benefitDays is 0 and the effect is the cost alone.
 */
export const HistoricalScenarioResponseSchema = z
  .object({
    assumptionId: IdSchema,
    label: HistoricalAssumptionSchema.shape.label.exclude(["synthetic"]),
    effectiveFrom: CalendarDateSchema,
    oneTimeCost: CostRange,
    benefitLagDays: z.number().int().safe().nonnegative(),
    /** effectiveFrom + benefitLagDays; may be after the target date. */
    benefitStart: CalendarDateSchema,
    /** Inclusive days from benefitStart to the target date, 0 when the benefit starts later. */
    benefitDays: z.number().int().safe().nonnegative(),
    feasibleAtCutoff: HistoricalAssumptionSchema.shape.feasibleAtCutoff,
    /** Response branch minus event branch at the target date. */
    effectCents: HistoricalScenarioEffectSchema,
    /** Hindsight label, assumption selected after reveal, or input selectedAfterReveal. */
    postHoc: z.boolean(),
    predictions: z.array(HistoricalPredictionSchema).min(1),
  })
  .strict();
export type HistoricalScenarioResponse = z.infer<typeof HistoricalScenarioResponseSchema>;

/** event: the hypothetical input itself. prediction/response: result records. */
const NODE_KINDS = ["event", "response", "prediction"] as const;

/** One consequence in the financial chain. refId points at the event, assumption or prediction. */
export const HistoricalScenarioImpactNodeSchema = z
  .object({
    id: IdSchema,
    kind: z.enum(NODE_KINDS),
    refId: IdSchema,
    /** Plain words for the UI. */
    label: NonBlank,
  })
  .strict();
export type HistoricalScenarioImpactNode = z.infer<typeof HistoricalScenarioImpactNodeSchema>;

export const HistoricalScenarioImpactRefSchema = z
  .object({ kind: z.enum(["fact", "assumption", "rule", "prediction", "event"]), id: IdSchema })
  .strict();

/**
 * from causes to, by the stated basis. deterministic: arithmetic on listed inputs.
 * assumption: rests on an analyst/case assumption. rule: an explicit supplied rule.
 * hypothesis: follows only if the hypothetical event happened. Never implies a
 * management decision, a default or insolvency unless a rule edge names that rule.
 */
export const HistoricalScenarioImpactEdgeSchema = z
  .object({
    id: IdSchema,
    from: IdSchema,
    to: IdSchema,
    basis: z.enum(["deterministic", "assumption", "rule", "hypothesis"]),
    explanation: NonBlank,
    refs: z.array(HistoricalScenarioImpactRefSchema).min(1),
  })
  .strict();
export type HistoricalScenarioImpactEdge = z.infer<typeof HistoricalScenarioImpactEdgeSchema>;

/** The ref kind each non-deterministic basis must cite at least once. */
const REQUIRED_REF = { assumption: "assumption", rule: "rule", hypothesis: "event" } as const;

export const HistoricalScenarioResultSchema = z
  .object({
    input: HistoricalScenarioInputSchema,
    method: z.object({ id: IdSchema, version: z.string().min(1) }).strict(),
    /** Origin to cutoff, shared by every branch. Prediction IDs are unique across the result. */
    nowcast: z.array(HistoricalPredictionSchema).min(1),
    baselinePredictions: z.array(HistoricalPredictionSchema).min(1),
    event: z
      .object({
        /** Event branch minus baseline at the target date; counted once. */
        effectCents: HistoricalScenarioEffectSchema,
        /** True when the hypothetical was chosen after seeing a reveal (input selectedAfterReveal). */
        postHoc: z.boolean(),
        predictions: z.array(HistoricalPredictionSchema).min(1),
      })
      .strict(),
    response: HistoricalScenarioResponseSchema.optional(),
    /** The event or the response is post-hoc. */
    postHoc: z.boolean(),
    impact: z
      .object({
        nodes: z.array(HistoricalScenarioImpactNodeSchema),
        edges: z.array(HistoricalScenarioImpactEdgeSchema),
      })
      .strict(),
  })
  .strict()
  .superRefine((r, ctx) => {
    const issue = (path: Path, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    const { input } = r;
    const cutoff = localDate(input.knowledgeCutoff);

    // Response presence mirrors the request.
    if ((input.responseAssumptionId === undefined) !== (r.response === undefined))
      issue(["response"], "response must be present exactly when the input requests one");
    else if (r.response && r.response.assumptionId !== input.responseAssumptionId)
      issue(["response", "assumptionId"], "response is not the requested assumption");

    // Predictions: kinds, periods, currency, and unique IDs across all groups.
    const groups: Group[] = [
      [["nowcast"], r.nowcast, "nowcast"],
      [["baselinePredictions"], r.baselinePredictions, "forecast"],
      [["event", "predictions"], r.event.predictions, "forecast"],
    ];
    if (r.response) groups.push([["response", "predictions"], r.response.predictions, "forecast"]);
    const all = groups.flatMap(([path, list]) => list.map((p, i) => ({ p, at: [...path, i] })));
    flagRepeats(
      ctx,
      all,
      (x) => x.p.id,
      (i) => [...all[i]!.at, "id"],
      "duplicate prediction id",
    );
    for (const [path, list, kind] of groups)
      for (const [i, p] of list.entries()) {
        if (p.kind !== kind) issue([...path, i, "kind"], `expected a ${kind} prediction`);
        if (p.currency !== input.currency)
          issue([...path, i, "currency"], "prediction currency differs from the scenario");
        const end = periodEnd(p);
        if (kind === "nowcast" ? end > cutoff : end !== input.targetDate)
          issue(
            [...path, i, "period"],
            kind === "nowcast"
              ? "a nowcast must end by the cutoff local date"
              : "a branch forecast must end on the target date",
          );
      }

    // The event effect is exactly the negated total outflow range, applied once.
    const outflow = input.event.additionalOutflowCents;
    if (r.event.effectCents.low !== -outflow.high || r.event.effectCents.high !== -outflow.low)
      issue(["event", "effectCents"], "event effect must be the negated outflow range");

    // Each branch equals the previous one plus its effect, metric by metric.
    const chain: Link[] = [
      [["event", "predictions"], r.event.predictions, r.baselinePredictions, r.event.effectCents],
    ];
    if (r.response)
      chain.push([
        ["response", "predictions"],
        r.response.predictions,
        r.event.predictions,
        r.response.effectCents,
      ]);
    const key = (p: Prediction): string => `${p.metric}|${JSON.stringify(p.period)}`;
    const bandOf = (p: Prediction) => p.range ?? { low: p.cents, high: p.cents };
    for (const [path, next, prev, effect] of chain) {
      flagRepeats(ctx, next, key, (i) => [...path, i], "duplicate metric and period in one branch");
      if (next.length !== prev.length)
        issue(path, "a branch must predict the same metrics and periods as the one it follows");
      const before = new Map(prev.map((p) => [key(p), p]));
      for (const [i, p] of next.entries()) {
        const q = before.get(key(p));
        if (!q) {
          issue([...path, i], "no matching prediction in the previous branch");
          continue;
        }
        if (
          !sums(q.cents, effect.point, p.cents) ||
          !sums(bandOf(q).low, effect.low, bandOf(p).low) ||
          !sums(bandOf(q).high, effect.high, bandOf(p).high)
        )
          issue([...path, i], "prediction is not the previous branch plus the stated effect");
      }
    }

    // Post-hoc status: event taint from the input, scenario taint from event or response.
    const res = r.response;
    if (input.selectedAfterReveal && !r.event.postHoc)
      issue(["event", "postHoc"], "an event chosen after the reveal is post-hoc");
    if (r.postHoc !== (r.event.postHoc || res?.postHoc === true))
      issue(["postHoc"], "scenario post-hoc must be true exactly when the event or response is");

    // Response timing, cost, feasibility and response post-hoc status.
    if (res) {
      if (!(cutoff < res.effectiveFrom && res.effectiveFrom <= input.targetDate))
        issue(
          ["response", "effectiveFrom"],
          "response must take effect after the cutoff, inside the target quarter",
        );
      const start = addDays(res.effectiveFrom, res.benefitLagDays);
      if (res.benefitStart !== start)
        issue(["response", "benefitStart"], "benefit start is effectiveFrom plus the lag");
      const days = Math.max(0, (dayMs(input.targetDate) - dayMs(res.benefitStart)) / DAY_MS + 1);
      if (res.benefitDays !== days)
        issue(
          ["response", "benefitDays"],
          "benefit days must run from benefit start to the target",
        );
      if (
        res.benefitDays === 0 &&
        (res.effectCents.low !== -res.oneTimeCost.high ||
          res.effectCents.high !== -res.oneTimeCost.low)
      )
        issue(
          ["response", "effectCents"],
          "with no benefit inside the quarter the effect is the negated cost range",
        );
      if ((res.label === "hindsight" || input.selectedAfterReveal) && !res.postHoc)
        issue(["response", "postHoc"], "hindsight or post-reveal choices are post-hoc");
    }

    // Impact graph: unique IDs, resolvable endpoints and refs, deterministic basis rules, acyclic.
    const { nodes, edges } = r.impact;
    flagRepeats(
      ctx,
      nodes,
      (n) => n.id,
      (i) => ["impact", "nodes", i, "id"],
      "duplicate node id",
    );
    flagRepeats(
      ctx,
      edges,
      (e) => e.id,
      (i) => ["impact", "edges", i, "id"],
      "duplicate edge id",
    );
    flagRepeats(
      ctx,
      nodes,
      (n) => `${n.kind}|${n.refId}`,
      (i) => ["impact", "nodes", i, "refId"],
      "two nodes for the same record",
    );
    const predictionIds = new Set(all.map((x) => x.p.id));
    for (const [i, n] of nodes.entries()) {
      const ok =
        n.kind === "event"
          ? n.refId === input.event.id
          : n.kind === "response"
            ? n.refId === res?.assumptionId
            : predictionIds.has(n.refId);
      if (!ok) issue(["impact", "nodes", i, "refId"], `${n.kind} node does not match the result`);
    }
    if (nodes.filter((n) => n.kind === "event").length !== 1)
      issue(["impact", "nodes"], "the graph needs exactly one event node");
    if (nodes.some((n) => n.kind === "response") && !res)
      issue(["impact", "nodes"], "a response node needs a response");

    const nodeIds = new Set(nodes.map((n) => n.id));
    const next = new Map<string, string[]>();
    const indegree = new Map([...nodeIds].map((id) => [id, 0]));
    for (const [i, e] of edges.entries()) {
      for (const end of ["from", "to"] as const)
        if (!nodeIds.has(e[end])) issue(["impact", "edges", i, end], "edge node not found");
      if (nodeIds.has(e.from) && nodeIds.has(e.to)) {
        next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
        indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
      }
      for (const [j, ref] of e.refs.entries())
        if (
          (ref.kind === "event" && ref.id !== input.event.id) ||
          (ref.kind === "prediction" && !predictionIds.has(ref.id))
        )
          issue(["impact", "edges", i, "refs", j], `${ref.kind} ref does not match the result`);
      const need = e.basis === "deterministic" ? undefined : REQUIRED_REF[e.basis];
      if (need && !e.refs.some((x) => x.kind === need))
        issue(["impact", "edges", i, "refs"], `a ${e.basis} edge must cite a ${need} ref`);
    }
    // Kahn: anything left unprocessed sits on or behind a cycle.
    const ready = [...indegree].filter(([, d]) => d === 0).map(([id]) => id);
    let seen = 0;
    for (let id = ready.pop(); id !== undefined; id = ready.pop()) {
      seen += 1;
      for (const to of next.get(id) ?? []) {
        const d = (indegree.get(to) ?? 0) - 1;
        indegree.set(to, d);
        if (d === 0) ready.push(to);
      }
    }
    if (seen < nodeIds.size) issue(["impact", "edges"], "impact graph has a cycle");
  });
export type HistoricalScenarioResult = z.infer<typeof HistoricalScenarioResultSchema>;

// ---------- S4 stored scenario envelope (scenario-persistence-v1) ----------

/** Frozen disclosure taint. Flags only elevate result.postHoc; they never clear it. */
export const HistoricalScenarioTaintSchema = z
  .object({
    eventSelectedAfterReveal: z.boolean(),
    responseSelectedAfterReveal: z.boolean(),
    protocolResponsePostHoc: z.boolean(),
    assumptionPostHoc: z.boolean(),
    /** Required when any flag is set. */
    reason: NonBlank.optional(),
  })
  .strict()
  .refine(
    (t) =>
      t.reason !== undefined ||
      !(
        t.eventSelectedAfterReveal ||
        t.responseSelectedAfterReveal ||
        t.protocolResponsePostHoc ||
        t.assumptionPostHoc
      ),
    { message: "a set taint flag needs a reason", path: ["reason"] },
  );
export type HistoricalScenarioTaint = z.infer<typeof HistoricalScenarioTaintSchema>;

/**
 * historicalRuns.run for kind=scenario. NOT a HistoricalRun; HistoricalRun.branch is
 * unchanged. Event parent is the baseline; response parent is an event-only scenario.
 * Hash values and parent ownership are verified by persistence, not here.
 */
export const StoredHistoricalScenarioSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: IdSchema,
    caseId: IdSchema,
    createdAt: TimestampSchema,
    baselineRunId: IdSchema,
    parentRunId: IdSchema,
    baselineRowHash: Sha256Schema,
    baselineInputHash: Sha256Schema,
    scenarioInputHash: Sha256Schema,
    scenarioInput: HistoricalScenarioInputSchema,
    result: HistoricalScenarioResultSchema,
    taint: HistoricalScenarioTaintSchema,
  })
  .strict()
  .superRefine((s, ctx) => {
    const issue = (path: Path, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    const t = s.taint;
    if (JSON.stringify(s.result.input) !== JSON.stringify(s.scenarioInput))
      issue(["result", "input"], "result input differs from the stored scenario input");
    if (s.scenarioInput.baselineRunId !== s.baselineRunId)
      issue(["scenarioInput", "baselineRunId"], "scenario input names another baseline");
    if (s.id === s.parentRunId || s.id === s.baselineRunId)
      issue(["id"], "a scenario cannot be its own parent");
    const isResponse = s.scenarioInput.responseAssumptionId !== undefined;
    if (isResponse === (s.parentRunId === s.baselineRunId))
      issue(
        ["parentRunId"],
        "an event's parent is the baseline; a response's parent is its event scenario",
      );
    if (t.eventSelectedAfterReveal && !s.result.event.postHoc)
      issue(["result", "event", "postHoc"], "event taint must mark the event post-hoc");
    const responseTaint =
      t.responseSelectedAfterReveal || t.protocolResponsePostHoc || t.assumptionPostHoc;
    if (!s.result.response) {
      if (responseTaint) issue(["taint"], "an event-only scenario has no response taint");
    } else {
      if (responseTaint && !s.result.response.postHoc)
        issue(["result", "response", "postHoc"], "response taint must mark the response post-hoc");
      // A response inherits its parent event's disclosure taint.
      if (t.eventSelectedAfterReveal && !s.result.response.postHoc)
        issue(["result", "response", "postHoc"], "event taint must mark the response post-hoc");
    }
  });
export type StoredHistoricalScenario = z.infer<typeof StoredHistoricalScenarioSchema>;

/**
 * A1 and its dependency closure from a version-pinned package, cutoff-eligible basis only.
 * Closure is checked here; cutoff eligibility and package hashes are persistence checks.
 */
export const ScenarioResponseExtensionSchema = z
  .object({
    sources: z.array(HistoricalSourceSchema),
    facts: z.array(HistoricalFactSchema),
    assumptions: z.array(HistoricalAssumptionSchema).min(1),
    selectedAssumptionId: IdSchema,
    contentHash: Sha256Schema,
  })
  .strict()
  .superRefine((x, ctx) => {
    const issue = (path: Path, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    const sources = new Set(x.sources.map((s) => s.id));
    const facts = new Set(x.facts.map((f) => f.id));
    const assumptions = new Set(x.assumptions.map((a) => a.id));
    if (!assumptions.has(x.selectedAssumptionId))
      issue(["selectedAssumptionId"], "selected assumption is not in the extension");
    for (const [i, f] of x.facts.entries()) {
      if (f.kind === "reported" && !sources.has(f.sourceId))
        issue(["facts", i, "sourceId"], "fact source missing from closure");
      if (f.kind === "derived")
        for (const id of f.derivedFrom)
          if (!facts.has(id))
            issue(["facts", i, "derivedFrom"], "derived input missing from closure");
    }
    // Same rule as HistoricalCase: depend only on earlier assumptions, so no cycle or self-loop.
    const earlier = new Set<string>();
    for (const [i, a] of x.assumptions.entries()) {
      for (const id of a.dependsOn)
        if (assumptions.has(id) && !earlier.has(id))
          issue(
            ["assumptions", i, "dependsOn"],
            "an assumption may depend only on assumptions listed before it",
          );
      earlier.add(a.id);
      for (const id of a.basisFactIds)
        if (!facts.has(id))
          issue(["assumptions", i, "basisFactIds"], "basis fact missing from closure");
      for (const id of a.dependsOn)
        if (!assumptions.has(id))
          issue(["assumptions", i, "dependsOn"], "dependency missing from closure");
    }
  });
export type ScenarioResponseExtension = z.infer<typeof ScenarioResponseExtensionSchema>;

/** historicalRuns.snapshot for kind=scenario. */
export const StoredScenarioSnapshotSchema = z
  .object({
    /** Copied byte-for-byte from the verified baseline row; its shape is owned there. */
    baselineSnapshot: z.unknown().refine((v) => v !== undefined, "baseline snapshot is required"),
    baselineSnapshotHash: Sha256Schema,
    responseExtension: ScenarioResponseExtensionSchema.optional(),
    protocolSnapshot: z
      .object({
        protocolId: IdSchema,
        protocolHash: Sha256Schema,
        responsePostHoc: z.boolean(),
        responsePostHocReason: NonBlank.optional(),
        caveats: z.object({ method: NonBlank, cost: NonBlank, unknownDownside: NonBlank }).strict(),
      })
      .strict()
      .refine((p) => p.responsePostHoc === (p.responsePostHocReason !== undefined), {
        message: "a post-hoc protocol response needs a reason, and only it has one",
        path: ["responsePostHocReason"],
      }),
    /** Pinned mapping/resolution/rule versions. Empty only for legacy curated baselines. */
    knowledgeVersionIds: z.array(IdSchema),
    legacyKnowledge: z.boolean(),
  })
  .strict()
  .refine((s) => s.legacyKnowledge === (s.knowledgeVersionIds.length === 0), {
    message: "knowledge versions are empty exactly when tagged legacy",
    path: ["knowledgeVersionIds"],
  });
export type StoredScenarioSnapshot = z.infer<typeof StoredScenarioSnapshotSchema>;
