import {
  ChangeSchema,
  ConstraintConsequenceSchema,
  ConstraintSchema,
  EvidenceSchema,
  FieldMappingSchema,
  FixCandidateSchema,
} from "@domino/contracts";
import type { AgentJob } from "@domino/contracts";
import { describe, expect, it } from "vitest";
import type { ZodObject, ZodRawShape } from "zod";
import { type JsonSchema, type SchemaDialect, outputJsonSchema } from "./schemas";

type ObjectSchema = { properties: Record<string, JsonSchema>; required: string[] };
const jobs: AgentJob[] = ["mapSource", "readConstraints", "proposeFixes", "explain", "weeklyBrief"];
const dialects: SchemaDialect[] = ["contract", "claude"];

function items(job: AgentJob, dialect: SchemaDialect): ObjectSchema {
  const schema = outputJsonSchema(job, dialect) as {
    properties: { result: { items: ObjectSchema } };
  };
  return schema.properties.result.items;
}

function keys(shape: ZodObject<ZodRawShape>) {
  const all = Object.keys(shape.shape);
  const required = all.filter((key) => !shape.shape[key]!.isOptional());
  return { all: all.sort(), required: required.sort() };
}

function expectMatches(
  json: ObjectSchema,
  zod: ZodObject<ZodRawShape>,
  alsoRequired: string[] = [],
) {
  const expected = keys(zod);
  expect(Object.keys(json.properties).sort()).toEqual(expected.all);
  expect([...json.required].sort()).toEqual(
    [...new Set([...expected.required, ...alsoRequired])].sort(),
  );
}

function walk(schema: unknown, visit: (node: Record<string, unknown>) => void) {
  if (!schema || typeof schema !== "object") return;
  const node = schema as Record<string, unknown>;
  if (!Array.isArray(schema)) visit(node);
  for (const value of Object.values(node)) walk(value, visit);
}

describe("job JSON schemas follow the contracts", () => {
  it.each(dialects)("%s: FixCandidate, Evidence and all eight changes", (dialect) => {
    const fix = items("proposeFixes", dialect);
    // targetRiskIds is optional in the contract for legacy data but required from agents.
    expectMatches(fix, FixCandidateSchema, ["targetRiskIds"]);
    const evidence = (fix.properties.evidence as { items: ObjectSchema }).items;
    expectMatches(evidence, EvidenceSchema);

    const variants = (fix.properties.changes as { items: { anyOf: ObjectSchema[] } }).items.anyOf;
    const kinds = variants.map(
      (variant) => (variant.properties.kind as { enum: string[] }).enum[0],
    );
    expect(kinds).toEqual(ChangeSchema.options.map((option) => option.shape.kind.value));
    expect(kinds).toHaveLength(8);
    variants.forEach((variant, index) => expectMatches(variant, ChangeSchema.options[index]!));
  });

  it.each(dialects)("%s: Constraint and its C1 billId/consequence fields", (dialect) => {
    const constraint = items("readConstraints", dialect);
    expectMatches(constraint, ConstraintSchema._def.schema);
    expect(constraint.required).not.toContain("billId");
    expect(constraint.required).not.toContain("consequence");
    expectMatches(constraint.properties.consequence as ObjectSchema, ConstraintConsequenceSchema);
  });

  it.each(dialects)("%s: FieldMapping", (dialect) => {
    expectMatches(items("mapSource", dialect), FieldMappingSchema);
  });

  it("uses one result envelope for structured jobs and a text envelope for text jobs", () => {
    for (const dialect of dialects) {
      for (const job of jobs) {
        const schema = outputJsonSchema(job, dialect) as ObjectSchema;
        const key = job === "explain" || job === "weeklyBrief" ? "text" : "result";
        expect(Object.keys(schema.properties)).toEqual([key]);
        expect(schema.required).toEqual([key]);
        expect(schema).toMatchObject({ type: "object", additionalProperties: false });
      }
    }
  });

  it("keeps the contract record shape for CREAO and pairs for Claude", () => {
    expect(items("mapSource", "contract").properties.fields).toMatchObject({
      type: "object",
      additionalProperties: { type: "string" },
    });
    expect(items("mapSource", "claude").properties.fields).toMatchObject({ type: "array" });
  });

  it("closes every Claude object and avoids unsupported constraint keywords", () => {
    for (const job of jobs) {
      walk(outputJsonSchema(job, "claude"), (node) => {
        if (node.type === "object") expect(node.additionalProperties).toBe(false);
        for (const keyword of [
          "minimum",
          "maximum",
          "minLength",
          "maxLength",
          "pattern",
          "format",
        ]) {
          expect(node).not.toHaveProperty(keyword);
        }
        if ("minItems" in node) expect([0, 1]).toContain(node.minItems);
      });
    }
  });
});
