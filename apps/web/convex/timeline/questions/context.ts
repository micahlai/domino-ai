import {
  ChangeSchema,
  CompanyModelSchema,
  ConstraintSchema,
  DominoSchema,
  ForecastSchema,
  HistoryWeekSchema,
  OperationSummaryV1Schema,
  PastEventSchema,
  WeeklySeedV1Schema,
} from "@domino/contracts";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";

/**
 * timeline/workspace:get from kb/features/timeline/TL2-TL5-interface.md. Typed `unknown` on
 * purpose: questions never trust another module's output without parsing it here.
 */
export const workspaceGet = makeFunctionReference<
  "query",
  { companyId: string; runId: string },
  unknown
>("timeline/workspace:get");

const SavedBaselineSchema = z
  .object({
    runId: z.string(),
    companyId: z.string(),
    companyName: z.string(),
    seedHash: z.string(),
    inputHash: z.string(),
    methodVersion: z.string(),
    assumptionNote: z.string(),
    model: CompanyModelSchema,
    constraints: z.array(ConstraintSchema),
    seed: WeeklySeedV1Schema,
    forecast: ForecastSchema,
    dominoes: z.array(DominoSchema),
    history: z.array(HistoryWeekSchema),
    pastEvents: z.array(PastEventSchema),
    savedAt: z.string(),
  })
  .strict();

const RuleReceiptSchema = z
  .object({
    constraintId: z.string(),
    constraintVersion: z.string(),
    label: z.string(),
    kind: z.enum(["min_cash", "min_runway_months", "pay_by_date"]),
    status: z.enum(["breached", "clear", "beyond_horizon", "unable"]),
    relation: z.enum(["new", "pre_existing", "resolved", "clear", "outside_horizon", "unable"]),
    limit: z.number(),
    unit: z.enum(["cents", "months", "days"]),
    value: z.number().nullable(),
    shortfall: z.number().nullable(),
    date: z.string().nullable(),
    weekStart: z.string().nullable(),
    actionLabels: z.array(z.string()),
    evidence: z.array(z.string()),
  })
  .strict();
export type RuleReceipt = z.infer<typeof RuleReceiptSchema>;

/** Strict projection of the frozen WorkspaceRun. Drift fails closed instead of guessing. */
export const WorkspaceRunSchema = z
  .object({
    runId: z.string(),
    companyId: z.string(),
    baselineRunId: z.string(),
    parentRunId: z.string().nullable(),
    kind: z.enum(["baseline", "rules", "scenario"]),
    label: z.string(),
    savedAt: z.string(),
    inputHash: z.string(),
    methodVersion: z.string(),
    constraintVersion: z.string(),
    constraintNote: z.string(),
    constraints: z.array(ConstraintSchema),
    ownChanges: z.array(ChangeSchema),
    changes: z.array(ChangeSchema),
    forecast: ForecastSchema,
    dominoes: z.array(DominoSchema),
    receipts: z.array(RuleReceiptSchema),
    comparison: z
      .object({
        parentRunId: z.string(),
        weekly: z.array(z.object({ weekStart: z.string(), usableDelta: z.number() }).strict()),
        lowPointDelta: z.number(),
      })
      .strict()
      .nullable(),
    baseline: SavedBaselineSchema,
    operation: OperationSummaryV1Schema,
  })
  .strict();
export type WorkspaceRun = z.infer<typeof WorkspaceRunSchema>;

/**
 * Parse a workspace read and check it is the run that was asked for, inside its company.
 * Null for a missing run; "invalid" for a run that fails its shape or identity checks.
 */
export function projectRun(
  raw: unknown,
  companyId: string,
  runId: string,
): WorkspaceRun | null | "invalid" {
  if (raw === null) return null;
  const parsed = WorkspaceRunSchema.safeParse(raw);
  if (!parsed.success) return "invalid";
  const run = parsed.data;
  const seed = run.baseline.seed;
  if (
    run.runId !== runId ||
    run.companyId !== companyId ||
    run.baseline.companyId !== companyId ||
    seed.company.id !== companyId ||
    run.baseline.runId !== run.baselineRunId ||
    run.forecast.weeks.length === 0
  )
    return "invalid";
  return run;
}

/** One record a person may name: an invoice, bill, payroll run or scheduled item. */
export type RecordRef = {
  kind: "invoice" | "bill" | "payroll";
  id: string;
  /** Customer or vendor name, or "Payroll". */
  name: string;
  amount: number;
  due: string;
  paid: string | null;
  scheduledId: string | null;
};

/** Open and recent records of the run's seed, the only things answers may cite. */
export function recordsOf(run: WorkspaceRun): RecordRef[] {
  const { snapshot, scheduledItems } = run.baseline.seed;
  const customers = new Map(snapshot.customers.map((c) => [c.id, c.name]));
  const scheduled = new Map(scheduledItems.map((s) => [s.sourceRef, s.id]));
  const out: RecordRef[] = [];
  for (const i of snapshot.invoices)
    out.push({
      kind: "invoice",
      id: i.id,
      name: customers.get(i.customerId) ?? i.customerId,
      amount: i.amount,
      due: i.due,
      paid: i.paid ?? null,
      scheduledId: scheduled.get(i.id) ?? null,
    });
  for (const b of snapshot.bills)
    out.push({
      kind: "bill",
      id: b.id,
      name: b.vendor,
      amount: b.amount,
      due: b.due,
      paid: b.paid ?? null,
      scheduledId: scheduled.get(b.id) ?? null,
    });
  for (const p of snapshot.payroll)
    out.push({
      kind: "payroll",
      id: p.id,
      name: "Payroll",
      amount: p.amount,
      due: p.date,
      paid: p.date < snapshot.asOf ? p.date : null,
      scheduledId: scheduled.get(p.id) ?? null,
    });
  return out;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, " ")
    .trim();

/**
 * Records a phrase names: an exact id or scheduled-item id, a full counterparty name, or a
 * counterparty's first word (at least four letters, "Acme"). Only open records are matched
 * by name, since a person asking "what if Acme pays late" means the invoice still unpaid.
 */
export function matchRecords(phrase: string, records: RecordRef[]): RecordRef[] {
  const p = norm(phrase);
  if (!p) return [];
  const byId = records.filter(
    (r) => norm(r.id) === p || (r.scheduledId && norm(r.scheduledId) === p),
  );
  if (byId.length) return byId;
  const open = records.filter((r) => r.paid === null);
  const full = open.filter((r) => norm(r.name) === p);
  if (full.length) return full;
  return open.filter((r) => {
    const first = norm(r.name).split(" ")[0] ?? "";
    return first.length >= 4 && first === p;
  });
}

/** Phrases inside the prompt that name a record, longest first, for the grammar. */
export function namedIn(text: string, records: RecordRef[]): string[] {
  const t = ` ${norm(text)} `;
  const names = new Set<string>();
  for (const r of records) {
    names.add(r.id);
    if (r.scheduledId) names.add(r.scheduledId);
    if (r.paid !== null) continue;
    names.add(r.name);
    const first = r.name.split(/\s+/)[0] ?? "";
    if (norm(first).length >= 4) names.add(first);
  }
  const hits = [...names].filter((n) => norm(n) && t.includes(` ${norm(n)} `));
  hits.sort((a, b) => b.length - a.length);
  // Drop a short alias when a longer hit already contains it ("Acme" inside "Acme Logistics").
  return hits.filter((h, i) => !hits.slice(0, i).some((longer) => norm(longer).includes(norm(h))));
}
