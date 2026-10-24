import { IdSchema } from "@domino/contracts";
import type { Id } from "../../convex/_generated/dataModel";

const CompanyId = IdSchema.regex(/^[a-z0-9]{32}$/).transform((value) => value as Id<"companies">);
export function resolveCompanyId(routeId: string) {
  return CompanyId.safeParse(
    routeId === "kestrel" ? process.env.NEXT_PUBLIC_DEMO_COMPANY_ID : routeId,
  );
}
export function isSampleCompany(routeId: string) {
  return (
    routeId === "kestrel" &&
    (!process.env.NEXT_PUBLIC_DEMO_COMPANY_ID || !process.env.NEXT_PUBLIC_CONVEX_URL)
  );
}
