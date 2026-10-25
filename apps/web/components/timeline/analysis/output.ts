// Browser-safe validation mirror of the frozen TL6 envelope; no backend runtime import.
import {
  BOUNDARY_INTEGER_MAX,
  DomainIdSchema,
  type Forecast,
  ForecastSchema,
  HistoryWeekSchema,
  WeeklyResultRefV1Schema,
  canonicalJson,
  safeParseJsonText,
} from "@domino/contracts";
import { z } from "zod";
import type { RuleReceipt } from "../workspace/api";

const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((s) => s.trim().length > 0);
export const CentsSchema = z
  .number()
  .int()
  .safe()
  .min(-BOUNDARY_INTEGER_MAX)
  .max(BOUNDARY_INTEGER_MAX);
export const DateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const date = new Date(`${s}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === s;
  });
export const MondaySchema = DateSchema.refine((s) => new Date(`${s}T00:00:00Z`).getUTCDay() === 1);
export const RunIdSchema = DomainIdSchema.refine((s) => s.startsWith("timeline:workspace/"));
export const CompanyIdSchema = text(128);
const timestamp = z.string().datetime();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const MAX_OUTPUT_BYTES = 900_000;
export const jsonBytes = (value: unknown) =>
  new TextEncoder().encode(canonicalJson(value)).byteLength;

// The shared exact boundary requires integers for every number. This Timeline-owned read
// envelope instead allows fractional runway months, while all money remains bounded cents.
export function exact<T extends z.ZodTypeAny>(schema: T) {
  return z.unknown().transform((raw, ctx): z.output<T> => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, fatal: true });
      return z.NEVER;
    }
    if (canonicalJson(raw) !== canonicalJson(parsed.data)) {
      ctx.addIssue({ code: "custom", message: "Unknown field or omitted default", fatal: true });
      return z.NEVER;
    }
    return parsed.data;
  });
}

export const SafeForecastSchema = exact(ForecastSchema).superRefine((forecast, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  for (const [i, week] of forecast.weeks.entries()) {
    if (!MondaySchema.safeParse(week.weekStart).success) fail("Forecast week is not a Monday");
    for (const key of ["opening", "inflow", "outflow", "closing", "usable"] as const)
      if (!CentsSchema.safeParse(week[key]).success) fail("Unsafe forecast money");
    if (
      i > 0 &&
      Date.parse(week.weekStart) - Date.parse(forecast.weeks[i - 1]?.weekStart ?? "") !== 604800000
    )
      fail("Forecast weeks are not consecutive");
  }
  if (!CentsSchema.safeParse(forecast.lowPoint.usable).success) fail("Unsafe low point");
  if (
    !forecast.weeks.some(
      (w) => w.weekStart === forecast.lowPoint.weekStart && w.usable === forecast.lowPoint.usable,
    ) ||
    forecast.weeks.some((w) => w.usable < forecast.lowPoint.usable)
  )
    fail("Low point differs from the saved weeks");
});

const HistorySchema = exact(HistoryWeekSchema).superRefine((week, ctx) => {
  if (
    !MondaySchema.safeParse(week.weekStart).success ||
    !CentsSchema.safeParse(week.closing).success ||
    !CentsSchema.safeParse(week.usable).success
  )
    ctx.addIssue({ code: "custom", message: "Invalid history week" });
});
export const ReceiptSchema = z
  .object({
    constraintId: text(128),
    constraintVersion: text(128),
    label: text(200),
    kind: z.enum(["min_cash", "min_runway_months", "pay_by_date"]),
    status: z.enum(["breached", "clear", "beyond_horizon", "unable"]),
    relation: z.enum(["new", "pre_existing", "resolved", "clear", "outside_horizon", "unable"]),
    limit: z.number().finite(),
    unit: z.enum(["cents", "months", "days"]),
    value: z.number().finite().nullable(),
    shortfall: z.number().finite().nullable(),
    date: DateSchema.nullable(),
    weekStart: MondaySchema.nullable(),
    actionLabels: z.array(text(1000)).max(64),
    evidence: z.array(text(4000)).max(64),
  })
  .strict()
  .superRefine((receipt, ctx) => {
    const units = { min_cash: "cents", min_runway_months: "months", pay_by_date: "days" };
    if (receipt.unit !== units[receipt.kind])
      ctx.addIssue({ code: "custom", message: "Rule unit differs from its kind" });
    const allowedRelations = {
      clear: ["clear", "resolved", "unable"],
      breached: ["new", "pre_existing", "unable"],
      unable: ["unable"],
      beyond_horizon: ["outside_horizon"],
    };
    if (
      !allowedRelations[receipt.status].includes(receipt.relation) ||
      (receipt.status === "beyond_horizon" && receipt.kind !== "pay_by_date")
    )
      ctx.addIssue({ code: "custom", message: "Rule status and relation differ" });
    for (const n of [receipt.limit, receipt.value, receipt.shortfall]) {
      if (n === null) continue;
      const valid =
        receipt.unit === "months"
          ? Number.isFinite(n) && n >= 0 && n <= 120
          : CentsSchema.safeParse(n).success;
      if (!valid) ctx.addIssue({ code: "custom", message: "Unsafe rule value" });
    }
  });
export const ReceiptsSchema = z
  .array(ReceiptSchema)
  .max(32)
  .superRefine((receipts, ctx) => {
    if (new Set(receipts.map((r) => r.constraintId)).size !== receipts.length)
      ctx.addIssue({ code: "custom", message: "Repeated rule receipt" });
  });
const lowPoint = z.object({ weekStart: MondaySchema, usable: CentsSchema }).strict();
const route = z
  .string()
  .min(1)
  .max(256)
  .regex(/^\/[^\s]*$/);
const scenario = z
  .object({
    runId: RunIdSchema,
    label: text(200),
    forecast: SafeForecastSchema,
    lowPoint,
    receipts: ReceiptsSchema,
    route,
  })
  .strict();
export const HealthSchema = z
  .object({
    rating: z.enum(["ok", "watch", "at_risk"]),
    reasonCodes: z
      .array(z.enum(["negative_usable_cash", "rule_breach", "unknown_rules", "no_rules"]))
      .max(4),
    evaluatedRuleCount: z.number().int().min(0).max(32),
    unknownRuleCount: z.number().int().min(0).max(32),
    scope: text(1000),
  })
  .strict();

export function healthFor(
  forecast: Forecast,
  receipts: RuleReceipt[],
): z.infer<typeof HealthSchema> {
  const unknownRuleCount = receipts.filter(
    (r) => r.status === "unable" || r.status === "beyond_horizon" || r.relation === "unable",
  ).length;
  const reasonCodes: z.infer<typeof HealthSchema>["reasonCodes"] = [];
  if (forecast.weeks.some((w) => w.usable < 0)) reasonCodes.push("negative_usable_cash");
  if (receipts.some((r) => r.status === "breached")) reasonCodes.push("rule_breach");
  if (unknownRuleCount > 0) reasonCodes.push("unknown_rules");
  if (receipts.length === 0) reasonCodes.push("no_rules");
  const rating =
    reasonCodes.includes("negative_usable_cash") || reasonCodes.includes("rule_breach")
      ? "at_risk"
      : unknownRuleCount > 0 || receipts.length === 0
        ? "watch"
        : "ok";
  return {
    rating,
    reasonCodes,
    evaluatedRuleCount: receipts.length - unknownRuleCount,
    unknownRuleCount,
    scope:
      "Saved 13-week forecast and stated rules only. Cash minima use weekly closes. Unknown or outside-horizon rules are not passing rules. This is not a compliance certification or a probability of survival. Scenarios are saved hypotheticals; runway is not available in this read output.",
  };
}

const OutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    methodVersion: z.literal("timeline_financial_output@1.0.0"),
    companyId: CompanyIdSchema,
    runId: RunIdSchema,
    baselineRunId: DomainIdSchema.refine((s) => s.startsWith("timeline:baseline/")),
    seedId: DomainIdSchema.refine((s) => s.startsWith("field:weekly_seed/")),
    seedHash: hash,
    inputHash: hash,
    constraintVersion: text(128),
    savedAt: timestamp,
    resultRef: WeeklyResultRefV1Schema,
    health: HealthSchema,
    receipts: ReceiptsSchema,
    chart: z
      .object({
        history: z.array(HistorySchema).length(26),
        forecast: SafeForecastSchema,
        lowPoint,
        runwayMonths: z.null(),
      })
      .strict(),
    scenarios: z.array(scenario).max(20),
    scenariosTruncated: z.boolean(),
  })
  .strict()
  .superRefine((output, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (jsonBytes(output) > MAX_OUTPUT_BYTES) fail("Financial output exceeds its byte limit");
    const expectedRoute = routeFor(output.companyId, output.runId);
    const ref = output.resultRef;
    if (
      canonicalJson(output.health) !==
      canonicalJson(healthFor(output.chart.forecast, output.receipts))
    )
      fail("Health differs from saved forecast and rule receipts");
    if (
      ref.seedId !== output.seedId ||
      ref.seedHash !== output.seedHash ||
      ref.route !== expectedRoute ||
      ref.branchIds.length !== 1 ||
      ref.branchIds[0] !== output.runId ||
      ref.health?.rating !== output.health.rating ||
      ref.health?.lowPointCents !== output.chart.lowPoint.usable ||
      ref.health?.lowPointWeek !== output.chart.lowPoint.weekStart
    )
      fail("Result reference scope differs");
    if (canonicalJson(output.chart.lowPoint) !== canonicalJson(output.chart.forecast.lowPoint))
      fail("Chart low point differs");
    const history = output.chart.history;
    for (let i = 1; i < history.length; i++)
      if (
        Date.parse(history[i]?.weekStart ?? "") - Date.parse(history[i - 1]?.weekStart ?? "") !==
        604800000
      )
        fail("History is not consecutive");
    if (
      Date.parse(output.chart.forecast.weeks[0]?.weekStart ?? "") -
        Date.parse(history[25]?.weekStart ?? "") !==
      604800000
    )
      fail("History and forecast horizons do not meet");
    const ids = new Set<string>();
    for (const child of output.scenarios) {
      if (ids.has(child.runId) || child.runId === output.runId) fail("Repeated scenario");
      ids.add(child.runId);
      if (
        child.route !== routeFor(output.companyId, child.runId) ||
        child.forecast.weeks[0]?.weekStart !== output.chart.forecast.weeks[0]?.weekStart ||
        canonicalJson(child.lowPoint) !== canonicalJson(child.forecast.lowPoint)
      )
        fail("Scenario scope differs");
    }
  });

export const FinancialOutputSchema = exact(OutputSchema);
export type FinancialOutput = z.infer<typeof FinancialOutputSchema>;
export const parseFinancialOutputJson = (text: unknown) => {
  if (
    typeof text !== "string" ||
    text.length > MAX_OUTPUT_BYTES ||
    new TextEncoder().encode(text).byteLength > MAX_OUTPUT_BYTES
  )
    return FinancialOutputSchema.safeParse(null);
  return safeParseJsonText(FinancialOutputSchema, text);
};
export const routeFor = (companyId: string, runId: string) =>
  `/c/${encodeURIComponent(companyId)}/timeline?runId=${encodeURIComponent(runId)}`;
