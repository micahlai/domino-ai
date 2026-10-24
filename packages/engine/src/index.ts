import type { Engine } from "@domino/contracts";
import { dominoes } from "./dominoes";
import { forecast } from "./forecast";
import { grade } from "./grade";
import { history, pastEvents } from "./history";
import { learn } from "./learn";
import { scanRisks } from "./risks";
import { scoreFix } from "./score-fix";
import { stressTest } from "./stress-test";

/** Engine-local ranking helper; not part of the shared Engine contract. */
export { type RankedFix, rankFixes } from "./score-fix";

export const engine: Engine = {
  forecast,
  dominoes,
  scanRisks,
  scoreFix,
  grade,
  learn,
  history,
  pastEvents,
  stressTest,
};
