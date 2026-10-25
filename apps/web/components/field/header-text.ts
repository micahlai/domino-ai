// Plain-language text for the top bar, the provenance row and the Brain map header. Pure, so the
// wording is tested without a browser or backend.

export interface CatalogLike {
  id: string;
  name: string;
  referenceCompany: string;
  periodStart: string;
  periodEnd: string;
  reportedAt: string;
  filedAt?: string;
  simulationAsOf: string;
}

/** "2026-10-25" -> "Oct 25, 2026". Dates are calendar days, so format them in UTC. */
export const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

/** Picker label: short name, a muted subtitle and a one-letter mark. */
export function companyDisplay(entry: Pick<CatalogLike, "id" | "name" | "simulationAsOf">) {
  const inspired = entry.name.match(/^(.*?)\s*\(inspired by (.+)\)$/i);
  if (inspired) {
    const name = inspired[1] ?? entry.name;
    return { name, subtitle: `Inspired by ${inspired[2]}`, initial: name.charAt(0) };
  }
  if (entry.id === "2u")
    return {
      name: "2U (historical)",
      subtitle: `${entry.simulationAsOf.slice(0, 4)} public filings`,
      initial: "2U",
    };
  return { name: entry.name, subtitle: "Public filings", initial: entry.name.charAt(0) };
}

/** One quiet line under the top bar. The full dates live in the Sources sheet only. */
export function provenanceSummary(entry: CatalogLike | undefined) {
  if (!entry) return { badge: "Simulated books", line: "reconstructed from public filings" };
  // 2U is a real public company: its books come from its filings, not a simulation.
  if (entry.id === "2u")
    return { badge: "Public filings", line: `as of ${shortDate(entry.simulationAsOf)}` };
  return {
    badge: "Simulated books",
    line: `based on ${entry.referenceCompany} filings · as of ${shortDate(entry.simulationAsOf)}`,
  };
}

/** Rows for the Sources sheet: each date once, labelled. */
export function provenanceDates(entry: CatalogLike) {
  const rows: [string, string][] = [
    ["Reported period", `${shortDate(entry.periodStart)} to ${shortDate(entry.periodEnd)}`],
    ["Published", shortDate(entry.reportedAt)],
  ];
  if (entry.filedAt && entry.filedAt !== entry.reportedAt)
    rows.push(["Filed", shortDate(entry.filedAt)]);
  rows.push([
    "Starting books",
    `${shortDate(entry.simulationAsOf)} (reconstructed${entry.id === "2u" ? ", historical ledger date" : ""})`,
  ]);
  return rows;
}

const UUID = /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi;
const RUN_ID = /\b(run)\s+[0-9a-z][\w-]{5,}\b/gi;

/** Raw operation summary -> one plain status line. Run ids and status codes stay in details. */
export function plainStatus(summary: string): string {
  const s = summary.trim();
  if (/^Waiting for CREAO repair (run|result)/i.test(s)) return "CREAO is correcting its plan…";
  if (/^Waiting for CREAO (run|result)/i.test(s)) return "CREAO is planning the next steps…";
  const queued = s.match(/^Queued: (.+?) waits for the company's current CREAO run/i);
  if (queued) return `${queued[1]} is queued behind CREAO's current run.`;
  const planned = s.match(/^CREAO run \S+(?: \(repaired\))?: (.+)$/i);
  if (planned) return `CREAO planned: ${planned[1]}`;
  if (/^CREAO run failed/i.test(s))
    return "CREAO could not finish this run; agents keep their default order.";
  return s
    .replace(UUID, "")
    .replace(RUN_ID, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export type MenuAction =
  | { type: "move"; index: number }
  | { type: "close"; returnFocus: boolean }
  | null;

/** Arrow keys move through menu items (wrapping), Home/End jump, Escape and Tab close. Enter and
 * Space are left to the focused button's own click. */
export function menuKey(key: string, index: number, count: number): MenuAction {
  if (count <= 0) return key === "Escape" ? { type: "close", returnFocus: true } : null;
  switch (key) {
    case "ArrowDown":
      return { type: "move", index: (index + 1) % count };
    case "ArrowUp":
      return { type: "move", index: (index - 1 + count) % count };
    case "Home":
      return { type: "move", index: 0 };
    case "End":
      return { type: "move", index: count - 1 };
    case "Escape":
      return { type: "close", returnFocus: true };
    case "Tab":
      return { type: "close", returnFocus: false };
    default:
      return null;
  }
}

/** The Brain map's one status line: plain words, then when it happened. */
export const statusLine = (summary: string, ago: string) =>
  `${plainStatus(summary).replace(/[.\s]+$/, "")} · ${ago}`;
