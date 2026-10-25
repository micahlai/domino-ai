import type { CompanyModel, LearnedRuleVersion, Snapshot } from "@domino/contracts";
import { fixtures } from "@domino/contracts/fixtures";
import { describe, expect, it } from "vitest";
import {
  applyFlagRules,
  flagCounterparty,
  learnFromFlagDecision,
  learnFromSuggestionDecision,
  learnedPaymentDelays,
  rankWithPreferences,
  undoLearnedRule,
} from "./field-learning";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const A = "companyA";
const B = "companyB";
const DECIDED = "2026-10-25T17:00:00.000Z";
const LATER = "2026-10-25T17:05:00.000Z";
const EARLIER = "2026-10-25T16:55:00.000Z";

const spike = (id: string) => ({
  id,
  kind: "unusual_amount" as const,
  severity: "medium" as const,
  counterparty: "FIGMA",
});

function dismiss(history: LearnedRuleVersion[] = [], at = DECIDED, company = A) {
  const r = learnFromFlagDecision({
    history,
    companyId: company,
    findingId: "unusual_amount:card_w1",
    kind: "unusual_amount",
    counterparty: "FIGMA",
    decision: "rejected",
    reason: "Figma always bills twice a month",
    actorId: "demo-user",
    recordedAt: at,
  });
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.value;
}

describe("field learning", () => {
  it("turns a dismissal with a reason into a company-scoped rule version 1", () => {
    const { record, receipt } = dismiss();
    expect(record).toMatchObject({
      ruleId: "flag:unusual_amount:figma",
      version: 1,
      status: "accepted",
      rationale: "Figma always bills twice a month",
      recordedAt: DECIDED,
      scope: { kind: "company", sourceSignature: `field-company:${A}` },
      action: { kind: "flag_expectation", expect: "normal", counterparty: "FIGMA" },
    });
    expect(receipt.affectedFields).toEqual(["audit.unusual_amount.FIGMA"]);
  });

  it("does not flag the same pattern on the next audit, with a receipt", () => {
    const { history } = dismiss();
    const r = applyFlagRules({
      history: [...history],
      companyId: A,
      cutoff: LATER,
      findings: [spike("unusual_amount:card_w2"), { ...spike("other"), counterparty: "AWS" }],
    });
    expect(r.ok && r.value).toEqual({
      "unusual_amount:card_w2": expect.objectContaining({
        effect: "suppressed",
        text: "Not flagged: learned from your dismissal on Oct 25 (rule v1)",
      }),
    });
  });

  it("never applies a rule to an audit with an earlier cutoff (no backdating)", () => {
    const { history } = dismiss();
    const r = applyFlagRules({
      history: [...history],
      companyId: A,
      cutoff: EARLIER,
      findings: [spike("x")],
    });
    expect(r.ok && r.value).toEqual({});
    // A decision stamped before the latest record in the log is refused.
    const back = learnFromFlagDecision({
      history: [...history],
      companyId: A,
      findingId: "f2",
      kind: "duplicate",
      counterparty: "AWS",
      decision: "rejected",
      reason: "fine",
      actorId: "p",
      recordedAt: EARLIER,
    });
    expect(back.ok).toBe(false);
  });

  it("keeps other companies unaffected", () => {
    const { history } = dismiss();
    const r = applyFlagRules({
      history: [...history],
      companyId: B,
      cutoff: LATER,
      findings: [spike("x")],
    });
    expect(r.ok && r.value).toEqual({});
  });

  it("undo revokes the rule so the pattern is flagged again", () => {
    const first = dismiss();
    const undo = undoLearnedRule({
      history: [...first.history],
      recordId: first.record.id,
      recordedAt: LATER,
    });
    expect(undo.ok).toBe(true);
    if (!undo.ok) return;
    expect(undo.value.record).toMatchObject({ status: "revoked", revokes: first.record.id });
    const r = applyFlagRules({
      history: [...undo.value.history],
      companyId: A,
      cutoff: "2026-10-25T18:00:00.000Z",
      findings: [spike("x")],
    });
    expect(r.ok && r.value).toEqual({});
  });

  it("a confirmation supersedes and raises the pattern's severity", () => {
    const first = dismiss();
    const c = learnFromFlagDecision({
      history: [...first.history],
      companyId: A,
      findingId: "unusual_amount:card_w3",
      kind: "unusual_amount",
      counterparty: "FIGMA",
      decision: "approved",
      reason: "",
      actorId: "p",
      recordedAt: LATER,
    });
    expect(c.ok && c.value.record).toMatchObject({ version: 2, supersedes: first.record.id });
    if (!c.ok) return;
    const r = applyFlagRules({
      history: [...c.value.history],
      companyId: A,
      cutoff: "2026-10-26T00:00:00.000Z",
      findings: [spike("x")],
    });
    expect(r.ok && r.value.x).toMatchObject({
      effect: "raised",
      severityAfter: "high",
      version: 2,
    });
  });

  it("ranks an accepted fix type first and a declined one last, keeping engine order", () => {
    const acc = learnFromSuggestionDecision({
      history: [],
      companyId: A,
      suggestionId: "s1:defer_hires",
      fixKind: "defer_hires",
      fixLabel: "Defer two hires",
      decision: "accepted",
      reason: "",
      actorId: "p",
      recordedAt: DECIDED,
    });
    if (!acc.ok) throw new Error(acc.errors.join(";"));
    const dec = learnFromSuggestionDecision({
      history: [...acc.value.history],
      companyId: A,
      suggestionId: "s1:credit_line_draw",
      fixKind: "credit_line_draw",
      fixLabel: "Draw the credit line",
      decision: "declined",
      reason: "",
      actorId: "p",
      recordedAt: DECIDED,
    });
    if (!dec.ok) throw new Error(dec.errors.join(";"));
    const items = [
      { kind: "credit_line_draw" },
      { kind: "delay_bill" },
      { kind: "defer_hires" },
      { kind: "accelerate_collections" },
    ];
    const r = rankWithPreferences({
      history: [...dec.value.history],
      companyId: A,
      cutoff: LATER,
      items,
    });
    expect(r.ok && r.value.order).toEqual([2, 1, 3, 0]);
    expect(r.ok && r.value.effects[2]?.text).toBe(
      "Ranked higher: you approved this kind of fix on Oct 25 (rule v1)",
    );
    const other = rankWithPreferences({
      history: [...dec.value.history],
      companyId: B,
      cutoff: LATER,
      items,
    });
    expect(other.ok && other.value.order).toEqual([0, 1, 2, 3]);
  });

  it("names a flag's counterparty from the snapshot and reports learned payment delays", () => {
    const s: Snapshot = clone(fixtures.snapshot);
    const bill = s.bills[0];
    expect(bill && flagCounterparty(s, [bill.id])).toBe(bill?.vendor);
    const customer = s.customers[0];
    if (!customer) return;
    const model: CompanyModel = {
      ...clone(fixtures.model),
      customerDelayDays: { [customer.id]: { mean: 11.6, p90: 20, samples: 8 } },
    };
    expect(learnedPaymentDelays(s, model)[0]?.text).toBe(
      `Learned: ${customer.name} pays ~12 days late on average (from 8 payments)`,
    );
  });
});
