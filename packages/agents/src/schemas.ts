import {
  ConstraintSchema,
  FieldMappingSchema,
  FixCandidateSchema,
  SourceKindSchema,
} from "@domino/contracts";
import type { AgentJob } from "@domino/contracts";
import { z } from "zod";

/** Bump when prompts, envelopes or schemas change so cached results are not reused. */
export const AGENT_SCHEMA_VERSION = "e6b-1";

export const structuredJobs = ["mapSource", "readConstraints", "proposeFixes"] as const;
export type StructuredJob = (typeof structuredJobs)[number];
export type TextJob = Exclude<AgentJob, StructuredJob>;

export function isStructuredJob(job: AgentJob): job is StructuredJob {
  return (structuredJobs as readonly string[]).includes(job);
}

const nonemptyText = z.string().trim().min(1);
const sentenceSegmenter = new Intl.Segmenter("en", { granularity: "sentence" });
const explanation = nonemptyText.refine(
  (value) =>
    [...sentenceSegmenter.segment(value)].filter((part) => part.segment.trim()).length <= 3,
  "explain must contain at most three sentences",
);

/** Authoritative output validation. JSON schemas below only guide the model. */
export const outputSchemas = {
  mapSource: z.array(FieldMappingSchema),
  readConstraints: z.array(ConstraintSchema),
  proposeFixes: z.array(FixCandidateSchema),
  explain: explanation,
  weeklyBrief: nonemptyText,
};

/** Structured jobs answer {"result": [...]}; text jobs answer {"text": "..."}. Nothing else. */
export const structuredEnvelope = z.object({ result: z.unknown() }).strict();
export const textEnvelope = z.object({ text: z.string() }).strict();

export type JsonSchema = { [key: string]: unknown };

/**
 * "contract" is the exact contract shape, shown to CREAO agents and in prompts.
 * "claude" is the same shape restricted to keywords Claude structured outputs accept:
 * every object closes additionalProperties, so FieldMapping.fields travels as an array of
 * {canonical, source} pairs and numeric/length bounds are left to the Zod validation.
 */
export type SchemaDialect = "contract" | "claude";

const str = (description?: string): JsonSchema =>
  description ? { type: "string", description } : { type: "string" };
const num = (description?: string): JsonSchema =>
  description ? { type: "number", description } : { type: "number" };
const int = (description?: string): JsonSchema =>
  description ? { type: "integer", description } : { type: "integer" };
const isoDate = (dialect: SchemaDialect): JsonSchema =>
  dialect === "contract"
    ? { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "ISO date YYYY-MM-DD" }
    : { type: "string", description: "ISO date YYYY-MM-DD" };
const cents = (description: string): JsonSchema => int(`Integer cents. ${description}`);

function object(properties: Record<string, JsonSchema>, optional: string[] = []): JsonSchema {
  return {
    type: "object",
    properties,
    required: Object.keys(properties).filter((key) => !optional.includes(key)),
    additionalProperties: false,
  };
}

function evidence(): JsonSchema {
  return object(
    {
      source: { type: "string", enum: [...SourceKindSchema.options] },
      ref: str("Record id, or a document location such as loan.pdf#7.2"),
      quote: str("Exact words copied from a supplied document"),
      note: str("One plain sentence"),
    },
    ["quote"],
  );
}

function change(dialect: SchemaDialect): JsonSchema {
  const kind = (value: string): JsonSchema => ({ type: "string", enum: [value] });
  const id = str();
  const date = isoDate(dialect);
  const percent: JsonSchema =
    dialect === "contract"
      ? { type: "number", minimum: 0, maximum: 100 }
      : num("Percent from 0 to 100");
  return {
    anyOf: [
      object({ kind: kind("delay_invoice"), invoiceId: id, days: int("Whole days") }),
      object({ kind: kind("lose_invoice"), invoiceId: id }),
      object({ kind: kind("churn"), customerId: id, fromDate: date }),
      object({ kind: kind("add_cash"), date, amount: cents("Copied, never computed"), label: id }),
      object({
        kind: kind("remove_cash"),
        date,
        amount: cents("Copied, never computed"),
        label: id,
      }),
      object({ kind: kind("delay_bill"), billId: id, days: int("Whole days") }),
      object({ kind: kind("discount_early_pay"), invoiceId: id, percent, payOn: date }),
      object({
        kind: kind("shift_hire"),
        label: id,
        monthlyCost: cents("Copied from the input"),
        fromDate: date,
        toDate: date,
      }),
    ],
  };
}

function fieldMapping(dialect: SchemaDialect): JsonSchema {
  const fields: JsonSchema =
    dialect === "contract"
      ? {
          type: "object",
          additionalProperties: { type: "string" },
          description: "canonical field -> source field path, for example {amount: amount_due}",
        }
      : {
          type: "array",
          description: "One pair per canonical field; each canonical field appears once",
          items: object({ canonical: str("Canonical field"), source: str("Source field path") }),
        };
  return object({
    source: { type: "string", enum: [...SourceKindSchema.options] },
    entity: {
      type: "string",
      enum: ["customers", "invoices", "bankTxns", "bills", "cardTxns", "payroll", "deals"],
    },
    fields,
    transforms: { type: "array", items: str("Plain note on a conversion") },
    endpoint: str(),
  });
}

function constraint(): JsonSchema {
  return object(
    {
      id: str(),
      label: str("Plain words, for example Lender's minimum"),
      kind: { type: "string", enum: ["min_cash", "pay_by_date", "min_runway_months"] },
      limit: num(
        "Cents for min_cash; whole allowed late days for pay_by_date; months for min_runway_months",
      ),
      evidence: evidence(),
      billId: str("Only for pay_by_date: the bill this applies to"),
      consequence: object({ label: str(), evidence: evidence() }),
    },
    ["billId", "consequence"],
  );
}

function fixCandidate(dialect: SchemaDialect): JsonSchema {
  return object({
    id: str(),
    label: str(),
    changes: { type: "array", minItems: 1, items: change(dialect) },
    costNote: str("Plain sentence on what the fix gives up, without new arithmetic"),
    risk: { type: "string", enum: ["low", "medium", "high"] },
    evidence: { type: "array", minItems: 1, items: evidence() },
    targetRiskIds: {
      type: "array",
      items: str(),
      description: "Risk ids copied from branch.riskIds; [] only for a genuinely global fix",
    },
  });
}

const itemSchemas: Record<StructuredJob, (dialect: SchemaDialect) => JsonSchema> = {
  mapSource: fieldMapping,
  readConstraints: () => constraint(),
  proposeFixes: fixCandidate,
};

/** The single result envelope a provider must return for a job. */
export function outputJsonSchema(job: AgentJob, dialect: SchemaDialect): JsonSchema {
  if (!isStructuredJob(job)) {
    return object({ text: str(job === "explain" ? "At most three sentences" : "The brief") });
  }
  return object({ result: { type: "array", items: itemSchemas[job](dialect) } });
}
