import type { ToolCategory } from "../icons/ToolIcon";
import { VENDORS, vendorFor } from "../icons/vendors";

// Raw tool ids from the activity log (convex/fieldJobs.ts, convex/field.ts, convex/connections.ts
// and the demo fixture) -> plain labels and a category. The raw id stays visible in the details
// panel; this only changes what the map shows.

export type ToolInfo = {
  label: string;
  category: ToolCategory;
  /** Chips with the same group collapse into one ("Read data · 6") inside an agent card. */
  group: string;
};

const KNOWN: Record<string, { label: string; category: ToolCategory }> = {
  "mock.billing.list": { label: "Read billing (Stripe)", category: "read" },
  "mock.crm.list": { label: "Read deals (HubSpot)", category: "read" },
  "mock.cards.list": { label: "Read card spend (Ramp)", category: "read" },
  "mock.books.list": { label: "Read books (QuickBooks)", category: "read" },
  "mock.payroll.list": { label: "Read payroll (Gusto)", category: "read" },
  "mock.bank.list": { label: "Read bank (Capital One)", category: "read" },
  "stripe.read": { label: "Read billing (Stripe)", category: "read" },
  "hubspot.read": { label: "Read deals (HubSpot)", category: "read" },
  "ramp.read": { label: "Read card spend (Ramp)", category: "read" },
  "qbo.read": { label: "Read books (QuickBooks)", category: "read" },
  "gusto.read": { label: "Read payroll (Gusto)", category: "read" },
  "plaid.read": { label: "Read bank (Plaid)", category: "read" },
  "connectors.pullall": { label: "Sync connected tools", category: "read" },
  read_feed: { label: "Read new entries", category: "read" },
  "field.map": { label: "Map to books format", category: "map" },
  map_to_books: { label: "Map to books format", category: "map" },
  "field.tieout": { label: "Tie out balances", category: "audit" },
  "convex.snapshots": { label: "Save books version", category: "save" },
  save_snapshot: { label: "Save books version", category: "save" },
  "engine.auditsnapshot": { label: "Check entries", category: "audit" },
  check_entries: { label: "Check entries", category: "audit" },
  compare_payment_history: { label: "Compare payment history", category: "audit" },
  "engine.recompute": { label: "Update forecast", category: "forecast" },
  build_forecast: { label: "Build 13-week forecast", category: "forecast" },
  export_seed: { label: "Export weekly books", category: "export" },
  "sim.advanceweek": { label: "New entries (demo feed)", category: "simulate" },
  "sim.createcompany": { label: "Create demo company", category: "simulate" },
  "mock.plant": { label: "Plant test anomaly", category: "simulate" },
};

const GUESS: [RegExp, ToolCategory][] = [
  [/consent|connect/, "connect"],
  [/export/, "export"],
  [/forecast|recompute|project/, "forecast"],
  [/audit|check|verify|tie.?out|compare/, "audit"],
  [/save|write|snapshot|store/, "save"],
  [/map|transform|normali[sz]e|match/, "map"],
  [/sim\.|mock\.plant|advance/, "simulate"],
  [/list|read|pull|fetch|get|sync/, "read"],
];

function humanize(id: string): string {
  const last = id.split(".").at(-1) ?? id;
  const words = last
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Tool";
}

/** Read and connect tools collapse per agent; everything else keeps its own chip. */
const groupOf = (category: ToolCategory, key: string) =>
  category === "read" || category === "connect" ? `category:${category}` : `tool:${key}`;

export function describeTool(raw: string): ToolInfo {
  const key = raw.trim().toLowerCase();
  const known = KNOWN[key];
  if (known) return { ...known, group: groupOf(known.category, key) };
  const consent = /^([a-z0-9-]+)\.consent$/.exec(key);
  if (consent) {
    const vendor = vendorFor(consent[1]);
    const name = vendor === "generic" ? humanize(consent[1] ?? "") : VENDORS[vendor].name;
    return { label: `Connect ${name}`, category: "connect", group: groupOf("connect", key) };
  }
  const category = GUESS.find(([re]) => re.test(key))?.[1] ?? "other";
  return { label: humanize(raw), category, group: groupOf(category, key) };
}

/** Label for a collapsed chip of several tools of one category. */
export const GROUP_LABEL: Partial<Record<ToolCategory, string>> = {
  read: "Read data",
  connect: "Connect tools",
};
