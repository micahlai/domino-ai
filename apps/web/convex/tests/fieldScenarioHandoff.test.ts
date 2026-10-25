import type { Change, CompanyModel } from "@domino/contracts";
import { constraints, model, snapshot } from "@domino/contracts/fixtures";
import { advisorCandidates, engine } from "@domino/engine";
import { createOperatingDemo } from "@domino/sim";
import { describe, expect, it } from "vitest";
import { addDays, fixCandidates, forecastScenario, pickScenarios } from "../lib/analystScenarios";
import { checkChanges, checkEffects } from "../timeline/workspaceInput";

const emptyModel: CompanyModel = {
  version: 0,
  customerDelayDays: {},
  recurringSpend: [],
  rules: [],
};
const cases = [
  { name: "contract fixture", snapshot, model, constraints },
  ...(["2u", "asana-current", "gitlab-current"] as const).map((company) => {
    const demo = createOperatingDemo({ company, scenario: "baseline" }, 1);
    return {
      name: company,
      snapshot: demo.world.snapshot,
      model: emptyModel,
      constraints: demo.constraints,
    };
  }),
];

describe("new Field scenario changes can be saved unchanged in Timeline", () => {
  it.each(cases)("validates planned risks and advisor fixes for $name", (inputs) => {
    const base = engine.forecast(inputs.snapshot, inputs.model, []);
    const horizon = {
      asOf: inputs.snapshot.asOf,
      firstWeek: base.weeks[0]!.weekStart,
      end: addDays(base.weeks.at(-1)!.weekStart, 6),
    };
    for (const scenario of pickScenarios(inputs)) {
      expect(
        () => checkChanges(scenario.changes, inputs.snapshot, horizon),
        scenario.id,
      ).not.toThrow();
      expect(
        () => checkEffects(scenario.changes, inputs.snapshot, inputs.model, horizon),
        scenario.id,
      ).not.toThrow();
      for (const candidate of advisorCandidates({
        ...inputs,
        scenario: { id: scenario.id, label: scenario.title, changes: scenario.changes },
      })) {
        const combined = [...scenario.changes, ...candidate.fix.changes];
        expect(
          () => checkChanges(combined, inputs.snapshot, horizon),
          `${scenario.id}:${candidate.kind}`,
        ).not.toThrow();
        expect(
          () => checkEffects(combined, inputs.snapshot, inputs.model, horizon),
          `${scenario.id}:${candidate.kind}`,
        ).not.toThrow();
      }
    }
  });

  it.each(cases)(
    "keeps the prior engine cash results while making generated changes valid for $name",
    (inputs) => {
      const { snapshot: s } = inputs;
      for (const scenario of pickScenarios(inputs)) {
        let legacy: Change[] = scenario.changes;
        if (scenario.id === "top_customer_leaves") {
          const churn = scenario.changes.find((change) => change.kind === "churn");
          const loss = scenario.changes.find((change) => change.kind === "lose_invoice");
          const customerId =
            churn?.kind === "churn"
              ? churn.customerId
              : s.invoices.find(
                  (invoice) => loss?.kind === "lose_invoice" && invoice.id === loss.invoiceId,
                )?.customerId;
          if (!customerId) throw new Error("Missing top customer identity");
          legacy = [
            { kind: "churn", customerId, fromDate: s.asOf },
            ...s.invoices
              .filter(
                (invoice) =>
                  invoice.customerId === customerId &&
                  invoice.paid === undefined &&
                  invoice.writtenOff === undefined &&
                  invoice.due <= addDays(s.asOf, 91),
              )
              .sort((a, b) => a.id.localeCompare(b.id))
              .slice(0, 40)
              .map((invoice) => ({ kind: "lose_invoice" as const, invoiceId: invoice.id })),
          ];
        } else if (["cost_spike", "hiring_plan", "card_spend_spike"].includes(scenario.id)) {
          legacy = scenario.changes.map((change) =>
            change.kind === "remove_cash"
              ? { ...change, label: change.label.replace(/ \d{4}-\d{2}-\d{2}$/, "") }
              : change,
          );
        }
        expect(engine.forecast(s, inputs.model, scenario.changes), scenario.id).toEqual(
          engine.forecast(s, inputs.model, legacy),
        );
        if (scenario.id === "hiring_plan")
          expect(
            fixCandidates(inputs, scenario, forecastScenario(inputs, scenario)).some(
              (fix) => fix.id === "fix_pause_hiring",
            ),
          ).toBe(true);
      }
    },
  );
});
