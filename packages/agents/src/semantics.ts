import type { AgentJob, Change, Constraint, Evidence, FixCandidate } from "@domino/contracts";
import type { JobInputs } from "./types";

/**
 * Checks Zod cannot express because they need the job input: evidence must point at
 * supplied material and fixes must target supplied risks and records. Failing here sends
 * the attempt back to the router as invalid output, so retry/fallback still applies.
 */
export function satisfiesJobRules(job: AgentJob, input: unknown, value: unknown): boolean {
  if (job === "readConstraints") {
    return constraintsCiteDocuments(input as JobInputs["readConstraints"], value as Constraint[]);
  }
  if (job === "proposeFixes") {
    return fixesFitBranch(input as JobInputs["proposeFixes"], value as FixCandidate[]);
  }
  return true;
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

function citesDocument(documents: JobInputs["readConstraints"], evidence: Evidence): boolean {
  if (evidence.source !== "document" || !evidence.quote?.trim()) return false;
  const quote = squash(evidence.quote);
  return documents.some(
    (document) => evidence.ref.startsWith(document.name) && squash(document.text).includes(quote),
  );
}

function constraintsCiteDocuments(
  documents: JobInputs["readConstraints"],
  constraints: Constraint[],
): boolean {
  if (new Set(constraints.map((constraint) => constraint.id)).size !== constraints.length) {
    return false;
  }
  return constraints.every(
    (constraint) =>
      citesDocument(documents, constraint.evidence) &&
      (!constraint.consequence || citesDocument(documents, constraint.consequence.evidence)),
  );
}

function fixesFitBranch({ branch, snapshot }: JobInputs["proposeFixes"], fixes: FixCandidate[]) {
  if (new Set(fixes.map((fix) => fix.id)).size !== fixes.length) return false;
  const risks = new Set(branch.riskIds ?? []);
  const invoices = new Set(snapshot.invoices.map((invoice) => invoice.id));
  const customers = new Set(snapshot.customers.map((customer) => customer.id));
  const bills = new Map(snapshot.bills.map((bill) => [bill.id, bill]));

  const changeFits = (change: Change): boolean => {
    switch (change.kind) {
      case "delay_invoice":
      case "lose_invoice":
      case "discount_early_pay":
        return invoices.has(change.invoiceId);
      case "churn":
        return customers.has(change.customerId);
      case "delay_bill": {
        const bill = bills.get(change.billId);
        return bill !== undefined && !bill.critical;
      }
      default:
        return true;
    }
  };

  return fixes.every(
    (fix) =>
      fix.targetRiskIds?.every((id) => risks.has(id)) &&
      fix.evidence.length > 0 &&
      fix.changes.every(changeFits),
  );
}
