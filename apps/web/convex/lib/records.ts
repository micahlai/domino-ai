import { BranchSchema, type Change, FixCandidateSchema } from "@domino/contracts";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { Cents, CompanyFields, parse } from "./parse";

type Reader = Pick<QueryCtx, "db">;

export function missing(message: string): never {
  throw new ConvexError({ code: "NOT_FOUND", message });
}

export async function requireCompany(ctx: Reader, id: Id<"companies">) {
  const company = await ctx.db.get(id);
  if (!company) missing("Company not found");
  parse(CompanyFields, company);
  return company;
}

export async function branchRecord(ctx: Reader, branchId: string) {
  const row = await ctx.db
    .query("branches")
    .withIndex("by_branchId", (q) => q.eq("branchId", branchId))
    .unique();
  if (!row) return null;
  const data = parse(BranchSchema, row.data);
  if (data.id !== row.branchId || data.kind !== row.kind || data.parentId !== row.parentId) {
    throw new ConvexError({
      code: "INVALID_DATA",
      message: "Branch metadata does not match its payload",
    });
  }
  return { row, data };
}

export async function requireBranch(ctx: Reader, id: string) {
  const branch = await branchRecord(ctx, id);
  if (!branch) missing("Future not found");
  await requireCompany(ctx, branch.row.companyId);
  return branch;
}

export async function candidateRecord(ctx: Reader, branchId: string, fixId: string) {
  const rows = await ctx.db
    .query("fixes")
    .withIndex("by_branch", (q) => q.eq("branchId", branchId))
    .collect();
  return (
    rows
      .map((row) => ({
        row,
        fix: parse(FixCandidateSchema, row.data),
        gain: parse(Cents, row.gain),
      }))
      .find((candidate) => candidate.fix.id === fixId) ?? null
  );
}

export function sameChanges(left: Change[], right: Change[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function recordPersonAction(
  ctx: MutationCtx,
  companyId: Id<"companies">,
  action: string,
  refs: string[],
  at: string,
) {
  await ctx.db.insert("log", { companyId, actor: "person", action, refs, at });
}

export function newestFirst(left: Doc<"approvals">, right: Doc<"approvals">) {
  return right.at.localeCompare(left.at) || right._creationTime - left._creationTime;
}
