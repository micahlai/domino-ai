import type { Snapshot } from "@domino/contracts";

/**
 * Plain names for source records, so labels never show raw ids such as
 * "synthetic/gitlab-current/plan/17/invoice/2026-10-18". Shared by the server (labels it
 * saves) and the screen (older saved labels and change lists).
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 18" for an ISO date; the input unchanged when it is not one. */
export function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${month} ${Number(m[3])}` : iso;
}

/** Rounded dollars for headlines: "$78.3M", "$1.2K", "$950". */
export function compactMoney(cents: number): string {
  if (!Number.isFinite(cents)) return "unknown";
  const sign = cents < 0 ? "-" : "";
  const dollars = Math.abs(cents) / 100;
  const units: [number, string][] = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, unit] of units)
    if (dollars >= size) {
      const tenths = Math.round((dollars / size) * 10) / 10;
      return `${sign}$${tenths % 1 === 0 ? tenths.toFixed(0) : tenths.toFixed(1)}${unit}`;
    }
  return `${sign}$${Math.round(dollars).toLocaleString("en-US")}`;
}

export function customerName(snapshot: Snapshot, id: string): string {
  return snapshot.customers.find((c) => c.id === id)?.name ?? "Customer";
}

/** "Northwind invoice ($1.2M, due Oct 18)". */
export function invoiceName(snapshot: Snapshot, id: string): string {
  const invoice = snapshot.invoices.find((i) => i.id === id);
  if (!invoice) return "an invoice";
  return `${customerName(snapshot, invoice.customerId)} invoice (${compactMoney(invoice.amount)}, due ${shortDate(invoice.due)})`;
}

/** "Acme bill ($40K, due Nov 2)". */
export function billName(snapshot: Snapshot, id: string): string {
  const bill = snapshot.bills.find((b) => b.id === id);
  if (!bill) return "a bill";
  return `${bill.vendor} bill (${compactMoney(bill.amount)}, due ${shortDate(bill.due)})`;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Replace raw record ids in a saved label with plain names. "Invoice <id> is paid 14
 * additional days late" becomes "Northwind invoice ($1.2M, due Oct 18) is paid 14 days late".
 */
export function friendlyLabel(label: string, snapshot: Snapshot | null | undefined): string {
  if (!snapshot || !label) return label;
  let out = label;
  const swap = (id: string, name: string, word: string) => {
    if (!id || !out.includes(id)) return;
    out = out.replace(new RegExp(`(?:\\b${word} )?${escapeRegex(id)}`, "gi"), name);
  };
  // Longest ids first so a prefix never eats part of a longer id.
  for (const i of [...snapshot.invoices].sort((a, b) => b.id.length - a.id.length))
    swap(i.id, invoiceName(snapshot, i.id), "invoice");
  for (const b of [...snapshot.bills].sort((x, y) => y.id.length - x.id.length))
    swap(b.id, billName(snapshot, b.id), "bill");
  for (const c of [...snapshot.customers].sort((x, y) => y.id.length - x.id.length))
    swap(c.id, c.name, "customer");
  out = out.replace(/ additional days late/g, " days late");
  return out.charAt(0).toUpperCase() + out.slice(1);
}
