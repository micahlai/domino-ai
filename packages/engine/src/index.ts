import type { Engine } from "@domino/contracts";

/** Placeholder. Built by prompts E4 to E6 (prompts/engine/). Pure functions only. */
const notBuilt = (name: string) => () => {
  throw new Error(`engine.${name} is not built yet. See prompts/engine.`);
};

export const engine: Engine = {
  forecast: notBuilt("forecast"),
  dominoes: notBuilt("dominoes"),
  scanRisks: notBuilt("scanRisks"),
  scoreFix: notBuilt("scoreFix"),
  grade: notBuilt("grade"),
  learn: notBuilt("learn"),
  history: notBuilt("history"),
  pastEvents: notBuilt("pastEvents"),
  stressTest: notBuilt("stressTest"),
};
