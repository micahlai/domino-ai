// Bare Node cannot resolve the contracts' extensionless runtime imports that advance.ts needs.
import { createCompany } from "./create.ts";
import { formatSummary } from "./summary.ts";

console.log(formatSummary(createCompany("kestrel", 42)));
