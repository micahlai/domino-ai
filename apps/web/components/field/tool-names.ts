import { TOOL_CATEGORY_LABEL, type ToolCategory } from "../icons/ToolIcon";
import { VENDORS, vendorFor } from "../icons/vendors";

// Raw tool ids from the activity log (convex/fieldJobs.ts, convex/field.ts, convex/connections.ts
// and the demo fixture) -> plain labels and a category. The raw id stays visible in the details
// panel; this only changes what the map shows.

export type ToolInfo = {
  label: string;
  category: ToolCategory;
  /** Chips with the same group collapse into one ("Read data · 6") inside an agent card. */
  group: string;
  /**
   * Demo Apify actors (the offline fixture) return canned pages. Live runs log the actor's name
   * as the tool label and are not demo actors.
   */
  demoActor?: boolean;
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
  "nessie.read": { label: "Read bank (Capital One Nessie)", category: "read" },
  "nessie.post": { label: "Post bank lines to Capital One Nessie", category: "save" },
  "stripe.webhook": { label: "Webhook from Stripe", category: "read" },
  "gusto.webhook": { label: "Webhook from Gusto", category: "read" },
  "ramp.webhook": { label: "Webhook from Ramp", category: "read" },
  "nessie.webhook": { label: "Deposit notice from Capital One Nessie", category: "read" },
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
  read_snapshot: { label: "Read saved books", category: "read" },
  check_limit: { label: "Check the lender's limit", category: "audit" },
  rank_scenarios: { label: "Rank events by risk", category: "forecast" },
  draft_events: { label: "Draft what-if events", category: "other" },
  "engine.forecast": { label: "Run forecast", category: "forecast" },
  "engine.stresstest": { label: "Stress test", category: "forecast" },
  "engine.scorefix": { label: "Score a fix", category: "forecast" },
  "engine.scanrisks": { label: "Scan for risks", category: "forecast" },
  "convex.analystruns": { label: "Save analyst run", category: "other" },
  // Real model calls (convex/fieldAi.ts, convex/fieldAnalyst.ts).
  "claude.explainflags": { label: "Claude: explain flags", category: "audit" },
  "claude.summarizescenarios": { label: "Claude: summarize scenarios", category: "other" },
  "creao.counterpartyrisk": { label: "CREAO: counterparty risk notes", category: "other" },
};

const CATEGORIES = new Set<string>(Object.keys(TOOL_CATEGORY_LABEL));
const isCategory = (c: string | undefined): c is ToolCategory => CATEGORIES.has(c ?? "");

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
  const last = id.split(/[./]/).at(-1) ?? id;
  const words = last
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Tool";
}

/** One chip per category on an agent card; the panel lists the tools inside. */
const groupOf = (category: ToolCategory) => `category:${category}`;

/**
 * Raw tool id (and the log's category, when it records one) -> label, category and chip group.
 * Apify actors ("apify.website-content-crawler", category "apify") get their own Apify group.
 * `label` is the log's toolLabel: a live run's actor name, or "demo actor" on demo rows.
 */
export function describeTool(raw: string, category?: string, label?: string): ToolInfo {
  const key = raw.trim().toLowerCase();
  if (category === "apify" || key.startsWith("apify.") || key.startsWith("apify/")) {
    const live = Boolean(label?.trim()) && label?.trim().toLowerCase() !== "demo actor";
    return {
      label: live ? (label?.trim() ?? "") : humanize(raw.replace(/(^|[./])demo-/i, "$1")),
      category: "apify",
      group: groupOf("apify"),
      ...(!live && { demoActor: true }),
    };
  }
  const known = KNOWN[key];
  if (known) return { ...known, group: groupOf(known.category) };
  if (isCategory(category)) return { label: humanize(raw), category, group: groupOf(category) };
  const consent = /^([a-z0-9-]+)\.consent$/.exec(key);
  if (consent) {
    const vendor = vendorFor(consent[1]);
    const name = vendor === "generic" ? humanize(consent[1] ?? "") : VENDORS[vendor].name;
    return { label: `Connect ${name}`, category: "connect", group: groupOf("connect") };
  }
  const guess = GUESS.find(([re]) => re.test(key))?.[1] ?? "other";
  return { label: humanize(raw), category: guess, group: groupOf(guess) };
}

/** Label for a collapsed chip of several tools of one category. */
export const GROUP_LABEL: Record<ToolCategory, string> = {
  ...TOOL_CATEGORY_LABEL,
  read: "Read data",
  connect: "Connect tools",
  audit: "Checks",
  forecast: "Forecast tools",
  apify: "Apify actors",
};
