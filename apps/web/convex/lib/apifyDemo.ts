import type { Snapshot } from "@domino/contracts";
import { PROFILES, isProfileId } from "@domino/sim";
import { usd } from "./analystScenarios";

/**
 * Demo Apify actors for the Field research agent. NEVER calls the real Apify API: every result
 * is a deterministic canned answer built from the synthetic company profile, using only facts
 * dated on or before the snapshot date (no future sim events, no answer key). Logged with
 * toolCategory "apify" and toolLabel "demo actor".
 */

export const APIFY_LABEL = "demo actor";
export type DemoActorResult = {
  actor: string;
  /** Friendly tool name for the map */
  name: string;
  input: string;
  items: string[];
};

const profileOf = (s: Snapshot) => (isProfileId(s.companyId) ? PROFILES[s.companyId] : undefined);

/** "Check customer news" (demo of an Apify news-search actor) for one customer. */
export function checkCustomerNews(s: Snapshot, customerName: string): DemoActorResult {
  const p = profileOf(s);
  const items: string[] = [];
  const leaves = p?.topCustomerLeaves;
  if (leaves && leaves.noticeOn <= s.asOf && customerName.startsWith("Halcyon"))
    items.push(
      `${customerName} was acquired and gave non-renewal notice on ${leaves.noticeOn} (demo canned result)`,
    );
  const late = p?.majorsPayLate;
  if (late && late.issuedFrom <= s.asOf)
    items.push(
      `Large customers report procurement freezes and new AP portals since ${late.issuedFrom} (demo canned result)`,
    );
  if (items.length === 0)
    items.push(`No material news found for ${customerName} (demo canned result)`);
  return {
    actor: "apify/demo-news-search",
    name: "Check customer news",
    input: customerName,
    items,
  };
}

/** "Look up company funding" (demo of an Apify funding-database actor) for the company. */
export function lookUpCompanyFunding(s: Snapshot): DemoActorResult {
  const p = profileOf(s);
  const name = p?.name ?? s.companyId;
  const items = (p?.equity ?? [])
    .filter((e) => e.date <= s.asOf)
    .map((e) => `${e.date}: ${e.label}, ${usd(e.amount)} (demo canned result)`);
  if (p?.termLoan)
    items.push(
      `Term loan from ${p.termLoan.lender}: ${usd(p.termLoan.principal)} (demo canned result)`,
    );
  if (items.length === 0) items.push(`No public funding records for ${name} (demo canned result)`);
  return {
    actor: "apify/demo-funding-lookup",
    name: "Look up company funding",
    input: name,
    items,
  };
}
