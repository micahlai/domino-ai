import {
  type CompanyModel,
  CompanyModelSchema,
  ConstraintSchema,
  DominoSchema,
  ForecastSchema,
  HistoryWeekSchema,
  PastEventSchema,
  WeeklySeedV1Schema,
} from "@domino/contracts";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";

// Fixed TL1 interface (kb/features/timeline/TL1-interface.md). Typed references by name until the
// lead runs codegen; the browser never imports the backend module itself.

// Type aliases, not interfaces: Convex argument types need an implicit index signature.
export type SaveBaselineArgs = {
  requestId: string;
  seedJson: string;
  modelJson: string;
  constraintsJson: string;
  assumptionNote: string;
  reviewed: boolean;
};
export type SaveBaselineResult = { runId: string; companyId: string; created: boolean };
export type BaselineKey = { companyId: string; runId: string };

export const saveBaselineRef = makeFunctionReference<
  "mutation",
  SaveBaselineArgs,
  SaveBaselineResult
>("timeline/baselines:save");
export const getBaselineRef = makeFunctionReference<"query", BaselineKey, unknown>(
  "timeline/baselines:get",
);

export const SaveBaselineResultSchema = z
  .object({ runId: z.string().min(1), companyId: z.string().min(1), created: z.boolean() })
  .strict();

/** The saved projection exactly; anything extra or missing is treated as unusable. */
export const SavedBaselineSchema = z
  .object({
    runId: z.string().min(1),
    companyId: z.string().min(1),
    companyName: z.string().min(1),
    seedHash: z.string().min(1),
    inputHash: z.string().min(1),
    methodVersion: z.string().min(1),
    assumptionNote: z.string(),
    model: CompanyModelSchema,
    constraints: z.array(ConstraintSchema),
    seed: WeeklySeedV1Schema,
    forecast: ForecastSchema,
    dominoes: z.array(DominoSchema),
    history: z.array(HistoryWeekSchema),
    pastEvents: z.array(PastEventSchema),
    savedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type SavedBaseline = z.infer<typeof SavedBaselineSchema>;

export type BaselineRead =
  | { state: "loading" }
  | { state: "missing" }
  | { state: "unusable" }
  | { state: "ready"; baseline: SavedBaseline };

/** Boundary parse of the get query. undefined is loading; null is not found under that company. */
export function readBaseline(raw: unknown, key: BaselineKey): BaselineRead {
  if (raw === undefined) return { state: "loading" };
  if (raw === null) return { state: "missing" };
  const parsed = SavedBaselineSchema.safeParse(raw);
  if (!parsed.success) return { state: "unusable" };
  const b = parsed.data;
  // A record for another company or run must never be shown under this link.
  if (b.companyId !== key.companyId || b.runId !== key.runId) return { state: "unusable" };
  return { state: "ready", baseline: b };
}

/** The saved-forecast link. URLSearchParams does the encoding. */
export function baselineHref(key: BaselineKey, pathname = "/playground/timeline-seam"): string {
  const params = new URLSearchParams({ companyId: key.companyId, runId: key.runId });
  return `${pathname}?${params.toString()}`;
}

/** Both parameters or neither; a half link is reported rather than guessed. */
export function baselineKeyFromSearch(
  search: string,
): { kind: "none" } | { kind: "partial" } | { kind: "key"; key: BaselineKey } {
  const params = new URLSearchParams(search);
  const companyId = params.get("companyId") ?? "";
  const runId = params.get("runId") ?? "";
  if (!companyId && !runId) return { kind: "none" };
  if (!companyId || !runId) return { kind: "partial" };
  return { kind: "key", key: { companyId, runId } };
}

/** Explicit neutral starting model: no learned delays, recurring spend or rules. */
export const NEUTRAL_MODEL: CompanyModel = {
  version: 0,
  customerDelayDays: {},
  recurringSpend: [],
  rules: [],
};

export const NEUTRAL_ASSUMPTION_NOTE =
  "Neutral starting model: customers pay on their stated terms, no learned delays, no extra recurring spend and no learned rules. No lender's limits or other cash rules are added.";
