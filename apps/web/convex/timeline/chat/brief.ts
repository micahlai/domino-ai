import { z } from "zod";

/**
 * The story behind a what-if, as the person told it in Ask Domino: what happens, why, who it
 * touches and for how long. Saved with the chat's proposal so prediction agents can reason
 * about consequences, not only dated cash amounts. Descriptive only: it never sets a draft
 * value, and the engine never reads it.
 */
const Short = z.string().trim().min(1).max(300);
export const ScenarioBriefSchema = z
  .object({
    event: Short,
    cause: Short.nullable(),
    involves: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(120),
            kind: z.enum(["customer", "vendor", "lender", "regulator", "public", "other"]),
          })
          .strict(),
      )
      .max(6),
    customersAffected: z.enum(["yes", "no", "unknown"]),
    duration: z.enum(["one_time", "recurring", "ongoing", "unknown"]),
    visibility: z.enum(["public", "private", "unknown"]),
    notes: z.string().trim().min(1).max(500).nullable(),
  })
  .strict();
export type ScenarioBrief = z.infer<typeof ScenarioBriefSchema>;

export const BRIEF_JSON = {
  type: "object" as const,
  additionalProperties: false,
  required: ["event", "cause", "involves", "customersAffected", "duration", "visibility", "notes"],
  properties: {
    event: { type: "string" },
    cause: { type: ["string", "null"] },
    involves: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "kind"],
        properties: {
          name: { type: "string" },
          kind: { enum: ["customer", "vendor", "lender", "regulator", "public", "other"] },
        },
      },
    },
    customersAffected: { enum: ["yes", "no", "unknown"] },
    duration: { enum: ["one_time", "recurring", "ongoing", "unknown"] },
    visibility: { enum: ["public", "private", "unknown"] },
    notes: { type: ["string", "null"] },
  },
};
