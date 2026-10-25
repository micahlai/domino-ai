// Vendors Domino reads from, with the aliases each part of the app uses for them: connector ids
// (convex/connectors), field log source kinds (convex/fieldSources.ts) and brain map catalog ids.

export type VendorId =
  | "stripe"
  | "ramp"
  | "qbo"
  | "gusto"
  | "hubspot"
  | "plaid"
  | "capitalone"
  | "bank"
  | "generic";

export type Vendor = {
  id: VendorId;
  name: string;
  /** What kind of data it holds, in plain words. */
  category: string;
  /** Tile background; brand color where the brand has a well-known one. */
  color: string;
};

export const VENDORS: Record<VendorId, Vendor> = {
  stripe: { id: "stripe", name: "Stripe", category: "Billing", color: "#635BFF" },
  ramp: { id: "ramp", name: "Ramp", category: "Card spend", color: "#E7F127" },
  qbo: { id: "qbo", name: "QuickBooks", category: "Accounting", color: "#2CA01C" },
  gusto: { id: "gusto", name: "Gusto", category: "Payroll", color: "#F45D48" },
  hubspot: { id: "hubspot", name: "HubSpot", category: "Deals", color: "#FF7A59" },
  plaid: { id: "plaid", name: "Plaid", category: "Bank", color: "#111111" },
  capitalone: { id: "capitalone", name: "Capital One", category: "Bank", color: "#004879" },
  bank: { id: "bank", name: "Bank", category: "Bank", color: "#475569" },
  generic: { id: "generic", name: "Data source", category: "Data", color: "#64748B" },
};

const ALIASES: Record<string, VendorId> = {
  stripe: "stripe",
  billing: "stripe",
  ramp: "ramp",
  cards: "ramp",
  qbo: "qbo",
  quickbooks: "qbo",
  books: "qbo",
  gusto: "gusto",
  payroll: "gusto",
  hubspot: "hubspot",
  crm: "hubspot",
  plaid: "plaid",
  nessie: "capitalone",
  capitalone: "capitalone",
  "capital-one": "capitalone",
  bank: "capitalone",
};

/** Any id or name the app uses for a source ("cards", "Ramp", "nessie") -> its vendor. */
export function vendorFor(idOrName: string | undefined): VendorId {
  const key = (idOrName ?? "").trim().toLowerCase();
  if (ALIASES[key]) return ALIASES[key];
  const word = key.split(/[^a-z0-9]+/).find((w) => ALIASES[w]);
  return word ? (ALIASES[word] as VendorId) : "generic";
}
