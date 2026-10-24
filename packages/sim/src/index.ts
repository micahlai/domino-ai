import type { Simulator } from "@domino/contracts";

/** Placeholder. Built by prompt E1 (prompts/engine/E1-simulator.md). */
const notBuilt = (name: string) => () => {
  throw new Error(`sim.${name} is not built yet. Run prompt E1.`);
};

export const simulator: Simulator = {
  createCompany: notBuilt("createCompany"),
  advanceWeek: notBuilt("advanceWeek"),
  answerKey: notBuilt("answerKey"),
};
