import type { Simulator } from "@domino/contracts";
import { advanceWeek } from "./advance.ts";
import { createCompany } from "./create.ts";

/** Placeholder. Built by prompt E1 (prompts/engine/E1-simulator.md). */
const notBuilt = (name: string) => () => {
  throw new Error(`sim.${name} is not built yet. Run prompt E1.`);
};

export const simulator: Simulator = {
  createCompany,
  advanceWeek,
  answerKey: notBuilt("answerKey"),
};

export * from "./drivers/index.ts";
