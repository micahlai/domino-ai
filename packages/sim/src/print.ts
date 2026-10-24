import { simulator } from "./index.ts";
import { formatSummary } from "./summary.ts";

console.log(formatSummary(simulator.createCompany("kestrel", 42)));
