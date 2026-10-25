import type { ProfileId } from "@domino/sim";

/**
 * Display names for the four simulated companies (pure, shared by the backend and the company
 * picker). Each is the same kind of business, a B2B analytics SaaS company of about $21M ARR
 * and ~87 people, under a different situation (packages/sim/src/drivers/profiles.ts). The
 * company record's name is exactly `name`, so a company's profile is found from its name.
 */
export interface FieldCompanyProfile {
  id: ProfileId;
  name: string;
  /** One line: what is happening at this company. */
  story: string;
}

export const FIELD_COMPANIES: FieldCompanyProfile[] = [
  {
    id: "kestrel",
    name: "Kestrel Data",
    story: "Healthy: cash stays far above the lender's $3M minimum",
  },
  {
    id: "kestrel-churn",
    name: "Harrier Analytics",
    story: "Its largest customer is leaving and settling its last invoice short",
  },
  {
    id: "kestrel-late",
    name: "Merlin Metrics",
    story: "Its ten biggest customers pay 30 to 60 days late",
  },
  {
    id: "kestrel-crunch",
    name: "Osprey Insights",
    story: "Cash crunch: debt payments, early hires and a year-end bonus outrun cash",
  },
];

export const DEFAULT_FIELD_COMPANY: ProfileId = "kestrel";

export const fieldCompany = (id: ProfileId): FieldCompanyProfile =>
  FIELD_COMPANIES.find((c) => c.id === id) ?? (FIELD_COMPANIES[0] as FieldCompanyProfile);

export const profileOfName = (name: string): ProfileId | null =>
  FIELD_COMPANIES.find((c) => c.name === name)?.id ?? null;
