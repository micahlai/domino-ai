// Built-in agents and data sources Domino ships with. These describe what each part is for; they
// are not records of work. Work comes only from the operation log.

export type AgentProfile = {
  id: string;
  title: string;
  brief: string;
  instructions: string;
};

export const BUILT_IN_AGENTS: AgentProfile[] = [
  {
    id: "ingestion",
    title: "Ingestion agent",
    brief: "Reads new entries from each source and files them into the weekly books.",
    instructions:
      "Check every connected source for new entries. Map each entry to the books format, keep exact cents, and save a new snapshot. Never call a real payment system and never move money.",
  },
  {
    id: "audit",
    title: "Audit agent",
    brief: "Checks new entries for duplicates, conflicts, odd amounts and missing items.",
    instructions:
      "Compare each new snapshot with the last one and with the sources. Flag duplicates, records that disagree, unusual amounts or timing, and expected items that did not arrive. Send each flag to a person to review.",
  },
  {
    id: "forecaster",
    title: "Forecaster",
    brief: "Projects cash for the next 13 weeks from the approved books.",
    instructions:
      "Build the 13-week cash forecast from the latest approved snapshot and scheduled items. The engine computes every number; the forecaster only chooses inputs and explains them.",
  },
  {
    id: "analyst",
    title: "Analyst",
    brief: "Tests what could go wrong and how the company's plans hold up.",
    instructions:
      "Propose plausible events, run them through the forecast, and explain which plans keep cash above the lender's limit. Every suggested action needs a person's approval.",
  },
];

/** Log actors that are not AI agents, keyed like catalogKey(). Shown as plain descriptions. */
export const OTHER_ACTORS: Record<string, string> = {
  "mock-feed":
    "Simulator, not an agent: moves the synthetic company forward a week and plants test anomalies on request.",
  engine:
    "Deterministic code, not an AI agent: recomputes the forecast and risks from the saved books.",
  reviewer: "A person deciding a flag. Every decision is recorded with who made it.",
};

export type SourceProfile = { id: string; title: string; brief: string };

export const BUILT_IN_SOURCES: SourceProfile[] = [
  { id: "billing", title: "Billing", brief: "Invoices and customer payments (mock server)." },
  { id: "crm", title: "Customer records", brief: "Deals and expected renewals (mock server)." },
  { id: "cards", title: "Card spending", brief: "Company card charges (mock server)." },
  { id: "books", title: "Accounting books", brief: "Bills and journal entries (mock server)." },
  { id: "payroll", title: "Payroll", brief: "Pay runs and dates (mock server)." },
  { id: "bank", title: "Bank", brief: "Bank balance and transactions (Capital One Nessie)." },
];

/** Stable key for an agent or source name as the backend writes it ("Audit agent" -> "audit"). */
export function catalogKey(name: string, known: { id: string }[]): string {
  const lower = name.trim().toLowerCase();
  const hit = known.find((k) => lower === k.id || lower.startsWith(`${k.id} `));
  return hit ? hit.id : lower.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}
