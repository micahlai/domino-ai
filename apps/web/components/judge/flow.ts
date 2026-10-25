// Judge flow helpers shared by the steps: the stored company id (this browser only) and the
// data source tiles.
import type { ToolId } from "../../convex/connectors/types";
import type { JudgeSource } from "../../convex/lib/judge";

const KEY = "domino.judge.company";
const EVENT = "domino:judge-company";

/** Step 2 tiles: the vendor's name and what it gives the forecast, in plain words. */
export const SOURCE_TILE: Record<JudgeSource, { vendor: string; name: string; gives: string }> = {
  nessie: { vendor: "capitalone", name: "Capital One bank", gives: "Cash balance and payments" },
  stripe: { vendor: "stripe", name: "Stripe", gives: "Customers, invoices, payouts" },
  ramp: { vendor: "ramp", name: "Ramp", gives: "Card spend" },
  qbo: { vendor: "qbo", name: "QuickBooks", gives: "Bills to pay" },
  gusto: { vendor: "gusto", name: "Gusto", gives: "Payroll" },
  hubspot: { vendor: "hubspot", name: "HubSpot", gives: "Deals in the pipeline" },
};

/** Every tool's tile, for operating companies that read a Plaid bank feed instead. */
export const TOOL_TILE: Record<ToolId, { vendor: string; name: string; gives: string }> = {
  ...SOURCE_TILE,
  plaid: { vendor: "plaid", name: "Bank feed (Plaid)", gives: "Cash balance and payments" },
};

export function readStored(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
export function storeJudgeCompany(id: string | null) {
  try {
    if (id) window.localStorage.setItem(KEY, id);
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the company still works until the page reloads.
  }
  window.dispatchEvent(new Event(EVENT));
}
