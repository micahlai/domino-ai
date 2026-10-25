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
      "Propose plausible events, run them through the forecast, and explain which plans keep cash above the illustrative cash floor. Every suggested action needs a person's approval.",
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

/** Titles are the vendor each mock server imitates; the category comes from the vendor. */
export const BUILT_IN_SOURCES: SourceProfile[] = [
  {
    id: "billing",
    title: "Stripe",
    brief: "Invoices, customer payments and payouts (mock Stripe server).",
  },
  { id: "crm", title: "HubSpot", brief: "Deals and expected renewals (mock HubSpot server)." },
  { id: "cards", title: "Ramp", brief: "Company card charges and bills paid (mock Ramp server)." },
  {
    id: "books",
    title: "QuickBooks",
    brief: "Bills and the books' cash accounts (mock QuickBooks server).",
  },
  { id: "payroll", title: "Gusto", brief: "Pay runs and their dates (mock Gusto server)." },
  {
    id: "bank",
    title: "Capital One",
    brief: "Bank balance and transactions, read from the Capital One Nessie sandbox.",
  },
  {
    id: "plaid",
    title: "Plaid",
    brief: "Simulated bank balance and transactions (mock Plaid server).",
  },
];

/** What the agents produce. Always shown, like the built-in agents; idle until the log says so. */
export type OutputProfile = { id: string; title: string; brief: string };

export const BUILT_IN_OUTPUTS: OutputProfile[] = [
  {
    id: "books",
    title: "Books versions",
    brief: "Each save is a new version of the weekly books. Older versions are kept.",
  },
  {
    id: "flags",
    title: "Flags for review",
    brief: "Possible problems in the new entries. A person approves or dismisses each one.",
  },
  {
    id: "forecast",
    title: "Cash forecast",
    brief: "The 13-week cash forecast and risks, computed by the engine from the saved books.",
  },
  {
    id: "export",
    title: "Weekly export",
    brief: "The weekly books and open flags, packaged for a simulation run.",
  },
];

/** Stable key for an agent or source name as the backend writes it ("Audit agent" -> "audit"). */
export function catalogKey(name: string, known: { id: string }[]): string {
  const lower = name.trim().toLowerCase();
  const hit = known.find((k) => lower === k.id || lower.startsWith(`${k.id} `));
  return hit ? hit.id : lower.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}
