import {
  CentsSchema,
  ChangeSchema,
  CompanyProfileSchema,
  EvidenceSchema,
  FieldMappingSchema,
  ISODateSchema,
  IdSchema,
} from "@domino/contracts";
import { ConvexError } from "convex/values";
import { z } from "zod";

/** Parse untrusted arguments and JSON payloads without returning raw input in an error. */
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ConvexError({
      code: "INVALID_DATA",
      message: "Data does not match the expected contract",
      fields: result.error.issues.map((issue) => issue.path.join(".")),
    });
  }
  return result.data;
}

export const Cents = CentsSchema.safe();
export const CalendarDate = ISODateSchema.refine((date) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(value.getTime()) && value.toISOString().slice(0, 10) === date;
}, "Expected a real calendar date");
export const Week = CalendarDate.refine(
  (date) => new Date(`${date}T00:00:00.000Z`).getUTCDay() === 1,
  "Weeks start on Monday",
);
export const Timestamp = z.string().datetime();
export const Decision = z.enum(["approved", "rejected"]);
export const CreateCompany = z.object({
  name: z.string().trim().min(1).max(200),
  profile: CompanyProfileSchema,
});
export const AddEvent = z.object({
  companyId: IdSchema,
  label: z.string().trim().min(1).max(200),
  changes: z.array(ChangeSchema).min(1).max(100),
});
export const Approval = z.object({
  fixId: IdSchema,
  branchId: IdSchema,
  decision: Decision,
  note: z.string().trim().max(2000).optional(),
});
export const CompanyFields = z.object({
  name: z.string().trim().min(1),
  profile: CompanyProfileSchema,
  currentWeek: z.number().int().nonnegative(),
  today: CalendarDate,
  status: z.enum(["connecting", "ready"]),
});
export const SourceFields = z.object({
  mappings: z.array(FieldMappingSchema),
  lastPull: CalendarDate.nullable(),
});
export const GradeFields = z.object({
  week: Week,
  errorPct: z.number().finite().nonnegative(),
  misses: z.array(EvidenceSchema),
});
