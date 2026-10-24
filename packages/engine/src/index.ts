import type { Engine } from "@domino/contracts";
import { dominoes } from "./dominoes";
import { forecast } from "./forecast";
import { history, pastEvents } from "./history";
import { scanRisks } from "./risks";
import { scoreFix } from "./score-fix";
import { stressTest } from "./stress-test";

/** Engine-local ranking helper; not part of the shared Engine contract. */
export { type RankedFix, rankFixes } from "./score-fix";

/** Placeholder. grade/learn are a later task. Pure functions only. */
const notBuilt = (name: string) => () => {
  throw new Error(`engine.${name} is not built yet. See prompts/engine.`);
};

export const engine: Engine = {
  forecast,
  dominoes,
  scanRisks,
  scoreFix,
  grade: notBuilt("grade"),
  learn: notBuilt("learn"),
  history,
  pastEvents,
  stressTest,
};
