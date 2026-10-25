import {
  CompanyModelSchema,
  ConstraintSchema,
  type FixCandidate,
  type RiskEvent,
  SnapshotSchema,
} from "@domino/contracts";
import { fixtures } from "@domino/contracts/fixtures";
import { engine } from "@domino/engine";
import type { Id } from "../_generated/dataModel";
import { type MutationCtx, internalMutation } from "../_generated/server";
import { computedPrefix, reject, runEngine } from "../lib/computed";
import { CompanyFields, parse } from "../lib/parse";
import { loadInputs, recomputeCompany } from "../lib/publish";

const MARKER = "computed.seed";
const NAME = "Kestrel Data (computed prototype)";

/**
 * Create a separate computed company once. Only the fixture snapshot, model and constraints
 * are copied, as explicitly synthetic inputs; every output comes from the engine. The
 * illustrative fixture company and its decisions are never read or changed.
 */
export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    const marker = await ctx.db
      .query("log")
      .filter((q) => q.eq(q.field("action"), MARKER))
      .first();
    if (marker) {
      const existing = await ctx.db.get(marker.companyId);
      if (!existing) throw new Error("Computed demo company is missing; repair the local database");
      return { companyId: existing._id, created: false };
    }
    const companyId = await insertInputs(ctx);
    const { snapshot, model, constraints } = await loadInputs(ctx, companyId);
    const risks = runEngine("scanRisks", () => engine.scanRisks(snapshot, model, constraints));
    const proposals = demoProposals(companyId, risks);
    await ctx.db.insert("log", {
      companyId,
      actor: "engine",
      action: "demo.proposals",
      refs: proposals.map((fix) => fix.id),
      at: new Date().toISOString(),
    });
    await recomputeCompany(ctx, companyId, { proposals, action: "engine.recompute" });
    return { companyId, created: true };
  },
});

async function insertInputs(ctx: MutationCtx): Promise<Id<"companies">> {
  const asOf = fixtures.snapshot.asOf;
  const companyId = await ctx.db.insert(
    "companies",
    parse(CompanyFields, {
      name: NAME,
      profile: "kestrel",
      currentWeek: 0,
      today: asOf,
      status: "ready",
    }),
  );
  await ctx.db.insert("snapshots", {
    companyId,
    asOf,
    data: parse(SnapshotSchema, fixtures.snapshot),
  });
  await ctx.db.insert("models", {
    companyId,
    version: fixtures.model.version,
    data: parse(CompanyModelSchema, fixtures.model),
  });
  for (const constraint of fixtures.constraints)
    await ctx.db.insert("constraints", { companyId, data: parse(ConstraintSchema, constraint) });
  for (const kind of ["stripe", "nessie", "crm", "ramp", "books", "payroll", "document"] as const)
    await ctx.db.insert("sources", {
      companyId,
      kind,
      baseUrl:
        kind === "nessie" ? "https://prod-api.nessieisreal.com" : `http://localhost:4010/${kind}`,
      mappings: [],
      lastPull: null,
      tieOut: "pending",
      step: "Synthetic sample inputs for the computed prototype; live checks have not run",
    });
  await ctx.db.insert("log", {
    companyId,
    actor: "engine",
    action: MARKER,
    refs: [fixtures.snapshot.companyId, "synthetic-inputs"],
    at: new Date().toISOString(),
  });
  return companyId;
}

/**
 * Demo proposals reuse only the fixtures' change instructions. Gains are never copied: the
 * engine scores them. Early payment targets the scanned late-payment risk for its own invoice;
 * the hiring delay is explicitly global.
 */
export function demoProposals(companyId: string, risks: RiskEvent[]): FixCandidate[] {
  const prefix = computedPrefix(companyId);
  const [early, hire] = fixtures.fixes;
  const offer = early?.changes[0];
  if (!early || !hire || offer?.kind !== "discount_early_pay")
    reject("MISSING_INPUT", "Demo proposal instructions are missing");
  // A late-payment risk delays its own invoice once; its delay_customer carries the slip to the
  // customer's later receipts, so only invoice-targeted changes decide the match.
  const late = risks.filter((risk) => {
    const own = risk.changes.filter((c) => "invoiceId" in c);
    return (
      own.length === 1 && own[0]?.kind === "delay_invoice" && own[0].invoiceId === offer.invoiceId
    );
  });
  if (late.length !== 1 || !late[0])
    reject("MISSING_INPUT", `No single late-payment risk was found for ${offer.invoiceId}`);
  const note = (ref: string) => ({
    source: "learned" as const,
    ref: `demo-proposal:${ref}`,
    note: "Demo proposal from a sample change instruction, not AI output. The engine computes its effect.",
  });
  return [
    {
      ...early,
      id: `${prefix}demo_fix_early_pay`,
      label: `Demo proposal: ${early.label}`,
      evidence: [note(early.id)],
      targetRiskIds: [late[0].id],
    },
    {
      ...hire,
      id: `${prefix}demo_fix_delay_hire`,
      label: `Demo proposal: ${hire.label}`,
      evidence: [note(hire.id)],
      targetRiskIds: [],
    },
  ];
}
